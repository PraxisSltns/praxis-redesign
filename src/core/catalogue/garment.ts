/**
 * One garment shape for every catalogue Praxis styles from: a store's pieces (Shopify today) and the
 * Praxis reference catalogue. The composer (compose.ts) reads only this shape, so a new store or a
 * wardrobe source plugs in by normalising into it.
 *
 * A store piece keeps the store's own ids, price, sizes, stock and link, exactly as read. A field the
 * store doesn't give stays out (unknown); nothing is filled in. A reference piece has no price, no
 * link and is never for sale here.
 */
import type { Availability, Layer, ProductRef, ReferenceImage, Slot } from "../contracts";
import type { ColourFamily, Fit, Formality, Season } from "../../shared/ontology.mjs";
import { STANDS_IN_FOR, classify, colourOf, fitOf, materialOf, seasonsOf } from "../../shared/ontology.mjs";
import { purchaseRoute } from "../validate";
import { apiUrl } from "../config";

export type { ColourFamily, Fit, Formality, Season };

export interface CatalogueGarment {
  id: string;
  source: "shopify" | "reference";
  slot: Slot;
  layer?: Layer;
  /** The ontology's subcategory, such as "blazer" or "chelsea-boots" (src/shared/ontology.mjs). */
  subcategory: string;
  /** The store's own filing, such as "Outerwear", when it gives one. */
  category?: string;
  name: string;
  brand?: string;
  colour?: ColourFamily;
  material?: string;
  fit?: Fit;
  silhouette?: string;
  formality: Formality;
  seasons?: Season[];
  styleAttributes: string[];
  /** The store's product photo (https), or for a reference piece its library photograph. */
  imageUrl?: string;
  /** A reference piece's crop of its library photograph. */
  image?: ReferenceImage;
  availability: Availability | "not_for_sale";
  /** Store pieces only: the store's own record, as read. */
  product?: ProductRef;
  retailerVariantId?: string;
  /** Reference pieces only: where the picture comes from and how it may be used. */
  attribution?: string;
  usageRights?: string;
}

/** Whether a store piece can be bought: a real price, an https link, not sold out. */
export function purchasable(g: CatalogueGarment): boolean {
  const p = g.product;
  return g.source === "shopify" && !!p && p.price > 0 && p.priceStatus === "live" && p.availability !== "out_of_stock" && !!p.purchase && p.purchase.kind !== "none";
}

/** Whether one subcategory can take another's place in a look. */
export function standsIn(wanted: string, offered: string): "same" | "close" | null {
  if (wanted === offered) return "same";
  return (STANDS_IN_FOR[wanted] ?? []).includes(offered) ? "close" : null;
}

/** What a store feed sends for one piece: the product as Praxis records it, the store's title and photos, and how the feed filed it. */
export type StoreProduct = ProductRef & {
  title?: unknown;
  photos?: unknown;
  attributes?: unknown;
};

const FAMILIES = new Set(["white", "black", "grey", "navy", "blue", "green", "beige", "brown", "burgundy", "orange", "red", "pink", "yellow", "purple"]);
const str = (v: unknown, max = 120): string | undefined => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : undefined);

/**
 * A store piece in the catalogue shape, or null when it can't be trusted: no real price, the wrong
 * currency, or nothing to say what it is. Read by the shared ontology when the feed didn't file it.
 * Links and photos are https only; stock stays as the store reported it.
 */
/** A catalogue cut-out served by the gateway (server/search.mjs cutoutPath). */
const CUTOUT_PATH = /^\/api\/cutouts\/prod_[0-9a-f]{24}\/[0-9a-f]{16}\.png$/;

export function fromStoreProduct(p: StoreProduct): CatalogueGarment | null {
  if (!p || typeof p !== "object" || typeof p.productId !== "string" || typeof p.retailerId !== "string" || typeof p.retailerName !== "string") return null;
  if (typeof p.price !== "number" || !(p.price > 0) || p.currency !== "USD") return null;
  const name = str(p.title) ?? p.category ?? "";
  const a = (p.attributes && typeof p.attributes === "object" ? p.attributes : {}) as Record<string, unknown>;
  const read = classify(name, p.category ?? "");
  const subcategory = str(a.subcategory, 40) ?? read?.subcategory;
  const slot = (["top", "bottom", "shoes", "extras"].includes(a.slot as string) ? a.slot : read?.slot) as Slot | undefined;
  if (!subcategory || !slot) return null;
  const layer = (a.layer === "outer" || a.layer === "base" ? a.layer : read?.layer) as Layer | undefined;
  const formality = ([1, 2, 3, 4, 5].includes(a.formality as number) ? a.formality : read?.formality) as Formality | undefined;
  if (!formality) return null;
  const colour = (FAMILIES.has(a.colour as string) ? a.colour : colourOf(name)) as ColourFamily | undefined;
  const material = str(a.material, 40) ?? materialOf(name);
  const photos = Array.isArray(p.photos) ? (p.photos as { src?: unknown }[]).map((x) => x?.src).filter((s): s is string => typeof s === "string" && /^https:\/\//i.test(s)) : [];
  // A store's own https photo, or a cut-out from our own catalogue on this server (/api/cutouts/...).
  const imageUrl = photos[0] ?? (p.imageUrl && /^https:\/\//i.test(p.imageUrl) ? p.imageUrl : p.imageUrl && CUTOUT_PATH.test(p.imageUrl) ? apiUrl(p.imageUrl) : undefined);
  const product: ProductRef = {
    productId: p.productId,
    retailerId: p.retailerId,
    retailerName: p.retailerName,
    ...(p.category ? { category: p.category } : {}),
    price: p.price,
    currency: "USD",
    priceStatus: p.priceStatus === "live" ? "live" : p.priceStatus === "estimated" ? "estimated" : "example",
    availability: p.availability === "in_stock" || p.availability === "out_of_stock" ? p.availability : "unknown",
    ...(Array.isArray(p.availableSizes) ? { availableSizes: p.availableSizes.filter((s) => typeof s === "string").slice(0, 30) } : {}),
    ...(p.sizeAvailability && typeof p.sizeAvailability === "object" ? { sizeAvailability: p.sizeAvailability } : {}),
    ...(p.productUrl && /^https:\/\//i.test(p.productUrl) ? { productUrl: p.productUrl } : {}),
    ...(imageUrl ? { imageUrl } : {}),
    ...(p.lastUpdatedAt ? { lastUpdatedAt: p.lastUpdatedAt } : {}),
    purchase: purchaseRoute(p.purchase) ?? { kind: "none", reason: "not_supported" },
  };
  const variant = str(a.variantId, 40);
  return {
    id: p.productId,
    source: "shopify",
    slot,
    ...(layer ? { layer } : {}),
    subcategory,
    ...(p.category ? { category: p.category } : {}),
    name: name.slice(0, 80) || subcategory,
    ...(str(a.brand) ? { brand: str(a.brand) } : {}),
    ...(colour ? { colour } : {}),
    ...(material ? { material, seasons: seasonsOf(material) } : {}),
    ...(a.fit === "slim" || a.fit === "regular" || a.fit === "relaxed" ? { fit: a.fit } : fitOf(name) ? { fit: fitOf(name) } : {}),
    formality,
    styleAttributes: Array.isArray(a.styleAttributes) ? (a.styleAttributes as unknown[]).filter((x): x is string => typeof x === "string").slice(0, 8) : [],
    ...(imageUrl ? { imageUrl } : {}),
    availability: product.availability,
    product,
    ...(variant ? { retailerVariantId: variant } : {}),
  };
}
