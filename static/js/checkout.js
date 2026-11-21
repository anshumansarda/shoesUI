// Checkout hook. This is the one place a payment gateway plugs in.
//
// Today it runs in "demo" mode: it builds the order payload and tells the
// shopper that payments aren't switched on. To go live, pick a provider below,
// add a tiny backend that creates the order/session server-side (never put
// secret keys in this file), and set `PROVIDER`.
//
//   Razorpay  (India, UPI/cards):  backend creates an order -> open Razorpay Checkout here
//   Stripe    (cards, global):     backend creates a Checkout Session -> redirect to session.url
//
// The order payload below is what your backend should receive.

const Shop = (window.Shop = window.Shop || {});

const PROVIDER = "demo"; // "demo" | "razorpay" | "stripe"
const API_BASE = ""; // e.g. "https://your-api.example.com" when you add a backend

function buildOrder({ lines, subtotal }) {
  return {
    currency: "INR",
    amount: subtotal, // rupees; Razorpay wants paise (amount * 100)
    items: lines.map((l) => ({
      id: l.id,
      name: `${l.product.brand} ${l.product.name}`,
      size: l.size,
      qty: l.qty,
      unitPrice: l.product.price,
    })),
    createdAt: new Date().toISOString(),
  };
}

const providers = {
  async demo(order) {
    await new Promise((r) => setTimeout(r, 450));
    console.info("[checkout] demo order payload", order);
    const pairs = order.items.reduce((n, i) => n + i.qty, 0);
    return {
      ok: false,
      message: `Payments aren't switched on yet. Your bag (${pairs} pair${pairs > 1 ? "s" : ""}, ${Shop.money(
        order.amount
      )}) is saved on this device.`,
    };
  },

  // Example wiring, kept here so going live is a small change.
  async razorpay(order) {
    const res = await fetch(`${API_BASE}/api/orders`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });
    const { orderId, keyId } = await res.json();
    await loadScript("https://checkout.razorpay.com/v1/checkout.js");
    return new Promise((resolve) => {
      const rzp = new window.Razorpay({
        key: keyId,
        order_id: orderId,
        name: "Sole Room",
        currency: "INR",
        handler: () => resolve({ ok: true, message: "Payment received. Thank you!" }),
        modal: { ondismiss: () => resolve({ ok: false, message: "Payment cancelled." }) },
      });
      rzp.open();
    });
  },

  async stripe(order) {
    const res = await fetch(`${API_BASE}/api/checkout-session`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(order),
    });
    const { url } = await res.json();
    window.location.href = url;
    return { ok: false, message: "Redirecting to payment…" };
  },
};

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error("Could not load the payment script."));
    document.head.appendChild(s);
  });
}

Shop.checkout = {
  provider: PROVIDER,
  start(cart) {
    return providers[PROVIDER](buildOrder(cart));
  },
};
