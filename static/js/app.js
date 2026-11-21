// Tiny hash router: "#/" = the room, "#/p/<id>" = product page.
const Shop = (window.Shop = window.Shop || {});

let route = null;
let enteredFromRoom = false;

function parse(hash) {
  const m = /^#\/p\/([\w-]+)/.exec(hash || "");
  return m ? { name: "product", id: m[1] } : { name: "room" };
}

function render(r) {
  const key = r.name + (r.id || "");
  if (route === key) return;
  route = key;
  if (r.name === "product" && Shop.productPage.show(r.id)) {
    Shop.gallery?.pause();
  } else {
    Shop.productPage.hide();
    Shop.gallery?.resume();
  }
}

Shop.app = {
  go(path) {
    const r = parse(path);
    if (r.name === "product" && route === "room") enteredFromRoom = true;
    try {
      if (location.hash !== path) location.hash = path;
    } catch {}
    render(r); // also works where hash navigation is blocked (sandboxed iframes)
  },
  back() {
    if (enteredFromRoom && history.length > 1) {
      enteredFromRoom = false;
      try {
        history.back();
        setTimeout(() => render(parse(location.hash)), 60);
        return;
      } catch {}
    }
    Shop.app.go("#/");
  },
};

window.addEventListener("hashchange", () => render(parse(location.hash)));

// Internal links (<a href="#/p/...">) go through the router.
document.addEventListener("click", (e) => {
  const a = e.target.closest('a[href^="#/"]');
  if (!a || e.defaultPrevented || e.metaKey || e.ctrlKey) return;
  e.preventDefault();
  Shop.app.go(a.getAttribute("href"));
});

Shop.ready
  .then(() => render(parse(location.hash)))
  .catch((err) => {
    console.error(err);
    Shop.fail(err.message);
  });
