// Catalogue loader + shared helpers. Every script is an ES module with no
// relative imports; they talk through `window.Shop` so the whole site can also
// be inlined into a single HTML string (see streamlit_app.py).

const Shop = (window.Shop = window.Shop || {});

// Where images/data live. Empty for normal static hosting; the Streamlit
// wrapper sets it to "/app/static/".
Shop.base = window.__ASSET_BASE__ || "";
Shop.asset = (p) => (p && /^https?:|^data:|^\//.test(p) ? p : Shop.base + p);

const inr = new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 });
Shop.money = (n) => inr.format(n || 0);

Shop.esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Storage that never throws (private mode, sandboxed iframes, etc.)
const memory = new Map();
Shop.store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v == null ? fallback : JSON.parse(v);
    } catch {
      return memory.has(key) ? memory.get(key) : fallback;
    }
  },
  set(key, value) {
    memory.set(key, value);
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  },
};

Shop.toast = (msg) => {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = msg;
  el.classList.add("is-on");
  clearTimeout(Shop.toast._t);
  Shop.toast._t = setTimeout(() => el.classList.remove("is-on"), 2200);
};

Shop.fail = (msg) => {
  const l = document.getElementById("loader");
  if (!l) return;
  l.classList.add("is-error");
  l.querySelector(".loader__pct").textContent = msg;
};

Shop.ready = (async () => {
  if (location.protocol === "file:") {
    throw new Error("Open this site through a web server, not as a file. Run: python3 -m http.server 8765 --directory static");
  }
  let data = window.__PRODUCTS__;
  if (!data) {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 15000);
    let res;
    try {
      res = await fetch(Shop.asset("data/products.json"), { cache: "no-cache", signal: ctrl.signal });
    } catch {
      throw new Error("Couldn't reach the catalogue. Check your connection and reload.");
    } finally {
      clearTimeout(t);
    }
    if (!res.ok) throw new Error(`Catalogue missing (HTTP ${res.status}). Run scraper/scrape.py to generate static/data/products.json.`);
    data = await res.json();
  }
  if (!data?.products?.length) throw new Error("The catalogue is empty.");
  Shop.catalog = data;
  Shop.products = data.products;
  Shop.byId = new Map(data.products.map((p) => [p.id, p]));
  return Shop.products;
})();
