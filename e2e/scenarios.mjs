/**
 * The end-to-end suite: the twelve scenarios from the master spec (section 22), plus accessibility, phone layout and load
 * checks, run in Chromium against a built copy of the app. Repeatable: every scenario starts in a fresh
 * browser profile.
 *
 *   npm run build && npm run e2e
 *
 * Starts the production server (server/index.mjs) on port 4173 unless
 * BASE_URL is set. Needs a Chromium that Playwright can find
 * (PLAYWRIGHT_BROWSERS_PATH, or CHROMIUM_PATH for a specific binary). Writes e2e/results/report.md and
 * report.json, with screenshots, and exits non-zero if anything fails.
 *
 * Every run belongs to one of the thirteen suites of the Phase 3 test plan (SUITES below). The
 * scenarios in this file came first; the suites in e2e/suites add to them, one file per suite.
 *
 *   ONLY=S1,UX3 npm run e2e      just those scenarios
 *   SUITE=4,9 npm run e2e        just those suites
 */
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { chromium } from "playwright-core";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = join(here, "results");
mkdirSync(OUT, { recursive: true });
const AXE = readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");

const DESKTOP = { viewport: { width: 1440, height: 900 } };
const PHONE = { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 };

/* ------------------------------------------------------------ server */

let server = null;
let BASE = process.env.BASE_URL?.replace(/\/$/, "");
if (!BASE) {
  BASE = "http://127.0.0.1:4173";
  server = spawn("node", ["server/index.mjs"], { cwd: join(here, ".."), stdio: "ignore", env: { ...process.env, PORT: "4173" } });
  for (let i = 0; i < 80; i++) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 250));
  }
}

const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

/* ------------------------------------------------------------ harness */

const results = [];
let current = null;

function check(cond, what) {
  current.checks.push({ ok: Boolean(cond), what });
}

/** ONLY=S1,UX3 runs just those scenarios. */
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(",")) : null;

export const SUITES = {
  1: "Homepage and occasion selection",
  2: "Style a moment",
  3: "Outfit results",
  4: "See it on me",
  5: "Style DNA",
  6: "Digital wardrobe",
  7: "Saved looks and accounts",
  8: "Retailer and checkout preparation",
  9: "Failure and recovery",
  10: "Responsiveness",
  11: "Accessibility",
  12: "AI integration contracts",
  13: "Analytics",
  14: "Hybrid catalogue",
  15: "Second consultant review",
};
/** The suite of each scenario written before the suites existed. */
const LEGACY_SUITE = {
  S1: 2, S2: 2, UX1: 2, UX4: 2, PARAMS1: 2,
  S3: 3, S11: 3, UX2: 3, UX3: 3, UX5: 3, UX7: 3, UX10: 3,
  S6: 5, S7: 5, S7b: 5, ISO2: 5,
  S4: 7, S5: 7, ISO1: 7, ISO3: 7, TABS1: 7, SAVE2: 7, UX6: 7, UX8: 7, DATA1: 7, FULL1: 7,
  S10: 8,
  S8: 9, S9: 9, P2A: 9, P2B: 9,
  WHY1: 3, WHY2: 3,
  LAYOUT: 10, UX9: 10, FACE1: 10, FACE2: 10,
  A11Y: 11,
  P2C: 12,
  S12: 13,
  NAV: 1, PERF: 1,
};
function suiteOf(id) {
  if (LEGACY_SUITE[id]) return LEGACY_SUITE[id];
  if (id.startsWith("PHOTOS")) return 1;
  if (id.startsWith("TRY")) return 4;
  const n = Number(/^P[345]-(\d+)/.exec(id)?.[1]);
  return n || 0;
}
/** SUITE=4,9 runs just those suites. */
const ONLY_SUITES = process.env.SUITE ? new Set(process.env.SUITE.split(",").map(Number)) : null;
if (ONLY_SUITES && ![...ONLY_SUITES].every((n) => n in SUITES)) {
  console.error(`SUITE=${process.env.SUITE} names no known suite in full; use numbers 1 to ${Object.keys(SUITES).length}, comma separated.`);
  process.exit(2);
}
const wanted = (id) => (!ONLY || ONLY.has(id)) && (!ONLY_SUITES || ONLY_SUITES.has(suiteOf(id)));

/**
 * REAL_SIGN_IN=1 is for a site that signs people in for real, by email link (staging). Scenarios that need
 * the preview's sign-in (a seeded Premium account, or the preview's Apple, Google or email buttons) can't
 * run there: the server doesn't know that account, so its requests get 401. They are skipped and listed
 * in the report, never counted as passed.
 */
const REAL_SIGN_IN = process.env.REAL_SIGN_IN === "1";
const skipped = [];
const skipForSignIn = (id, title, device, needsPreview) => {
  if (!REAL_SIGN_IN || !needsPreview) return false;
  skipped.push({ id, title, device: typeof device === "string" ? device : String(device), suite: suiteOf(id), reason: "needs the preview sign-in" });
  return true;
};

/** A signed-in Premium customer from the first page, for scenarios that start inside Style DNA or try-on. */
const PREMIUM_USER = { id: "user_e2e", name: "Sam", email: "sam@example.com", premium: true };

async function scenario(id, title, device, fn, { sim, ip, locale, missingFiles, premium, previewSignIn, viewport, reducedMotion, contextOptions, seed } = {}) {
  if (!wanted(id)) return;
  if (skipForSignIn(id, title, device, premium || previewSignIn)) return;
  const ctx = await browser.newContext({ ...(viewport ?? (device === "phone" ? PHONE : DESKTOP)), reducedMotion: reducedMotion ?? "no-preference", ...(locale ? { locale } : {}), ...(contextOptions ?? {}) });
  if (premium)
    await ctx.addInitScript((u) => {
      if (localStorage.getItem("praxis_e2e_seeded")) return;
      localStorage.setItem("praxis_e2e_seeded", "1");
      localStorage.setItem("praxis_lab_a_user", JSON.stringify(u));
      localStorage.setItem("praxis_lab_a_premium", JSON.stringify({ [u.id]: true }));
    }, PREMIUM_USER);
  /* The visitor's address, as Railway's proxy passes it on; only on requests to our own server. */
  if (ip) await ctx.route(`${BASE}/**`, (r) => r.continue({ headers: { ...r.request().headers(), "x-forwarded-for": ip } }));
  if (sim) await ctx.addInitScript((s) => sessionStorage.setItem("praxis_sim", s), sim);
  /* Fixture data written before the first page loads, once per scenario. */
  if (seed)
    await ctx.addInitScript((entries) => {
      if (localStorage.getItem("praxis_e2e_fixture")) return;
      localStorage.setItem("praxis_e2e_fixture", "1");
      for (const [k, v] of Object.entries(entries)) localStorage.setItem(k, typeof v === "string" ? v : JSON.stringify(v));
    }, seed);
  const page = await ctx.newPage();
  current = { id, title, device, suite: suiteOf(id), checks: [], errors: [], status: "passed" };
  page.on("pageerror", (e) => current.errors.push(e.message));
  page.on("console", (m) => {
    /* Scenarios about missing photos expect the browser to log the failed file. */
    if (missingFiles && m.text().startsWith("Failed to load resource")) return;
    if (m.type() === "error") current.errors.push(m.text());
  });
  const shot = (name) => page.screenshot({ path: join(OUT, `${id}-${device}-${name}.png`) });
  try {
    await fn(page, shot);
  } catch (e) {
    current.checks.push({ ok: false, what: `ran to the end (${String(e.message).split("\n")[0]})` });
  }
  if (current.errors.length) current.checks.push({ ok: false, what: `no page errors (${current.errors[0]})` });
  current.status = current.checks.every((c) => c.ok) ? "passed" : "failed";
  results.push(current);
  await ctx.close();
}

const body = (p) => p.locator("body").innerText();
const button = (p, name) => p.getByRole("button", { name }).filter({ visible: true }).first();
const events = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("praxis_events") || "[]"));
const history = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("praxis_styling_history") || "[]"));
const lab = (p) => p.evaluate(() => JSON.parse(localStorage.getItem("praxis_lab_a") || "{}"));

/** Home, occasion, then the four questions; ends on the build. */
async function answer(p, { occasion, venue, time, feel, spend }) {
  await p.goto(`${BASE}/?mode=light`);
  await p.getByRole("radio", { name: occasion }).first().click();
  for (const name of [venue, time, feel, spend]) {
    await p.waitForTimeout(650);
    await p.getByRole("radio", { name }).first().click();
  }
  await p.waitForURL(/moment\/build/, { timeout: 8000 });
}
async function toResults(p, picks) {
  await answer(p, picks);
  await p.waitForURL(/moment\/results/, { timeout: 15000 });
  await p.waitForTimeout(1000);
}

const A = { occasion: "Dinner", venue: /Restaurant/, time: /Night/, feel: /Sharp/, spend: /\$300 to/ };
const B = { occasion: "Dinner", venue: /home/i, time: /Early evening/, feel: /Relaxed/, spend: /Under/ };

/* ------------------------------------------------------------ scenarios */

for (const device of ["desktop", "phone"]) {
  await scenario("S1", "First-time visitor gets three looks", device, async (p, shot) => {
    await toResults(p, A);
    const h = await history(p);
    check(h.length === 1, "one styling request sent");
    check(h[0]?.response?.status === "completed" && h[0].response.outfits.length === 3, "three looks returned");
    check((await p.locator(".a-thumbs button, [data-thumb]").count()) >= 3 || /1 of 3/i.test(await body(p)), "three looks shown");
    check(/for illustration/i.test(await body(p)), "the looks say they are examples");
    await shot("results");
  });

  await scenario("S2", "Different venue and time give a different request and looks", device, async (p) => {
    await toResults(p, A);
    await toResults(p, B);
    const [b, a] = await history(p);
    check(a.request.venue.type !== b.request.venue.type && a.request.timeOfDay !== b.request.timeOfDay, "venue and time differ in the request");
    check(a.request.inputKey !== b.request.inputKey, "the request key changes");
    check(a.response.outfits[0].outfitId !== b.response.outfits[0].outfitId, `different first look (${a.response.outfits[0].outfitId} vs ${b.response.outfits[0].outfitId})`);
  });

  await scenario("S3", "Rejecting a look as too formal stores feedback against it", device, async (p, shot) => {
    await toResults(p, A);
    const recommendationId = (await history(p))[0].response.recommendationId;
    const hero = new URL(p.url()).searchParams.get("hero");
    await button(p, /Not for me/).click();
    await p.waitForTimeout(300);
    await button(p, /Too formal/).click();
    await p.waitForTimeout(400);
    const fb = await p.evaluate(() => JSON.parse(localStorage.getItem("praxis_feedback") || "[]"));
    check(fb.length === 1, "stored once");
    check(fb[0]?.reason === "too_formal", "reason is too formal");
    check(fb[0]?.recommendationId === recommendationId && (!hero || fb[0]?.outfitId === hero), "against the right recommendation and look");
    await shot("feedback");
  });

  await scenario("S4", "A guest's saved look survives a refresh", device, async (p) => {
    await toResults(p, A);
    await button(p, /^Save/).click();
    await p.waitForTimeout(800);
    check(!/Sign in to save/i.test(await body(p)), "no sign in asked");
    await p.reload();
    await p.waitForTimeout(800);
    await p.goto(`${BASE}/looks?mode=light`);
    await p.waitForTimeout(800);
    const s = await lab(p);
    check((s.looks ?? []).length === 1, "one saved look in storage after refresh");
    check(!/No saved looks|nothing saved/i.test(await body(p)), "saved looks page lists it");
  });

  await scenario("S5", "Signing in moves a guest's saved look to the account", device, async (p, shot) => {
    await toResults(p, A);
    await button(p, /^Save/).click();
    await p.waitForTimeout(800);
    const owner = (await lab(p)).looks?.[0]?.owner;
    if (!(await p.getByRole("button", { name: /^Sign in$/ }).filter({ visible: true }).count())) {
      await p.getByRole("button", { name: /^Menu$/ }).first().click({ force: true });
      await p.waitForTimeout(400);
    }
    await button(p, /Sign in/).click();
    await p.waitForTimeout(600);
    await button(p, /Apple/).click();
    await p.waitForTimeout(1200);
    const after = (await lab(p)).looks ?? [];
    check(after.length === 1, "still one saved look");
    check(after[0] && after[0].owner !== owner && /user_/.test(JSON.stringify(after[0])), "the look now belongs to the account");
    check((await events(p)).some((e) => e.eventName === "account_migrated"), "migration recorded");
    await shot("signed-in");
  });

  await scenario("S6", "A corrected Style DNA colour is kept", device, async (p, shot) => {
    await p.goto(`${BASE}/dna/face?mode=light`);
    await p.waitForTimeout(600);
    await p.getByRole("radio", { name: /Use a sample/ }).first().click();
    await p.waitForTimeout(500);
    await button(p, "Looks right").click();
    await p.waitForTimeout(600);
    await p.getByRole("radio").first().click();
    await p.waitForTimeout(600);
    await p.getByRole("radio").first().click();
    await p.waitForTimeout(600);
    await p.getByRole("button").filter({ visible: true }).filter({ hasText: /Continue|Build|Next|Skip|Done/ }).first().click();
    await p.waitForURL(/dna\/result/, { timeout: 10000 });
    await p.waitForTimeout(500);
    check(/Example|Estimate/.test(await body(p)), "the colours are marked as an example");
    await button(p, "Not quite right?").click();
    await p.waitForTimeout(400);
    await p.getByRole("button", { name: "Warm" }).filter({ visible: true }).first().click();
    await p.keyboard.press("Escape");
    await p.waitForTimeout(400);
    await button(p, /Looks right|Save my Style DNA/).click();
    await p.waitForTimeout(800);
    await p.reload();
    const dna = (await lab(p)).profiles?.[0]?.profile;
    check(dna?.undertone?.corrected?.value === "warm", "the correction is saved");
    check(dna?.undertone?.inferred?.value && dna.undertone.inferred.value !== "warm", "the estimate is kept apart from it");
    await p.goto(`${BASE}/dna?mode=light`);
    await p.waitForTimeout(600);
    check(/Your correction/.test(await body(p)) && /Warm/.test(await body(p)), "the Style DNA page shows the correction");
    await shot("dna");
  }, { premium: true });

  await scenario("S7", "An unreadable photo gets a way forward", device, async (p, shot) => {
    const dark = await p.evaluate(async () => {
      const c = document.createElement("canvas");
      c.width = 600;
      c.height = 800;
      const g = c.getContext("2d");
      g.fillStyle = "#080808";
      g.fillRect(0, 0, 600, 800);
      return c.toDataURL("image/png").split(",")[1];
    });
    await p.goto(`${BASE}/dna/face?mode=light`);
    await p.waitForTimeout(600);
    await p.getByRole("radio", { name: /Upload a photo/ }).first().click();
    await p.waitForTimeout(300);
    check(/where it goes/i.test(await body(p)), "the photo notice comes first");
    const chooser = p.waitForEvent("filechooser", { timeout: 4000 });
    await button(p, "I agree").click();
    await (await chooser).setFiles({ name: "dark.png", mimeType: "image/png", buffer: Buffer.from(dark, "base64") });
    await p.waitForTimeout(1200);
    const t = await body(p);
    check(/too dark|daylight|light/i.test(t) && (await p.getByRole("alert").count()) > 0, "the reason is shown");
    check((await p.getByRole("radio", { name: /Use a sample/ }).count()) > 0, "another photo or a sample can be chosen");
    check(!(await p.evaluate(() => Object.values(localStorage).some((v) => v.includes("data:image")))), "the photo is not stored");
    await shot("refused");
  }, { premium: true });

  await scenario(
    "S7b",
    "A photo the analysis cannot read offers a retake or skipping colours",
    device,
    async (p, shot) => {
      await p.goto(`${BASE}/dna/face?mode=light`);
      await p.waitForTimeout(600);
      await p.getByRole("radio", { name: /Use a sample/ }).first().click();
      await p.waitForTimeout(400);
      await button(p, "Looks right").click();
      await p.waitForTimeout(500);
      await p.getByRole("radio").first().click();
      await p.waitForTimeout(500);
      await p.getByRole("radio").first().click();
      await p.waitForTimeout(500);
      await p.getByRole("button").filter({ visible: true }).filter({ hasText: /Continue|Build|Next|Skip|Done/ }).first().click();
      await p.waitForTimeout(1500);
      const t = await body(p);
      check(/couldn’t read your colours/.test(t), "says the photo could not be read");
      check((await button(p, "Retake the photo").count()) && (await button(p, /Skip colours/).count()), "retake or skip offered");
      await button(p, /Skip colours/).click();
      await p.waitForURL(/dna\/result/, { timeout: 5000 });
      check(/No colours yet/.test(await body(p)), "carries on without colours");
      await shot("skip");
    },
    { sim: "invalid_image", premium: true },
  );

  await scenario(
    "S8",
    "A slow answer, then a timeout, can be recovered",
    device,
    async (p, shot) => {
      await answer(p, A);
      await p.waitForTimeout(5800);
      check(/taking a little longer than usual/.test(await body(p)), "the delay is said after 5 seconds");
      check(!/\d+\s?%/.test(await body(p)), "no percentage shown");
      check(await button(p, "Cancel").count(), "Cancel is offered");
      await p.waitForTimeout(4500);
      const t = await body(p);
      check(/couldn’t put your looks together this time/.test(t), "the timeout is said plainly");
      check(await button(p, "Try again").count(), "Try again offered");
      check(await button(p, "Change my answers").count(), "Change my answers offered");
      await shot("timeout");
      await p.evaluate(() => sessionStorage.setItem("praxis_sim", "fast"));
      await button(p, "Try again").click();
      await p.waitForURL(/moment\/results/, { timeout: 10000 });
      check(/moment\/results/.test(p.url()) && (await history(p)).some((e) => e.response.status === "completed"), "Try again reaches the looks");
    },
    { sim: "timeout" },
  );

  await scenario(
    "S9",
    "Two looks only: the page works and says so",
    device,
    async (p, shot) => {
      await toResults(p, A);
      check(/I found 2 looks this time/.test(await body(p)), "says only two looks came back");
      check((await history(p))[0].response.status === "partial", "the answer is marked partial");
      await button(p, /Next look|Previous look/).click().catch(() => {});
      await button(p, /Check out/).click();
      await p.waitForTimeout(500);
      check(/Check out/.test(await body(p)), "Check out still opens");
      await shot("partial");
    },
    { sim: "partial" },
  );

  await scenario(
    "S10",
    "A sold-out piece never leads to a purchase",
    device,
    async (p, shot) => {
      await toResults(p, A);
      check(/Sold out/.test(await body(p)), "the piece says Sold out");
      const sold = p.locator(".a-piece", { hasText: "Sold out" }).first();
      check((await sold.getByRole("checkbox").count()) === 0, "a sold-out piece cannot be ticked");
      await button(p, /Check out/).click();
      await p.waitForTimeout(600);
      const t = await body(p);
      check(!/Order placed|Purchase \$/.test(t), "no fake order or Purchase button");
      const buy = p.getByRole("button", { name: /Buying isn/ }).filter({ visible: true }).first();
      check((await buy.count()) && (await buy.isDisabled()), "the buy button is disabled");
      check((await p.getByRole("link", { name: /Buy at/ }).count()) === 0, "no link out to a retailer");
      await shot("checkout");
    },
    { sim: "unavailable_products" },
  );

  await scenario(
    "P2A",
    "A service that fails once: Try again gets the looks",
    device,
    async (p, shot) => {
      await answer(p, A);
      await p.waitForSelector("text=couldn’t put your looks together this time", { timeout: 15000 });
      check(await button(p, "Try again").count(), "Try again offered after the first failure");
      await shot("first-failure");
      await button(p, "Try again").click();
      await p.waitForURL(/moment\/results/, { timeout: 15000 });
      check((await history(p)).some((e) => e.response.status === "completed"), "the second try answers");
    },
    { sim: "retry_success" },
  );

  await scenario(
    "P2B",
    "An answer that breaks the contract becomes a clean failure",
    device,
    async (p, shot) => {
      await answer(p, A);
      await p.waitForSelector("text=couldn’t put your looks together this time", { timeout: 15000 });
      const t = await body(p);
      check(!/undefined|NaN|\[object/.test(t), "nothing broken is shown");
      check(await button(p, "Change my answers").count(), "Change my answers offered");
      await shot("invalid");
    },
    { sim: "validation_error" },
  );
}

await scenario("P2C", "A full journey with try-on makes no call to an AI, image or retailer service (fonts only)", "desktop", async (p) => {
  const calls = [];
  p.on("request", (r) => {
    const u = new URL(r.url());
    if ((u.pathname.startsWith("/api/ai/") || (u.pathname === "/api/ai" && r.method() !== "GET")) || u.pathname.startsWith("/api/tryon") || !["127.0.0.1", "localhost", "fonts.googleapis.com", "fonts.gstatic.com"].includes(u.hostname)) calls.push(r.method() + " " + u.host + u.pathname);
  });
  await toResults(p, A);
  await p.goto(p.url().replace("moment/results", "moment/tryon"));
  await p.waitForTimeout(1500);
  check(calls.length === 0, `no outside or AI calls (${calls.slice(0, 3).join(", ") || "none"})`);
}, { premium: true });

await scenario("S11", "Phone: the whole journey, swipe, enlarge, back and save", "phone", async (p, shot) => {
  await toResults(p, A);
  const first = new URL(p.url()).searchParams.get("hero");
  const print = p.locator("[aria-label^='View ']").first();
  const box = await print.boundingBox();
  check(box && box.width <= 390, "the print fits the screen");
  const y = box.y + box.height / 2;
  await p.mouse.move(box.x + box.width * 0.8, y);
  await p.mouse.down();
  for (let i = 1; i <= 8; i++) await p.mouse.move(box.x + box.width * (0.8 - i * 0.07), y);
  await p.mouse.up();
  await p.waitForTimeout(600);
  const second = new URL(p.url()).searchParams.get("hero");
  check(second && second !== first, "a sideways swipe moves to the next look");
  await print.click();
  await p.waitForTimeout(700);
  check(await p.getByRole("dialog").count(), "a tap opens the look large");
  await button(p, "Zoom in").click();
  await p.waitForTimeout(300);
  await shot("viewer");
  await button(p, "Close").click();
  await p.waitForTimeout(500);
  check((await p.getByRole("dialog").count()) === 0 && new URL(p.url()).searchParams.get("hero") === second, "closing returns to the same look");
  await button(p, /^Save/).click();
  await p.waitForTimeout(700);
  check(((await lab(p)).looks ?? []).length === 1, "the look is saved");
  await p.goBack();
  await p.waitForTimeout(700);
  check(/moment\//.test(p.url()), "Back stays in the journey");
  const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
  check(!overflow, "no sideways scroll");
});

await scenario("S12", "Analytics: once each, stable ids, real actions only", "desktop", async (p) => {
  await toResults(p, A);
  await p.reload();
  await p.waitForTimeout(1200);
  await button(p, /^Save/).click();
  await p.waitForTimeout(600);
  const ev = await events(p);
  const names = ev.map((e) => e.eventName);
  const count = (n) => names.filter((x) => x === n).length;
  const rid = (await history(p))[0].response.recommendationId;
  check(ev.length > 0 && ev.every((e) => e.anonymousSessionId === ev[0].anonymousSessionId), "one anonymous id throughout");
  check(new Set(ev.map((e) => e.eventId)).size === ev.length, "every event id is unique");
  check(count("styling_submitted") === 1 && count("processing_completed") === 1, "one request, counted once, also after a reload");
  check(count("results_viewed") === 1, "results counted once per recommendation, also after a reload");
  check(count("look_saved") === 1, "one save, one event");
  check(ev.filter((e) => e.recommendationId || e.properties?.recommendationId).every((e) => (e.recommendationId ?? e.properties.recommendationId) === rid), "events carry the recommendation they belong to");
  check(!/data:|base64|blob:/.test(JSON.stringify(ev)), "no photo data in events");
  check(count("recommendation_rejected") === 0 && count("look_shared") === 0, "nothing recorded that did not happen");
});

/* ------------------------------------------------------------ accessibility */

const PAGES = [
  ["home", "/?mode=light"],
  ["question", "/moment/venue?mode=light&occasion=DINNER"],
  ["style-dna-photo", "/dna/face?mode=light"],
  ["your-data", "/data?mode=light"],
  ["saved-looks", "/looks?mode=light"],
];
/* The consultant review (2026-10-11): each fix, on desktop and phone. */
const progress = (p) => p.getByRole("navigation", { name: "Progress" }).filter({ visible: true }).first();
for (const device of ["desktop", "phone"]) {
  await scenario("UX1", "Every step shows in the progress and opens both ways, keeping the answers", device, async (p, shot) => {
    await toResults(p, A);
    await p.goto(`${BASE}/moment/time?${new URL(p.url()).searchParams}`);
    await p.waitForTimeout(700);
    const labels = (await progress(p).innerText()).replace(/\s+/g, " ").trim();
    check(/Occasion.*Place.*Time.*Feel.*Budget.*Looks/i.test(labels), `all six steps listed (${labels})`);
    await shot("progress");
    await progress(p).getByRole("link", { name: "Budget" }).click();
    await p.waitForURL(/moment\/spend/);
    check(/moment\/spend/.test(p.url()), "forward to Budget from Time");
    check(await p.getByRole("radio", { name: /\$300 to/ }).first().getAttribute("aria-checked") === "true", "the budget answer is still selected");
    await progress(p).getByRole("link", { name: "Place" }).click();
    await p.waitForURL(/moment\/venue/);
    check(/moment\/venue/.test(p.url()), "back to Place from Budget");
    await p.waitForTimeout(500);
    await p.getByRole("radio", { name: /Bar/ }).first().click();
    await p.waitForURL(/moment\/(build|results)/, { timeout: 8000 });
    const q = new URL(p.url()).searchParams;
    check(q.get("venue") === "BAR" && q.get("time") === "NIGHT" && q.get("vibe") === "SHARP" && q.get("spend"), "a new place goes straight to the looks with the rest kept");
    await p.waitForURL(/moment\/results/, { timeout: 15000 });
    if (device === "phone") {
      await button(p, /Restyle/).click();
      await p.waitForTimeout(400);
      await p.getByRole("radio", { name: /The time of day/ }).first().click();
    } else await progress(p).getByRole("link", { name: "Time" }).click();
    await p.waitForURL(/moment\/time/);
    check(await p.getByRole("radio", { name: /Early evening/ }).count() === 1, "Sunset now reads Early evening");
    await p.getByRole("radio", { name: /Early evening/ }).first().click();
    await p.waitForURL(/moment\/(build|results)/, { timeout: 8000 });
    check(new URL(p.url()).searchParams.get("time") === "SUNSET", "a new time goes straight to the looks");
  });

  await scenario("UX2", "Unticking a piece marks it and says the photo is the original look", device, async (p, shot) => {
    await toResults(p, A);
    check((await p.locator(".a-print-note").count()) === 0, "no note while every piece is in");
    await p.locator(".a-pick").filter({ visible: true }).first().click();
    await p.waitForTimeout(400);
    const note = p.locator(".a-print-note").filter({ visible: true });
    check((await note.count()) === 1 && /Original look, 1 piece not included/.test(await note.innerText()), "the print says it shows the original look, 1 piece out");
    check(/Not included/.test(await p.locator(".a-pick").filter({ visible: true }).first().innerText()), "the piece reads Not included");
    await shot("unticked");
    await p.locator(".a-pick").filter({ visible: true }).first().click();
    await p.waitForTimeout(300);
    check((await p.locator(".a-print-note").count()) === 0, "ticking it again clears the note");
  });

  await scenario("UX3", "Make it yours sits above the pieces as two described cards", device, async (p, shot) => {
    await toResults(p, A);
    const cards = p.locator(".a-personal-card").filter({ visible: true });
    check((await cards.count()) === 2, "two cards");
    const texts = (await cards.allInnerTexts()).join(" | ");
    check(/See it on me/.test(texts) && /Preview this look on you/.test(texts) && /Use something I own/.test(texts) && /piece you have/.test(texts), "each says what it does");
    const cardTop = (await cards.first().boundingBox()).y;
    const pieceTop = (await p.locator(".a-pick").filter({ visible: true }).first().boundingBox()).y;
    check(cardTop < pieceTop, "above the pieces");
    await cards.first().scrollIntoViewIfNeeded();
    await shot("make-it-yours");
    await cards.nth(1).click();
    await p.waitForURL(/moment\/you\/item/);
    await p.getByRole("radio", { name: "Top" }).first().click();
    await p.waitForTimeout(500);
    check((await p.getByRole("radio", { name: /Try it with an example/ }).count()) === 1, "the sample reads Try it with an example");
    check(/An example shows how I build the look/.test(await body(p)), "and says what the example is for");
    await shot("example");
  });

  await scenario("UX4", "Wording: budget, Restyle hint, smaller Feel hints and stylist note", device, async (p, shot) => {
    await p.goto(`${BASE}/moment/feel?mode=light&occasion=DINNER&venue=RESTAURANT&time=NIGHT`);
    await p.waitForTimeout(700);
    const sizes = await p.locator(".a-answers .a-control").filter({ visible: true }).first().evaluate((b) => {
      const h = b.querySelector(".hint");
      const r = b.getBoundingClientRect(), hr = h.getBoundingClientRect();
      return { label: parseFloat(getComputedStyle(b).fontSize), hint: parseFloat(getComputedStyle(h).fontSize), rightGap: r.right - hr.right };
    });
    check(sizes.hint <= 12 && sizes.label >= 18, `hint ${sizes.hint}px under name ${sizes.label}px`);
    const edges = await p.locator(".a-answers .a-control .hint").filter({ visible: true }).evaluateAll((hs) => hs.map((h) => Math.round(h.getBoundingClientRect().right)));
    check(new Set(edges).size === 1, `hints share one right edge (${edges.join(", ")})`);
    await shot("feel");
    await p.getByRole("radio", { name: /Sharp/ }).first().click();
    await p.waitForURL(/moment\/spend/);
    check(/budget for the whole look/i.test(await body(p)), "the budget question names the whole look");
    await toResults(p, A);
    check(parseFloat(await p.locator(".a-note").filter({ visible: true }).first().evaluate((n) => getComputedStyle(n).fontSize)) <= 16, "stylist note at 16px");
    const restyle = button(p, /Restyle/);
    check(/Change an answer/.test(await restyle.innerText()), "Restyle carries the hint Change an answer");
    const box = await restyle.boundingBox();
    check(box && box.x + box.width <= (await p.evaluate(() => innerWidth)) && box.height >= 44, "Restyle and its hint fit the row");
    await shot("results");
  });

  await scenario("UX5", "Sharing says what the friend sees; a friend's page has no Check out", device, async (p, shot) => {
    await toResults(p, A);
    await button(p, /^Share/).click();
    await p.waitForTimeout(500);
    const t = await body(p);
    check(/Anyone who taps it sees all three looks/.test(t) && /Sends a link to all three looks/.test(t) && /No account needed/.test(t), "each option says what is shared");
    await shot("share");
    await p.keyboard.press("Escape");
    const url = new URL(p.url());
    url.searchParams.set("via", "friend");
    await p.goto(url.toString());
    await p.waitForTimeout(1200);
    check((await p.getByRole("button", { name: /^Check out/ }).filter({ visible: true }).count()) === 0, "no Check out for the friend");
    check((await p.getByRole("button", { name: /^Share$/ }).filter({ visible: true }).count()) === 0, "no Share button for the friend");
    check((await button(p, /^Send to someone else$/).count()) === 1, "a quiet Send to someone else instead, saying what it does");
    check(/The look your friend sent/i.test(await body(p)), "the look they shared is named as the one they're asking about");
    check(/would like your opinion/.test(await body(p)), "the page says the friend wants an opinion, not a sale");
    check((await p.getByRole("link", { name: /Get your own looks/ }).filter({ visible: true }).count()) === 1, "Get your own looks leads");
    await shot("friend");
  });
}

/* The consultant's mobile review (2026-10-11), checked on desktop and phone. */
for (const device of ["desktop", "phone"]) {
  await scenario("UX6", "Sign in has no bare count and says why it is asked", device, async (p, shot) => {
    await p.goto(`${BASE}/?mode=light&gate=signin`);
    await p.waitForTimeout(900);
    const gate = p.locator(".a-gate");
    const text = await gate.innerText();
    check(!/\b\d+ of \d+\b/.test(text), "no 1 of 1");
    check(/save looks without an account/i.test(text), "says saving needs no account and what signing in does");
    await shot("signin");
    await toResults(p, A);
    await p.locator(".a-personal-card").filter({ visible: true }).first().click();
    await p.waitForTimeout(600);
    if ((await p.locator(".a-gate").getByText(/Sign in so I can remember you/).count()) === 0) await p.locator(".a-gate .a-primary").first().click();
    await p.waitForTimeout(600);
    const t2 = await p.locator(".a-gate").innerText();
    check(/Sign in, then Premium/i.test(t2) && /See it on me is part of Premium/.test(t2), "a two step gate says what follows and why");
  });

  await scenario("UX7", "Copy link confirms on the button for two seconds", device, async (p, shot) => {
    await p.context().grantPermissions(["clipboard-read", "clipboard-write"], { origin: BASE });
    await toResults(p, A);
    await button(p, /^Share/).click();
    await p.waitForTimeout(600);
    await button(p, /^Copy link$/).click();
    await p.waitForTimeout(300);
    check((await button(p, /^Copied/).count()) === 1, "the button reads Copied");
    await shot("copied");
    await p.waitForTimeout(2300);
    check((await button(p, /^Copy link$/).count()) === 1, "and returns to Copy link");
  });

  await scenario("UX8", "Empty Saved looks leads back to the looks just seen", device, async (p, shot) => {
    await toResults(p, A);
    const results = new URL(p.url()).searchParams;
    if (device === "phone") {
      await p.getByRole("button", { name: "Menu" }).click();
      await p.waitForTimeout(600);
    }
    await p.getByRole("link", { name: /Saved looks/ }).filter({ visible: true }).first().click();
    await p.waitForURL(/\/looks/);
    await p.waitForTimeout(600);
    check(/No saved looks yet/.test(await body(p)), "empty state shown");
    const back = p.getByRole("link", { name: "Back to your looks" }).filter({ visible: true });
    check((await back.count()) === 1, "Back to your looks offered");
    await shot("empty");
    await back.click();
    await p.waitForURL(/moment\/results/);
    const q = new URL(p.url()).searchParams;
    check(q.get("venue") === results.get("venue") && q.get("spend") === results.get("spend"), "back on the same looks");
    await p.goto(`${BASE}/looks?mode=light`);
    await p.waitForTimeout(600);
    check((await p.getByRole("link", { name: "Back to your looks" }).count()) === 0, "a fresh visit offers Start a new look only");
  });
}

await scenario("UX9", "Phone menu reads as one list", "phone", async (p, shot) => {
  await p.goto(`${BASE}/?mode=light`);
  await p.getByRole("button", { name: "Menu" }).click();
  await p.waitForTimeout(700);
  const size = await p.getByRole("link", { name: "Start a new look" }).first().evaluate((e) => parseFloat(getComputedStyle(e).fontSize));
  const sign = await p.getByRole("dialog", { name: "Menu" }).getByRole("button", { name: "Sign in" }).evaluate((e) => ({ size: parseFloat(getComputedStyle(e).fontSize), color: getComputedStyle(e).color, text: getComputedStyle(document.querySelector("[data-concept]")).getPropertyValue("--text").trim() }));
  check(size <= 26, `menu items at ${size}px`);
  check(sign.size >= 16, `Sign in at ${sign.size}px`);
  await shot("menu");
});

await scenario("UX10", "Phone results: the title shows on the first screen", "phone", async (p, shot) => {
  await toResults(p, A);
  const vh = await p.evaluate(() => innerHeight);
  const canvas = await p.locator(".a-canvas").first().boundingBox();
  const title = await p.locator("h1.a-display").filter({ visible: true }).first().boundingBox();
  check(canvas.height <= vh * 0.45, `print band ${Math.round(canvas.height)}px of ${vh}`);
  check(title.y + title.height < vh - 120, "title above the action row without scrolling");
  await shot("results");
});

/* Why this look is a real disclosure after the pieces: folded at first on every screen; the reasons
   truly fold away and leave the tab order; mouse and keyboard both work; the choice holds across looks. */
for (const device of ["desktop", "phone"]) {
  await scenario("WHY1", "Why this look opens and closes for real", device, async (p, shot) => {
    await toResults(p, A);
    const toggle = button(p, /Why this look/);
    const fold = p.locator(".a-why-fold");
    const expanded = async () => (await toggle.getAttribute("aria-expanded")) === "true";
    const shown = () => fold.evaluate((el) => !el.hidden && getComputedStyle(el).display !== "none" && el.getBoundingClientRect().height > 40);
    const nextTop = () => p.evaluate(() => document.querySelector(".a-why").nextElementSibling.getBoundingClientRect().top);
    check((await toggle.getAttribute("aria-controls")) === (await fold.getAttribute("id")), "the header button names the reasons it controls");
    check(!(await expanded()) && !(await shown()), `folded at first on ${device}`);
    const pieces = await p.locator('[aria-label="Pieces"]').filter({ visible: true }).first().boundingBox();
    const header = await toggle.boundingBox();
    check(pieces && header && header.y > pieces.y, "after the pieces and their total");
    await toggle.click();
    await p.waitForTimeout(450);
    check((await expanded()) && (await shown()), "a tap opens it");
    check(await p.getByText("Dinner, Restaurant").filter({ visible: true }).count() > 0, "three groups: occasion and setting first");
    const openNext = await nextTop();
    await toggle.click();
    await p.waitForTimeout(450);
    check(!(await expanded()) && !(await shown()), "a click closes it: the reasons are gone, not just the arrow");
    check((await nextTop()) < openNext - 80, "what follows moves up");
    check(!(await p.getByText("Dinner, Restaurant").isVisible()), "folded reasons can't be seen or reached");
    await toggle.focus();
    await p.keyboard.press("Enter");
    await p.waitForTimeout(450);
    check((await expanded()) && (await shown()), "Enter opens it");
    check(await toggle.evaluate((el) => el.matches(":focus-visible") && getComputedStyle(el).boxShadow !== "none"), "the focus ring shows");
    const bottom = await fold.evaluate((el) => el.getBoundingClientRect().bottom);
    check(bottom <= (await nextTop()) + 1, "the open reasons overlap nothing");
    await p.keyboard.press(" ");
    await p.waitForTimeout(450);
    check(!(await expanded()) && !(await shown()), "Space closes it");
    await p.keyboard.press(" ");
    await p.waitForTimeout(450);
    await p.locator(".a-thumb").filter({ visible: true }).nth(1).click();
    await p.waitForTimeout(900);
    check((await expanded()) && (await shown()), "open stays open on the next look");
    check(await p.getByText(/The classic option/).filter({ visible: true }).count() > 0, "and gives that look's reasons");
    await button(p, /Why this look/).click();
    await p.waitForTimeout(450);
    await p.locator(".a-thumb").filter({ visible: true }).nth(2).click();
    await p.waitForTimeout(900);
    check(!(await expanded()) && !(await shown()), "folded stays folded on the next look");
    await button(p, /Why this look/).click();
    await p.waitForTimeout(450);
    check(await p.getByText(/The easier option/).filter({ visible: true }).count() > 0, "opening it there gives the new look's reasons");
    await shot("why-open");
  });
}

await scenario("WHY2", "Why this look folds at once with reduced motion", "desktop", async (p) => {
  await toResults(p, A);
  await button(p, /Why this look/).click();
  await p.waitForTimeout(60);
  await button(p, /Why this look/).click();
  await p.waitForTimeout(60);
  check(await p.locator(".a-why-fold").evaluate((el) => el.hidden && getComputedStyle(el).display === "none"), "folded without animating");
}, { reducedMotion: "reduce" });

/* The bar never sits over the look's photo: at every width, for all three looks. */
for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 800], [1024, 768], [768, 1024], [390, 844], [375, 667]]) {
  await scenario("FACE1", `The bar stays clear of the photo at ${w} px`, w < 1024 ? "phone" : "desktop", async (p, shot) => {
    await toResults(p, A);
    const thumbs = p.locator(".a-thumb").filter({ visible: true });
    for (let i = 0; i < 3; i += 1) {
      await thumbs.nth(i).click();
      await p.waitForTimeout(700);
      const [bar, print] = await p.evaluate(() => [document.querySelector("header").getBoundingClientRect().bottom, [...document.querySelectorAll(".a-frame")].map((el) => el.getBoundingClientRect()).find((r) => r.width > 0).top]);
      check(print >= bar, `look ${i + 1}: photo starts at ${Math.round(print)} px, under the bar's ${Math.round(bar)} px`);
    }
    await shot("results");
  }, { viewport: { viewport: { width: w, height: h }, ...(w < 1024 ? { isMobile: true, hasTouch: true } : {}) } });
}

/*
 * Image safe: on every page with a model photo, at the eight widths of the brief, the bar never covers a
 * photo at rest; a photo that scrolls under it passes under an opaque bar; a resized window and every look
 * keep it so; and a picture of any shape (a made picture can come back wide or tall) is never cut at the
 * head or the shoes.
 */
const FACE_PAGES = ["/?mode=light", "/moment/venue?mode=light&occasion=DINNER", "/moment/time?mode=light&occasion=DINNER&venue=RESTAURANT", "/moment/you?mode=light&occasion=DINNER&venue=RESTAURANT&time=NIGHT&vibe=SHARP&budget=MID", "/moment/tryon?mode=light&occasion=DINNER&venue=RESTAURANT&time=NIGHT&vibe=SHARP&hero=dinner_sharper_01", "/dna?mode=light"];
const faceMeasure = () => {
  const bars = [...document.querySelectorAll("header, .a-topright")].filter((e) => {
    const s = getComputedStyle(e);
    return ["fixed", "sticky", "absolute"].includes(s.position) && e.getBoundingClientRect().height > 0;
  });
  const photos = [...document.querySelectorAll("img, video")].filter((i) => {
    const r = i.getBoundingClientRect();
    return r.width > 150 && r.height > 150 && r.bottom > 0 && r.top < innerHeight && !i.classList.contains("a-frame-fill") && getComputedStyle(i).visibility !== "hidden" && !i.closest("[role=dialog]");
  });
  const opaque = (el) => {
    for (let e = el; e && e !== document.body; e = e.parentElement) {
      const m = /rgba?\(([^)]+)\)/.exec(getComputedStyle(e).backgroundColor);
      const a = m ? (m[1].split(",")[3] === undefined ? 1 : Number(m[1].split(",")[3])) : 0;
      if (a >= 0.99) return true;
    }
    return false;
  };
  const over = [];
  for (const b of bars) {
    const a = b.getBoundingClientRect();
    for (const i of photos) {
      const r = i.getBoundingClientRect();
      const ox = Math.min(a.right, r.right) - Math.max(a.left, r.left);
      const oy = Math.min(a.bottom, r.bottom) - Math.max(a.top, r.top);
      if (ox > 1 && oy > 1) over.push({ photo: (i.currentSrc || i.src || "").split("/").pop().slice(0, 40), by: Math.round(oy), opaque: opaque(b) });
    }
  }
  const cut = [...document.querySelectorAll(".a-frame img[data-print]")]
    .filter((i) => i.naturalWidth && i.getBoundingClientRect().width > 0)
    .filter((i) => {
      const r = i.getBoundingClientRect();
      const fit = getComputedStyle(i).objectFit;
      return fit === "cover" && r.width / r.height > (i.naturalWidth / i.naturalHeight) * 1.03;
    })
    .map((i) => i.getAttribute("src"));
  return { over, cut };
};
const WIDE = await (await import("sharp")).default({ create: { width: 1600, height: 800, channels: 3, background: "#8a7a66" } }).jpeg().toBuffer();
const TALL = await (await import("sharp")).default({ create: { width: 600, height: 1500, channels: 3, background: "#5a4a3a" } }).jpeg().toBuffer();
for (const [w, h] of [[375, 667], [390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900], [1920, 1080]]) {
  await scenario("FACE2", `Image safe at ${w} px: every page, scrolled, resized, every look, any picture shape`, w < 1024 ? "phone" : "desktop", async (p, shot) => {
    let scrolled = false;
    const look = async (where) => {
      const m = await p.evaluate(faceMeasure);
      // At rest nothing may sit over a photo; scrolled, a photo may pass under the bar only if the bar is opaque.
      const atRest = m.over.filter((o) => !scrolled || !o.opaque);
      check(atRest.length === 0, `${where}: the bar covers no photo${atRest.length ? ` (${atRest.map((o) => `${o.photo} by ${o.by}px`).join(", ")})` : ""}`);
      check(m.cut.length === 0, `${where}: no photo cut at the head or shoes${m.cut.length ? ` (${m.cut.join(", ")})` : ""}`);
    };
    for (const url of FACE_PAGES) {
      await p.goto(`${BASE}${url}`);
      await p.waitForTimeout(1100);
      const name = new URL(url, BASE).pathname;
      scrolled = false;
      await look(`${name} at rest`);
      await p.evaluate(() => window.scrollTo(0, 500));
      await p.waitForTimeout(300);
      scrolled = true;
      await look(`${name} scrolled`);
      await p.evaluate(() => window.scrollTo(0, 0));
      await p.waitForTimeout(300);
    }
    await toResults(p, A);
    const thumbs = p.locator(".a-thumb").filter({ visible: true });
    for (let i = 0; i < 3; i += 1) {
      await thumbs.nth(i).click();
      await p.waitForTimeout(700);
      scrolled = false;
      await look(`results, look ${i + 1}`);
    }
    await p.evaluate(() => window.scrollTo(0, 600));
    await p.waitForTimeout(300);
    scrolled = true;
    await look("results scrolled");
    await p.evaluate(() => window.scrollTo(0, 0));
    scrolled = false;
    const resized = w >= 1024 ? [w === 1920 ? 1280 : 1920, w === 1920 ? 720 : 1080] : [w === 430 ? 375 : 430, w === 430 ? 667 : 932];
    await p.setViewportSize({ width: resized[0], height: resized[1] });
    await p.waitForTimeout(600);
    await look(`results resized to ${resized[0]} px`);
    await p.setViewportSize({ width: w, height: h });
    await p.waitForTimeout(600);
    await look(`results back at ${w} px`);
    await shot("results");

    // A wide and a tall picture in place of two looks' photographs, as a made picture might come back.
    await p.route("**/images/dinner_sharper_01.jpg", (r) => r.fulfill({ status: 200, contentType: "image/jpeg", body: WIDE }));
    await p.route("**/images/dinner_safest_01.jpg", (r) => r.fulfill({ status: 200, contentType: "image/jpeg", body: TALL }));
    await p.reload();
    await p.waitForTimeout(1200);
    for (let i = 0; i < 2; i += 1) {
      await thumbs.nth(i).click();
      await p.waitForTimeout(800);
      await look(`a ${i ? "tall" : "wide"} picture`);
      const fit = await p.evaluate(() => [...document.querySelectorAll(".a-frame")].find((f) => f.getBoundingClientRect().width > 0)?.getAttribute("data-fit"));
      // A wide picture fills the frame with its sides trimmed; a tall one narrower than the frame is shown whole.
      if (i === 1) check(fit === "contain", `the tall picture is shown whole, head to shoes (${fit})`);
    }
    await shot("wide-tall");
  }, { premium: true, viewport: { viewport: { width: w, height: h }, ...(w < 1024 ? { isMobile: true, hasTouch: true } : {}) } });
}

for (const device of ["desktop", "phone"]) {
  await scenario("NAV", "Every way back to the occasion lands on home", device, async (p) => {
    const onHome = async () => (await p.locator(".a-cards").count()) > 0;
    await p.goto(`${BASE}/?mode=light`);
    await p.getByRole("radio", { name: "Dinner" }).first().click();
    await p.waitForURL(/moment\/venue/);
    await p.waitForTimeout(600);
    await button(p, /back/i).click();
    await p.waitForTimeout(800);
    check(await onHome(), "back from the first question opens home");
    check((await p.locator('.a-card[aria-checked="true"]').innerText().catch(() => "")).includes("Dinner"), "home shows the occasion already chosen");
    for (const path of ["/moment/occasion", "/moment", "/moment/results", "/moment/build", "/moment/tryon", "/nowhere"]) {
      await p.goto(`${BASE}${path}?mode=light`);
      await p.waitForTimeout(500);
      check(new URL(p.url()).pathname === "/" && (await onHome()), `${path} opens home`);
    }
    await toResults(p, A);
    await button(p, /^Restyle/).click();
    await p.waitForTimeout(400);
    await p.getByRole("radio", { name: /The occasion/ }).first().click();
    await p.waitForTimeout(800);
    check(await onHome(), "Restyle, the occasion, opens home");
    await p.getByRole("radio", { name: "Party" }).first().click();
    await p.waitForURL(/moment\/venue/);
    await p.waitForTimeout(600);
    await p.getByRole("radio").first().click();
    await p.waitForURL(/moment\/(build|results)/, { timeout: 8000 });
    const q = new URL(p.url()).searchParams;
    check(q.get("occasion") === "PARTY" && q.get("vibe") === "SHARP", "a new occasion keeps the feel and goes back to the looks");
  });
}
for (const device of ["desktop", "phone"]) {
  await scenario("A11Y", "No serious or critical accessibility problems (axe)", device, async (p) => {
    const run = async (name) => {
      await p.addScriptTag({ content: AXE });
      const r = await p.evaluate(async () => {
        // eslint-disable-next-line no-undef
        const res = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"] } });
        return res.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${v.id} (${v.nodes.length}): ${v.nodes[0]?.target}`);
      });
      check(r.length === 0, `${name}: ${r.length ? r.join("; ") : "clean"}`);
    };
    for (const [name, path] of PAGES) {
      await p.goto(BASE + path);
      await p.waitForTimeout(900);
      await run(name);
    }
    await toResults(p, A);
    await run("results");
    await button(p, /Check out/).click();
    await p.waitForTimeout(600);
    await run("check-out");
  });

  await scenario("LAYOUT", "Controls are at least 44px and nothing scrolls sideways", device, async (p) => {
    for (const path of ["/?mode=light", "/moment/venue?mode=light&occasion=DINNER", "/dna/face?mode=light", "/data?mode=light"]) {
      await p.goto(BASE + path);
      await p.waitForTimeout(800);
      const small = await p.evaluate(() =>
        [...document.querySelectorAll("button, a[href], [role=radio], [role=checkbox], input[type=checkbox]")]
          .filter((el) => {
            const r = el.getBoundingClientRect();
            const s = getComputedStyle(el);
            return r.width > 0 && r.height > 0 && s.visibility !== "hidden" && !el.closest("[aria-hidden=true]") && !el.classList.contains("sr-only");
          })
          .filter((el) => {
            const r = el.getBoundingClientRect();
            return r.height < 43.5 && r.width < 43.5;
          })
          .map((el) => (el.getAttribute("aria-label") || el.textContent || el.tagName).trim().slice(0, 30)),
      );
      check(small.length === 0, `${path}: ${small.length ? `small targets: ${small.join(", ")}` : "targets 44px or more"}`);
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check(!overflow, `${path}: no sideways scroll`);
    }
  });
}

/* ------------------------------------------------------------ performance */

/* ------------------------------------------------------------ occasion photos */

const OCC = ["dinner", "work", "date", "wedding", "party"];
const cardPhotos = (p) => p.locator(".a-cards img").evaluateAll((imgs) => imgs.map((i) => ({ photo: i.dataset.photo, src: i.currentSrc, ok: i.complete && i.naturalWidth > 0 })));
const settled = (p) => p.waitForFunction(() => [...document.querySelectorAll(".a-cards img")].every((i) => i.complete && i.naturalWidth > 0), null, { timeout: 8000 });

for (const device of ["desktop", "phone"]) {
  for (const [label, ip, locale] of [["Lebanon", "5.8.128.1", "ar-LB"], ["Poland", "2.16.126.1", "pl-PL"], ["an unknown place", "10.1.2.3", undefined]]) {
    await scenario("PHOTOS", `A visitor from ${label} sees the same five photos as everyone`, device, async (p) => {
      const imageRequests = [];
      p.on("request", (r) => r.url().includes("/images/") && imageRequests.push(new URL(r.url()).pathname));
      await p.goto(`${BASE}/?mode=light&photos=PL`);
      await settled(p);
      const photos = await cardPhotos(p);
      check(photos.length === 5 && photos.every((x, i) => x.ok && x.photo === `/images/home/${OCC[i]}`), "the five home photos, none broken");
      check(!imageRequests.some((u) => u.includes("/images/occasions/")), "no country photos are asked for");
      check((await p.locator('meta[name="praxis-country"]').count()) === 0, "no country written into the page");
      check((await p.locator(".a-home-location, .a-photos-from, .a-card-place").count()) === 0, "no location line, picker or place captions");
      check(!(await events(p)).some((e) => e.eventName.startsWith("country_")), "no country events");
      await p.getByRole("radio", { name: "Dinner" }).first().click();
      await p.waitForURL(/\/moment\/venue/);
      check(/occasion=DINNER/.test(p.url()), "Dinner starts the usual journey");
    }, { ip, locale });
  }

  await scenario("PHOTOS-SLOW", "With photos slow or failing, the cards keep their size and still work", device, async (p) => {
    await p.route("**/images/**", (r) => r.abort());
    await p.goto(`${BASE}/?mode=light`);
    await p.waitForTimeout(800);
    const boxes = await p.locator(".a-card").evaluateAll((cs) => cs.map((c) => Math.round(c.getBoundingClientRect().height)));
    check(boxes.length === 5 && boxes.every((h) => h > 100), `five cards at full height without photos (${boxes.join(", ")})`);
    await p.getByRole("radio", { name: "Party" }).first().click();
    await p.waitForURL(/\/moment\/venue/);
    check(/occasion=PARTY/.test(p.url()), "Party still starts the journey");
  }, { missingFiles: true });
}

const perf = [];
for (const device of ["desktop", "phone"]) {
  await scenario("PERF", "Home loads quickly", device, async (p) => {
    const cdp = await p.context().newCDPSession(p);
    await cdp.send("Network.enable");
    if (device === "phone") await cdp.send("Network.emulateNetworkConditions", { offline: false, latency: 150, downloadThroughput: (1.6 * 1024 * 1024) / 8, uploadThroughput: (750 * 1024) / 8 });
    let bytes = 0;
    cdp.on("Network.loadingFinished", (e) => (bytes += e.encodedDataLength));
    await p.goto(`${BASE}/?mode=light`, { waitUntil: "load" });
    await p.waitForTimeout(1500);
    const m = await p.evaluate(
      () =>
        new Promise((resolve) => {
          const nav = performance.getEntriesByType("navigation")[0];
          new PerformanceObserver((list) => {
            const e = list.getEntries();
            resolve({ lcp: Math.round(e[e.length - 1].startTime), dcl: Math.round(nav.domContentLoadedEventEnd), load: Math.round(nav.loadEventEnd) });
          }).observe({ type: "largest-contentful-paint", buffered: true });
        }),
    );
    const cls = await p.evaluate(() => performance.getEntriesByType("layout-shift").reduce((s, e) => s + (e.hadRecentInput ? 0 : e.value), 0));
    perf.push({ device, ...m, cls: Number(cls.toFixed(3)), kb: Math.round(bytes / 1024) });
    const budget = device === "phone" ? 4000 : 2500;
    check(m.lcp <= budget, `largest paint ${m.lcp} ms (budget ${budget} ms${device === "phone" ? ", slow 4G" : ""})`);
    check(cls <= 0.1, `layout shift ${cls.toFixed(3)} (budget 0.1)`);
  });
}


/* ------------------------------------------------- Stage 1: a shared device */

const SIZES = {
  375: { viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
  390: PHONE,
  430: { viewport: { width: 430, height: 932 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3 },
  768: { viewport: { width: 768, height: 1024 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 },
};

/** Opens the menu when the bar keeps its items there (phones), then clicks the named control. */
async function menuClick(p, name) {
  if (!(await p.getByRole("button", { name }).filter({ visible: true }).count()) && !(await p.getByRole("link", { name }).filter({ visible: true }).count())) {
    await p.getByRole("button", { name: /Menu|open menu/ }).filter({ visible: true }).first().click();
    await p.waitForTimeout(400);
  }
  const target = p.getByRole("button", { name }).filter({ visible: true });
  if (await target.count()) await target.first().click();
  else await p.getByRole("link", { name }).filter({ visible: true }).first().click();
}

async function signInWith(p, provider) {
  await menuClick(p, /^Sign in$/);
  await p.waitForTimeout(500);
  await button(p, provider).click();
  await p.waitForTimeout(1300);
}

for (const device of ["desktop", "phone"]) {
  await scenario("ISO1", "After sign out, the next person sees none of the last person's looks or Style DNA", device, async (p, shot) => {
    await toResults(p, A);
    await signInWith(p, /Apple/);
    await button(p, /^Save/).click();
    await p.waitForTimeout(800);
    check(((await lab(p)).looks ?? []).length === 1, "the Apple account saved a look");
    await p.goto(`${BASE}/looks?mode=light`);
    await p.waitForTimeout(600);
    await menuClick(p, /Sign out/);
    await p.waitForTimeout(800);
    await p.goto(`${BASE}/looks?mode=light`);
    await p.waitForTimeout(800);
    const t = await body(p);
    check(/No saved looks yet/.test(t), "a new guest sees no saved looks");
    check(((await lab(p)).looks ?? []).length === 1, "the account's look is still kept on the device");
    await signInWith(p, /Google/);
    await p.goto(`${BASE}/looks?mode=light`);
    await p.waitForTimeout(800);
    check(/No saved looks yet/.test(await body(p)), "another account does not see it");
    await shot("other-account");
    await menuClick(p, /Sign out/);
    await p.waitForTimeout(600);
    await signInWith(p, /Apple/);
    await p.goto(`${BASE}/looks?mode=light`);
    await p.waitForTimeout(800);
    check(!/No saved looks yet/.test(await body(p)), "the Apple account sees its look again");
  });

  await scenario("ISO2", "Premium belongs to the account that paid, not to the device", device, async (p) => {
    await p.goto(`${BASE}/?mode=light`);
    await p.waitForTimeout(500);
    const premium = await p.evaluate(() => JSON.parse(localStorage.getItem("praxis_lab_a_premium") || "{}"));
    const user = await p.evaluate(() => JSON.parse(localStorage.getItem("praxis_lab_a_user") || "null"));
    check(user?.premium === true && premium[user.id] === true, "the seeded account has Premium");
    await menuClick(p, /Sign out/);
    await p.waitForTimeout(600);
    await signInWith(p, /Google/);
    const next = await p.evaluate(() => JSON.parse(localStorage.getItem("praxis_lab_a_user") || "null"));
    check(next && next.email === "google-account@praxis.app" && next.premium === false, "a different account starts without Premium");
    await p.goto(`${BASE}/dna/face?mode=light`);
    await p.waitForTimeout(800);
    check(new URL(p.url()).pathname === "/" && new URL(p.url()).searchParams.get("gate") === "dna", "Style DNA by address leads to its introduction");
  }, { premium: true });

  await scenario("ISO3", "Email sign in needs a real address", device, async (p) => {
    await p.goto(`${BASE}/?mode=light`);
    await menuClick(p, /^Sign in$/);
    await p.waitForTimeout(500);
    await button(p, /Continue with email/).click();
    await p.waitForTimeout(300);
    check(/Enter your email/.test(await body(p)), "an empty address is refused with a reason");
    await p.locator("#gate-email").fill("sam@");
    await button(p, /Continue with email/).click();
    await p.waitForTimeout(300);
    check(/looks incomplete/.test(await body(p)), "an incomplete address is refused");
    await p.locator("#gate-email").fill("sam.lee@example.com");
    await button(p, /Continue with email/).click();
    await p.waitForTimeout(1300);
    const u = await p.evaluate(() => JSON.parse(localStorage.getItem("praxis_lab_a_user") || "null"));
    check(u?.email === "sam.lee@example.com" && u?.name === "Sam", "signed in with that address and its name");
  });

  await scenario("DATA1", "Deleting everything on Your data leaves nothing behind", device, async (p) => {
    await toResults(p, A);
    await button(p, /^Save/).click();
    await p.waitForTimeout(800);
    await p.goto(`${BASE}/data?mode=light`);
    await p.waitForTimeout(600);
    await button(p, /Delete everything/).click();
    await p.waitForTimeout(400);
    const confirm = p.getByRole("button", { name: /Delete everything|Yes, delete/ }).filter({ visible: true });
    if (await confirm.count()) await confirm.last().click();
    await p.waitForTimeout(1500);
    const left = await p.evaluate(() => Object.keys(localStorage).filter((k) => k.startsWith("praxis_") && !["praxis_anon", "praxis_events", "praxis_visit"].includes(k)));
    check(!left.includes("praxis_lab_a") && !left.includes("praxis_styling_history") && !left.includes("praxis_feedback"), `saved looks, requests and feedback are gone (left: ${left.join(", ") || "none"})`);
    check(!(await p.evaluate(() => Object.keys(sessionStorage).some((k) => k.includes("face") || k.includes("tryon")))), "no photos left in the tab");
  });

  await scenario("FULL1", "A save that cannot be written says so and shows nothing as saved", device, async (p, shot) => {
    await p.addInitScript(() => {
      const set = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (k === "praxis_lab_a") throw new DOMException("QuotaExceededError", "QuotaExceededError");
        return set.call(this, k, v);
      };
    });
    await toResults(p, A);
    await button(p, /^Save/).click();
    await p.waitForTimeout(600);
    check(/couldn’t save this look/.test(await body(p)), "the customer is told the save failed");
    check(!new URL(p.url()).searchParams.get("done"), "nothing says it was saved");
    check((await events(p)).some((e) => e.eventName === "look_save_failed"), "the failure is recorded");
    await shot("save-failed");
  });

  await scenario("TABS1", "Saving in two tabs keeps both looks", device, async (p) => {
    await toResults(p, A);
    const url = new URL(p.url());
    const second = await p.context().newPage();
    url.searchParams.set("hero", (await history(p))[0].response.outfits[1].outfitId);
    await second.goto(url.toString());
    await second.waitForTimeout(1200);
    await button(p, /^Save/).click();
    await p.waitForTimeout(600);
    await button(second, /^Save/).click();
    await second.waitForTimeout(600);
    const looks = (await lab(p)).looks ?? [];
    check(looks.length === 2, `both looks kept (${looks.length})`);
    await p.goto(`${BASE}/looks?mode=light`);
    await p.waitForTimeout(800);
    check((await p.locator('a.a-rail-card').count()) >= 2, `the first tab lists both (${await p.locator('a.a-rail-card').count()})`);
    await second.close();
  });

  await scenario("SAVE2", "Saving the same look twice keeps one copy", device, async (p) => {
    await toResults(p, A);
    await button(p, /^Save/).click();
    await p.waitForTimeout(600);
    await p.goto(p.url().replace(/([?&])done=saved&?/, "$1"));
    await p.waitForTimeout(1000);
    const save = p.getByRole("button", { name: /^Save$/ }).filter({ visible: true });
    if (await save.count()) await save.first().click({ force: true });
    await p.waitForTimeout(600);
    check(((await lab(p)).looks ?? []).length === 1, "one copy");
  });

  await scenario("PARAMS1", "Broken or tampered addresses land somewhere useful, without errors", device, async (p) => {
    for (const path of ["/moment/results?occasion=NOPE&venue=%3Cscript%3E", "/moment/tryon?occasion=DINNER&hero=nope", "/looks/does-not-exist", "/dna/result", "/moment/results?occasion=DINNER&venue=RESTAURANT&time=NIGHT&vibe=SHARP&spend=ELEVATED&hero=%22%3E%3Cimg"]) {
      await p.goto(`${BASE}${path}`);
      await p.waitForTimeout(1200);
      const t = await body(p);
      check(t.trim().length > 40 && !/Something went wrong on my side/.test(t), `${path.split("?")[0]} shows a working page`);
    }
  });
}

/** A real portrait (the Style DNA photo on home), redrawn in the page as a JPEG file to upload. */
async function portraitFile(p) {
  const b64 = await p.evaluate(async () => {
    const img = new Image();
    img.src = "/images/home/style-dna-phone-1200.webp";
    await img.decode();
    const c = document.createElement("canvas");
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    c.getContext("2d").drawImage(img, 0, 0);
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  });
  return { name: "me.jpg", mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") };
}

/** A shirt shape in one colour on a pale ground, as a wardrobe photo. */
async function garmentFile(p, colour = "#202a4a") {
  const b64 = await p.evaluate((colour) => {
    const c = document.createElement("canvas");
    c.width = 800;
    c.height = 800;
    const g = c.getContext("2d");
    g.fillStyle = "#f2f0ea";
    g.fillRect(0, 0, 800, 800);
    g.fillStyle = colour;
    g.beginPath();
    [[260, 100], [540, 100], [700, 260], [610, 330], [570, 290], [570, 720], [230, 720], [230, 290], [190, 330], [100, 260]].forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
    g.closePath();
    g.fill();
    return c.toDataURL("image/jpeg", 0.9).split(",")[1];
  }, colour);
  return { name: "shirt.jpg", mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") };
}

/* ------------------------------------------------- See it on me */

/** A plain photo of the right size, drawn in the page, as a file to upload. */
async function photoFile(p, { width = 720, height = 960, shade = "#9a8f80" } = {}) {
  const b64 = await p.evaluate(
    ({ width, height, shade }) => {
      const c = document.createElement("canvas");
      c.width = width;
      c.height = height;
      const g = c.getContext("2d");
      g.fillStyle = shade;
      g.fillRect(0, 0, width, height);
      g.fillStyle = "#5b4a3a";
      g.fillRect(width * 0.35, height * 0.15, width * 0.3, height * 0.75);
      return c.toDataURL("image/jpeg", 0.9).split(",")[1];
    },
    { width, height, shade },
  );
  return { name: "me.jpg", mimeType: "image/jpeg", buffer: Buffer.from(b64, "base64") };
}

async function openTryOn(p) {
  await toResults(p, A);
  const hero = new URL(p.url()).searchParams.get("hero") ?? (await history(p))[0].response.outfits[0].outfitId;
  await button(p, /See it on me/).click();
  await p.waitForURL(/moment\/tryon/, { timeout: 8000 });
  await p.waitForTimeout(500);
  return hero;
}

const step = (p) => p.locator("[data-tryon-step]").getAttribute("data-tryon-step");

for (const size of [375, 390, 430, 768]) {
  const device = `phone-${size}`;
  await scenario(
    "TRY1",
    "See it on me, start to finish, with an uploaded photo",
    device,
    async (p, shot) => {
      const hero = await openTryOn(p);
      check((await step(p)) === "explain", "starts with what try-on is");
      check(/See this look on you/.test(await body(p)) && /isn’t switched on yet/.test(await body(p)), "says plainly that try-on is not switched on");
      await shot("explain");
      await button(p, "Continue").click();
      await p.waitForTimeout(300);
      check((await step(p)) === "consent", "asks for consent next");
      const t = await body(p);
      check(/stays on this device/i.test(t) && /Kept in this browser tab only/.test(t) && /Retake deletes|with Retake/.test(t), "says where the photo goes, how long it is kept and how to delete it");
      await shot("consent");
      await button(p, "I agree").click();
      await p.waitForTimeout(300);
      check((await step(p)) === "capture", "then the camera or an upload");
      check(!/Use a sample/.test(await body(p)), "no sample stands in for the customer");
      await shot("capture");
      const chooser = p.waitForEvent("filechooser");
      await p.getByRole("radio", { name: /Upload a photo/ }).first().click();
      await (await chooser).setFiles(await photoFile(p));
      await p.waitForFunction(() => document.querySelector("[data-tryon-step]")?.getAttribute("data-tryon-step") === "preview", null, { timeout: 8000 });
      check(/Is this photo right/.test(await body(p)), "shows the photo back to keep or retake");
      await shot("preview");
      await button(p, "Use this photo").click();
      await p.waitForTimeout(200);
      check(/Sending your try-on/.test(await body(p)) && (await button(p, "Stop").count()) > 0, "a working state that can be stopped");
      check(!/\d+\s?%/.test(await body(p)), "no made-up progress");
      await p.waitForFunction(() => document.querySelector("[data-tryon-step]")?.getAttribute("data-tryon-step") === "result", null, { timeout: 8000 });
      check(/Try-on isn’t switched on yet/.test(await body(p)) && /Nothing was made to look like you/.test(await body(p)), "the answer is honest");
      await shot("result");
      const record = await p.evaluate(() => JSON.parse(sessionStorage.getItem("praxis_tryon_request") || "null"));
      check(record?.request?.outfitId === hero, `the request is for the look chosen (${record?.request?.outfitId} vs ${hero})`);
      check(record?.request?.garmentIds?.length >= 3 && record.request.recommendationId && record.request.person.consentVersion, "the request names the pieces, the set and the consent");
      check(record?.outcome?.status === "not_connected" && record.outcome.provider === "mock-try-on", "the stand-in service answered");
      check(!JSON.stringify(record).includes("data:image"), "the request record holds no photo");
      check(!(await p.evaluate(() => Object.values(localStorage).some((v) => v.includes("data:image")))), "no photo on the device");
      check(!(await events(p)).some((e) => JSON.stringify(e).includes("data:image")), "no photo in analytics");
      const names = (await events(p)).map((e) => e.eventName);
      check(["tryon_opened", "tryon_photo_ready", "tryon_submitted", "tryon_answered"].every((n) => names.includes(n)), "each step is counted");
      const overflow = await p.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
      check(!overflow, "nothing runs off the side");
      await button(p, "Use another photo").click();
      await p.waitForTimeout(300);
      check((await step(p)) === "capture" && !(await p.evaluate(() => sessionStorage.getItem("praxis_tryon_photo"))), "Use another photo deletes the photo and asks again");
      await p.getByRole("link", { name: "Back to your looks" }).filter({ visible: true }).first().click();
      await p.waitForURL(/moment\/results/, { timeout: 5000 });
      check(new URL(p.url()).searchParams.get("hero") === hero || !new URL(p.url()).searchParams.get("hero"), "back on the same look");
    },
    { premium: true, viewport: SIZES[size] },
  );
}

await scenario(
  "TRY2",
  "A photo that fails the checks is refused with the reason, and a good one goes through",
  "phone",
  async (p, shot) => {
    await openTryOn(p);
    await button(p, "Continue").click();
    await button(p, "I agree").click();
    let chooser = p.waitForEvent("filechooser");
    await p.getByRole("radio", { name: /Upload a photo/ }).first().click();
    await (await chooser).setFiles(await photoFile(p, { shade: "#050505" }));
    await p.waitForTimeout(1200);
    check(/too dark for me to see you/.test(await body(p)), "a dark photo is refused, saying why");
    chooser = p.waitForEvent("filechooser");
    await p.getByRole("radio", { name: /Upload a photo/ }).first().click();
    await (await chooser).setFiles(await photoFile(p, { width: 300, height: 400 }));
    await p.waitForTimeout(1200);
    check(/too small/.test(await body(p)), "a small photo is refused, saying why");
    await shot("refused");
    chooser = p.waitForEvent("filechooser");
    await p.getByRole("radio", { name: /Upload a photo/ }).first().click();
    await (await chooser).setFiles(await photoFile(p));
    await p.waitForFunction(() => document.querySelector("[data-tryon-step]")?.getAttribute("data-tryon-step") === "preview", null, { timeout: 8000 });
    check((await step(p)) === "preview", "a good photo reaches the preview");
  },
  { premium: true },
);

await scenario(
  "TRY3",
  "A failing try-on service offers Try again, a limited number of times",
  "phone",
  async (p, shot) => {
    await openTryOn(p);
    // Only the try-on fails; the looks were fetched before.
    await p.evaluate(() => sessionStorage.setItem("praxis_sim", "failure"));
    await button(p, "Continue").click();
    await button(p, "I agree").click();
    const chooser = p.waitForEvent("filechooser");
    await p.getByRole("radio", { name: /Upload a photo/ }).first().click();
    await (await chooser).setFiles(await photoFile(p));
    await p.waitForFunction(() => document.querySelector("[data-tryon-step]")?.getAttribute("data-tryon-step") === "preview", null, { timeout: 8000 });
    await button(p, "Use this photo").click();
    await p.waitForFunction(() => document.querySelector("[data-tryon-step]")?.getAttribute("data-tryon-step") === "result", null, { timeout: 8000 });
    check(/didn’t work this time/.test(await body(p)), "the failure is said plainly");
    await shot("failed");
    let tries = 1;
    while ((await button(p, "Try again").count()) && tries < 6) {
      await button(p, "Try again").click();
      await p.waitForFunction(() => document.querySelector("[data-tryon-step]")?.getAttribute("data-tryon-step") === "result", null, { timeout: 8000 });
      tries += 1;
    }
    check(tries === 3, `three tries in all (${tries})`);
    check((await button(p, "Use another photo").count()) > 0, "another photo is still offered");
    const ids = (await events(p)).filter((e) => e.eventName === "tryon_submitted").map((e) => e.properties?.requestId ?? e.props?.requestId);
    check(new Set(ids).size === ids.length && ids.length === 3, "each try is a new request");
  },
  { premium: true },
);

await scenario(
  "TRY4",
  "A slow try-on says so and can be stopped and sent again",
  "phone",
  async (p, shot) => {
    await openTryOn(p);
    await button(p, "Continue").click();
    await button(p, "I agree").click();
    const chooser = p.waitForEvent("filechooser");
    await p.getByRole("radio", { name: /Upload a photo/ }).first().click();
    await (await chooser).setFiles(await photoFile(p));
    await p.waitForFunction(() => document.querySelector("[data-tryon-step]")?.getAttribute("data-tryon-step") === "preview", null, { timeout: 8000 });
    await button(p, "Use this photo").click();
    await p.waitForTimeout(5600);
    check(/taking longer than usual/.test(await body(p)), "says it is taking longer");
    await shot("slow");
    await button(p, "Stop").click();
    await p.waitForTimeout(300);
    check((await step(p)) === "cancelled" && /Stopped/.test(await body(p)), "stopped, with the photo kept");
    await p.evaluate(() => sessionStorage.setItem("praxis_sim", "fast"));
    await button(p, "Send again").click();
    await p.waitForFunction(() => document.querySelector("[data-tryon-step]")?.getAttribute("data-tryon-step") === "result", null, { timeout: 8000 });
    check(/isn’t switched on yet/.test(await body(p)), "sent again and answered");
  },
  { premium: true, sim: "slow" },
);

await scenario(
  "TRY5",
  "Without camera access, the reason is given and upload still works",
  "phone",
  async (p) => {
    await openTryOn(p);
    await button(p, "Continue").click();
    await button(p, "I agree").click();
    const asked = Date.now();
    await p.getByRole("radio", { name: /Take a photo/ }).first().click();
    // Wait for the answer rather than a fixed time: a busy machine can take over 1.5 s to refuse the camera.
    await p.waitForFunction(() => /Camera access is turned off|couldn’t find a camera|camera is not available/i.test(document.body.innerText), null, { timeout: 8000 }).catch(() => undefined);
    const t = await body(p);
    check(/Camera access is turned off|couldn’t find a camera|camera is not available/i.test(t) && /Upload a photo instead/.test(t), `the camera problem is explained with a way on (after ${Date.now() - asked} ms)`);
    check((await p.getByRole("radio", { name: /Upload a photo/ }).count()) > 0, "upload is still offered");
  },
  { premium: true },
);

await scenario(
  "TRY6",
  "Without Premium, See it on me by address opens the try-on introduction on the looks",
  "phone",
  async (p) => {
    await toResults(p, A);
    const u = new URL(p.url());
    await p.goto(`${BASE}/moment/tryon${u.search}`);
    await p.waitForTimeout(1000);
    const now = new URL(p.url());
    check(now.pathname === "/moment/results" && now.searchParams.get("gate") === "tryon", "lands on the looks with the introduction open");
    check(/See it on you/.test(await body(p)), "the introduction shows");
  },
);

/* A real camera, faked by Chromium: the photo is taken from the live preview. */
if (wanted("TRY7") && !skipForSignIn("TRY7", "The camera opens, shows a live preview, and the photo taken goes to the preview", "phone", true)) {
  const camBrowser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {}),
    args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
  });
  const ctx = await camBrowser.newContext({ ...PHONE, permissions: ["camera"] });
  await ctx.addInitScript((u) => {
    if (localStorage.getItem("praxis_e2e_seeded")) return;
    localStorage.setItem("praxis_e2e_seeded", "1");
    localStorage.setItem("praxis_lab_a_user", JSON.stringify(u));
    localStorage.setItem("praxis_lab_a_premium", JSON.stringify({ [u.id]: true }));
  }, PREMIUM_USER);
  const p = await ctx.newPage();
  current = { id: "TRY7", title: "The camera opens, shows a live preview, and the photo taken goes to the preview (Chromium's fake camera, not a physical one)", device: "phone", suite: 4, checks: [], errors: [], status: "passed" };
  p.on("pageerror", (e) => current.errors.push(e.message));
  try {
    await openTryOn(p);
    await button(p, "Continue").click();
    await button(p, "I agree").click();
    const asked = Date.now();
    await p.getByRole("radio", { name: /Take a photo/ }).first().click();
    // Wait for the preview rather than a fixed time: the fake camera can take over 1.5 s to start on a busy machine.
    await p.locator("video").filter({ visible: true }).first().waitFor({ timeout: 8000 }).catch(() => undefined);
    check(await p.locator("video").filter({ visible: true }).count(), `the live preview shows (after ${Date.now() - asked} ms)`);
    await p.screenshot({ path: join(OUT, "TRY7-phone-camera.png") });
    await button(p, "Take photo").click();
    await p.waitForTimeout(1500);
    const s = await step(p);
    const t = await body(p);
    check(s === "preview" || /too small|too dark|too bright/.test(t), `the photo is checked (${s})`);
    check(!(await p.evaluate(() => Object.values(localStorage).some((v) => v.includes("data:image")))), "no photo on the device");
  } catch (e) {
    current.checks.push({ ok: false, what: `ran to the end (${String(e.message).split("\n")[0]})` });
  }
  if (current.errors.length) current.checks.push({ ok: false, what: `no page errors (${current.errors[0]})` });
  current.status = current.checks.every((c) => c.ok) ? "passed" : "failed";
  results.push(current);
  await ctx.close();
  await camBrowser.close();
}

/* ------------------------------------------------------------ suites */

/* Everything a suite needs from the harness. Suites live in e2e/suites, one file per suite. */
const H = { BASE, OUT, AXE, DESKTOP, PHONE, SIZES, PREMIUM_USER, A, B, browser, chromium, scenario, check, body, button, events, history, lab, answer, toResults, photoFile, portraitFile, garmentFile, openTryOn, step, menuClick, signInWith, results, get current() { return current; }, set current(v) { current = v; } };
for (const file of readdirSync(join(here, "suites")).filter((f) => /^\d+-.*\.mjs$/.test(f)).sort()) {
  const suite = await import(join(here, "suites", file));
  await suite.default(H);
}

/* ------------------------------------------------------------ report */

await browser.close();
server?.kill();

const passed = results.filter((r) => r.status === "passed").length;
const checks = results.flatMap((r) => r.checks);
const bySuite = Object.entries(SUITES).map(([n, name]) => {
  const rs = results.filter((r) => r.suite === Number(n));
  const cs = rs.flatMap((r) => r.checks);
  return `| ${n} | ${name} | ${rs.length} | ${rs.filter((r) => r.status === "passed").length} | ${rs.filter((r) => r.status !== "passed").length} | ${skipped.filter((r) => r.suite === Number(n)).length} | ${cs.filter((c) => c.ok).length}/${cs.length} |`;
});
const lines = [
  "# Scenario test report",
  "",
  `Run against ${BASE} on ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC in Chromium (Playwright ${(await import("playwright-core/package.json", { with: { type: "json" } })).default.version}). ${passed} of ${results.length} runs passed; ${checks.filter((c) => c.ok).length} of ${checks.length} checks passed.${skipped.length ? ` ${skipped.length} ${skipped.length === 1 ? "run was" : "runs were"} skipped because they need the preview sign-in (REAL_SIGN_IN=1); they are listed under "Skipped".` : ""}`,
  "",
  "| Suite | Name | Runs | Passed | Failed | Skipped | Checks |",
  "| --- | --- | --- | --- | --- | --- | --- |",
  ...bySuite,
  "",
  "| Scenario | Device | Result | Checks |",
  "| --- | --- | --- | --- |",
  ...results.map((r) => `| ${r.id} ${r.title} | ${r.device} | ${r.status} | ${r.checks.filter((c) => c.ok).length}/${r.checks.length} |`),
  "",
  "## Every check",
  "",
  ...results.flatMap((r) => [`### ${r.id} ${r.title} (${r.device})`, "", ...r.checks.map((c) => `- ${c.ok ? "pass" : "FAIL"}: ${c.what}`), ""]),
  "",
  "## Failed checks",
  "",
  ...(results.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => `- ${r.id} ${r.device}: ${c.what}`)).length
    ? results.flatMap((r) => r.checks.filter((c) => !c.ok).map((c) => `- ${r.id} ${r.device}: ${c.what}`))
    : ["None."]),
  "",
  ...(skipped.length
    ? ["## Skipped", "", "Not run: this site signs people in for real, so the preview's account doesn't exist here. The full local run covers these.", "", "| Scenario | Device | Suite |", "| --- | --- | --- |", ...skipped.map((r) => `| ${r.id} ${r.title} | ${r.device} | ${r.suite} |`), ""]
    : []),
  "## Load",
  "",
  "| Device | Largest paint | DOM ready | Load | Layout shift | Transferred |",
  "| --- | --- | --- | --- | --- | --- |",
  ...perf.map((m) => `| ${m.device} | ${m.lcp} ms | ${m.dcl} ms | ${m.load} ms | ${m.cls} | ${m.kb} KB |`),
  "",
];
writeFileSync(join(OUT, "report.md"), lines.join("\n"));
writeFileSync(join(OUT, "report.json"), JSON.stringify({ base: BASE, results, skipped, perf }, null, 2));
console.log(lines.join("\n"));
// A filter that selects nothing is a failure, never an empty pass.
process.exit(results.length > 0 && passed === results.length ? 0 : 1);
