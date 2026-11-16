/**
 * Checks a retailer's catalogue before it is imported, and writes nothing: the same reading, rules and
 * placing as the import (server/retailers/import.mjs), so what it says is what the import would do.
 *
 *   npm run retailers:check -- --csv path/to/catalogue.csv
 *   npm run retailers:check -- --shopify www.example.com
 *   add --report out.json to keep the full result as JSON
 *
 * It lists every problem with the line or piece it is on, and ends with what would happen: how many
 * pieces would be styled and searchable once their photos are processed, and why the rest wouldn't.
 * Exits 1 only when the catalogue can't be read at all (a missing file, a missing required column).
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { problemsWith } from "./connector.mjs";
import { createCsvConnector } from "./csv.mjs";
import { isGarment, placeItem } from "./import.mjs";
import { createShopifyConnector } from "./shopify.mjs";

const inStock = (item) => item.variants.some((v) => v.available);

/**
 * What the import would make of these items. `rejected` are the rows the connector already left out
 * (a CSV row that broke a rule). Pure: no database, no network.
 */
export function checkItems(items, rejected = []) {
  const result = {
    pieces: 0,
    sizes: 0,
    ready: 0,
    bySlot: { top: 0, bottom: 0, shoes: 0, extras: 0 },
    soldOut: [],
    noPhoto: [],
    unmapped: [],
    notGarments: [],
    duplicates: [],
    rejected: [...rejected],
    currencies: [],
  };
  const seen = new Set();
  const currencies = new Set();
  for (const item of items) {
    const problems = problemsWith(item);
    if (problems.length) {
      result.rejected.push({ productId: item?.externalId ?? null, title: item?.title ?? null, reasons: problems });
      continue;
    }
    if (seen.has(item.externalId)) {
      result.duplicates.push({ productId: item.externalId, title: item.title });
      continue;
    }
    seen.add(item.externalId);
    result.pieces += 1;
    result.sizes += item.variants.length;
    currencies.add(item.currency);
    const brief = { productId: item.externalId, title: item.title, ...(item.productType ? { productType: item.productType } : {}) };
    if (!isGarment(item)) {
      result.notGarments.push(brief);
      continue;
    }
    const place = placeItem(item);
    if (!place) {
      result.unmapped.push(brief);
      continue;
    }
    result.bySlot[place.slot] += 1;
    if (item.images.length === 0) result.noPhoto.push(brief);
    else if (!inStock(item)) result.soldOut.push(brief);
    else result.ready += 1;
  }
  result.currencies = [...currencies].sort();
  return result;
}

/** The result as plain text: the problems, then what would happen. */
export function describeCheck(name, r) {
  const lines = [`${name}: ${r.pieces} pieces, ${r.sizes} sizes`];
  const section = (title, list, line) => {
    if (!list.length) return;
    lines.push("", `${title} (${list.length}):`);
    for (const x of list.slice(0, 50)) lines.push(`  ${line(x)}`);
    if (list.length > 50) lines.push(`  …and ${list.length - 50} more (see --report)`);
  };
  section("Left out, fix these rows", r.rejected, (x) => `${x.line ? `line ${x.line}, ` : ""}${x.productId ?? "no product_id"}: ${x.reasons.join("; ")}`);
  section("Repeated product ids, only the first is kept", r.duplicates, (x) => `${x.productId} "${x.title}"`);
  section("Not recognised as a kind of clothing: add a clearer name, product_type or tag", r.unmapped, (x) => `${x.productId} "${x.title}"${x.productType ? ` (type ${x.productType})` : ""}`);
  section("No photo: can't be shown until it has one", r.noPhoto, (x) => `${x.productId} "${x.title}"`);
  section("Sold out in every size: kept, shown again when back in stock", r.soldOut, (x) => `${x.productId} "${x.title}"`);
  section("Not clothing, skipped", r.notGarments, (x) => `${x.productId} "${x.title}"`);
  if (r.currencies.length > 1) lines.push("", `More than one currency (${r.currencies.join(", ")}): prices are shown as given, not converted.`);
  lines.push(
    "",
    `Ready: ${r.ready} of ${r.pieces} pieces would be styled in looks and found by search once their photos are processed.`,
    `  by kind: tops ${r.bySlot.top}, bottoms ${r.bySlot.bottom}, shoes ${r.bySlot.shoes}, extras ${r.bySlot.extras}`,
  );
  return lines.join("\n");
}

async function main() {
  const { values } = parseArgs({ options: { csv: { type: "string" }, shopify: { type: "string" }, report: { type: "string" } } });
  if (!values.csv === !values.shopify) throw new Error("Say what to check: --csv <file> or --shopify <store>.");
  const connector = values.csv ? createCsvConnector({ path: values.csv }) : createShopifyConnector({ store: values.shopify });
  const items = await connector.items();
  const name = await connector.name();
  const result = checkItems(items, connector.rejected ?? []);
  console.log(describeCheck(name, result));
  if (values.report) writeFileSync(values.report, JSON.stringify({ name, source: connector.source, ...result }, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(`The catalogue couldn't be checked: ${e?.message ?? e}`);
    process.exitCode = 1;
  });
}
