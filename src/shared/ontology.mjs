/**
 * The garment ontology Praxis styles with: what a piece is (slot, layer, subcategory), how formal it
 * is (1 very casual to 5 formal), its colour family, material, fit and seasons. Plain JavaScript so
 * the server (filing a store's pieces, server/providers/shopify-feed.mjs) and the page (composing
 * looks, src/core/catalogue) read pieces the same way. Types: ontology.d.mts.
 */

/** Most specific first: the first match decides (so "oxford shoes" are shoes before "oxford" makes a shirt). Each: id, slot, layer (tops only), formality, words. */
export const SUBCATEGORIES = [
  // A knit or silk tie is a tie, not knitwear: this comes before "knit" (the plain "tie" entry stays near the end).
  { id: "tie", slot: "extras", formality: 5, words: /\b(knit|knitted|silk|wool|linen|cashmere|grenadine|neck|bow) ties?\b/ },
  { id: "suit-trousers", slot: "bottom", formality: 5, words: /\bsuit (trousers?|pants?)\b/ },
  { id: "suit-jacket", slot: "top", layer: "outer", formality: 5, words: /\b(suit jacket|suit|tuxedo|dinner jacket)\b/ },
  // "Leather oxfords" are shoes: an oxford named by its leather or suede is never the shirt (that rule comes later).
  { id: "dress-shoes", slot: "shoes", formality: 5, words: /\b((oxford|derby|dress|lace-up|leather) shoes?|(leather|suede|patent|calf) (oxfords?|derbys?|derbies)|brogues?|monk ?straps?)\b/ },
  { id: "blazer", slot: "top", layer: "outer", formality: 4, words: /\b(blazers?|sport ?coats?|tailored jackets?)\b/ },
  { id: "overcoat", slot: "top", layer: "outer", formality: 4, words: /\b(overcoats?|topcoats?|trench( coats?)?|peacoats?|car coats?)\b/ },
  { id: "overshirt", slot: "top", layer: "outer", formality: 2, words: /\b(overshirts?|shirt jackets?|shackets?|chore (coats?|jackets?))\b/ },
  { id: "cardigan", slot: "top", layer: "outer", formality: 3, words: /\bcardigans?\b/ },
  { id: "jacket", slot: "top", layer: "outer", formality: 2, words: /\b(bombers?|truckers?|harringtons?|field jackets?|jackets?|parkas?|anoraks?|coats?|outerwear|gilets?|vests?)\b/ },
  { id: "dress-shirt", slot: "top", layer: "base", formality: 4, words: /\b(dress shirts?|formal shirts?|tuxedo shirts?)\b/ },
  { id: "polo", slot: "top", layer: "base", formality: 3, words: /\bpolos?\b/ },
  { id: "knit", slot: "top", layer: "base", formality: 3, words: /\b(sweaters?|knits?|knitwear|crew ?necks?|crews?|merino|cashmere|turtlenecks?|roll ?necks?|jumpers?|pullovers?|quarter zips?)\b/ },
  { id: "sweatshirt", slot: "top", layer: "base", formality: 1, words: /\b(hoodies?|sweatshirts?)\b/ },
  { id: "t-shirt", slot: "top", layer: "base", formality: 1, words: /\b(t-shirts?|tees?|henleys?|tanks?)\b/ },
  { id: "shirt", slot: "top", layer: "base", formality: 3, words: /\b(shirts?|oxfords?|button[ -]downs?|chambray|flannels?)\b/ },
  { id: "chinos", slot: "bottom", formality: 3, words: /\b(chinos?|khakis?)\b/ },
  { id: "jeans", slot: "bottom", formality: 2, words: /\b(jeans?|denim)\b/ },
  { id: "shorts", slot: "bottom", formality: 1, words: /\bshorts?\b/ },
  { id: "joggers", slot: "bottom", formality: 1, words: /\b(joggers?|sweatpants?|track ?pants?)\b/ },
  { id: "trousers", slot: "bottom", formality: 4, words: /\b(trousers?|dress pants?|slacks|tailored pants?|pleated pants?)\b/ },
  { id: "pants", slot: "bottom", formality: 2, words: /\b(pants?|cargos?|fatigues?|ripstop)\b/ },
  { id: "loafers", slot: "shoes", formality: 4, words: /\b(loafers?|moccasins?)\b/ },
  { id: "chelsea-boots", slot: "shoes", formality: 4, words: /\bchelsea( boots?)?\b/ },
  { id: "boots", slot: "shoes", formality: 3, words: /\b(boots?|chukkas?)\b/ },
  { id: "sneakers", slot: "shoes", formality: 2, words: /\b(sneakers?|trainers?|plimsolls?)\b/ },
  { id: "sandals", slot: "shoes", formality: 1, words: /\b(sandals?|slides?|mules?)\b/ },
  { id: "tie", slot: "extras", formality: 5, words: /\b(ties?|bow ties?)\b/ },
  { id: "belt", slot: "extras", formality: 3, words: /\bbelts?\b/ },
  { id: "accessory", slot: "extras", formality: 2, words: /\b(watch(es)?|scarf|scarves|hats?|caps?|beanies?|bags?|totes?|socks?|wallets?|sunglasses|pocket squares?)\b/ },
];

/** A subcategory that can stand in for another without changing the look. */
export const STANDS_IN_FOR = {
  "suit-jacket": ["blazer"],
  blazer: ["suit-jacket"],
  overshirt: ["jacket", "cardigan"],
  jacket: ["overshirt"],
  cardigan: ["overshirt"],
  "dress-shirt": ["shirt"],
  shirt: ["dress-shirt"],
  polo: ["knit"],
  knit: ["polo"],
  "t-shirt": [],
  trousers: ["suit-trousers", "chinos"],
  "suit-trousers": ["trousers"],
  chinos: ["trousers", "pants"],
  pants: ["chinos"],
  "dress-shoes": ["loafers"],
  loafers: ["dress-shoes"],
  "chelsea-boots": ["boots"],
  boots: ["chelsea-boots"],
};

/** What a piece is, from the store's own type first, then its name and tags. Null when Praxis doesn't style it. */
export function classify(text, type = "") {
  const t = String(type).toLowerCase();
  const all = `${t} ${String(text).toLowerCase()}`;
  if (/\b(gift ?cards?|women'?s?|womens|kids?|e-?gift|insurance|shipping protection|sample sale)\b/.test(all)) return null;
  const hit = SUBCATEGORIES.find((s) => s.words.test(String(text).toLowerCase())) ?? SUBCATEGORIES.find((s) => s.words.test(t));
  return hit ? { subcategory: hit.id, slot: hit.slot, ...(hit.layer ? { layer: hit.layer } : {}), formality: hit.formality } : null;
}

/** Colour words and the family each belongs to. */
const COLOURS = [
  ["off-white", "white"], ["white", "white"], ["ivory", "white"], ["cream", "white"], ["ecru", "white"], ["bone", "white"], ["natural", "white"],
  ["black", "black"], ["charcoal", "grey"], ["grey", "grey"], ["gray", "grey"], ["heather", "grey"], ["slate", "grey"],
  ["navy", "navy"], ["indigo", "navy"], ["midnight", "navy"], ["dark blue", "navy"],
  ["light blue", "blue"], ["sky", "blue"], ["blue", "blue"], ["chambray", "blue"],
  ["olive", "green"], ["sage", "green"], ["forest", "green"], ["green", "green"], ["moss", "green"],
  ["khaki", "beige"], ["sand", "beige"], ["stone", "beige"], ["oat", "beige"], ["beige", "beige"], ["taupe", "beige"],
  ["tan", "brown"], ["camel", "brown"], ["cognac", "brown"], ["tobacco", "brown"], ["chocolate", "brown"], ["brown", "brown"], ["espresso", "brown"],
  ["burgundy", "burgundy"], ["wine", "burgundy"], ["oxblood", "burgundy"], ["maroon", "burgundy"],
  ["rust", "orange"], ["orange", "orange"], ["red", "red"], ["pink", "pink"], ["yellow", "yellow"], ["mustard", "yellow"], ["purple", "purple"],
];
/** Families that go with anything. */
export const NEUTRALS = ["black", "white", "grey", "navy", "beige", "brown"];

/** The first colour named, as a family. */
export function colourOf(text) {
  const t = ` ${String(text).toLowerCase()} `;
  let best = null;
  for (const [word, family] of COLOURS) {
    const at = t.search(new RegExp(`[^a-z]${word}[^a-z]`));
    if (at >= 0 && (best === null || at < best.at)) best = { at, family };
  }
  return best ? best.family : undefined;
}

const MATERIALS = ["cashmere", "merino", "tweed", "flannel", "wool", "linen", "silk", "corduroy", "denim", "suede", "leather", "ripstop", "canvas", "twill", "jersey", "cotton"];
/** The first material named. */
export function materialOf(text) {
  const t = String(text).toLowerCase();
  return MATERIALS.find((m) => new RegExp(`\\b${m}\\b`).test(t));
}

/** Slim, regular or relaxed, when the store says. */
export function fitOf(text) {
  const t = String(text).toLowerCase();
  if (/\b(slim|skinny|tapered|fitted)\b/.test(t)) return "slim";
  if (/\b(relaxed|loose|oversized|boxy|wide)\b/.test(t)) return "relaxed";
  if (/\b(regular|classic fit|straight)\b/.test(t)) return "regular";
  return undefined;
}

/** When a material is worn. */
export function seasonsOf(material) {
  if (["cashmere", "merino", "tweed", "flannel", "wool", "corduroy"].includes(material)) return ["autumn", "winter", "spring"];
  if (material === "linen") return ["spring", "summer"];
  return ["spring", "summer", "autumn", "winter"];
}
