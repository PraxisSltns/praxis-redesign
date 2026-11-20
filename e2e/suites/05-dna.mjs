/** Suite 5: Style DNA, from the introduction to an edited, saved profile that the looks use. */
import { latest, named, upload } from "./lib.mjs";

export default async function (H) {
  const { BASE, scenario, check, body, button, events, lab, toResults, A, photoFile, portraitFile, menuClick, signInWith } = H;

  /** The four steps with the sample portrait, from /dna/face to the saved profile. */
  async function fourSteps(p, { fit = "Slim", week = /Mostly office/, tastes = ["Classic tailored", "Quiet luxury"], face } = {}) {
    await p.waitForURL(/dna\/face/, { timeout: 10000 });
    await p.waitForTimeout(500);
    if (face) await face();
    else await p.getByRole("radio", { name: /Use a sample/ }).first().click();
    await p.waitForTimeout(400);
    await button(p, "Looks right").click();
    await p.waitForURL(/dna\/fit/);
    await p.waitForTimeout(400);
    await p.getByRole("radio", { name: fit }).first().click();
    await p.waitForURL(/dna\/lifestyle/);
    await p.waitForTimeout(400);
    await p.getByRole("radio", { name: week }).first().click();
    await p.waitForURL(/dna\/inspiration/);
    await p.waitForTimeout(400);
    for (const t of tastes) await p.getByRole("button", { name: t }).first().click();
    await button(p, "Build my Style DNA").click();
    await p.waitForURL(face ? /dna\/(build|result)/ : /dna\/result/, { timeout: 10000 });
    await p.waitForTimeout(1200);
  }

  for (const device of ["desktop", "phone"]) {
    await scenario("P3-5a", "A new customer: introduction, sign in, Premium preview with no charge, four steps, saved and used in the looks", device, async (p, shot) => {
      await p.goto(`${BASE}/?mode=light`);
      await button(p, "Explore Style DNA").click();
      await p.waitForTimeout(600);
      const intro = await p.locator(".a-gate").innerText();
      check(/Your style. More personal/.test(intro) && /Four short steps/.test(intro) && /in preview/i.test(intro), "the introduction says what it gives, what it takes and that it is a preview");
      await shot("intro");
      await button(p, "Start").click();
      await p.waitForTimeout(500);
      check(/Sign in so I can remember you/.test(await p.locator(".a-gate").innerText()), "sign in comes next, saying why");
      await button(p, /Apple/).click();
      await p.waitForTimeout(1500);
      const pay = await p.locator(".a-gate").innerText();
      check(/Premium/.test(pay) && /\$9/.test(pay) && /No charge is made/.test(pay), "the Premium step shows the price and says no charge is made");
      await p.locator(".a-gate .a-applepay").click();
      await p.waitForTimeout(2500);
      await fourSteps(p);
      const result = await body(p);
      check(/Slim/.test(result) && /Mostly office/.test(result), "the result shows the fit and the week chosen");
      check(/Example|example/.test(result), "the colours are marked as an example, not read from a photo");
      await shot("result");
      await button(p, /Looks right|Save my Style DNA/).click();
      await p.waitForTimeout(1000);
      await p.reload();
      await p.goto(`${BASE}/dna?mode=light`);
      await p.waitForTimeout(800);
      check(/Your Style DNA/.test(await body(p)) && /Slim/.test(await body(p)), "after a reload the saved Style DNA shows");
      const s = await lab(p);
      const prof = s.profiles?.[0];
      check(prof?.owner?.userId && prof.profile.fit && prof.profile.tastes.includes("classic-tailored"), "it is saved under the account, with fit and tastes");
      const ev = await events(p);
      check(["premium_intro_viewed", "premium_started", "style_dna_started", "style_dna_completed"].every((n) => named(ev, n).length >= 1), "the steps are recorded");
      check(named(ev, "style_dna_step").length === 4, "one event per step");
      await toResults(p, A);
      const { request, response } = await latest(H, p);
      check(request.styleProfile?.tastes?.includes("classic-tailored") && request.styleProfileId, "the next styling request carries the Style DNA");
      check(response.outfits.some((o) => o.explanation.contributingFactors.some((f) => f.factor === "style_dna")), "and a look says the Style DNA shaped it");
    }, { previewSignIn: true });
  }

  await scenario("P3-5b", "Correcting a saved Style DNA is kept, apart from the estimate, after a reload", "desktop", async (p) => {
    await p.goto(`${BASE}/dna/face?mode=light`);
    await fourSteps(p, { fit: "Relaxed", week: /Out most nights/, tastes: ["Smart casual"] });
    await button(p, /Looks right|Save my Style DNA/).click();
    await p.waitForTimeout(800);
    await p.goto(`${BASE}/dna?mode=light`);
    await p.waitForTimeout(600);
    await button(p, "Change my Style DNA").click();
    await p.waitForTimeout(500);
    const sheet = p.getByRole("dialog", { name: "Change your Style DNA" });
    await sheet.getByRole("button", { name: "Regular" }).click();
    await sheet.getByRole("button", { name: "Warm" }).click();
    await p.keyboard.press("Escape");
    await p.waitForTimeout(500);
    await p.reload();
    await p.waitForTimeout(800);
    const t = await body(p);
    check(/Regular/.test(t) && /Warm/.test(t), "the corrected fit and undertone show after a reload");
    const prof = (await lab(p)).profiles[0].profile;
    check(prof.undertone.corrected?.value === "warm" && prof.undertone.inferred?.value !== "warm", "the undertone correction is kept apart from the example");
    check(named(await events(p), "style_dna_corrected").map((e) => e.properties.field).sort().join() === "fit,undertone", "each correction is recorded by field, never by value");
  }, { premium: true });

  await scenario("P3-5c", "Style DNA belongs to the account: gone after sign out, back after signing in again", "desktop", async (p) => {
    await p.goto(`${BASE}/?mode=light`);
    await menuClick(p, /^Sign in$/);
    await p.waitForTimeout(400);
    await p.locator("#gate-email").fill("dna.owner@example.com");
    await button(p, /Continue with email/).click();
    await p.waitForTimeout(1400);
    await p.goto(`${BASE}/?mode=light`);
    await button(p, "Explore Style DNA").click();
    await p.waitForTimeout(500);
    await button(p, "Start").click();
    await p.waitForTimeout(600);
    await p.locator(".a-gate .a-applepay").click();
    await p.waitForTimeout(2500);
    await fourSteps(p);
    await button(p, /Looks right|Save my Style DNA/).click();
    await p.waitForTimeout(800);
    await p.goto(`${BASE}/dna?mode=light`);
    await p.waitForTimeout(500);
    await button(p, "Sign out").click();
    await p.waitForTimeout(800);
    await p.goto(`${BASE}/dna?mode=light`);
    await p.waitForTimeout(800);
    check(new URL(p.url()).pathname === "/" && /Explore Style DNA/.test(await body(p)), "a guest on the same device does not see it");
    await p.goto(`${BASE}/?mode=light`);
    await p.waitForTimeout(500);
    await menuClick(p, /^Sign in$/);
    await p.waitForTimeout(400);
    await p.locator("#gate-email").fill("dna.owner@example.com");
    await button(p, /Continue with email/).click();
    await p.waitForTimeout(1400);
    await p.goto(`${BASE}/dna?mode=light`);
    await p.waitForTimeout(800);
    check(/Your Style DNA/.test(await body(p)) && /Slim/.test(await body(p)), "signing in again brings it back");
  }, { previewSignIn: true });

  await scenario("P3-5d", "An own face photo asks for consent first, is checked, and stays on the device", "phone", async (p, shot) => {
    await p.goto(`${BASE}/dna/face?mode=light`);
    await p.waitForTimeout(600);
    await p.getByRole("radio", { name: /Upload a photo/ }).first().click();
    await p.waitForTimeout(300);
    check(/where it goes/i.test(await body(p)), "the consent notice comes before the photo");
    await upload(p, () => button(p, "I agree").click(), await photoFile(p));
    await p.waitForTimeout(1500);
    check(/Looks right/.test(await body(p)) && (await p.locator("img[alt='Your portrait']").count()) > 0, "the photo is shown back to confirm");
    check(!(await p.evaluate(() => Object.values(localStorage).some((v) => v.includes("data:image")))), "the photo is not stored on the device");
    check(named(await events(p), "photo_consent_given").some((e) => e.properties.category === "face_colour"), "consent is recorded for this kind of photo");
    await shot("own-photo");
  }, { premium: true });

  const ownPhoto = (p, file) => async () => {
    await p.getByRole("radio", { name: /Upload a photo/ }).first().click();
    await p.waitForTimeout(300);
    await upload(p, () => button(p, "I agree").click(), file);
    await p.waitForTimeout(1200);
  };

  await scenario("P5-5e", "Colours are read from the customer's own face photo on the device, and marked as an estimate", "desktop", async (p, shot) => {
    await p.goto(`${BASE}/dna/face?mode=light`);
    const outside = [];
    p.on("request", (r) => !r.url().startsWith(BASE) && !/fonts\.(googleapis|gstatic)\.com/.test(r.url()) && outside.push(r.url()));
    await fourSteps(p, { face: ownPhoto(p, await portraitFile(p)) });
    await p.waitForFunction(() => /Estimate/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
    const text = await body(p);
    check(/Undertone/i.test(text) && /Estimate/.test(text) && !/Example/.test(text), "the colours are read from the photo and marked as an estimate");
    check(outside.length === 0, `reading the photo sends nothing off the site (${outside.join(", ") || "no requests"})`);
    check(named(await events(p), "style_dna_analysis_finished").some((e) => e.properties.status === "completed"), "the reading finishes");
    await shot("own-colours");
  }, { premium: true });

  await scenario("P5-5f", "A photo with no face in it is not guessed at: it says so and offers Retake", "phone", async (p) => {
    await p.goto(`${BASE}/dna/face?mode=light`);
    await fourSteps(p, { face: ownPhoto(p, await photoFile(p)) });
    await p.waitForFunction(() => /find your face/.test(document.body.innerText), null, { timeout: 30000 }).catch(() => {});
    const text = await body(p);
    check(/find your face/.test(text), "it says it couldn't find a face");
    check(/Retake/i.test(text) && !/Estimate/.test(text), "it offers Retake and shows no colours as if they were read");
    check(named(await events(p), "style_dna_analysis_finished").some((e) => e.properties.status === "unreadable"), "the outcome is counted, without the photo");
  }, { premium: true });
}
