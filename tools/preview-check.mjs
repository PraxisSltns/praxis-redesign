/**
 * Walks the main journeys of a static build with no server behind it (the Vercel preview) and fails if
 * the page calls /api, logs an error, or shows the error screen. Read-only; nothing is bought or sent.
 *
 *   VITE_BACKEND=none npm run build && npx vite preview --port 4174 &
 *   node tools/preview-check.mjs http://localhost:4174
 *
 * Needs a Chromium that Playwright can find (npx playwright-core install chromium, or CHROMIUM_PATH).
 */
import { chromium } from "playwright-core";

const BASE = (process.argv[2] ?? process.env.PREVIEW_URL ?? "http://localhost:4174").replace(/\/$/, "");
const Q = "occasion=DINNER&venue=RESTAURANT&time=NIGHT&vibe=SHARP&spend=ELEVATED";

/** Each journey: a name, where it starts, and what it does there. */
const JOURNEYS = [
  { name: "home", path: "/?mode=light", act: async (p) => p.getByRole("heading").first().waitFor() },
  { name: "first question", path: "/moment/venue?mode=light&occasion=DINNER", act: async (p) => p.getByRole("button").first().waitFor() },
  { name: "build to results", path: `/moment/build?mode=light&${Q}`, act: async (p) => p.waitForURL(/\/moment\/results/, { timeout: 20_000 }) },
  {
    name: "results: next look, pieces, why",
    path: `/moment/results?${Q}&mode=light`,
    act: async (p) => {
      await p.locator(".a-canvas img").first().waitFor({ timeout: 20_000 });
      await p.keyboard.press("Tab");
      const next = p.getByRole("button", { name: /next look/i });
      if (await next.count()) await next.first().click();
      const why = p.getByRole("button", { name: /why this look/i });
      if (await why.count()) await why.first().click();
    },
  },
  { name: "try-on", path: `/moment/tryon?${Q}&mode=light`, act: async (p) => p.waitForLoadState("networkidle") },
  { name: "Style DNA", path: "/dna?mode=light", act: async (p) => p.waitForLoadState("networkidle") },
  { name: "saved looks", path: "/looks?mode=light", act: async (p) => p.waitForLoadState("networkidle") },
  { name: "wardrobe", path: "/wardrobe?mode=light", act: async (p) => p.waitForLoadState("networkidle") },
  { name: "your data", path: "/data?mode=light", act: async (p) => p.waitForLoadState("networkidle") },
];

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
let failed = 0;
for (const device of [{ name: "desktop", viewport: { width: 1440, height: 900 } }, { name: "phone", viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true }]) {
  for (const j of JOURNEYS) {
    const context = await browser.newContext({ viewport: device.viewport, isMobile: device.isMobile, hasTouch: device.hasTouch });
    const page = await context.newPage();
    const api = [];
    const errors = [];
    page.on("request", (r) => {
      if (new URL(r.url()).pathname.startsWith("/api")) api.push(`${r.method()} ${new URL(r.url()).pathname}`);
    });
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    page.on("pageerror", (e) => errors.push(String(e)));
    let problem = "";
    try {
      await page.goto(BASE + j.path, { waitUntil: "domcontentloaded" });
      await j.act(page);
      await page.waitForTimeout(1500);
      if (await page.getByText(/something went wrong/i).count()) problem = "the error screen showed";
    } catch (e) {
      problem = `did not finish: ${String(e?.message ?? e).split("\n")[0]}`;
    }
    if (api.length) problem ||= `called the server: ${[...new Set(api)].join(", ")}`;
    if (errors.length) problem ||= `logged an error: ${errors[0]}`;
    console.log(`${problem ? "FAIL" : "pass"}  ${device.name.padEnd(7)} ${j.name}${problem ? `: ${problem}` : ""}`);
    if (problem) failed++;
    await context.close();
  }
}
await browser.close();
console.log(failed ? `${failed} journey(s) failed` : "every journey ran with no server, no /api call and no error");
process.exit(failed ? 1 : 0);
