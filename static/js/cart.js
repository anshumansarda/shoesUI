// Cart: state in localStorage, a badge on the bag button, a slide-in drawer.
const Shop = (window.Shop = window.Shop || {});
const KEY = "soleroom.cart.v1";

const listeners = new Set();
let items = Shop.store.get(KEY, []); // [{ id, size, qty }]

const Cart = {
  items: () => items.slice(),
  count: () => items.reduce((n, i) => n + i.qty, 0),
  lines() {
    return items
      .map((i) => ({ ...i, product: Shop.byId?.get(i.id) }))
      .filter((l) => l.product);
  },
  subtotal() {
    return Cart.lines().reduce((s, l) => s + l.product.price * l.qty, 0);
  },
  add(id, size, qty = 1) {
    const hit = items.find((i) => i.id === id && i.size === size);
    if (hit) hit.qty = Math.min(hit.qty + qty, 10);
    else items.push({ id, size, qty });
    save();
  },
  setQty(id, size, qty) {
    items = items
      .map((i) => (i.id === id && i.size === size ? { ...i, qty } : i))
      .filter((i) => i.qty > 0);
    save();
  },
  remove(id, size) {
    items = items.filter((i) => !(i.id === id && i.size === size));
    save();
  },
  clear() {
    items = [];
    save();
  },
  onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  open() {
    render();
    drawer.classList.add("is-open");
    drawer.setAttribute("aria-hidden", "false");
    scrim.hidden = false;
    requestAnimationFrame(() => scrim.classList.add("is-on"));
    document.body.classList.add("cart-open");
    msg.hidden = true;
  },
  close() {
    drawer.classList.remove("is-open");
    drawer.setAttribute("aria-hidden", "true");
    scrim.classList.remove("is-on");
    document.body.classList.remove("cart-open");
    setTimeout(() => (scrim.hidden = true), 300);
  },
  isOpen: () => drawer.classList.contains("is-open"),
};
Shop.cart = Cart;

function save() {
  Shop.store.set(KEY, items);
  badge();
  if (Cart.isOpen()) render();
  listeners.forEach((fn) => fn(Cart));
}

// ---------------------------------------------------------------- DOM
const btn = document.getElementById("cartBtn");
const badgeEl = document.getElementById("cartBadge");
const drawer = document.getElementById("drawer");
const scrim = document.getElementById("scrim");
const list = document.getElementById("cartItems");
const sub = document.getElementById("cartSubtotal");
const checkoutBtn = document.getElementById("checkoutBtn");
const msg = document.getElementById("checkoutMsg");

function badge() {
  const n = Cart.count();
  badgeEl.textContent = n > 99 ? "99+" : n;
  badgeEl.hidden = n === 0;
  badgeEl.classList.remove("is-bump");
  void badgeEl.offsetWidth;
  if (n) badgeEl.classList.add("is-bump");
}

function render() {
  const lines = Cart.lines();
  if (!lines.length) {
    list.innerHTML = `<div class="drawer__empty"><p>Your bag is empty.</p><span>Walk the room and pick a pair.</span></div>`;
  } else {
    list.innerHTML = lines
      .map(({ product: p, size, qty }) => {
        const k = Shop.esc(`${p.id}|${size}`);
        return `
        <div class="line" data-key="${k}">
          <a class="line__img" href="#/p/${p.id}" data-close-cart><img src="${Shop.asset(p.cutout)}" alt=""></a>
          <div class="line__body">
            <div class="line__brand">${Shop.esc(p.brand)}</div>
            <a class="line__name" href="#/p/${p.id}" data-close-cart>${Shop.esc(p.name)}</a>
            <div class="line__meta">${Shop.esc(size)}</div>
            <div class="line__row">
              <div class="qty">
                <button data-dec aria-label="Decrease quantity">−</button>
                <span>${qty}</span>
                <button data-inc aria-label="Increase quantity">+</button>
              </div>
              <strong>${Shop.money(p.price * qty)}</strong>
            </div>
            <button class="line__remove" data-remove>Remove</button>
          </div>
        </div>`;
      })
      .join("");
  }
  sub.textContent = Shop.money(Cart.subtotal());
  checkoutBtn.disabled = !lines.length;
}

list.addEventListener("click", (e) => {
  const line = e.target.closest(".line");
  if (!line) return;
  const [id, size] = line.dataset.key.split("|");
  const cur = items.find((i) => i.id === id && i.size === size);
  if (!cur) return;
  if (e.target.closest("[data-inc]")) Cart.setQty(id, size, Math.min(cur.qty + 1, 10));
  else if (e.target.closest("[data-dec]")) Cart.setQty(id, size, cur.qty - 1);
  else if (e.target.closest("[data-remove]")) Cart.remove(id, size);
});

document.addEventListener("click", (e) => {
  if (e.target.closest("[data-close-cart]")) Cart.close();
});
btn.addEventListener("click", () => (Cart.isOpen() ? Cart.close() : Cart.open()));
scrim.addEventListener("click", () => Cart.close());
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && Cart.isOpen()) Cart.close();
});

checkoutBtn.addEventListener("click", async () => {
  checkoutBtn.disabled = true;
  try {
    const result = await Shop.checkout.start({ lines: Cart.lines(), subtotal: Cart.subtotal() });
    msg.hidden = false;
    msg.textContent = result.message;
    if (result.ok) Cart.clear();
  } catch (err) {
    msg.hidden = false;
    msg.textContent = err.message || "Checkout failed.";
  } finally {
    checkoutBtn.disabled = !items.length;
  }
});

Shop.ready.then(() => {
  // Drop anything that is no longer in the catalogue.
  const before = items.length;
  items = items.filter((i) => Shop.byId.has(i.id));
  if (items.length !== before) Shop.store.set(KEY, items);
  badge();
});
badge();
