// Pip's screens, drawn from the pen.dev design (design/untitled.pen; colors and labels in design/tokens.json).
// app.js does the work (voice, taps, guiding); this file only picks the screen that matches what Pip is doing,
// fills it in 10 times a second, and wires the keys. It reads app.js's state (S, N, talking, deafened, started, ...) directly.
"use strict";
(() => {
const el = (id) => document.getElementById(id);
const setText = (id, t) => { const e = el(id); t = String(t); if (e && e.textContent !== t) e.textContent = t; };
const setHTML = (id, h) => { const e = el(id); if (e && e._h !== h) { e._h = h; e.innerHTML = h; } };
const setCls = (id, c) => { const e = el(id); if (e && e.className !== c) e.className = c; };
const showEl = (id, on) => { const e = el(id); if (e && e.hidden === on) e.hidden = !on; };
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
const UP = (t) => String(t || "").toUpperCase();
const cap = (t) => String(t || "").replace(/^./, (c) => c.toUpperCase());
const m1 = (m) => (m < 1000 ? [(Math.max(0, m)).toFixed(1), "M"] : [(m / 1000).toFixed(1), "KM"]);   // 12.4 M, 2.1 KM
// The design's text sizes: 64 (a short prompt with the cursor), 56 (a few words), 48, 40 (a sentence), then smaller.
const sizeSay = (t, cursor) => { const n = String(t).length; return cursor && n <= 9 ? "s64" : n <= 14 ? "s56" : n <= 24 ? "s48" : n <= 50 ? "s40" : n <= 90 ? "s32" : "s26"; };
const firstSentence = (t) => { const m = String(t).match(/^(.+?[.!?])(\s+|$)([\s\S]*)$/); return m ? m[1] : t; };
const noDot = (t) => String(t).replace(/\.$/, "");
const theName = (n) => (/^[A-Z]/.test(n) ? n : `the ${n}`);   // "the restroom", but "Ralphs"

// Script errors go to the log (and the phone's pip-log.txt), so a broken screen shows up in the data.
window.addEventListener("error", (e) => log("JS error:", e.message, `${(e.filename || "").split("/").pop()}:${e.lineno}`));
let overlay = null, current = null, placesArmed = null;

// ---------- motion (the design's Motion + Gestures frame) ----------
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;   // Reduce Motion: animations stop
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const vec3 = (hex) => { const h = hex.replace("#", ""); return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255); };
const setPeriod = (e, s) => { if (!e) return; const cur = parseFloat(e.style.getPropertyValue("--pp")) || 0;   // pulse.glsl period 2/speed; --pp is half
  if (Math.abs(cur - s / 2) > cur * 0.1) e.style.setProperty("--pp", `${(s / 2).toFixed(2)}s`); };
// Runs one of the design's fragment shaders (frontend/shaders.js = design/shaders/*.glsl) on a canvas, at 1 CSS px per pixel
// like the pen.dev canvas, so grid sizes and line widths match the design.
function shader(canvas, name) {
  const gl = canvas?.getContext("webgl", { premultipliedAlpha: true, antialias: false });
  if (!gl || typeof SHADERS === "undefined" || !SHADERS[name]) return null;
  const mk = (type, src) => { const sh = gl.createShader(type); gl.shaderSource(sh, src); gl.compileShader(sh); return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null; };
  const vs = mk(gl.VERTEX_SHADER, "attribute vec2 p; void main() { gl_Position = vec4(p, 0.0, 1.0); }"), fs = mk(gl.FRAGMENT_SHADER, SHADERS[name]);
  if (!vs || !fs) { log("shader failed:", name); return null; }
  const prog = gl.createProgram(); gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) { log("shader failed:", name); return null; }
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, "p"); gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = {}, u = (k) => (k in U ? U[k] : (U[k] = gl.getUniformLocation(prog, k)));
  canvas.classList.add("gl");
  return (t, uniforms) => {
    const W = canvas.clientWidth, H = canvas.clientHeight;
    if (!W || !H) return;
    if (canvas.width !== W || canvas.height !== H) { canvas.width = W; canvas.height = H; }
    gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    gl.uniform2f(u("u_resolution"), W, H); gl.uniform1f(u("u_time"), t);
    for (const [k, v] of Object.entries(uniforms)) Array.isArray(v) ? gl.uniform3fv(u(k), v) : gl.uniform1f(u(k), v);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}
const GL = {};
function initShaders() {
  for (const id of ["cursor", "l-cursor"]) { GL[id] = shader(el(id), "cursor"); if (!GL[id]) el(id).classList.remove("gl"); }
  GL.wave = shader(el("wave"), "wave");
  for (const id of ["f-vf", "s-vf"]) {
    const c = document.createElement("canvas"); el(id).prepend(c);
    GL[id] = shader(c, "scan"); if (GL[id]) el(id).classList.add("gl"); else c.remove();
  }
}
// ON COURSE pulses with each tick (every 0.4 s): the tap loop's own "on" ticks drive it, so the screen and the sound agree.
const _tap = tap;
tap = function (side, kind, ...rest) {
  if (kind === "on" && !reduced() && current === "guide" && el("g-tag").textContent === "ON COURSE") el("g-tag").animate([{ opacity: 1 }, { opacity: 0.7 }], { duration: 380, easing: "ease-out", fill: "forwards" });
  return _tap(side, kind, ...rest);
};
const SCREENS = ["start", "listen", "guide", "find", "search", "teach", "preview", "places", "setup", "log"];   // overlay: places | setup | log (opened by the user)

function pick() {
  if (!started) return "start";
  if (overlay) return overlay;
  const now = Date.now();
  if (S.arrived && now - S.arrived.t > 120000) S.arrived = null;
  if (S.saved && now - S.saved.t > 120000) S.saved = null;
  if (S.walk || S.back) S.arrived = null;
  if (S.preview) return "preview";
  if (S.orient || S.learning || S.saved) return "teach";
  if (S.walk || S.back || S.arrived) return "guide";
  if (S.mission || S.find?.aisle) return "search";
  if (S.find) return "find";
  return "listen";
}
function go(name) {
  if (name === current) return;
  for (const s of SCREENS) el("scr-" + s)?.classList.toggle("on", s === name);
  current = name;
  const slot = el("scr-" + name)?.querySelector(".voice-slot");   // the Voice Bar sits at the bottom of every active screen
  if (slot) slot.appendChild(el("voicebar"));
  el("voicebar").hidden = !slot;
  if (name === "places") drawPlaces();
  if (name === "log") drawLog(true);
  window.scrollTo(0, 0);
}

// ---------- keys: the Button States frame (Ready, Pressed, Working, Done, Unavailable) ----------
// Pressed: flips to pink the instant a finger lands, with a light haptic and a soft tick.
let pressedEl = null;
document.addEventListener("pointerdown", (e) => {
  const k = e.target.closest(".key, #deafen, .place .go");   // the talk bar has its own hold feedback (app.js)
  if (!k || k.classList.contains("na")) return;
  pressedEl = k; k.classList.add("pressed");
  toNative({ type: "haptic" }); tap("both", "key");
}, { passive: true });
const unpress = () => { const k = pressedEl; pressedEl = null; if (k) setTimeout(() => { if (pressedEl !== k) k.classList.remove("pressed"); }, 90); };
document.addEventListener("pointerup", unpress); document.addEventListener("pointercancel", unpress);
// Done: white flash with a check for 0.6 s, then back to Ready.
const doneUntil = {};
function done(id) { doneUntil[id] = Date.now() + 600; }
// key(id, label, icon, style): style "" (dark), "light" (Stop), "hot" (Go, Resume). The state classes come on top.
function key(id, label, ic, style = "", extra = "") {
  const e = el(id); if (!e) return;
  let state = "";
  if (doneUntil[id] > Date.now()) { label = "Done"; ic = "check"; state = " done"; }
  setText(id + "-l", label); setHTML(id + "-ic", icon(ic));
  const base = e.className.split(" ").filter((c) => c === "row" || c === "wide").join(" ");
  const cls = ["key", base, style, extra].filter(Boolean).join(" ") + state + (pressedEl === e ? " pressed" : "");
  if (e.className !== cls) e.className = cls;
}
// Working: the key says what Pip is doing, and a pink light sweeps through it (sweep.glsl) until Pip answers.
const sweeps = new Map();
function working(id, on) {
  const e = el(id);
  if (on && !sweeps.has(id)) { const c = document.createElement("canvas"); c.className = "sweep"; c.setAttribute("aria-hidden", "true"); e.prepend(c); sweeps.set(id, shader(c, "sweep") || (() => {})); }
  if (!on && sweeps.has(id)) { e.querySelector("canvas.sweep")?.remove(); sweeps.delete(id); }
}
// Unavailable: dimmed, says why; VoiceOver reads "dimmed".
function avail(id, ok) { const e = el(id); if (e.getAttribute("aria-disabled") !== String(!ok)) e.setAttribute("aria-disabled", String(!ok)); }

// ---------- 02 Listening ----------
let shownLine = null;
function listen() {
  const now = Date.now();
  const down = (S.serverDown && now - S.serverDown < 60000) || (S.server && !S.server.ok);
  let app = deafened ? "DEAFENED" : "READY", glyph = "glyph", line, cursor = false;
  if (talking) { app = "LISTENING"; glyph = "glyph live"; line = "Go ahead"; cursor = true; }
  else if (S.looking) { app = "LOOKING"; glyph = "glyph live"; line = "Looking"; cursor = true; }
  else {
    if (down) { app = "OFFLINE"; glyph = "glyph bad"; }
    line = S.lastSpoken && now - (S.spokeAt || 0) < 20000 ? S.lastSpoken : down ? "I can't reach my planner right now" : deafened ? "Voice off" : "Where to?";
    if (line.length > 110) line = firstSentence(line);
    cursor = line === "Where to?";
  }
  setText("l-app", app); setCls("l-glyph", glyph);
  if (shownLine !== line) { shownLine = line; showLine(line, cursor); }
  showEl("l-cursor", cursor);
  showEl("l-server", Boolean(down));
  // keys: LOOK works while Pip looks; LOOK and FIND need the camera
  const cam = !S.camFail, look = Boolean(S.looking);
  working("k-look", look && !reduced());
  key("k-look", cam ? (look ? "Looking…" : "Look") : "No camera", cam ? "scan-eye" : "camera-off", "", look ? "work" : cam ? "" : "na"); avail("k-look", cam);
  key("k-find", cam ? "Find" : "No camera", cam ? "crosshair" : "camera-off", "", cam ? "" : "na"); avail("k-find", cam);
  key("k-spot", "Save spot", "map-pin");
}
let typing = null;
function showLine(text, cursor) {   // Pip's words type in letter by letter; the old line slides up and fades
  const e = el("say"), wrap = e.parentElement;
  clearInterval(typing);
  if (!reduced() && e.textContent && current === "listen") {
    const old = document.createElement("div"); old.className = "oldline " + e.className; old.textContent = e.textContent;
    Object.assign(old.style, { left: `${e.offsetLeft}px`, top: `${e.offsetTop}px`, width: `${e.offsetWidth}px` });
    wrap.appendChild(old);
    old.animate([{ opacity: 1, transform: "none" }, { opacity: 0, transform: "translateY(-12px)" }], { duration: 180, easing: "ease-out" }).onfinish = () => old.remove();
  }
  setCls("say", "say " + sizeSay(text, cursor));
  e.style.whiteSpace = cursor ? "nowrap" : "";
  if (reduced()) { e.textContent = text; return; }
  let i = 0; e.textContent = "";
  const step = Math.max(10, Math.min(35, 700 / text.length));   // a whole line types in under ~0.7 s
  typing = setInterval(() => { e.textContent = text.slice(0, ++i); if (i >= text.length) clearInterval(typing); }, step);
}
// Voice wave (wave.glsl): follows your voice while you hold the talk bar; flat otherwise. Offline: grey.
const waveCols = [];
let energy = 0;
function drawWave(t) {
  const down = (S.serverDown && Date.now() - S.serverDown < 60000) || (S.server && !S.server.ok);
  if (GL.wave) {
    const level = NATIVE ? N.mic || 0 : micLevel;
    const target = S.looking ? 0.35 : down ? 0.15 : talking ? Math.min(1, 0.12 + Math.max(0, level - 0.008) * 18) : 0;
    energy += (target - energy) * (target > energy ? 0.5 : 0.08);   // quick to rise, slow to fall
    GL.wave(reduced() ? 0 : t, { u_color: vec3(down ? css("--line") : css("--accent")), u_dim: vec3("#1A1C1A"), u_cols: 26, u_rows: 9, u_energy: energy });
    return;
  }
  const c = el("wave"), dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
  if (!W) return;
  if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
  const g = c.getContext("2d"); if (!g) return;
  g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  const sq = 6, gap = 2, cols = Math.floor((W + gap) / (sq + gap)), rows = 9, mid = 4, top = (H - rows * (sq + gap)) / 2;
  const off = down || !talking;
  const level = off ? 0 : Math.min(1, (NATIVE ? N.mic || 0 : micLevel) * 12);
  waveCols.push(level); while (waveCols.length > cols) waveCols.shift();
  for (let x = 0; x < cols; x++) {
    const v = waveCols[x - (cols - waveCols.length)] ?? 0, a = Math.round(v * mid);
    for (let y = 0; y < rows; y++) {
      const on = !off && Math.abs(y - mid) <= a && (a > 0 || y === mid);
      g.fillStyle = on ? (a === 0 && x % 2 ? "#3A3934" : "#FF5CA8") : off && y === mid ? (x % 2 ? "#0A0A09" : "#6B685F") : "#3A3934";
      g.fillRect(x * (sq + gap), top + y * (sq + gap), sq, sq);
    }
  }
}

// ---------- 03 Guiding ----------
let prog = { w: null, total: 0 };
const TURN_ICON = { left: "turn_left", right: "turn_right", around: "undo-2" };
function guide() {
  const w = S.walk, now = Date.now(), A = S.arrived && !w ? S.arrived : null;
  const name = w?.name || A?.name || (S.mission ? S.mission.room : S.back ? "start" : "");
  setText("g-goal", name ? "→ " + name : "");
  let tag = "ON COURSE", glyph = "glyph", arrow = "straight", flip = false, arrowCls = "arrow pulse", instr = "Keep going";
  let remaining = null, total = null;
  let k1 = "AHEAD", v1 = "–", v1c = "v", v2 = "–", v2c = "v", k3 = "TAPS", v3 = "OFF";
  const gps = Boolean(w?.path), l = w && !gps ? (S.paused ? locate(w.pts[w.i]) : w.l) : null, g = gps ? w.g : null;   // paused: the tap loop stops updating w.l
  const off = l ? l.off : g ? g.off : null;
  if (N.depth && N.depth.ahead != null) { const a = N.depth.ahead; v1 = a < 1 ? `${a.toFixed(1)} M` : `CLEAR ${a.toFixed(1)} M`; v1c = a < 1 ? "v bad" : "v ok"; }
  if (w && !gps && l) {   // taught route, point by point
    let rest = 0; for (let k = w.i; k < w.pts.length - 1; k++) rest += ptDist(w.pts[k], w.pts[k + 1]);
    remaining = l.d + rest;
    const a = nextTurn(w, l);
    v2 = a.last ? `ARRIVE · ${Math.round(a.d)} M` : a.turn ? `${a.turn} · ${Math.round(a.d)} M` : "–";
  }
  if (gps) {
    remaining = w.total - (w.s || 0); total = w.total;
    const m = w.man[w.m];
    v2 = m ? `${m.turn} · ${Math.round(Math.max(0, m.s - (w.s || 0)))} M` : `ARRIVE · ${Math.round(remaining)} M`;
    k3 = "GPS"; v3 = S.fix ? `±${Math.round(S.fix.acc)} M` : "–";
    tag = "OUTDOORS";
  }
  if (w) {
    if (prog.w !== w) prog = { w, total: remaining || 0 };
    if (remaining != null) { prog.total = Math.max(prog.total, remaining); prog.last = remaining; } else remaining = prog.last ?? null;   // lost: keep the last distance
    if (total == null) total = prog.total;
    const lost = w.lostSince && now - w.lostSince > (gps ? 3000 : 1000);
    const near = l ? nextTurn(w, l) : null, gm = gps ? w.man[w.m] : null;
    const heads = near && l.via !== "ar" && (near.turn === "left" || near.turn === "right") && near.d < 25 && near.d > 8 ? near.turn   // outdoors only, like the voice
      : gm && gm.turn !== "around" && gm.s - (w.s || 0) < 25 && gm.s - (w.s || 0) > 10 ? gm.turn : null;
    if (lost) {
      tag = "LOST TRACKING"; glyph = "glyph bad"; arrow = "location_searching"; arrowCls = "arrow";
      instr = gps ? "GPS is weak here. Wait a moment." : "Stand still. Point the phone around slowly."; k1 = "TRACKING"; v1 = "LOST"; v1c = "v bad";
    } else if (w.phase === "turn" && off != null) {
      const t = Math.abs(off) > 135 ? "around" : off < 0 ? "left" : "right";
      tag = gps ? "OUTDOORS" : "GUIDING"; arrow = TURN_ICON[t]; instr = turnScreen(off);
    } else if (!w.onCourse && off != null) {
      const big = Math.abs(off) > 60, t = off < 0 ? "left" : "right";
      tag = "OFF COURSE"; glyph = "glyph bad";
      arrow = big ? TURN_ICON[t] : "turn_slight_left"; flip = !big && t === "right";
      instr = big ? turnScreen(off) : `Bear ${t}`;
    } else if (heads) {
      tag = gps ? "OUTDOORS" : "GUIDING"; arrow = TURN_ICON[heads];
      instr = gm?.street ? `${cap(heads)} onto ${gm.street}` : `${cap(heads)} turn coming up`;
    }
    if (now - (S.hazardAt || 0) < 3000) { tag = "HAZARD"; glyph = "glyph bad"; arrow = "warning"; arrowCls = "arrow bad"; instr = "Careful. Something in front of you."; }
  } else if (S.back) {   // going back by timed steps (no tracking)
    tag = "GOING BACK";
    const t = noDot(currentDirection()); instr = t;
    arrow = /left/i.test(t) ? "turn_left" : /right/i.test(t) ? "turn_right" : /around/i.test(t) ? "undo-2" : "straight";
  } else if (A) {
    tag = "ARRIVED"; arrow = "flag"; arrowCls = "arrow s80"; instr = A.side ? `${cap(theName(A.name))} is on your ${A.side}` : `You're at ${theName(A.name)}`;
    remaining = 0; total = prog.total || 1; v2 = "—"; v2c = "v dim"; v3 = "OFF";
  }
  if (S.lastCue && !A && !gps) v3 = S.lastCue.kind === "on" ? `TICK · ${S.lastCue.interval} S` : `${S.lastCue.side} · ${(+S.lastCue.interval).toFixed(S.lastCue.interval < 0.2 ? 2 : 1)} S`;
  if (S.paused && !A) { tag = "PAUSED"; glyph = "glyph"; arrowCls = "arrow grey"; instr = "Paused"; if (!gps) v3 = "OFF"; }
  // arrow rhythm: the taps' interval when off course; otherwise faster the closer the next turn (2 m -> 0.5 s, far -> 2.2 s)
  const dTurn = l ? nextTurn(w, l).d : g && w.man[w.m] ? w.man[w.m].s - (w.s || 0) : null;
  const period = S.lastCue && S.lastCue.kind !== "on" ? Math.max(0.3, S.lastCue.interval * 2) : dTurn == null ? 2.2 : Math.max(0.4, Math.min(2.2, gps ? dTurn / 25 : dTurn / 4));
  setPeriod(el("g-arrow"), period);
  setText("g-tag", tag); setCls("g-glyph", glyph);
  if (tag !== "ON COURSE") el("g-tag").getAnimations?.().forEach((a) => a.cancel());   // no pulse when off course
  setHTML("g-arrow", icon(arrow, flip ? "flip" : "")); setCls("g-arrow", arrowCls);
  setText("g-instr", instr); setCls("g-instr", "say " + sizeSay(instr) + (S.paused && !A ? " grey" : ""));
  const hasProg = remaining != null && total;
  showEl("g-prog", Boolean(hasProg));
  if (hasProg) {
    const [d, u] = m1(remaining), pct = Math.max(0, Math.min(1, 1 - remaining / total));
    setText("g-dist", d); setText("g-unit", u); setText("g-pct", `${Math.round(pct * 100)}%`);
    fillSegs(Math.round(pct * 22));
  }
  setText("g-k1", k1); setText("g-v1", v1); setCls("g-v1", v1c); setText("g-v2", v2); setCls("g-v2", v2c); setText("g-k3", k3); setText("g-v3", v3);
  if (A) { key("k-g1", "Done", "check"); key("k-g2", "Back", "undo-2"); }
  else { key("k-g1", S.paused ? "Resume" : "Pause", S.paused ? "play" : "pause", S.paused ? "hot" : ""); key("k-g2", "Stop", "square", "light"); }
}
// The turn instruction on screen: the same words Pip says ("Turn left, to 10 o'clock.").
const turnScreen = (off) => noDot(typeof turnWords === "function" ? turnWords(off) : off < 0 ? "Turn left" : "Turn right");
function fillSegs(on) {   // progress blocks fill one at a time
  const box = el("g-segs");
  if (box.children.length !== 22) box.innerHTML = "<i></i>".repeat(22);
  let k = 0;
  [...box.children].forEach((b, i) => { const want = i < on; if (want !== b.classList.contains("on")) { b.style.transitionDelay = want ? `${(k++) * 60}ms` : "0ms"; b.classList.toggle("on", want); } });
}

// ---------- 04 Find ----------
function find() {
  const f = S.find, now = Date.now(), seen = f.move && now - f.seenAt < 1500;
  setText("f-goal", `→ ${f.target}`);
  const box = el("f-box"); box.hidden = !seen; box.classList.add("target");
  setPeriod(box, 1.25 * (1 - 0.7 * Math.min(1, (f.size || 0) * 8)));   // pulse.glsl speed 1.6, faster when closer
  if (seen) {
    const side = Math.max(0.08, Math.sqrt(f.size || 0.01));
    Object.assign(box.style, { left: `${(0.5 + (f.dx || 0)) * 100}%`, top: `${(0.5 + (f.dy || 0)) * 100}%`, width: `${side * 100}%`, height: `${side * 100}%` });
    setText("f-tag", `${f.target.split(" ").at(-1)} ${Math.round((f.score || 0) * 100)}%`);
  }
  const a = f.phase === "sweep" ? "Turn slowly" : seen ? noDot(f.lastSay || (f.move === "center" ? "Got it" : "")) || "Got it" : "Looking";
  setText("f-instr", a); setCls("f-instr", "say " + sizeSay(a));
}

// ---------- 08 Search ----------
const PHASE_STEP = { plan: 1, sweep: 1, scan: 1, map: 1, decide: 1, turn: 1, go: 2, approach: 2, orient: 2, slamback: 2, backtrack: 2, handle: 3, door: 3, through: 3, verify: 4, arrive: 4 };
const relWords = (b) => { const o = angleDiff(N.heading, b); return Math.abs(o) < 35 ? "straight" : Math.abs(o) > 135 ? "around" : o < 0 ? "left" : "right"; };
function search() {
  const m = S.mission, f = S.find, now = Date.now(), grocery = Boolean(f?.aisle || m?.item);
  setText("s-goal", `→ ${m ? m.item || m.room : f.target}`);
  const labels = grocery ? ["LOOKING", "GOING TO AISLE", "IN AISLE", "CHECKING SHELF"] : ["LOOKING", "GOING TO DOOR", "AT DOOR", "CHECKING ROOM"];
  const fseen = f && f.move && now - f.seenAt < 1500;
  const step = m ? PHASE_STEP[m.phase] || 1 : fseen ? 4 : 3;
  setText("s-app", `SEARCHING ${step}/4`);
  setHTML("s-track", labels.map((t, i) => `<div class="${i + 1 < step ? "done" : i + 1 === step ? "now" : ""}"><i></i>${t}</div>`).join(""));
  // viewfinder: signs the camera read (where they are in the picture), and the target by its direction
  const vf = el("s-vf"); let boxes = "";
  const signs = m?.view && now - m.view.at < 5000 ? m.view.signs : [];
  for (const sg of signs.slice(0, 3)) {
    if (sg.u == null) continue;
    const cls = grocery ? (sg.hit ? "box target" : "box other") : "box sign";
    boxes += `<div class="${cls}" style="left:${sg.u * 100}%;top:${sg.v * 100}%;width:${Math.min(60, 8 + sg.text.length * 2.2)}%;height:20%"><em>${esc(sg.text.slice(0, 22))}</em></div>`;
  }
  const t = m?.target, pose = N.pose;
  if (t && pose && N.heading != null && !(grocery && t.kind === "sign")) {
    const o = angleDiff(N.heading, roomBearing(pose, t)), d = roomDist(pose, t);
    if (Math.abs(o) < 30) boxes += `<div class="box target" style="--pp:${(0.62 * Math.min(1, Math.max(0.3, d / 6))).toFixed(2)}s;left:${50 + (o / 30) * 40}%;top:50%;width:18%;height:58%"><em>${esc(t.kind === "sign" ? "sign" : t.kind)} · ${d.toFixed(0)} M</em></div>`;
  }
  if (vf._b !== boxes) { vf._b = boxes; vf.querySelectorAll(".box").forEach((b) => b.remove()); vf.insertAdjacentHTML("beforeend", boxes); }
  // rows: SIGN (matching signs first), DOOR
  const rows = [];
  const hits = (m?.signs || []).slice(0, 2).map((s) => [s.text, grocery ? "v ok" : "v"]);
  const others = signs.filter((s) => !s.hit).slice(0, 2 - hits.length).map((s) => [s.text, grocery ? "v dim" : "v"]);
  for (const [txt, c] of [...hits, ...others]) rows.push(["SIGN", txt, c]);
  if (!rows.length) rows.push(["SIGN", f?.aisle || "–", f?.aisle ? "v ok" : "v dim"]);
  if (!grocery) {
    const d = t && pose ? `${relWords(roomBearing(pose, t))} ${roomDist(pose, t).toFixed(0)} M` : "–";
    rows.push([t?.kind === "opening" ? "OPENING" : "DOOR", d, t ? "v ok" : "v dim"]);
  }
  setHTML("s-rows", rows.map(([k, v, c]) => `<div class="r"><span class="k">${k}</span><span class="dots"></span><span class="${c}">${esc(v)}</span></div>`).join(""));
  // the instruction: one line, like the design ("Go left to the door", "Aisle 6, on your right")
  let a = "Looking. Turn slowly, I'm reading signs";
  if (m) {
    const ph = m.phase;
    if (ph === "map" || ph === "scan" || ph === "sweep") a = "Turn slowly all the way around";
    else if (ph === "decide" || ph === "plan") a = "Thinking";
    else if ((ph === "go" || ph === "approach" || ph === "slamback" || ph === "backtrack") && t && pose) {
      const r = relWords(roomBearing(pose, t)), where = r === "straight" ? "straight ahead" : r === "around" ? "behind you" : `on your ${r}`;
      if (t.kind === "sign" && grocery) a = `${cap(t.sign)}, ${where}`;
      else a = `${r === "straight" ? "Go straight" : r === "around" ? "Turn around" : `Go ${r}`} to the ${t.kind === "sign" ? "sign" : t.kind}`;
    }
    else if (ph === "turn") a = "Turn until the taps stop";
    else if (ph === "handle" || ph === "door") a = "At the door. Open it and walk through.";
    else if (ph === "through") a = "Walk through the door";
    else if (ph === "verify" || ph === "arrive") a = `Checking: is this the ${m.room}?`;
  } else if (f) a = fseen ? noDot(f.lastSay || "Got it") : `Walk in slowly. I'm looking for the ${f.target}`;
  setText("s-instr", a); setCls("s-instr", "say " + sizeSay(a) + (S.paused ? " grey" : ""));
  key("k-s1", S.paused ? "Resume" : "Pause", S.paused ? "play" : "pause", S.paused ? "hot" : "");
}

// ---------- 06 Teach, 03i Getting bearings, 03j Recognizing room ----------
function fillRing(dirs, all) {
  const svg = el("t-ring");
  if (svg.children.length !== 12) svg.innerHTML = ringSVG();
  [...svg.children].forEach((p, i) => p.classList.toggle("on", all || dirs.includes(i)));
}
function ringSVG() {
  let p = "";
  for (let i = 0; i < 12; i++) {
    const a0 = (i * 30 + 2) * Math.PI / 180, a1 = ((i + 1) * 30 - 2) * Math.PI / 180, R = 86, r = 58, c = 88;
    const pt = (rr, a) => `${(c + rr * Math.sin(a)).toFixed(1)},${(c - rr * Math.cos(a)).toFixed(1)}`;
    p += `<path d="M${pt(R, a0)} A${R},${R} 0 0 1 ${pt(R, a1)} L${pt(r, a1)} A${r},${r} 0 0 0 ${pt(r, a0)} Z"/>`;
  }
  return p;
}
function teach() {
  const L = S.learning, o = S.orient, sv = !L && !o ? S.saved : null;
  const following = o && !L, name = (following ? o.name : (L || sv)?.name) || "";
  setText("t-goal", name ? `→ ${name}` : "");
  let app, big, chip = "", ring = Boolean(o), map = null, rows = false, isDone = Boolean(sv), appCls = "app";
  if (following && o.mission) { app = "SEARCHING 1/4"; big = "Turn slowly all the way around"; }   // 08c Search · Looking around
  else if (following) {
    app = o.recognizing ? "ROOM CHECK 2/2" : "BEARINGS 1/2"; if (o.recognizing) appCls = "app recog";
    big = o.recognizing ? "Keep pointing the phone around slowly" : "Turn slowly all the way around";
  } else if (L && (L.orienting || o)) { app = "TEACH 1/3"; big = "Turn slowly all the way around"; }
  else if (L) {
    app = "RECORDING 2/3"; big = "You lead"; chip = "“We're here” to finish";
    map = { pts: (L.crumbs || []).map((c) => c.ar || (c.gps && L.crumbs.find((x) => x.gps) ? toLocal(L.crumbs.find((x) => x.gps).gps, c.gps) : null)).filter(Boolean), live: true };
    rows = true;
    let walked = 0; for (let i = 1; i < map.pts.length; i++) walked += Math.hypot(map.pts[i].x - map.pts[i - 1].x, map.pts[i].z - map.pts[i - 1].z);
    setText("t-walked", `${walked.toFixed(1)} M`);
    setText("t-turns", countTurns(keypoints(L.crumbs || [])));
    const tr = arReady() ? "OK" : gpsGood(20) ? "GPS" : "LOST"; setText("t-track", tr); setCls("t-track", tr === "LOST" ? "v bad" : "v ok");
  } else if (sv) {
    app = "SAVED 3/3"; big = `${cap(sv.name)} saved`; chip = `“Take me to ${theName(sv.name)}”`;
    const o0 = sv.pts.find((p) => p.gps)?.gps;
    map = { pts: sv.pts.map((p) => p.ar || (p.gps && o0 ? toLocal(o0, p.gps) : null)).filter(Boolean), live: false, name: sv.name };
  }
  setText("t-app", app); setCls("t-app", appCls);
  setText("t-big", big); setCls("t-big", "say " + sizeSay(big));
  setText("t-chip-t", chip); showEl("t-chip", Boolean(chip));
  showEl("t-compass", ring);
  if (ring) {
    setText("t-seen", o.seen); fillRing(o.dirs || [], o.recognizing);
    setHTML("t-ring-ic", icon(o.recognizing ? "scan-search" : "rotate-cw"));
  }
  showEl("t-map", Boolean(map)); teachMap = map;
  showEl("t-rows", rows); showEl("t-keys", !isDone); showEl("t-keys-done", isDone);
}
let teachMap = null;
function countTurns(pts) {
  let n = 0;
  for (let i = 2; i < pts.length; i++) { const b1 = legBearing(pts[i - 2], pts[i - 1]), b2 = legBearing(pts[i - 1], pts[i]); if (b1 != null && b2 != null && Math.abs(angleDiff(b1, b2)) > 35) n++; }
  return n;
}
// The route seen from above (the design's Trail): pink path, white crumbs, START square, YOU dot (recording) or the place (saved).
function drawMap(c, { pts, live, name }) {
  const dpr = devicePixelRatio || 1, W = c.clientWidth, H = c.clientHeight;
  if (!W) return;
  if (c.width !== W * dpr) { c.width = W * dpr; c.height = H * dpr; }
  const g = c.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
  if (!pts.length) return;
  const xs = pts.map((p) => p.x), zs = pts.map((p) => p.z), pad = 28, label = 96;   // seen from above: forward (-z) is up
  const minX = Math.min(...xs), maxX = Math.max(...xs), minZ = Math.min(...zs), maxZ = Math.max(...zs);
  const k = Math.min((W - 2 * pad - label) / Math.max(0.5, maxX - minX), (H - 2 * pad) / Math.max(0.5, maxZ - minZ), 60);
  const ox = pad + (W - 2 * pad - label - (maxX - minX) * k) / 2, oy = pad + (H - 2 * pad - (maxZ - minZ) * k) / 2;
  const Q = pts.map((p) => [ox + (p.x - minX) * k, oy + (p.z - minZ) * k]);
  const ACC = css("--accent"), FG = css("--fg"), DIM = css("--dim");
  g.lineWidth = 2; g.strokeStyle = ACC;
  g.beginPath(); Q.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); g.stroke();
  g.fillStyle = FG;
  if (live) for (let i = 1; i < Q.length - 1; i++) g.fillRect(Q[i][0] - 3, Q[i][1] - 3, 6, 6);   // a dot drops every 25 cm
  const [sx, sy] = Q[0]; g.strokeStyle = FG; g.lineWidth = 2; g.strokeRect(sx - 8, sy - 8, 16, 16);
  g.font = '700 13px "JetBrains Mono", monospace'; g.fillStyle = DIM; g.fillText("START", sx + 14, sy + 5);
  const [ex, ey] = Q.at(-1); g.fillStyle = ACC;
  if (live) {   // the YOU dot pulses (pulse.glsl speed 1.2, low 0.35)
    g.fillText("YOU", ex + 14, ey + 5);
    g.globalAlpha = reduced() ? 1 : 0.35 + 0.65 * (0.5 + 0.5 * Math.sin(performance.now() / 1000 * 1.2 * Math.PI));
    g.beginPath(); g.arc(ex, ey, 10, 0, 7); g.fill(); g.globalAlpha = 1;
  } else {
    g.fillRect(ex - 10, ey - 10, 20, 20); g.fillText(UP(name).slice(0, 14), ex + 14, ey + 5);
    let n = 0; g.font = '400 13px "JetBrains Mono", monospace'; g.fillStyle = DIM;
    for (let i = 1; i < pts.length - 1; i++) {
      const b1 = roomBearing(pts[i - 1], pts[i]), b2 = roomBearing(pts[i], pts[i + 1]);
      if (Math.abs(angleDiff(b1, b2)) > 35) g.fillText(`TURN ${++n}`, Q[i][0] + 10, Q[i][1] - 8);
    }
  }
}

// ---------- 09 Route preview ----------
const COMPASS = ["NORTH", "NORTHEAST", "EAST", "SOUTHEAST", "SOUTH", "SOUTHWEST", "WEST", "NORTHWEST"];
function preview() {
  const p = S.preview, path = p.path;
  setText("p-goal", `→ ${p.name}`);
  const q = `Walk to ${cap(p.name)}?`; setText("p-name", q); setCls("p-name", "say " + sizeSay(q));
  const [d, u] = m1(path.total); setText("p-dist", d); setText("p-unit", u); setText("p-min", `${p.mins} MIN WALK`);
  const b = roomBearing(path.P[0], pathAt(path.P, 15)), first = path.man[0];
  setText("p-first", first?.street ? `${COMPASS[Math.round(b / 45) % 8]} · ${first.street}` : `${COMPASS[Math.round(b / 45) % 8]} · ${Math.round(first ? first.s : path.total)} M`);
  setText("p-turns", path.man.length); setText("p-gps", `±${Math.round(p.acc)} M`);
}

// ---------- 07 Places ----------
const KIND = { room: "ROOM", gps: "GPS", hybrid: "BOTH", timed: "TIMED" };
function drawPlaces() {
  const routes = routesStore(), names = Object.keys(routes).sort((a, b) => (routes[b].t || 0) - (routes[a].t || 0));
  // VoiceOver reads a row as "Restroom, room, 7 meters, 2 turns"; buttons "Take me there" and "Delete"
  const row = (kind, i, nm, meta, aria) =>
    `<div class="place"><div class="nm" role="text" aria-label="${esc(aria)}"><b>${esc(nm)}</b><span>${esc(meta)}</span></div>` +
    `<button class="go" data-go="${kind}" data-i="${i}" aria-label="Take me there"><b>Go</b>${icon("arrow-right")}</button>` +
    `<button class="offscreen" data-del="${kind}" data-i="${i}" aria-label="Delete">Delete</button></div>`;
  let h = `<div class="sect"><span>ROUTES</span><b>${names.length}</b></div>`;
  h += names.length ? names.map((n, i) => {
    const r = routes[n], turns = r.turns ?? countTurns(r.points || []), kind = KIND[r.kind] || "ROOM";
    return row("route", i, n, `${kind} · ${Math.round(r.meters || 0)} M · ${turns} TURN${turns === 1 ? "" : "S"}`,
               `${n}, ${kind.toLowerCase()}, ${Math.round(r.meters || 0)} meters, ${turns} turns`);
  }).join("") : `<p class="empty">No routes yet. Say "teach me the way to the kitchen".</p>`;
  h += `<div class="sect"><span>SPOTS</span><b>${S.spots.length}</b></div>`;
  h += S.spots.length ? S.spots.map((s, i) => row("spot", i, s.label, `SPOT · ${s.pos ? "GPS" : "PATH"}`, `${s.label}, spot`)).join("")
    : `<p class="empty">No spots yet. Save spot remembers where you are.</p>`;
  el("pl-list").innerHTML = h; el("pl-list")._names = names; placesArmed = null;
}
el("pl-list").addEventListener("click", (e) => {
  const b = e.target.closest("button"); if (!b) return;
  const i = +b.dataset.i, names = el("pl-list")._names;
  if (b.dataset.go) {
    overlay = null;
    if (b.dataset.go === "route") replay(names[i]); else goBack(S.spots[i].label);
  } else if (b.dataset.del) {
    const id = b.dataset.del + i;
    if (placesArmed !== id) {   // first tap arms it (no pop-up dialogs), second tap deletes
      placesArmed = id; b.setAttribute("aria-label", "Tap again to delete"); setTimeout(() => { if (placesArmed === id) drawPlaces(); }, 3000); return;
    }
    if (b.dataset.del === "route") { const all = routesStore(); log("route deleted", names[i]); delete all[names[i]]; localStorage.setItem("pip.routes", JSON.stringify(all)); }
    else S.spots.splice(i, 1);
    drawPlaces();
  }
});

// ---------- 05 Setup, 05b Log ----------
function setup() {
  const inv = invert(); setCls("v-invert", inv ? "switch on" : "switch"); el("row-invert").setAttribute("aria-checked", inv);
  const cs = el("camsel");
  setText("v-camera", NATIVE ? (N.camera || "–") : cs.selectedOptions[0]?.textContent || "–");
  cs.hidden = NATIVE;
  setText("server", S.server ? (S.server.ok ? `${S.server.loaded}/5 READY` : "NO REPLY") : "–"); setCls("server", S.server && !S.server.ok ? "v bad" : "v acc");
}
let logShown = -1;
function drawLog(force) {
  key("copylog", "Copy log", "copy", "hot");
  if (!force && logShown === logLines.length) return;
  logShown = logLines.length;
  const box = el("log"), atEnd = box.scrollTop + box.clientHeight >= box.scrollHeight - 30, lines = logLines.slice(-200);
  box.innerHTML = lines.map((ln) => {
    const i = ln.indexOf(" "), t = ln.slice(0, i), x = ln.slice(i + 1);
    const c = /careful|hazard|something (right )?in front|error|failed|unreachable|can't|lost track/i.test(x) ? "bad" : /stop\. you're at|you're at|arrived|route saved|saved /i.test(x) ? "ok" : "";
    return `<div class="ln"><span class="t">${esc(t)}</span><span class="x ${c}">${esc(x)}</span></div>`;
  }).join("");
  setText("log-n", lines.length);
  if (atEnd || force) box.scrollTop = box.scrollHeight;
}

// ---------- keys ----------
const on = (id, f) => el(id)?.addEventListener("click", f);
el("scr-start").addEventListener("click", () => start());
on("btn-places", () => { overlay = "places"; });
on("btn-setup", () => { overlay = "setup"; });
document.querySelectorAll("[data-close]").forEach((b) => b.addEventListener("click", () => { overlay = null; }));
document.querySelectorAll("[data-back]").forEach((b) => b.addEventListener("click", () => { overlay = "setup"; }));
const noCam = () => { say("The camera isn't working, so I can't look right now."); };
on("k-look", () => (S.camFail ? noCam() : S.looking ? null : describe()));
on("k-find", () => (S.camFail ? noCam() : findKey()));
on("k-back", () => goBack());
on("k-spot", () => { saveSpot(`spot ${S.spots.length + 1}`); done("k-spot"); });
const pauseToggle = () => { S.paused = !S.paused; say(S.paused ? "Paused." : "Resuming."); };
on("k-g1", () => { if (S.arrived && !S.walk) { S.arrived = null; } else pauseToggle(); });
on("k-g2", () => { if (S.arrived && !S.walk) { S.arrived = null; goBack(); } else stopAll(); });
on("k-s1", pauseToggle);
on("k-s2", stopAll);
on("k-stopfind", () => findStop("Stopped looking."));
on("k-tstop", () => { if (S.learning) learnCancel(); else stopAll(); });
on("k-tdone", () => { S.saved = null; });
on("k-tplaces", () => { S.saved = null; overlay = "places"; });
on("k-go", () => previewGo());
on("k-cancel", () => previewCancel());
on("k-newroute", () => { overlay = null; say("Where to? Hold the talk bar and say: teach me the way to the kitchen."); });
on("k-plspot", () => { saveSpot(`spot ${S.spots.length + 1}`); done("k-plspot"); drawPlaces(); });
on("row-invert", () => { localStorage.setItem("pip.invert", invert() ? "0" : "1"); });
on("k-viewlog", () => { overlay = "log"; });
on("k-taps", () => {
  say("Left.");
  setTimeout(() => [0, 300, 600].forEach((d) => setTimeout(() => tap("left"), d)), 500);
  setTimeout(() => { say("Right."); setTimeout(() => [0, 300, 600].forEach((d) => setTimeout(() => tap("right"), d)), 500); }, 2200);
});
const send = () => { const i = el("ask"), v = i.value.trim(); if (!v) return; i.value = ""; overlay = null; askPip({ text: v }); i.blur(); };
on("ask-send", send);

// VoiceOver gestures (the phone app calls these): two-finger double-tap, two-finger Z scrub. done(id): a key flashes Done.
window.pipUI = {
  done,
  magicTap() { if (S.walk || S.mission || S.find || S.back) pauseToggle(); else if (S.preview) previewGo(); else say(S.lastSpoken || "Where to?"); },
  escape() {
    if (overlay) { overlay = overlay === "log" ? "setup" : null; return true; }
    if (S.preview) { previewCancel(); return true; }
    if (S.learning) { learnCancel(); return true; }
    if (S.find && !S.mission) { findStop("Stopped looking."); return true; }
    if (S.walk || S.mission || S.back || S.walkTok) { stopAll(); return true; }
    if (S.arrived || S.saved) { S.arrived = null; S.saved = null; return true; }
    return false;
  },
};

// Larger Text (Dynamic Type): keys stack to one column
function textSize() {
  const probe = document.createElement("div"); probe.style.font = "-apple-system-body"; probe.style.position = "absolute"; probe.textContent = "x";
  document.body.appendChild(probe); const px = parseFloat(getComputedStyle(probe).fontSize) || 17; probe.remove();
  document.body.classList.toggle("large", px > 19);
}

// Voice Bar: "Hold to talk" is pink "Listening" while held; Deafen is pink "Undeafen" while on
function voiceKeys() {
  setText("talk-l", talking ? "Listening" : "Hold to talk");
  setText("deafen-l", deafened ? "Undeafen" : "Deafen"); setHTML("deafen-ic", icon(deafened ? "headphone-off" : "headphones"));
  const a = deafened ? "Undeafen Pip" : "Deafen Pip"; if (el("deafen").getAttribute("aria-label") !== a) el("deafen").setAttribute("aria-label", a);
}

// ---------- loop ----------
function tick() {
  const name = pick(); go(name);
  try {
    if (name === "listen") listen();
    else if (name === "guide") guide();
    else if (name === "find") find();
    else if (name === "search") search();
    else if (name === "teach") teach();
    else if (name === "preview") preview();
    else if (name === "setup") setup();
    else if (name === "places") key("k-plspot", "Save spot", "map-pin");
    else if (name === "log") drawLog(false);
  } catch (e) { if (!tick.err) { tick.err = true; log("screen error:", name, e.message); } }
  voiceKeys();
}
setInterval(tick, 100);
let waveAt = 0;
(function frame(ms) {
  const t = ms / 1000, still = reduced();
  try {
    if (current === "start" && GL.cursor) GL.cursor(still ? 0 : t, { u_color: vec3(css("--accent")), u_rate: 1.1 });
    if (current === "listen") {
      if (GL.wave || ms - waveAt > 50) { waveAt = ms; drawWave(t); }
      if (GL["l-cursor"] && !el("l-cursor").hidden) GL["l-cursor"](still ? 0 : t, { u_color: vec3(css("--accent")), u_rate: 1.1 });
    }
    if (current === "find" && GL["f-vf"]) GL["f-vf"](still ? 0 : t, { u_color: vec3(css("--accent")), u_grid: 25 });
    if (current === "search" && GL["s-vf"]) GL["s-vf"](still ? 0 : t, { u_color: vec3(css("--accent")), u_grid: 25 });
    if (current === "teach" && teachMap) drawMap(el("t-map"), teachMap);
    for (const draw of sweeps.values()) draw(t, { u_base: vec3(css("--bg")), u_shine: vec3(css("--accent")), u_speed: 0.7 });
  } catch (e) { if (!frame.err) { frame.err = true; log("animation error:", e.message); } }
  requestAnimationFrame(frame);
})(0);
initShaders(); textSize(); tick();
// One line at startup so a phone's log shows why animations might be missing (Reduce Motion stops them, per the design).
log("screen:", "reduce motion", reduced() ? "ON (animations stopped)" : "off", "· shaders", ["cursor", "wave", "f-vf", "s-vf"].map((k) => `${k} ${GL[k] ? "ok" : "off"}`).join(", "));
})();
