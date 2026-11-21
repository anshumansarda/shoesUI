// The room: an endless curved white gallery (a ring-shaped corridor) lined
// with shoe racks on both walls. Scroll/drag to walk; hover a pair to stop and
// lean in on that rack; click a pair to open its product page.
import * as THREE from "three";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";

const Shop = (window.Shop = window.Shop || {});

// ------------------------------------------------------------------ layout
const R = 30;              // walking path radius
const R_IN = 26.6;         // inner wall radius (on your right)
const R_OUT = 33.4;        // outer wall radius (on your left)
const H = 4.8;             // ceiling height
const EYE = 1.6;
const RACKS_PER_SIDE = 26; // 52 racks x 6 pairs = 312 slots around the loop
const RACK_W = 3.3;
const RACK_D = 0.42;
const SHELVES = [0.42, 1.18, 1.94]; // shelf top heights
const RACK_TOP = 2.66;
const SLOT_X = [-0.8, 0.8];
const SHOE_MAX_W = 1.28;
const SHOE_MAX_H = 0.6;
const CIRC = Math.PI * 2 * R;
const FOG = 0xf4f2ee;

const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const coarse = matchMedia("(pointer: coarse)").matches;

// ------------------------------------------------------------------ state
let paused = /^#\/p\//.test(location.hash);
let raf = 0;
let started = false;

const saved = Shop.store.get("soleroom.walk", null);
let s = typeof saved === "number" ? saved : 0; // arc-length position along the path
let sTarget = s;
let lastInput = performance.now() - 10000;
let focus = null;          // rack we're leaning in on
let focusAmt = 0;          // 0 = walking, 1 = fully leaned in
let hoverShoe = null;
let hoverSince = 0;
let lastFocusHit = 0;
const mouse = new THREE.Vector2(-9, -9);
const mouseSmooth = new THREE.Vector2();
let pointerInside = false;
let lastPointerMove = 0;

Shop.gallery = {
  // dev helper: screen position of the nearest on-screen pair
  probe() {
    let best = null;
    const v = new THREE.Vector3();
    for (const m of shoeMeshes) {
      m.getWorldPosition(v);
      const d = v.distanceTo(camera.position);
      v.y += m.userData.h * 0.5;
      v.project(camera);
      if (v.z > 1 || Math.abs(v.x) > 0.8 || Math.abs(v.y) > 0.8) continue;
      if (!best || d < best.d) best = { d, x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, id: m.userData.product.id };
    }
    return best;
  },
  debug: () => ({ focus: focus ? focus.index : -1, pointerInside, coarse, lpm: performance.now() - lastPointerMove, hs: performance.now() - hoverSince, lfh: performance.now() - lastFocusHit, focusAmt, s, sTarget, hover: hoverShoe?.userData.product.id }),
  pause() {
    paused = true;
    cancelAnimationFrame(raf);
    hideTag();
  },
  resume() {
    if (!paused) return;
    paused = false;
    clock.getDelta();
    if (started) loop();
  },
};

// ------------------------------------------------------------------ renderer
const canvas = document.getElementById("room");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight, false);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.32;

const scene = new THREE.Scene();
scene.background = new THREE.Color(FOG);
scene.fog = new THREE.Fog(FOG, 7, 34);

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(renderer), 0.04).texture;

const camera = new THREE.PerspectiveCamera(fovFor(innerWidth / innerHeight), innerWidth / innerHeight, 0.05, 80);
const clock = new THREE.Clock();

function fovFor(aspect) {
  return aspect < 0.6 ? 66 : aspect < 0.8 ? 64 : aspect < 1.2 ? 60 : 56;
}

scene.add(new THREE.HemisphereLight(0xffffff, 0xe9e3d9, 0.9));
const sun = new THREE.DirectionalLight(0xffffff, 0.7);
sun.position.set(0, 10, 0);
scene.add(sun);

// ------------------------------------------------------------------ textures (procedural)
function canvasTex(w, h, draw, { srgb = true } = {}) {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  draw(c.getContext("2d"), w, h);
  const t = new THREE.CanvasTexture(c);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// walls: brighter near the ceiling light, softly darker toward the floor
const wallTex = canvasTex(4, 256, (g, w, h) => {
  const gr = g.createLinearGradient(0, 0, 0, h);
  gr.addColorStop(0, "#ffffff");
  gr.addColorStop(0.22, "#fbfaf8");
  gr.addColorStop(0.8, "#efece7");
  gr.addColorStop(1, "#e4e0da");
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
});

// floor: lit pool down the middle of the corridor, darker at the walls
const floorTex = canvasTex(1024, 1024, (g, w, h) => {
  const cx = w / 2;
  const rIn = (R_IN / R_OUT) * cx;
  const gr = g.createRadialGradient(cx, cx, rIn, cx, cx, cx);
  gr.addColorStop(0, "#dcd8d1");
  gr.addColorStop(0.18, "#ece9e4");
  gr.addColorStop(0.5, "#f3f1ed");
  gr.addColorStop(0.82, "#ece9e4");
  gr.addColorStop(1, "#d9d4cd");
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
});

const softShadow = canvasTex(128, 128, (g, w, h) => {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, "rgba(0,0,0,0.55)");
  gr.addColorStop(0.45, "rgba(0,0,0,0.22)");
  gr.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, w, h);
});

const rectShadow = canvasTex(256, 256, (g, w, h) => {
  g.filter = "blur(22px)";
  g.fillStyle = "rgba(0,0,0,0.5)";
  g.fillRect(44, 40, w - 88, h - 70);
});

// ------------------------------------------------------------------ the room shell
const SEG = 320;
{
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, roughness: 0.96, metalness: 0, envMapIntensity: 0.9 });
  const outer = new THREE.Mesh(new THREE.CylinderGeometry(R_OUT, R_OUT, H, SEG, 1, true), wallMat.clone());
  outer.material.side = THREE.BackSide;
  outer.position.y = H / 2;
  const inner = new THREE.Mesh(new THREE.CylinderGeometry(R_IN, R_IN, H, SEG, 1, true), wallMat);
  inner.position.y = H / 2;
  scene.add(outer, inner);

  const floor = new THREE.Mesh(
    new THREE.RingGeometry(R_IN, R_OUT, SEG, 1),
    new THREE.MeshStandardMaterial({ map: floorTex, roughness: 0.42, metalness: 0, envMapIntensity: 1.1 })
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);

  const ceil = new THREE.Mesh(
    new THREE.RingGeometry(R_IN, R_OUT, SEG, 1),
    new THREE.MeshStandardMaterial({ color: 0xeeebe6, roughness: 1 })
  );
  ceil.rotation.x = Math.PI / 2;
  ceil.position.y = H;
  scene.add(ceil);

  // continuous light line down the ceiling + a light cove at the top of each wall
  const glow = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: true });
  const strip = new THREE.Mesh(new THREE.RingGeometry(R - 0.22, R + 0.22, SEG, 1), glow);
  strip.rotation.x = Math.PI / 2;
  strip.position.y = H - 0.012;
  scene.add(strip);
  for (const [rad, side] of [
    [R_OUT - 0.02, THREE.BackSide],
    [R_IN + 0.02, THREE.FrontSide],
  ]) {
    const cove = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, 0.07, SEG, 1, true), glow.clone());
    cove.material.side = side;
    cove.position.y = H - 0.3;
    scene.add(cove);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(rad, rad, 0.09, SEG, 1, true),
      new THREE.MeshStandardMaterial({ color: 0xd9d4cc, roughness: 0.8, side })
    );
    base.position.y = 0.045;
    scene.add(base);
  }
}

// ------------------------------------------------------------------ racks
const oak = new THREE.MeshStandardMaterial({ color: 0xdcc6a6, roughness: 0.62, metalness: 0 });
const panel = new THREE.MeshStandardMaterial({ color: 0xfbfaf7, roughness: 0.9 });
const led = new THREE.MeshBasicMaterial({ color: 0xfffaf0, toneMapped: false });
const shadowMat = new THREE.MeshBasicMaterial({ map: softShadow, transparent: true, depthWrite: false, opacity: 0.55 });
const wallShadowMat = new THREE.MeshBasicMaterial({ map: rectShadow, transparent: true, depthWrite: false, opacity: 0.16 });
const hitMat = new THREE.MeshBasicMaterial({ visible: false });

const G = {
  shelf: new THREE.BoxGeometry(RACK_W, 0.045, RACK_D),
  side: new THREE.BoxGeometry(0.05, RACK_TOP, RACK_D),
  back: new THREE.BoxGeometry(RACK_W, RACK_TOP + 0.04, 0.03),
  led: new THREE.BoxGeometry(RACK_W - 0.14, 0.012, 0.018),
  plane: new THREE.PlaneGeometry(1, 1),
  shoe: new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0),
  hit: new THREE.BoxGeometry(RACK_W + 0.1, RACK_TOP + 0.2, RACK_D + 0.3),
};

const racks = [];
const shoeMeshes = [];
const hitTargets = [];

function buildRack() {
  const g = new THREE.Group();
  const back = new THREE.Mesh(G.back, panel);
  back.position.set(0, RACK_TOP / 2 + 0.02, -RACK_D / 2 + 0.015);
  g.add(back);
  for (const x of [-RACK_W / 2, RACK_W / 2]) {
    const side = new THREE.Mesh(G.side, oak);
    side.position.set(x, RACK_TOP / 2, 0);
    g.add(side);
  }
  for (const y of [...SHELVES, RACK_TOP]) {
    const sh = new THREE.Mesh(G.shelf, oak);
    sh.position.set(0, y - 0.0225, 0);
    g.add(sh);
    if (y > SHELVES[0]) {
      const strip = new THREE.Mesh(G.led, led);
      strip.position.set(0, y - 0.052, RACK_D / 2 - 0.04);
      g.add(strip);
    }
  }
  const floorShadow = new THREE.Mesh(G.plane, shadowMat);
  floorShadow.rotation.x = -Math.PI / 2;
  floorShadow.scale.set(RACK_W + 1.2, RACK_D + 1.1, 1);
  floorShadow.position.set(0, 0.006, 0.15);
  g.add(floorShadow);
  const wallShadow = new THREE.Mesh(G.plane, wallShadowMat);
  wallShadow.scale.set(RACK_W + 1.0, RACK_TOP + 0.9, 1);
  wallShadow.position.set(0, RACK_TOP / 2 + 0.02, -RACK_D / 2 - 0.004);
  g.add(wallShadow);
  const hit = new THREE.Mesh(G.hit, hitMat);
  hit.position.set(0, RACK_TOP / 2, 0.1);
  g.add(hit);
  return { group: g, hit };
}

function placeRacks(products, textures) {
  const step = (Math.PI * 2) / RACKS_PER_SIDE;
  const order = [];
  for (let i = 0; i < RACKS_PER_SIDE; i++) {
    order.push({ side: "in", theta: i * step });
    order.push({ side: "out", theta: i * step + step / 2 });
  }
  const materials = new Map();
  order.forEach((spec, j) => {
    const { group, hit } = buildRack();
    const inner = spec.side === "in";
    const rad = inner ? R_IN + RACK_D / 2 + 0.03 : R_OUT - RACK_D / 2 - 0.03;
    const c = Math.cos(spec.theta);
    const sn = Math.sin(spec.theta);
    group.position.set(rad * c, 0, rad * sn);
    // local +z must face into the corridor
    const n = inner ? new THREE.Vector3(c, 0, sn) : new THREE.Vector3(-c, 0, -sn);
    group.rotation.y = Math.atan2(n.x, n.z);
    scene.add(group);

    const rack = { group, hit, theta: spec.theta, normal: n, side: spec.side, index: j, shoes: [] };
    hit.userData.rack = rack;
    hitTargets.push(hit);

    let k = 0;
    SHELVES.forEach((y) => {
      SLOT_X.forEach((x) => {
        const p = products[(j * SHELVES.length * SLOT_X.length + k++) % products.length];
        let mat = materials.get(p.id);
        if (!mat) {
          mat = new THREE.MeshBasicMaterial({
            map: textures.get(p.id),
            transparent: true,
            alphaTest: 0.04,
            toneMapped: false,
            fog: true,
          });
          materials.set(p.id, mat);
        }
        const aspect = p.cutoutAspect || 1.6;
        let w = SHOE_MAX_W;
        let h = w / aspect;
        if (h > SHOE_MAX_H) {
          h = SHOE_MAX_H;
          w = h * aspect;
        }
        const mesh = new THREE.Mesh(G.shoe, mat);
        // mirror the right-hand pair on outer racks so toes point different ways
        mesh.scale.set(w, h, 1);
        mesh.position.set(x, y + 0.004, 0.02);
        mesh.userData = { product: p, rack, base: new THREE.Vector3(x, y + 0.004, 0.02), w, h, hover: 0 };
        group.add(mesh);
        const sh = new THREE.Mesh(G.plane, shadowMat);
        sh.rotation.x = -Math.PI / 2;
        sh.scale.set(w * 0.95, 0.26, 1);
        sh.position.set(x, y + 0.002, 0.04);
        sh.renderOrder = -1;
        group.add(sh);
        mesh.userData.shadow = sh;
        rack.shoes.push(mesh);
        shoeMeshes.push(mesh);
        hitTargets.push(mesh);
      });
    });
    racks.push(rack);
  });
}

// ------------------------------------------------------------------ path helpers
const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();
function pathPoint(theta, y = EYE, out = new THREE.Vector3()) {
  return out.set(R * Math.cos(theta), y, R * Math.sin(theta));
}
function nearestS(theta) {
  const base = theta * R;
  return base + Math.round((s - base) / CIRC) * CIRC;
}

// ------------------------------------------------------------------ input
function walk(delta) {
  sTarget += delta;
  lastInput = performance.now();
  if (focus) setFocus(null);
  hint();
}

addEventListener(
  "wheel",
  (e) => {
    if (paused || document.body.classList.contains("cart-open")) return;
    e.preventDefault();
    let d = e.deltaY + e.deltaX * 0.5;
    if (e.deltaMode === 1) d *= 18;
    d = Math.max(-140, Math.min(140, d));
    walk(d * 0.0062);
  },
  { passive: false }
);

addEventListener("keydown", (e) => {
  if (paused || document.body.classList.contains("cart-open")) return;
  if (["ArrowUp", "w", "W", "ArrowRight"].includes(e.key)) walk(2.2);
  if (["ArrowDown", "s", "S", "ArrowLeft"].includes(e.key)) walk(-2.2);
});

let drag = null;
canvas.addEventListener("pointerdown", (e) => {
  drag = { x: e.clientX, y: e.clientY, lastY: e.clientY, moved: 0, type: e.pointerType };
  setMouse(e);
});
addEventListener("pointermove", (e) => {
  pointerInside = true;
  lastPointerMove = performance.now();
  setMouse(e);
  if (drag && drag.type !== "mouse") {
    const dy = drag.lastY - e.clientY;
    drag.lastY = e.clientY;
    drag.moved += Math.abs(dy);
    if (drag.moved > 6) walk(dy * 0.03);
  }
});
addEventListener("pointerup", (e) => {
  if (!drag) return;
  const tap = Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 8;
  const type = drag.type;
  drag = null;
  if (!tap || paused || e.target !== canvas) return;
  setMouse(e);
  const hit = pick();
  if (type === "mouse") {
    if (hit?.shoe) open(hit.shoe);
    return;
  }
  // touch: first tap leans in on the rack, a tap on a pair in that rack opens it
  if (hit?.shoe && focus === hit.rack && focusAmt > 0.6) open(hit.shoe);
  else if (hit?.rack) setFocus(hit.rack);
  else setFocus(null);
});
document.addEventListener("pointerleave", () => {
  pointerInside = false;
  mouse.set(-9, -9);
});
addEventListener("blur", () => {
  pointerInside = false;
  mouse.set(-9, -9);
});

function setMouse(e) {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
}

function open(mesh) {
  Shop.store.set("soleroom.walk", s);
  Shop.app.go(`#/p/${mesh.userData.product.id}`);
}

// ------------------------------------------------------------------ picking + focus
const ray = new THREE.Raycaster();
ray.far = 14;
function pick() {
  if (mouse.x < -2) return null;
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects(hitTargets, false);
  if (!hits.length) return null;
  // The nearest hit decides the rack (its invisible hit-box sits in front of
  // the shoes); a pair counts only if it belongs to that same rack.
  const first = hits[0].object;
  const rack = first.userData.rack;
  const shoeHit = hits.find((h) => h.object.userData.product && h.object.userData.rack === rack);
  return { shoe: shoeHit ? shoeHit.object : null, rack };
}

let focusStart = 0;
function setFocus(rack) {
  focus = rack;
  focusStart = performance.now();
  if (rack) sTarget = nearestS(rack.theta);
}

// ------------------------------------------------------------------ tag (hover label)
const tag = document.getElementById("tag");
const tagBrand = tag.querySelector(".tag__brand");
const tagName = tag.querySelector(".tag__name");
const tagPrice = tag.querySelector(".tag__price");
let tagFor = null;
function showTag(mesh) {
  if (tagFor !== mesh) {
    const p = mesh.userData.product;
    tagBrand.textContent = p.brand;
    tagName.textContent = p.name;
    tagPrice.textContent = Shop.money(p.price);
    tagFor = mesh;
  }
  const top = tmpA.set(0, 1.04, 0);
  mesh.localToWorld(top);
  top.project(camera);
  const hw = (tag.offsetWidth || 180) / 2 + 10;
  const x = Math.min(innerWidth - hw, Math.max(hw, (top.x * 0.5 + 0.5) * innerWidth));
  const y = Math.min(innerHeight - 20, Math.max((tag.offsetHeight || 70) + 24, (-top.y * 0.5 + 0.5) * innerHeight));
  tag.style.transform = `translate3d(${x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -100%)`;
  tag.classList.add("is-on");
}
function hideTag() {
  tagFor = null;
  tag.classList.remove("is-on");
}

// ------------------------------------------------------------------ hint
const hintEl = document.getElementById("hint");
let hinted = false;
function hint() {
  if (hinted) return;
  hinted = true;
  setTimeout(() => hintEl.classList.add("is-off"), 1200);
}

// Where to stand so the whole rack fits on screen (works for any aspect ratio).
const tmpC = new THREE.Vector3();
const focusPos = new THREE.Vector3();
function focusCamera(rack) {
  const vHalf = THREE.MathUtils.degToRad(camera.fov / 2);
  const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
  const need = Math.max((RACK_TOP + 0.45) / 2 / Math.tan(vHalf), (RACK_W + 0.35) / 2 / Math.tan(hHalf));
  const rackFront = Math.abs(R - rack.group.position.length()) - RACK_D / 2; // path -> rack front
  const corridor = R_OUT - R_IN;
  // move from the path toward the rack (positive) or back across the corridor (negative)
  const shift = Math.max(rackFront - need, rackFront - (corridor - RACK_D - 0.6));
  return pathPoint(rack.theta, 1.34, focusPos).addScaledVector(rack.normal, -shift);
}

// ------------------------------------------------------------------ main loop
const camPos = new THREE.Vector3();
const lookAt = new THREE.Vector3();
const lookSmooth = new THREE.Vector3();
let firstFrame = true;

function damp(a, b, lambda, dt) {
  return a + (b - a) * (1 - Math.exp(-lambda * dt));
}

function loop() {
  raf = requestAnimationFrame(loop);
  const dt = Math.min(clock.getDelta(), 0.05);
  const now = performance.now();

  // --- hover / focus (desktop)
  if (!coarse && pointerInside && !drag) {
    const hit = pick();
    const shoe = hit?.shoe || null;
    if (shoe !== hoverShoe) {
      hoverShoe = shoe;
      hoverSince = now;
    }
    if (hit && focus && hit.rack === focus) lastFocusHit = now;
    if (hoverShoe && now - hoverSince > 140 && now - lastPointerMove < 1500 && focus !== hoverShoe.userData.rack &&
        (!focus || lastPointerMove > focusStart)) {
      // only hop to another rack when the user moved the mouse, not when the
      // camera gliding in slid a different rack under a still cursor
      setFocus(hoverShoe.userData.rack);
      lastFocusHit = now;
    }
    // leave the rack only when *the pointer* moved off it (not when the camera
    // moving in slid the rack out from under a still cursor)
    if (focus && now - lastFocusHit > 520 && lastPointerMove > lastFocusHit) setFocus(null);
    if (focus && hoverShoe && hoverShoe.userData.rack !== focus) hoverShoe = null;
    canvas.style.cursor = hoverShoe ? "pointer" : "";
  } else if (!coarse) {
    hoverShoe = null;
    if (focus && now - lastFocusHit > 520) setFocus(null);
  }
  if (coarse) hoverShoe = null; // touch has no hover: tap a rack, then tap a pair

  // --- walking
  const idle = now - lastInput > 3200;
  if (!focus && idle && !reduceMotion && !document.body.classList.contains("cart-open")) {
    sTarget += 0.55 * dt; // the room keeps drifting by when you're not steering
  }
  s = damp(s, sTarget, focus ? 2.6 : 3.4, dt);
  focusAmt = damp(focusAmt, focus ? 1 : 0, focus ? 2.4 : 3.2, dt);
  const ease = focusAmt * focusAmt * (3 - 2 * focusAmt);

  const theta = s / R;
  const speed = Math.abs(sTarget - s);
  const bob = reduceMotion ? 0 : Math.sin(s * 2.1) * Math.min(speed, 1.5) * 0.014;
  pathPoint(theta, EYE + bob, camPos);
  pathPoint(theta + (camera.aspect < 0.8 ? 5.5 : 7.5) / R, 1.4, lookAt); // look ahead along the curve

  // gentle mouse parallax while walking
  mouseSmooth.x = damp(mouseSmooth.x, pointerInside && mouse.x > -2 ? mouse.x : 0, 2, dt);
  mouseSmooth.y = damp(mouseSmooth.y, pointerInside && mouse.y > -2 ? mouse.y : 0, 2, dt);
  const fwd = tmpB.set(-Math.sin(theta), 0, Math.cos(theta));
  const right = tmpA.set(-fwd.z, 0, fwd.x); // screen-right = toward the inner wall
  lookAt.addScaledVector(right, mouseSmooth.x * 1.4).add({ x: 0, y: mouseSmooth.y * 0.5, z: 0 });
  if (camera.aspect < 0.8) {
    // Portrait phones: walk nearer the inner wall and look across at the outer
    // wall, so a run of racks fills the tall screen instead of floor and ceiling.
    camPos.addScaledVector(right, 0.9);
    lookAt.addScaledVector(right, -3.2);
  }

  const fr = focus || lastFocus;
  if (fr && ease > 0.001) {
    const rc = fr.group.position;
    camPos.lerp(focusCamera(fr), ease);
    lookAt.lerp(tmpC.set(rc.x, 1.32, rc.z), ease);
  }
  if (focus) lastFocus = focus;

  camera.position.copy(camPos);
  if (firstFrame) lookSmooth.copy(lookAt);
  lookSmooth.x = damp(lookSmooth.x, lookAt.x, 9, dt);
  lookSmooth.y = damp(lookSmooth.y, lookAt.y, 9, dt);
  lookSmooth.z = damp(lookSmooth.z, lookAt.z, 9, dt);
  camera.lookAt(lookSmooth);
  firstFrame = false;

  // --- shoe hover animation
  for (const m of shoeMeshes) {
    const u = m.userData;
    const target = m === hoverShoe ? 1 : 0;
    if (u.hover === target && target === 0) continue;
    u.hover = damp(u.hover, target, 10, dt);
    if (Math.abs(u.hover - target) < 0.001) u.hover = target;
    const k = 1 + u.hover * 0.22;
    m.scale.set(u.w * k, u.h * k, 1);
    m.position.set(u.base.x, u.base.y + u.hover * 0.07, u.base.z + u.hover * 0.22);
    u.shadow.scale.set(u.w * 0.95 * (1 + u.hover * 0.1), 0.26, 1);
    u.shadow.material.opacity = 0.55;
  }

  if (hoverShoe && (!coarse || focusAmt > 0.6)) showTag(hoverShoe);
  else hideTag();

  renderer.render(scene, camera);

  if (now - (loop.saved || 0) > 1000) {
    loop.saved = now;
    Shop.store.set("soleroom.walk", s);
  }
}
let lastFocus = null;

// ------------------------------------------------------------------ resize
addEventListener("resize", () => {
  const a = innerWidth / innerHeight;
  camera.aspect = a;
  camera.fov = fovFor(a);
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight, false);
});

// ------------------------------------------------------------------ boot
const loaderEl = document.getElementById("loader");
const bar = loaderEl.querySelector(".loader__bar i");
const pct = loaderEl.querySelector(".loader__pct");

async function boot() {
  const products = await Shop.ready;
  const manager = new THREE.LoadingManager();
  manager.onLoad = () => {
    bar.style.transform = "scaleX(1)";
    pct.textContent = "100%";
  };
  manager.onProgress = (_url, done, total) => {
    const v = Math.round((done / total) * 100);
    bar.style.transform = `scaleX(${done / total})`;
    pct.textContent = `${v}%`;
  };
  const loader = new THREE.TextureLoader(manager);
  const aniso = Math.min(8, renderer.capabilities.getMaxAnisotropy());
  const textures = new Map();
  await Promise.all(
    products.map(
      (p) =>
        new Promise((resolve) => {
          loader.load(
            Shop.asset(p.cutout),
            (t) => {
              t.colorSpace = THREE.SRGBColorSpace;
              t.anisotropy = aniso;
              textures.set(p.id, t);
              resolve();
            },
            undefined,
            () => resolve() // a missing photo shouldn't block the room
          );
        })
    )
  );
  placeRacks(products, textures);
  renderer.compile(scene, camera);
  started = true;
  loop(); // draw at least one frame, even if we start on a product page
  if (paused) cancelAnimationFrame(raf);
  requestAnimationFrame(() => {
    loaderEl.classList.add("is-done");
    setTimeout(() => loaderEl.remove(), 900);
  });
}

boot().catch((err) => {
  console.error(err);
  Shop.fail(err.message || "Something went wrong loading the room.");
});
