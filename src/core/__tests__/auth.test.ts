/**
 * Sign-in by email link, sessions, consents and the guest-to-account hand-over (server/auth), over
 * real HTTP against Postgres and Redis (database 15), with the email going to the in-memory outbox.
 * Runs when DATABASE_URL and REDIS_URL are set.
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACCOUNT_CONSENTS, checkConsents } from "../../shared/consents.mjs";
// @ts-expect-error plain JavaScript module
import { readLook } from "../../../server/auth/account.mjs";
// @ts-expect-error plain JavaScript module
import { createMailer } from "../../../server/auth/mailer.mjs";

describe("account consents", () => {
  it("needs the terms and privacy at their current versions", () => {
    expect(checkConsents(ACCOUNT_CONSENTS).missing).toEqual([]);
    expect(checkConsents([{ category: "terms", version: ACCOUNT_CONSENTS[0].version }]).missing).toEqual(["privacy"]);
    expect(checkConsents([{ category: "terms", version: "terms-2020" }, { category: "privacy", version: "old" }]).missing).toEqual(["terms", "privacy"]);
    expect(checkConsents(null).missing).toEqual(["terms", "privacy"]);
  });
});

describe("the mailer", () => {
  it("sends through Resend only with a key and a sender, and never pretends to in production", async () => {
    const calls: unknown[] = [];
    const fetcher = async (url: string, init: { headers: Record<string, string>; body: string }) => {
      calls.push([url, init.headers.Authorization, JSON.parse(init.body).to]);
      return new Response("{}", { status: 200 });
    };
    const resend = createMailer({ RESEND_API_KEY: "re_test", MAIL_FROM: "Praxis <hello@praxis.example>" }, fetcher);
    expect(resend.kind).toBe("resend");
    await resend.send({ to: "a@b.example", subject: "s", text: "t", html: "h" });
    expect(calls).toEqual([["https://api.resend.com/emails", "Bearer re_test", ["a@b.example"]]]);
    expect(createMailer({ NODE_ENV: "production" })).toBeNull();
    expect(createMailer({}).kind).toBe("outbox");
  });
});

describe("a saved look from the page", () => {
  const look = { dedupeKey: "dinner_sharper_01|k", occasionLabel: "Dinner", savedAt: "2026-11-05T10:00:00.000Z", look: { id: "dinner_sharper_01", title: "x" } };
  it("is read when complete, refused when not", () => {
    expect(readLook(look)).toMatchObject({ dedupeKey: "dinner_sharper_01|k", outfitId: "dinner_sharper_01" });
    expect(readLook({ ...look, savedAt: "yesterday" })).toBeNull();
    expect(readLook({ ...look, look: { title: "no id" } })).toBeNull();
    expect(readLook({ ...look, look: { id: "x", big: "y".repeat(50_000) } })).toBeNull();
  });
});

const ready = Boolean(process.env.DATABASE_URL && process.env.REDIS_URL);

describe.skipIf(!ready)("signing in, over HTTP", async () => {
  // @ts-expect-error plain JavaScript module
  const { closeDb, db } = await import("../../../server/db.mjs");
  // @ts-expect-error plain JavaScript module
  const { handleAccount } = await import("../../../server/auth/routes.mjs");
  // @ts-expect-error plain JavaScript module
  const { createMagicLinkProvider } = await import("../../../server/auth/magic-link.mjs");
  // @ts-expect-error plain JavaScript module
  const { outbox } = await import("../../../server/auth/mailer.mjs");
  const { createClient } = await import("redis");

  const pool = db();
  const redis = createClient({ url: `${String(process.env.REDIS_URL).replace(/\/\d+$/, "")}/15` });
  const ORIGIN = "http://praxis.test";
  const env = { APP_ORIGIN: ORIGIN, CORS_ORIGINS: "" };
  const provider = createMagicLinkProvider({ pool, redis, mailer: createMailer({ AUTH_OUTBOX_LOG: "off" }), appOrigin: ORIGIN });
  const stamp = Date.now();
  const email = `guest.${stamp}@praxis-test.example`;
  const anon = `anon_test${stamp}`;
  let server: Server;
  let base = "";

  const call = async (path: string, { method = "GET", body, cookie, origin = ORIGIN }: { method?: string; body?: unknown; cookie?: string; origin?: string | null } = {}) => {
    const res = await fetch(base + path, {
      method,
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, body: await res.json().catch(() => null), cookie: res.headers.get("set-cookie") };
  };
  const consents = ACCOUNT_CONSENTS.map(({ category, version }: { category: string; version: string }) => ({ category, version }));
  const linkToken = () => new URL(outbox[outbox.length - 1].link).searchParams.get("token")!;
  const look = (outfit: string, key = `${outfit}|dinner`) => ({ id: `${outfit}_1`, savedAt: "2026-11-05T10:00:00.000Z", occasionLabel: "Dinner", dedupeKey: key, look: { id: outfit, title: "A look" }, inputKey: "dinner|key" });

  beforeAll(async () => {
    await redis.connect();
    await redis.flushDb();
    server = createServer((req, res) => void handleAccount(req, res, (req.url ?? "").split("?")[0], { pool, provider, env }));
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(async () => {
    await pool.query("DELETE FROM users WHERE email LIKE '%@praxis-test.example'");
    await pool.query("DELETE FROM sign_in_links WHERE email LIKE '%@praxis-test.example'");
    await redis.flushDb();
    await redis.close();
    await new Promise((r) => server.close(r));
    await closeDb();
  });

  let cookie = "";

  it("refuses a sign-in without the required consents, or from another site", async () => {
    expect((await call("/api/auth/start", { method: "POST", body: { email, anonymousSessionId: anon, consents: [] } })).body.code).toBe("consent_missing");
    expect((await call("/api/auth/start", { method: "POST", body: { email, anonymousSessionId: anon, consents }, origin: "https://evil.example" })).status).toBe(403);
    expect((await call("/api/auth/start", { method: "POST", body: { email, anonymousSessionId: anon, consents }, origin: null })).status).toBe(403);
  });

  it("emails a one-time link, saying the same for any address", async () => {
    const first = await call("/api/auth/start", { method: "POST", body: { email: email.toUpperCase(), anonymousSessionId: anon, consents } });
    expect(first).toMatchObject({ status: 202, body: { sent: true } });
    expect(outbox[outbox.length - 1]).toMatchObject({ to: email, subject: "Your Praxis sign-in link" });
    expect(outbox[outbox.length - 1].link).toMatch(/^http:\/\/praxis\.test\/auth\/verify\?token=[A-Za-z0-9_-]{43}$/);
    const { rows } = await pool.query("SELECT token_hash FROM sign_in_links WHERE email = $1", [email]);
    expect(rows[0].token_hash).not.toContain(linkToken());
  });

  it("signs a new account in once per link, with a session cookie and its consents recorded", async () => {
    const token = linkToken();
    const done = await call("/api/auth/verify", { method: "POST", body: { token } });
    expect(done).toMatchObject({ status: 200, body: { isNew: true, anonymousSessionId: anon, user: { email } } });
    expect(done.cookie).toMatch(/^praxis_session=[A-Za-z0-9_-]{43}; Path=\/; HttpOnly; SameSite=Lax; Max-Age=2592000$/);
    cookie = done.cookie!.split(";")[0];
    expect((await call("/api/auth/verify", { method: "POST", body: { token } })).body.code).toBe("link_expired");
    const { rows } = await pool.query("SELECT category, version, granted_at, withdrawn_at FROM consents WHERE owner_user_id = $1 ORDER BY category", [done.body.user.id]);
    expect(rows.map((r: { category: string; version: string; withdrawn_at: null }) => [r.category, r.version, r.withdrawn_at])).toEqual([
      ["privacy", "privacy-draft-2026-11", null],
      ["terms", "terms-draft-2026-11", null],
    ]);
    expect((await call("/api/auth/me", { cookie })).body.user.email).toBe(email);
  });

  it("moves the guest's saved looks to the account exactly once, without duplicates", async () => {
    const looks = [look("dinner_sharper_01"), look("dinner_relaxed_01"), look("dinner_relaxed_01"), { nonsense: true }];
    expect((await call("/api/account/claim", { method: "POST", cookie, body: { anonymousSessionId: anon, looks } })).body).toEqual({ moved: 2, duplicates: 1, rejected: 1, already: false });
    expect((await call("/api/account/claim", { method: "POST", cookie, body: { anonymousSessionId: anon, looks } })).body).toEqual({ moved: 0, duplicates: 0, rejected: 0, already: true });
    const mine = await call("/api/looks", { cookie });
    expect(mine.body.looks.map((l: { look: { id: string } }) => l.look.id).sort()).toEqual(["dinner_relaxed_01", "dinner_sharper_01"]);
  });

  it("won't let an account claim a guest id it didn't sign in from", async () => {
    expect((await call("/api/account/claim", { method: "POST", cookie, body: { anonymousSessionId: "anon_someoneelse123", looks: [look("x")] } })).status).toBe(403);
  });

  it("signs the same address in again as the same account, keeping its looks; a second guest's look joins once", async () => {
    const otherAnon = `anon_second${stamp}`;
    await call("/api/auth/start", { method: "POST", body: { email, anonymousSessionId: otherAnon, consents } });
    const again = await call("/api/auth/verify", { method: "POST", body: { token: linkToken() } });
    expect(again.body.isNew).toBe(false);
    const second = again.cookie!.split(";")[0];
    const claim = await call("/api/account/claim", { method: "POST", cookie: second, body: { anonymousSessionId: otherAnon, looks: [look("dinner_sharper_01"), look("work_safest_01")] } });
    expect(claim.body).toEqual({ moved: 1, duplicates: 1, rejected: 0, already: false });
    expect((await call("/api/looks", { cookie: second })).body.looks).toHaveLength(3);
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM consents c JOIN users u ON u.user_id = c.owner_user_id WHERE u.email = $1", [email]);
    expect(rows[0].n).toBe(2);
  });

  it("saves and removes a look while signed in, and nothing without a session", async () => {
    const saved = await call("/api/looks", { method: "POST", cookie, body: { anonymousSessionId: anon, look: look("party_relaxed_01") } });
    expect(saved.body).toMatchObject({ saved: true, duplicate: false });
    expect((await call(`/api/looks/${saved.body.id}`, { method: "DELETE", cookie })).status).toBe(200);
    expect((await call("/api/looks")).status).toBe(401);
    expect((await call("/api/looks", { cookie: "praxis_session=" + "x".repeat(43) })).status).toBe(401);
  });

  it("removes a look by its key, from any device, and a second remove is still fine", async () => {
    const l = look("wedding_relaxed_01");
    await call("/api/looks", { method: "POST", cookie, body: { anonymousSessionId: anon, look: l } });
    const keys = async () => (await call("/api/looks", { cookie })).body.looks.map((x: { dedupeKey: string }) => x.dedupeKey);
    expect(await keys()).toContain(l.dedupeKey);
    expect((await call("/api/looks", { method: "DELETE", cookie, body: { dedupeKey: l.dedupeKey } })).body).toEqual({ removed: true });
    expect(await keys()).not.toContain(l.dedupeKey);
    expect((await call("/api/looks", { method: "DELETE", cookie, body: { dedupeKey: l.dedupeKey } }))).toMatchObject({ status: 200, body: { removed: false } });
    expect((await call("/api/looks", { method: "DELETE", cookie, body: {} })).status).toBe(400);
    expect((await call("/api/looks", { method: "DELETE", body: { dedupeKey: l.dedupeKey } })).status).toBe(401);
  });

  it("withdraws the account's consents, signs it out everywhere, and asks again at the next sign-in", async () => {
    const who = `withdraw.${stamp}@praxis-test.example`;
    const signInAs = async (anonymous: string) => {
      await call("/api/auth/start", { method: "POST", body: { email: who, anonymousSessionId: anonymous, consents } });
      return (await call("/api/auth/verify", { method: "POST", body: { token: linkToken() } })).cookie!.split(";")[0];
    };
    const phone = await signInAs(`anon_wphone${stamp}`);
    const laptop = await signInAs(`anon_wlaptop${stamp}`);
    const before = (await call("/api/account/consents", { cookie: phone })).body.consents;
    expect(before.map((c: { category: string; withdrawnAt: null }) => [c.category, c.withdrawnAt])).toEqual([["privacy", null], ["terms", null]]);

    expect((await call("/api/account/consents/withdraw", { method: "POST", cookie: phone, origin: "https://elsewhere.example" })).status).toBe(403);
    const out = await call("/api/account/consents/withdraw", { method: "POST", cookie: phone });
    expect(out.body).toEqual({ withdrawn: ["privacy", "terms"], signedOut: 2 });
    expect(out.cookie).toMatch(/Max-Age=0/);
    expect((await call("/api/auth/me", { cookie: phone })).status).toBe(401);
    expect((await call("/api/auth/me", { cookie: laptop })).status).toBe(401);

    // Signing in again needs the consents again, and records them as new grants beside the withdrawn ones.
    expect((await call("/api/auth/start", { method: "POST", body: { email: who, anonymousSessionId: `anon_wagain${stamp}`, consents: [] } })).body.code).toBe("consent_missing");
    const back = await signInAs(`anon_wagain${stamp}`);
    const after = (await call("/api/account/consents", { cookie: back })).body.consents;
    expect(after.every((c: { withdrawnAt: string | null }) => c.withdrawnAt === null)).toBe(true);
    const { rows } = await pool.query("SELECT count(*)::int AS n, count(withdrawn_at)::int AS withdrawn FROM consents c JOIN users u ON u.user_id = c.owner_user_id WHERE u.email = $1", [who]);
    expect(rows[0]).toEqual({ n: 4, withdrawn: 2 });
    expect((await call("/api/account/consents")).status).toBe(401);
  });

  it("limits how many links one address can ask for", async () => {
    const busy = `busy.${stamp}@praxis-test.example`;
    const statuses = [];
    for (let i = 0; i < 6; i += 1) statuses.push((await call("/api/auth/start", { method: "POST", body: { email: busy, anonymousSessionId: anon, consents } })).status);
    expect(statuses).toEqual([202, 202, 202, 202, 202, 429]);
  });

  it("ends the session on sign out", async () => {
    const out = await call("/api/auth/sign-out", { method: "POST", cookie, body: {} });
    expect(out.cookie).toMatch(/^praxis_session=; .*Max-Age=0/);
    expect((await call("/api/auth/me", { cookie })).status).toBe(401);
  });

  it("refuses an expired link", async () => {
    const late = createMagicLinkProvider({ pool, redis: null, mailer: createMailer({ AUTH_OUTBOX_LOG: "off" }), appOrigin: ORIGIN, now: () => new Date(Date.now() - 16 * 60_000) });
    await late.start({ email: `late.${stamp}@praxis-test.example`, anonymousSessionId: anon, consents });
    await expect(provider.finish({ token: linkToken() })).rejects.toMatchObject({ code: "link_expired" });
  });
});
