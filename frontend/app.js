// ycgsf browser app: GPS + camera + mic on the laptop, models on the 4090 (server/app.py).
// Audio rule: taps come from the side you should turn toward. Slow when the turn is far, fast when
// close ("  .  . . . .."), silent when you're on course and the way is clear.
"use strict";

const NOEL = document.createElement("div");   // ids from the old screen (debug readouts) write here and go nowhere
const $ = (id) => document.getElementById(id) || NOEL;
const qs = new URLSearchParams(location.search);
const SERVER = (qs.get("server") || localStorage.getItem("ycgsf.server") || "http://100.71.218.127:8100").replace(/\/$/, "");
$("srv").value = SERVER.replace(/^https?:\/\//, "");   // Setup > SERVER shows host:port
$("srv").onchange = (e) => { const v = e.target.value.trim(); localStorage.setItem("ycgsf.server", /^https?:\/\//.test(v) ? v : "http://" + v); location.reload(); };
const SESSION = Math.random().toString(36).slice(2);
// Running inside the iPhone app: sensors come from the phone (0.5x / ARKit camera, LiDAR, gyro, steps, GPS, mic).
const NATIVE = Boolean(window.PIP_NATIVE && window.webkit?.messageHandlers?.pip);
const toNative = (m) => NATIVE && window.webkit.messageHandlers.pip.postMessage(m);
const nativeWaits = new Map(), nativeSpeech = new Map(); let nativeId = 0;
const askNative = (msg, ms = 1500) => new Promise((res) => { const id = ++nativeId; nativeWaits.set(id, res); toNative({ ...msg, id });
                                                  setTimeout(() => { if (nativeWaits.delete(id)) res(null); }, ms); });
const N = { heading: null, compass: null, frame: null, mapping: "none", pose: null, depth: null, distance: 0, camera: "", doors: [], frontiers: [], mapped: 0 };   // phone sensors
window.pipNative = {
  update(snap) {
    N.updatedAt = Date.now();
    N.mic = snap.mic || 0;
    N.heading = snap.heading; N.pose = snap.pose || null; N.depth = snap.depth || null; N.distance = snap.distance_m || 0; N.camera = snap.camera;
    if (snap.doors) { N.doors = snap.doors; N.frontiers = snap.frontiers || []; N.mapped = snap.mapped_m2 || 0; }
    N.compass = snap.compass ?? null; N.frame = snap.frame || null; N.mapping = snap.mapping || "none";
    S.heading = snap.compass ?? snap.heading;   // GPS directions need north; ARKit's heading is only "since the app started"
    if (snap.gps) onFix({ lat: snap.gps.lat, lon: snap.gps.lon }, snap.gps.acc);
    learnTick(); hazardCheck();
    if (N.depth && $("clear") && !S.mission && !S.find) $("clear").textContent = `ahead ${N.depth.ahead.toFixed(1)} m`;
  },
  frame(id, b64) { const r = nativeWaits.get(id); nativeWaits.delete(id); r?.(b64 || null); },
  pinned(id, p) { const r = nativeWaits.get(id); nativeWaits.delete(id); r?.(p); },
  spoke(id) { spokeAt = Date.now(); const r = nativeSpeech.get(id); nativeSpeech.delete(id); r?.(); },
  phrase(b64) {   // what you said while holding the talk bar (the phone records it)
    if (!started) return;
    if (speaking() || askBusy) return log("(said while Pip was talking or thinking: dropped)");
    const bin = atob(b64), buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    askPip({ body: buf.buffer });
  },
};
const b64ToBlob = (b64) => { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return new Blob([u], { type: "image/jpeg" }); };
// Geometry on the room floor (ARKit meters): bearing from the user to a pinned point, clockwise degrees.
const roomBearing = (from, to) => (Math.atan2(to.x - from.x, -(to.z - from.z)) * 180 / Math.PI + 360) % 360;
const roomDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const routesStore = () => { try { return JSON.parse(localStorage.getItem("pip.routes") || "{}"); } catch { return {}; } };
const logLines = [];   // everything since the app opened, for the Copy log button
const log = (...a) => { const line = `${new Date().toLocaleTimeString("en-GB")} ${a.join(" ")}`;   // 14:02:07 (24-hour, one word)
  logLines.push(line); if (logLines.length > 5000) logLines.splice(0, 1000);   // the Log screen (ui.js) shows the newest
  toNative({ type: "log", line });   // the phone app saves every line to a file (Documents/pip-log.txt)
};

// ---------- geo helpers ----------
$("copylog").onclick = async () => {
  const text = logLines.join("\n") || "(log is empty)";
  if (NATIVE) toNative({ type: "copy", text });   // the phone app puts it on the clipboard
  else try { await navigator.clipboard.writeText(text); } catch { return; }
  log("log copied,", logLines.length, "lines"); window.pipUI?.done("copylog");   // the key flashes Done (Button States)
};

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
  learning: null, // {name, start, trailIdx, crumbs, frame}: recording a route to teach Pip (indoors, outdoors, or both)
  walk: null, walkTok: null,   // following a taught route point by point: {name, pts, i, same, saidAt, lostAt}
  fix: null,      // the latest GPS reading {lat, lon, acc, t}
  mission: null,  // go_to_room: {room, via, proof, phase: scan|orient|approach|through|verify|arrive, ...}
  // shown on screen (ui.js): turning around to get bearings, a route preview, arrived, just saved, server state
  orient: null, preview: null, arrived: null, saved: null, hazardAt: 0, server: null, serverDown: 0, findNext: 0, heard: "",
};

// ---------- 1. AUDIO: tip-tap with swapped channels ----------
let ac;
const invert = () => (localStorage.getItem("pip.invert") ?? "1") === "1";   // Setup > HEADPHONES FLIPPED
let deafened = false;   // the Deafen button: Pip's voice goes quiet; taps and urgent warnings still play
function tap(side, kind = "tap", freq) {
  if (NATIVE) return toNative({ type: "tap", side, kind, inverted: invert(), ...(freq ? { freq } : {}) });   // native audio keeps the mic alive
  if (!ac) return;
  const t = ac.currentTime, osc = ac.createOscillator(), g = ac.createGain(), out = ac.createChannelMerger(2);
  // Hard-route to ONE channel (not panning). Headphones upside down: the "R" cup sits on the left ear.
  const ear = side === "both" ? null : (side === "left") !== invert() ? 0 : 1;   // 0 = left channel, 1 = right
  const [f, dur, vol] = kind === "note" ? [freq || 880, 0.09, 0.4] : kind === "think" ? [600, 0.03, 0.18] : kind === "warn" ? [520, 0.06, 0.55] : kind === "stop" ? [200, 0.09, 0.7]
    : kind === "up" ? [2600, 0.03, 0.45] : kind === "down" ? [700, 0.04, 0.55] : kind === "got" ? [1320, 0.12, 0.5] : kind === "on" ? [880, 0.02, 0.35] : kind === "key" ? [1500, 0.012, 0.2] : [1800, 0.022, 0.45];
  osc.type = kind === "tap" ? "sine" : "triangle";
  osc.frequency.value = f;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g);
  if (ear === null) { g.connect(out, 0, 0); g.connect(out, 0, 1); } else g.connect(out, 0, ear);
  out.connect(ac.destination);
  osc.start(t); osc.stop(t + dur + 0.02);
}
// Progress you can hear while you turn all the way around (getting bearings, mapping a room, looking around): one note
// per new direction, climbing a major scale, then a two-note chime when Pip has seen enough. Rising notes told blind
// users how much of a turn was left ("musical scale" sonification, Ahmetovic et al. 2019 and 2023, IJHCS).
const SCALE = [523.25, 587.33, 659.26, 698.46, 783.99, 880, 987.77, 1046.5, 1174.66, 1318.51, 1396.91, 1567.98];   // C5 to G6
const note = (i) => tap("both", "note", SCALE[Math.max(0, Math.min(SCALE.length - 1, i))]);
// You've turned far enough: the "got it" tone plus a buzz you can feel (a success buzz, unlike a key's light tap), so a
// turn is confirmed even when traffic drowns out the tone.
const turnDone = () => { tap("both", "got"); toNative({ type: "haptic", style: "success" }); };
const doneChime = () => { tap("both", "note", 1046.5); setTimeout(() => tap("both", "note", 1567.98), 130); };
// While Pip is working on an answer you asked for (LOOK, a look around, picking the next way): a soft slow tick,
// so silence never means "did it hear me?". The screen shows the same thing (Button States: Working).
const THINK = { side: "both", interval: 0.8, kind: "think" };
const thinking = () => Boolean((S.looking && !S.walk) || S.orient?.recognizing || S.trip?.thinking || (S.mission && (S.mission.phase === "decide" || S.mission.thinking)));
// What the taps should be doing right now: {side, interval (s), kind} or null for silence.
function cue() {
  if (S.paused) return null;
  if (thinking()) return THINK;
  if (S.mission) return missionCue();
  if (S.walk) return S.walk.path ? gpsCue() : walkCue();
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
  const c = cue(), now = performance.now() / 1000, was = S.lastCue;
  if (c && (!was || c.kind !== was.kind || c.side !== was.side)) nextTap = 0;   // a new sound starts now, not after the old interval
  S.lastCue = c;
  if (c && now >= nextTap) {
    if (c.double) { tap(c.side, c.kind); setTimeout(() => tap(c.side, c.kind), 110); } else tap(c.side, c.kind);
    nextTap = now + c.interval;
  }
  if (!c) nextTap = 0;
  requestAnimationFrame(audioLoop);
}
// Ambient sound (Setup > AMBIENT SOUND): a quiet low hum that moves slowly, so you can hear that Pip is open and how it
// is. It stays under ~600 Hz and plays the same in both ears, so it doesn't cover the taps (880-2600 Hz) or sound like a
// direction. It dips while anyone talks, goes silent while Pip guides with taps or is deafened, and turns darker and a
// semitone lower when Pip can't reach its server. Laptop only for now: in the iPhone app all sound is native.
const ambientOn = () => (localStorage.getItem("pip.ambient") ?? "1") === "1";
const AMBIENT = [[110, "sine", 1], [110.6, "triangle", 0.5], [164.81, "sine", 0.6], [440, "sine", 0.08]];   // A2 twice, 0.6 Hz apart so it slowly beats; E3; a faint A4
let amb = null;
function ambientLoop() {
  if (!amb) {
    const out = ac.createGain(), lp = ac.createBiquadFilter(), lfo = ac.createOscillator(), sway = ac.createGain();
    out.gain.value = 0; lp.type = "lowpass"; lp.frequency.value = 500;
    lfo.frequency.value = 0.07; sway.gain.value = 150; lfo.connect(sway).connect(lp.frequency); lfo.start();   // opens and closes every ~14 s
    const oscs = AMBIENT.map(([f, type, v]) => { const o = ac.createOscillator(), g = ac.createGain(); o.type = type; o.frequency.value = f; g.gain.value = v; o.connect(g).connect(lp); o.start(); return o; });
    lp.connect(out).connect(ac.destination);
    amb = { out, lp, oscs };
  }
  const t = ac.currentTime, down = serverDown(), silent = !ambientOn() || deafened || guiding() || Boolean(S.find || S.orient);
  amb.out.gain.setTargetAtTime(silent ? 0 : talking || speaking() || thinking() ? 0.012 : 0.04, t, 0.4);   // fades over ~1 s
  amb.lp.frequency.setTargetAtTime(down ? 260 : talking ? 900 : 500, t, 0.5);
  amb.oscs.forEach((o, i) => o.frequency.setTargetAtTime(AMBIENT[i][0] * (down ? 0.944 : 1), t, 0.8));
}
// Pip's voice: Kokoro-82M on the 4090 (natural), browser voice if the server is slow or down.
// One voice at a time. While Pip is talking, only the NEWEST waiting line is kept (stale ones are dropped);
// only urgent lines (obstacle, stop) cut in.
let voiceSrc = null, voiceChain = Promise.resolve(), speakingUntil = 0, voiceBusy = false, pendingLine = null, voiceGen = 0;
const speaking = () => voiceBusy || performance.now() < speakingUntil || speechSynthesis.speaking;
function hush() {   // stop what Pip is saying right now and drop the waiting line
  voiceGen++; try { voiceSrc?.stop(); } catch {} speechSynthesis.cancel(); toNative({ type: "stopSay" });
  pendingLine = null; voiceBusy = false;
}
function say(text, { urgent = false } = {}) {
  if (!text) return;
  S.lastSpoken = text; S.spokeAt = Date.now();   // the Listening screen (ui.js) shows it
  if (deafened && !urgent) return log("SAY (deafened)", text);   // on screen only; urgent warnings still speak
  log("SAY", text);
  if (urgent) hush();
  if (voiceBusy) { pendingLine = text; return; }
  playLine(text);
}
$("deafen").onclick = () => {
  if (deafened) { deafened = false; say("Voice on."); }
  else { say("Voice off.", { urgent: true }); deafened = true; }   // the last line Pip says out loud
  $("deafen").classList.toggle("on", deafened); $("deafen").setAttribute("aria-pressed", deafened);   // ui.js sets the label (Deafen / Undeafen)
  log(deafened ? "deafened" : "undeafened");
};
async function playLine(text) {
  voiceBusy = true; const gen = voiceGen;
  try { await speakNow(text, gen); } catch (e) { log("speech failed", e); }
  if (gen !== voiceGen) return;            // an urgent line took over
  voiceBusy = false;
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
  S.acc = acc; S.fixAt = now; S.fix = { lat: p.lat, lon: p.lon, acc, t: now };
  if (S.askAfterFix && acc <= 100) { const q = S.askAfterFix; S.askAfterFix = null; if (now < q.until) { log("GPS ready, asking again:", q.text); askPip({ text: q.text }); } }
  if (!NATIVE) learnTick();   // the phone calls it from its sensor updates
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
async function planTo(body) {
  ensureGPS();
  if (!S.pos) return say("I don't know where you are yet. Waiting for GPS.");
  say("Planning the route.");
  try {
    const r = await post("/plan", { origin: S.pos, ...body });
    if (!r.ok) return say(r.say);
    S.dest = body;
    log("route", r.name, r.total_m + "m", r.steps.length, "steps", r.ms + "ms", r.google_maps);
    return gpsWalk(r.name, r.to, r.steps, !body.to);   // its own sentence: the server's AI said "380 meters" for a 3.8 km route
  } catch (e) { say("I can't reach the planner right now."); log(e); }
}

// ---------- backtrack: GPS -> plan back; no GPS -> reverse the remembered trail ----------
async function goBack(label) {
  if (S.mission) {   // during a search: a door that won't open, or a wrong way -> back and try another
    const m = S.mission;
    if (m.phase === "door" || m.phase === "handle") return doorBlocked(m, "was locked or stuck");
    return m.slam ? slamBacktrack(m, "you said this way is wrong") : backtrack(m, "the user said this way is wrong");
  }
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

// ---------- trip recorder: what Pip is doing, every 0.5 s (the phone saves it with sensors, photos and the floor map) ----------
function traceState() {
  const m = S.mission, w = S.walk, L = S.learning;
  return JSON.parse(JSON.stringify({   // JSON round trip: only plain data goes to the phone
    mode: m ? "mission" : w ? "walk" : S.back ? "timed" : L ? "learning" : S.find ? "find" : S.route ? "gps_route" : "idle",
    mission: m && { room: m.room, phase: m.phase, via: m.via, slam: m.slam, target: m.target, signs: m.signs?.map((x) => x.text), item: m.item, pin: m.pin, path: m.path?.slice?.(0, 40), door: m.door, tries: m.tries },
    walk: w && (w.path ? { name: w.name, gps: true, s: w.s, e: w.e, total: w.total, next_turn: w.man[w.m], phase: w.phase, on: w.onCourse }
      : { name: w.name, i: w.i, n: w.pts.length, target: w.pts[w.i], same: w.same, here: locate(w.pts[w.i]), phase: w.phase, on: w.onCourse }),
    timed: S.back && { i: S.back.i, step: S.back.steps[S.back.i] },
    learning: L && { name: L.name, crumbs: L.crumbs?.length, last: L.lastAR || L.lastGPS },
    find: S.find && { target: S.find.target, move: S.find.move, dx: S.find.dx, dy: S.find.dy, size: S.find.size, score: S.find.score }, cue: S.lastCue, hint: S.hint, hazards: S.hazards, deafened, paused: S.paused,
  }));
}
if (NATIVE) setInterval(() => { try { toNative({ type: "trace", s: traceState() }); } catch (e) { log("trace error", e.message); } }, 500);

// ---------- teach a route: walk it once, Pip replays it later ----------
// Each point remembers where you were in the room (ARKit, meters, works without GPS) and/or on the map (GPS).
// Replay picks what works at each point: the room (after Pip recognizes it from the saved scan), GPS outside,
// or, if neither works, the old timed steps. Points are kept only at turns, like the Clew app for blind users.
const compassNow = () => (NATIVE ? N.compass : S.heading);   // clockwise from north
const gpsGood = (maxAcc = 25) => Boolean(S.fix && Date.now() - S.fix.t < 5000 && S.fix.acc <= maxAcc);
const arReady = () => slamReady() && N.frame && N.frame !== "relocalizing";
const toLocal = (o, p) => ({ x: (p.lon - o.lon) * 111320 * Math.cos(rad(o.lat)), z: -(p.lat - o.lat) * 110540 });   // GPS -> meters
const circMean = (degs) => degs.length ? (deg(Math.atan2(degs.reduce((a, d) => a + Math.sin(rad(d)), 0), degs.reduce((a, d) => a + Math.cos(rad(d)), 0))) + 360) % 360 : null;
const legDist = (a, b) => a.ar && b.ar ? roomDist(a.ar, b.ar) : a.gps && b.gps ? dist(a.gps, b.gps) : 0;
const legBearing = (a, b) => a.ar && b.ar ? roomBearing(a.ar, b.ar) : a.gps && b.gps ? bearing(a.gps, b.gps) : null;
function meters(m) {
  const v = m < 3 ? Math.max(0.5, Math.round(m * 2) / 2) : m < 20 ? Math.round(m) : Math.round(m / 5) * 5;
  const steps = Math.max(1, Math.round(m / 0.7));
  return `${v} meter${v === 1 ? "" : "s"}${m < 10 ? ` (${steps} step${steps === 1 ? "" : "s"})` : ""}`;
}

function learnTick(force = false) {   // called with every sensor update: drop a breadcrumb every 25 cm (room) or 3 m (GPS only)
  const L = S.learning;
  if (!L?.crumbs) return;
  const c = { t: Date.now() };
  if (arReady() && (!L.frame || L.frame === N.frame)) {
    L.frame = N.frame; c.ar = { x: +N.pose.x.toFixed(2), z: +N.pose.z.toFixed(2) };
    if (N.compass != null) c.off = (N.compass - N.heading + 360) % 360;
  }
  if (gpsGood(20)) c.gps = { lat: S.fix.lat, lon: S.fix.lon };
  if (!c.ar && !c.gps) return;
  const far = c.ar ? !L.lastAR || roomDist(L.lastAR, c.ar) >= 0.25 : !L.lastGPS || dist(L.lastGPS, c.gps) >= 3;
  if (!far && !force) return;
  L.crumbs.push(c);
  if (c.ar) L.lastAR = c.ar;
  if (c.gps) L.lastGPS = c.gps;
}
function segDist(p, a, b) {   // distance from p to the line a-b, meters
  const dx = b.x - a.x, dz = b.z - a.z, L2 = dx * dx + dz * dz;
  const t = L2 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / L2)) : 0;
  return Math.hypot(p.x - a.x - t * dx, p.z - a.z - t * dz);
}
function simplify(pts, eps) {   // Douglas-Peucker: indexes of the points to keep (the corners)
  if (pts.length < 3) return pts.map((_, i) => i);
  const keep = new Set([0, pts.length - 1]), stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop(); let best = -1, bd = eps;
    for (let i = a + 1; i < b; i++) { const d = segDist(pts[i], pts[a], pts[b]); if (d > bd) { bd = d; best = i; } }
    if (best > 0) { keep.add(best); stack.push([a, best], [best, b]); }
  }
  return [...keep].sort((x, y) => x - y);
}
function keypoints(crumbs) {   // stretches with room tracking (30 cm tolerance) and GPS-only stretches (3 m tolerance)
  const out = [];
  for (let i = 0; i < crumbs.length;) {
    const ar = Boolean(crumbs[i].ar); let j = i;
    while (j + 1 < crumbs.length && Boolean(crumbs[j + 1].ar) === ar) j++;
    const run = crumbs.slice(i, j + 1), o = run[0].gps;
    for (const k of simplify(run.map((c) => (ar ? c.ar : toLocal(o, c.gps))), ar ? 0.3 : 3)) out.push(run[k]);
    i = j + 1;
  }
  return out.map(({ ar, gps }) => ({ ...(ar && { ar }), ...(gps && { gps }) }));
}

// First turn all the way around, so the phone sees the whole room and gets its bearings (needed before teaching
// or following a route). Done when the camera has pointed in 11 of 12 directions, or after 30 s.
async function orient(live, words, name) {
  if (!NATIVE) return live();
  say(words);
  const seen = new Set(), end = Date.now() + 30000, o = S.orient = { seen: 0, dirs: [], name };   // S.orient: shown on screen
  try {
    while (Date.now() < end && seen.size < 11) {
      if (!live()) return false;
      const had = seen.size;
      if (N.heading != null) seen.add(Math.floor(N.heading / 30));
      if (seen.size > had) note(seen.size - 1);   // a new direction: the next note up
      o.seen = seen.size; o.dirs = [...seen];
      await new Promise((res) => setTimeout(res, 200));
    }
  } finally { if (S.orient === o) S.orient = null; }
  if (!live()) return false;
  log("orient", seen.size, "of 12 directions");
  doneChime(); say("Okay, stop.");
  await new Promise((res) => setTimeout(res, 1200));
  return live();
}
async function learnStart(name, start) {
  ensureCamera(); ensureGPS();
  S.walk = null; S.walkTok = null;
  const L = S.learning = { name, start: start || "here", trailIdx: S.trail.length, crumbs: null, orienting: true };
  if (!await orient(() => S.learning === L, `I'll learn the way to ${name}. First, stand still. Turn slowly all the way around, so I can get my bearings.`, name)) return;
  L.orienting = false; endSegment(null); L.trailIdx = S.trail.length; L.crumbs = [];
  learnTick();
  say(NATIVE ? `Now you lead. Hold the phone up in front of you with the camera facing forward, and walk to ${name}. I'll remember the way. Say "we're here" when you arrive.`
             : `Recording the way to ${name}. Walk there, and use the arrow keys when you turn. Say "we're here" when you arrive.`);
}
async function learnEnd() {
  const L = S.learning;
  if (!L) return say("I wasn't recording a route.");
  if (L.orienting) return say("I haven't started recording yet. Finish turning around first.");
  endSegment(null); learnTick(true);   // always keep the exact arrival spot
  S.learning = null;
  const segs = S.trail.slice(L.trailIdx), pts = keypoints(L.crumbs);
  let m = 0, turns = 0;
  for (let i = 1; i < pts.length; i++) m += legDist(pts[i - 1], pts[i]);
  for (let i = 2; i < pts.length; i++) {
    const b1 = legBearing(pts[i - 2], pts[i - 1]), b2 = legBearing(pts[i - 1], pts[i]);
    if (b1 != null && b2 != null && Math.abs(angleDiff(b1, b2)) > 35) turns++;
  }
  const hasAR = pts.some((p) => p.ar), hasGPS = pts.some((p) => p.gps);
  const kind = m < 0.5 ? "timed" : hasAR && hasGPS ? "hybrid" : hasAR ? "room" : "gps";
  if (kind === "timed" && (NATIVE || !segs.some((sg) => sg.seconds > 2)))
    return say(`I didn't notice you walking, so I didn't save the way to ${L.name}. Hold the phone up with the camera facing forward, and teach me again.`);
  const offs = L.crumbs.filter((c) => c.off != null).slice(0, 8).map((c) => c.off);
  const all = routesStore();
  all[L.name] = { start: L.start, kind, frame: hasAR ? L.frame : null, off: circMean(offs), points: kind === "timed" ? [] : pts,
                  meters: Math.round(m * 10) / 10, turns, segments: segs, t: Date.now() };
  localStorage.setItem("pip.routes", JSON.stringify(all));
  log("route saved", L.name, kind, pts.length, "points", m.toFixed(1), "m", turns, "turns");
  S.saved = { name: L.name, kind, meters: m, turns, pts, t: Date.now() };   // 06c Teach · Saved
  say(kind === "timed" ? `Saved the way to ${L.name}, from ${L.start}. Next time just ask me to take you there.`
    : `Saved the way to ${L.name}, from ${L.start}: about ${meters(m)}, ${turns ? `with ${turns} turn${turns === 1 ? "" : "s"}` : "in a straight line"}. Next time just ask me to take you there.`);
  if (hasAR && NATIVE) log("room scan saved:", await askNative({ type: "saveMap" }, 15000), "mapping", N.mapping);
  warmVoice();   // this route's phrases, ahead of time
}

function learnCancel() {   // STOP while teaching: nothing is saved
  if (!S.learning) return;
  log("teach cancelled", S.learning.name); S.learning = null;
  say("Stopped. I didn't save the route.");
}
function stopAll() {   // the STOP key
  indoorCancel();
  S.find = null; S.route = null; S.back = null; S.mission = null; S.walk = null; S.walkTok = null; S.preview = null; S.paused = false; S.orient = null; S.trip = null;
  say("Stopped."); render();
}

function replay(name) {
  ensureCamera();
  const all = routesStore(), key = Object.keys(all).find((k) => k.toLowerCase().includes(name.toLowerCase()) || name.toLowerCase().includes(k.toLowerCase()));
  if (!key) return say(`I don't have a route called ${name} yet.`);
  if (S.walk?.name === key) return say(`We're already on the way to ${key}.`);
  S.find = null; S.route = null; S.back = null; S.mission = null; S.walk = null; S.walkTok = null;
  const r = all[key];
  if (r.points?.length > 1) return replayPoints(key, r);
  if (NATIVE && !(r.segments || []).some((sg) => sg.turn_after === "left" || sg.turn_after === "right"))   // old phone route: only seconds, no turns
    return say(`The way to ${key} was saved the old way, which only counted seconds, so I can't guide you with it. Please teach it to me again. Say: teach me the way to ${key}.`);
  return replayTimed(key, r);
}
function replayTimed(key, r, why = "") {   // the old way: walk N seconds, turn, ... (no room tracking and no GPS)
  const steps = [];
  for (const sg of r.segments || []) {
    steps.push({ action: "walk", seconds: Math.round(sg.seconds), landmark: sg.landmarks?.at(-1) || null });
    if (sg.turn_after === "left" || sg.turn_after === "right") steps.push({ action: sg.turn_after, seconds: 0 });
  }
  if (!steps.length) return say(`${why}I don't have enough of the way to ${key} saved. Please teach it to me again.`);
  steps.push({ action: "arrive" });
  S.back = { steps, i: 0, started: Date.now(), arriveMsg: `You should be at ${key}.` }; S.route = null;
  say(`${why}Starting from ${r.start}. Walk straight about ${steps[0].seconds} seconds.`);
}
async function replayPoints(key, r) {
  const tok = S.walkTok = {}, live = () => S.walkTok === tok;
  const wait = async (ok, ms) => {
    for (const end = Date.now() + ms; Date.now() < end;) { if (!live()) return false; if (ok()) return true; await new Promise((res) => setTimeout(res, 300)); }
    return ok();
  };
  const hasAR = r.points.some((p) => p.ar), hasGPS = r.points.some((p) => p.gps);
  if (hasGPS) ensureGPS();
  let align = null;
  if (hasAR && NATIVE) {
    const loaded = r.frame && N.frame !== r.frame && await askNative({ type: "loadMap", frame: r.frame }, 3000);
    if (!await orient(live, `Taking you to ${key}. First, stand still. Turn slowly all the way around, so I can get my bearings.`, key)) return;
    if (r.frame && N.frame === r.frame) align = { same: true };   // the saved room points line up
    else if (loaded) {
      say("Keep pointing the phone around slowly. I'm still recognizing the room.");
      const o = S.orient = { seen: 12, dirs: [...Array(12).keys()], recognizing: true, name: key };
      const ok = await wait(() => N.frame === r.frame && slamReady(), 20000);
      if (S.orient === o) S.orient = null;
      if (ok) { align = { same: true }; doneChime(); say("Got it, I know where we are."); }
      else { if (!live()) return; await askNative({ type: "resetAR" }, 3000); await wait(arReady, 10000); }
    }
    if (!live()) return;
    if (!align && arReady()) {
      align = relativeAlign(r);
      if (align) say(`I couldn't recognize the room, so I'll guide you from the start of the route. Make sure you're standing at ${r.start}${align.facing ? ", facing the way you first walked" : ""}.`);
    }
  }
  if (!live()) return;
  if (!align && !hasGPS) return replayTimed(key, r, "I can't track this route right now, so I'll use timed steps. ");
  startWalk(key, r, align);
}
// Room not recognized: assume the user stands at the route's start, and turn the saved points to match.
// The compass tells the rotation (same spot, so the same magnetic quirks); without it, assume they face the first leg.
function relativeAlign(r) {
  const a = r.points.findIndex((p) => p.ar);
  if (a < 0) return null;
  const p0 = r.points[a].ar;
  let th, facing = false;
  if (r.off != null && N.compass != null) th = r.off - (N.compass - N.heading);
  else {
    const p1 = r.points.slice(a + 1).find((p) => p.ar && roomDist(p.ar, p0) > 0.3);
    if (!p1) return null;
    th = N.heading - roomBearing(p0, p1.ar); facing = true;
  }
  const t = rad(th), c = Math.cos(t), s = Math.sin(t), P = { x: N.pose.x, z: N.pose.z };
  return { facing, map: (q) => { const dx = q.x - p0.x, dz = q.z - p0.z; return { x: P.x + dx * c - dz * s, z: P.z + dx * s + dz * c }; } };
}

function locate(p) {   // where a route point is from here: {d meters, off degrees (+ = to the right), via, r = "arrived" radius}
  const viaAR = () => (p.ar && slamReady() ? { d: roomDist(N.pose, p.ar), off: angleDiff(N.heading, roomBearing(N.pose, p.ar)), via: "ar", r: 0.6 } : null);
  const viaGPS = () => {
    if (!p.gps || !gpsGood()) return null;
    const h = compassNow();
    return { d: dist(S.fix, p.gps), off: h == null ? null : angleDiff(h, bearing(S.fix, p.gps)), via: "gps", r: Math.max(5, Math.min(12, S.fix.acc)) };
  };
  return S.walk?.same ? viaAR() || viaGPS() : viaGPS() || viaAR();   // trust the room when Pip recognized it
}
// Point w.i counts as reached when you're inside its circle, past the line through it, or (in a room) already closer
// to the next point. The walk start uses this same test: trip 2026-10-25 13:12 skipped only by circle, so Pip said
// "Turn around." for a point behind you and then, one frame later, "Turn left." for the next one.
function pointReached(w, l, g) {
  const p = w.pts[w.i], last = w.i === w.pts.length - 1;
  if (l.d < (last && l.via === "ar" ? 0.7 : l.r) || (g && g.along > (l.via === "ar" ? -0.1 : 0) && g.lateral < g.half)) return true;
  if (last || l.via !== "ar" || l.d >= 1.5) return false;
  const n = w.pts[w.i + 1];   // cut the corner
  return Boolean(n.ar && N.pose && roomDist(N.pose, n.ar) < roomDist(p.ar, n.ar));
}
function skipReached(w) { while (w.i < w.pts.length - 1) { const q = locate(w.pts[w.i]); if (q && pointReached(w, q, legGeom(w, q))) w.i++; else break; } }
// How Pip talks you along a route. Modeled on the Clew app for blind users (github.com/occamLab/Clew):
//   - a soft tick in both ears every 0.4 s while you face the right way; no tick means you're off course
//   - one short command at a time, always the same words: "Turn left, to 10 o'clock." "Walk 2 meters, about 3 steps."
//     "Bear right." "Stop. You're at the restroom."
//   - off course: taps in the ear you should turn toward, faster as you get close to facing the right way, and a chime
//     the moment you do; after 2 s, "Bear left." (at most every 5 s, like Clew)
const ON_COURSE = 30;   // degrees, Clew's on-track cone; 5 more before "off course", so it doesn't flicker
const ON_TICK = { side: "both", interval: 0.4, kind: "on" };
function stepsWords(m) {   // "2 meters, about 3 steps" (rounded, so the same phrases repeat and can be made ahead of time)
  const v = m < 3 ? Math.max(0.5, Math.round(m * 2) / 2) : m < 20 ? Math.round(m) : Math.round(m / 5) * 5;
  const steps = Math.max(1, Math.round(v / 0.7));
  return `${v} meter${v === 1 ? "" : "s"}${v < 10 ? `, about ${steps} step${steps === 1 ? "" : "s"}` : ""}`;
}
// How much to turn, as a clock around you (12 straight ahead, 3 to your right, 6 behind you), the way blind travelers
// learn directions in orientation and mobility training. Studies: clock positions beat compass points and degrees
// (Sanchez & Oyarzun 2010; a 9-person campus study: 8 of 9 preferred clock or plain words like "slightly left").
// Plain words come first for people who don't use the clock. Trip 2026-10-25 13:12: "Turn right." alone gave no
// amount; with 56 degrees to go the user turned about 100.
function turnWords(off) {
  const h = Math.max(1, Math.min(6, Math.round(Math.abs(off) / 30)));
  if (h === 6) return "Turn around.";
  const side = off < 0 ? "left" : "right", how = h === 1 ? `slightly ${side}` : h >= 4 ? `sharp ${side}` : side;
  return `Turn ${how}, to ${off < 0 ? 12 - h : h} o'clock.`;
}
// Off course: taps in the ear you should turn toward, faster the closer you are to facing the right way, like a
// Geiger counter: 1 tap a second when far, up to 10 near (Ahmetovic et al. 2023, IJHCS: this ticking plus a ping on
// target gave smaller turning errors than a ping alone; exponential, so it speeds up mostly near the end and you slow down).
function offTap(off, cone) {
  const left = Math.max(0, Math.abs(off) - cone), hz = Math.pow(15, 1 - Math.min(1, left / 150));
  return { side: off < 0 ? "left" : "right", interval: Math.round(Math.max(0.1, 1 / hz) * 100) / 100, kind: "tap" };
}
const ptBearing = (a, b) => (a.ar && b.ar ? roomBearing(a.ar, b.ar) : a.gps && b.gps ? bearing(a.gps, b.gps) : null);
const ptDist = (a, b) => (a.ar && b.ar ? roomDist(a.ar, b.ar) : a.gps && b.gps ? dist(a.gps, b.gps) : 0);
function turnAt(w, j, l) {   // the turn to make at route point j: "left", "right", "around" or "" (bends under 35 degrees don't count)
  const p = w.pts[j], n = w.pts[j + 1];
  if (!n) return "";
  const b1 = j === w.i ? (l.via === "ar" ? roomBearing(N.pose, p.ar) : bearing(S.fix, p.gps)) : ptBearing(w.pts[j - 1], p);
  const b2 = ptBearing(p, n);
  if (b1 == null || b2 == null) return "";
  const t = angleDiff(b1, b2);
  return Math.abs(t) < 35 ? "" : Math.abs(t) > 135 ? "around" : t < 0 ? "left" : "right";
}
function nextTurn(w, l) {   // how far to the next real turn (or the end): {d meters, j point, turn, last}
  let d = l.d, j = w.i;
  while (j < w.pts.length - 1 && !turnAt(w, j, l)) { d += ptDist(w.pts[j], w.pts[j + 1]); j++; }
  return { d, j, turn: turnAt(w, j, l), last: j === w.pts.length - 1 };
}
function instruct(w, text) { w.saidAt = Date.now(); say(text); }
// Clew (occamLab) counts a point as reached when you cross the line through it, square to the way you're walking,
// within 1 m to either side (GPS: its accuracy). Trip 2026-10-25: users walked past a corner 1 m off our 0.6 m circle
// and had to turn back. Also "on course" if walking on this way would pass within that width, even at a bigger angle.
function legGeom(w, l) {
  const prev = w.i > 0 ? w.pts[w.i - 1] : w.from, p = w.pts[w.i], ar = l.via === "ar";
  const P = (q) => (ar ? q?.ar : q?.gps ? toLocal(w.o, q.gps) : null);
  const a = P(prev), b = P(p), c = ar ? { x: N.pose.x, z: N.pose.z } : toLocal(w.o, S.fix);
  const L = a && b ? Math.hypot(b.x - a.x, b.z - a.z) : 0, h = ar ? N.heading : compassNow();
  if (L < 0.2 || h == null) return null;
  const ux = (b.x - a.x) / L, uz = (b.z - a.z) / L, hx = Math.sin(rad(h)), hz = -Math.cos(rad(h));
  const along = (c.x - b.x) * ux + (c.z - b.z) * uz;              // > 0: past the line through the point
  const lateral = Math.abs((c.x - b.x) * uz - (c.z - b.z) * ux);   // how far to the side of the point
  const fwd = hx * ux + hz * uz;
  let pass = Infinity;                                             // keep walking this way: how far to the side you'd pass it
  if (along < 0 && fwd > 0.2) { const t = -along / fwd; pass = Math.abs((c.x + hx * t - b.x) * uz - (c.z + hz * t - b.z) * ux); }
  return { along, lateral, pass, half: ar ? (w.i === w.pts.length - 1 ? 0.5 : 1.0) : Math.max(6, S.fix.acc) };
}
function legStart(w, speakStraight) {   // a new stretch: if you need to turn, only say that; the distance comes once you face the right way
  const l = locate(w.pts[w.i]);
  w.onSince = null; w.offSince = null;
  if (l && l.off != null && Math.abs(l.off) > ON_COURSE + 5) { w.phase = "turn"; w.onCourse = false; instruct(w, turnWords(l.off)); return; }
  w.phase = "go"; w.onCourse = true;
  if (l && speakStraight) instruct(w, `Walk ${stepsWords(nextTurn(w, l).d)}.`);
}
function startWalk(name, r, align) {
  const pts = r.points.map((p) => ({ ar: p.ar && align ? (align.same ? p.ar : align.map(p.ar)) : null, gps: p.gps || null }));
  const w = S.walk = { name, pts, i: 0, same: Boolean(align?.same), phase: "go", onCourse: true, saidAt: 0, bearAt: 0, lostSince: null, lostSaid: false,
                       dest: r.dest || null, o: pts.find((p) => p.gps)?.gps || (S.fix && { lat: S.fix.lat, lon: S.fix.lon }),
                       from: { ar: N.pose ? { x: N.pose.x, z: N.pose.z } : null, gps: S.fix ? { lat: S.fix.lat, lon: S.fix.lon } : null } };
  let best = -1, bd = Infinity;   // join the route at the nearest point
  pts.forEach((p, i) => { const l = locate(p); if (l && l.d < bd) { bd = l.d; best = i; } });
  if (best >= 0) w.i = best;
  const end = locate(pts.at(-1));
  if (end && end.d < end.r + 0.1) { S.walk = null; render(); return say(`You're already at ${name}.`); }
  skipReached(w);
  log("walk", name, r.kind, pts.length, "points", align ? (align.same ? "room recognized" : "from the start") : "GPS");
  render();
  if (!S.tickTaught) { S.tickTaught = true; say("Follow the ticking. It ticks while you face the right way."); }
  legStart(w, true);
}
function currentDirection() {   // answer "where do I go now?" from the route, not from a guess
  if (S.walk?.path) {
    const w = S.walk, m = w.man[w.m];
    if (!gpsGood(30)) return "GPS is weak here.";
    const g = gpsWhere(w);
    if (g.off != null && Math.abs(g.off) > ON_COURSE + 5) return turnWords(g.off);
    return `Walk ${distWords(nextStop(w, g.s))}${m ? `, then turn ${m.turn}${m.street ? ` onto ${m.street}` : ""}` : ` to ${w.name}`}.`;
  }
  if (S.walk) {
    const w = S.walk, l = locate(w.pts[w.i]);
    if (!l) return "I lost track. Stand still and point the phone around slowly.";
    if (l.off != null && Math.abs(l.off) > ON_COURSE + 5) return turnWords(l.off);
    const a = nextTurn(w, l);
    return `Walk ${stepsWords(a.d)}${a.last ? ` to ${w.name}` : a.turn ? `, then turn ${a.turn}` : ""}.`;
  }
  const st = S.back?.steps[S.back.i];
  return !st ? "We're not following a route right now." : st.action === "walk" ? "Keep walking straight." :
    st.action === "turn_around" ? "Turn around." : st.action === "left" || st.action === "right" ? `Turn ${st.action}.` : "You should be there.";
}
function walkCue() {   // runs every screen frame; the phone's position updates 10x a second
  if (S.walk.indoor) return indoorWalkCue(S.walk);
  const w = S.walk, p = w.pts[w.i], last = w.i === w.pts.length - 1, l = locate(p), now = Date.now();
  w.l = l;   // for the screen
  const around = N.pose ? blockedStep(w) : undefined; if (around !== undefined) return around;
  aroundCheck(w);
  sideCheck(w);
  if (!l) {   // no room tracking / no GPS: no ticks
    w.lostSince ??= now;
    if (now - w.lostSince > (p.ar ? 3000 : 10000) && now - (w.lostAt || 0) > 10000) {
      w.lostAt = now; w.lostSaid = true;
      say(p.ar ? "I lost track. Stand still and point the phone around slowly." : "GPS is weak here. Wait a moment, or move toward open sky.");
    }
    return null;
  }
  w.lostSince = null;
  if (w.lostSaid) { w.lostSaid = false; say("Got it."); legStart(w, true); return null; }
  const g = legGeom(w, l);
  if (pointReached(w, l, g)) {
    w.i++;
    if (w.i >= w.pts.length) {
      S.walk = null; render(); tap("both", "got");
      if (!w.dest) { S.arrived = { name: w.name, t: now }; say(`Stop. You're at ${w.name}.`); return null; }
      say(`Stop. You're at ${w.name}. Now I'll find the entrance with the camera.`);   // GPS gets you close; the camera does the last meters
      missionStart(`entrance of ${w.name}`, "door", ["entrance", "door", "doorway"]);
      return null;
    }
    skipReached(w); render();
    const t = locate(w.pts[w.i]);
    if (t && t.off != null && Math.abs(t.off) > ON_COURSE + 5) tap("both", "got");   // a corner: chime, then "Turn left."
    legStart(w, false);   // a bend you can just follow: no words, the ticking keeps going
    return null;
  }
  if (l.off == null) return null;
  const cone = l.d < (l.via === "ar" ? 1.2 : 15) ? 60 : ON_COURSE;   // close to a point its direction swings fast; don't nag
  const passes = Boolean(g && g.pass < g.half);
  if (Math.abs(l.off) < cone || passes) w.onCourse = true; else if (Math.abs(l.off) > cone + 5) w.onCourse = false;
  if (w.phase === "turn") {
    if (w.onCourse) {   // facing the right way: a chime so you stop turning; after 0.4 s, the distance
      if (w.onSince == null) turnDone();
      w.onSince ??= now;
      if (now - w.onSince > 400) { w.phase = "go"; w.offSince = null; instruct(w, `Walk ${stepsWords(nextTurn(w, l).d)}.`); }
    } else {
      w.onSince = null;
      if (now - w.saidAt > 5000) instruct(w, turnWords(l.off));   // still not facing it (or turned too far): say which way now
    }
  } else {
    if (w.onCourse) w.offSince = null; else w.offSince ??= now;
    const big = Math.abs(l.off) > 60;   // way off: say it sooner, and say "turn", not "bear"
    if (w.offSince && now - w.offSince > (big ? 1200 : 2000) && now - w.saidAt > 3500 && now - w.bearAt > 5000) {
      w.bearAt = now;
      if (Math.abs(l.off) > 120) { w.phase = "turn"; instruct(w, turnWords(l.off)); }
      else if (big) instruct(w, turnWords(l.off));
      else instruct(w, l.off < 0 ? "Bear left." : "Bear right.");
    }
    // A heads-up before each corner, outdoors only. Indoors the corner is 1 to 3 steps away when it would play, and in
    // trip 2026-10-25 13:12 both "Left/Right turn coming up" made the user turn right away, before the corner.
    // At the corner Pip chimes and says the turn anyway.
    const a = nextTurn(w, l), [near, far] = [8, 25];
    if (l.via !== "ar" && (a.turn === "left" || a.turn === "right") && a.d > near && a.d < far && w.warned !== a.j) {
      const onto = w.pts[a.j + 1]?.street;
      w.warned = a.j; say(`${a.turn === "left" ? "Left" : "Right"} turn coming up${onto ? `, onto ${onto}` : ""}.`);
    }
  }
  return w.onCourse ? ON_TICK : offTap(l.off, cone);
}

// ---------- outdoors: walk to a place with no taught route (GPS + compass) ----------
// Outdoors you follow the sidewalk (cane, shoreline); Pip says which way the path goes and when to turn at a real
// corner, like BlindSquare / Google Maps. It never aims you straight at the next point: in a simulation of a 3.5 km
// Apple Maps route with real GPS error that cut across lawns and roads, up to 47 m off the path.
//   - the path's shape and street names come from Apple Maps on the phone (the server's route has only corner points)
//   - "on course" = facing the way the path goes 15 m ahead of where you are on it (GPS error moves you sideways, not along)
//   - turns only at the corners Apple Maps names, from the path's real bend: "Right turn coming up, onto Gilman Dr" at 25 m,
//     "Turn right." at the corner, "Walk 120 meters." once you face the new way
const distWords = (m) => (m < 1000 ? `${Math.max(10, Math.round(m / 10) * 10)} meters` : `${(m / 1000).toFixed(1)} kilometers`);
function pathAt(P, s) {   // the point s meters along the path
  let i = 1; while (i < P.length - 1 && P[i].s < s) i++;
  const a = P[i - 1], b = P[i], t = b.s > a.s ? Math.max(0, Math.min(1, (s - a.s) / (b.s - a.s))) : 0;
  return { x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t };
}
function buildPath(latlons, steps) {   // -> {o, P: [{x, z, s}], total, man: [{s, turn, street}]}
  const o = latlons[0], P = [];
  for (const q of latlons) {
    const c = toLocal(o, q), last = P.at(-1);
    if (!last) P.push({ ...c, s: 0 }); else { const d = Math.hypot(c.x - last.x, c.z - last.z); if (d > 0.5) P.push({ ...c, s: last.s + d }); }
  }
  const total = P.at(-1).s, man = [];
  let side = null;   // "The destination is on your left" -> say it on arrival
  for (const st of steps || []) {   // each Apple Maps step starts at a corner; its real bend gives the direction
    if (/destination/i.test(st.text || "")) { side = /on your (left|right)/i.exec(st.text)?.[1]?.toLowerCase() || side; continue; }
    const c = toLocal(o, st);
    let best = null;
    for (let i = 1; i < P.length; i++) { const d = segDist(c, P[i - 1], P[i]); if (!best || d < best.d) { const A = P[i - 1], B = P[i], L = B.s - A.s;
      const t = L ? Math.max(0, Math.min(1, ((c.x - A.x) * (B.x - A.x) + (c.z - A.z) * (B.z - A.z)) / (L * L))) : 0; best = { d, s: A.s + t * L }; } }
    if (!best || best.s < 5 || best.s > total - 5) continue;
    const before = roomBearing(pathAt(P, best.s - 10), pathAt(P, best.s)), after = roomBearing(pathAt(P, best.s), pathAt(P, best.s + 10));
    const bend = angleDiff(before, after);
    if (Math.abs(bend) < 35) continue;   // "Continue onto La Jolla Village Dr": not a turn
    const street = /\b(?:onto|on)\s+(.+?)\.?$/i.exec(st.text || "")?.[1];
    man.push({ s: best.s, turn: Math.abs(bend) > 135 ? "around" : bend < 0 ? "left" : "right", street: street && !/^the (path|road|street)$/i.test(street) ? street : null });
  }
  man.sort((x, y) => x.s - y.s);
  return { o, P, total, man, side };
}
async function looksOutside() {   // one camera frame: is this outdoors (not a room, not a view through a door)?
  try {
    const blob = await frameBlob(); if (!blob) return false;
    const fd = new FormData(); fd.append("image", blob, "f.jpg"); fd.append("room", "outside");
    const c = await (await fetch(SERVER + "/check_room", { method: "POST", body: fd, signal: AbortSignal.timeout(8000) })).json();
    log("outside before the route?", c.room, c.looking_through_doorway ? "(through a doorway)" : "", `gps ±${Math.round(S.fix?.acc ?? 0)} m`);
    if (c.looking_through_doorway) return false;
    const room = String(c.room).toLowerCase();   // facing a wall outdoors it says "unknown": only a named room means inside
    return room === "outside" || (room === "unknown" && gpsGood(15));
  } catch (e) { log("outside check failed", e.message); return false; }
}
// ---------- blocked spots: a confirmed gate or hedge on the route, so a new route goes around it ----------
// Trip 15:58: blocked at a gate, then Apple Maps' new route went the same way into another wall. A spot counts as
// blocked only when LiDAR and the camera agree; routes passing within 20 m of one are skipped (GPS error here was
// 5-14 m). Apple Maps gives alternate routes; if all pass it, try going via a point 60 m to either side of it.
const AVOID_M = 20, VIA_M = 60, BLOCK_KEEP_MS = 30 * 60000;   // a shut gate stays shut for a while; forget after 30 min
const liveBlocks = () => (S.blocks || []).filter((b) => Date.now() - b.t < BLOCK_KEEP_MS);
function addBlock(what) {   // the spot just ahead of you (LiDAR saw it within ~2 m; GPS puts you within ~10 m)
  if (!S.fix || compassNow() == null) return;
  const b = { ...move(S.fix, compassNow(), 3), t: Date.now(), what };
  (S.blocks ||= []).push(b);
  log("blocked spot:", what, b.lat.toFixed(6), b.lon.toFixed(6));
}
function routeHitsBlock(points) {
  const bs = liveBlocks(); if (!bs.length || points.length < 2) return false;
  const o = { lat: points[0][0], lon: points[0][1] }, P = points.map(([lat, lon]) => toLocal(o, { lat, lon }));
  return bs.some((b) => { const c = toLocal(o, b); return P.some((p, i) => i > 0 && segDist(c, P[i - 1], p) < AVOID_M); });
}
async function routeAvoiding(here, to) {   // -> {route, via, all}: the first Apple Maps route clear of blocked spots
  const d = await askNative({ type: "directions", from: here, to }, 15000);
  const routes = d?.routes || (d?.points ? [d] : []);
  const clear = routes.find((r) => r.points?.length > 1 && !routeHitsBlock(r.points));
  if (clear || !routes.length) return { route: clear || null, all: routes.length };
  const b = liveBlocks().at(-1), toBlock = bearing(here, b);
  for (const side of [-90, 90]) {   // around it: via a point beside the block, then on to the place
    const v = move(b, (toBlock + side + 360) % 360, VIA_M);
    const [a1, a2] = await Promise.all([askNative({ type: "directions", from: here, to: v }, 15000), askNative({ type: "directions", from: v, to }, 15000)]);
    if (!(a1?.points?.length > 1 && a2?.points?.length > 1)) continue;
    const points = [...a1.points, ...a2.points.slice(1)];
    if (!routeHitsBlock(points)) return { route: { points, steps: [...(a1.steps || []), ...(a2.steps || [])], seconds: (a1.seconds || 0) + (a2.seconds || 0) }, via: true, all: routes.length };
  }
  return { route: null, all: routes.length };
}
// go: they already said yes (coming out of a building): start right away instead of asking again.
async function gpsWalk(name, to, serverSteps, entrance = true, { go = false, placeId = null, where = "" } = {}) {   // where: ", on Library Walk"   // entrance: at the end, find the door with the camera
  ensureGPS(); ensureCamera();
  S.find = null; S.route = null; S.back = null; S.mission = null; S.walk = null; const tok = S.walkTok = {};
  for (let i = 0; i < 30 && !gpsGood(30); i++) { if (i === 0) say("Getting your location."); await new Promise((r) => setTimeout(r, 500)); }
  if (S.walkTok !== tok) return;
  // Inside? Weak GPS says so, but indoors Wi-Fi location often looks good, so the camera has the last word: a street
  // route from inside a room points you at a wall. Inside -> get out room by room first, then this route.
  const justOut = Date.now() - (S.outsideAt || 0) < 120000;   // a trip just walked them out: don't send them back in
  const inside = !gpsGood(30) || (NATIVE && !justOut && !(await looksOutside()));
  if (S.walkTok !== tok) return;
  if (inside) {
    if (NATIVE && !S.trip?.out) return leaveStart({ dest: { name, to, steps: serverSteps, placeId } });
    if (!gpsGood(30)) return say("GPS is weak here. Step outside or near a window, and ask me again.");
  }
  const here = { lat: S.fix.lat, lon: S.fix.lon };
  let path = null, secs = null;
  if (NATIVE) {
    const { route: d, via, all } = await routeAvoiding(here, to);
    if (d?.points?.length > 1) {
      path = buildPath(d.points.map(([lat, lon]) => ({ lat, lon })), d.steps); secs = d.seconds;
      log("apple maps route", name, Math.round(path.total), "m", d.points.length, "shape points,", path.man.length, "turns",
          via ? "(around a blocked spot)" : all > 1 ? `(of ${all} routes)` : "");
    } else if (all && liveBlocks().length) {
      log("every route goes through a blocked spot");
      return say("Every way I can find goes through the blocked spot. Is there a way through it, like a door in the gate? Or ask someone nearby.");
    } else log("apple maps route failed", "no answer");
  }
  if (!path && serverSteps?.length) {   // fallback: the server's corner points, joined by straight lines
    const pts = [here, ...serverSteps.map((st) => ({ lat: st.lat, lon: st.lon }))];
    path = buildPath(pts, serverSteps.slice(1).map((st) => ({ lat: st.lat, lon: st.lon, text: st.name && st.name !== "the path" ? `onto ${st.name}` : "" })));
  }
  if (S.walkTok !== tok) return;
  if (!path || path.total < 5) return say(`I can't get a walking route to ${name} right now.`);
  // 09 Route preview: say how far it is (numbers from the route, not the AI) and ask before a long walk starts
  const mins = Math.max(1, Math.round((secs || path.total / 1.3) / 60));
  S.preview = { name, path, mins, entrance, to, steps: serverSteps, placeId, acc: S.fix.acc };
  render();
  if (go) { say(`${name}${where} is ${distWords(path.total)} away, about ${mins} minutes walking.`); return previewGo(); }
  say(`${name}${where} is ${distWords(path.total)} away, about ${mins} minutes walking. Want me to take you?`);
}
// ---------- finding a place: Apple Maps on the phone (real places only), then its walking route ----------
// The brain only names what to look for. Which place, how far and which street come from Apple Maps, and the words are
// built here, so nothing about the place is invented. Best match = the name matches, then the nearest.
const nameWords = (t) => t.toLowerCase().replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length > 1 && !/^(the|store|shop|at|near|in|on|a|an)$/.test(w));
// "the nearest Target near me" -> "Target": Apple answers the phrase with a different (worse) list than the name.
const cleanQuery = (q) => q.replace(/\b(the|a|an|some|any)\s+(nearest|closest)\b|\b(nearest|closest)\b|\b(near|around)\s+(me|here)\b|\bnearby\b|\bplease\b/gi, " ")
  .replace(/^\s*(the|a|an|some)\s+/i, "").replace(/\s+/g, " ").trim() || q;
// Best match: the name matches, then the nearest. A name match only wins if it isn't far beyond the nearest result
// ("restroom" matched a "Restroom" 19 km away over "Toilets" 55 m away).
function bestPlace(query, places, here) {
  const want = nameWords(query.replace(/\s+\b(at|near|by|in)\b.*$/i, ""));
  const scored = places.map((p) => {
    const got = nameWords(p.name), hit = want.filter((w) => got.some((g) => g.startsWith(w) || w.startsWith(g))).length;
    return { ...p, hit: want.length ? hit / want.length : 0, d: dist(here, p) };
  });
  const nearest = Math.min(...scored.map((p) => p.d));
  const named = scored.filter((p) => p.hit >= 0.5 && p.d <= Math.max(2000, 3 * nearest));
  return named.length ? named.sort((a, b) => b.hit - a.hit || a.d - b.d)[0] : scored.sort((a, b) => a.d - b.d)[0];   // else: just the nearest
}
async function placeSearch(query) {
  if (!query) return say("What place should I look for?");
  ensureGPS(); say("Looking it up.");
  for (let i = 0; i < 20 && !gpsGood(100); i++) await new Promise((r) => setTimeout(r, 500));
  if (!S.fix) return say("I can't get your location yet. Ask me again in a moment.");
  const here = { lat: S.fix.lat, lon: S.fix.lon };
  const qs = [...new Set([cleanQuery(query), query])];   // the plain name first, the words as said too
  const answers = NATIVE ? await Promise.all(qs.map((q) => askNative({ type: "search", q, lat: here.lat, lon: here.lon }, 10000))) : [];
  const seen = new Set(), places = answers.flatMap((r) => r?.places || []).filter((p) => { const k = `${p.name}|${p.address}`; return !seen.has(k) && seen.add(k); });
  log("apple maps search", JSON.stringify(qs), "->", places.length ? places.map((p) => `${p.name} (${Math.round(dist(here, p))} m)`).join("; ") : answers[0]?.error || "no answer");
  if (!places.length) return say(`I couldn't find ${query} on the map nearby. Can you say the name another way?`);
  const p = bestPlace(cleanQuery(query), places, here);
  return gpsWalk(p.name, { lat: p.lat, lon: p.lon }, null, true, { where: p.address ? `, ${/^\d/.test(p.address) ? "at" : "on"} ${p.address}` : "" });
}
function previewGo() {   // GO key, or "yes"
  const p = S.preview; if (!p) return;
  S.preview = null;
  if (!gpsGood(30)) return NATIVE ? leaveStart({ dest: { name: p.name, to: p.to, steps: p.steps, placeId: p.placeId } }) : say("GPS is weak here. Step outside or near a window, and ask me again.");
  S.walk = { name: p.name, to: p.to, steps: p.steps, entrance: p.entrance, path: true, ...p.path, pts: p.path.man.map((m) => ({ gps: null, s: m.s })), i: 0, k: 0, m: 0, phase: "go", onCourse: true,
             saidAt: 0, bearAt: 0, offPathAt: 0, lostSince: null, lostSaid: false, dest: p.entrance ? { name: p.name, to: p.to } : null };
  render();
  if (!S.tickTaught) { S.tickTaught = true; say("Follow the ticking. It ticks while you face the right way."); }
  gpsLeg(S.walk, true);
}
function previewCancel() {   // CANCEL key, or "no"
  if (!S.preview) return;
  S.preview = null; S.walkTok = null; say("Okay."); render();
}
function gpsWhere(w) {   // where you are on the path: {s meters along, e meters to the side, want = bearing to follow, off}
  const c = toLocal(w.o, S.fix);
  let best = null;
  for (let i = Math.max(1, w.k - 3); i < Math.min(w.P.length, w.k + 60); i++) {   // search near the last spot, so a nearby street doesn't steal it
    const A = w.P[i - 1], B = w.P[i], L = B.s - A.s;
    const t = L ? Math.max(0, Math.min(1, ((c.x - A.x) * (B.x - A.x) + (c.z - A.z) * (B.z - A.z)) / (L * L))) : 0;
    const d = Math.hypot(c.x - A.x - t * (B.x - A.x), c.z - A.z - t * (B.z - A.z));
    if (!best || d < best.e) best = { i, e: d, s: A.s + t * L };
  }
  w.k = best.i;
  const from = best.e > 25 ? c : pathAt(w.P, best.s);   // far off the path: head back to it, otherwise follow its direction
  const want = roomBearing(from, pathAt(w.P, best.s + 15)), h = compassNow();
  return { ...best, want, off: h == null ? null : angleDiff(h, want) };
}
const nextStop = (w, s) => (w.man[w.m] ? w.man[w.m].s : w.total) - s;   // meters to the next turn (or the end)
function gpsLeg(w, speakStraight) {
  const g = gpsWhere(w);
  w.onSince = null; w.offSince = null;
  if (g.off != null && Math.abs(g.off) > ON_COURSE + 5) { w.phase = "turn"; w.onCourse = false; instruct(w, turnWords(g.off)); return; }
  w.phase = "go"; w.onCourse = true;
  if (speakStraight) instruct(w, `Walk ${distWords(nextStop(w, g.s))}.`);
}
// ---------- what's ahead while you walk: LiDAR every frame, decisions from the live floor map ----------
// Trip 2026-10-25 15:04: the route said turn, the user turned into a wall and stopped, and nothing noticed (the old
// check needs forward motion). Now LiDAR is read every frame (~10/s). Blocked for 1.5 s straight (a person walking past
// doesn't count) -> the camera's detector names it, and the live floor map (ARKit + LiDAR, the same map room search
// uses) is asked for a way around toward a spot 8 m further along the route. A way around: tick the user around it.
// None, or blocked 3 times: walk back ~10 m along their own path (never to the start) and take a new route from there.
const BLOCKED_M = 1.2, BLOCKED_FOR_MS = 1500, AROUND_GOAL_M = 8, BACK_M = 10;   // 1.2 m: two steps to stop and turn; 10 m: back past the last corner on campus paths
function trailTick(w) {   // where you walked during this walk (room meters), for a short walk back
  if (!N.pose || N.pose.tracking !== "ok") return;
  const last = (w.trail ||= []).at(-1);
  if (!last || roomDist(last, N.pose) >= 1) { w.trail.push({ x: N.pose.x, z: N.pose.z }); if (w.trail.length > 300) w.trail.shift(); }
}
function routeAhead(w) {   // a spot on the floor map 8 m along the way the route goes from here (room meters), or null
  if (!slamReady()) return null;
  const p = w.pts?.[w.i];
  if (!w.path && p?.ar) return p.ar;                                  // a taught route: its next point is already on the map
  if (!w.g || N.compass == null || N.heading == null) return null;
  const b = rad(w.g.want - (N.compass - N.heading));                  // the route's direction (from north) turned into map direction
  return { x: N.pose.x + Math.sin(b) * AROUND_GOAL_M, z: N.pose.z - Math.cos(b) * AROUND_GOAL_M };
}
async function aroundCheck(w, said = false) {
  trailTick(w);
  const t = Date.now(), d = N.depth;
  if (w.backTo || w.detour || w.aroundBusy) return;
  w.startedAt ??= t;
  if (t - w.startedAt < 8000) return;   // trip 15:31: right out of a door, "go back 10 meters" sent the user back inside
  const blocked = d ? d.ahead < BLOCKED_M && (said || w.onCourse !== false) : said;
  if (!said) {
    if (!blocked) { w.blockedSince = null; return; }
    w.blockedSince ??= t;
    if (t - w.blockedSince < BLOCKED_FOR_MS) return;
  }
  w.blockedSince = null; w.aroundBusy = true;
  try {
    let what = null, dd = d;
    const blob = lastFrame || (await frameBlob());
    if (blob) {   // the camera names it (and stands in for LiDAR on phones without it)
      const fd = new FormData(); fd.append("image", blob, "f.jpg");
      const r = await (await fetch(SERVER + "/local", { method: "POST", body: fd, signal: AbortSignal.timeout(6000) })).json();
      what = r.hazards.find((h) => h.side === "ahead")?.label || null;
      dd ||= { ahead: r.hint === "stop" ? 0.8 : 8, left: r.clear.left > 0.4 ? 8 : 1, right: r.clear.right > 0.4 ? 8 : 1 };
    }
    if (S.walk !== w || !dd) return;
    if (said && dd.ahead >= BLOCKED_M && !what) return say("I don't see anything right in front of you. Try a step forward slowly, I'll warn you.");
    w.blocks = (w.blocks || 0) + 1; obstacleSeen(what);
    const name = what ? `There's a ${what} ahead` : dd.left < 1.5 && dd.right < 1.5 ? "There's a wall ahead" : "Something's in the way";
    const goal = w.blocks < 3 ? routeAhead(w) : null;
    const pts = goal ? await askNative({ type: "path", x: goal.x, z: goal.z }) : null;   // A* on the live map, around what LiDAR has seen
    log("blocked ahead:", dd.ahead.toFixed(1), "m", what || "(unnamed)", `left ${dd.left.toFixed(1)} right ${dd.right.toFixed(1)}`, `#${w.blocks}`,
        said ? "(user said)" : "", goal ? (pts?.length ? `way around: ${pts.length} points` : "no way around on the map") : "no map goal");
    if (S.walk !== w) return;
    const sawIt = what || (w.lastPath && Date.now() - w.lastPath.t < 10000 && /blocked/.test(w.lastPath.ahead)) || (dd.left < 1.5 && dd.right < 1.5);
    if (pts?.length > 1) {
      w.detour = pts;
      const first = pts.find((q) => roomDist(N.pose, q) > 0.8) || pts[0], side = angleDiff(N.heading, roomBearing(N.pose, first)) < 0 ? "left" : "right";
      return say(`Stop. ${name}. I'll take you around it, to your ${side}. Follow the ticking.`, { urgent: true });
    }
    if (w.path && w.to && sawIt) {   // LiDAR and the camera agree it's blocked: a route around that spot, from here
      addBlock(w.lastPath?.what && w.lastPath.what !== "none" ? w.lastPath.what : what || "wall");
      say(`Stop. ${name}, and there's no way around it here. I'll find a different way.`, { urgent: true });
      return rerouteWalk(w);
    }
    return walkBackShort(w, name);
  } catch (e) { log("around check failed", e.message); }
  finally { w.aroundBusy = false; }
}
function walkBackShort(w, why) {   // back ~10 m along your own path (not to the start), then a new route from there
  const tr = w.trail || [];
  let k = tr.length - 1, back = 0;
  while (k > 0 && back < BACK_M) { back += roomDist(tr[k], tr[k - 1]); k--; }
  if (back < 5) { say(`Stop. ${why}. I'll find another way from here.`, { urgent: true }); return rerouteWalk(w); }   // under 5 m walked: nothing worth going back to
  w.backTo = tr[k]; w.trail = tr.slice(0, k + 1); w.blocks = 0;
  say(`Stop. ${why}, and there's no way around. Let's go back about ${Math.round(back)} meters, just the way you came, not to the start. Turn around, and follow the ticking.`, { urgent: true });
}
function blockedStep(w) {   // going around, or walking back: the floor-map cue; undefined when neither
  if (w.detour) {
    while (w.detour.length > 1 && roomDist(N.pose, w.detour[0]) < 0.6) w.detour.shift();
    if (roomDist(N.pose, w.detour.at(-1)) < 0.8) { w.detour = null; w.blocks = 0; turnDone(); say("Okay, you're around it. Back on the route."); return null; }
    return walkToCue(w.detour[0]);
  }
  if (w.backTo) {
    if (roomDist(N.pose, w.backTo) < 1) { w.backTo = null; turnDone(); say("Okay, stop. I'll find another way from here."); rerouteWalk(w); return null; }
    return walkToCue(w.backTo);
  }
  return undefined;
}
function rerouteWalk(w) {   // a new route from where you are; a taught route can't change, so it waits for you to step around
  if (!w.path || !w.to) return say("Feel along it to find the way around, and I'll pick up the route again.");
  S.walk = null; render();
  gpsWalk(w.name, w.to, null, Boolean(w.entrance), { go: true });
}
// Outdoors the route only knows a GPS direction (trip 15:32: following it straight into a corner). Every 5 s the vision
// model looks the way you face: blocked -> the LiDAR/map check now; the path bends -> follow the camera for 8 s.
const PATH_EVERY_MS = 3000, PATH_BIAS_DEG = 40, PATH_BIAS_MS = 8000;   // 40 deg: a clear "bear", not a full turn
const SIDE_NEAR_M = 0.7, SIDE_FAR_M = 1.5, SIDE_BIAS_DEG = 20, SIDE_SAY_MS = 6000;   // 0.7 m: within arm's reach of a wall or hedge
// LiDAR every frame, on straight stretches too: something close on one side and room on the other -> lean away from it.
function sideCheck(w) {
  const d = N.depth, t = Date.now();
  if (!d || w.phase !== "go" || d.ahead < BLOCKED_M) return;
  const side = d.left < SIDE_NEAR_M && d.right > SIDE_FAR_M ? "right" : d.right < SIDE_NEAR_M && d.left > SIDE_FAR_M ? "left" : null;
  if (!side) return;
  if (!(w.bias && t < w.biasUntil)) { w.bias = side === "right" ? SIDE_BIAS_DEG : -SIDE_BIAS_DEG; w.biasUntil = t + 2000; }
  if (t - (w.sideSaidAt || 0) > SIDE_SAY_MS) {
    w.sideSaidAt = t;
    log("side close:", side === "right" ? `left ${d.left.toFixed(1)} m` : `right ${d.right.toFixed(1)} m`);
    say(`Bear ${side} a little.`);
  }
}
async function pathCheck(w) {
  const t = Date.now();
  if (w.pathBusy || t - (w.pathAt || 0) < PATH_EVERY_MS || w.phase !== "go" || w.backTo || w.detour || !lastFrame) return;
  w.pathAt = t; w.pathBusy = true;
  try {
    const fd = new FormData(); fd.append("image", lastFrame, "f.jpg");
    const r = await (await fetch(SERVER + "/path_ahead", { method: "POST", body: fd, signal: AbortSignal.timeout(6000) })).json();
    if (S.walk !== w) return;
    log("path ahead:", r.ahead, "path", r.path, r.what && r.what !== "none" ? r.what : "");
    const prev = w.lastPath;
    w.lastPath = { ...r, t };
    // Act only when two looks in a row agree (replaying trip 15:30, single looks flipped left/right at a building
    // 50 m away; the real wall was flagged on every look from 13 s before it).
    const agree = prev && t - prev.t < 3 * PATH_EVERY_MS && prev.ahead === r.ahead && prev.path === r.path;
    if (r.ahead === "blocked" && !(N.depth && N.depth.ahead < 2)) r.ahead = "blocked_soon";   // fills the photo but LiDAR says it isn't close
    if (!agree && r.ahead !== "blocked") return;
    if (r.ahead === "blocked_soon") {   // across the path 3-15 m ahead: warn now, while there's room to choose
      const named = r.what && r.what !== "none" ? r.what : "something";
      obstacleSeen(named);
      if (r.path === "left" || r.path === "right") { w.bias = r.path === "left" ? -PATH_BIAS_DEG : PATH_BIAS_DEG; w.biasUntil = t + PATH_BIAS_MS; }
      if (t - (w.soonSaidAt || 0) > PATH_BIAS_MS) {
        w.soonSaidAt = t;
        say(`Heads up, there's a ${named} across the path ahead.${r.path === "left" || r.path === "right" ? ` The way goes ${r.path}. Bear ${r.path}.` : " Slow down."}`);
      }
      return;
    }
    if (r.ahead === "blocked" && (r.path === "left" || r.path === "right")) {
      w.bias = r.path === "left" ? -PATH_BIAS_DEG : PATH_BIAS_DEG; w.biasUntil = t + PATH_BIAS_MS;
      say(`The path goes ${r.path} here${r.what && r.what !== "none" ? `, there's a ${r.what} ahead` : ""}. Bear ${r.path}.`);
    } else if (r.ahead === "blocked") aroundCheck(w, true);
    else if ((r.path === "left" || r.path === "right") && r.what && r.what !== "none") {
      // trip 15:32: 13 s before the wall the camera already said "path left, building ahead"; say it and follow it
      w.bias = r.path === "left" ? -PATH_BIAS_DEG : PATH_BIAS_DEG; w.biasUntil = t + PATH_BIAS_MS;
      if (t - (w.bendSaidAt || 0) > PATH_BIAS_MS) { w.bendSaidAt = t; say(`The path bends ${r.path}, there's a ${r.what} ahead. Bear ${r.path}.`); }
    } else if (r.path === "left" || r.path === "right") { w.bias = r.path === "left" ? -PATH_BIAS_DEG / 2 : PATH_BIAS_DEG / 2; w.biasUntil = t + PATH_BIAS_MS; }
  } catch (e) { log("path check failed", e.message); }
  finally { w.pathBusy = false; }
}
function gpsCue() {
  const w = S.walk, now = Date.now();
  if (!gpsGood(30)) {
    w.lostSince ??= now;
    if (now - w.lostSince > 10000 && now - (w.lostAt || 0) > 15000) { w.lostAt = now; w.lostSaid = true; say("GPS is weak here. Keep going carefully, or wait a moment."); }
    return null;
  }
  w.lostSince = null;
  if (w.lostSaid) { w.lostSaid = false; say("GPS is back."); }
  const around = N.pose ? blockedStep(w) : undefined; if (around !== undefined) return around;
  aroundCheck(w);
  const g = gpsWhere(w);
  pathCheck(w); sideCheck(w);
  if (w.bias && now < w.biasUntil && compassNow() != null) g.off = angleDiff(compassNow(), g.want + w.bias);   // the camera's path over GPS
  w.i = w.m; w.s = g.s; w.e = g.e; w.g = g;
  if (w.total - g.s < Math.max(8, S.fix.acc)) {   // arrived
    S.walk = null; render(); tap("both", "got");
    const where = w.side ? `${w.name} is on your ${w.side}.` : `You're at ${w.name}.`;
    if (!w.dest) { S.arrived = { name: w.name, t: now, side: w.side }; say(`Stop. ${where}`); return null; }
    say(`Stop. ${where} Now I'll find the entrance with the camera.`);   // GPS gets you close; the camera does the last meters
    missionStart(`entrance of ${w.name}`, "door", ["entrance", "door", "doorway"]);
    return null;
  }
  const m = w.man[w.m];
  if (m) {
    const dm = m.s - g.s;
    if (dm < 25 && dm > 10 && w.warned !== w.m && m.turn !== "around") {
      w.warned = w.m; say(`${m.turn === "left" ? "Left" : "Right"} turn coming up${m.street ? `, onto ${m.street}` : ""}.`);
    }
    if (dm < Math.max(5, Math.min(10, S.fix.acc))) { w.m++; render(); tap("both", "got"); gpsLeg(w, false); return null; }   // at the corner: chime, "Turn right."
  }
  if (g.e > 25 && now - w.offPathAt > 20000) { w.offPathAt = now; say("You're off the route. Follow the ticking back to it."); }
  if (g.off == null) return null;
  if (Math.abs(g.off) < ON_COURSE) w.onCourse = true; else if (Math.abs(g.off) > ON_COURSE + 5) w.onCourse = false;
  if (w.phase === "turn") {
    if (w.onCourse) { if (w.onSince == null) turnDone(); w.onSince ??= now; if (now - w.onSince > 400) { w.phase = "go"; w.offSince = null; instruct(w, `Walk ${distWords(nextStop(w, g.s))}.`); } }
    else { w.onSince = null; if (now - w.saidAt > 5000) instruct(w, turnWords(g.off)); }
  } else {
    if (w.onCourse) w.offSince = null; else w.offSince ??= now;
    const big = Math.abs(g.off) > 60;   // compass sways while walking: give it 3 s (1.5 s when way off)
    if (w.offSince && now - w.offSince > (big ? 1500 : 3000) && now - w.saidAt > 3500 && now - w.bearAt > 6000) {
      w.bearAt = now;
      if (Math.abs(g.off) > 120) { w.phase = "turn"; instruct(w, turnWords(g.off)); }
      else instruct(w, big ? turnWords(g.off) : g.off < 0 ? "Bear left." : "Bear right.");
    }
  }
  return w.onCourse ? ON_TICK : offTap(g.off, ON_COURSE);
}

// Something close in front of you (LiDAR), while Pip leads and you're walking. In the trip data the camera's object
// labels came too early and were wrong (a couch 1.8 m away called "bed"), so only the measured distance counts.
const recentPoses = [];
function hazardCheck() {
  if (!N.depth || !N.pose || N.pose.tracking !== "ok") return;
  const now = Date.now();
  recentPoses.push({ t: now, x: N.pose.x, z: N.pose.z, h: N.heading });
  while (recentPoses.length && now - recentPoses[0].t > 1000) recentPoses.shift();
  const o = recentPoses[0], dt = o ? (now - o.t) / 1000 : 0;
  if (dt < 0.5) return;
  const hr = rad(N.heading), forward = ((N.pose.x - o.x) * Math.sin(hr) - (N.pose.z - o.z) * Math.cos(hr)) / dt;   // m/s toward where the phone points
  const turning = Math.abs(angleDiff(o.h, N.heading)) / dt;                                                    // degrees per second
  if (!(S.walk || S.route || S.back) || S.learning || S.mission) return;   // the mission has its own obstacle check
  if (S.walk?.path) { if (S.walk.phase === "turn") return; }
  else if (S.walk) {
    if (S.walk.phase === "turn") return;
    const end = locate(S.walk.pts.at(-1)), next = locate(S.walk.pts[S.walk.i]);
    if ((end && end.d < 1.2) || (next && next.via === "ar" && next.d < 1.2)) return;   // at the goal or a corner, walls are expected
  }
  const a = N.depth.ahead;
  if (forward < 0.25 || turning > 30 || a > 0.7 || now - hazardSaidAt < 8000) return;
  hazardSaidAt = now; S.hazardAt = now; obstacleSeen();
  say(a < 0.45 ? "Stop. Something right in front of you." : "Careful, something in front of you.", { urgent: a < 0.45 });
}

// Make Pip's fixed phrases ahead of time, so they play at once (a new phrase takes the server 1 to 5 s).
const PHRASES = ["Left.", "Right.", "Up.", "Down.", "I lost it. Turn slowly.", "Straight ahead. Move closer.", "Got it, right in front of you.", ...[-150, -120, -90, -60, -30, 30, 60, 90, 120, 150, 180].map(turnWords), "Turn left.", "Turn right.", "Bear left.", "Bear right.", "Left turn coming up.", "Right turn coming up.",
  "Okay, stop.", "Got it.", "Okay.", "Follow the ticking.", "It ticks while you face the right way.",
  "Careful, something in front of you.", "Stop.", "Something right in front of you.",
  "I lost track.", "Stand still and point the phone around slowly.",
  "First, stand still.", "Turn slowly all the way around, so I can get my bearings.",
  "Keep pointing the phone around slowly.", "I'm still recognizing the room.", "Got it, I know where we are."];
function warmVoice() {
  if (!NATIVE) return;
  const walks = [0.5, 1, 1.5, 2, 2.5, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 25, 30].map((v) => `Walk ${stepsWords(v)}.`);
  const routes = Object.keys(routesStore()).flatMap((n) => [`Taking you to ${n}.`, `You're at ${n}.`, `I'll learn the way to ${n}.`]);
  toNative({ type: "warm", texts: [...PHRASES, ...walks, ...routes], server: SERVER });
}

// ---------- signs: read on the phone (Apple Vision), then go to the one that matches ----------
// IBM's one-shot wayfinding study (Yamanaka et al.) had blind users pick directions faster when signs were read from a
// full turn around. Pip reads signs every 30 degrees while you turn, and every few seconds while you walk. It goes to a
// matching sign before trying doors and openings (VLFM/ESC-style exploration, the rest of this mission).
const SIGN_WORDS = { restroom: ["restroom", "toilet", "bathroom", "wc", "lavatory", "washroom", "men", "women", "all gender"] };
SIGN_WORDS.bathroom = SIGN_WORDS.restroom; SIGN_WORDS.toilet = SIGN_WORDS.restroom;
// Grocery: aisle signs name the section, not each product. Common products -> words their section's sign uses.
const SECTIONS = { cereal: ["cereal", "breakfast"], oatmeal: ["oatmeal", "cereal", "breakfast"], milk: ["milk", "dairy"], eggs: ["eggs", "dairy"],
  cheese: ["cheese", "dairy", "deli"], yogurt: ["yogurt", "dairy"], butter: ["butter", "dairy"], bread: ["bread", "bakery"], coffee: ["coffee", "tea"],
  tea: ["tea", "coffee"], pasta: ["pasta", "italian", "sauce"], rice: ["rice", "grains", "beans"], beans: ["beans", "canned"], soup: ["soup", "canned"],
  chips: ["chips", "snacks"], crackers: ["crackers", "snacks"], cookies: ["cookies", "snacks"], candy: ["candy"], soda: ["soda", "soft drinks", "beverages", "drinks"],
  water: ["water", "beverages", "drinks"], juice: ["juice", "beverages"], beer: ["beer", "wine", "alcohol"], wine: ["wine", "beer", "alcohol"],
  "ice cream": ["ice cream", "frozen"], pizza: ["pizza", "frozen"], flour: ["flour", "baking"], sugar: ["sugar", "baking"], spices: ["spices", "seasoning", "baking"],
  oil: ["oil", "cooking", "baking"], "peanut butter": ["peanut butter", "spreads", "jelly"], jam: ["jam", "jelly", "spreads"],
  "toilet paper": ["bath tissue", "paper", "household"], "paper towels": ["paper", "household"], soap: ["soap", "household", "cleaning"],
  detergent: ["detergent", "laundry", "cleaning"], shampoo: ["shampoo", "hair", "beauty", "personal care"], toothpaste: ["toothpaste", "oral care", "personal care"],
  medicine: ["pharmacy", "medicine", "health"], diapers: ["diapers", "baby"], "baby food": ["baby"], "pet food": ["pet"], "dog food": ["dog", "pet"], "cat food": ["cat", "pet"] };
const ROOM_RE = /restroom|bathroom|toilet|shower|bath\b|kitchen|bedroom|living room|dining|office|study|laundry|closet|pantry|garage|basement|attic|balcony|patio|garden|yard|exit|entrance|elevator|stairs|lobby|room|door|hall|corridor|lounge|desk|counter|checkout|reception|cafeteria|library|classroom|gym/i;
function goalOf(goal) {   // -> {words: what its sign would say, item: true for a product ("toilet paper" is not a restroom)}
  const g = goal.toLowerCase().replace(/^(the|some|a|an) /, "").replace(/ (aisle|section)$/, "").trim();
  const sec = Object.keys(SECTIONS).sort((a, b) => b.length - a.length).find((k) => g.includes(k));
  if (sec) return { words: [...new Set([g, ...SECTIONS[sec]])], item: true };
  const room = Object.keys(SIGN_WORDS).find((k) => g.includes(k));
  if (room) return { words: SIGN_WORDS[room], item: false };
  return { words: [g], item: !ROOM_RE.test(g) };
}
const signMatch = (text, words) => words.find((w) => new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}s?\\b`, "i").test(text) &&
  (!/^(wo)?men$/.test(w) || text.toLowerCase().split(/[^a-z']+/).filter(Boolean).every((x) => /^((wo)?men('?s)?|restrooms?|toilets?|wc|all|gender|and)$/.test(x))));   // "Men" on a door, not "Mens Shoes"
async function readSigns() {   // one camera frame -> signs (lines close together joined into one sign), each with where it is
  if (!NATIVE) return [];
  const lines = (await askNative({ type: "read" }, 4000)) || [];
  const groups = [];
  for (const l of lines) {
    const g = groups.find((x) => Math.abs(x.u - l.u) < 0.2 && Math.abs(x.v - l.v) < 0.2);
    if (g) { g.text += " " + l.text; g.lines.push(l); } else groups.push({ ...l, lines: [l] });
  }
  return groups.map((g) => { const p = g.lines.find((l) => l.x != null); return { text: g.text, bearing: g.bearing, x: p?.x, z: p?.z, d: p?.d, u: g.u, v: g.v, h: g.h }; });
}
function noteSigns(m, signs) {
  m.view = { at: Date.now(), signs: signs.map((sg) => ({ ...sg, hit: signMatch(sg.text, m.signWords) })) };   // for the viewfinder
  for (const sg of signs) {
    const hit = m.leave && NOT_EXIT.test(sg.text) ? null : signMatch(sg.text, m.signWords);   // "No exit", "Alarm will sound"
    if (!m.seenSigns.includes(sg.text)) { m.seenSigns.push(sg.text); log("sign:", JSON.stringify(sg.text), hit ? `matches "${hit}"` : "", sg.d ? `${sg.d.toFixed(1)} m` : "far"); }
    if (!hit) continue;
    const old = m.signs.find((o) => o.text === sg.text);
    if (!old) m.signs.push({ ...sg, hit });
    else if (old.x == null && sg.x != null) Object.assign(old, { x: sg.x, z: sg.z, d: sg.d });   // came close enough for LiDAR
  }
}
function signTarget(m) {   // the best matching sign not walked to yet: a spot 1 m short of it, or 4 m toward it when LiDAR can't reach it
  const s = m.signs.filter((x) => !m.visited.some((v) => v.sign === x.text)).sort((a, b) => (a.x == null) - (b.x == null) || (a.d || 99) - (b.d || 99))[0];
  if (!s) return null;
  const me = { x: N.pose.x, z: N.pose.z };
  let to;
  if (s.x != null) { const d = roomDist(me, s), k = d > 1 ? (d - 1) / d : 0; to = { x: me.x + (s.x - me.x) * k, z: me.z + (s.z - me.z) * k }; }
  else { const b = rad(s.bearing); to = { x: me.x + Math.sin(b) * 4, z: me.z - Math.cos(b) * 4 }; }
  return { id: "sign", kind: "sign", sign: s.text, far: s.x == null, x: to.x, z: to.z };
}
function goToSign(m, t, instead = false) {
  m.decisions.push({ x: N.pose.x, z: N.pose.z });
  if (m.leave) leaveMark(m, `sign "${t.sign}"`);
  m.history.push(`saw a sign "${t.sign}"; went toward it`);
  m.target = t;
  const dir = relDir(roomBearing(N.pose, t)), where = dir === "ahead" ? "straight ahead" : dir === "behind" ? "behind you" : `on your ${dir}`;
  say(`I see a sign: ${t.sign}. It's ${t.far ? "farther" : `about ${Math.max(1, Math.round(roomDist(N.pose, t) + 1))} meters`} ${where}. ${instead ? "Let's go there instead." : "Let's go there."}`);
  slamGo(m);
}
function atSign(m) {   // walked up to a matching sign
  const t = m.target;
  m.visited.push({ x: t.x, z: t.z, sign: t.sign });
  if (t.far) { const n = signTarget(m); if (n && !n.far) return goToSign(m, n); return slamMap(m, `walked toward a far sign "${t.sign}"`); }
  if (m.item) {   // grocery: the aisle is here; the camera finds the product on the shelf
    const item = m.item; S.mission = null; render();
    say(`This is the aisle with ${t.sign}. The ${item} should be here. Walk in slowly, and I'll look for it.`);
    findStart(item, true); S.find.aisle = t.sign;   // 08b: IN AISLE / CHECKING SHELF
    return;
  }
  const door = N.doors.find((d) => roomDist(d, t) < 2.5);   // a restroom sign is usually on or next to its door
  if (door) { m.target = { id: "door-" + door.id.slice(0, 6), kind: "door", x: door.x, z: door.z }; return slamGo(m); }
  slamMap(m, `reached the sign "${t.sign}"`);
}

// ---------- indoor_workflow: correlated camera actions and measured section routes ----------
const INDOOR_DEVICE = window.PIP_DEVICE_ID || localStorage.getItem("pip.indoor.device") || window.crypto?.randomUUID?.() || `${SESSION}-${Date.now()}`;
const INDOOR_YES = /^\W*(yes|yeah|yep|yup|sure|ok(?:ay)?|go(?: ahead)?|let'?s go|take me(?: there)?|start)(?:[,\s]+(?:please|let'?s go|go ahead))?[.!?\s]*$/i;
localStorage.setItem("pip.indoor.device", INDOOR_DEVICE);
let indoorTask = null;
function indoorContext() {
  return { version: !NATIVE || window.PIP_DEVICE_ID ? 1 : 0, device_id: INDOOR_DEVICE,
           frame_id: N.frame || null, tracking: Date.now() - (N.updatedAt || 0) < 1500 ? N.pose?.tracking || "unavailable" : "unavailable" };
}
function indoorMetadata(task) {
  return { session: SESSION, request_id: task.request_id, visit_id: task.visit_id,
           device_id: INDOOR_DEVICE, frame_id: N.frame || null, floor: task.floor, ctx: status() };
}
function indoorCancel(notify = true) {
  const task = indoorTask; indoorTask = null;
  if (!task) return;
  task.abort?.abort();
  if (S.walk?.indoor === task) S.walk = null;
  if (S.orient?.indoor === task) S.orient = null;
  if (notify) fetch(SERVER + "/indoor_workflow/events", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...indoorMetadata(task), event: "cancelled" }), signal: AbortSignal.timeout(5000),
  }).catch((e) => log("indoor cancellation:", e.message));
}
async function indoorDeliver(task, response) {
  if (indoorTask !== task) return;
  if (!response.ok) throw new Error(`indoor callback HTTP ${response.status}`);
  const result = await response.json();
  if (indoorTask !== task) return;
  if (result.status === "processing") return;
  if (!result.action && !["confirmation", "guiding"].includes(task.phase)) {
    indoorTask = null;
    if (S.orient?.indoor === task) S.orient = null;
  }
  return act(result);
}
async function indoorEvent(task, event, extra = {}) {
  if (indoorTask !== task) return;
  if (["blocked", "camera_unavailable", "no_path", "stale_map", "tracking_unavailable", "outside_map"].includes(event)) {
    task.phase = "terminal";
    if (S.walk?.indoor === task) S.walk = null;
  }
  try {
    const response = await fetch(SERVER + "/indoor_workflow/events", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...indoorMetadata(task), event, tracking: N.pose?.tracking || "unavailable", ...extra }),
      signal: AbortSignal.timeout(15000),
    });
    return await indoorDeliver(task, response);
  } catch (e) {
    if (indoorTask !== task) return;
    log("indoor event:", e.message); indoorCancel(false);
    say("Stop. I couldn't finish that indoor action."); render();
  }
}
async function indoorObservation() {
  if (NATIVE) {
    const observation = await askNative({ type: "indoorObservation" }, 8000);
    if (observation) return observation;
    if (N.pose) return null;
  }
  const blob = await frameBlob();
  if (!blob) return null;
  const image = await new Promise((resolve, reject) => {
    const reader = new FileReader(); reader.onload = () => resolve(String(reader.result).split(",")[1]);
    reader.onerror = reject; reader.readAsDataURL(blob);
  });
  return { observation_id: window.crypto?.randomUUID?.() || `${SESSION}-${Date.now()}`, captured_at: Date.now() / 1000, frame_id: N.frame || null,
           tracking: "unavailable", lines: [], image };
}
async function indoorCapture(task) {
  task.phase = "capture";
  await ensureCamera();
  if (indoorTask !== task) return;
  const views = [], start = Date.now();
  let turned = 0, last = N.heading, next = 0;
  if (task.mode === "around" && N.heading != null) {
    S.orient = { seen: 0, dirs: [], name: task.goal || task.label || "sections", indoor: task };
    say("Stand still. Turn slowly all the way around while I read the signs."); render();
  }
  while (indoorTask === task && Date.now() - start < 30000 &&
         (!views.length || (task.mode === "around" && N.heading != null && Math.abs(turned) < 330))) {
    if (N.heading != null && last != null) { turned += angleDiff(last, N.heading); last = N.heading; }
    if (S.orient?.indoor === task) spun(S.orient);
    if (views.length < 4 && Math.abs(turned) >= next) {
      const view = await indoorObservation();
      if (indoorTask !== task) return;
      if (view) views.push(view);
      next += 90;
      if (task.mode !== "around" || N.heading == null) break;
    }
    await new Promise((r) => setTimeout(r, 150));
  }
  if (indoorTask !== task) return;
  if (S.orient?.indoor === task) S.orient = null;
  if (!views.length) return indoorEvent(task, "camera_unavailable");
  if (views.some((v) => v.frame_id !== task.frame_id)) return indoorEvent(task, "stale_map");
  task.abort = new AbortController();
  const deadline = setTimeout(() => task.abort.abort(), 180000); // Four bounded vision calls plus upload.
  const body = new FormData();
  views.forEach((view, i) => { body.append("images", b64ToBlob(view.image), `view${i}.jpg`); delete view.image; });
  body.append("metadata", JSON.stringify({ ...indoorMetadata(task), views, rotation_degrees: Math.abs(turned) }));
  task.phase = "processing"; S.looking = Date.now(); render();
  try {
    await indoorDeliver(task, await fetch(SERVER + "/indoor_workflow/observations", { method: "POST", body, signal: task.abort.signal }));
  } finally { clearTimeout(deadline); S.looking = null; render(); }
}
async function indoorPath(task, approach = false) {
  if (!NATIVE || indoorContext().tracking !== "ok" || !slamReady() || N.frame !== task.anchor.frame_id) return null;
  const target = approach ? task.anchor : task.route?.at(-1);
  if (!target) return null;
  return askNative({ type: "indoorPath", frame_id: task.anchor.frame_id, x: target.x, z: target.z,
                     approach, viewpoint: task.anchor.kind === "viewpoint" }, 8000);
}
const indoorPathValid = (path) => Array.isArray(path) && path.length > 0 && path.every((p) => Number.isFinite(p.x) && Number.isFinite(p.z));
async function indoorPrepare(task) {
  if (task.anchor.device_id !== INDOOR_DEVICE || !NATIVE) return indoorEvent(task, "stale_map");
  if (task.restore && N.frame !== task.anchor.frame_id) {
    const loaded = await askNative({ type: "loadMap", frame: task.anchor.frame_id }, 4000);
    if (indoorTask !== task) return;
    if (!loaded) return indoorEvent(task, "stale_map");
    say("Stand still and point the phone around slowly so I can recognize the room.");
    let stable = null;
    for (const end = Date.now() + 25000; Date.now() < end && indoorTask === task;) {
      if (N.frame === task.anchor.frame_id && slamReady()) { stable ??= Date.now(); if (Date.now() - stable >= 1000) break; }
      else stable = null;
      await new Promise((r) => setTimeout(r, 100));
    }
  }
  if (indoorTask !== task) return;
  if (N.frame !== task.anchor.frame_id) return indoorEvent(task, "stale_map");
  const route = await indoorPath(task, true);
  if (indoorTask !== task) return;
  if (!indoorPathValid(route)) return indoorEvent(task, "no_path");
  task.route = route; task.phase = "confirmation";
  const distance = route.slice(1).reduce((sum, p, i) => sum + roomDist(route[i], p), 0);
  return indoorEvent(task, "route_ready", { distance_m: distance });
}
async function indoorAction(action) {
  if (action.operation === "context_changed") {
    indoorCancel(false);
    if (action.reset_map && NATIVE) await askNative({ type: "resetAR" }, 3000);
    return;
  }
  if (action.operation === "guiding") {
    const task = indoorTask;
    if (!task || task.request_id !== action.request_id || task.phase !== "confirmation") return;
    const route = await indoorPath(task);
    if (indoorTask !== task) return;
    if (!indoorPathValid(route)) return indoorEvent(task, "no_path");
    task.phase = "guiding"; task.route = route; task.operation = "guiding";
    S.find = null; S.route = null; S.back = null; S.mission = null; S.trip = null; S.preview = null; S.paused = false;
    S.walk = { indoor: task, same: true, name: task.label, pts: route.map((ar) => ({ ar })), i: 0,
               from: { ar: { x: N.pose.x, z: N.pose.z } }, phase: "go", onCourse: true, saidAt: 0, checkedAt: Date.now() };
    render(); return;
  }
  indoorCancel(false);
  const task = indoorTask = { ...action };
  if (S.walk || S.mission || S.back || S.find || S.learning) {
    S.walk = null; S.mission = null; S.back = null; S.find = null; S.learning = null; S.trip = null;
  }
  try {
    if (action.operation === "capture" || action.operation === "verify") await indoorCapture(task);
    else if (action.operation === "prepare_route") await indoorPrepare(task);
    else if (action.operation === "save_map") {
      const ok = N.frame === task.frame_id && await askNative({ type: "saveMap" }, 15000);
      if (indoorTask === task) await indoorEvent(task, "map_saved", { ok: Boolean(ok) });
    }
  } catch (e) {
    if (indoorTask !== task) return;
    log("indoor action:", e.message); indoorCancel();
    say("I couldn't complete the indoor observation. Please try again.");
  } finally { render(); }
}
async function indoorRepath(w) {
  if (w.checking) return;
  w.checking = true;
  const path = await indoorPath(w.indoor);
  if (S.walk !== w || indoorTask !== w.indoor) return;
  w.checking = false;
  if (!indoorPathValid(path)) { S.walk = null; return indoorEvent(w.indoor, "no_path"); }
  w.pts = path.map((ar) => ({ ar })); w.i = 0; w.checkedAt = Date.now();
}
async function indoorDecisionScan(w) {
  const task = w.indoor;
  w.observing = true; say("Stop for a moment. I'll read the signs here.");
  task.abort = new AbortController();
  const deadline = setTimeout(() => task.abort.abort(), 180000);
  try {
    const view = await indoorObservation();
    if (S.walk !== w || indoorTask !== task || !view) return;
    const body = new FormData();
    body.append("images", b64ToBlob(view.image), "decision.jpg"); delete view.image;
    body.append("metadata", JSON.stringify({ ...indoorMetadata(task), decision: true, views: [view] }));
    await indoorDeliver(task, await fetch(SERVER + "/indoor_workflow/observations", { method: "POST", body, signal: task.abort.signal }));
  } catch (e) {
    if (indoorTask === task) log("indoor decision observation:", e.message);
  } finally {
    clearTimeout(deadline); w.observing = false; w.checkedAt = 0;
  }
}
function indoorWalkCue(w) {
  const task = w.indoor;
  if (indoorTask !== task) { S.walk = null; return null; }
  if (indoorContext().tracking !== "ok" || !slamReady() || N.frame !== task.anchor.frame_id) {
    w.l = null; w.checkedAt = 0; w.lostSince ??= Date.now();
    if (!w.lostSaid) { w.lostSaid = true; say("Stop. Hold the phone steady and point it around slowly."); }
    if (N.frame !== task.anchor.frame_id) { S.walk = null; indoorEvent(task, "stale_map"); }
    return null;
  }
  w.lostSince = null; w.lostSaid = false;
  if (N.depth?.ahead < 0.7 && w.onCourse) { S.walk = null; say("Stop. Something is in front of you.", { urgent: true }); indoorEvent(task, "blocked"); return null; }
  if (w.observing) return null;
  if (w.checking || Date.now() - w.checkedAt > 1500) { indoorRepath(w); return null; }
  while (w.i < w.pts.length - 1 && roomDist(N.pose, w.pts[w.i].ar) < 0.12) {
    const point = w.pts[w.i].ar, before = w.pts[Math.max(0, w.i - 5)].ar, after = w.pts[Math.min(w.pts.length - 1, w.i + 5)].ar;
    // Read at substantial bends over ~0.5 m, not each 10 cm grid step; nearby repeats share one observation.
    const corner = w.i > 0 && Math.abs(angleDiff(roomBearing(before, point), roomBearing(point, after))) >= 60;
    task.decisions ??= [];
    if (corner && !task.decisions.some((p) => roomDist(p, point) < 1)) {
      task.decisions.push(point); indoorDecisionScan(w); return null;
    }
    w.i++;
  }
  const target = w.pts[w.i].ar;
  const d = roomDist(N.pose, target), off = angleDiff(N.heading, roomBearing(N.pose, target));
  w.l = { d, off, via: "ar", r: 0.12 }; w.onCourse = Math.abs(off) <= ON_COURSE; w.phase = w.onCourse ? "go" : "turn";
  if (w.i === w.pts.length - 1 && d < 0.2) {
    S.walk = null; say("Stop. I'll verify the section here."); indoorEvent(task, "approach_reached"); return null;
  }
  if (Date.now() - w.saidAt > 6000) {
    w.saidAt = Date.now();
    const next = nextTurn(w, w.l);
    say(w.onCourse ? `Walk ${stepsWords(next.d)}.` : turnWords(off));
  }
  return w.onCourse ? ON_TICK : offTap(off, ON_COURSE);
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
function spun(ring) {   // the 30-degree block the phone faces now counts as seen
  if (N.heading == null) return;
  const b = Math.floor(N.heading / 30) % 12;
  if (!ring.dirs.includes(b)) { ring.dirs = [...ring.dirs, b]; ring.seen = ring.dirs.length; }
}
async function slamMap(m, why) {
  if (m.leave && why !== "start" && !/came back/.test(why)) {      // a decision point: out yet? closer than at the mark?
    const c = await leaveCheck(m);
    if (S.mission !== m || c.verdict === "done") return;
    if (c.verdict === "back") return slamBacktrack(m, c.why);
    if (await hopCheck(m, why)) return;                              // through a door, or somewhere new: the brain picks the next step
  }
  if (m.mapping) return;
  m.mapping = true;
  try { await slamSpin(m, why); } finally { m.mapping = false; }
}
async function slamSpin(m, why) {
  m.phase = "map"; m.phaseAt = Date.now(); render();
  say(m.decisions.length || S.trip?.hops ? "Let me map this spot. Turn slowly all the way around." : "I'll map the room first. Turn slowly all the way around.");
  let turned = 0, last = N.heading, readAt = -999, step = -1; const t0 = Date.now(), reads = [];
  const ring = S.orient = { seen: 0, dirs: [], name: m.room, mission: true };   // the screen shows the 360 ring (08c)
  const views = m.spinViews = []; m.nextViewAt = 0;
  await new Promise((r) => setTimeout(r, 1500));
  while (S.mission === m && Math.abs(turned) < 330 && Date.now() - t0 < 30000) {
    turned += ((N.heading - last + 540) % 360) - 180; last = N.heading;
    spun(ring); if (m.leave) leaveSample(m);
    if (Math.abs(turned) >= (m.nextViewAt ?? 0) && views.length < 8) {   // the camera's turn to look: a photo each ~45 degrees
      m.nextViewAt = (m.nextViewAt ?? 0) + 45; const h = N.heading;
      frameBlob().then((b) => { if (b) views.push({ b, h }); });
    }
    if (Math.floor(Math.abs(turned) / 30) > step) { step = Math.floor(Math.abs(turned) / 30); note(step); }   // every 30 degrees, the next note up
    if (Math.abs(turned) - readAt >= 30) { readAt = Math.abs(turned); reads.push(readSigns().then((sg) => S.mission === m && noteSigns(m, sg))); }   // signs every 30 degrees
    await new Promise((r) => setTimeout(r, 100));
  }
  if (S.orient === ring) S.orient = null;
  if (S.mission !== m) return;
  doneChime(); say("Okay, stop.", { urgent: true });
  await Promise.race([Promise.all(reads), new Promise((r) => setTimeout(r, 1500))]);
  if (m.leave) {
    if (await leaveOutside(m, true) || S.mission !== m) return;    // already outside?
    if (why === "start") {                                          // where this hop starts (to tell when we've left it)
      const c = await roomNow(m);
      if (S.mission !== m) return;
      m.leave.from = c?.room && c.room !== "unknown" ? c.room : m.leave.from || null;
      if (c?.inside) return hopDone(m, `reached the ${m.leave.room}`, c);
    }
  } else await slamCheckRoom(m);                                    // are we already there?
  if (S.mission !== m || m.done) return;
  const st = signTarget(m);
  if (st) return goToSign(m, st);                                   // a sign that says where the goal is beats guessing
  slamDecide(m, why);
}
async function slamCheckRoom(m) {
  const blob = await frameBlob(); if (!blob) return;
  const fd = new FormData(); fd.append("image", blob, "f.jpg"); fd.append("room", m.room);
  try {
    const c = await (await fetch(SERVER + "/check_room", { method: "POST", body: fd })).json();
    log("inside", m.room, "?", JSON.stringify(c));
    if (c.inside) { m.done = true; say(`You're in the ${m.room}.`); S.mission = null; S.trip = null; render(); }
    else if (c.room && c.room !== "unknown") { if (m.place && m.place !== c.room) say(`You've left the ${m.place}. This is a ${c.room}.`); m.place = c.room; }
  } catch (e) { log("room check failed", e); }
}
// Who decides where to go: the camera first (the vision model looks at the photos from the spin and picks the way,
// e.g. a doorway with daylight), the floor map makes it exact (a real door or opening that way, its distance, a path)
// and handles going back; GPS direction only breaks ties when the camera can't tell.
async function visionPick(m) {
  const views = (m.spinViews || []).slice(0, 8); m.spinViews = null;
  if (views.length < 3) return null;
  const fd = new FormData(); views.forEach((v, i) => fd.append("images", v.b, `v${i}.jpg`));
  const L = m.leave;
  fd.append("goal", L ? `the way out of this room${L.room ? `, toward the ${L.room}` : ", toward the building's exit"}` : m.room);
  fd.append("history", JSON.stringify(m.history.slice(-8)));
  try {
    const r = await (await fetch(SERVER + "/panorama", { method: "POST", body: fd, signal: AbortSignal.timeout(25000) })).json();
    const p = r.plan || {};
    log("vision pick:", p.target || p.search || "-", "view", p.view, p.backtrack ? "BACKTRACK" : "", "|", p.why || "", `${r.ms}ms`);
    if (p.place && p.place !== "unknown") m.place = p.place;
    const v = Number.isInteger(p.view) ? views[p.view] : null;
    return { backtrack: Boolean(p.backtrack), what: String(p.target || p.search || "a way through"), why: p.why || "", heading: v ? v.h : null };
  } catch (e) { log("vision pick failed", e.message); return null; }
}
function goCandidate(m, c, why, reason, words) {
  m.decisions.push({ x: N.pose.x, z: N.pose.z });                  // a junction to come back to
  if (m.leave) leaveMark(m, `${c.kind} ${c.distance_m} m ${c.direction}`);
  m.history.push(`${why}: in ${m.place || "?"}; went for ${c.kind} ${c.distance_m} m ${c.direction} (${reason})`);
  m.target = c; m.legSaid = null; say(words);
  slamGo(m);
}
async function slamDecide(m, why) {
  m.phase = "decide"; render();
  const cands = slamCandidates(m), seen = await visionPick(m);
  if (S.mission !== m) return;
  if (seen?.backtrack && m.decisions.length) return slamBacktrack(m, seen.why || "the camera sees no way on from here");
  if (seen?.heading != null) {
    const fresh = cands.filter((c) => !c.visited && Math.abs(angleDiff(seen.heading, roomBearing(N.pose, c))) < 35)
                       .sort((a, b) => (a.kind !== "door") - (b.kind !== "door") || a.distance_m - b.distance_m);
    const where = (c) => (c.direction === "ahead" ? "straight ahead" : c.direction === "behind" ? "behind you" : `on your ${c.direction}`);
    if (fresh[0]) {
      const c = fresh[0];
      return goCandidate(m, c, why, `camera: ${seen.what}`, `I can see ${seen.what}, about ${Math.max(1, Math.round(c.distance_m))} meters ${where(c)}. Let's go there.`);
    }
    // the camera sees a way the map hasn't reached yet: head 3 m that way, then look again
    const b = rad(seen.heading), to = { x: N.pose.x + Math.sin(b) * 3, z: N.pose.z - Math.cos(b) * 3 };
    const c = { id: "seen", kind: "opening", x: to.x, z: to.z, distance_m: 3, direction: relDir(seen.heading) };
    return goCandidate(m, c, why, `camera: ${seen.what}, past the map`, `I can see ${seen.what} ${where(c)}. Let's head that way.`);
  }
  if (!cands.length) return slamBacktrack(m, "I can't see any way through from here");
  const send = cands.map(({ x, z, ...c }) => (m.leave ? { ...c, toward: towardWords(m, { x, z }) } : c));
  const r = await post("/decide_slam", { goal: m.room, candidates: send, memory: m.history.slice(-6), place: m.place || "unknown", leaving: Boolean(m.leave) });
  if (S.mission !== m) return;
  log("slam decide:", r.choice, r.why, JSON.stringify(send.map((c) => `${c.id} ${c.distance_m}m ${c.direction}${c.toward ? ` (${c.toward})` : ""}${c.visited ? " V" : ""}`)));
  if (r.choice === "backtrack") return slamBacktrack(m, r.why);
  goCandidate(m, cands.find((x) => x.id === r.choice), why, r.why, r.say);
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
// Say each leg, like a route: "Turn around, to 6 o'clock." -> buzz when you face it -> "Walk 3 meters, about 4 steps."
// Trip 15:30: "There's a door about 3 meters behind you" and then only ticks; the user didn't know to turn around.
function slamTalk(m, d) {
  const nx = slamNext(m); if (!nx || N.heading == null) return;
  const off = angleDiff(N.heading, roomBearing(N.pose, nx)), t = Date.now();
  if (Math.abs(off) > ON_COURSE + 5) {
    if (m.legSaid !== "turn" || t - (m.legAt || 0) > 6000) { m.legSaid = "turn"; m.legAt = t; mSay(turnWords(off), 0); }
  } else if (Math.abs(off) < ON_COURSE && m.legSaid !== "walk") {
    if (m.legSaid === "turn") turnDone();
    m.legSaid = "walk"; m.legAt = t; mSay(`Walk ${stepsWords(Math.min(d, roomDist(N.pose, nx) + 0.5))}.`, 0);
  } else if (m.legSaid === "walk" && t - (m.legAt || 0) > 8000 && d > 1.5) { m.legAt = t; mSay(`About ${Math.round(d)} meters to go.`, 7000); }
}
function slamNext(m) {   // next waypoint at least 0.5 m away
  if (!m.path) return null;
  while (m.path.length > 1 && roomDist(N.pose, m.path[0]) < 0.5) { m.path.shift(); m.legSaid = null; }
  return m.path[0];
}
function slamStep(m) {
  if (!slamReady()) { if (Date.now() - (m.trackSaidAt || 0) > 10000) { m.trackSaidAt = Date.now(); say("I'm losing track. Hold the phone steady and point it around the room."); } return; }
  const t = Date.now();
  if (m.leave) { leaveSample(m); if (m.phase === "go" || m.phase === "through") leaveOutside(m); }
  if (m.phase === "go" && m.target) {
    const d = roomDist(N.pose, m.target);
    if (t - (m.readAt || 0) > 2500) {   // signs ahead while walking (an aisle sign, "Restrooms ->")
      m.readAt = t;
      readSigns().then((sg) => {
        if (S.mission !== m || m.phase !== "go") return;
        noteSigns(m, sg);
        const n = signTarget(m);
        if (n && !n.far && (m.target.kind !== "sign" || m.target.far)) goToSign(m, n, m.target.kind !== "sign");
      });
    }
    if (t - (m.obstacleCheckAt || 0) > 1500) obstacleCheck(m);
    if (t - m.repathAt > 3000) slamRepath(m);
    if (d < 0.9) {
      if (m.target.kind === "sign") return atSign(m);
      m.visited.push({ x: m.target.x, z: m.target.z });
      if (m.target.kind === "door") { m.doorPos = { x: m.target.x, z: m.target.z }; doorStep(m); }
      else slamMap(m, `reached an opening`);
      return;
    }
    slamTalk(m, d);
  }
  if (m.phase === "through" && m.doorPos && roomDist(N.pose, m.doorPos) > 1.5) { m.doorPos = null; slamMap(m, "walked through a door"); }
  if (m.phase === "through" && t - m.phaseAt > 15000) slamMap(m, "should be through the door");
  if (m.phase === "slamback" && m.backTo && roomDist(N.pose, m.backTo) < 0.7) { m.backTo = null; slamMap(m, "came back to a junction"); }
}
function slamBacktrack(m, why) {
  m.backtracks = (m.backtracks || 0) + 1;
  const back = m.decisions.pop();
  if (!back || m.backtracks > 4) return giveUp(m);
  m.leave?.marks.pop();                                             // going back to that mark; a new one is dropped there
  m.history.push(`dead end: ${why}`);
  m.phase = "slamback"; m.backTo = back; m.target = { ...back, kind: "junction", id: "back" }; render();
  say(`${why[0].toUpperCase() + why.slice(1)}. Let's go back, about ${Math.max(1, Math.round(roomDist(N.pose, back)))} meters.`);
  askNative({ type: "path", x: back.x, z: back.z }).then((pts) => { if (S.mission === m) m.path = pts || [back]; });
}

// ---------- TRIPS, ONE ROOM AT A TIME ----------
// The long-term plan knows where you're going; a hop gets you out of where you are, into the next space. Turn around
// once (map the room, read signs) -> pick a real door or opening -> drop a mark (room position + GPS) -> walk there ->
// at the next decision point, measure: closer than at the mark? A way that led away is walked back to its mark and the
// next one is tried. Progress is judged only at decision points, never mid-walk (the numbers jump around while you
// move), and a matching sign beats the measurements. A hop is done when you're through a door, in a different kind of
// space, in the goal room, or outside. Then the brain gets a report of what was measured and picks the next step: another
// hop, the last meters to the goal room, the walking route once outside, or "you're there". The map, the marks and
// what was tried carry over from hop to hop, so a dead end can still be walked back through the door it came from.
const EXIT_WORDS = ["exit", "way out", "lobby", "main entrance", "entrance", "ground floor", "street"];
const NOT_EXIT = /\b(no|not an?)\s+exit\b|\balarm\b|emergency\s+(exit\s+)?only|do not (use|enter)|staff only/i;
const MAX_HOPS = 10;
// goal: a room ("restroom", "the lobby") or "outside"; dest: {name, to: {lat, lon}, steps, placeId} for a place outside
function leaveStart({ goal = null, dest = null, outside = null } = {}) {
  const name = dest?.name || goal || "outside";
  const out = outside ?? (Boolean(dest?.to) || /\b(outside|outdoors|exit|way out|street)\b/i.test(name));
  const same = (a, b) => String(a).toLowerCase().replace(/^the /, "") === String(b).toLowerCase().replace(/^the /, "");
  const fresh = !S.trip || !(S.trip.awaiting || same(S.trip.goal, name));   // the brain's next hop after a report continues the trip
  if (fresh) S.trip = { goal: name, dest: dest?.to ? dest : null, outdoorGoal: out, out: false, hops: 0, rooms: [], carry: null };
  const T = S.trip, carried = T.carry?.leave || {};
  if (!fresh && !same(T.goal, name)) { T.goal = name; T.outdoorGoal = out; T.dest = dest?.to ? dest : T.dest; }   // re-planned the goal
  T.awaiting = false;
  if (T.outdoorGoal) ensureGPS();
  log("trip", T.goal, `hop ${T.hops + 1}`, T.outdoorGoal ? "(leaving the building)" : "(indoors)");
  if (fresh) say(T.dest ? `You're inside, so first I'll get you out, toward ${name}.` : out ? "Okay, let's find the way out." : `Okay, let's head for the ${name}, one room at a time.`);
  missionStart(T.goal, "door", [], { dest: T.dest, outside: T.outdoorGoal, room: T.outdoorGoal ? null : T.goal, marks: [], sideways: 0, ...carried,
                                     hop0: (carried.marks || []).length }, T.carry);
}
async function roomNow(m) {   // what kind of space this is, and for a room goal whether we're in it (the camera, one frame)
  const blob = await frameBlob(); if (!blob) return null;
  const fd = new FormData(); fd.append("image", blob, "f.jpg"); fd.append("room", m.leave.room || "outside");
  try {
    const c = await (await fetch(SERVER + "/check_room", { method: "POST", body: fd })).json();
    log("room now:", c.room, c.inside ? `(in the ${m.leave.room})` : "", c.looking_through_doorway ? "(through a doorway)" : "");
    if (c.room && c.room !== "unknown") m.place = c.room;
    return c;
  } catch { return null; }
}
async function hopCheck(m, why) {   // at a decision point: is this hop's objective done?
  const c = await roomNow(m);
  if (S.mission !== m) return true;
  const room = c?.room && c.room !== "unknown" ? c.room : null;
  if (/through/.test(why)) { hopDone(m, "went through a door", c); return true; }
  if (!m.leave.from && room && !c?.inside) { m.leave.from = room; return false; }   // didn't know where we started: now we do
  if (c?.inside || (room && room !== m.leave.from)) { hopDone(m, c?.inside ? `reached the ${m.leave.room}` : `came out of the ${m.leave.from || "room"}`, c); return true; }
  return false;
}
const aRoom = (r) => (/^[aeiou]/i.test(r) ? `an ${r}` : `a ${r}`);
function hopDone(m, how, c = null) {
  const T = S.trip, L = m.leave;
  const now = how === "outside" ? "outside" : c?.room && c.room !== "unknown" ? c.room : null;
  const p = leaveProgress(m, L.marks[L.hop0 || 0]);          // since this hop started
  S.mission = null; render(); doneChime();
  if (!T) return say(how === "outside" ? "We're outside." : "Okay, we're out.");
  if (how === "outside") S.outsideAt = Date.now();
  T.hops++; T.nowIn = now; T.out = how === "outside"; T.atGoal = Boolean(c?.inside); if (now) T.rooms.push(now);
  T.carry = { visited: m.visited, decisions: m.decisions, history: m.history, legs: m.legs, backtracks: m.backtracks, tried: m.tried,
              leave: { marks: L.marks, os: L.os, oc: L.oc, goalB: L.goalB } };
  say(how === "outside" ? "We're outside." : c?.inside ? `This looks like the ${L.room}.` :
      `We're ${/door/.test(how) ? "through the door" : "out of there"}${now ? `, in ${aRoom(now)}` : ""}.`);
  const facts = [`Step ${T.hops} of the trip to ${T.goal} is done: ${how}${now && now !== "outside" ? `, now in ${aRoom(now)}` : ""}.`,
    c?.inside ? `The camera agrees this is the ${L.room}.` : "",
    T.out ? `They're outside${S.fix ? ` (GPS ±${Math.round(S.fix.acc)} m)` : ""}.` : T.outdoorGoal ? "Still inside." : "",
    p ? `${Math.abs(Math.round(p.closer))} m ${p.closer >= 0 ? "closer to" : "farther from"} ${T.goal} than at the start of this step.` : "",
    `Spaces so far: ${T.rooms.join(", ") || "none named"}.`].filter(Boolean).join(" ");
  tripReport(T, facts);
}
// The brain decides what's next after each hop. If it can't be reached, do the obvious next step ourselves.
async function tripReport(T, facts) {
  if (T.hops >= MAX_HOPS) { S.trip = null; return say("We've been through a lot of rooms and I'm not sure we're getting there. Do you know the way, or is there someone to ask?"); }
  log("trip report:", facts);
  T.thinking = true; T.awaiting = true;
  try {
    const url = `${SERVER}/talk?session=${SESSION}&event=1&text=${encodeURIComponent(facts)}&ctx=${encodeURIComponent(JSON.stringify(status()))}`;
    const r = await (await fetch(url, { method: "POST", body: "", signal: AbortSignal.timeout(30000) })).json();
    T.thinking = false;
    if (S.trip !== T || S.mission || S.walk) return;          // they stopped it, or asked for something else meanwhile
    log("trip next:", (r.tools || []).map((t) => t.tool).join(",") || "-", r.action?.type || "(none)", r.say || "");
    if (!r.action) {
      const atGoal = T.atGoal || (T.out && !T.dest);
      if (!atGoal && !/\?\s*$/.test(r.say || "")) return tripOn(T, "the brain named no next step");   // it narrated instead of acting
      S.trip = null;                                           // at the goal, or a question for the user
    }
    return act({ ...r, heard: "" });
  } catch (e) {
    T.thinking = false; log("trip report failed", e);
    if (S.trip !== T || S.mission || S.walk) return;
    tripOn(T, "the brain didn't answer");
  }
}
function tripOn(T, why) {   // the obvious next step, when the brain can't or won't pick one
  log("trip: going on by myself,", why);
  if (T.out && T.dest) { S.trip = null; return gpsWalk(T.dest.name, T.dest.to, T.dest.steps, true, { go: true, placeId: T.dest.placeId }); }
  if (T.atGoal) { S.trip = null; return say(`You're in the ${T.goal}.`); }   // the camera already checked: right room, proof in view
  if (T.out) { S.trip = null; return; }
  leaveStart({ goal: T.goal, dest: T.dest, outside: T.outdoorGoal });
}
function leaveSample(m) {   // compass minus room heading, averaged as unit vectors: turns room directions into map directions
  if (N.compass == null || N.heading == null) return;
  const a = rad(N.compass - N.heading);
  m.leave.os = (m.leave.os || 0) + Math.sin(a); m.leave.oc = (m.leave.oc || 0) + Math.cos(a);
}
const leaveOffset = (m) => (m.leave.os || m.leave.oc ? (deg(Math.atan2(m.leave.os, m.leave.oc)) + 360) % 360 : null);
function leaveGoal(m) {   // which way the destination is from here (degrees from north), if GPS is good enough to tell
  const to = m.leave.dest?.to;
  if (!to || !S.fix || Date.now() - S.fix.t > 10000) return null;
  return dist(S.fix, to) > 2 * S.fix.acc ? bearing(S.fix, to) : null;
}
function leaveMark(m, what) {
  const L = m.leave, g = leaveGoal(m) ?? L.goalB ?? null;
  if (g != null) L.goalB = g;
  const gps = S.fix && Date.now() - S.fix.t < 10000 ? { ...S.fix } : null;
  L.marks.push({ what, x: N.pose?.x ?? null, z: N.pose?.z ?? null, gps, goalB: g, t: Date.now() });
  log("leave mark:", what, N.pose ? `room ${N.pose.x.toFixed(1)},${N.pose.z.toFixed(1)}` : "", gps ? `gps ±${Math.round(gps.acc)} m` : "no gps",
      g != null ? `goal at ${Math.round(g)}°` : "");
}
function leaveProgress(m, k = m.leave.marks.at(-1)) {   // meters closer to the destination since mark k (+ = closer), or null if it can't be measured
  const to = m.leave.dest?.to;
  if (!k || !to) return null;
  if (k.gps && gpsGood(25)) {   // GPS: only a change bigger than the two fixes' error counts
    const d0 = dist(k.gps, to), d1 = dist(S.fix, to);
    if (Math.abs(d0 - d1) > (k.gps.acc + S.fix.acc) / 2) return { closer: d0 - d1, via: "gps" };
  }
  const off = leaveOffset(m);
  if (k.x != null && N.pose && k.goalB != null && off != null) {   // the room map: meters walked toward the destination's direction
    const b = rad(k.goalB - off);
    return { closer: (N.pose.x - k.x) * Math.sin(b) - (N.pose.z - k.z) * Math.cos(b), via: "room" };
  }
  return null;
}
function towardWords(m, c) {   // does this door or opening point toward the destination?
  const off = leaveOffset(m), g = m.leave.goalB ?? leaveGoal(m);
  if (off == null || g == null || !N.pose) return null;
  const a = Math.abs(angleDiff(g, (roomBearing(N.pose, c) + off) % 360));
  return a < 50 ? "toward the destination" : a > 130 ? "away from the destination" : "sideways";
}
async function leaveCheck(m) {   // -> {verdict: "done" | "back" | "on", why}
  if (await leaveOutside(m, true)) return { verdict: "done" };
  if (S.mission !== m) return { verdict: "done" };
  const k = m.leave.marks.at(-1), p = leaveProgress(m);
  if (!k || !p) return { verdict: "on" };
  log("leave progress:", p.closer.toFixed(1), "m closer via", p.via, "since", k.what);
  const strict = (m.backtracks || 0) < 2 && !/^sign/.test(k.what);
  if (p.closer <= -3 && strict) {
    m.leave.sideways = 0;
    m.history.push(`the ${k.what} led ${Math.round(-p.closer)} m away from ${m.room}`);
    return { verdict: "back", why: `this way takes us away from ${m.room}` };
  }
  if (p.closer >= 2) { m.leave.sideways = 0; say(`Good, that's about ${Math.round(p.closer)} meters closer.`); }
  else if (strict && ++m.leave.sideways >= 3) {
    m.leave.sideways = 0;
    m.history.push(`three ways in a row didn't get closer to ${m.room}`);
    return { verdict: "back", why: "we're not getting any closer this way" };
  }
  return { verdict: "on" };
}
// Outside = GPS good for a few seconds AND the camera agrees (Wi-Fi location can look good indoors, and a view through a
// glass door looks like outside). force: ask the camera now (at a decision point) as long as GPS is fair.
async function leaveOutside(m, force = false) {
  const L = m.leave, t = Date.now();
  if (!L.outside) return false;                                     // a room goal: staying indoors
  L.goodSince = gpsGood(12) ? (L.goodSince ?? t) : null;
  if (force ? !gpsGood(30) : !(L.goodSince && t - L.goodSince > 4000)) return false;
  if (L.checking || t - (L.checkedAt || 0) < 8000) return false;
  L.checking = true; L.checkedAt = t;
  try {
    const blob = await frameBlob(); if (!blob) return false;
    const fd = new FormData(); fd.append("image", blob, "f.jpg"); fd.append("room", "outside");
    const c = await (await fetch(SERVER + "/check_room", { method: "POST", body: fd })).json();
    log("outside?", c.room, c.looking_through_doorway ? "(through a doorway)" : "", `gps ±${Math.round(S.fix?.acc ?? 0)} m`);
    if (S.mission !== m || String(c.room).toLowerCase() !== "outside" || c.looking_through_doorway) return false;
    hopDone(m, "outside", c);
    return true;
  } catch { return false; }
  finally { L.checking = false; }
}

// ---------- GO TO A ROOM: door -> line up -> walk -> through -> verify (done only on proof) ----------
const sideOf = (dx) => (dx < 0 ? "left" : "right");
// Walking toward a pinned spot in the room (ARKit): the same sounds as a route (a tick while you face it, taps on
// the side to turn toward). Works even when the landmark is out of the camera's view.
function walkToCue(target) {
  if (!N.pose || N.heading == null) return null;
  const off = ((roomBearing(N.pose, target) - N.heading + 540) % 360) - 180;
  return Math.abs(off) < ON_COURSE || roomDist(N.pose, target) < 0.8 ? ON_TICK : offTap(off, ON_COURSE);
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
// leave: this is one hop of a trip (see TRIPS); carry: what the earlier hops mapped, tried and remembered
function missionStart(room, via, proof, leave = null, carry = null) {
  ensureCamera();
  S.find = null; S.route = null; S.back = null; S.walk = null; S.walkTok = null; S.preview = null;
  const m = S.mission = { room, via: via || "door", proof: proof || ["toilet", "sink"], phase: "plan", phaseAt: Date.now(),
                door: null, doorAt: 0, proofHit: null, proofAt: 0, saidAt: 0, lastSay: "", tries: 0, history: [...(carry?.history || [])],
                planning: false, leave, legs: carry?.legs, backtracks: carry?.backtracks, tried: carry?.tried };
  const goal = leave ? (leave.room ? goalOf(leave.room) : { words: EXIT_WORDS, item: false }) : goalOf(room);
  m.signWords = goal.words; m.signs = []; m.seenSigns = []; m.item = goal.item ? room : null;   // "cereal" is an item, not a room
  log("mission", room, "reads signs for:", m.signWords.join(", "));
  if (slamReady()) { m.slam = true; m.visited = carry?.visited || []; m.decisions = carry?.decisions || []; return slamMap(m, "start"); }
  lookAround("start");
}
// Deduction step: the user turns slowly in place while Pip grabs ~8 views; the vision model describes each
// and the brain picks the most promising direction (doorway, hallway, a door with a sign...).
function giveUp(m) {
  say(m.leave ? "I'm stuck finding the way out. Do you know which way the exit is, or is there someone nearby to ask?"
              : `I'm stuck finding the ${m.room}. Can you tell me anything about where it is, or should I learn the way with you?`);
  S.mission = null; S.trip = null; render();
}
async function lookAround(why) {
  const m = S.mission; if (!m || m.planning) return;
  m.looks = (m.looks || 0) + 1;
  if (m.looks > 6 || (m.backtracks || 0) >= 3) return giveUp(m);
  if (m.leave && why !== "start" && !/came back/.test(why)) {      // a decision point: out yet? closer than at the mark?
    m.planning = true; const c = await leaveCheck(m); m.planning = false;
    if (S.mission !== m || c.verdict === "done") return;
    if (c.verdict === "back") return backtrack(m, c.why);
    if (/through/.test(why)) return hopCheck(m, why);               // through a door: this hop is done
  }
  m.planning = true; m.phase = "sweep"; m.phaseAt = Date.now(); render();
  await ensureCamera();
  say(m.history.length ? "Let me look around here. Turn slowly to your right, all the way around." :
                         "I'll take a look around first. Turn slowly to your right, all the way around.");
  await new Promise((r) => setTimeout(r, 1800));             // let the instruction land
  const views = [], headings = [];
  if (NATIVE && N.heading != null) {
    // Measured spin: grab a view each time the phone has turned another ~45 degrees (up to 25 s).
    let turned = 0, last = N.heading, nextAt = 0, t0 = Date.now();
    const ring = S.orient = { seen: 0, dirs: [], name: m.room, mission: true };   // the screen shows the 360 ring (08c)
    while (S.mission && views.length < 8 && Date.now() - t0 < 25000) {
      turned += ((N.heading - last + 540) % 360) - 180; last = N.heading; spun(ring);
      if (Math.abs(turned) >= nextAt) { const b = await frameBlob(); if (b) { views.push(b); headings.push(N.heading); note(Math.round((views.length - 1) * 11 / 7)); } nextAt += 45; }
      await new Promise((r) => setTimeout(r, 100));
    }
    if (S.orient === ring) S.orient = null;
  } else {
    for (let i = 0; i < 8 && S.mission; i++) {                 // ~11 s slow spin, timed
      const b = await frameBlob(); if (b) { views.push(b); note(Math.round((views.length - 1) * 11 / 7)); }
      await new Promise((r) => setTimeout(r, 1400));
    }
  }
  if (!S.mission) return;
  doneChime(); say("Okay, stop there. Let me think.", { urgent: true });
  m.thinking = true;
  try {
    const fd = new FormData(); views.forEach((b, i) => fd.append("images", b, `v${i}.jpg`));
    fd.append("goal", m.leave ? `the way out of this building${m.leave.dest ? `, toward ${m.room}` : ""}` : m.room);
    fd.append("history", JSON.stringify(m.history.slice(-8)));
    const r = await (await fetch(SERVER + "/panorama", { method: "POST", body: fd })).json();
    if (!S.mission) return;
    const p = r.plan || {};
    log("deduce:", p.why || "", "->", JSON.stringify(p), `${r.ms}ms`);
    const place = p.place || "unknown";
    if (!m.leave && place !== "unknown" && m.place && place !== m.place) {
      say(place === "hallway" ? `We're out of the ${m.place}, you're in a hallway now.` : `You've left the ${m.place}. This looks like a ${place}.`);
    }
    m.history.push(`${why}: now in ${place}${m.place ? ` (was ${m.place})` : ""}; looked around (${(r.views || []).map((v) => v.facing || "?").join(", ")}); chose ${p.target || p.search} because ${p.why || "?"}`);
    if (place !== "unknown") m.place = place;
    if (m.leave && place !== "unknown") {                          // a hop is done once we're somewhere new
      if (!m.leave.from) m.leave.from = place;
      else if (place !== m.leave.from) return hopDone(m, `came out of the ${m.leave.from}`, { room: place });
    }
    if (p.reached && m.leave) {                                    // at the goal: the brain sends go_to to confirm; outside only when measured
      if (m.leave.room) return hopDone(m, `reached the ${m.leave.room}`, { room: place, inside: true });
      if (await leaveOutside(m, true)) return;
      p.reached = false; p.search = "door"; p.target = p.target || "the door out";
    }
    if (p.reached) { m.phase = "verify"; m.phaseAt = Date.now(); say(p.say || `I think this is the ${m.room}. Let me check.`); return; }
    if (p.backtrack) { m.planning = false; return backtrack(m, p.why || "nothing here leads on"); }
    const nameOf = (x) => String(typeof x === "string" ? x : x?.id || x?.kind || "").toLowerCase();   // tried: words, or door objects (LiDAR)
    if ((m.tried || []).some((x) => x && p.target && nameOf(x) === String(p.target).toLowerCase()) && /came back/.test(why)) {
      m.planning = false; return backtrack(m, "I'm going in circles here");
    }
    m.via = (p.search || "door").toLowerCase(); m.target = p.target || m.via;
    if (m.leave) leaveMark(m, m.target);
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
  finally { m.thinking = false; if (S.mission) S.mission.planning = false; }
}
// While walking toward a landmark: if something is actually in the way, stop and re-decide.
async function obstacleCheck(m) {
  m.obstacleCheckAt = Date.now();
  if (N.depth) {                                       // LiDAR: real distances, no guessing
    const targetClose = m.pin && N.pose && roomDist(N.pose, m.pin) < 1.2;
    if (N.depth.ahead < 0.7 && !targetClose && !m.doorBusy) {   // trip 15:31: a second check raced the door check
      // Trip 15:04: ARKit missed the exit door, so it was an "opening"; LiDAR saw the closed door at 0.3 m and Pip said
      // "more room on your right", steering the user around the door they had to open. Ask the camera first.
      if (!m.doorAsked && !m.doorBusy) {
        m.doorAsked = true; m.doorBusy = true;
        try {
          const d = await readDoor();
          if (S.mission !== m) return;
          if (d && d.door !== "none") {
            log("blocked by a door:", d.door, d.type);
            if (m.slam && N.pose) m.doorPos = { x: N.pose.x, z: N.pose.z };
            m.doorBusy = false;
            return doorStep(m);
          }
        } catch (e) { log("door check failed", e.message); }
        finally { m.doorBusy = false; }
      }
      const side = N.depth.left > N.depth.right ? "left" : "right"; obstacleSeen();
      say(`Stop. Something's ${N.depth.ahead.toFixed(1)} meters ahead. There's more room on your ${side}.`, { urgent: true });
      m.blockedCount = (m.blockedCount || 0) + 1;
      if (m.blockedCount >= 3) {   // LiDAR phone: map this spot again (not the camera look-around, that's for phones without it)
        m.blockedCount = 0; m.doorAsked = false;
        const why = `blocked on the way to the ${m.target?.kind || m.target || m.via}`;
        if (m.slam) { if (m.target?.x != null) m.visited.push({ x: m.target.x, z: m.target.z }); return slamMap(m, why); }
        lookAround(why);
      }
    } else { m.blockedCount = 0; m.doorAsked = false; }
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
  } catch (e) { log("obstacle check failed", e); }
}

// ---------- DOORS: what kind, where the handle is, push or pull; LiDAR says when it's open ----------
// The vision model reads the door once (and again only when the measurements can't tell); Pip's words come from its
// fields, never from its prose. A closed door is about an arm's length away; once it opens, LiDAR suddenly sees meters
// past it, so "it's open" is a measurement, said at once, not a guess every few seconds. LiDAR reads through glass, so
// glass and automatic doors keep the camera check. A door that won't open is given up on, and another way is tried.
const HANDLE_LABELS = ["door handle", "door knob", "lever handle", "push bar"];
const doorHow = (d) => /pull/.test(d?.opens || "") ? "Pull it toward you, step back as it swings, then walk around its edge."
  : /push/.test(d?.opens || "") ? "Push it open, and keep your hand on it as you walk through."
  : "Try pushing first. If it doesn't move, pull.";
const handSide = (d) => (d?.handle === "left" || d?.handle === "right" ? d.handle : null);
async function readDoor() {   // one look by the vision model -> its fields, or null
  const blob = lastFrame || (await frameBlob()); if (!blob) return null;
  const fd = new FormData(); fd.append("image", blob, "f.jpg");
  const d = await (await fetch(SERVER + "/door", { method: "POST", body: fd })).json();
  log("door:", JSON.stringify(d), N.depth ? `lidar ${N.depth.ahead.toFixed(2)} m` : "");
  return d;
}
function doorWaitStart(m) {   // now wait for it to open; LiDAR counts only for an opaque door right in front
  const ahead = N.depth?.ahead, info = m.handleInfo || {};
  m.dr = { info, since: Date.now(), checkedAt: Date.now(), openSince: 0, nudgeAt: 0, nudges: 0,
           closedAt: ahead ?? 0, lidar: ahead != null && ahead < 1.5 && !["automatic", "revolving"].includes(info.type) };
  m.phase = "door"; m.phaseAt = Date.now(); render();
}
function doorThrough(m, text) {
  doneChime(); say(text || "It's open. Walk through slowly, about two steps.");
  m.dr = null; m.phase = "through"; m.phaseAt = Date.now();
  if (m.slam && !m.doorPos && N.pose) m.doorPos = { x: N.pose.x, z: N.pose.z };
  render();
}
function doorBlocked(m, why) {   // locked, too heavy, or not a door after all: try another way
  m.dr = null; m.history.push(`a door ${why}; don't try it again`);
  if (m.slam) { if (m.target) m.visited.push({ x: m.target.x, z: m.target.z }); return slamMap(m, `a door ${why}`); }
  m.tried = [...(m.tried || []), m.target || m.via];
  return lookAround(`a door ${why}`);
}
async function doorWait(m) {   // every frame while the door is closed
  const dr = m.dr || (doorWaitStart(m), m.dr), t = Date.now();
  if (dr.lidar && N.depth && N.depth.ahead > Math.max(1.8, dr.closedAt + 1.0)) {   // it sees past the door now
    dr.openSince ||= t;
    if (t - dr.openSince > 600) return doorThrough(m);
  } else dr.openSince = 0;
  const waited = t - dr.since;
  if (waited > 45000) { say("This door isn't opening. Let's try another way."); return doorBlocked(m, "wouldn't open"); }
  if (t - dr.checkedAt > (dr.lidar ? 8000 : 4000) && !m.doorBusy) {   // the camera, as a check on LiDAR or instead of it
    dr.checkedAt = t; m.doorBusy = true;
    try {
      const d = await readDoor();
      if (S.mission !== m || m.phase !== "door" || !d) return;
      if (d.door === "open" || d.door === "ajar") return doorThrough(m, d.door === "ajar" ? "It's open a little. Open it the rest of the way and walk through slowly." : null);
    } catch {} finally { m.doorBusy = false; }
  }
  if (t - (dr.nudgeAt || dr.since) > 12000 && !speaking()) {   // a short reminder, never a stream of them
    dr.nudgeAt = t; dr.nudges++;
    const side = handSide(dr.info);
    say(waited > 20000 && !dr.saidLocked ? (dr.saidLocked = true, "If it's locked, tell me, and I'll find another way.")
        : dr.nudges % 2 && side ? `It's still closed. The handle is on your ${side}.` : `It's still closed. ${doorHow(dr.info)}`);
  }
}

// Guide the camera (and the hand behind it) onto the handle, then say where to reach and how it opens.
async function handleStep(m, blob) {
  const fd = new FormData(); fd.append("image", blob, "f.jpg"); fd.append("labels", HANDLE_LABELS.join(","));
  const r = await (await fetch(SERVER + "/scan", { method: "POST", body: fd })).json();
  if (S.mission !== m || m.phase !== "handle") return;
  const t = Date.now(), info = m.handleInfo || {}, side = handSide(info);
  const hit = Object.values(r.hits || {}).filter((h) => h.score >= 0.15).sort((a, b) => b.score - a.score)[0];   // knob, lever or bar
  if (!hit) {
    if (t - m.phaseAt > 15000) { say(`I can't spot the handle. Feel along the ${side ? `${side} edge of the door` : "door's edges"}, about waist height.`); doorWaitStart(m); }
    return;
  }
  m.door = { dx: hit.dx, size: hit.size }; m.doorAt = t;
  const dir = track(m, hit);                                 // smoothed left/right with a dead zone
  const vert = hit.dy < -0.18 ? "up" : hit.dy > 0.18 ? "down" : null;
  const cueDir = dir !== "center" ? dir : vert;
  if (cueDir) {
    m.gotTapped = false;
    if (cueDir !== m.lastDir) { m.lastDir = cueDir; mSay(`${cueDir} ${cueDir}`, 0); } else mSay(`${cueDir} ${cueDir}`, 5000);
    return;
  }
  const h = info.handle_height;
  const height = h === "low" ? "low, about knee height" : h === "chest" ? "at about chest height" : "at about waist height";
  const reach = N.depth && N.depth.ahead > 0.9 ? "Take a small step, then reach forward" : "Reach straight forward";
  say(`Got it, the handle is right in front of you. ${reach}${side ? ` with your ${side} hand` : ""}, ${height}. ${doorHow(info)}`);
  doorWaitStart(m);
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
  } catch (e) { log("wall check failed", e); }
}

// Arrived at a door: one look decides what kind it is; open -> through, closed -> the handle (or wait for it to open).
async function doorStep(m) {
  if (m.doorBusy) return;
  m.doorBusy = true;
  try {
    const d = await readDoor();
    if (S.mission !== m || !d) return;
    if (d.door === "none") { const why = "thought I was at a door but don't see one up close"; return m.slam ? slamMap(m, why) : lookAround(why); }
    if (d.door === "open" || d.door === "ajar") return doorThrough(m, d.door === "ajar" ? "It's open a little. Open it the rest of the way and walk through slowly." : null);
    m.handleInfo = d;
    if (["automatic", "revolving", "sliding"].includes(d.type)) { say(d.say); return doorWaitStart(m); }
    // hinged, or unsure (most doors are): find the handle first; say which side so the free hand can go there
    const tooClose = !handSide(d) && N.depth && N.depth.ahead < 0.5;   // nose to the door, the handle is out of the picture
    say(`${d.say} ${tooClose ? "Take a small step back, then point" : "Point"} the phone at the door, and I'll guide you to the handle.` +
        (d.type === "unsure" ? " If it slides instead, tell me." : ""));
    m.phase = "handle"; m.phaseAt = Date.now(); m.dxs = null; m.centered = false; m.lastDir = null; render();
  } catch (e) { log("door check failed", e); }
  finally { if (S.mission) m.doorBusy = false; }
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
  m.leave?.marks.pop();
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
    return Math.abs(off) > 18 ? offTap(off, 18) : null;
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
  if (m.leave) leaveOutside(m);
  if (m.phase === "door") return doorWait(m);
  if (m.phase === "turn") {
    const off = ((m.turnTo - N.heading + 540) % 360) - 180;
    if (Math.abs(off) <= 18) { m.turnTo = null; turnDone(); say("Stop. It should be right in front of you."); m.phase = "scan"; m.phaseAt = Date.now(); render(); }
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
      S.mission = null; S.trip = null; render();
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
    case "through":
      if (since > 7000) return lookAround("walked through a door");
      return;
    case "verify":
      if (since > 14000) {
        m.tries++;
        if (m.tries >= 3) { say(`I couldn't find the ${m.room}. Want to teach me the way once, so I know it next time?`); S.mission = null; S.trip = null; return render(); }
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

// ---------- FIND IT: look around first, check what it found, then guide the hand ----------
// Trip 2026-10-25 13:59: asked for a blue towel that wasn't in view, Pip said "Left. Left. Up." right away toward weak
// detector hits (score 0.13-0.35 on a dark cap, then a passport) and ended with "right in front of you" at the passport.
// Now it works in two phases:
//  sweep: "turn slowly all the way around" (a rising note every 30 degrees). A hit counts only after the vision model
//         names it as the thing asked for (server /locate verify=1). Things it rejected ("passport") compete in later
//         frames, so the same wrong thing isn't picked again. A full turn with nothing confirmed: say so, don't guess.
//  guide: left/right/up/down to the confirmed thing. Up close it's checked once more before "right in front of you".
//         Lost for 4 s: back to sweep.
function findStart(target, quiet = false) {
  if (!target) return say("What should I find?");
  ensureCamera();
  S.find = { target, phase: "sweep", move: null, size: 0, saidAt: 0, lastSay: "", seenAt: 0, gotAt: 0, started: Date.now(),
             turned: 0, last: N.heading, step: -1, rejected: [] };
  if (!quiet) say(`Looking for the ${target}. Turn slowly all the way around.`);
}
const HAND_WORDS = { left: "Left.", right: "Right.", up: "Up.", down: "Down." };
function findStop(msg) { if (S.find) { S.find = null; if (msg) say(msg); } }
function findSweep(f, msg) {   // (back) to looking around
  Object.assign(f, { phase: "sweep", move: null, gotAt: 0, turned: 0, last: N.heading, step: -1, same: 0, pending: "" });
  if (msg) say(msg);
}
function findCue() {
  const f = S.find;
  if (Date.now() - f.started > 90000) { findStop(`I couldn't find the ${f.target}. Try again from a different spot.`); return null; }
  if (f.phase === "sweep") {
    if (N.heading != null && f.last != null) f.turned += ((N.heading - f.last + 540) % 360) - 180;
    f.last = N.heading;
    const step = Math.floor(Math.abs(f.turned) / 30);
    if (step > f.step) { f.step = step; if (step > 0) note(step - 1); }          // every 30 degrees, the next note up
    if (Math.abs(f.turned) >= 340 && !f.aisle) { findStop(`I don't see the ${f.target} around here. Try another room, or a different spot.`); return null; }
    return null;
  }
  if (Date.now() - f.seenAt > 4000) { findSweep(f, "I lost it. Turn slowly."); return null; }
  if (!f.move || Date.now() - f.seenAt > 1500) return null;                     // not seen right now: quiet
  const near = Math.min(1, f.size * 8);                                         // bigger in frame = closer
  if (f.move === "center") return { side: "both", interval: 0.5 - 0.3 * near, kind: "got" };
  const side = f.move === "left" || f.move === "right" ? f.move : "both";
  const kind = f.move === "up" ? "up" : f.move === "down" ? "down" : "tap";
  return { side, interval: 0.45 - 0.25 * near, kind };
}
async function findStep(blob) {
  const f0 = S.find, close = f0.phase === "guide" && f0.move === "center" && f0.size > 0.12 && !f0.closeOk;
  const fd = new FormData(); fd.append("image", blob, "f.jpg"); fd.append("target", f0.target);
  if (f0.phase === "sweep" || close) fd.append("verify", "1");                   // sweep: is it really it? close: still it?
  if (f0.rejected.length) fd.append("not", f0.rejected.join(","));
  const r = await (await fetch(SERVER + "/locate", { method: "POST", body: fd })).json();
  const f = S.find; if (f !== f0) return;
  $("clear").textContent = r.found ? `${r.move} · ${Math.round(r.score * 100)}% · ${r.ms} ms` : `looking · ${r.ms} ms`;
  $("clear").className = "v " + (r.found ? (r.move === "center" ? "ok" : "warn") : "");
  if (!r.found) return;
  if (r.verified === false) {                                                    // the vision model says it's something else
    log(`find: not the ${f.target}, it's ${r.actually || "unclear"} (score ${r.score})`);
    if (r.actually && !f.rejected.includes(r.actually)) f.rejected = [...f.rejected, r.actually].slice(-6);
    if (f.phase === "guide") findSweep(f, `${r.actually ? `That's ${/^[aeiou]/.test(r.actually) ? "an" : "a"} ${r.actually}, not` : "That's not"} the ${f.target}. Turn slowly, I'll keep looking.`);
    return;
  }
  if (f.phase === "sweep") {                                                     // confirmed: stop turning, guide the hand
    log(`find: confirmed ${f.target} (score ${r.score}, it's ${r.actually})`);
    f.phase = "guide"; f.closeOk = false; doneChime(); say(`Found the ${f.target}.`, { urgent: true }); f.saidAt = Date.now();
  }
  if (close && r.verified) f.closeOk = true;
  // Guiding a hand to the object. Trip 2026-10-25 13:52: the server's word changed with almost every frame, so Pip said
  // 50 lines in 55 s, flipping "left left" / "right right". The taps give the direction all the time (findCue), so the
  // voice now speaks only when a direction holds for 2 frames, at most every 2.5 s (the same words every 5 s), and the
  // middle has a dead zone: inside 12% of center counts as center, and leaving it needs 18%.
  const ax = Math.abs(r.dx), ay = Math.abs(r.dy), lim = f.move === "center" ? 0.18 : 0.12;
  const mv = ax < lim && ay < lim ? "center" : ax >= ay ? (r.dx > 0 ? "right" : "left") : (r.dy > 0 ? "down" : "up");
  f.move = mv; f.size = r.size; f.seenAt = Date.now(); f.dx = r.dx; f.dy = r.dy; f.score = r.score;
  const words = mv === "center" ? (r.size > 0.12 && f.closeOk ? "Got it, right in front of you." : "Straight ahead. Move closer.") : HAND_WORDS[mv];
  f.same = words === f.pending ? (f.same || 0) + 1 : 1; f.pending = words;
  const now = Date.now();
  if (f.same >= 2 && now - f.saidAt > (words === f.lastSay ? 5000 : 2500)) { say(words); f.lastSay = words; f.saidAt = now; }
  if (mv === "center" && r.size > 0.12 && f.closeOk) { if (!f.gotAt) f.gotAt = Date.now(); else if (Date.now() - f.gotAt > 1500) findStop(`The ${f.target} is right in front of you. Reach forward.`); }
  else f.gotAt = 0;
}

// ---------- camera -> local planner (obstacles) ----------
let video, canvas, busy = false, lastFrame = null, hazardSaidAt = 0, camOn = null;
// Camera only when asked: find something, describe, or active guidance. Not while just talking.
// ---------- demo view (recorded demos): what the camera and detector see, which model is thinking ----------
const DEMO_CALLS = { "/talk": "brain", "/decide_slam": "brain · map", "/path_ahead": "vision · path ahead", "/panorama": "vision · looking around",
  "/door": "vision · door", "/check_room": "vision · room", "/confirm": "vision · second look", "/replan": "vision · plan", "/describe": "vision · describe" };
S.demo = (() => { try { return (localStorage.getItem("pip.demo") ?? "1") === "1"; } catch { return true; } })();
S.calls = new Map();   // model calls in flight -> their label, for the demo's "thinking" chip
const fetchRaw = window.fetch.bind(window);
window.fetch = (url, opts) => {
  const label = DEMO_CALLS[String(url).replace(SERVER, "").split("?")[0]];
  if (!label) return fetchRaw(url, opts);
  const k = {}; S.calls.set(k, label);
  return fetchRaw(url, opts).finally(() => S.calls.delete(k));
};
function demoToggle() {
  S.demo = !S.demo;
  try { localStorage.setItem("pip.demo", S.demo ? "1" : "0"); } catch (e) { log("demo setting not saved:", e.message); }
  if (S.demo && started) ensureCamera();
  log("demo view", S.demo ? "on" : "off");
}
let cloudAt = 0, cloudBusy = false;
function pollCloud() {   // the LiDAR points for the demo's 3D view, ~7 times a second while it's open
  if (cloudBusy || Date.now() - cloudAt < 150) return;
  cloudBusy = true; cloudAt = Date.now();
  askNative({ type: "cloud" }, 800).then((p) => { if (p?.length) S.cloud = p; }).finally(() => { cloudBusy = false; });
}
function obstacleSeen(what) { S.obstacleAt = Date.now(); if (what) S.obstacleWhat = what; }   // opens the demo's 3D view
async function demoRecord() {   // ReplayKit on the phone: the screen and Pip's sound, saved to Photos
  const on = !S.recording;
  const r = await askNative({ type: "record", on }, on ? 15000 : 30000);
  if (!r?.ok) return log("recording", on ? "start" : "stop", "failed:", r?.error || "no answer");
  S.recording = on; S.recordAt = Date.now();
  log(on ? "recording started" : "recording saved to Photos");
  if (!on) say("Saved the recording to Photos.");
}
function ensureCamera() {
  if (!camOn) camOn = (NATIVE ? Promise.resolve() : startCamera()).then(() => { S.camFail = null; return localLoop(); }).catch((e) => { log("camera:", e.message); camOn = null; S.camFail = e.message; });   // LOOK and FIND show "No camera"
  return camOn;
}
const guiding = () => Boolean(S.route || S.back || S.learning || S.mission || S.walk);
const serverDown = () => Boolean((S.serverDown && Date.now() - S.serverDown < 60000) || (S.server && !S.server.ok));
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
  if (!busy && !S.paused && (S.find || guiding() || S.demo)) {
    const blob = await frameBlob();
    if (blob && S.demo) S.demoBlob = blob;
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
        S.demoBoxes = { boxes: r.boxes || [], at: Date.now() };
        if (S.seg) S.seg.landmarks.push(...r.landmarks);
        const near = r.hazards.find((h) => h.near && h.side === "ahead");
        if (near && !NATIVE && guiding() && !S.learning && Date.now() - hazardSaidAt > 6000) { hazardSaidAt = Date.now(); say(`Careful, ${near.label} ahead.`, { urgent: true }); }
        $("clear").textContent = `${r.hint.replace("_", " ")} · ${r.ms} ms`;
        $("clear").className = "v " + (r.hint === "clear" ? "ok" : r.hint === "stop" ? "bad" : "warn");
      } catch (e) { $("clear").textContent = "no model"; S.hint = "clear"; }
      busy = false;
    }
  }
  setTimeout(localLoop, 250);   // ~4 frames/s
}

// ---------- talk: hold the talk bar (or Space), 16 kHz PCM to the 4090 ----------
// Pip hears you only while you hold it. On the phone the native mic records. In a browser it's the laptop's
// built-in mic: opening a Bluetooth headset's mic switches it to mono "headset mode" (left = right).
let mic, micNode, micStream, chunks = [], talking = false, builtinMic;
let micLevel = 0;   // loudness of the laptop mic while talking (the phone sends its own as N.mic), for the voice wave
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
  micNode.onaudioprocess = (e) => {
    if (!talking) { micLevel = 0; return; }
    const x = e.inputBuffer.getChannelData(0); chunks.push(new Float32Array(x));
    let e2 = 0; for (let i = 0; i < x.length; i++) e2 += x[i] * x[i];
    micLevel = Math.sqrt(e2 / x.length);
  };
  mic.connect(micNode); micNode.connect(ac.destination);
}
function talkStart() {   // the talk bar went down (or Space): Pip stops talking and listens
  if (!started || talking) return;
  if (speaking() || askBusy) { tap("both", "note", 330); return log("talk bar: wait, Pip is still talking or thinking"); }   // one at a time
  talking = true; chunks = []; hush();
  $("talk").classList.add("on"); toNative({ type: "haptic" }); tap("both");
  if (NATIVE) toNative({ type: "talk", on: true });
  else if (!micStream) startMic().catch((e) => log("mic:", e.message));
}
function talkEnd() {   // let go: send what was said
  if (!talking) return;
  talking = false; $("talk").classList.remove("on"); tap("both");
  if (NATIVE) toNative({ type: "talk", on: false });   // the phone sends the recording back through pipNative.phrase
  else sendTalk();
}
const talkKey = $("talk");
talkKey.addEventListener("pointerdown", (e) => { e.preventDefault(); talkKey.setPointerCapture(e.pointerId); talkStart(); });
for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) talkKey.addEventListener(ev, talkEnd);
talkKey.addEventListener("contextmenu", (e) => e.preventDefault());   // a long press must not open the iOS menu
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
  return { indoor: indoorContext(), pos: S.pos, heading: S.heading == null ? null : Math.round(S.heading),
           gps: S.sim ? "simulated" : !gpsOn ? "off (not requested)" : S.gpsOk ? "ok" : "weak",
           gps_accuracy_m: S.acc == null ? null : Math.round(S.acc), navigating_to: S.route?.name || S.walk?.name || null,
           next_turn: S.route?.steps[S.stepIdx]?.turn || null, saved_spots: S.spots.map((s) => s.label),
           taught_routes: Object.keys(routesStore()), hazards: S.hazards.map((h) => `${h.label} ${h.side}`),
           learning: S.learning?.name || null, apple_search: NATIVE,
           remaining_m: S.walk?.path && S.walk.s != null ? Math.round(S.walk.total - S.walk.s) : null,   // "how far is it now?"
           trip: S.trip ? { goal: S.trip.goal, place_id: S.trip.dest?.placeId || null, steps_done: S.trip.hops, now_in: S.trip.nowIn || null,
                            outside: S.trip.out, at_goal: Boolean(S.trip.atGoal), spaces_so_far: S.trip.rooms } : null };
}
// One at a time: while Pip speaks, or waits for the brain, what you say is dropped (a stray "yeah" spoken over it
// became a request). spokeAt: when Pip last stopped talking.
let askBusy = false, spokeAt = 0;
async function askPip({ body, text }) {
  askBusy = true;
  try { return await askPipNow({ body, text }); } finally { askBusy = false; }
}
async function askPipNow({ body, text }) {
  const url = `${SERVER}/talk?session=${SESSION}&ctx=${encodeURIComponent(JSON.stringify(status()))}` + (text ? `&text=${encodeURIComponent(text)}` : "");
  try {
    // Indoor camera callbacks have a 180 s deadline; keep conversation requests bounded too.
    const r = await (await fetch(url, { method: "POST", body: body || "", signal: AbortSignal.timeout(180000) })).json();
    S.serverDown = 0;
    if (r.heard && answerLocally(r.heard)) { log("HEARD", r.heard, "-> answered on the phone"); return; }   // yes/no to a route preview, the FIND key
    if (r.ignored) { log("(not for Pip)", r.heard); return; }
    S.heard = r.heard || "";
    log("HEARD", r.heard, "->", (r.tools || []).map((t) => t.tool).join(",") || "-", r.action?.type || "", `${r.ms}ms (stt ${r.ms_stt}ms)`);
    act(r).catch((e) => { log("ERROR in", r.action?.type || "reply", e.message); say("Something went wrong on my side. Please try again."); });
  } catch (e) { S.serverDown = Date.now(); say("I can't reach my planner right now."); log(e); }
}
// Short answers the phone handles itself: "yes" / "no" after a route preview, and what to find after the FIND key.
const YES = /^\W*(yes|yeah|yep|yup|sure|ok(ay)?|go|let'?s go|take me( there)?|start|please)\b/i, NO = /^\W*(no|nope|cancel|never ?mind|not now|stop)\b/i;
// "Mark that" / "that was wrong": a MARK line in the trip recording, so a bad moment can be found later
// (tools/trip_report.py lists marks first). The rest of the sentence is kept as the note.
const MARK = /^\W*(mark (that|this|it)|that was wrong)\b/i;
function answerLocally(heard) {
  if (indoorTask?.phase === "confirmation") {
    if (INDOOR_YES.test(heard)) {
      if (!indoorTask.confirming) { indoorTask.confirming = true; indoorEvent(indoorTask, "confirmed"); }
      return true;
    }
    if (NO.test(heard)) { indoorCancel(); say("Okay."); render(); return true; }
  }
  if (MARK.test(heard)) { log("MARK", heard); say("Marked."); return true; }
  if (S.preview && NO.test(heard)) { previewCancel(); return true; }
  if (S.preview && YES.test(heard)) { previewGo(); return true; }
  if (S.findNext && Date.now() - S.findNext < 15000) {
    S.findNext = 0;
    const t = heard.replace(/^\W*(hey pip\W*)?(please\W*)?((can you |could you )?(find|look for|where'?s|where is)\W*)?((the|my|a|an|some)\s+)?/i, "").replace(/[.?!]+$/, "").trim();
    if (t && !NO.test(heard)) { findStart(t); return true; }
  }
  return false;
}
function findKey() {   // the FIND key: ask what to find; the next thing heard is the target
  S.findNext = Date.now();
  say("What should I find?");
}
// The brain (Qwen3-14B) answers with words + at most one action for the app.
let lastBrainSay = "", lastBrainAt = 0;
const DIRECTION_Q = /\b(where|which way|what now|how (much|far)|turn|go now|next|direction)/i;
const ARRIVED = /\b(we'?re here|we are here|i'?m here|i am here|we made it|made it|arrived|this is it)\b/i;
// While Pip is busy, a remark about the app ("you're not showing the 360 direction thing") must not start or replace a
// task. Trip 2026-10-25 13:52: two such remarks restarted the shower search and started "go back". A new task needs a request.
const TASK_ACTIONS = new Set(["mission", "back", "replay", "find", "navigate", "learn_start", "leave"]);
const ASKED = /\b(take|go|bring|lead|guide|navigate|walk|head|find|look|search|where|back|return|stop|cancel|start|begin|restart|teach|learn|show me|help|need|want|please|let'?s|can you|could you)\b/i;
async function act(r) {
  const a = r.action, heard = r.heard || "";
  if (a && indoorTask && !["indoor_workflow", "pause", "resume", "repeat"].includes(a.type)) indoorCancel(a.type !== "stop");
  if (a && TASK_ACTIONS.has(a.type) && (S.mission || S.walk || S.find || S.back || S.learning) && heard && !ASKED.test(heard)) {
    log("ignored", a.type, "- no request in:", heard); return say("Okay.");
  }
  if (a) { S.arrived = null; S.saved = null; if (S.preview && a.type !== "repeat") S.preview = null; }
  // While teaching a route, the phone handles "we're here" itself (the brain sometimes only says it saved it).
  if (S.learning && !S.learning.orienting && ARRIVED.test(heard)) return learnEnd();
  if (S.learning && a?.type === "learn_start") return say(`I'm still recording the way to ${S.learning.name}. You lead: walk there yourself, and say "we're here" when you arrive.`);
  if (S.learning && !a && DIRECTION_Q.test(heard)) return say(`This time you lead, and I remember the way. Walk to ${S.learning.name}, and say "we're here" when you arrive.`);
  if (!a && (S.walk || S.back) && DIRECTION_Q.test(heard)) return say(currentDirection());   // the route knows; the brain would guess
  if (a && r.say && ["replay", "learn_start", "learn_end", "mission", "find", "leave", "navigate", "search"].includes(a.type)) return act({ ...r, say: null, heard: "" });   // these speak for themselves
  if (r.say && !a && r.say === lastBrainSay && Date.now() - lastBrainAt < 60000) say("Okay.");      // don't repeat the same line
  else if (r.say) say(r.say);
  if (r.say) { lastBrainSay = r.say; lastBrainAt = Date.now(); }
  if (!a) return;
  switch (a.type) {
    case "indoor_workflow": return indoorAction(a);
    case "search": return placeSearch(a.query);
    case "navigate": {   // the route takes over; coming out of a building they already agreed, so it starts at once
      S.trip = null;   // the brain only starts a route after they said yes: don't ask a second time
      return gpsWalk(a.route.name, a.route.to, a.route.steps, true, { go: true, placeId: a.route.place_id });
    }
    case "find": return findStart(a.target);   // the app says it (the brain once said "I found it" before looking)
    case "mission": return missionStart(a.room, a.via, a.proof);
    case "leave": return leaveStart({ goal: a.goal, outside: a.outside ?? null,
                                      dest: a.to ? { name: a.name || a.goal, to: a.to, steps: a.steps, placeId: a.place_id } : S.trip?.dest || null });
    case "describe": return describe("What's around me?", false);
    case "gps_on": ensureGPS(); if (heard) S.askAfterFix = { text: heard, until: Date.now() + 25000 }; return;   // asked before GPS was on: ask again once it is
    case "look": { const r = await lookAndPlan(a.goal || "where I want to go"); if (r) say(r.plan.say); return; }
    case "where": return whereAmI();
    case "back": return goBack(a.label);
    case "blocked": {   // "dead end", "there's a wall": during a walk, look now; during a search, go back and try another way
      if (S.walk) return aroundCheck(S.walk, true);
      const m = S.mission;
      if (m) return m.phase === "door" || m.phase === "handle" ? doorBlocked(m, "was blocked") : m.slam ? slamBacktrack(m, "you said it's blocked") : backtrack(m, "the user said it's blocked");
      return say("Okay. Tell me where you want to go, and I'll find a way.");
    }
    case "replay": return replay(a.name);
    case "learn_start": return learnStart(a.name, a.start);
    case "learn_end": return learnEnd();
    case "repeat": return say(S.lastSpoken);
    case "pause": S.paused = true; return;
    case "resume": S.paused = false; return;
    case "stop": S.find = null; S.route = null; S.back = null; S.mission = null; S.walk = null; S.walkTok = null; S.preview = null; S.orient = null; S.trip = null; render(); return;
  }
}
async function describe(question = "What's around me?", interrupt = true) {
  S.looking = Date.now();   // the LOOK key shows "Looking…" until Pip answers (Button States: Working)
  try {
    await ensureCamera(); await new Promise((r) => setTimeout(r, 600));   // first frame
    const blob = lastFrame || (await frameBlob());
    if (!blob) return say("The camera isn't on.");
    const fd = new FormData(); fd.append("image", blob, "f.jpg"); fd.append("question", question);
    try { say((await (await fetch(SERVER + "/describe", { method: "POST", body: fd })).json()).say); }
    catch { say("I can't reach the vision model right now."); }
  } finally { S.looking = null; }
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
  $("next").textContent = S.mission ? `${S.mission.room}: ${S.mission.phase}${S.mission.slam && S.mission.target && N.pose ? ` · ${roomDist(N.pose, S.mission.target).toFixed(1)} m` : S.mission.pin && N.pose ? ` · ${roomDist(N.pose, S.mission.pin).toFixed(1)} m` : ""}` : S.walk?.path ? `${S.walk.name}: ${Math.round(S.walk.total - (S.walk.s || 0))} m to go` : S.walk ? `${S.walk.name}: point ${S.walk.i + 1} of ${S.walk.pts.length}` : S.back ? `going back (${S.back.i + 1}/${S.back.steps.length})` :
    st && S.pos ? `${st.turn} in ${Math.round(dist(S.pos, st))} m` : "no route";
}
let serverWarned = false;   // say it once, so a dead connection isn't silent
async function checkServer() {
  try { const h = await (await fetch(SERVER + "/health", { signal: AbortSignal.timeout(5000) })).json();
        S.server = { ok: true, gpu: h.device.startsWith("cuda"), loaded: h.loaded.length, at: Date.now() }; serverWarned = false; }
  catch { S.server = { ok: false, at: Date.now() };
          if (!serverWarned) { serverWarned = true; say("I can't reach my server, so I can't hear you yet. Check the connection."); } }
}
let started = false;
async function start() {
  if (started) return; started = true;
  log("--- Pip started", new Date().toLocaleString(), "server", SERVER);
  if (!NATIVE) { ac = new AudioContext(); setInterval(ambientLoop, 250); }   // in the app, all sound is native
  $("start").remove();
  say(NATIVE ? "Hi, I'm Pip. To talk to me, hold the bar at the bottom of the screen." : "Hi, I'm Pip. To talk to me, hold space.");
  checkServer(); setInterval(checkServer, 15000);
  if (S.demo) ensureCamera();
  fetch(SERVER + "/warmup", { method: "POST" }).then(() => checkServer()).catch(() => {});
  startSegment();   // GPS and camera stay off until the conversation needs them
  if (qs.get("lat") && qs.get("lon")) {   // desk demo: start here and walk with W/A/F
    S.sim = true; onFix({ lat: +qs.get("lat"), lon: +qs.get("lon") }, 5, false);
    say("Simulated start position set. Use W to walk, A and F to turn.");
  }
  if (NATIVE) { toNative({ type: "ready", server: SERVER }); setTimeout(warmVoice, 3000); }   // the phone's mic, natively
  else startMic().catch((e) => log("mic:", e.message));   // ask for the laptop mic now, not on the first hold
  audioLoop();
}
$("start").onclick = start;
$("ask").addEventListener("keydown", (e) => { if (e.key === "Enter" && e.target.value.trim()) { say("…", {}); askPip({ text: e.target.value.trim() }); e.target.value = ""; } });
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter") return start();
  if (!started || e.repeat || e.target.tagName === "INPUT") return;
  const k = e.key.toLowerCase();
  if (e.code === "Space") { e.preventDefault(); talkStart(); }
  else if (k === "d") describe();
  else if (k === "l") { const t = prompt("What should Pip find? (e.g. door knob)"); if (t) findStart(t); }
  else if (e.key === "Escape") { if (S.walk || S.walkTok) { S.walk = null; S.walkTok = null; say("Stopped."); render(); } else if (S.mission) { S.mission = null; say("Stopped."); render(); } else findStop("Stopped looking."); }
  else if (k === "n" && (S.mission?.phase === "through" || S.mission?.phase === "door")) lookAround("walked through a door");
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
document.addEventListener("keyup", (e) => { if (e.code === "Space") talkEnd(); });
