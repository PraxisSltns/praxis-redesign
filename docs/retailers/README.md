# Bringing a retailer's catalogue into Praxis

This is the onboarding kit. The first part is for the retailer: what to send. The second part is for whoever runs the import: the commands, in order.

Nothing a retailer sends is shown to customers until two things are true: the retailer has agreed in writing to their pieces being shown, and the server is switched to show them (`CATALOGUE_MATCHING_FOR=everyone`). Until then, their pieces appear only in tabs opened for testing (`?stock=live`).

## For the retailer

Praxis builds outfits for an occasion from real pieces in partner stores. Each piece is shown as a clean cut-out of its own photo, with its price, the sizes in stock, and a link to buy it on your site. People buy on your site, not ours.

There are two ways to share your catalogue. Pick one.

### Option 1: your Shopify store

Send us your store's address, for example `www.your-store.com` or `your-store.myshopify.com`.

- We read your public product list, the same one your online shop shows: names, descriptions, photos, prices, sizes and stock.
- There is nothing to install and no password to share.
- We read up to 2,500 products. Tell us if you have more.
- If your store is password-protected, or you've turned the public product list off, use Option 2 for now.

### Option 2: a CSV file

Fill in [catalogue-template.csv](catalogue-template.csv), or export your own file with the same column names. Send us the file, and send a new one whenever your catalogue changes, at least weekly while stock moves.

- **One row per size.** A blazer in sizes 38, 40 and 42 has three rows that share a `product_id`. The piece's name, description and photos only need to be on its first row.
- **Required in every row:** `product_id`, `title`, `product_url`, `price`, `currency`.
- **Strongly recommended:**
  - `image_urls`: without a photo, a piece can't be shown.
  - `size` and `available` (or `stock_quantity`): without them, we show the piece as in stock in one size.
  - `product_type` (for example `Blazers` or `Footwear`): it helps us tell what kind of piece it is when the name doesn't.
- **Keep `product_id` the same between files.** That's how a new file updates a piece instead of adding a copy. A piece missing from a new file is hidden, not deleted, and comes back if it reappears.
- **Every column, with its rules:** [docs/CATALOGUE.md, "CSV catalogue files"](../CATALOGUE.md#csv-catalogue-files).

### Photos

Your photos decide how good your pieces look in Praxis.

- Use the photo of **the piece on its own**: on a plain background, on a mannequin, or as a flat lay. A photo of a model wearing a full outfit works, but the cut-out may include other clothes.
- Put the main photo first in `image_urls`, at least 800 pixels on the long side.
- Use `https://` addresses we can open without signing in.
- When you change a photo, we make a new cut-out automatically.

### What customers see

- **What's shown:** the piece's name, your store's name, the price as you give it, the sizes in stock, and a link to the piece on your site.
- **Prices:** shown as you give them, in your currency, never converted.
- **Sold out:** a piece that's sold out in every size isn't shown until it's back in stock.

## For the operator

Run these on the server, or locally against staging's database. Steps 3–5 use the database and bucket of whichever environment you're in.

**1. Check before importing.** This writes nothing, and works with the file or store address the retailer sent:

```bash
npm run retailers:check -- --csv their-file.csv
npm run retailers:check -- --shopify www.their-store.com
```

It lists every problem, in this order:
- rows left out, with line numbers
- repeated ids
- pieces it can't tell the kind of
- pieces without a photo
- pieces sold out in every size
- things that aren't clothing

It ends with how many pieces would be ready. **Send the problem list to the retailer, and import once you're happy with the result.**

**2. Choose the store's id once, and keep it.** Use lower-case words with dashes, for example `harbour-and-hide`. Use the same id for every file that retailer ever sends. A Shopify store's id is its address.

**3. Import:**

```bash
npm run retailers:import -- --csv their-file.csv --store harbour-and-hide --name "Harbour & Hide"
npm run retailers:import -- --shopify www.their-store.com --name "Their Store"
```

**4. Make the cut-outs and vectors.** On staging the nightly job does this at 03:00 UTC, or start it straight away:

```bash
railway cron run -s catalogue-job -e staging --yes   # on staging
npm run catalogue:process                             # locally
```

At 8 CPUs, a piece takes a few seconds.

**5. See where each store stands:**

```bash
npm run retailers:report
npm run retailers:report -- --store csv:harbour-and-hide
```

For each store it gives:
- how many pieces can be shown now
- how many are processed, waiting, or failed (with the reason, such as a photo that couldn't be found)
- how many weren't recognised as clothing or have no photo

**6. Before customers see them,** confirm the retailer's written agreement. Then set `CATALOGUE_MATCHING_FOR=everyone` on the gateway. That opens the catalogue in looks and in Find a piece for every visitor.
