// ycgsf browser app: GPS + camera + mic on the laptop, models on the 4090 (server/app.py).
// Audio rule: taps come from the side you should turn toward. Slow when the turn is far, fast when
// close ("  .  . . . .."), silent when you're on course and the way is clear.
"use strict";

const $ = (id) => document.getElementById(id);
const qs = new URLSearchParams(location.search);
const SERVER = (qs.get("server") || localStorage.getItem("ycgsf.server") || "http://100.71.218.127:8100").replace(/\/$/, "");
$("srv").value = SERVER;
$("srv").onchange = (e) => { localStorage.setItem("ycgsf.server", e.target.value); location.reload(); };
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
};

// ---------- 1. AUDIO: tip-tap with swapped channels ----------
let ac;
const invert = () => $("invert").value === "1";
function tap(side, kind = "tap") {
  if (!ac) return;
  const t = ac.currentTime, osc = ac.createOscillator(), g = ac.createGain(), pan = ac.createStereoPanner();
  const p = side === "left" ? -1 : side === "right" ? 1 : 0;
  pan.pan.value = invert() ? -p : p;   // headphones upside down: the "R" cup sits on the left ear
  const [f, dur, vol] = kind === "warn" ? [520, 0.06, 0.55] : kind === "stop" ? [200, 0.09, 0.7]
    : kind === "up" ? [2600, 0.03, 0.45] : kind === "down" ? [700, 0.04, 0.55] : kind === "got" ? [1320, 0.12, 0.5] : [1800, 0.022, 0.45];
  osc.type = kind === "tap" ? "sine" : "triangle";
  osc.frequency.value = f;
  g.gain.setValueAtTime(vol, t);
  g.gain.exponentialRampToValueAtTime(0.001, t + dur);
  osc.connect(g).connect(pan).connect(ac.destination);
  osc.start(t); osc.stop(t + dur + 0.02);
}
// What the taps should be doing right now: {side, interval (s), kind} or null for silence.
function cue() {
  if (S.paused) return null;
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
function say(text, { interrupt = true } = {}) {
  if (!text) return;
  S.lastSpoken = text; $("say").textContent = text; log("SAY", text);
  if (interrupt) speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(text);
  u.rate = 1.1;
  speechSynthesis.speak(u);
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
  if (S.back) return backCue();
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
  if (step.turn === "arrive" && d < 12) { say(`You've arrived at ${S.route.name}.`); S.route = null; return render(); }
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
      if (n?.action === "walk") say(`Walk straight about ${n.seconds} seconds${n.landmark ? `, past a ${n.landmark}` : ""}.`, { interrupt: false }); }
    if (el < 0.1 && st.action !== "turn_around") say(`Turn ${st.action}.`);
    return { side: st.action === "turn_around" ? "both" : st.action, interval: 0.3, kind: "tap" };
  }
  if (st.action === "walk") {
    if (el > st.seconds) { b.i++; b.started = Date.now(); }
    const left = st.seconds - el;
    return left < 6 ? { side: b.steps[b.i + 1]?.action === "left" ? "left" : b.steps[b.i + 1]?.action === "right" ? "right" : "both",
                        interval: Math.max(0.15, left / 4), kind: "tap" } : null;
  }
  if (st.action === "arrive") { say("You should be back where you started."); S.back = null; }
  return null;
}

// ---------- FIND IT: "left left", "up up" to guide a hand to an object ----------
function findStart(target) {
  if (!target) return say("What should I find?");
  S.find = { target, move: null, size: 0, saidAt: 0, lastSay: "", seenAt: 0, gotAt: 0, started: Date.now() };
  say(`Looking for the ${target}. Move the camera slowly.`);
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
let video, canvas, busy = false, lastFrame = null, hazardSaidAt = 0;
async function startCamera(deviceId) {
  const stream = await navigator.mediaDevices.getUserMedia({ video: deviceId ? { deviceId: { exact: deviceId } } : { facingMode: "environment" }, audio: false });
  video = $("cam"); video.srcObject = stream;
  canvas = canvas || document.createElement("canvas");
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === "videoinput");
  $("camsel").innerHTML = devs.map((d) => `<option value="${d.deviceId}">${d.label || "camera"}</option>`).join("");
  $("camsel").value = stream.getVideoTracks()[0].getSettings().deviceId;
  $("camsel").onchange = (e) => { stream.getTracks().forEach((t) => t.stop()); startCamera(e.target.value); };
}
async function frameBlob() {
  if (!video?.videoWidth) return null;
  canvas.width = 480; canvas.height = Math.round((480 * video.videoHeight) / video.videoWidth);
  canvas.getContext("2d").drawImage(video, 0, 0, canvas.width, canvas.height);
  return new Promise((r) => canvas.toBlob(r, "image/jpeg", 0.7));
}
async function localLoop() {
  if (!busy && !S.paused) {
    const blob = await frameBlob();
    if (blob && S.find) {
      busy = true; lastFrame = blob;
      try { await findStep(blob); } catch (e) { $("clear").textContent = "no model"; }
      busy = false;
    } else if (blob) {
      busy = true; lastFrame = blob;
      const fd = new FormData(); fd.append("image", blob, "f.jpg");
      try {
        const r = await (await fetch(SERVER + "/local", { method: "POST", body: fd })).json();
        S.clear = r.clear; S.hint = r.hint; S.hazards = r.hazards;
        if (S.seg) S.seg.landmarks.push(...r.landmarks);
        const near = r.hazards.find((h) => h.near && h.side === "ahead");
        if (near && Date.now() - hazardSaidAt > 6000) { hazardSaidAt = Date.now(); say(`${near.label} ahead.`, { interrupt: false }); }
        $("clear").textContent = `${r.hint.replace("_", " ")} · ${r.ms} ms`;
        $("clear").className = "v " + (r.hint === "clear" ? "ok" : r.hint === "stop" ? "bad" : "warn");
      } catch (e) { $("clear").textContent = "no model"; S.hint = "clear"; }
      busy = false;
    }
  }
  setTimeout(localLoop, 250);   // ~4 frames/s
}

// ---------- talk: hold Space, 16 kHz PCM to the 4090 ----------
let mic, micNode, chunks = [], talking = false;
async function startMic() {
  const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
  mic = ac.createMediaStreamSource(stream);
  micNode = ac.createScriptProcessor(4096, 1, 1);
  micNode.onaudioprocess = (e) => { if (talking) chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
  mic.connect(micNode); micNode.connect(ac.destination);
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
  const ctx = { navigating_to: S.route?.name || null, next_turn: S.route?.steps[S.stepIdx]?.turn || null,
                gps: S.gpsOk ? "ok" : "weak", saved_spots: S.spots.map((s) => s.label), hazards: S.hazards.map((h) => `${h.label} ${h.side}`) };
  try {
    const r = await (await fetch(`${SERVER}/talk?ctx=${encodeURIComponent(JSON.stringify(ctx))}`, { method: "POST", body: pcm.buffer })).json();
    log("HEARD", r.heard, "->", r.intent, r.destination || "", `${r.ms}ms (stt ${r.ms_stt}ms)`);
    act(r);
  } catch (e) { say("I can't reach the voice model right now."); log(e); }
}
async function act(r) {
  switch (r.intent) {
    case "navigate": return r.destination ? planTo({ destination: r.destination }) : say(r.say || "Where would you like to go?");
    case "locate": return findStart(r.label || r.destination);
    case "backtrack": return goBack(r.label);
    case "describe": return describe(r.heard);
    case "where_am_i": return whereAmI();
    case "repeat": return say(S.lastSpoken);
    case "stop": if (S.find) return findStop("Stopped looking."); S.paused = true; return say("Paused. Say resume when you're ready.");
    case "resume": S.paused = false; return say("Resuming.");
    case "save_spot": return saveSpot(r.label || "this spot");
    default: return say(r.say);
  }
}
async function describe(question = "What's around me?") {
  const blob = lastFrame || (await frameBlob());
  if (!blob) return say("The camera isn't on.");
  const fd = new FormData(); fd.append("image", blob, "f.jpg"); fd.append("question", question);
  try { say((await (await fetch(SERVER + "/describe", { method: "POST", body: fd })).json()).say); }
  catch { say("I can't reach the vision model right now."); }
}
async function whereAmI() {
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
  $("next").textContent = S.back ? `going back (${S.back.i + 1}/${S.back.steps.length})` :
    st && S.pos ? `${st.turn} in ${Math.round(dist(S.pos, st))} m` : "no route";
}
async function checkServer() {
  try { const h = await (await fetch(SERVER + "/health")).json(); $("server").textContent = `${h.device.startsWith("cuda") ? "GPU" : "CPU"} · ${h.loaded.length}/5 loaded`; $("server").className = "v ok"; }
  catch { $("server").textContent = "unreachable"; $("server").className = "v bad"; }
}
let started = false;
async function start() {
  if (started) return; started = true;
  ac = new AudioContext();
  $("start").remove();
  say("Hi, I'm Pip. Hold space to talk to me. Press T to test the taps.");
  checkServer(); setInterval(checkServer, 15000);
  fetch(SERVER + "/warmup", { method: "POST" }).then(() => checkServer()).catch(() => {});
  startGPS(); startSegment();
  if (qs.get("lat") && qs.get("lon")) {   // desk demo: start here and walk with W/A/F
    S.sim = true; onFix({ lat: +qs.get("lat"), lon: +qs.get("lon") }, 5, false);
    say("Simulated start position set. Use W to walk, A and F to turn.", { interrupt: false });
  }
  try { await startCamera(); localLoop(); } catch (e) { log("camera:", e.message); }
  try { await startMic(); } catch (e) { log("mic:", e.message); }
  audioLoop();
}
$("start").onclick = start;
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter") return start();
  if (!started || e.repeat || e.target.tagName === "INPUT") return;
  const k = e.key.toLowerCase();
  if (e.code === "Space") { e.preventDefault(); talking = true; chunks = []; tap("both"); $("say").textContent = "Listening…"; }
  else if (k === "d") describe();
  else if (k === "l") { const t = prompt("What should Pip find? (e.g. door knob)"); if (t) findStart(t); }
  else if (e.key === "Escape") findStop("Stopped looking.");
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
document.addEventListener("keyup", (e) => { if (e.code === "Space" && talking) { talking = false; tap("both"); $("say").textContent = "Thinking…"; sendTalk(); } });
