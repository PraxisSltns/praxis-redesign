/** Suite 9: failure and recovery, beyond S8, S9, S10, P2A and P2B. Answers must survive every failure. */
import { latest } from "./lib.mjs";

export default async function (H) {
  const { BASE, scenario, check, body, button, history, answer, toResults, A, menuClick, lab } = H;

  for (const sim of ["empty", "failure"]) {
    await scenario(`P3-9a-${sim}`, `${sim === "empty" ? "No looks" : "A service error"}: the answers are kept and can be changed`, "phone", async (p, shot) => {
      await answer(p, A);
      await p.waitForSelector(sim === "empty" ? "text=couldn’t find looks for all of that" : "text=couldn’t put your looks together this time", { timeout: 15000 });
      check(/Your answers are kept|Try another budget or feel/.test(await body(p)), "says what to do next");
      await shot(sim);
      await button(p, "Change my answers").click();
      await p.waitForTimeout(500);
      await p.getByRole("radio", { name: /The budget/ }).first().click();
      await p.waitForURL(/moment\/spend/);
      await p.waitForTimeout(400);
      check((await p.getByRole("radio", { name: /\$300 to/ }).first().getAttribute("aria-checked")) === "true", "the budget answer is still chosen");
      const q = new URL(p.url()).searchParams;
      check(q.get("venue") === "RESTAURANT" && q.get("time") === "NIGHT" && q.get("vibe") === "SHARP", "every other answer is kept");
    }, { sim });
  }

  await scenario("P3-9b", "Losing the network after the page loads: the journey still works and nothing breaks", "phone", async (p, shot) => {
    await p.goto(`${BASE}/?mode=light`);
    await p.waitForTimeout(1200);
    await p.context().setOffline(true);
    await p.getByRole("radio", { name: "Dinner" }).first().click();
    for (const name of [A.venue, A.time, A.feel, A.spend]) {
      await p.waitForTimeout(650);
      await p.getByRole("radio", { name }).first().click();
    }
    await p.waitForURL(/moment\/results/, { timeout: 15000 });
    await p.waitForTimeout(800);
    check((await latest(H, p))?.response?.status === "completed", "the looks still come back (the stand-in engine runs in the page)");
    await button(p, /^Save/).click();
    await p.waitForTimeout(600);
    check(((await lab(p)).looks ?? []).length === 1, "saving still works offline");
    await shot("offline");
    await p.context().setOffline(false);
    await p.reload();
    await p.waitForTimeout(1000);
    check(/moment\/results/.test(p.url()) && ((await lab(p)).looks ?? []).length === 1, "back online, the page and the save are intact");
  }, { missingFiles: true });

  await scenario("P3-9c", "A sign-in that has gone (expired) leaves the visitor a guest, with answers kept and nothing of the account shown", "desktop", async (p) => {
    await p.goto(`${BASE}/?mode=light`);
    await menuClick(p, /^Sign in$/);
    await p.waitForTimeout(400);
    await p.locator("#gate-email").fill("expiring@example.com");
    await button(p, /Continue with email/).click();
    await p.waitForTimeout(1400);
    await toResults(p, A);
    await button(p, /^Save/).click();
    await p.waitForTimeout(700);
    const title = (await p.locator("h1.a-display").filter({ visible: true }).first().innerText()).trim();
    const answers = new URL(p.url()).searchParams.toString();
    await p.evaluate(() => localStorage.removeItem("praxis_lab_a_user"));
    await p.reload();
    await p.waitForTimeout(1200);
    const now = (await p.locator("h1.a-display").filter({ visible: true }).first().innerText()).trim();
    check(new URL(p.url()).searchParams.toString() === answers && now === title && !/Something went wrong/.test(await body(p)), `the same look shows after the sign-in is gone (${now})`);
    await p.goto(`${BASE}/looks?mode=light`);
    await p.waitForTimeout(800);
    check(/No saved looks yet/.test(await body(p)), "the account's saved look is not shown to a guest");
    await menuClick(p, /^Sign in$/);
    await p.waitForTimeout(400);
    await p.locator("#gate-email").fill("expiring@example.com");
    await button(p, /Continue with email/).click();
    await p.waitForTimeout(1400);
    await p.goto(`${BASE}/looks?mode=light`);
    await p.waitForTimeout(800);
    check((await p.locator("a.a-rail-card").count()) === 1, "signing in again brings it back");
  }, { previewSignIn: true });

  await scenario("P3-9d", "A styling request cancelled while it runs keeps the answers and can be sent again", "phone", async (p) => {
    await answer(p, A);
    await p.waitForTimeout(800);
    await button(p, "Cancel").click();
    await p.waitForTimeout(400);
    check(/I’ve stopped/.test(await body(p)) && /Your answers are kept/.test(await body(p)), "says it stopped and the answers are kept");
    check((await history(p)).length === 0, "a cancelled request is not kept as an answer");
    await p.evaluate(() => sessionStorage.setItem("praxis_sim", "fast"));
    await button(p, "Show me my looks").click();
    await p.waitForURL(/moment\/results/, { timeout: 15000 });
    check((await latest(H, p)).response.status === "completed", "sent again, the looks come back");
  }, { sim: "slow" });
}
