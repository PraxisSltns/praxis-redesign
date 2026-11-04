/**
 * Imports a retailer's catalogue into the database (DATABASE_URL) and prints the report.
 *
 *   npm run retailers:import -- --shopify www.example.com [--name "Example"] [--currency USD]
 *   npm run retailers:import -- --csv path/to/catalogue.csv [--name "Example"]
 *   npm run retailers:import -- --fixtures        the test store, the sample CSV and the library pieces, no network (npm run db:seed)
 *   add --report out.json to keep the full report as JSON
 *
 * Exits 1 if an import fails; the database is left as it was for that retailer.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { closeDb, db } from "../db.mjs";
import { createCsvConnector } from "./csv.mjs";
import { describeReport, importRetailer } from "./import.mjs";
import { createShopifyConnector } from "./shopify.mjs";

const SAMPLE_CSV = fileURLToPath(new URL("./fixtures/sample.csv", import.meta.url));
const LIBRARY_CSV = fileURLToPath(new URL("./fixtures/library.csv", import.meta.url));

/** The e2e test store (e2e/fixtures/test-store.mjs) answered from memory, so seeding needs no network. */
export async function fixtureStoreFetcher() {
  const { PRODUCTS } = await import("../../e2e/fixtures/test-store.mjs");
  return async (url) => {
    const body = url.includes("/meta.json") ? { name: "Test Tailors" } : { products: url.includes("page=1") ? PRODUCTS : [] };
    return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
  };
}

export async function connectorsFor(values) {
  if (values.fixtures) {
    return [
      createShopifyConnector({ store: "test-tailors.praxis-test.example", fetcher: await fixtureStoreFetcher() }),
      createCsvConnector({ path: SAMPLE_CSV, name: "Harbour & Hide (sample CSV)", id: "csv:sample" }),
      // Pieces cut from the library photographs (tools/fixture-images.mjs), for testing cut-outs and search.
      createCsvConnector({ path: LIBRARY_CSV, name: "Praxis Library (fixture)", id: "csv:library" }),
    ];
  }
  if (values.shopify) return [createShopifyConnector({ store: values.shopify, name: values.name ?? null, currency: values.currency ?? "USD" })];
  if (values.csv) return [createCsvConnector({ path: values.csv, name: values.name ?? null })];
  throw new Error("Say what to import: --shopify <store>, --csv <file> or --fixtures.");
}

async function main() {
  const { values } = parseArgs({
    options: {
      shopify: { type: "string" },
      csv: { type: "string" },
      fixtures: { type: "boolean" },
      name: { type: "string" },
      currency: { type: "string" },
      report: { type: "string" },
    },
  });
  const pool = db();
  if (!pool) throw new Error("DATABASE_URL is not set (copy .env.example to .env, or set it).");
  const reports = [];
  for (const connector of await connectorsFor(values)) {
    const report = await importRetailer(pool, connector);
    reports.push(report);
    console.log(describeReport(report));
  }
  if (values.report) writeFileSync(values.report, JSON.stringify(reports, null, 2));
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main()
    .catch((e) => {
      console.error(`Import failed: ${e?.message ?? e}`);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
