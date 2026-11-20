/**
 * Suite 6: the client's own pieces. A piece is added from the looks (Make it yours) or on the wardrobe
 * page, where it can also be corrected, removed one by one and used in a set of looks. The client
 * names its type (the mock does not read the photo); Your data lists the pieces and deletes them all.
 */
import { latest, named, textFile, upload } from "./lib.mjs";

export default async function (H) {
  const { BASE, scenario, check, body, button, events, toResults, A, photoFile, garmentFile, menuClick, signInWith } = H;

  async function addOwn(p, slot, file) {
    await p.locator(".a-personal-card").filter({ visible: true }).nth(1).click();
    await p.waitForURL(/moment\/you\/item/);
    await p.getByRole("radio", { name: slot }).first().click();
    await p.waitForTimeout(300);
    await p.getByRole("radio", { name: /Upload a photo/ }).first().click();
    await p.waitForTimeout(300);
    await upload(p, () => button(p, "I agree").click(), file);
  }

  for (const device of ["desktop", "phone"]) {
    await scenario("P3-6a", "An uploaded top is checked, used in every look as the client's own, and kept out of the total", device, async (p, shot) => {
      await toResults(p, A);
      await addOwn(p, "Top", await photoFile(p, { width: 800, height: 800 }));
      await p.waitForURL(/moment\/results/, { timeout: 15000 });
      await p.waitForTimeout(800);
      const { request, response } = await latest(H, p);
      check(request.wardrobeItems.length === 1 && request.wardrobeItems[0].slot === "top" && request.wardrobeItems[0].source === "upload", "the request carries an uploaded top");
      check(!JSON.stringify(request).includes("data:image"), "the request carries no photo");
      check(response.outfits.every((o) => o.garments.filter((g) => g.slot === "top").every((g) => g.source === "wardrobe")), "every look uses it as the top");
      const own = p.locator(".a-piece").filter({ visible: true }).filter({ hasText: "Yours" });
      check((await own.count()) === 1 && (await own.locator("input").count()) === 0, "it reads Yours and cannot be unticked or bought");
      const o = response.outfits.find((x) => x.outfitId === (new URL(p.url()).searchParams.get("hero") ?? response.outfits[0].outfitId));
      check(o.pricing.total === o.garments.filter((g) => g.source === "retail").reduce((s, g) => s + g.product.price, 0), "the total counts only pieces to buy");
      await button(p, /^Check out/).click();
      await p.waitForTimeout(500);
      check(!/Your own top/.test(await p.getByRole("dialog", { name: "Check out" }).innerText()), "Check out leaves it out");
      await p.keyboard.press("Escape");
      check(named(await events(p), "wardrobe_item_added").some((e) => e.properties.slot === "top" && e.properties.source === "upload"), "the piece is recorded by type, never by photo");
      check(!(await p.evaluate(() => Object.values(localStorage).some((v) => v.includes("data:image")))), "the photo is not kept on the device");
      await shot("own-top");
    });
  }

  await scenario("P3-6b", "A photo of a piece that is not a photo, or too dark, is refused with the reason", "phone", async (p) => {
    await toResults(p, A);
    await addOwn(p, "Shoes", textFile);
    await p.waitForTimeout(800);
    check((await p.getByRole("alert").count()) > 0 && /moment\/you\/item/.test(p.url()), `a text file is refused (${(await p.getByRole("alert").first().innerText().catch(() => "")).trim()})`);
    await upload(p, () => p.locator('input[aria-label="Upload a photo of the piece"]').evaluate((i) => i.click()), await photoFile(p, { shade: "#030303" }));
    await p.waitForTimeout(1200);
    check(/dark/i.test(await p.getByRole("alert").first().innerText().catch(() => "")), "a dark photo is refused, saying why");
    check((await p.getByRole("radio", { name: /Try it with an example/ }).count()) === 1, "an example is still offered");
  });

  await scenario("P3-6c", "Changing the piece swaps it in the looks, and Your data lists and deletes it", "desktop", async (p) => {
    await toResults(p, A);
    await p.locator(".a-personal-card").filter({ visible: true }).nth(1).click();
    await p.getByRole("radio", { name: "Shoes" }).first().click();
    await p.waitForTimeout(300);
    await p.getByRole("radio", { name: /Try it with an example/ }).first().click();
    await p.waitForURL(/moment\/results/, { timeout: 15000 });
    await p.waitForTimeout(600);
    check(/Change my piece/.test(await body(p)), "the card now reads Change my piece");
    await p.locator(".a-personal-card").filter({ visible: true }).nth(1).click();
    await p.waitForURL(/moment\/you\/item/);
    await button(p, "Choose another piece").click();
    await p.getByRole("radio", { name: "Bottom" }).first().click();
    await p.waitForTimeout(300);
    await p.getByRole("radio", { name: /Try it with an example/ }).first().click();
    await p.waitForURL(/moment\/results/, { timeout: 15000 });
    await p.waitForTimeout(600);
    const { request } = await latest(H, p);
    check(request.wardrobeItems.length === 1 && request.wardrobeItems[0].slot === "bottom", "the new piece replaces the old one in the request");
    await p.goto(`${BASE}/data?mode=light`);
    await p.waitForTimeout(600);
    check(/Pieces you own/.test(await body(p)) && /(1 piece|2 pieces), by name, type and colour/.test(await body(p)), `Your data lists the pieces by name (${(await body(p)).match(/Pieces you own\s*\n?\s*([^\n]+)/)?.[1]})`);
    await button(p, /Delete everything/).click();
    await p.waitForTimeout(400);
    const confirm = p.getByRole("button", { name: /Delete everything|Yes, delete/ }).filter({ visible: true });
    if (await confirm.count()) await confirm.last().click();
    await p.waitForTimeout(1200);
    await p.goto(`${BASE}/data?mode=light`);
    await p.waitForTimeout(600);
    check(/Pieces you own\s*\n?\s*None/.test(await body(p)), "after deleting, none are left");
  });

  const pieceRows = (p) => p.getByRole("list", { name: "Pieces you own" }).locator(":scope > li");

  async function addPiece(p, { kind, name, colour, file }) {
    await button(p, "Add a piece").click();
    const form = p.getByRole("region", { name: "Add a piece" });
    await form.getByRole("radio", { name: kind }).click();
    if (name) await form.getByLabel("What you call it").fill(name);
    if (colour) await form.getByLabel("Colour (optional)").fill(colour);
    if (file) {
      const chooser = p.waitForEvent("filechooser", { timeout: 5000 });
      await form.getByRole("button", { name: /Add a photo/ }).click();
      const agree = form.getByRole("button", { name: "I agree" });
      if (await agree.count()) await agree.click();
      await (await chooser).setFiles(file);
      await form.getByRole("img", { name: "Your photo of the piece" }).waitFor({ timeout: 8000 });
    }
    await form.getByRole("button", { name: "Add to my wardrobe" }).click();
    await p.waitForTimeout(400);
  }

  for (const device of ["desktop", "phone"]) {
    await scenario("P4-6d", "The wardrobe: open it from the menu, add pieces with and without a photo, correct one, remove one and undo", device, async (p, shot) => {
      await p.goto(`${BASE}/?mode=light`);
      await p.waitForTimeout(600);
      await menuClick(p, /^(Your wardrobe|Wardrobe)$/);
      await p.waitForURL(/\/wardrobe/);
      check(await p.getByRole("heading", { name: "Your wardrobe" }).isVisible(), "the wardrobe opens from the menu");
      check(/Nothing here yet/.test(await body(p)), "an empty wardrobe says so and offers Add a piece");
      await button(p, "Add a piece").click();
      await p.getByRole("region", { name: "Add a piece" }).getByRole("button", { name: "Add to my wardrobe" }).click();
      check(/Choose what kind of piece/.test(await body(p)), "a piece needs its type before it is added");
      await p.getByRole("region", { name: "Add a piece" }).getByRole("button", { name: "Cancel" }).click();
      await addPiece(p, { kind: "Top", name: "Linen overshirt", colour: "Ecru" });
      await addPiece(p, { kind: "Shoes", file: await photoFile(p, { width: 800, height: 800 }) });
      check((await pieceRows(p).count()) === 2, "both pieces are listed");
      const text = await body(p);
      check(/Linen overshirt/.test(text) && /Top, ecru/.test(text), "the named piece shows its type and colour");
      check(/Your own shoes/.test(text) && (await p.getByRole("img", { name: "Your photo of Your own shoes" }).count()) === 1, "the photographed piece gets a default name and shows its photo");
      await button(p, "Edit Linen overshirt").click();
      await p.getByLabel("What you call it").fill("Linen shirt");
      await p.getByLabel("Colour (optional)").fill("White");
      await button(p, "Save changes").click();
      await p.waitForTimeout(300);
      check(/Linen shirt/.test(await body(p)) && /Top, white/.test(await body(p)), "a correction is saved");
      await button(p, "Remove Linen shirt").click();
      await p.waitForTimeout(300);
      check((await pieceRows(p).count()) === 1 && /Linen shirt removed/.test(await body(p)), "one piece is removed, the other stays");
      await button(p, "Undo").click();
      await p.waitForTimeout(300);
      check((await pieceRows(p).count()) === 2, "Undo brings it back");
      await p.reload();
      await p.waitForTimeout(800);
      check((await pieceRows(p).count()) === 2 && /Linen shirt/.test(await body(p)), "the wardrobe is still there after a reload");
      const stored = await p.evaluate(() => localStorage.getItem("praxis_wardrobe") ?? "");
      check(!stored.includes("data:image"), "no photo is kept on the device");
      const ev = await events(p);
      check(named(ev, "wardrobe_item_added").filter((e) => e.properties.surface === "wardrobe").length === 2 && named(ev, "wardrobe_item_edited").length === 1 && named(ev, "wardrobe_item_removed").length === 1, "adding, editing and removing are each counted");
      check(!JSON.stringify(ev).includes("Linen"), "events never carry a piece's name");
      await shot("wardrobe");
    });
  }

  await scenario("P5-6g", "A wardrobe photo fills in the piece's colour, read on the device, and the customer can change it", "phone", async (p) => {
    await p.goto(`${BASE}/wardrobe?mode=light`);
    await p.waitForTimeout(600);
    const outside = [];
    p.on("request", (r) => !r.url().startsWith(BASE) && !/fonts\.(googleapis|gstatic)\.com/.test(r.url()) && outside.push(r.url()));
    await addPiece(p, { kind: "Top", file: await garmentFile(p) });
    check(/Top, navy/.test(await body(p)), "the navy shirt is listed as navy");
    check(outside.length === 0, "reading the colour sends nothing off the site");
    await button(p, "Add a piece").click();
    const form = p.getByRole("region", { name: "Add a piece" });
    await form.getByRole("radio", { name: "Top" }).click();
    await form.getByLabel("Colour (optional)").fill("Ecru");
    const chooser = p.waitForEvent("filechooser", { timeout: 5000 });
    await form.getByRole("button", { name: /Add a photo/ }).click();
    const agree = form.getByRole("button", { name: "I agree" });
    if (await agree.count()) await agree.click();
    await (await chooser).setFiles(await garmentFile(p, "#6c1e2c"));
    await form.getByRole("img", { name: "Your photo of the piece" }).waitFor({ timeout: 8000 });
    check((await form.getByLabel("Colour (optional)").inputValue()) === "Ecru", "a colour the customer typed is never replaced");
  });

  await scenario("P4-6e", "A wardrobe piece is used in the looks, from the wardrobe and from Make it yours, as the client's own", "desktop", async (p) => {
    await p.goto(`${BASE}/wardrobe?mode=light`);
    await p.waitForTimeout(600);
    await addPiece(p, { kind: "Bottom", name: "Grey flannels", colour: "Grey" });
    await toResults(p, A);
    await p.goto(p.url().replace("/moment/results", "/wardrobe"));
    await p.waitForTimeout(600);
    await button(p, "Use Grey flannels in my looks").click();
    await p.waitForURL(/moment\/results/, { timeout: 15000 });
    await p.waitForTimeout(800);
    let { request, response } = await latest(H, p);
    const id = (await p.evaluate(() => JSON.parse(localStorage.getItem("praxis_wardrobe"))[0].wardrobeItemId));
    check(request.wardrobeItems.length === 1 && request.wardrobeItems[0].wardrobeItemId === id && request.wardrobeItems[0].label === "Grey flannels" && request.wardrobeItems[0].colour === "Grey" && request.wardrobeItems[0].source === "described", "the request names that same piece, its colour and that it is described");
    check(response.outfits.every((o) => o.garments.filter((g) => g.slot === "bottom").every((g) => g.source === "wardrobe")), "every look keeps it and never prices it");
    await p.locator(".a-personal-card").filter({ visible: true }).nth(1).click();
    await p.waitForURL(/moment\/you\/item/);
    await button(p, "Choose another piece").click();
    await p.getByRole("radio", { name: "Bottom" }).first().click();
    await p.waitForTimeout(300);
    check((await p.getByRole("radio", { name: /Grey flannels.*From your wardrobe/ }).count()) === 1, "Make it yours offers the wardrobe piece first");
    await p.getByRole("radio", { name: /Grey flannels/ }).click();
    await p.waitForURL(/moment\/results/, { timeout: 15000 });
    ({ request } = await latest(H, p));
    check(request.wardrobeItems[0]?.wardrobeItemId === id, "chosen there, it is the same piece");
    check(named(await events(p), "wardrobe_item_used").length === 2, "each use is counted");
    check((await p.evaluate(() => JSON.parse(localStorage.getItem("praxis_wardrobe")).length)) === 1, "using a piece does not add it twice");
  });

  await scenario("P4-6f", "Each account sees only its own wardrobe on a shared device", "desktop", async (p) => {
    await p.goto(`${BASE}/wardrobe?mode=light`);
    await p.waitForTimeout(600);
    await signInWith(p, /Apple/);
    await p.goto(`${BASE}/wardrobe?mode=light`);
    await p.waitForTimeout(600);
    await addPiece(p, { kind: "Accessory", name: "Steel watch" });
    await menuClick(p, /open menu|Menu/);
    await p.waitForTimeout(300);
    await button(p, "Sign out").click();
    await p.waitForTimeout(800);
    await p.goto(`${BASE}/wardrobe?mode=light`);
    await p.waitForTimeout(600);
    check(!/Steel watch/.test(await body(p)) && /Nothing here yet/.test(await body(p)), "after sign out, the next person sees none of it");
    await signInWith(p, /Apple/);
    await p.goto(`${BASE}/wardrobe?mode=light`);
    await p.waitForTimeout(600);
    check(/Steel watch/.test(await body(p)), "signing in again brings it back");
  }, { previewSignIn: true });
}
