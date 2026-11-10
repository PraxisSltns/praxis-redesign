/**
 * The real sign-in, end to end in Chromium (AUTH_MODE "magic-link"): a guest saves a look, signs up by
 * emailed link, and still sees it; on a second device the same address signs in and sees it too; the
 * look is kept once on the server; a used link is refused; removing it on one device removes it on both;
 * wardrobe pieces and feedback follow the account; withdrawing the agreement from Your data signs the
 * account out everywhere.
 *
 *   VITE_AUTH=magic-link npm run build
 *   DATABASE_URL=... REDIS_URL=... node e2e/signin-magic-link.mjs
 *
 * Starts the gateway itself on :4181 with no mail service, so the link is read from the server's log
 * (the local outbox, server/auth/mailer.mjs). Needs Postgres with the migrations, and Redis.
 */
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";
import pg from "pg";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const PORT = 4181;
const BASE = `http://127.0.0.1:${PORT}`;
const RESULTS = `${BASE}/moment/results?occasion=DINNER&venue=RESTAURANT&time=NIGHT&vibe=SHARP&spend=ELEVATED&mode=light`;
const EMAIL = `signin.check.${Date.now()}@praxis-test.example`;

let log = "";
const server = spawn("node", ["server/index.mjs"], {
  cwd: ROOT,
  env: { ...process.env, PORT: String(PORT), APP_ORIGIN: BASE, AUTH_PROVIDER: "magic-link", NODE_ENV: "development", RESEND_API_KEY: "", CORS_ORIGINS: "" },
  stdio: ["ignore", "pipe", "pipe"],
});
server.stdout.on("data", (d) => (log += d));
server.stderr.on("data", (d) => (log += d));

const results = [];
const check = (ok, what) => {
  results.push({ ok: Boolean(ok), what });
  console.log(`${ok ? "PASS" : "FAIL"}  ${what}`);
};

async function linkFor(email, after) {
  for (let i = 0; i < 50; i += 1) {
    const found = [...log.slice(after).matchAll(/\[sign-in email to ([^\]]+)\] (\S+)/g)].find((m) => m[1] === email);
    if (found) return found[2];
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

async function signIn(page, email) {
  await page.goto(`${BASE}/looks?mode=light&gate=signin`);
  await page.locator("#gate-email").fill(email);
  await page.locator("#gate-consent").check();
  const before = log.length;
  await page.getByRole("button", { name: "Email me a sign-in link" }).click();
  await page.getByText("Check your email.").waitFor({ timeout: 10_000 });
  const link = await linkFor(email, before);
  await page.goto(link);
  await page.waitForURL((u) => !u.pathname.startsWith("/auth/verify"), { timeout: 15_000 });
  return link;
}

const cards = async (page) => {
  await page.goto(`${BASE}/looks?mode=light`);
  await page.waitForTimeout(1500);
  return page.locator("a.a-rail-card").count();
};

try {
  for (let i = 0; i < 80; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) break;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});

  // Device one: a guest saves a look, then signs up.
  const one = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await one.newPage();
  await p.goto(RESULTS);
  await p.getByRole("button", { name: /^Save/ }).filter({ visible: true }).first().click({ timeout: 30_000 });
  await p.waitForTimeout(700);
  check((await cards(p)) === 1, "the guest's saved look is on Looks");
  await p.goto(`${BASE}/looks?mode=light&gate=signin`);
  check((await p.getByRole("button", { name: "Continue with Apple" }).count()) === 0, "with a real sign-in, only the email link is offered");
  await p.locator("#gate-email").fill(EMAIL);
  await p.getByRole("button", { name: "Email me a sign-in link" }).click();
  check(await p.getByText("Agree to the terms and privacy notice to continue.").isVisible(), "the consent must be ticked before a link is sent");
  const link = await signIn(p, EMAIL);
  check(Boolean(link) && /\/auth\/verify\?token=/.test(link), "the emailed link opens the verify page");
  check(!/token=/.test(p.url()), `the token leaves the address bar after sign-in (${new URL(p.url()).pathname})`);
  const userId = await p.evaluate(() => JSON.parse(localStorage.getItem("praxis_lab_a_user") ?? "{}").id);
  check(/^user_[0-9a-f]{32}$/.test(userId ?? ""), `the page is signed in as the server's account (${userId})`);
  check((await cards(p)) === 1, "after signing up, the guest's look is still there");
  check((await p.getByText("Kept with your account, on every device you sign in on.").count()) === 1, "Saved looks says the looks are kept with the account");
  await p.waitForTimeout(1000);
  const server1 = await p.evaluate(async () => (await (await fetch("/api/looks", { credentials: "include" })).json()).looks.length);
  check(server1 === 1, `the look is kept with the account on the server (${server1})`);
  const cookies = await one.cookies();
  const session = cookies.find((c) => c.name === "praxis_session");
  check(session?.httpOnly === true && session?.sameSite === "Lax", "the session cookie is httpOnly and SameSite=Lax");
  check((await p.evaluate(() => document.cookie)).includes("praxis_session") === false, "the page's script can't read the session");

  // A used link is refused.
  const again = await one.newPage();
  await again.goto(link);
  await again.getByText("That link didn't work.").waitFor({ timeout: 10_000 });
  check(true, "a used link is refused with a way to ask for a new one");

  // Device two: same address, a new browser, nothing saved locally.
  const two = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const q = await two.newPage();
  await signIn(q, EMAIL);
  check((await cards(q)) === 1, "on a second device, the same account sees the look");

  // Removing on one device removes it everywhere: device two removes it, device one loses it on its next load.
  const serverLooks = (page) => page.evaluate(async () => (await (await fetch("/api/looks", { credentials: "include" })).json()).looks.length);
  await q.locator("a.a-rail-card").first().click();
  await q.waitForURL(/\/looks\/.+/);
  await q.getByRole("button", { name: "Remove" }).filter({ visible: true }).first().click();
  await q.waitForURL(/\/looks(\?|$)/);
  await q.getByRole("button", { name: "Undo" }).click();
  await q.waitForTimeout(1000);
  check((await cards(q)) === 1 && (await serverLooks(q)) === 1, "Undo on the second device puts the look back here and on the account");
  await q.locator("a.a-rail-card").first().click();
  await q.waitForURL(/\/looks\/.+/);
  await q.getByRole("button", { name: "Remove" }).filter({ visible: true }).first().click();
  await q.waitForURL(/\/looks(\?|$)/);
  await q.waitForTimeout(1000);
  check((await serverLooks(q)) === 0, "removing the look on the second device removes it from the account");
  await q.reload();
  await q.waitForTimeout(1500);
  check((await cards(q)) === 0, "after a reload, the removed look stays gone on the second device");
  await p.goto(`${BASE}/looks?mode=light`);
  await p.waitForTimeout(1500);
  check((await cards(p)) === 0, "the first device drops the look removed on the second");

  // Wardrobe pieces and feedback follow the account too.
  const rows = (page) => page.getByRole("list", { name: "Pieces you own" }).locator(":scope > li");
  const wardrobe = async (page) => {
    await page.goto(`${BASE}/wardrobe?mode=light`);
    await page.waitForTimeout(1500);
    return rows(page).count();
  };
  await wardrobe(p);
  await p.getByRole("button", { name: "Add a piece" }).click();
  const form = p.getByRole("region", { name: "Add a piece" });
  await form.getByRole("radio", { name: "Top" }).click();
  await form.getByLabel("What you call it").fill("Linen overshirt");
  await form.getByRole("button", { name: "Add to my wardrobe" }).click();
  await p.waitForTimeout(400);
  await p.goto(`${BASE}/looks?mode=light`); // a change of screen sends it
  await p.waitForTimeout(1500);
  const serverPieces = (page) => page.evaluate(async () => (await (await fetch("/api/wardrobe", { credentials: "include" })).json()).items.map((i) => i.label));
  check(JSON.stringify(await serverPieces(p)) === JSON.stringify(["Linen overshirt"]), "a piece added on one device is kept with the account");
  check((await wardrobe(q)) === 1 && (await q.getByText("Linen overshirt").count()) > 0, "the other device's wardrobe shows it");
  await q.getByRole("button", { name: "Remove Linen overshirt" }).click();
  await q.waitForTimeout(300);
  await q.goto(`${BASE}/looks?mode=light`);
  await q.waitForTimeout(1500);
  check((await serverPieces(q)).length === 0, "removing it on the other device removes it from the account");
  check((await wardrobe(p)) === 0, "and from the first device's wardrobe");

  await p.goto(RESULTS);
  await p.getByRole("button", { name: "More like this" }).filter({ visible: true }).first().click({ timeout: 30_000 });
  await p.waitForTimeout(300);
  await p.goto(`${BASE}/looks?mode=light`);
  await p.waitForTimeout(1500);
  const serverWords = await p.evaluate(async () => (await (await fetch("/api/feedback", { credentials: "include" })).json()).records.map((r) => r.feedback));
  check(JSON.stringify(serverWords) === JSON.stringify(["more_like_this"]), `feedback on a look is kept with the account (${serverWords.join(", ")})`);
  await q.goto(`${BASE}/looks?mode=light`);
  await q.waitForTimeout(1500);
  const onTwo = await q.evaluate(() => JSON.parse(localStorage.getItem("praxis_feedback") ?? "[]").filter((r) => r.userId).map((r) => r.feedback));
  check(JSON.stringify(onTwo) === JSON.stringify(["more_like_this"]), `the other device has the feedback too (${onTwo.join(", ")})`);

  // Withdrawing the agreement from Your data signs the account out on both devices.
  await q.goto(`${BASE}/data?mode=light`);
  const agreed = await q.waitForFunction(() => [...document.querySelectorAll("[role=listitem]")].filter((e) => /Agreed /.test(e.textContent ?? "")).length === 2, null, { timeout: 10_000 }).then(() => true, () => false);
  check(agreed, `Your data shows the two agreements with their dates${agreed ? "" : ` (saw: ${(await q.locator("section[aria-labelledby=account-consents]").innerText().catch(() => "no section")).replace(/\s+/g, " ")})`}`);
  await q.getByRole("button", { name: "Withdraw my agreement" }).click();
  await q.getByRole("button", { name: "Withdraw and sign out" }).click();
  await q.waitForURL((u) => new URL(u).pathname === "/", { timeout: 10_000 });
  const me = (page) => page.evaluate(async () => (await fetch("/api/auth/me", { credentials: "include" })).status);
  check((await me(q)) === 401 && (await me(p)) === 401, "withdrawing signs the account out on this device and the other one");
  check((await q.getByText("Sign in", { exact: true }).count()) > 0, "the page shows the person as signed out");
  await p.goto(`${BASE}/looks?mode=light`);
  await p.waitForTimeout(1500);
  check((await p.getByText("Sign in", { exact: true }).count()) > 0, "the other device shows itself signed out on its next load");

  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await db.connect();
  const { rows } = await db.query(
    `SELECT (SELECT count(*)::int FROM saved_looks s WHERE s.owner_user_id = u.user_id) AS looks,
            (SELECT count(*)::int FROM account_claims c WHERE c.user_id = u.user_id) AS claims,
            (SELECT string_agg(category || ' ' || version, ', ' ORDER BY category) FROM consents c WHERE c.owner_user_id = u.user_id) AS consents
     FROM users u WHERE u.email = $1`,
    [EMAIL],
  );
  check(rows[0]?.looks === 0, `the server no longer holds the removed look (${rows[0]?.looks})`);
  check(rows[0]?.claims === 2, `each device's guest data was handed over once (${rows[0]?.claims} claims)`);
  check(rows[0]?.consents === "privacy privacy-draft-2026-11, terms terms-draft-2026-11", `sign-up recorded the consents (${rows[0]?.consents})`);
  const w = await db.query("SELECT count(*)::int AS n, count(c.withdrawn_at)::int AS withdrawn FROM consents c JOIN users u ON u.user_id = c.owner_user_id WHERE u.email = $1", [EMAIL]);
  check(w.rows[0].n === 2 && w.rows[0].withdrawn === 2, `the withdrawal is recorded, with the agreements kept as history (${w.rows[0].withdrawn} of ${w.rows[0].n} withdrawn)`);
  await db.query("DELETE FROM users WHERE email = $1", [EMAIL]);
  await db.end();
  await browser.close();
} catch (e) {
  check(false, `ran to the end (${String(e?.message ?? e).split("\n")[0]})`);
} finally {
  server.kill();
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed} of ${results.length} checks passed`);
process.exit(failed ? 1 : 0);
