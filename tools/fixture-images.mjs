/**
 * Makes the fixture catalogues' photos from the library photographs (public/images), so cut-outs,
 * vectors and search can be tested on real garment pictures with no network. Run once; the output is
 * committed (server/retailers/fixtures/images and library.csv).
 *
 *   node tools/fixture-images.mjs
 *
 * - library.csv: one piece per region of each library photograph (src/shared/references.mjs), titled
 *   and typed as the reference catalogue files it. The search test's catalogue.
 * - Stand-in photos for the e2e test store and sample.csv, named as their image URLs: for each piece, the
 *   crop of a library piece of the same kind and colour (else kind, else slot). The test store's
 *   "missing.jpg" is left missing on purpose: suite 14 tests a broken photo.
 *
 * The library photographs are Praxis's styling pictures, shown on Praxis only: these crops are test
 * fixtures and never shown to customers.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { REFERENCE_REGION, REFERENCE_ROWS } from "../src/shared/references.mjs";
import { classify, colourOf } from "../src/shared/ontology.mjs";
import { PRODUCTS } from "../e2e/fixtures/test-store.mjs";
import { parseCsv } from "../server/retailers/csv.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "server/retailers/fixtures/images");
const HOST = "https://cdn.praxis-test.example";
mkdirSync(join(OUT, "library"), { recursive: true });

/** Every library piece with a region, one per region of a photograph (the outer layer wins for tops). */
const pieces = [];
for (const [outfit, rows] of Object.entries(REFERENCE_ROWS)) {
  const byRegion = new Map();
  for (const [part, slot, layer, name, subcategory, colour, , , , , region] of rows) {
    if (region === null) continue;
    const key = region ?? (slot === "extras" ? "neck" : slot);
    if (byRegion.has(key) && !(layer === "outer")) continue;
    byRegion.set(key, { outfit, part, slot, layer, name, subcategory, colour, key });
  }
  pieces.push(...byRegion.values());
}

async function crop(piece, file) {
  const photo = join(ROOT, "public/images", `${piece.outfit}.jpg`);
  const { width, height } = await sharp(photo).metadata();
  const r = REFERENCE_REGION[piece.key];
  const box = { left: Math.round(r.x * width), top: Math.round(r.y * height), width: Math.round(r.w * width), height: Math.round(r.h * height) };
  box.width = Math.min(box.width, width - box.left);
  box.height = Math.min(box.height, height - box.top);
  await sharp(photo).extract(box).resize({ width: 600, height: 600, fit: "inside" }).jpeg({ quality: 82 }).toFile(file);
}

// The library catalogue.
const csv = [["product_id", "title", "brand", "product_type", "colour", "variant_id", "size", "price", "currency", "available", "stock_quantity", "image_urls", "product_url"]];
const SIZE = { top: "M", bottom: "32", shoes: "10", extras: "" };
for (const p of pieces) {
  const id = `${p.outfit}_${p.part}`;
  await crop(p, join(OUT, "library", `${id}.jpg`));
  const title = p.name.charAt(0).toUpperCase() + p.name.slice(1);
  csv.push([`LIB-${id}`, title, "Praxis Library", p.subcategory, p.colour, `LIB-${id}-1`, SIZE[p.slot], "100.00", "USD", "yes", "5", `${HOST}/library/${id}.jpg`, `https://shop.praxis-test.example/products/${id.replace(/_/g, "-")}`]);
}
const quote = (v) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
writeFileSync(join(ROOT, "server/retailers/fixtures/library.csv"), csv.map((r) => r.map((v) => quote(String(v))).join(",")).join("\n") + "\n");

/** The library piece closest to a fixture piece: same kind and colour, else same kind, else same slot. */
function closest(title, type) {
  const kind = classify(title, type ?? "");
  if (!kind) return null;
  const colour = colourOf(title);
  return (
    pieces.find((p) => p.subcategory === kind.subcategory && p.colour === colour) ??
    pieces.find((p) => p.subcategory === kind.subcategory) ??
    pieces.find((p) => p.slot === kind.slot && p.colour === colour) ??
    pieces.find((p) => p.slot === kind.slot)
  );
}

const standIns = [];
const want = new Map();
for (const p of PRODUCTS) for (const i of p.images ?? []) want.set(i.src, [p.title, p.product_type]);
const rows = parseCsv(readFileSync(join(ROOT, "server/retailers/fixtures/sample.csv"), "utf8"));
const head = rows[0];
for (const r of rows.slice(1)) {
  const urls = (r[head.indexOf("image_urls")] ?? "").split(/[|\s]+/).filter(Boolean);
  for (const u of urls) want.set(u, [r[head.indexOf("title")], r[head.indexOf("product_type")]]);
}
for (const [url, [title, type]] of want) {
  if (!url.startsWith(`${HOST}/`) || url.endsWith("/missing.jpg")) continue;
  const piece = closest(title, type);
  if (!piece) continue;
  await crop(piece, join(OUT, url.slice(HOST.length + 1)));
  standIns.push(`${url.slice(HOST.length + 1)} <- ${piece.outfit} ${piece.key} (${title})`);
}

console.log(`library.csv: ${pieces.length} pieces`);
console.log(`stand-in photos: ${standIns.length}`);
for (const s of standIns) console.log(`  ${s}`);
