# Sole Room

An endless, curved white gallery of sneakers. You walk a ring-shaped room with
shoe racks on both walls; it never ends because the corridor loops.

- **Scroll / swipe**: walk forward or back. When you stop, the room keeps drifting slowly.
- **Hover a pair** (desktop): you stop at that rack and lean in, framed so the whole rack fits. The pair lifts forward and a label shows its name and price.
- **On phones**: swipe up/down to walk (the camera angles toward one wall so the racks fill the tall screen). Tap a rack to lean in, then tap a pair to open it. A slim buy bar follows you down the product page.
- **Click a pair**: opens its product page with photos, name, colourway, price/MRP, UK sizes (sold-out sizes crossed out), details, and *Add to bag*.
- **Bag button** (top right): shows a count badge and opens the bag drawer (change quantity, remove, subtotal, checkout).

All product data is **real**: 80 sneakers (Nike, adidas, Jordan, Onitsuka Tiger, New Balance, Asics) with
INR prices, sizes, descriptions and photos. They were scraped from the public Shopify product feeds of
[superkicks.in](https://www.superkicks.in) and [dawntown.co.in](https://www.dawntown.co.in) (for Onitsuka Tiger).
The snapshot is committed, so the site is deterministic: the same shoes always sit on the same racks.

```
static/                  ← the whole website (deploy this folder)
  index.html             ← single page: room + product view + bag
  css/style.css
  js/data.js             ← loads data/products.json, shared helpers
  js/gallery.js          ← Three.js room, walking, hover/zoom, picking
  js/product.js          ← product page (route #/p/<id>)
  js/cart.js             ← bag state (localStorage), badge, drawer
  js/checkout.js         ← payment hook (demo now; Razorpay/Stripe stubs)
  js/app.js              ← tiny hash router
  data/products.json     ← scraped catalogue
  shoes/<id>/            ← cutout.webp (rack image) + 1..5.webp (product photos)
scraper/scrape.py        ← re-scrapes the catalogue + images
streamlit_app.py         ← optional Streamlit host
deploy/github-pages.yml  ← GitHub Pages workflow (copy into .github/workflows/)
```

## Run locally

It's a static site, but it loads JSON, so open it over http (not `file://`):

```bash
python3 -m http.server 8765 --directory static
```

Then open http://localhost:8765.

## Host on GitHub Pages (recommended)

1. Add the workflow. On GitHub choose **Add file → Create new file**, name it `.github/workflows/pages.yml`, and paste
   the contents of [`deploy/github-pages.yml`](deploy/github-pages.yml). (It lives outside `.github/` because pushing
   workflow files needs a token with the `workflow` scope.)
2. Go to **Settings → Pages → Build and deployment → Source: GitHub Actions**.
3. Every push to `main` now publishes `static/`. Your URL is `https://<user>.github.io/<repo>/`.

Any static host works the same way (Netlify, Vercel, Cloudflare Pages): set the publish directory to `static`, with no build step.

## Host on Streamlit Community Cloud

```bash
pip install -r requirements.txt
streamlit run streamlit_app.py
```

To deploy, point Streamlit Cloud at `streamlit_app.py`. The wrapper serves the images from `static/` and
inlines the HTML, CSS and JS into one full-screen component.
`.streamlit/config.toml` turns on `enableStaticServing`, which this needs.

## Refresh the catalogue

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r scraper/requirements.txt
python scraper/scrape.py --dry-run   # preview the pick
python scraper/scrape.py             # rewrite static/data + static/shoes
```

To change the brand mix, edit `QUOTA` in `scraper/scrape.py`. The room has 52 racks × 6 pairs = 312 slots,
and the catalogue repeats around the loop.
The picks are stable for the same store inventory, but stores change stock, so a re-scrape can pick different pairs.

## Adding payments later

The only place to change is `static/js/checkout.js`:

- It builds an order payload (`items`, `amount` in INR).
- `PROVIDER = "demo"` today: it shows a "payments aren't switched on" message and keeps the bag.
- Stubs for **Razorpay** (UPI and cards in India) and **Stripe** are included. Both expect a small backend
  (for example a Vercel/Netlify/Cloudflare function) that creates the order or session with your **secret** key.
  Never put a secret key in the frontend. Set `API_BASE` and switch `PROVIDER`.

Other natural next steps: stock and price re-sync on a schedule (GitHub Action running the scraper), search,
filtering racks by brand, and a real orders table.

## Notes

- 3D uses Three.js r160 from jsDelivr. There's no build tooling.
- The room respects `prefers-reduced-motion`: no auto-drift, no camera bob.
- Product names, prices and photos belong to the brands and retailers. This is a demo storefront UI.
  Before going live commercially, use your own product photography or licensed feeds.
