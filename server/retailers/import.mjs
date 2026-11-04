/**
 * Imports one retailer's catalogue into Postgres (retailers, products, product_variants) from any
 * connector (server/retailers/connector.mjs), in one transaction, and returns a report.
 *
 * - Idempotent: products upsert on (retailer, external id) and variants on (product, external id), with
 *   ids derived from those keys, so running the same import twice changes nothing.
 * - A piece that leaves the feed is kept: it gets removed_at and its variants become unavailable. A
 *   variant that leaves a piece becomes unavailable. A piece that comes back is restored.
 * - Slots come from the shared ontology (src/shared/ontology.mjs), read from the title and type, then
 *   the tags, exactly as the live store feed reads them. A piece the ontology doesn't place keeps no slot
 *   and is listed in the report as unmapped; nothing is guessed. Things that aren't clothes (gift cards,
 *   shipping protection) are listed apart and not counted.
 * - A piece whose photos change loses its cut-out and vector, so they are made again (Week 1 phase 4).
 */
import { createHash } from "node:crypto";
import { classify, colourOf } from "../../src/shared/ontology.mjs";
import { problemsWith } from "./connector.mjs";

/** Things a store sells that aren't clothes, so they can't have a slot and aren't counted as unmapped. */
export const NOT_A_GARMENT = /\b(gift ?cards?|gift certificates?|e-?gifts?|shipping|delivery protection|insurance|donations?|swatch(es)?|warrant(y|ies)|repairs?|alterations?)\b/i;

const hash = (text, n) => createHash("sha256").update(text).digest("hex").slice(0, n);
/** From the connector's id (shopify:<store>, csv:<file name>), so the same source gets the same id on every machine. */
export const retailerIdFor = (connectorId) => `ret_${hash(connectorId, 16)}`;
export const productIdFor = (retailerId, externalId) => `prod_${hash(`${retailerId}|${externalId}`, 24)}`;
export const variantIdFor = (productId, externalId) => `var_${hash(`${productId}|${externalId}`, 24)}`;

/** The ontology's reading of a piece: { slot, layer, subcategory, colour } or null when it doesn't place it. */
export function placeItem(item) {
  const kind = classify(item.title, item.productType ?? "") ?? classify(item.tags.join(" "));
  if (!kind) return null;
  const colour = colourOf(item.title) ?? colourOf(item.variants.map((v) => v.colour ?? "").join(" ")) ?? colourOf(item.tags.join(" "));
  return { slot: kind.slot, layer: kind.layer ?? null, subcategory: kind.subcategory, colour: colour ?? null };
}

export const isGarment = (item) => !NOT_A_GARMENT.test(`${item.title} ${item.productType ?? ""}`);
const inStock = (item) => item.variants.some((v) => v.available);
const brief = (item) => ({ externalId: item.externalId, title: item.title, productType: item.productType, inStock: inStock(item) });

/**
 * Runs the import. `pool` is a pg Pool (or anything with connect()). Returns the report; throws (and
 * changes nothing) if the connector can't be read or the database refuses.
 */
export async function importRetailer(pool, connector, { now = new Date() } = {}) {
  const startedAt = now.toISOString();
  const items = await connector.items();
  const name = await connector.name();
  const retailerId = retailerIdFor(connector.id);

  const valid = [];
  const invalid = [];
  for (const item of items) {
    const problems = problemsWith(item);
    if (problems.length) invalid.push({ externalId: item?.externalId ?? null, title: item?.title ?? null, problems });
    else valid.push(item);
  }
  const seen = new Set();
  const unique = valid.filter((i) => (seen.has(i.externalId) ? false : seen.add(i.externalId)));

  const report = {
    retailerId,
    name,
    kind: connector.kind,
    source: connector.source,
    startedAt,
    finishedAt: null,
    items: unique.length,
    variants: unique.reduce((n, i) => n + i.variants.length, 0),
    created: 0,
    updated: 0,
    restored: 0,
    removed: 0,
    variantsMadeUnavailable: 0,
    garments: 0,
    inStockGarments: 0,
    slottedInStock: 0,
    slottedPercent: 100,
    bySlot: { top: 0, bottom: 0, shoes: 0, extras: 0 },
    unmapped: [],
    notGarments: [],
    rejected: [...(connector.rejected ?? []), ...invalid],
  };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO retailers (retailer_id, name, kind, source, currency, last_imported_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (retailer_id) DO UPDATE SET name = EXCLUDED.name, currency = EXCLUDED.currency, last_imported_at = EXCLUDED.last_imported_at`,
      [retailerId, name, connector.kind, connector.source, unique[0]?.currency ?? "USD", startedAt],
    );

    for (const item of unique) {
      const garment = isGarment(item);
      const place = garment ? placeItem(item) : null;
      if (!garment) report.notGarments.push(brief(item));
      else {
        report.garments += 1;
        if (inStock(item)) report.inStockGarments += 1;
        if (place) {
          report.bySlot[place.slot] += 1;
          if (inStock(item)) report.slottedInStock += 1;
        } else report.unmapped.push(brief(item));
      }

      const productId = productIdFor(retailerId, item.externalId);
      const { rows } = await client.query(
        `INSERT INTO products (product_id, retailer_id, external_id, title, brand, description, product_url, images,
                               slot, layer, subcategory, colour, price_amount, currency, first_seen_at, last_seen_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14, $15, $15, $15)
         ON CONFLICT (retailer_id, external_id) DO UPDATE SET
           title = EXCLUDED.title, brand = EXCLUDED.brand, description = EXCLUDED.description,
           product_url = EXCLUDED.product_url, images = EXCLUDED.images,
           slot = EXCLUDED.slot, layer = EXCLUDED.layer, subcategory = EXCLUDED.subcategory, colour = EXCLUDED.colour,
           price_amount = EXCLUDED.price_amount, currency = EXCLUDED.currency,
           cutout_url = CASE WHEN products.images IS DISTINCT FROM EXCLUDED.images THEN NULL ELSE products.cutout_url END,
           embedding = CASE WHEN products.images IS DISTINCT FROM EXCLUDED.images THEN NULL ELSE products.embedding END,
           last_seen_at = EXCLUDED.last_seen_at, removed_at = NULL,
           updated_at = CASE WHEN (products.title, products.brand, products.description, products.product_url, products.images,
                                   products.slot, products.layer, products.subcategory, products.colour, products.price_amount,
                                   products.currency, products.removed_at)
                                  IS DISTINCT FROM
                                  (EXCLUDED.title, EXCLUDED.brand, EXCLUDED.description, EXCLUDED.product_url, EXCLUDED.images,
                                   EXCLUDED.slot, EXCLUDED.layer, EXCLUDED.subcategory, EXCLUDED.colour, EXCLUDED.price_amount,
                                   EXCLUDED.currency, NULL::timestamptz)
                             THEN EXCLUDED.updated_at ELSE products.updated_at END
         RETURNING (xmax = 0) AS inserted, (updated_at = $15) AS changed, (SELECT removed_at IS NOT NULL FROM products p WHERE p.product_id = $1) AS was_removed`,
        [productId, retailerId, item.externalId, item.title, item.brand, item.description, item.productUrl, JSON.stringify(item.images),
         place?.slot ?? null, place?.layer ?? null, place?.subcategory ?? null, place?.colour ?? null, item.price, item.currency, startedAt],
      );
      const r = rows[0];
      if (r.inserted) report.created += 1;
      else if (r.changed) report.updated += 1;
      if (!r.inserted && r.was_removed) report.restored += 1;

      const variantIds = [];
      for (const v of item.variants) {
        const variantId = variantIdFor(productId, v.externalId);
        variantIds.push(variantId);
        await client.query(
          `INSERT INTO product_variants (variant_id, product_id, external_id, size, colour, sku, price_amount, currency, available, stock_quantity, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
           ON CONFLICT (product_id, external_id) DO UPDATE SET
             size = EXCLUDED.size, colour = EXCLUDED.colour, sku = EXCLUDED.sku, price_amount = EXCLUDED.price_amount,
             currency = EXCLUDED.currency, available = EXCLUDED.available, stock_quantity = EXCLUDED.stock_quantity,
             updated_at = CASE WHEN (product_variants.size, product_variants.colour, product_variants.sku, product_variants.price_amount,
                                     product_variants.currency, product_variants.available, product_variants.stock_quantity)
                                    IS DISTINCT FROM
                                    (EXCLUDED.size, EXCLUDED.colour, EXCLUDED.sku, EXCLUDED.price_amount,
                                     EXCLUDED.currency, EXCLUDED.available, EXCLUDED.stock_quantity)
                               THEN EXCLUDED.updated_at ELSE product_variants.updated_at END`,
          [variantId, productId, v.externalId, v.size, v.colour, v.sku, v.price, v.currency, v.available, v.stockQuantity, startedAt],
        );
      }
      const gone = await client.query(
        `UPDATE product_variants SET available = false, updated_at = $3
         WHERE product_id = $1 AND available AND NOT (variant_id = ANY($2::text[]))`,
        [productId, variantIds, startedAt],
      );
      report.variantsMadeUnavailable += gone.rowCount;
    }

    // Pieces that left the feed: kept, marked removed, their sizes unavailable.
    const removed = await client.query(
      `UPDATE products SET removed_at = $3, updated_at = $3
       WHERE retailer_id = $1 AND removed_at IS NULL AND NOT (external_id = ANY($2::text[]))
       RETURNING product_id`,
      [retailerId, unique.map((i) => i.externalId), startedAt],
    );
    report.removed = removed.rowCount;
    if (removed.rowCount) {
      const off = await client.query(
        `UPDATE product_variants SET available = false, updated_at = $2 WHERE available AND product_id = ANY($1::text[])`,
        [removed.rows.map((r) => r.product_id), startedAt],
      );
      report.variantsMadeUnavailable += off.rowCount;
    }
    await client.query("COMMIT");
  } catch (e) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw e;
  } finally {
    client.release();
  }

  report.slottedPercent = report.inStockGarments ? Math.round((1000 * report.slottedInStock) / report.inStockGarments) / 10 : 100;
  report.finishedAt = new Date().toISOString();
  return report;
}

/** The report as a few lines of plain text, for the command line and the log. */
export function describeReport(r) {
  const lines = [
    `${r.name} (${r.kind}: ${r.source}) as ${r.retailerId}`,
    `  ${r.items} pieces, ${r.variants} sizes: ${r.created} new, ${r.updated} changed, ${r.restored} back in the feed, ${r.removed} left the feed (kept, marked removed); ${r.variantsMadeUnavailable} sizes made unavailable`,
    `  slots: top ${r.bySlot.top}, bottom ${r.bySlot.bottom}, shoes ${r.bySlot.shoes}, extras ${r.bySlot.extras}`,
    `  in-stock garments slotted: ${r.slottedInStock} of ${r.inStockGarments} (${r.slottedPercent}%)`,
  ];
  for (const u of r.unmapped) lines.push(`  unmapped: ${u.externalId} "${u.title}" (type ${u.productType ?? "none"}${u.inStock ? ", in stock" : ", sold out"})`);
  for (const n of r.notGarments) lines.push(`  not a garment, skipped: ${n.externalId} "${n.title}"`);
  for (const x of r.rejected) lines.push(`  rejected: ${x.line ? `line ${x.line} ` : ""}${x.productId ?? x.externalId ?? ""}: ${(x.reasons ?? x.problems).join("; ")}`);
  return lines.join("\n");
}
