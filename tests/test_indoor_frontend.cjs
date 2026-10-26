// Protocol checks only: native camera/path responses are mocked, not physical navigation.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const vm = require("node:vm");
const { test } = require("node:test");

const source = readFileSync(require("node:path").join(__dirname, "../frontend/app.js"), "utf8");
const block = source.slice(source.indexOf("const INDOOR_DEVICE ="), source.indexOf("// ---------- SLAM MISSION"));

function harness() {
  const calls = [], spoken = [];
  const context = vm.createContext({
    window: { PIP_DEVICE_ID: "phone-a", crypto: { randomUUID: () => "view-id" } },
    localStorage: { getItem: () => null, setItem: () => {} },
    NATIVE: true, SESSION: "session", SERVER: "http://test", AbortController,
    AbortSignal, setTimeout, clearTimeout, Date, Number, Math, Promise, FormData,
    N: { frame: "frame-a", heading: 0, updatedAt: Date.now(), pose: { x: 0, z: 0, tracking: "ok" } },
    S: { walk: null, mission: null, find: null, back: null },
    status: () => ({}), render: () => {}, log: () => {}, say: (s) => spoken.push(s),
    slamReady: () => true, roomDist: (a, b) => Math.hypot(a.x - b.x, a.z - b.z),
    askNative: async (args) => { calls.push(args); return null; },
    fetch: async (url, args) => {
      calls.push({ url, body: JSON.parse(args.body) });
      return { ok: true, json: async () => ({ say: "No verified path", action: null }) };
    },
  });
  vm.runInContext(block, context);
  context.act = async (r) => {
    if (r.say) spoken.push(r.say);
    if (r.action) return vm.runInContext(`indoorAction(${JSON.stringify(r.action)})`, context);
  };
  const action = { type: "indoor_workflow", operation: "prepare_route", request_id: "request", visit_id: "visit",
                   device_id: "phone-a", frame_id: "frame-a", floor: "1", section_id: "section", label: "Beverages",
                   anchor: { device_id: "phone-a", frame_id: "frame-a", x: 2, z: 0, kind: "sign" } };
  return { context, calls, spoken, action, run: (js) => vm.runInContext(js, context) };
}

test("native no-path stays a failure and never starts a walk", async () => {
  const h = harness();
  await h.run(`indoorAction(${JSON.stringify(h.action)})`);
  assert.equal(h.context.S.walk, null);
  assert.equal(h.calls.find((c) => c.body)?.body.event, "no_path");
  assert.equal(h.calls[0].type, "indoorPath");
  assert.equal(h.calls[0].approach, true);
});

test("route preparation waits for confirmation; start revalidates the route", async () => {
  const h = harness();
  h.context.askNative = async (args) => { h.calls.push(args); return [{ x: 0, z: 0 }, { x: 1, z: 0 }]; };
  h.context.fetch = async (url, args) => {
    const body = JSON.parse(args.body); h.calls.push({ body });
    return { ok: true, json: async () => ({ say: "Want me to take you?", action: body.event === "confirmed"
      ? { ...h.action, operation: "guiding" } : null }) };
  };
  await h.run(`indoorAction(${JSON.stringify(h.action)})`);
  assert.equal(h.context.S.walk, null);
  assert.equal(h.run("indoorTask.phase"), "confirmation");
  await h.run('indoorEvent(indoorTask, "confirmed")');
  assert.equal(h.context.S.walk.indoor.phase, "guiding");
  assert.equal(h.calls.filter((c) => c.type === "indoorPath").length, 2);
  assert.equal(h.context.S.walk.path, undefined);
});

test("late route preparation cannot restart a cancelled task", async () => {
  const h = harness();
  let complete;
  h.context.askNative = () => new Promise((resolve) => { complete = resolve; });
  const preparing = h.run(`indoorAction(${JSON.stringify(h.action)})`);
  h.run("indoorCancel(false)");
  complete([{ x: 0, z: 0 }]);
  await preparing;
  assert.equal(h.context.S.walk, null);
  assert.equal(h.calls.length, 0);
});

test("late JSON response is discarded after cancellation", async () => {
  const h = harness();
  h.run(`indoorTask = ${JSON.stringify(h.action)}`);
  let complete;
  h.context.response = { ok: true, json: () => new Promise((resolve) => { complete = resolve; }) };
  const delivering = h.run("indoorDeliver(indoorTask, response)");
  h.run("indoorCancel(false)");
  complete({ say: "Must not speak", action: h.action });
  await delivering;
  assert.equal(h.spoken.length, 0);
  assert.equal(h.context.S.walk, null);
});

test("foreign-device anchors never reach native routing", async () => {
  const h = harness();
  h.action.anchor.device_id = "another-phone";
  await h.run(`indoorAction(${JSON.stringify(h.action)})`);
  assert.equal(h.calls.filter((c) => c.type === "indoorPath").length, 0);
  assert.equal(h.calls.find((c) => c.body)?.body.event, "stale_map");
});

test("map context changes cancel the current workflow", async () => {
  const h = harness();
  h.run(`indoorTask = ${JSON.stringify(h.action)}; S.walk = { indoor: indoorTask }`);
  await h.run('indoorAction({ operation: "context_changed" })');
  assert.equal(h.run("indoorTask"), null);
  assert.equal(h.context.S.walk, null);
});

test("failed revalidation retains no straight-line path", async () => {
  const h = harness();
  h.run(`indoorTask = ${JSON.stringify(h.action)}; indoorTask.route = [{ x: 1, z: 0 }];
         S.walk = { indoor: indoorTask, pts: [], i: 0 }`);
  await h.run("indoorRepath(S.walk)");
  assert.equal(h.context.S.walk, null);
  assert.equal(h.calls.find((c) => c.body)?.body.event, "no_path");
});

test("a qualified yes is not permission to start walking", () => {
  const h = harness();
  for (const text of ["yes, but don't start", "okay, where is it?", "yes stop"])
    assert.equal(h.run(`INDOOR_YES.test(${JSON.stringify(text)})`), false);
  for (const text of ["yes please", "go ahead", "yes, let's go"])
    assert.equal(h.run(`INDOOR_YES.test(${JSON.stringify(text)})`), true);
});
