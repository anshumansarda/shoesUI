#!/usr/bin/env python3
"""
Snapshot real sneaker data (names, INR prices, sizes, descriptions, photos)
from public Shopify storefront feeds and write it into the static site.

Sources (public `products.json` endpoints every Shopify store exposes):
  - superkicks.in  -> Nike, Jordan, adidas, New Balance, Asics
  - dawntown.co.in -> Onitsuka Tiger

The selection is deterministic: candidates are filtered, ordered by a stable
hash of their handle, de-duplicated by silhouette, and the first N per brand
are kept. The output (static/data/products.json + static/shoes/<id>/*) is
committed, so the website itself never scrapes at runtime.

Usage:
    pip install -r scraper/requirements.txt
    python scraper/scrape.py            # full refresh
    python scraper/scrape.py --dry-run  # list what would be picked
"""
from __future__ import annotations

import argparse
import hashlib
import html
import io
import json
import re
import shutil
import sys
import time
import urllib.request
from datetime import date
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
SITE = ROOT / "static"
OUT_JSON = SITE / "data" / "products.json"
OUT_IMG = SITE / "shoes"

UA = {"User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 "
                    "(KHTML, like Gecko) Chrome/126 Safari/537.36"}

# brand -> how many shoes to keep (total 80 -> 240 rack slots / 3 laps)
QUOTA = {"Nike": 22, "adidas": 22, "Jordan": 12, "Onitsuka Tiger": 12,
         "New Balance": 6, "Asics": 6}
BRAND_ORDER = list(QUOTA)

GALLERY_MAX = 5          # product-page photos per shoe
GALLERY_WIDTH = 1000
CUTOUT_WIDTH = 640


# ----------------------------------------------------------------- fetching
def fetch(url: str, retries: int = 3) -> bytes:
    for attempt in range(retries):
        try:
            req = urllib.request.Request(url, headers=UA)
            with urllib.request.urlopen(req, timeout=40) as r:
                return r.read()
        except Exception as e:  # noqa: BLE001
            if attempt == retries - 1:
                raise
            print(f"  retry {url}: {e}", file=sys.stderr)
            time.sleep(2 * (attempt + 1))
    raise RuntimeError("unreachable")


def shopify_all(base: str, path: str = "products.json", max_pages: int = 30) -> list[dict]:
    items: list[dict] = []
    for page in range(1, max_pages + 1):
        data = json.loads(fetch(f"{base}/{path}?limit=250&page={page}"))
        batch = data.get("products", [])
        if not batch:
            break
        items.extend(batch)
        time.sleep(0.6)  # be polite
    return items


# ----------------------------------------------------------------- cleaning
SMALL_CAPS = {"OG", "SB", "SP", "QS", "PRM", "SE", "LX", "GTX", "II", "III", "IV",
              "NB", "TR", "ACG", "LE", "NRG", "AJ", "UK", "US", "EU", "BB", "XT",
              "TS", "RS", "SL", "NYC", "EX", "SD", "GT", "MT", "D", "CL", "NN"}


def nice_case(s: str) -> str:
    s = re.sub(r"\s+", " ", s).strip()
    s = re.sub(r"'([^']+)'", r'"\1"', s)
    def word(w: str) -> str:
        bare = re.sub(r"[^A-Za-z0-9]", "", w).upper()
        if bare in SMALL_CAPS or re.fullmatch(r"[A-Z]*\d+[A-Z0-9]*", bare or "x"):
            return w.upper()
        return w[:1].upper() + w[1:].lower() if w[:1].isalpha() else w[:2].upper() + w[2:].lower()
    parts = re.split(r"([ /\-])", s)
    out = "".join(word(t) if t not in (" ", "/", "-") else t for t in parts)
    out = re.sub(r'"([^"]*)"', "\u201c\\1\u201d", out)
    return out.replace('"', "\u201d")


ONITSUKA_MODELS = ["Mexico 66 Sabot", "Mexico 66 Slip-On", "Mexico 66 SD", "Mexico 66", "Tokuten Slip-On",
                   "Tokuten", "Serrano", "Delegation EX", "California 78", "Moage Co", "Ultimate 81", "Advanti"]


def html_to_blocks(raw: str) -> dict:
    """Shopify body_html -> {"paragraphs": [...], "bullets": [...]}."""
    raw = raw or ""
    bullets = [re.sub(r"<[^>]+>", "", b) for b in re.findall(r"<li[^>]*>(.*?)</li>", raw, re.S | re.I)]
    raw = re.sub(r"<li[^>]*>.*?</li>", "", raw, flags=re.S | re.I)
    raw = re.sub(r"<(br|/p|/div|/h\d)[^>]*>", "\n", raw, flags=re.I)
    text = html.unescape(re.sub(r"<[^>]+>", "", raw))
    paras = []
    for line in text.split("\n"):
        line = re.sub(r"\s+", " ", line).strip()
        if not line or len(line) < 3:
            continue
        if line.startswith(("*", "•", "-")):
            bullets.append(line.lstrip("*•- ").strip())
        else:
            paras.append(line)
    clean = lambda s: re.sub(r"\s+", " ", html.unescape(s)).strip()  # noqa: E731
    bullets = [clean(b) for b in bullets if clean(b)]
    # drop boilerplate lines
    junk = re.compile(r"(?i)^(style code|colou?r shown|sku|disclaimer|note:|manufactur|imported|country of origin|marketed by|net quantity|mrp)")
    paras = [p for p in paras if not junk.match(p)]
    meta = {}
    for b in list(bullets):
        m = re.match(r"(?i)(style|colou?r shown|style code)\s*:\s*(.+)", b)
        if m:
            meta["style" if "style" in m.group(1).lower() else "colorShown"] = m.group(2).strip()
            bullets.remove(b)
    return {"paragraphs": paras[:4], "bullets": bullets[:8], **meta}


def stable_key(s: str) -> str:
    return hashlib.sha1(s.encode()).hexdigest()


def silhouette(name: str) -> str:
    """Rough model key so we don't pick five colourways of the same shoe."""
    n = re.sub(r"[^a-z0-9 ]", " ", name.lower())
    n = re.sub(r"\b(retro|og|low|mid|high|premium|prm|se|w|wmns|mens|womens|sp|qs)\b", " ", n)
    return " ".join(n.split()[:3])


def price_of(p: dict) -> tuple[int, int | None]:
    prices = [float(v["price"]) for v in p["variants"]]
    price = int(round(min(prices)))
    cmp = [float(v["compare_at_price"]) for v in p["variants"] if v.get("compare_at_price")]
    mrp = int(round(max(cmp))) if cmp and max(cmp) > price else None
    return price, mrp


def sizes_of(p: dict) -> list[dict]:
    opts = [o["name"] for o in p.get("options", [])]
    idx = next((i for i, o in enumerate(opts) if "size" in o.lower()), 0)
    seen: dict[str, bool] = {}
    for v in p["variants"]:
        val = v.get(f"option{idx + 1}") or v["title"]
        val = re.sub(r"(?i)^uk\s*", "", str(val)).strip()
        seen[val] = seen.get(val, False) or bool(v.get("available"))

    def sort_key(s: str):
        m = re.match(r"[\d.]+", s)
        return float(m.group()) if m else 99.0
    return [{"label": f"UK {k}", "available": a} for k, a in sorted(seen.items(), key=lambda kv: sort_key(kv[0]))]


# ----------------------------------------------------------------- normalise per source
def from_superkicks(p: dict) -> dict | None:
    vendor = p["vendor"]
    brand = {"Nike": "Nike", "Jordan": "Jordan", "adidas Originals": "adidas", "adidas": "adidas",
             "New Balance": "New Balance", "Asics": "Asics"}.get(vendor)
    if not brand:
        return None
    if "sneaker" not in p["product_type"].lower():
        return None
    tags = " ".join(p["tags"]) if isinstance(p["tags"], list) else p["tags"]
    title = p["title"]
    if "Gender - Kids" in tags or re.search(r"\((TD|PS|GS|BG|K|C|INF)\)|\b(TD|PS|GS)\b|KIDS|INFANT|TODDLER", title):
        return None
    if len(p["images"]) < 3 or not any(v.get("available") for v in p["variants"]):
        return None
    left, _, colour = title.partition("{")
    name = left.split("|", 1)[-1].strip()
    name = re.sub(r"(?i)^(nike|adidas|jordan|new balance|asics)\s+(?=\S)", "", name) or name
    gender = "Women" if re.search(r"(?i)gender - wom|\(W\)|WMNS", tags + " " + title) else "Men"
    return {
        "brand": brand, "name": nice_case(name), "colorway": nice_case(colour.strip(" }")),
        "gender": gender, "source": "superkicks.in",
        "url": f"https://www.superkicks.in/products/{p['handle']}", "raw": p,
    }


def from_dawntown(p: dict) -> dict | None:
    if not p["images"] or not any(v.get("available") for v in p["variants"]):
        return None
    if "sneaker" not in (p["product_type"] or "").lower() and "shoe" not in (p["product_type"] or "").lower():
        return None
    full = re.sub(r"(?i)^onitsuka tiger\s*", "", p["title"]).strip()
    name, colour = full, ""
    for model in ONITSUKA_MODELS:  # Dawntown titles are "<Model> <Colourway words>"
        if full.lower().startswith(model.lower()):
            name, colour = model, full[len(model):].strip(" '\"")
            break
    return {
        "brand": "Onitsuka Tiger", "name": nice_case(name), "colorway": nice_case(colour),
        "gender": "Unisex", "source": "dawntown.co.in",
        "url": f"https://www.dawntown.co.in/products/{p['handle']}", "raw": p,
    }


# ----------------------------------------------------------------- images
def shopify_img(src: str, width: int) -> str:
    base = src.split("?")[0]
    return f"{base}?width={width}"


def make_cutout(img: Image.Image) -> Image.Image:
    """Flood-fill the plain studio background from the borders -> transparent PNG/WebP."""
    rgb = img.convert("RGB")
    w, h = rgb.size
    work = rgb.copy()
    sentinel = (255, 0, 255)
    seeds = [(0, 0), (w - 1, 0), (0, h - 1), (w - 1, h - 1),
             (w // 2, 0), (w // 2, h - 1), (0, h // 2), (w - 1, h // 2)]
    for s in seeds:
        if work.getpixel(s) != sentinel:
            ImageDraw.floodfill(work, s, sentinel, thresh=14)
    mask = Image.new("L", (w, h), 255)
    mpx = mask.load()
    wpx = work.load()
    for y in range(h):
        for x in range(w):
            if wpx[x, y] == sentinel:
                mpx[x, y] = 0
    mask = mask.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.8))
    out = rgb.convert("RGBA")
    out.putalpha(mask)
    bbox = mask.point(lambda v: 255 if v > 24 else 0).getbbox()
    if bbox:
        pad = int(0.03 * max(w, h))
        bbox = (max(0, bbox[0] - pad), max(0, bbox[1] - pad), min(w, bbox[2] + pad), min(h, bbox[3] + pad))
        out = out.crop(bbox)
    return out


def save_images(pid: str, item: dict) -> dict:
    folder = OUT_IMG / pid
    folder.mkdir(parents=True, exist_ok=True)
    srcs = [im["src"] for im in item["raw"]["images"]][:GALLERY_MAX]
    gallery = []
    for i, src in enumerate(srcs):
        im = Image.open(io.BytesIO(fetch(shopify_img(src, GALLERY_WIDTH)))).convert("RGB")
        name = f"{i + 1}.webp"
        im.save(folder / name, "WEBP", quality=80, method=6)
        gallery.append(f"shoes/{pid}/{name}")
        if i == 0:
            cut = make_cutout(Image.open(io.BytesIO(fetch(shopify_img(src, CUTOUT_WIDTH)))))
            cut.thumbnail((CUTOUT_WIDTH, CUTOUT_WIDTH))
            cut.save(folder / "cutout.webp", "WEBP", quality=86, method=6)
            cw, ch = cut.size
        time.sleep(0.15)
    return {"cutout": f"shoes/{pid}/cutout.webp", "cutoutAspect": round(cw / ch, 4), "images": gallery}


# ----------------------------------------------------------------- main
def pick(cands: list[dict]) -> list[dict]:
    by_brand: dict[str, list[dict]] = {b: [] for b in QUOTA}
    for c in cands:
        by_brand[c["brand"]].append(c)
    chosen = []
    for brand in BRAND_ORDER:
        pool = sorted(by_brand[brand], key=lambda c: stable_key(c["raw"]["handle"]))
        seen_sil, kept = set(), []
        for c in pool:
            sil = silhouette(c["name"])
            if sil in seen_sil:
                continue
            seen_sil.add(sil)
            kept.append(c)
            if len(kept) == QUOTA[brand]:
                break
        if len(kept) < QUOTA[brand]:  # top up with repeats of silhouettes if needed
            for c in pool:
                if c not in kept:
                    kept.append(c)
                if len(kept) == QUOTA[brand]:
                    break
        print(f"{brand:15s} candidates={len(pool):4d} kept={len(kept)}")
        chosen.extend(kept)
    return chosen


def interleave(items: list[dict]) -> list[dict]:
    """Round-robin brands so neighbouring racks mix brands."""
    buckets = {b: [i for i in items if i["brand"] == b] for b in BRAND_ORDER}
    out = []
    while any(buckets.values()):
        for b in BRAND_ORDER:
            if buckets[b]:
                out.append(buckets[b].pop(0))
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    print("Fetching superkicks.in …")
    sk = shopify_all("https://www.superkicks.in")
    print(f"  {len(sk)} products")
    print("Fetching dawntown.co.in (Onitsuka Tiger) …")
    dt = shopify_all("https://www.dawntown.co.in", "collections/onitsuka-tiger/products.json")
    print(f"  {len(dt)} products")

    cands = [c for c in (from_superkicks(p) for p in sk) if c] + [c for c in (from_dawntown(p) for p in dt) if c]
    chosen = interleave(pick(cands))

    if args.dry_run:
        for c in chosen:
            print(f"  {c['brand']:15s} {c['name']} — {c['colorway']}  ₹{price_of(c['raw'])[0]}")
        return

    if OUT_IMG.exists():
        shutil.rmtree(OUT_IMG)
    OUT_IMG.mkdir(parents=True)
    products = []
    for n, c in enumerate(chosen, 1):
        raw = c["raw"]
        pid = f"{re.sub(r'[^a-z]', '', c['brand'].lower())[:4]}-{stable_key(raw['handle'])[:8]}"
        print(f"[{n:2d}/{len(chosen)}] {c['brand']} {c['name']}")
        price, mrp = price_of(raw)
        products.append({
            "id": pid,
            "brand": c["brand"],
            "name": c["name"],
            "colorway": c["colorway"],
            "gender": c["gender"],
            "price": price,
            "mrp": mrp,
            "currency": "INR",
            "sizes": sizes_of(raw),
            "description": html_to_blocks(raw.get("body_html", "")),
            "tags": [t for t in (raw["tags"] if isinstance(raw["tags"], list) else raw["tags"].split(", "))
                     if not re.match(r"(?i)^(addon|dt-|cat-|eta )", t)][:8],
            "source": c["source"],
            "sourceUrl": c["url"],
            **save_images(pid, c),
        })

        write_catalog(products)  # after every pair, so a partial run is still usable
    print(f"Wrote {len(products)} products -> {OUT_JSON.relative_to(ROOT)}")


def write_catalog(products: list[dict]) -> None:
    OUT_JSON.parent.mkdir(parents=True, exist_ok=True)
    doc = json.dumps({
        "generated": date.today().isoformat(),
        "sources": ["superkicks.in", "dawntown.co.in"],
        "count": len(products),
        "products": products,
    }, ensure_ascii=False, indent=1)
    OUT_JSON.write_text(doc)
    # same data as a script, so the page never depends on fetch() for the catalogue
    OUT_JSON.with_suffix(".js").write_text("window.__PRODUCTS__ = " + doc.replace("</", "<\\/") + ";\n")


if __name__ == "__main__":
    main()
