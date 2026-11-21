// Product page (route #/p/:id): photos, name, price, sizes, details, add to bag.
const Shop = (window.Shop = window.Shop || {});
const root = document.getElementById("product");

let current = null;
let chosenSize = null;

function pct(p) {
  return p.mrp && p.mrp > p.price ? Math.round((1 - p.price / p.mrp) * 100) : 0;
}

function related(p) {
  const same = Shop.products.filter((x) => x.brand === p.brand && x.id !== p.id);
  const other = Shop.products.filter((x) => x.brand !== p.brand);
  // deterministic: start from this product's position in the catalogue
  const start = Shop.products.indexOf(p);
  const pick = (arr, n) => arr.slice(start % Math.max(arr.length, 1)).concat(arr).slice(0, n);
  return [...pick(same, 3), ...pick(other, 1)];
}

function template(p) {
  const off = pct(p);
  const d = p.description || {};
  const imgs = p.images.length ? p.images : [p.cutout];
  return `
  <nav class="product__bar">
    <a class="back" href="#/" data-back>
      <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M15 5l-7 7 7 7"/></svg>
      Back to the room
    </a>
  </nav>

  <div class="product__grid">
    <section class="gallery" aria-label="Photos">
      <div class="gallery__main">
        ${imgs.map((src, i) => `<img src="${Shop.asset(src)}" alt="${Shop.esc(`${p.brand} ${p.name}, photo ${i + 1}`)}" class="${i === 0 ? "is-on" : ""}" ${i ? 'loading="lazy"' : ""}>`).join("")}
        ${imgs.length > 1 ? `
          <button class="gallery__nav gallery__nav--prev" data-step="-1" aria-label="Previous photo">‹</button>
          <button class="gallery__nav gallery__nav--next" data-step="1" aria-label="Next photo">›</button>` : ""}
      </div>
      <div class="gallery__thumbs">
        ${imgs.map((src, i) => `<button class="${i === 0 ? "is-on" : ""}" data-i="${i}" aria-label="Show photo ${i + 1}"><img src="${Shop.asset(src)}" alt="" loading="lazy"></button>`).join("")}
      </div>
    </section>

    <section class="info">
      <div class="info__brand">${Shop.esc(p.brand)} <span>·</span> ${Shop.esc(p.gender)}</div>
      <h1 class="info__name">${Shop.esc(p.name)}</h1>
      ${p.colorway ? `<div class="info__color">${Shop.esc(p.colorway)}</div>` : ""}

      <div class="info__price">
        <strong>${Shop.money(p.price)}</strong>
        ${off ? `<s>${Shop.money(p.mrp)}</s><em>${off}% off</em>` : ""}
      </div>
      <div class="info__tax">Inclusive of all taxes</div>

      <div class="sizes">
        <div class="sizes__head"><span>Select size</span><span class="sizes__unit">UK</span></div>
        <div class="sizes__grid" role="radiogroup" aria-label="Size">
          ${p.sizes
            .map(
              (s) => `<button role="radio" aria-checked="false" data-size="${Shop.esc(s.label)}" ${s.available ? "" : "disabled"}>${Shop.esc(s.label.replace(/^UK\s*/, ""))}</button>`
            )
            .join("")}
        </div>
        <div class="sizes__err" hidden>Pick a size first.</div>
      </div>

      <button class="btn btn--dark btn--block btn--lg" data-add data-main-add>Add to bag</button>

      <div class="details">
        ${(d.paragraphs || [])
          .filter((t) => !/^[\w\s&]{1,24}:?$/.test(t)) // drop stray headings like "Benefits"
          .map((t) => `<p>${Shop.esc(t)}</p>`)
          .join("")}
        ${(d.bullets || []).length ? `<ul>${d.bullets.map((b) => `<li>${Shop.esc(b)}</li>`).join("")}</ul>` : ""}
        <dl>
          ${d.style ? `<dt>Style</dt><dd>${Shop.esc(d.style)}</dd>` : ""}
          ${p.colorway ? `<dt>Colour</dt><dd>${Shop.esc(p.colorway)}</dd>` : ""}
          <dt>Sizes in stock</dt><dd>${p.sizes.filter((s) => s.available).length} of ${p.sizes.length}</dd>
        </dl>
        <p class="details__src">Listing and price from <a href="${Shop.esc(p.sourceUrl)}" target="_blank" rel="noopener">${Shop.esc(p.source)} ↗</a>, captured ${Shop.esc(Shop.catalog.generated)}.</p>
      </div>
    </section>
  </div>

  <div class="buybar" aria-hidden="true">
    <div class="buybar__txt"><strong>${Shop.money(p.price)}</strong><span>${Shop.esc(p.name)}</span></div>
    <button class="btn btn--dark" data-add tabindex="-1">Add to bag</button>
  </div>

  <section class="more">
    <h2>Also on the racks</h2>
    <div class="more__grid">
      ${related(p)
        .map(
          (r) => `
        <a class="card" href="#/p/${r.id}">
          <div class="card__img"><img src="${Shop.asset(r.cutout)}" alt="" loading="lazy"></div>
          <div class="card__brand">${Shop.esc(r.brand)}</div>
          <div class="card__name">${Shop.esc(r.name)}</div>
          <div class="card__price">${Shop.money(r.price)}</div>
        </a>`
        )
        .join("")}
    </div>
  </section>`;
}

function setPhoto(i) {
  const imgs = root.querySelectorAll(".gallery__main img");
  const thumbs = root.querySelectorAll(".gallery__thumbs button");
  const n = imgs.length;
  i = ((i % n) + n) % n;
  imgs.forEach((el, k) => el.classList.toggle("is-on", k === i));
  thumbs.forEach((el, k) => el.classList.toggle("is-on", k === i));
  root.dataset.photo = i;
}

root.addEventListener("click", (e) => {
  const t = e.target;
  const thumb = t.closest(".gallery__thumbs button");
  if (thumb) return setPhoto(+thumb.dataset.i);
  const step = t.closest("[data-step]");
  if (step) return setPhoto(+(root.dataset.photo || 0) + +step.dataset.step);

  const size = t.closest("[data-size]");
  if (size && !size.disabled) {
    chosenSize = size.dataset.size;
    root.querySelectorAll("[data-size]").forEach((b) => b.setAttribute("aria-checked", b === size ? "true" : "false"));
    root.querySelector(".sizes__err").hidden = true;
    return;
  }
  if (t.closest("[data-add]")) {
    if (!chosenSize) {
      const err = root.querySelector(".sizes__err");
      err.hidden = false;
      root.querySelector(".sizes").scrollIntoView({ behavior: "smooth", block: "center" });
      root.querySelector(".sizes").classList.remove("is-shake");
      void root.offsetWidth;
      root.querySelector(".sizes").classList.add("is-shake");
      return;
    }
    Shop.cart.add(current.id, chosenSize);
    Shop.toast(`Added ${current.name} (${chosenSize}) to your bag`);
    return;
  }
  if (t.closest("[data-back]")) {
    e.preventDefault();
    Shop.app.back();
  }
});

// swipe photos on touch
let sx = null;
root.addEventListener("touchstart", (e) => {
  if (e.target.closest(".gallery__main")) sx = e.touches[0].clientX;
}, { passive: true });
root.addEventListener("touchend", (e) => {
  if (sx == null) return;
  const dx = e.changedTouches[0].clientX - sx;
  if (Math.abs(dx) > 40) setPhoto(+(root.dataset.photo || 0) + (dx < 0 ? 1 : -1));
  sx = null;
});

document.addEventListener("keydown", (e) => {
  if (root.hidden || Shop.cart?.isOpen()) return;
  if (e.key === "Escape") Shop.app.back();
  if (e.key === "ArrowRight") setPhoto(+(root.dataset.photo || 0) + 1);
  if (e.key === "ArrowLeft") setPhoto(+(root.dataset.photo || 0) - 1);
});

// phones: show a slim buy bar once the main "Add to bag" scrolls out of view
const io = "IntersectionObserver" in window
  ? new IntersectionObserver(([e]) => {
      root.querySelector(".buybar")?.classList.toggle("is-on", !e.isIntersecting && e.boundingClientRect.top < 0);
    }, { root })
  : null;

Shop.productPage = {
  show(id) {
    const p = Shop.byId.get(id);
    if (!p) return false;
    if (current?.id !== id) {
      current = p;
      chosenSize = null;
      root.innerHTML = template(p);
      root.dataset.photo = 0;
      io?.disconnect();
      const main = root.querySelector("[data-main-add]");
      if (main) io?.observe(main);
    }
    document.title = `${p.name} — ${p.brand} · Sole Room`;
    root.hidden = false;
    root.scrollTop = 0;
    requestAnimationFrame(() => root.classList.add("is-on"));
    document.body.classList.add("on-product");
    return true;
  },
  hide() {
    if (root.hidden) return;
    root.classList.remove("is-on");
    document.body.classList.remove("on-product");
    document.title = "Sole Room";
    setTimeout(() => {
      if (!root.classList.contains("is-on")) root.hidden = true;
    }, 450);
  },
};
