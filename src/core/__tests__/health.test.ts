/** GET /api/health's dependency part: Postgres and Redis each up, down or off, and 503 only when a configured one is down. */
import { describe, expect, it } from "vitest";
// @ts-expect-error plain JavaScript module
import { dependencies, probe, statusFor } from "../../../server/health.mjs";
// @ts-expect-error plain JavaScript module
import { dbSettings } from "../../../server/db.mjs";
// @ts-expect-error plain JavaScript module
import { redisSettings } from "../../../server/redis.mjs";

const pool = (answer: () => Promise<unknown>) => ({ query: answer });
const cache = (answer: () => Promise<unknown>) => ({ ping: answer });
const never = () => new Promise(() => undefined);

describe("one dependency", () => {
  it("is off when it isn't configured", async () => {
    expect(await probe(null, () => Promise.resolve())).toBe("off");
  });

  it("is up when it answers", async () => {
    expect(await probe(pool(() => Promise.resolve({ rows: [{ "?column?": 1 }] })), (p: { query: () => Promise<unknown> }) => p.query())).toBe("up");
  });

  it("is down when it fails", async () => {
    expect(await probe({}, () => Promise.reject(new Error("ECONNREFUSED")))).toBe("down");
  });

  it("is down when the check throws before answering", async () => {
    expect(
      await probe({}, () => {
        throw new Error("The client is closed");
      }),
    ).toBe("down");
  });

  it("is down when it doesn't answer in time", async () => {
    const started = Date.now();
    expect(await probe({}, never, 50)).toBe("down");
    expect(Date.now() - started).toBeLessThan(1000);
  });
});

describe("the health answer", () => {
  it("is 200 when everything configured is up", async () => {
    const deps = await dependencies({ pool: pool(() => Promise.resolve({})), cache: cache(() => Promise.resolve("PONG")) });
    expect(deps).toEqual({ db: "up", redis: "up" });
    expect(statusFor(deps)).toBe(200);
  });

  it("is 200 with nothing configured, as on a server with no database", async () => {
    const deps = await dependencies({ pool: null, cache: null });
    expect(deps).toEqual({ db: "off", redis: "off" });
    expect(statusFor(deps)).toBe(200);
  });

  it("is 503 with redis: down when Redis stops answering", async () => {
    const deps = await dependencies({ pool: pool(() => Promise.resolve({})), cache: cache(() => Promise.reject(new Error("The client is closed"))) });
    expect(deps).toEqual({ db: "up", redis: "down" });
    expect(statusFor(deps)).toBe(503);
  });

  it("is 503 with db: down when Postgres times out", async () => {
    const deps = await dependencies({ pool: pool(never), cache: cache(() => Promise.resolve("PONG")), ms: 50 });
    expect(deps).toEqual({ db: "down", redis: "up" });
    expect(statusFor(deps)).toBe(503);
  });

  it("counts an unexpected Redis reply as down", async () => {
    const deps = await dependencies({ pool: null, cache: cache(() => Promise.resolve("LOADING")) });
    expect(deps.redis).toBe("down");
  });
});

describe("client settings", () => {
  it("has no database or Redis without their URLs", () => {
    expect(dbSettings({}).connectionString).toBe("");
    expect(redisSettings({}).url).toBe("");
  });

  it("pools with timeouts, overridable from the environment", () => {
    const s = dbSettings({ DATABASE_URL: "postgres://x", DB_POOL_MAX: "4", DB_STATEMENT_TIMEOUT_MS: "nonsense" });
    expect(s).toMatchObject({ connectionString: "postgres://x", max: 4, statement_timeout: 10_000, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 30_000 });
    expect(redisSettings({ REDIS_URL: " redis://r:6379 ", REDIS_CONNECT_TIMEOUT_MS: "2500" })).toEqual({ url: "redis://r:6379", connectTimeout: 2500 });
  });
});
