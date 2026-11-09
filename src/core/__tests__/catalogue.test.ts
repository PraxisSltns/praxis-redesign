/**
 * The catalogue's batch job (server/catalogue/process.mjs) and search (server/search.mjs) against real
 * Postgres and Redis, with stand-ins for the ai service and the bucket. Runs when DATABASE_URL and
 * REDIS_URL are set; uses Redis database 15 and its own retailer, so local data is never touched.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module
import { createCsvConnector } from "../../../server/retailers/csv.mjs";
// @ts-expect-error plain JavaScript module
import { importRetailer, retailerIdFor } from "../../../server/retailers/import.mjs";
// @ts-expect-error plain JavaScript module
import { coverage, createImageFetcher, cutoutKey, enqueuePending, KEYS, runWorker } from "../../../server/catalogue/process.mjs";
// @ts-expect-error plain JavaScript module
import { readQuery, search } from "../../../server/search.mjs";

describe("reading a search", () => {
  it("takes text or a photo, with optional slot, size and limit", () => {
    expect(readQuery({ text: " navy blazer " }).query).toEqual({ text: "navy blazer", image: null, slot: null, size: null, limit: 12 });
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString("base64");
    expect(readQuery({ image: `data:image/png;base64,${png}`, slot: "top", size: "40", limit: 5 }).query).toMatchObject({ text: null, slot: "top", size: "40", limit: 5 });
  });

  it("refuses what it can't run", () => {
    expect(readQuery({}).error).toBe("Send either text or image.");
    expect(readQuery({ text: "a", image: "AAAA" }).error).toBe("Send either text or image.");
    expect(readQuery({ text: "a", slot: "hat" }).error).toMatch(/^slot must be one of/);
    expect(readQuery({ text: "a", limit: 0 }).error).toMatch(/^limit/);
    expect(readQuery({ image: "not base64!" }).error).toBe("image must be base64.");
  });
});

describe("photos for the job", () => {
  it("reads a fixture host from a local folder, and refuses a missing photo for good", async () => {
    const fetchImage = createImageFetcher({ FIXTURE_IMAGES: "cdn.praxis-test.example=server/retailers/fixtures/images" });
    const photo = await fetchImage("https://cdn.praxis-test.example/blazer.jpg");
    expect(photo.bytes.length).toBeGreaterThan(1000);
    await expect(fetchImage("https://cdn.praxis-test.example/missing.jpg")).rejects.toMatchObject({ retryable: false });
  });
});

const ready = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

describe.skipIf(!ready)("the batch job and search, on Postgres and Redis", async () => {
  // @ts-expect-error plain JavaScript module
  const { closeDb, db } = await import("../../../server/db.mjs");
  const { createClient } = await import("redis");
  const pool = db();
  const redis = createClient({ url: `${String(process.env.REDIS_URL).replace(/\/\d+$/, "")}/15` });
  const id = `csv:job-test-${Date.now()}`;
  const retailerId = retailerIdFor(id);
  const only = { retailerId };

  /** Three pieces, each a different unit vector, so search results are known in advance. */
  const CSV = [
    "product_id,title,product_type,size,price,currency,available,image_urls,product_url",
    "A,Navy Wool Blazer,Blazers,40,300,USD,yes,https://cdn.praxis-test.example/blz-nvy.jpg,https://shop.example/a",
    "A,Navy Wool Blazer,Blazers,42,300,USD,no,,https://shop.example/a",
    "B,White Leather Sneakers,Shoes,10,150,USD,yes,https://cdn.praxis-test.example/snk-wht.jpg,https://shop.example/b",
    "C,Brown Suede Loafers,Shoes,10,200,USD,no,https://cdn.praxis-test.example/lof-brn.jpg,https://shop.example/c",
    "D,Grey Chinos,Chinos,32,90,USD,yes,https://cdn.praxis-test.example/missing.jpg,https://shop.example/d",
  ].join("\n");
  const AXIS: Record<string, number> = { "blz-nvy": 0, "snk-wht": 1, "lof-brn": 2 };
  const unit = (i: number) => Array.from({ length: 768 }, (_, j) => (j === i ? 1 : 0));

  const bucket = new Map<string, Buffer>();
  const storage = {
    put: async (key: string, body: Buffer) => void bucket.set(key, body),
    getBytes: async (key: string) => bucket.get(key) ?? null,
  };
  let cutouts = 0;
  let failNext = 0;
  const ai = {
    async cutout(bytes: Buffer) {
      cutouts += 1;
      if (failNext > 0) {
        failNext -= 1;
        throw Object.assign(new Error("the ai service answered 503"), { retryable: true });
      }
      return { png: Buffer.concat([Buffer.from("PNG:"), bytes.subarray(0, 32)]), ms: 7 };
    },
    async embedImages(images: Buffer[]) {
      return { vectors: images.map(() => unit(lastAxis)) };
    },
    async embedTexts(texts: string[]) {
      return { vectors: texts.map((t) => unit(t.includes("sneaker") ? 1 : t.includes("loafer") ? 2 : 0)) };
    },
  };
  // Which photo is being embedded: the stand-in vector follows the photo's file name.
  let lastAxis = 0;
  const base = createImageFetcher({ FIXTURE_IMAGES: "cdn.praxis-test.example=server/retailers/fixtures/images" });
  const fetchImage = async (url: string) => {
    lastAxis = AXIS[url.split("/").pop()!.replace(".jpg", "")] ?? 5;
    return base(url);
  };
  const deps = () => ({ pool, redis, storage, ai, fetchImage });

  beforeAll(async () => {
    await redis.connect();
    await redis.flushDb();
    await importRetailer(pool, createCsvConnector({ path: "job.csv", id, read: async () => CSV }));
  });
  beforeEach(() => {
    failNext = 0;
  });
  afterAll(async () => {
    await pool.query("DELETE FROM retailers WHERE retailer_id = $1", [retailerId]);
    await redis.flushDb();
    await redis.close();
    await closeDb();
  });

  it("queues each piece once, however often it's asked", async () => {
    expect(await enqueuePending(pool, redis, only)).toBe(4);
    expect(await enqueuePending(pool, redis, only)).toBe(0);
    expect(await redis.lLen(KEYS.queue)).toBe(4);
  });

  it("carries on after a stop: a job a worker had taken is put back", async () => {
    // A piece with a good photo, so the missing one is still queued for the next test,
    // whatever order the ids (which change each run) put them in.
    const { rows } = await pool.query("SELECT product_id FROM products WHERE retailer_id = $1 AND images->>0 NOT LIKE '%missing.jpg' ORDER BY product_id LIMIT 1", [retailerId]);
    const taken = rows[0].product_id;
    expect(await redis.lRem(KEYS.queue, 1, taken)).toBe(1);
    await redis.rPush(KEYS.processing, taken);
    const report = await runWorker({ ...deps(), limit: 1 });
    expect(report.recovered).toBe(1);
    expect(await redis.lLen(KEYS.processing)).toBe(0);
  });

  it("retries a passing failure, gives up at once on a missing photo, and covers the rest", async () => {
    failNext = 1;
    const report = await runWorker(deps());
    expect(report.retried).toBe(1);
    expect(report.failed).toEqual([{ id: expect.stringMatching(/^prod_/), reason: "the photo was not found (/missing.jpg)", tries: 1 }]);
    expect(await coverage(pool, only)).toEqual({ eligible: 4, with_cutout: 3, with_vector: 3, wrong_dims: 0 });
    expect(await redis.lLen(KEYS.queue)).toBe(0);
    expect(await redis.sCard(KEYS.queued)).toBe(0);
  });

  it("keeps each cut-out under one key per product and photo, and makes nothing twice", async () => {
    const { rows } = await pool.query("SELECT product_id, images->>0 AS image, cutout_url FROM products WHERE retailer_id = $1 AND cutout_url IS NOT NULL", [retailerId]);
    for (const r of rows) expect(r.cutout_url).toBe(cutoutKey(r.product_id, r.image));
    const made = cutouts;
    expect(await enqueuePending(pool, redis, only)).toBe(1);
    const again = await runWorker(deps());
    expect(cutouts).toBe(made);
    expect(again.done).toBe(0);
    expect(again.failed).toHaveLength(1);
  });

  it("finds the nearest in-stock pieces, with their cut-out and sizes", async () => {
    const out = await search({ text: "navy blazer", limit: 3 }, { pool, ai, retailerId });
    expect(out.items[0]).toMatchObject({ title: "Navy Wool Blazer", slot: "top", sizes: ["40"], score: 1 });
    expect(out.items[0].cutoutUrl).toMatch(/^\/api\/cutouts\/prod_[0-9a-f]{24}\/[0-9a-f]{16}\.png$/);
    // The loafers are sold out in every size, and the chinos have no vector: neither is offered.
    expect(out.items.map((i: { title: string }) => i.title)).toEqual(["Navy Wool Blazer", "White Leather Sneakers"]);
  });

  it("filters by size and slot", async () => {
    expect((await search({ text: "navy blazer", size: "42" }, { pool, ai, retailerId })).items.map((i: { title: string }) => i.title)).toEqual([]);
    expect((await search({ text: "navy blazer", slot: "shoes" }, { pool, ai, retailerId })).items.map((i: { title: string }) => i.title)).toEqual(["White Leather Sneakers"]);
  });

  it("drops a piece from search once it leaves the feed", async () => {
    await importRetailer(pool, createCsvConnector({ path: "job.csv", id, read: async () => CSV.split("\n").filter((l) => !l.startsWith("B,")).join("\n") }));
    expect((await search({ text: "white sneakers" }, { pool, ai, retailerId })).items.map((i: { title: string }) => i.title)).toEqual(["Navy Wool Blazer"]);
  });
});
