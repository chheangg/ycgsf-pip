// ycgsf browser app: GPS + camera + mic on the laptop, models on the 4090 (server/app.py).
// Audio rule: taps come from the side you should turn toward. Slow when the turn is far, fast when
// close ("  .  . . . .."), silent when you're on course and the way is clear.
"use strict";

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const SERVER = (qs.get("server") || localStorage.getItem("ycgsf.server") || "http://100.71.218.127:8100").replace(/\/$/, "");
$("srv").value = SERVER;
$("srv").onchange = (e) => { localStorage.setItem("ycgsf.server", e.target.value); location.reload(); };
const SESSION = Math.random().toString(36).slice(2);
// Running inside the iPhone app: sensors come from the phone (0.5x / ARKit camera, LiDAR, gyro, steps, GPS, mic).
const NATIVE = Boolean(window.PIP_NATIVE && window.webkit?.messageHandlers?.pip);
const toNative = (m) => NATIVE && window.webkit.messageHandlers.pip.postMessage(m);
const nativeWaits = new Map(), nativeSpeech = new Map(); let nativeId = 0;
const askNative = (msg) => new Promise((res) => { const id = ++nativeId; nativeWaits.set(id, res); toNative({ ...msg, id });
                                                  setTimeout(() => { if (nativeWaits.delete(id)) res(null); }, 1500); });
const N = { heading: null, pose: null, depth: null, distance: 0, camera: "", doors: [], frontiers: [], mapped: 0 };   // phone sensors
window.pipNative = {
  update(snap) {
    N.heading = snap.heading; N.pose = snap.pose || null; N.depth = snap.depth || null; N.distance = snap.distance_m || 0; N.camera = snap.camera;
    if (snap.doors) { N.doors = snap.doors; N.frontiers = snap.frontiers || []; N.mapped = snap.mapped_m2 || 0; }
    S.heading = snap.heading;
    if (snap.gps) onFix({ lat: snap.gps.lat, lon: snap.gps.lon }, snap.gps.acc);
    if (N.depth && $("clear") && !S.mission && !S.find) $("clear").textContent = `ahead ${N.depth.ahead.toFixed(1)} m`;
  },
  frame(id, b64) { const r = nativeWaits.get(id); nativeWaits.delete(id); r?.(b64 || null); },
  pinned(id, p) { const r = nativeWaits.get(id); nativeWaits.delete(id); r?.(p); },
  spoke(id) { const r = nativeSpeech.get(id); nativeSpeech.delete(id); r?.(); },
  phrase(b64) {
    if (!started) return;
    const bin = atob(b64), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    if (listenMode !== "push") askPip({ body: buf.buffer, wake: listenMode === "always" ? "always" : "1" });
  },
};
const b64ToBlob = (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: "image/jpeg" }); };
// Geometry on the room floor (ARKit meters): bearing from the user to a pinned point, clockwise degrees.
const roomBearing = (from, to) => (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180 / Math.PI + 360) % 360;
const roomDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const routesStore = () => { try { return JSON.parse(localStorage.getItem("pip.routes") || "{}"); } catch { return {}; } };
const log = (...a) => { const el = $("log"); el.textContent = `${new Date().toLocaleTimeString()} ${a.join(" ")}\n` + el.textContent.slice(0, 4000); };

// ---------- geo helpers ----------
const R = 6371000, rad = (d) => (d * Math.PI) / 180, deg = (r) => (r * 180) / Math.PI;
function dist(a, b) {
  const dl = rad(b.lat - a.lat), dn = rad(b.lon - a.lon);
  const h = Math.sin(dl / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dn / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearing(a, b) {
  const y = Math.sin(rad(b.lon - a.lon)) * Math.cos(rad(b.lat));
  const x = Math.cos(rad(a.lat)) * Math.sin(rad(b.lat)) - Math.sin(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.cos(rad(b.lon - a.lon));
  return (deg(Math.atan2(y, x)) + 360) % 360;
}
const angleDiff = (a, b) => ((b - a + 540) % 360) - 180;   // + = target is to the right
const move = (p, brg, m) => ({ lat: p.lat + (m * Math.cos(rad(brg))) / 111320,
                               lon: p.lon + (m * Math.sin(rad(brg))) / (111320 * Math.cos(rad(p.lat))) });

// ---------- state ----------
const S = {
  pos: null, acc: null, fixAt: 0, heading: null, gpsOk: false, sim: false,
  route: null, stepIdx: 1, spokenFor: {}, paused: false, dest: null,
  clear: null, hint: "clear", hazards: [], lastSpoken: "",
  trail: [], seg: null, spots: [], crumbs: [], back: null,
  find: null,   // {target, move, size, saidAt, lastSay, seenAt, gotAt}
  learning: null, // {name, start, trailIdx}: recording a route to teach Pip (works indoors)
  mission: null,  // go_to_room: {room, via, proof, phase: scan|orient|approach|through|verify|arrive, ...}
};

// ---------- 1. AUDIO: tip-tap with swapped channels ----------
let ac;
const invert = () => $("invert").value === "1";
function tap(side, kind = "tap") {
  if (NATIVE) return toNative({ type: "tap", side, kind, inverted: invert() });   // native audio keeps the mic alive
  if (!ac) return;
  const t = ac.currentTime, osc = ac.createOscillator(), g = ac.createGain(), out = ac.createChannelMerger(2);
  // Hard-route to ONE channel (not panning). Headphones upside down: the "R" cup sits on the left ear.
  const ear = side === "both" ? null : (side === "left") !== invert() ? 0 : 1;   // 0 = left channel, 1 = right
  const [f, dur, vol] = kind === "warn" ? [520, 0.06, 0.55] : kind === "stop" ? [200, 0.09, 0.7]
    : kind === "up" ? [2600, 0.03, 0.45] : kind === "down" ? [700, 0.04, 0.55] : kind === "got" ? [1320, 0.12, 0.5] : [1800, 0.022, 0.45];
  osc.type = kind === "tap" ? "sine" : "triangle";
  osc.frequency.value = f;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g);
  if (ear === null) { g.connect(out, 0, 0); g.connect(out, 0, 1); } else g.connect(out, 0, ear);
  out.connect(ac.destination);
  osc.start(t); osc.stop(t + dur + 0.02);
}
// What the taps should be doing right now: {side, interval (s), kind} or null for silence.
function cue() {
  if (S.paused) return null;
  if (S.mission) return missionCue();
  if (!guiding() && !S.find) S.hint = "clear";
  if (S.find) return findCue();
  if (S.hint === "stop") return { side: "both", interval: 0.25, kind: "stop" };
  if (S.hint === "veer_left") return { side: "left", interval: 0.22, kind: "warn" };
  if (S.hint === "veer_right") return { side: "right", interval: 0.22, kind: "warn" };
  const nav = navCue();
  return nav;
}
let nextTap = 0;
function audioLoop() {
  const c = cue(), now = performance.now() / 1000;
  if (c && now >= nextTap) {
    if (c.double) { tap(c.side, c.kind); setTimeout(() => tap(c.side, c.kind), 110); } else tap(c.side, c.kind);
    nextTap = now + c.interval;
  }
  if (!c) nextTap = 0;
  requestAnimationFrame(audioLoop);
}
// Pip's voice: Kokoro-82M on the 4090 (natural), browser voice if the server is slow or down.
// One voice at a time. While Pip is talking, only the NEWEST waiting line is kept (stale ones are dropped);
// only urgent lines (obstacle, stop) cut in.
let voiceSrc = null, voiceChain = Promise.resolve(), speakingUntil = 0, voiceBusy = false, pendingLine = null, voiceGen = 0;
const speaking = () => voiceBusy || performance.now() < speakingUntil || speechSynthesis.speaking;
function say(text, { urgent = false } = {}) {
  if (!text) return;
  S.lastSpoken = text; $("say").textContent = text; log("SAY", text);
  if (urgent) { voiceGen++; try { voiceSrc?.stop(); } catch {} speechSynthesis.cancel(); toNative({ type: "stopSay" }); pendingLine = null; voiceBusy = false; }
  if (voiceBusy) { pendingLine = text; return; }
  playLine(text);
}
async function playLine(text) {
  voiceBusy = true; const gen = voiceGen; toNative({ type: "speaking", on: true });
  try { await speakNow(text, gen); } catch {}
  if (gen !== voiceGen) return;            // an urgent line took over
  voiceBusy = false; setTimeout(() => !voiceBusy && toNative({ type: "speaking", on: false }), 300);
  if (pendingLine) { const next = pendingLine; pendingLine = null; playLine(next); }
}
async function speakNow(text, gen = voiceGen) {
  if (NATIVE) {                                   // the app plays Pip's voice natively and tells us when it's done
    const id = ++nativeId;
    await new Promise((res) => { nativeSpeech.set(id, res); toNative({ type: "say", text, id, server: SERVER }); setTimeout(res, 30000); });
    return;
  }
  if (ac.state !== "running") await ac.resume();   // Chrome pauses idle audio
  // Sentence by sentence: the first one plays fast; long replies don't time out.
  const parts = text.match(/[^.!?]+[.!?]*/g)?.map((x) => x.trim()).filter(Boolean) || [text];
  const fetchOne = (t) => fetch(`${SERVER}/tts?text=${encodeURIComponent(t)}`, { signal: AbortSignal.timeout(6000) })
    .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }).then((b) => ac.decodeAudioData(b));
  let next = fetchOne(parts[0]);
  for (let i = 0; i < parts.length; i++) {
    let audio;
    try { audio = await next; } catch { return fallbackVoice(parts.slice(i).join(" ")); }
    if (gen !== voiceGen) return;
    if (i + 1 < parts.length) next = fetchOne(parts[i + 1]);   // fetch the next sentence while this one plays
    await new Promise((res) => {
      const src = ac.createBufferSource(); src.buffer = audio; src.connect(ac.destination);
      src.onended = res; voiceSrc = src; src.start();
      speakingUntil = performance.now() + audio.duration * 1000 + 300;
    });
  }
}
function fallbackVoice(text) {   // browser voice; Chrome drops speak() right after cancel(), so wait a beat
  return new Promise((res) => setTimeout(() => {
    const u = new SpeechSynthesisUtterance(text); u.rate = 1.1; u.onend = res; u.onerror = res;
    speechSynthesis.speak(u); setTimeout(res, 15000);
  }, 150));
}

// ---------- 2. GPS (Chrome uses Google's location service) + memory ----------
function onFix(p, acc, real = true) {
  const now = Date.now();
  if (S.pos && dist(S.pos, p) >= 4) {   // course from movement: a laptop has no compass
    const b = bearing(S.pos, p);
    if (S.heading != null && Math.abs(angleDiff(S.heading, b)) > 55) endSegment(angleDiff(S.heading, b) < 0 ? "left" : "right");
    S.heading = b;
  }
  if (!S.pos || dist(S.pos, p) >= 4) S.pos = p;
  S.acc = acc; S.fixAt = now;
  const wasOk = S.gpsOk;
  S.gpsOk = acc <= 60;
  if (wasOk && !S.gpsOk && real) say("GPS is weak here. I'm remembering your path, so I can take you back.");
  if (S.gpsOk) { const last = S.crumbs.at(-1); if (!last || dist(last, p) > 8) S.crumbs.push({ ...p, t: now }); }
  if (!S.seg) startSegment();
  if (S.seg && S.heading != null && S.seg.heading == null) S.seg.heading = S.heading;
  render(); followRoute();
}
let gpsOn = false;
function ensureGPS() { if (!gpsOn) { gpsOn = true; NATIVE ? toNative({ type: "gps" }) : startGPS(); } }   // only when needed
function startGPS() {
  if (!navigator.geolocation) return log("no geolocation");
  navigator.geolocation.watchPosition(
    (x) => !S.sim && onFix({ lat: x.coords.latitude, lon: x.coords.longitude }, x.coords.accuracy),
    (e) => { log("GPS error", e.message); S.gpsOk = false; render(); },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
  setInterval(() => { if (!S.sim && Date.now() - S.fixAt > 20000 && S.gpsOk) { S.gpsOk = false; say("Lost GPS. I'm remembering your path."); render(); } }, 5000);
}
// The trail: segments of straight walking, split at turns. Works with or without GPS.
function startSegment() { S.seg = { start: Date.now(), heading: S.heading, landmarks: [] }; }
function endSegment(turn) {
  if (!S.seg) return startSegment();
  S.trail.push({ seconds: (Date.now() - S.seg.start) / 1000, heading: S.seg.heading, turn_after: turn,
                 landmarks: [...new Set(S.seg.landmarks)].slice(-4) });
  S.trail = S.trail.slice(-30);
  log("trail +", turn, S.trail.length, "segments");
  startSegment();
}

// ---------- 3. ROUTE following (long-term plan from the 4090) ----------
function navCue() {
  if (S.back) return backCue();   // also replays taught routes
  if (!S.route || !S.pos) return null;
  const step = S.route.steps[S.stepIdx];
  if (!step) return null;
  const d = dist(S.pos, step);
  if (step.turn !== "straight" && step.turn !== "arrive" && d < 30) {   // the turn is coming: taps speed up
    return { side: step.turn, interval: Math.max(0.12, Math.min(1.5, d / 20)), kind: "tap", double: d < 6 };
  }
  if (S.heading != null && d > 10) {                                    // off course: steer
    const off = angleDiff(S.heading, bearing(S.pos, step));
    if (Math.abs(off) > 40) return { side: off < 0 ? "left" : "right", interval: Math.abs(off) > 120 ? 0.35 : 0.8, kind: "tap" };
  }
  return null;   // on course: silence
}
function followRoute() {
  if (!S.route || !S.pos || S.paused || S.back) return;
  const step = S.route.steps[S.stepIdx];
  if (!step) return;
  const d = dist(S.pos, step), key = (k) => `${S.stepIdx}:${k}`;
  const turnWord = step.turn === "left" ? "turn left" : step.turn === "right" ? "turn right" : "continue";
  if (step.turn === "arrive" && d < 15) {   // GPS gets you close; the camera does the last few meters
    const name = S.route.name; S.route = null; render();
    say(`We're at ${name}. Now I'll find the entrance with the camera.`);
    return missionStart(`entrance of ${name}`, "door", ["entrance", "door", "doorway"]);
  }
  if (d < 40 && d > 15 && !S.spokenFor[key("pre")] && step.turn !== "straight") {
    S.spokenFor[key("pre")] = 1; say(`In ${Math.round(d / 10) * 10} meters, ${turnWord}${step.name ? ` onto ${step.name}` : ""}.`);
  }
  if (d < 7) {
    if (step.turn !== "straight" && !S.spokenFor[key("now")]) { S.spokenFor[key("now")] = 1; say(`${turnWord[0].toUpperCase() + turnWord.slice(1)} now.`); }
    if (step.turn === "left" || step.turn === "right") endSegment(step.turn);
    S.stepIdx++;
  }
  render();
}
function startRoute(r) {
  ensureGPS(); ensureCamera();
  S.route = r; S.stepIdx = 1; S.spokenFor = {}; S.back = null; S.find = null;
  log("route", r.name, r.total_m + "m", r.steps.length, "steps", r.google_maps || ""); render();
}
async function planTo(body) {
  ensureGPS();
  if (!S.pos) return say("I don't know where you are yet. Waiting for GPS.");
  say("Planning the route.");
  try {
    const r = await post("/plan", { origin: S.pos, ...body });
    if (!r.ok) return say(r.say);
    S.route = r; S.stepIdx = 1; S.spokenFor = {}; S.dest = body; S.back = null;
    log("route", r.name, r.total_m + "m", r.steps.length, "steps", r.ms + "ms", r.google_maps);
    say(r.say); render();
  } catch (e) { say("I can't reach the planner right now."); log(e); }
}

// ---------- backtrack: GPS -> plan back; no GPS -> reverse the remembered trail ----------
async function goBack(label) {
  if (S.mission) return backtrack(S.mission, "the user said this way is wrong");   // uses GPS only if it's already on; otherwise the remembered path
  const spot = label ? S.spots.find((s) => s.label.toLowerCase().includes(label.toLowerCase())) : S.spots.at(-1);
  if (S.gpsOk && (spot?.pos || S.crumbs[0])) return planTo({ to: spot?.pos || S.crumbs[0] });
  endSegment(null);
  const segs = spot ? S.trail.slice(spot.trailIdx) : S.trail;
  if (!segs.length) return say("I haven't recorded enough of your path to go back yet.");
  try {
    const r = await post("/backtrack", { segments: segs, origin_label: spot?.label || "where we started" });
    S.back = { steps: r.steps, i: 0, started: Date.now() }; S.route = null;
    say(r.say); log("backtrack", JSON.stringify(r.steps));
  } catch (e) { say("I can't reach the planner right now."); log(e); }
}
function backCue() {
  const b = S.back, st = b.steps[b.i];
  if (!st) { S.back = null; return null; }
  const el = (Date.now() - b.started) / 1000;
  if (st.action === "turn_around" || st.action === "left" || st.action === "right") {
    if (el > 4) { b.i++; b.started = Date.now(); const n = b.steps[b.i];
      if (n?.action === "walk") say(`Walk straight about ${n.seconds} seconds${n.landmark ? `, past a ${n.landmark}` : ""}.`); }
    if (el < 0.1 && st.action !== "turn_around") say(`Turn ${st.action}.`);
    return { side: st.action === "turn_around" ? "both" : st.action, interval: 0.3, kind: "tap" };
  }
  if (st.action === "walk") {
    if (el > st.seconds) { b.i++; b.started = Date.now(); }
    const left = st.seconds - el;
    return left < 6 ? { side: b.steps[b.i + 1]?.action === "left" ? "left" : b.steps[b.i + 1]?.action === "right" ? "right" : "both",
                        interval: Math.max(0.15, left / 4), kind: "tap" } : null;
  }
  if (st.action === "arrive") { say(b.arriveMsg || "You should be back where you started."); S.back = null; b.onArrive?.(); }
  return null;
}

// ---------- teach a route (indoors too): walk it once, Pip replays it later ----------
function learnStart(name, start) {
  ensureCamera();
  endSegment(null);
  S.learning = { name, start: start || "here", trailIdx: S.trail.length };
  say(`Recording the way to ${name}. Walk there, and use the arrow keys when you turn. Say "we're here" when you arrive.`);
}
function learnEnd() {
  if (!S.learning) return say("I wasn't recording a route.");
  endSegment(null);
  const segs = S.trail.slice(S.learning.trailIdx);
  const all = routesStore(); all[S.learning.name] = { start: S.learning.start, segments: segs, t: Date.now() };
  localStorage.setItem("pip.routes", JSON.stringify(all));
  say(`Saved the way to ${S.learning.name}, from ${S.learning.start}. Next time just ask me to take you there.`);
  S.learning = null;
}
function replay(name) {
  ensureCamera();
  const all = routesStore(), key = Object.keys(all).find((k) => k.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(k.toLowerCase()));
  if (!key) return say(`I don't have a route called ${name} yet.`);
  const steps = [];
  for (const sg of all[key].segments) {
    steps.push({ action: "walk", seconds: Math.round(sg.seconds), landmark: sg.landmarks?.at(-1) || null });
    if (sg.turn_after === "left" || sg.turn_after === "right") steps.push({ action: sg.turn_after, seconds: 0 });
  }
  steps.push({ action: "arrive" });
  S.back = { steps, i: 0, started: Date.now(), arriveMsg: `You should be at ${key}.` }; S.route = null;
  const first = steps[0];
  say(`Starting from ${all[key].start}. Walk straight about ${first.seconds} seconds.`);
}

// ---------- SLAM MISSION (iPhone with LiDAR): decide from the floor map, not from guesses ----------
// map (spin to map the room) -> decide (pick a REAL door/opening from the map) -> go (A* path, taps) ->
// at a door: open it -> through -> map again ... -> done only when the vision model agrees we're inside.
const slamReady = () => NATIVE && N.pose && N.pose.tracking === "ok";
const relDir = (bearing) => { const off = ((bearing - N.heading + 540) % 360) - 180;
  return Math.abs(off) < 35 ? "ahead" : Math.abs(off) > 135 ? "behind" : off < 0 ? "left" : "right"; };
function slamCandidates(m) {
  const me = N.pose, out = [];
  const visited = (p) => m.visited.some((v) => roomDist(v, p) < 1.0);
  for (const d of N.doors) out.push({ id: "door-" + d.id.slice(0, 6), kind: "door", x: d.x, z: d.z });
  for (const f of N.frontiers) {
    if (out.some((c) => roomDist(c, f) < 0.8)) continue;              // a door there already covers it
    if (roomDist(me, f) < 0.8) continue;
    out.push({ id: `open-${Math.round(f.x * 10)}_${Math.round(f.z * 10)}`, kind: "opening", x: f.x, z: f.z });
  }
  return out.map((c) => ({ ...c, distance_m: +roomDist(me, c).toFixed(1), direction: relDir(roomBearing(me, c)), visited: visited(c) }))
            .sort((a, b) => a.distance_m - b.distance_m).slice(0, 10);
}
async function slamMap(m, why) {
  m.phase = "map"; m.phaseAt = Date.now(); render();
  say(m.decisions.length ? "Let me map this spot. Turn slowly all the way around." : "I'll map the room first. Turn slowly all the way around.");
  let turned = 0, last = N.heading; const t0 = Date.now();
  await new Promise((r) => setTimeout(r, 1500));
  while (S.mission === m && Math.abs(turned) < 330 && Date.now() - t0 < 30000) {
    turned += ((N.heading - last + 540) % 360) - 180; last = N.heading;
    await new Promise((r) => setTimeout(r, 100));
  }
  if (S.mission !== m) return;
  say("Okay, stop.", { urgent: true });
  await slamCheckRoom(m);                                           // are we already there?
  if (S.mission === m && !m.done) slamDecide(m, why);
}
async function slamCheckRoom(m) {
  const blob = await frameBlob(); if (!blob) return;
  const fd = new FormData(); fd.append("image", blob, "f.jpg"); fd.append("room", m.room);
  try {
    const c = await (await fetch(SERVER + "/check_room", { method: "POST", body: fd })).json();
    log("inside", m.room, "?", JSON.stringify(c));
    if (c.inside) { m.done = true; say(`You're in the ${m.room}.`); S.mission = null; render(); }
    else if (c.room && c.room !== "unknown") { if (m.place && m.place !== c.room) say(`You've left the ${m.place}. This is a ${c.room}.`); m.place = c.room; }
  } catch {}
}
async function slamDecide(m, why) {
  m.phase = "decide"; render();
  const cands = slamCandidates(m);
  if (!cands.length) return slamBacktrack(m, "I can't see any way through from here");
  const r = await post("/decide_slam", { goal: m.room, candidates: cands.map(({ x, z, ...c }) => c), memory: m.history.slice(-6), place: m.place || "unknown" });
  if (S.mission !== m) return;
  log("slam decide:", r.choice, r.why, JSON.stringify(cands.map((c) => `${c.id} ${c.distance_m}m ${c.direction}${c.visited ? " V" : ""}`)));
  if (r.choice === "backtrack") return slamBacktrack(m, r.why);
  const c = cands.find((x) => x.id === r.choice);
  m.decisions.push({ x: N.pose.x, z: N.pose.z });                  // a junction to come back to
  m.history.push(`${why}: in ${m.place || "?"}; went for ${c.kind} ${c.distance_m} m ${c.direction} (${r.why})`);
  m.target = c; say(r.say);
  slamGo(m);
}
async function slamGo(m) {
  m.phase = "go"; m.phaseAt = Date.now(); m.path = null; render();
  await slamRepath(m);
}
async function slamRepath(m) {
  m.repathAt = Date.now();
  const pts = await askNative({ type: "path", x: m.target.x, z: m.target.z });
  if (S.mission !== m) return;
  if (!pts || !pts.length) { log("no path to", m.target.id); m.path = [{ x: m.target.x, z: m.target.z }]; return; }   // straight line
  m.path = pts;
}
function slamNext(m) {   // next waypoint at least 0.5 m away
  if (!m.path) return null;
  while (m.path.length > 1 && roomDist(N.pose, m.path[0]) < 0.5) m.path.shift();
  return m.path[0];
}
function slamStep(m) {
  if (!slamReady()) { if (Date.now() - (m.trackSaidAt || 0) > 10000) { m.trackSaidAt = Date.now(); say("I'm losing track. Hold the phone steady and point it around the room."); } return; }
  const t = Date.now();
  if (m.phase === "go" && m.target) {
    const d = roomDist(N.pose, m.target);
    if (t - (m.obstacleCheckAt || 0) > 1500) obstacleCheck(m);
    if (t - m.repathAt > 3000) slamRepath(m);
    if (d < 0.9) {
      m.visited.push({ x: m.target.x, z: m.target.z });
      if (m.target.kind === "door") { m.doorPos = { x: m.target.x, z: m.target.z }; doorStep(m); }
      else slamMap(m, `reached an opening`);
      return;
    }
    if (t - (m.distSaidAt || 0) > 7000 && d > 1.5) { m.distSaidAt = t; mSay(`About ${Math.round(d)} meters to go.`, 7000); }
  }
  if (m.phase === "through" && m.doorPos && roomDist(N.pose, m.doorPos) > 1.5) { m.doorPos = null; slamMap(m, "walked through a door"); }
  if (m.phase === "through" && t - m.phaseAt > 15000) slamMap(m, "should be through the door");
  if (m.phase === "slamback" && m.backTo && roomDist(N.pose, m.backTo) < 0.7) { m.backTo = null; slamMap(m, "came back to a junction"); }
}
function slamBacktrack(m, why) {
  m.backtracks = (m.backtracks || 0) + 1;
  const back = m.decisions.pop();
  if (!back || m.backtracks > 4) return giveUp(m);
  m.history.push(`dead end: ${why}`);
  m.phase = "slamback"; m.backTo = back; m.target = { ...back, kind: "junction", id: "back" }; render();
  say(`${why[0].toUpperCase() + why.slice(1)}. Let's go back, about ${Math.max(1, Math.round(roomDist(N.pose, back)))} meters.`);
  askNative({ type: "path", x: back.x, z: back.z }).then((pts) => { if (S.mission === m) m.path = pts || [back]; });
}

// ---------- GO TO A ROOM: door -> line up -> walk -> through -> verify (done only on proof) ----------
const sideOf = (dx) => (dx < 0 ? "left" : "right");
// Walking toward a pinned spot in the room (ARKit): taps on the side to turn toward when off course,
// quiet when heading the right way. Works even when the landmark is out of the camera's view.
function walkToCue(target) {
  if (!N.pose || N.heading == null) return null;
  const off = ((roomBearing(N.pose, target) - N.heading + 540) % 360) - 180;
  return Math.abs(off) > 25 ? { side: off < 0 ? "left" : "right", interval: 1.0, kind: "tap" } : null;
}
async function pinLandmark(m, hit) {
  if (!NATIVE || !N.pose) return;
  const p = await askNative({ type: "pin", u: 0.5 + hit.dx, v: 0.5 + (hit.dy || 0) });
  if (p && S.mission === m) { m.pin = { x: p.x, z: p.z }; log(`pinned ${m.via} at ${p.d.toFixed(1)} m`); }
}

// Detector boxes jitter frame to frame: smooth the position, and use a dead zone so "centered" can't flip-flop.
function track(m, hit) {
  m.dxs = m.dxs == null ? hit.dx : 0.55 * m.dxs + 0.45 * hit.dx;
  const enter = 0.14, leave = 0.24;
  m.centered = m.centered ? Math.abs(m.dxs) < leave : Math.abs(m.dxs) < enter;
  return m.centered ? "center" : sideOf(m.dxs);
}
function missionStart(room, via, proof) {
  ensureCamera();
  S.find = null; S.route = null; S.back = null;
  S.mission = { room, via: via || "door", proof: proof || ["toilet", "sink"], phase: "plan", phaseAt: Date.now(),
                door: null, doorAt: 0, proofHit: null, proofAt: 0, saidAt: 0, lastSay: "", tries: 0, history: [], planning: false };
  if (slamReady()) { m.slam = true; m.visited = []; m.decisions = []; return slamMap(m, "start"); }
  lookAround("start");
}
// Deduction step: the user turns slowly in place while Pip grabs ~8 views; the vision model describes each
// and the brain picks the most promising direction (doorway, hallway, a door with a sign...).
function giveUp(m) {
  say(`I'm stuck finding the ${m.room}. Can you tell me anything about where it is, or should I learn the way with you?`);
  S.mission = null; render();
}
async function lookAround(why) {
  const m = S.mission; if (!m || m.planning) return;
  m.looks = (m.looks || 0) + 1;
  if (m.looks > 6 || (m.backtracks || 0) >= 3) return giveUp(m);
  m.planning = true; m.phase = "sweep"; m.phaseAt = Date.now(); render();
  await ensureCamera();
  say(m.history.length ? "Let me look around here. Turn slowly to your right, all the way around." :
                         "I'll take a look around first. Turn slowly to your right, all the way around.");
  await new Promise((r) => setTimeout(r, 1800));             // let the instruction land
  const views = [], headings = [];
  if (NATIVE && N.heading != null) {
    // Measured spin: grab a view each time the phone has turned another ~45 degrees (up to 25 s).
    const startH = N.heading; let turned = 0, last = N.heading, nextAt = 0, t0 = Date.now();
    while (S.mission && views.length < 8 && Date.now() - t0 < 25000) {
      turned += ((N.heading - last + 540) % 360) - 180; last = N.heading;
      if (Math.abs(turned) >= nextAt) { const b = await frameBlob(); if (b) { views.push(b); headings.push(N.heading); } nextAt += 45; }
      await new Promise((r) => setTimeout(r, 100));
    }
  } else {
    for (let i = 0; i < 8 && S.mission; i++) {                 // ~11 s slow spin, timed
      const b = await frameBlob(); if (b) views.push(b);
      await new Promise((r) => setTimeout(r, 1400));
    }
  }
  if (!S.mission) return;
  say("Okay, stop there. Let me think.", { urgent: true });
  try {
    const fd = new FormData(); views.forEach((b, i) => fd.append("images", b, `v${i}.jpg`));
    fd.append("goal", m.room); fd.append("history", JSON.stringify(m.history.slice(-8)));
    const r = await (await fetch(SERVER + "/panorama", { method: "POST", body: fd })).json();
    if (!S.mission) return;
    const p = r.plan || {};
    log("deduce:", p.why || "", "->", JSON.stringify(p), `${r.ms}ms`);
    const place = p.place || "unknown";
    if (place !== "unknown" && m.place && place !== m.place) {
      say(place === "hallway" ? `We're out of the ${m.place}, you're in a hallway now.` : `You've left the ${m.place}. This looks like a ${place}.`);
    }
    m.history.push(`${why}: now in ${place}${m.place ? ` (was ${m.place})` : ""}; looked around (${(r.views || []).map((v) => v.facing || "?").join(", ")}); chose ${p.target || p.search} because ${p.why || "?"}`);
    if (place !== "unknown") m.place = place;
    if (p.reached) { m.phase = "verify"; m.phaseAt = Date.now(); say(p.say || `I think this is the ${m.room}. Let me check.`); return; }
    if (p.backtrack) { m.planning = false; return backtrack(m, p.why || "nothing here leads on"); }
    if ((m.tried || []).some((x) => x && p.target && x.toLowerCase() === String(p.target).toLowerCase()) && /came back/.test(why)) {
      m.planning = false; return backtrack(m, "I'm going in circles here");
    }
    m.via = (p.search || "door").toLowerCase(); m.target = p.target || m.via;
    m.door = null; m.doorAt = 0; m.dxs = null; m.centered = false; m.lastDir = null; m.gotTapped = false; m.doorChecks = 0;
    if (headings.length && Number.isInteger(p.view) && headings[p.view] != null) {
      // Measured turn: guide until the phone faces the chosen view's heading, then find the landmark.
      m.turnTo = headings[p.view];
      say(`${(p.say || "").split(/(?<=\.)\s/)[0]} I'll tap the side to turn toward, and say stop.`);
      m.phase = "turn"; m.phaseAt = Date.now(); render(); return;
    }
    say(p.say || `Let's head for the ${m.target}.`);
    m.phase = "scan"; m.phaseAt = Date.now(); render();
  } catch (e) { log("look around failed", e); m.via = "door"; m.phase = "scan"; m.phaseAt = Date.now(); say("Turn slowly, I'm looking for a door."); }
  finally { if (S.mission) S.mission.planning = false; }
}
// While walking toward a landmark: if something is actually in the way, stop and re-decide.
async function obstacleCheck(m) {
  m.obstacleCheckAt = Date.now();
  if (N.depth) {                                       // LiDAR: real distances, no guessing
    const targetClose = m.pin && N.pose && roomDist(N.pose, m.pin) < 1.2;
    if (N.depth.ahead < 0.7 && !targetClose) {
      const side = N.depth.left > N.depth.right ? "left" : "right";
      say(`Stop. Something's ${N.depth.ahead.toFixed(1)} meters ahead. There's more room on your ${side}.`, { urgent: true });
      m.blockedCount = (m.blockedCount || 0) + 1;
      if (m.blockedCount >= 3) { m.blockedCount = 0; lookAround(`blocked on the way to the ${m.target || m.via}`); }
    } else m.blockedCount = 0;
    return;
  }
  try {
    const fd = new FormData(); fd.append("image", lastFrame, "f.jpg");
    const r = await (await fetch(SERVER + "/local", { method: "POST", body: fd })).json();
    if (!S.mission || S.mission.phase !== "approach") return;
    const blocker = r.hazards.find((h) => h.near && h.side === "ahead");
    // the landmark itself filling the view isn't an obstacle; only stop if the target is still small/far
    if ((blocker || r.hint === "stop") && (m.door?.size || 0) < 0.2) {
      say(`Stop. ${blocker ? `There's a ${blocker.label} in the way.` : "Something's in the way."}`, { urgent: true });
      m.blockedCount = (m.blockedCount || 0) + 1;
      if (m.blockedCount >= 2) { m.blockedCount = 0; lookAround(`blocked by ${blocker?.label || "an obstacle"} on the way to the ${m.target || m.via}`); }
    } else m.blockedCount = 0;
  } catch {}
}

// Guide the camera (and the hand behind it) onto the door handle, then say where to reach.
async function handleStep(m, blob) {
  const fd = new FormData(); fd.append("image", blob, "f.jpg"); fd.append("target", "door handle");
  const r = await (await fetch(SERVER + "/locate", { method: "POST", body: fd })).json();
  if (!S.mission || m.phase !== "handle") return;
  const t = Date.now();
  if (!r.found) {
    if (t - m.phaseAt > 15000) { say("I can't spot the handle. Feel along the door edge, about waist height."); m.phase = "door"; m.phaseAt = t; render(); }
    return;
  }
  m.door = { dx: r.dx, size: r.size }; m.doorAt = t;
  const dir = track(m, r);                                   // smoothed left/right with a dead zone
  const vert = r.dy < -0.18 ? "up" : r.dy > 0.18 ? "down" : null;
  const cueDir = dir !== "center" ? dir : vert;
  if (cueDir) {
    m.gotTapped = false;
    if (cueDir !== m.lastDir) { m.lastDir = cueDir; mSay(`${cueDir} ${cueDir}`, 0); } else mSay(`${cueDir} ${cueDir}`, 5000);
    return;
  }
  const h = m.handleInfo?.handle_height;
  const height = h === "low" ? "low, about knee height" : h === "chest" ? "at about chest height" : "at about waist height";
  const how = /pull/.test(m.handleInfo?.opens || "") ? "pull it toward you" : /push/.test(m.handleInfo?.opens || "") ? "push the door" : "open the door";
  say(`The handle is right in front of you. Reach straight forward, ${height}, then ${how}.`);
  m.phase = "door"; m.phaseAt = t; render();                 // now wait until the door is open
}

// Facing a blank wall with nothing to aim at: tell the user, like a friend would.
async function wallCheck(m) {
  m.wallCheckAt = Date.now();
  if (N.depth) {
    if (N.depth.ahead < 1.0 && N.depth.left < 1.2 && N.depth.right < 1.2) mSay(`There's a wall about ${N.depth.ahead.toFixed(1)} meters in front of you. Turn slowly to your right.`, 8000);
    return;
  }
  try {
    const fd = new FormData(); fd.append("image", lastFrame, "f.jpg");
    const r = await (await fetch(SERVER + "/local", { method: "POST", body: fd })).json();
    if (!S.mission || S.mission.phase !== "scan") return;
    if (r.clear.ahead < 0.25 && !r.hazards.length) mSay("There's a wall in front of you. Turn slowly to your right.", 8000);
    else mSay(`Keep turning slowly. I'm looking for the ${m.target || m.via}.`, 8000);
  } catch {}
}

// At a door: the vision model says open/closed, where the handle is, push or pull. Coach until it's open.
async function doorStep(m) {
  if (m.doorBusy) return;
  m.doorBusy = true;
  try {
    const blob = lastFrame || (await frameBlob());
    const fd = new FormData(); fd.append("image", blob, "f.jpg");
    const d = await (await fetch(SERVER + "/door", { method: "POST", body: fd })).json();
    if (!S.mission) return;
    log("door:", JSON.stringify(d));
    if (d.door === "none") { return lookAround("thought I was at a door but don't see one up close"); }
    if (d.door === "open" || d.type === "automatic") {
      say(d.type === "automatic" ? "It's an automatic door. Just walk straight ahead slowly, it'll open." : "It's open. Walk through slowly, about two steps.");
      m.phase = "through"; m.phaseAt = Date.now(); if (m.slam && !m.doorPos && N.pose) m.doorPos = { x: N.pose.x, z: N.pose.z }; render(); return;
    }
    if (d.type === "sliding" && m.phase !== "door") {
      say(`It's a sliding door. ${/left/.test(d.opens) ? "Slide it to the left." : /right/.test(d.opens) ? "Slide it to the right." : "Find the edge and slide it open."}`);
      m.phase = "door"; m.phaseAt = Date.now(); render(); return;
    }
    if (d.type !== "sliding" && m.phase !== "door" && m.phase !== "handle") {   // hinged (or unsure: most doors are) -> find the handle
      m.handleInfo = d; m.phase = "handle"; m.phaseAt = Date.now(); m.dxs = null; m.centered = false; m.lastDir = null; render();
      say(`The door's closed. Let's find the handle${d.handle === "left" || d.handle === "right" ? `, it's on the ${d.handle}` : ""}. Point the camera at it.` +
          (d.type === "unsure" ? " If it slides instead, tell me." : ""));
      return;
    }
    const first = m.phase !== "door";
    m.phase = "door"; m.phaseAt = Date.now(); m.doorChecks = (m.doorChecks || 0) + 1; render();
    if (first) say(d.say || "The door's closed. Find the handle and open it.");
    else if (m.doorChecks % 3 === 0) say(d.say || "The door still looks closed.");   // gentle reminder, not every check
  } catch (e) { log("door check failed", e); }
  finally { if (S.mission) m.doorBusy = false; }
}

// At every landmark (start, door reached, lost, wrong room) Pip looks and re-plans the next sub-goal.
async function missionReplan(why) {
  const m = S.mission; if (!m || m.planning) return;
  m.planning = true; m.phase = "plan"; render();
  try {
    const r = await lookAndPlan(m.room, [...m.history, why]);
    if (!S.mission) return;
    const p = r?.plan || {};
    m.history.push(`${why}: saw ${r?.scene?.summary || "?"}; next ${p.target || p.search}`);
    if (p.reached) { m.phase = "verify"; m.phaseAt = Date.now(); say(p.say || `Checking if this is the ${m.room}.`); return; }
    if (p.action === "open_door" || (p.action === "walk" && /door|doorway/.test(why))) {   // go through, then look again
      say(p.say); m.phase = "through"; m.phaseAt = Date.now(); render(); return;
    }
    m.via = (p.search || "door").toLowerCase(); m.target = p.target || m.via;
    m.door = null; m.doorAt = 0; m.dxs = null; m.centered = false; m.lastDir = null; m.gotTapped = false; m.doorChecks = 0;
    say(p.say || `Let's find a ${m.via}.`);
    mPhase("scan");
  } catch (e) { log("replan failed", e); m.via = "door"; mPhase("scan", "Turn slowly, I'm looking for a door."); }
  finally { if (S.mission) S.mission.planning = false; }
}
function mSay(text, every = 4000) {
  const m = S.mission;
  if (speaking() && every > 0) return;      // never pile up guidance chatter
  if (text !== m.lastSay || Date.now() - m.saidAt > every) { say(text); m.lastSay = text; m.saidAt = Date.now(); }
}
function mPhase(phase, text) {
  const m = S.mission; m.phase = phase; m.phaseAt = Date.now();
  if (phase === "approach") { m.legStart = Date.now(); m.bestSize = 0; m.bestAt = Date.now(); m.legFrom = N.pose ? { x: N.pose.x, z: N.pose.z } : null; }
  if (text) mSay(text, 0); log("mission:", phase); render();
}
function endLeg(m, extraSeconds = 0) {
  if (!m.legStart) return;
  m.legs = m.legs || [];
  m.legs.push({ target: m.target || m.via, seconds: Math.round((Date.now() - m.legStart) / 1000 + extraSeconds), door: /door/.test(m.via),
                from: m.legFrom || null });
  m.legStart = 0;
  log("leg:", JSON.stringify(m.legs.at(-1)));
}
// Dead end: walk the last leg back (turn around, back through the door, N seconds), then look around again
// and try something else. Uses the timed-steps runner (same as replaying taught routes).
function backtrack(m, why) {
  m.backtracks = (m.backtracks || 0) + 1;
  if (m.backtracks > 3) return giveUp(m);
  m.tried = [...(m.tried || []), m.target || m.via];
  const leg = (m.legs || []).pop();
  if (!leg) { say("This is a dead end, and I don't have a way back recorded. Let me look around."); return lookAround(why); }
  m.history.push(`dead end: ${why}. Went back from ${leg.target}; don't try it again.`);
  m.phase = "backtrack"; m.phaseAt = Date.now(); render();
  if (leg.from && N.pose) {                                         // ARKit: walk back to where the leg started
    m.backTo = leg.from;
    const d = roomDist(N.pose, leg.from);
    say(`${why ? why[0].toUpperCase() + why.slice(1) + ". " : ""}Let's go back. Turn around${leg.door ? " and go back through the door" : ""}. About ${Math.max(1, Math.round(d))} meters. I'll tap if you drift.`);
    return;
  }
  const walk = Math.max(2, leg.seconds);
  S.back = { steps: [{ action: "turn_around", seconds: 0 }, { action: "walk", seconds: walk, landmark: leg.door ? "door" : null }, { action: "arrive" }],
             i: 0, started: Date.now(), arriveMsg: "We're back. Let me look around again.", onArrive: () => S.mission && lookAround(`came back from ${leg.target}`) };
  say(`${why ? why[0].toUpperCase() + why.slice(1) + ". " : ""}Let's go back. Turn around${leg.door ? ", go back through the door," : ""} and walk about ${walk} seconds.`);
}
function missionCue() {
  const m = S.mission, t = Date.now();
  if (m.slam && (m.phase === "go" || m.phase === "slamback")) { const nx = slamNext(m); return nx ? walkToCue(nx) : null; }
  if (m.phase === "backtrack") return S.back ? backCue() : (m.backTo ? walkToCue(m.backTo) : null);
  if (m.phase === "turn" && m.turnTo != null && N.heading != null) {
    const off = ((m.turnTo - N.heading + 540) % 360) - 180;
    return Math.abs(off) > 18 ? { side: off < 0 ? "left" : "right", interval: Math.abs(off) > 90 ? 0.5 : 0.9, kind: "tap" } : null;
  }
  if (m.phase === "approach" && m.pin && N.pose) return walkToCue(m.pin);
  const target = m.phase === "arrive" ? m.proofHit : m.door;
  const fresh = target && t - (m.phase === "arrive" ? m.proofAt : m.doorAt) < 1500;
  if (S.hint === "stop" && (m.phase === "approach")) return { side: "both", interval: 0.25, kind: "stop" };
  if (!fresh) return null;
  if (m.phase === "orient" || m.phase === "arrive" || m.phase === "handle") {
    if (!m.centered) return { side: sideOf(m.dxs), interval: 1.1, kind: "tap" };   // gentle, about once a second
    if (!m.gotTapped) { m.gotTapped = true; return { side: "both", interval: 0.2, kind: "got", double: true }; }
    return null;                                                                     // on target: quiet
  }
  if (m.phase === "approach" && !m.centered && Math.abs(m.dxs) > 0.28) return { side: sideOf(m.dxs), interval: 1.4, kind: "tap" };
  return null;
}
async function missionStep(blob) {
  const m = S.mission;
  if (m.planning || m.phase === "plan" || m.phase === "sweep") return;
  if (m.phase === "turn") {
    const off = ((m.turnTo - N.heading + 540) % 360) - 180;
    if (Math.abs(off) <= 18) { m.turnTo = null; say("Stop. It should be right in front of you."); m.phase = "scan"; m.phaseAt = Date.now(); render(); }
    else if (Date.now() - m.phaseAt > 20000) { m.turnTo = null; m.phase = "scan"; m.phaseAt = Date.now(); }
    return;
  }
  if (m.phase === "backtrack") {
    if (m.backTo && N.pose && roomDist(N.pose, m.backTo) < 0.7) { m.backTo = null; say("We're back. Let me look around again."); lookAround("came back to the previous spot"); }
    return;
  }
  if (m.phase === "handle") return handleStep(m, blob);
  const labels = [m.via, ...m.proof].join(",");
  const fd = new FormData(); fd.append("image", blob, "f.jpg"); fd.append("labels", labels);
  const r = await (await fetch(SERVER + "/scan", { method: "POST", body: fd })).json();
  if (!S.mission) return;
  const t = Date.now(), door = r.hits[m.via];
  let proof = m.proof.map((p) => r.hits[p] && { name: p, ...r.hits[p] }).filter((h) => h && h.score >= (m.proof.includes(m.room) ? 0.2 : 0.3)).sort((a, b) => b.score - a.score)[0];
  // Proof must hold for 3 frames in a row before it counts (one-frame false positives are common).
  m.proofStreak = proof && m.lastProofName === proof.name ? (m.proofStreak || 0) + 1 : proof ? 1 : 0;
  m.lastProofName = proof?.name;
  if (m.proofStreak < 3) proof = null;
  if (door && door.score >= 0.15) { m.door = door; m.doorAt = t; }
  $("clear").textContent = `${m.phase} · door ${door ? Math.round(door.score * 100) + "%" : "-"} · ${proof ? proof.name : "no proof"} · ${r.ms} ms`;
  $("clear").className = "v " + (proof ? "ok" : "warn");

  // Proof of the room beats everything: that's the only way to finish. But detectors confuse doors with
  // showers or sinks, so a room needs the vision model to agree we're INSIDE it first.
  const isRoomGoal = !m.proof.includes(m.room);
  const atDecisionPoint = ["verify", "through", "door", "arrive"].includes(m.phase) || (!isRoomGoal && proof?.size > 0.15);
  if (!atDecisionPoint) proof = null;     // don't decide from across the room
  if (proof && isRoomGoal && !m.roomOk) {
    if (t > (m.roomMuteUntil || 0) && !m.roomChecking) {
      m.roomChecking = true;
      const fd = new FormData(); fd.append("image", blob, "f.jpg"); fd.append("room", m.room);
      fetch(SERVER + "/check_room", { method: "POST", body: fd }).then((x) => x.json()).then((c) => {
        if (!S.mission) return; S.mission.roomChecking = false;
        log("inside", m.room, "?", JSON.stringify(c));
        if (c.inside) S.mission.roomOk = true; else S.mission.roomMuteUntil = Date.now() + 12000;
      }).catch(() => { if (S.mission) S.mission.roomChecking = false; });
    }
  }
  if (proof && (!isRoomGoal || m.roomOk) && (m.phase === "verify" || m.phase === "through" || proof.score >= 0.3)) {
    m.proofHit = proof; m.proofAt = t;
    const isRoom = isRoomGoal;   // a room is proven by what's in it; a target by itself
    if (m.phase !== "arrive") mPhase("arrive", isRoom ? `This is the ${m.room}: I can see a ${proof.name}${Math.abs(proof.dx) > 0.12 ? ` to your ${sideOf(proof.dx)}` : " ahead"}.`
                                                      : `I see the ${proof.name}${Math.abs(proof.dx) > 0.12 ? ` to your ${sideOf(proof.dx)}` : " straight ahead"}. Walk toward it slowly.`);
    if (Math.abs(proof.dx) <= 0.12 && proof.size > (isRoom ? 0.08 : 0.25)) {
      say(isRoom ? `You're in the ${m.room}. The ${proof.name} is right in front of you.` : `The ${proof.name} is right in front of you. Reach forward.`);
      S.mission = null; render();
    }
    return;
  }
  const since = t - m.phaseAt, seeDoor = t - m.doorAt < 1500;
  switch (m.phase) {
    case "scan":
      if (seeDoor) return mPhase("orient", `There, I see the ${m.target || m.via}.`);
      if (since > 40000) { m.tries++; return lookAround(`couldn't find the ${m.via} after turning all the way`); }
      if (since > 3000 && t - (m.wallCheckAt || 0) > 4000) wallCheck(m);   // facing a wall? say so and turn
      return;
    case "orient": {
      if (!seeDoor && since > 2500) { m.dxs = null; m.centered = false; return mPhase("scan", `Turn slowly until I find it again.`); }
      if (!seeDoor) return;
      const dir = track(m, m.door);
      if (dir !== "center") { m.gotTapped = false; if (dir !== m.lastDir) { m.lastDir = dir; mSay(`${dir} ${dir}`, 0); } else mSay(`${dir} ${dir}`, 5000); return; }
      m.lastDir = "center";
      if (!m.centerSince) m.centerSince = t;
      if (t - m.centerSince > 800 && !m.confirming) {   // held it a moment: second opinion before walking toward it
        m.centerSince = 0; m.confirming = true;
        const fd = new FormData(); fd.append("image", lastFrame, "f.jpg"); fd.append("what", m.via);
        fetch(SERVER + "/confirm", { method: "POST", body: fd }).then((x) => x.json()).then((c) => {
          if (!S.mission) return; m.confirming = false;
          if (c.is_it === false) { log("not a", m.via, "->", c.actually); m.door = null; m.doorAt = 0; m.dxs = null; m.centered = false;
                                   return mPhase("scan", `That's a ${c.actually || "something else"}, not a ${m.via}. Keep turning slowly.`); }
          pinLandmark(m, m.door);
          const dist = N.depth ? ` About ${Math.max(1, Math.round(N.depth.ahead))} meters.` : "";
          mPhase("approach", `It's straight ahead.${dist} Walk forward slowly.`);
        }).catch(() => { m.confirming = false; mPhase("approach", `It's straight ahead. Walk forward slowly.`); });
      }
      return;
    }
    case "approach":
      if (t - (m.obstacleCheckAt || 0) > 1500) obstacleCheck(m);        // decision point 1: something in the way
      if (m.pin && N.pose) {                                              // ARKit: we know where it is in the room
        const d = roomDist(N.pose, m.pin);
        if (d < 0.9) { endLeg(m, /door/.test(m.via) ? 3 : 0); m.pin = null; return /door/.test(m.via) ? doorStep(m) : lookAround(`reached the ${m.target || m.via}`); }
        if (t - (m.distSaidAt || 0) > 6000 && d > 1.5) { m.distSaidAt = t; mSay(`About ${Math.round(d)} meters to go.`, 6000); }
        return;
      }
      if (!seeDoor && t - m.doorAt > 4000) { m.dxs = null; m.centered = false;    // keep the plan: just find it again
        return mPhase("scan", "Stop for a second. Turn slowly until I find it again."); }
      if (seeDoor && m.door.size > 0.3) {
        endLeg(m, /door/.test(m.via) ? 3 : 0);                              // +3 s for walking through a door
        if (/door/.test(m.via)) return doorStep(m);                            // a door has to be opened first
        return lookAround(`reached the ${m.target || m.via}`);                // other landmarks: look around, deduce
      }
      if (seeDoor) { const dir = track(m, m.door); if (dir !== "center" && Math.abs(m.dxs) > 0.28) mSay(`a bit ${dir}`, 5000); }
      return;
    case "door":       // waiting for the door to be opened: re-check every few seconds
      if (since > 3500 && !m.doorBusy) return doorStep(m);
      return;
    case "through":
      if (since > 7000) return lookAround("walked through a door");
      return;
    case "verify":
      if (since > 14000) {
        m.tries++;
        if (m.tries >= 3) { say(`I couldn't find the ${m.room}. Want to teach me the way once, so I know it next time?`); S.mission = null; return render(); }
        return backtrack(m, `this place is not the ${m.room}`);
      }
      return;
  }
}

// ---------- LOOK AND PLAN: the vision model reads the scene, the brain picks the next landmark ----------
async function lookAndPlan(goal, history = []) {
  await ensureCamera();
  const blob = lastFrame || (await frameBlob());
  if (!blob) { say("The camera isn't on."); return null; }
  const fd = new FormData(); fd.append("image", blob, "f.jpg"); fd.append("goal", goal); fd.append("history", JSON.stringify(history.slice(-6)));
  const r = await (await fetch(SERVER + "/replan", { method: "POST", body: fd })).json();
  log("look:", r.scene?.summary || "", "->", JSON.stringify(r.plan), `${r.ms}ms (see ${r.ms_see}ms)`);
  return r;
}

// ---------- FIND IT: "left left", "up up" to guide a hand to an object ----------
function findStart(target, quiet = false) {
  if (!target) return say("What should I find?");
  ensureCamera();
  S.find = { target, move: null, size: 0, saidAt: 0, lastSay: "", seenAt: 0, gotAt: 0, started: Date.now() };
  if (!quiet) say(`Looking for the ${target}. Move the camera slowly.`);
}
function findStop(msg) { if (S.find) { S.find = null; if (msg) say(msg); } }
function findCue() {
  const f = S.find;
  if (Date.now() - f.started > 90000) { findStop("I couldn't find it. Try again from a different spot."); return null; }
  if (!f.move || Date.now() - f.seenAt > 1500) return null;                     // not seen right now: quiet
  const near = Math.min(1, f.size * 8);                                         // bigger in frame = closer
  if (f.move === "center") return { side: "both", interval: 0.5 - 0.3 * near, kind: "got" };
  const side = f.move === "left" || f.move === "right" ? f.move : "both";
  const kind = f.move === "up" ? "up" : f.move === "down" ? "down" : "tap";
  return { side, interval: 0.45 - 0.25 * near, kind };
}
async function findStep(blob) {
  const fd = new FormData(); fd.append("image", blob, "f.jpg"); fd.append("target", S.find.target);
  const r = await (await fetch(SERVER + "/locate", { method: "POST", body: fd })).json();
  const f = S.find; if (!f) return;
  $("clear").textContent = r.found ? `${r.move} · ${Math.round(r.score * 100)}% · ${r.ms} ms` : `looking · ${r.ms} ms`;
  $("clear").className = "v " + (r.found ? (r.move === "center" ? "ok" : "warn") : "");
  if (!r.found) return;
  f.move = r.move; f.size = r.size; f.seenAt = Date.now();
  // Speak the short cue when it changes, or every 1.5 s while it holds.
  if (r.say && (r.say !== f.lastSay || Date.now() - f.saidAt > 1500)) { say(r.say); f.lastSay = r.say; f.saidAt = Date.now(); }
  if (r.move === "center" && r.size > 0.12) { if (!f.gotAt) f.gotAt = Date.now(); else if (Date.now() - f.gotAt > 1500) findStop(`The ${f.target} is right in front of you. Reach forward.`); }
  else f.gotAt = 0;
}

// ---------- camera -> local planner (obstacles) ----------
let video, canvas, busy = false, lastFrame = null, hazardSaidAt = 0, camOn = null;
// Camera only when asked: find something, describe, or active guidance. Not while just talking.
function ensureCamera() {
  if (!camOn) camOn = (NATIVE ? Promise.resolve() : startCamera()).then(() => localLoop()).catch((e) => { log("camera:", e.message); camOn = null; });
  return camOn;
}
const guiding = () => Boolean(S.route || S.back || S.learning || S.mission);
async function startCamera(deviceId) {
  // Widest view the camera offers: full HD, minimum zoom (many laptop/USB cams default to a cropped 640x480).
  const base = { width: { ideal: 1920 }, height: { ideal: 1080 }, ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" }) };
  const stream = await navigator.mediaDevices.getUserMedia({ video: base, audio: false });
  const track = stream.getVideoTracks()[0], caps = track.getCapabilities?.() || {};
  if (caps.zoom) try { await track.applyConstraints({ advanced: [{ zoom: caps.zoom.min }] }); } catch {}
  const st = track.getSettings(); log(`camera ${st.width}x${st.height}${caps.zoom ? ", zoom " + caps.zoom.min : ""}`);
  video = $("cam"); video.srcObject = stream;
  canvas = canvas || document.createElement("canvas");
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  $("camsel").innerHTML = devs.map((d) => `<option value="${d.deviceId}">${d.label || "camera"}</option>`).join("");
  $("camsel").value = stream.getVideoTracks()[0].getSettings().deviceId;
  $("camsel").onchange = (e) => { stream.getTracks().forEach((t) => t.stop()); startCamera(e.target.value); };
}
async function frameBlob() {
  if (NATIVE) { const b64 = await askNative({ type: "frame" }); return b64 ? b64ToBlob(b64) : null; }
  if (!video?.videoWidth) return null;
  canvas.width = 640; canvas.height = Math.round((640 * video.videoHeight) / video.videoWidth);   // full width, no crop
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.7));
}
async function localLoop() {
  if (!busy && !S.paused && (S.find || guiding())) {
    const blob = await frameBlob();
    if (blob && S.mission) {
      busy = true; lastFrame = blob;
      try {
        if (S.mission.slam && !["handle", "door"].includes(S.mission.phase)) slamStep(S.mission);   // geometry drives it
        else await missionStep(blob);
      } catch (e) { $("clear").textContent = "no model"; log(e); }
      busy = false;
    } else if (blob && S.find) {
      busy = true; lastFrame = blob;
      try { await findStep(blob); } catch (e) { $("clear").textContent = "no model"; }
      busy = false;
    } else if (blob) {
      busy = true; lastFrame = blob;
      const fd = new FormData(); fd.append("image", blob, "f.jpg");
      try {
        const r = await (await fetch(SERVER + "/local", { method: "POST", body: fd })).json();
        S.clear = r.clear; S.hint = guiding() ? r.hint : "clear"; S.hazards = r.hazards;
        if (S.seg) S.seg.landmarks.push(...r.landmarks);
        const near = r.hazards.find((h) => h.near && h.side === "ahead");
        if (near && guiding() && Date.now() - hazardSaidAt > 6000) { hazardSaidAt = Date.now(); say(`Careful, ${near.label} ahead.`, { urgent: true }); }
        $("clear").textContent = `${r.hint.replace("_", " ")} · ${r.ms} ms`;
        $("clear").className = "v " + (r.hint === "clear" ? "ok" : r.hint === "stop" ? "bad" : "warn");
      } catch (e) { $("clear").textContent = "no model"; S.hint = "clear"; }
      busy = false;
    }
  }
  setTimeout(localLoop, 250);   // ~4 frames/s
}

// ---------- talk: hold Space, 16 kHz PCM to the 4090 ----------
let mic, micNode, micStream, chunks = [], talking = false, builtinMic;
// Opening a Bluetooth headset's mic switches it to mono "headset mode" (left = right). So: use the
// laptop's built-in mic, and only while Space is held.
async function pickBuiltinMic() {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "audioinput");
  builtinMic = devs.find((d) => /built-in|macbook|internal/i.test(d.label))?.deviceId;
  log("mic:", devs.find((d) => d.deviceId === builtinMic)?.label || "default (built-in not found)");
}
async function startMic() {
  micStream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true,
                                                                   ...(builtinMic ? { deviceId: { exact: builtinMic } } : {}) } });
  if (!builtinMic) { await pickBuiltinMic(); if (builtinMic) { micStream.getTracks().forEach((t) => t.stop()); return startMic(); } }
  mic = ac.createMediaStreamSource(micStream);
  micNode = ac.createScriptProcessor(4096, 1, 1);
  micNode.onaudioprocess = (e) => { if (talking) chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
  mic.connect(micNode); micNode.connect(ac.destination);
}
// Always-on listening: cut speech out of the mic stream by loudness, send each phrase to Whisper on the
// 4090. Only phrases starting with "Hey Pip" (or right after Pip spoke) reach the brain.
let listenMode = localStorage.getItem("pip.listen") || "always";   // always | wake | push
let alwaysOn = listenMode !== "push", vad = { on: false, quietMs: 0, speechMs: 0, floor: 0.01, buf: [] }, followUntil = 0;
async function startListening() {
  await startMic();
  micNode.onaudioprocess = (e) => {
    const x = e.inputBuffer.getChannelData(0), ms = (x.length / ac.sampleRate) * 1000;
    if (talking) { chunks.push(new Float32Array(x)); return; }          // Space push-to-talk wins
    if (!alwaysOn || speaking()) { vad.on = false; vad.buf = []; return; }  // don't hear Pip itself
    let e2 = 0; for (let i = 0; i < x.length; i++) e2 += x[i] * x[i];
    const rms = Math.sqrt(e2 / x.length), loud = rms > Math.max(0.012, vad.floor * 3);
    if (!vad.on) vad.floor = vad.floor * 0.98 + rms * 0.02;              // track background noise
    if (loud) { vad.speechMs += ms; vad.quietMs = 0; } else vad.quietMs += ms;
    if (!vad.on && vad.speechMs > 120) { vad.on = true; }
    if (vad.on || loud) vad.buf.push(new Float32Array(x));
    if (!vad.on && !loud) { vad.speechMs = 0; vad.buf = vad.buf.slice(-3); }   // keep a little pre-roll
    const total = vad.buf.length * ms;
    if (vad.on && (vad.quietMs > 700 || total > 9000)) {
      const phrase = vad.buf; vad = { ...vad, on: false, quietMs: 0, speechMs: 0, buf: [] };
      const pcm = to16k(phrase, ac.sampleRate);
      if (pcm.length > 8000) askPip({ body: pcm.buffer, wake: listenMode === "always" ? "always" : "1" });
    }
  };
  showListen(); $("listen").className = "v ok";
}
const LISTEN_LABEL = { always: "always listening (just talk)", wake: "listening for “Hey Pip”", push: "hold Space to talk" };
function showListen() { $("listen").textContent = LISTEN_LABEL[listenMode]; }
function stopMic() {
  micStream?.getTracks().forEach((t) => t.stop());
  try { mic?.disconnect(); micNode?.disconnect(); } catch {}
  micStream = mic = micNode = null;
}
function to16k(parts, rate) {
  const all = new Float32Array(parts.reduce((n, p) => n + p.length, 0));
  let o = 0; for (const p of parts) { all.set(p, o); o += p.length; }
  const ratio = rate / 16000, out = new Float32Array(Math.floor(all.length / ratio));
  for (let i = 0; i < out.length; i++) out[i] = all[Math.floor(i * ratio)];
  return out;
}
async function sendTalk() {
  const pcm = to16k(chunks, ac.sampleRate); chunks = [];
  if (pcm.length < 4000) return;
  return askPip({ body: pcm.buffer });
}
function status() {
  return { pos: S.pos, heading: S.heading == null ? null : Math.round(S.heading),
           gps: S.sim ? "simulated" : !gpsOn ? "off (not requested)" : S.gpsOk ? "ok" : "weak",
           gps_accuracy_m: S.acc == null ? null : Math.round(S.acc), navigating_to: S.route?.name || null,
           next_turn: S.route?.steps[S.stepIdx]?.turn || null, saved_spots: S.spots.map((s) => s.label),
           taught_routes: Object.keys(routesStore()), hazards: S.hazards.map((h) => `${h.label} ${h.side}`),
           learning: S.learning?.name || null };
}
async function askPip({ body, text, wake = false }) {
  const url = `${SERVER}/talk?session=${SESSION}&ctx=${encodeURIComponent(JSON.stringify(status()))}` + (text ? `&text=${encodeURIComponent(text)}` : "") +
              (wake ? `&wake=${wake}&followup=${Date.now() < followUntil ? 1 : 0}` : "");
  try {
    const r = await (await fetch(url, { method: "POST", body: body || "" })).json();
    if (r.ignored) { log("(not for Pip)", r.heard); if (r.heard && listenMode === "wake") $("listen").textContent = `heard “${r.heard.slice(0, 40)}” (say “Hey Pip” first)`; return; }
    $("listen").textContent = `heard “${(r.heard || "").slice(0, 40)}”`;
    if (r.awake) tap("both", "got");
    followUntil = Date.now() + 8000;   // a quick "yes" after Pip speaks doesn't need "Hey Pip"
    log("HEARD", r.heard, "->", (r.tools || []).map((t) => t.tool).join(",") || "-", r.action?.type || "", `${r.ms}ms (stt ${r.ms_stt}ms)`);
    act(r);
  } catch (e) { say("I can't reach my planner right now."); log(e); }
}
// The brain (Qwen3-14B) answers with words + at most one action for the app.
async function act(r) {
  if (r.say) say(r.say);
  const a = r.action;
  if (!a) return;
  switch (a.type) {
    case "navigate": return startRoute(a.route);
    case "find": return findStart(a.target, true);
    case "mission": return missionStart(a.room, a.via, a.proof);
    case "describe": return describe("What's around me?", false);
    case "gps_on": ensureGPS(); return;
    case "look": { const r = await lookAndPlan(a.goal || "where I want to go"); if (r) say(r.plan.say); return; }
    case "where": return whereAmI();
    case "back": return goBack(a.label);
    case "replay": return replay(a.name);
    case "learn_start": return learnStart(a.name, a.start);
    case "learn_end": return learnEnd();
    case "repeat": return say(S.lastSpoken);
    case "pause": S.paused = true; return;
    case "resume": S.paused = false; return;
    case "stop": S.find = null; S.route = null; S.back = null; S.mission = null; render(); return;
  }
}
async function describe(question = "What's around me?", interrupt = true) {
  await ensureCamera(); await new Promise((r) => setTimeout(r, 600));   // first frame
  const blob = lastFrame || (await frameBlob());
  if (!blob) return say("The camera isn't on.");
  const fd = new FormData(); fd.append("image", blob, "f.jpg"); fd.append("question", question);
  try { say((await (await fetch(SERVER + "/describe", { method: "POST", body: fd })).json()).say); }
  catch { say("I can't reach the vision model right now."); }
}
async function whereAmI() {
  ensureGPS();
  if (!S.pos) return say("I don't have a GPS fix yet.");
  try {
    const r = await (await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&zoom=18&lat=${S.pos.lat}&lon=${S.pos.lon}`)).json();
    const a = r.address || {}, where = [a.road, a.neighbourhood || a.suburb || a.city].filter(Boolean).join(", ");
    const next = S.route?.steps[S.stepIdx];
    say(`You're near ${where || "an unnamed spot"}${S.gpsOk ? "" : ", but GPS is weak"}.` +
        (next ? ` Next: ${next.turn === "arrive" ? "arrive" : next.turn} in ${Math.round(dist(S.pos, next) / 10) * 10} meters.` : ""));
  } catch { say("I can't look up the street name right now."); }
}
function saveSpot(label) {
  endSegment(null);
  S.spots.push({ label, pos: S.pos, trailIdx: S.trail.length, t: Date.now() });
  say(`Saved ${label}. Say "go back to ${label}" any time.`);
}

// ---------- server / render / keys ----------
async function post(path, body) {
  const r = await fetch(SERVER + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  return r.json();
}
function render() {
  $("gps").textContent = S.sim ? "simulated" : S.pos ? `${S.gpsOk ? "ok" : "weak"} ±${Math.round(S.acc)} m` : "waiting";
  $("gps").className = "v " + (S.sim || S.gpsOk ? "ok" : "warn");
  $("heading").textContent = S.heading == null ? "walk a few steps" : `${Math.round(S.heading)}°`;
  const st = S.route?.steps[S.stepIdx];
  $("next").textContent = S.mission ? `${S.mission.room}: ${S.mission.phase}${S.mission.slam && S.mission.target && N.pose ? ` · ${roomDist(N.pose, S.mission.target).toFixed(1)} m` : S.mission.pin && N.pose ? ` · ${roomDist(N.pose, S.mission.pin).toFixed(1)} m` : ""}` : S.back ? `going back (${S.back.i + 1}/${S.back.steps.length})` :
    st && S.pos ? `${st.turn} in ${Math.round(dist(S.pos, st))} m` : "no route";
}
async function checkServer() {
  try { const h = await (await fetch(SERVER + "/health")).json(); $("server").textContent = `${h.device.startsWith("cuda") ? "GPU" : "CPU"} · ${h.loaded.length}/5 loaded`; $("server").className = "v ok"; }
  catch { $("server").textContent = "unreachable"; $("server").className = "v bad"; }
}
let started = false;
async function start() {
  if (started) return; started = true;
  if (!NATIVE) ac = new AudioContext();         // in the app, all sound is native
  $("start").remove();
  say(listenMode === "always" ? "Hi, I'm Pip. I'm listening, just talk to me." : listenMode === "wake" ? "Hi, I'm Pip. Say Hey Pip when you need me." : "Hi, I'm Pip. Hold space to talk.");
  checkServer(); setInterval(checkServer, 15000);
  fetch(SERVER + "/warmup", { method: "POST" }).then(() => checkServer()).catch(() => {});
  startSegment();   // GPS and camera stay off until the conversation needs them
  if (qs.get("lat") && qs.get("lon")) {   // desk demo: start here and walk with W/A/F
    S.sim = true; onFix({ lat: +qs.get("lat"), lon: +qs.get("lon") }, 5, false);
    say("Simulated start position set. Use W to walk, A and F to turn.");
  }
  if (NATIVE) { toNative({ type: "ready" }); showListen(); $("listen").className = "v ok"; }   // the phone's mic, natively
  else try { await startListening(); } catch (e) { log("mic:", e.message); $("listen").textContent = "mic off"; }
  audioLoop();
}
$("start").onclick = start;
$("ask").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.value.trim()) { say("…", {}); askPip({ text: e.target.value.trim() }); e.target.value = ""; } });
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter") return start();
  if (!started || e.repeat || e.target.tagName === "INPUT") return;
  const k = e.key.toLowerCase();
  if (e.code === "Space") { e.preventDefault(); chunks = []; $("say").textContent = "Listening…";
                            (micStream ? Promise.resolve() : startListening()).then(() => { talking = true; tap("both"); }).catch((x) => log("mic:", x.message)); }
  else if (k === "d") describe();
  else if (k === "l") { const t = prompt("What should Pip find? (e.g. door knob)"); if (t) findStart(t); }
  else if (e.key === "Escape") { if (S.mission) { S.mission = null; say("Stopped."); render(); } else findStop("Stopped looking."); }
  else if (k === "n" && (S.mission?.phase === "through" || S.mission?.phase === "door")) lookAround("walked through a door");
  else if (k === "h") {
    listenMode = { always: "wake", wake: "push", push: "always" }[listenMode]; alwaysOn = listenMode !== "push";
    localStorage.setItem("pip.listen", listenMode); showListen();
    say({ always: "I'm always listening. Just talk to me.", wake: "Say Hey Pip when you need me.", push: "Okay, hold space to talk." }[listenMode]);
  }
  else if (k === "b") goBack();
  else if (k === "s") saveSpot(`spot ${S.spots.length + 1}`);
  else if (k === "r") say(S.lastSpoken);
  else if (k === "p") { S.paused = !S.paused; say(S.paused ? "Paused." : "Resuming."); }
  else if (k === "t") { say("Left.", {}); setTimeout(() => [0, 300, 600].forEach((d) => setTimeout(() => tap("left"), d)), 500);
                        setTimeout(() => { say("Right."); setTimeout(() => [0, 300, 600].forEach((d) => setTimeout(() => tap("right"), d)), 500); }, 2200); }
  else if (e.key === "ArrowLeft") { endSegment("left"); if (S.heading != null) S.heading = (S.heading + 270) % 360; }
  else if (e.key === "ArrowRight") { endSegment("right"); if (S.heading != null) S.heading = (S.heading + 90) % 360; }
  else if (k === "w" || k === "a" || k === "f") {               // desk demo: simulated walking
    if (!S.pos) return;
    S.sim = true; if (S.heading == null) S.heading = 0;
    if (k === "a") S.heading = (S.heading + 345) % 360;
    if (k === "f") S.heading = (S.heading + 15) % 360;
    if (k === "w") { const h = S.heading; S.pos = move(S.pos, h, 3); S.heading = h; S.gpsOk = true; S.acc = 5;
                     if (S.gpsOk) { const last = S.crumbs.at(-1); if (!last || dist(last, S.pos) > 8) S.crumbs.push({ ...S.pos, t: Date.now() }); } }
    render(); followRoute();
  }
});
document.addEventListener("keyup", (e) => {
  if (e.code !== "Space") return;
  const was = talking; talking = false;
  if (was) { tap("both"); $("say").textContent = "Thinking…"; sendTalk(); }
});
