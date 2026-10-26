# Pip app (iPhone + screen) and design

This repo holds Pip: `frontend/` (the screen and app logic), `ios/` (the iPhone app that shows `frontend/`), `server/` (the model server on the RTX 4090, reached over Tailscale), `design/` (the pen.dev design `design/untitled.pen`, its tokens and shaders) and `tools/` (the design check, code check, shader export and `deploy.sh`). `run.sh` serves `frontend/` on localhost.

- **Deploy the server** with `tools/deploy.sh`: it copies `server/` to the 4090 PC over Tailscale (`hackteam@100.71.218.127`), stops every running copy of Pip there (`server/restart_pip.ps1`: the task, its restart loop, every API and both llama-servers; nothing else on that PC), restarts, and warms the models up. The previous `app.py` is kept next to it as `app.py.bak-<time>`.

## Design contract with pen.dev

The pen.dev file `design/untitled.pen` is the single source of truth for how Pip looks. Its screens (the code that shows each one is in `frontend/ui.js`):

- **01 Start**
- **02 Listening**, plus 02b Planner offline, 02c GPS weak, 02d Deafened, 02e Looking, 02f Talking
- **03 Guiding**, plus 03b On course, 03c Off course, 03d Hazard, 03e Lost tracking, 03f Outdoors, 03g Arrived, 03h Paused, 03i Getting bearings, 03j Recognizing room
- **04 Find**, plus 04b Looking around
- **05 Setup**, plus 05b Log
- **06 Teach**: Orient, 06b Recording, 06c Saved
- **07 Places**
- **08 Search**: Restroom, 08b Grocery, 08c Looking around
- **09 Route preview**

**App Icon** (1024 x 1024) is the iPhone home-screen icon, a neon glass letter p whose round part is a map pin (`design/icon/app-icon.png`, 1024 x 1024, no transparency). The iPhone uses a copy of it: `ios/Pip/Assets.xcassets/AppIcon.appiconset/AppIcon.png`.

Shared components: Status Bar, Key, Talk, Talk · On, Deafen, Deafen · On, Voice Bar (Hold to talk · Deafen, at the bottom of every live screen), Say Chip. The Button States frame shows how a key looks when ready, pressed, working, done and unavailable. The Motion + Gestures frame holds the motion, navigation and accessibility rules. Frame ids and each screen's fixed labels are in `design/tokens.json`.

- `.pen` files are encrypted. Read and edit them only through the pen.dev MCP tools (`mcp__pencil__*`), never with Read or Grep.
- **Design first.** Any change to what Pip's screen shows goes into the design before the code: a new label, a new button, a new status line or a color. If a feature needs new UI, add it to the right screen in pen.dev, then build it.
- **Tokens.** Code uses only the design's colors and font, as CSS variables with the same names (`--bg`, `--fg`, `--accent` and the rest). A readable copy lives in `design/tokens.json`. Re-export it from pen.dev whenever the design changes.
- **Check.** After any UI change, run `python3 tools/check_design.py`; it must print "matches". Then compare a screenshot of the app with the design frame.
- **Accessibility rules in the design are part of the contract:** VoiceOver labels, Magic Tap, Z-scrub, Reduce Motion and Larger Text (see the Motion + Gestures frame).
- Sound and speech (taps, ticks, what Pip says) are not in the design. They follow the research-based rules in `frontend/app.js`.

## Cleanup contract

- **Delete what's no longer needed, in the same task.** When something Claude made gets replaced or stops being used, delete it before finishing: files (scripts, shader files, scratch files), pen.dev nodes, components and variables, and unused code.
- **"Definitely not needed" means all three:** Claude made it (not the user or another session), nothing uses it (search the code; in pen.dev, check with `Get` that no node points to it), and the task replaced it.
- **Never delete without asking:** anything the user or another session made, `trips/` recordings, git history, or anything that might still be in use. If unsure, ask.
- **Report it:** the final message lists what was deleted.

## Testing: Mac or phone

- **On the Mac (test it yourself):** anything that doesn't need someone walking around. That covers screens, animations and layout (through Xcode, on the plugged-in iPhone or the iOS Simulator), the design check, builds, speech and taps, server replies, and reading logs and trip recordings.
- **On the phone (leave it to the user):** Pip's main job, which needs a person moving through a real place. That covers pathfinding, guiding, teaching and following routes, GPS walks, finding a room or a grocery aisle, obstacle warnings, ARKit/LiDAR tracking and camera finding. Don't build simulated walks or fake environments to test these. Ask the user to try it, then diagnose from the trip recording (below).

## Trip recordings: how to debug a walk

The phone records every app launch as one trip, and uploads it to the 4090 PC every 30 s and when the app leaves the screen. No cable or phone is needed to read it, from any Mac on the team's Tailscale with SSH access to `hackteam@100.71.218.127` (needs your SSH key in the PC's `authorized_keys`).

- **Get it:** `tools/pull_trip.sh` copies the newest trip that has data into `trips/<trip>/` (git-ignored) and writes its report, in a few seconds. It brings the trace, the floor maps and only the photos around each MARK. `tools/pull_trip.sh list` shows all trips with their size; `tools/pull_trip.sh <trip>` gets one; add `--photos` for every photo (about 1 minute per 10 minutes walked, because the PC is reached through a Tailscale relay).
- **Read the report first:** `trips/<trip>/report/timeline.txt` (marks at the top, then what was heard, said, logged and decided, with the position every 2 s), `map.png` (floor map and the whole walk) and `mark-<n>.png` (the map, path, heading and Pip's plan at each mark). Open the PNGs with Read.
- **Zoom in:** `python3 tools/trip_report.py trips/<trip> --at <seconds>` prints every recorded line from 10 s before to 10 s after.
- **Marks:** the user says "mark that" or "that was wrong" (holding Hold to talk) when something goes wrong. It's logged as `MARK <what they said>` about 1 s after the moment. Start the diagnosis at the marks.
- **Raw files** in each trip: `trace.jsonl` (one JSON line each: `sensors` 5x/s, `pip` state 2x/s, `log`, `voice`; `t` is Unix seconds), `photos/<t>.jpg` (camera every 2 s), `maps/<t>.bin` (floor map every 4 s: 300 x 300 bytes, 10 cm cells, 0 unknown, 1 floor, 2 obstacle).
- **Where they live:** on the PC in `C:\ycgsf\trips\` (stored by `server/app.py`, `/trips` routes), on the phone in `Documents/trips/` (newest 10 only). If the upload failed (no network), copy from the phone over USB: `xcrun devicectl device copy from --device <id> --domain-type appDataContainer --domain-identifier com.ycgsf.pip --source Documents/trips --destination trips`.
- **Server logs** are on the PC too: `C:\Users\hackteam\pip.log` (API), `pip-brain.log` and `pip-see.log` (the two model servers).

## Clean code contract

Checked on this Mac only. There is no GitHub CI.

- **Each file has one job.** New code goes in the file whose job it matches:
  - `frontend/app.js`: what Pip does (state, voice, guiding, server calls).
  - `frontend/ui.js`: what the screen shows. It reads app.js's state and wires the keys; it makes no decisions.
  - `frontend/index.html`: markup and CSS.
  - `ios/Pip/`: one Swift file per phone service (camera, mic, voice, ARKit, SLAM map, sensors). `PipWebView.swift` is the bridge to the web code.
  - `server/app.py`: the model server on the 4090 (conversation, speech, vision, routing). Deploy it with `tools/deploy.sh`.
  - `tools/`: scripts run by hand (checks, shader export, deploy).
  - Never edit generated files by hand: `frontend/shaders.js` (made by `tools/export_shaders.py`) and `graphify-out/`.
- **Reuse before writing.** Look for an existing helper first (graphify, then grep). If the same logic would appear twice, make it one function.
- **No dead code.** No unused functions, variables, icons or CSS, no commented-out code, no debug prints (`console.log`, Swift `print`) left in. Delete instead of commenting out; git keeps the old version. If `tools/check_code.py` flags something Claude didn't make, ask before deleting it (see the Cleanup contract).
- **Names say what things do** (`planTo`, `showListen`). Short names are only for the app-wide objects that already exist: `S` (app state) and `N` (phone sensor data).
- **Comments explain why, not what.** One short line for a choice that isn't obvious, with the reason or the measurement behind it. A new number that tunes behavior (a timeout, a distance, an angle) gets its unit and where the value came from.
- **Don't hide errors.** A `catch` (Python: `except`) handles the error or logs it: `log(...)` in the app, so it lands in the trip log; `logging` in the server. Empty catches are only for cleanup that is allowed to fail (stopping audio, releasing the mic).
- **No new dependencies without asking.** The web app is plain JavaScript with no build step and no npm; `tools/` uses only Python's standard library; the iPhone app uses only Apple frameworks; the server's packages are listed in `server/requirements.txt`.
- **Small, focused changes.** Each change does one thing. Don't reformat or rename code the task doesn't touch. One topic per commit; the message says what changed and why.
- **Before calling it done:** run `python3 tools/check_code.py` (it must print "clean"), `python3 tools/check_design.py` after UI changes, and an Xcode build after Swift changes. Then run `graphify update .`.

## graphify

The code graph in `graphify-out/` maps the files and functions and how they connect.

- **Graph first.** Before reading or grepping code to answer a question or plan a change, run `graphify query "<question>"`, `graphify path "<A>" "<B>"` or `graphify explain "<concept>"`. Open source files after that, for the exact lines. Read `graphify-out/GRAPH_REPORT.md` only for a broad architecture review.
- **Keep it current.** After changing code, run `graphify update .` (the git commit hook also does this for code). After changing docs (README, CLAUDE.md, docs/), run `/graphify --update`.
- **Big diffs are expected.** `graphify-out/graph.json` is rewritten whole on every build. Don't flag it as churn or suggest skipping the rebuild or its hooks.
- **What it skips:** `design/tokens.json`, because the word "tokens" looks like a secret to it. That file is not secret; read it directly.
