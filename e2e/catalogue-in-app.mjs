/**
 * The imported catalogue in the app, end to end in Chromium: with AI_PROVIDER_PRODUCT_MATCHING=catalogue,
 * a Dinner look's pieces come from the imported catalogue, each shown as its cut-out.
 *
 *   npm run build
 *   DATABASE_URL=... REDIS_URL=... AI_SERVICE_URL=... node e2e/catalogue-in-app.mjs
 *
 * Needs the catalogue imported and processed (npm run db:seed, npm run catalogue:process), the ai
 * service with its models, and the bucket. Starts the gateway itself on :4182.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4182;
const BASE = `http://127.0.0.1:${PORT}`;
const RESULTS = `${BASE}/moment/results?occasion=DINNER&venue=RESTAURANT&time=NIGHT&vibe=SHARP&spend=ELEVATED&mode=light`;
const STORES = ["Praxis Library (fixture)", "Harbour & Hide (sample CSV)", "Test Tailors"];

const server = spawn("node", ["server/index.mjs"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), APP_ORIGIN: BASE, AI_PROVIDER_PRODUCT_MATCHING: "catalogue", CATALOGUE_MATCHING_FOR: "everyone", RETAIL_SHOPIFY_STORE: "" },
  stdio: "ignore",
});

const results = [];
const check = (ok, what) => {
  results.push({ ok: Boolean(ok), what });
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
};

try {
  for (let i = 0; i < 50; i += 1) {
    if (await fetch(`${BASE}/api/health`).then((r) => r.ok, () => false)) break;
    await new Promise((r) => setTimeout(r, 200));
  }
  const live = await (await fetch(`${BASE}/api/ai`)).json();
  check(live.live?.some((s) => s.service === "product_matching" && s.provider === "catalogue"), "the server offers product matching from the catalogue");

  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const cutouts = [];
  page.on("response", (r) => {
    if (/\/api\/cutouts\//.test(r.url())) cutouts.push({ status: r.status(), type: r.headers()["content-type"] });
  });
  const started = Date.now();
  await page.goto(RESULTS);
  await page.getByRole("button", { name: /^Save/ }).filter({ visible: true }).first().waitFor({ timeout: 30_000 });
  const ready = Date.now() - started;
  await page.waitForTimeout(3000);
  const pieces = (await page.locator(".a-piece").filter({ visible: true }).allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  const fromCatalogue = pieces.filter((t) => STORES.some((s) => t.toUpperCase().includes(s.toUpperCase())));
  check(fromCatalogue.length >= 3, `the look's pieces come from the catalogue (${fromCatalogue.length} of ${pieces.length}: ${fromCatalogue.join("; ")})`);
  const srcs = await page.locator(".a-piece img").evaluateAll((imgs) => imgs.map((i) => i.getAttribute("src") ?? ""));
  check(srcs.filter((s) => /\/api\/cutouts\/prod_[0-9a-f]{24}\/[0-9a-f]{16}\.png$/.test(s)).length >= 3, "each catalogue piece is shown as its cut-out");
  check(cutouts.length >= 3 && cutouts.every((c) => c.status === 200 && c.type === "image/png"), `the cut-outs load (${cutouts.length}, all 200 image/png)`);
  check(/Reference photo, not these exact pieces/.test(await page.locator("body").innerText()), "the big photo says it shows the look, not these exact pieces");
  check(ready < 15_000, `the look is ready in ${ready} ms`);
  await browser.close();
} catch (e) {
  check(false, `ran to the end (${String(e?.message ?? e).split("\n")[0]})`);
} finally {
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
