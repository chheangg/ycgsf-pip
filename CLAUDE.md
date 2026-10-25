# Pip app (iPhone + screen) and design

This repo holds Pip's app: `frontend/` (the screen and app logic), `ios/` (the iPhone app that shows `frontend/`), `design/` (the pen.dev design `design/untitled.pen`, its tokens and shaders) and `tools/` (the design check and shader export). `run.sh` serves `frontend/` on localhost. The model server, trip recordings and trip tools live in the separate ycgsf repo (`../ycgsf-pip` on this Mac).

## Design contract with pen.dev

The pen.dev file `design/untitled.pen` is the single source of truth for how Pip looks. Its screens (the code that shows each one is in `frontend/ui.js`):

- **01 Start**
- **02 Listening**, plus 02b Planner offline, 02c GPS weak, 02d Muted, 02e Looking
- **03 Guiding**, plus 03b On course, 03c Off course, 03d Hazard, 03e Lost tracking, 03f Outdoors, 03g Arrived, 03h Paused, 03i Getting bearings, 03j Recognizing room
- **04 Find**, plus 04b Looking around
- **05 Setup**, plus 05b Log
- **06 Teach**: Orient, 06b Recording, 06c Saved
- **07 Places**
- **08 Search**: Restroom, 08b Grocery, 08c Looking around
- **09 Route preview**

Shared components: Status Bar, Key, Mute, Mute · On, Say Chip. The Button States frame shows how a key looks when ready, pressed, working, done and unavailable. The Motion + Gestures frame holds the motion, navigation and accessibility rules. Frame ids and each screen's fixed labels are in `design/tokens.json`.

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

- **On the Mac (test it yourself):** anything that doesn't need someone walking around. That covers screens, animations and layout (iOS Simulator or a browser), the design check, builds, speech and taps, server replies, and reading logs and trip recordings.
- **On the phone (leave it to the user):** Pip's main job, which needs a person moving through a real place. That covers pathfinding, guiding, teaching and following routes, GPS walks, finding a room or a grocery aisle, obstacle warnings, ARKit/LiDAR tracking and camera finding. Don't build simulated walks or fake environments to test these. Ask the user to try it, then pull the trip recording (`tools/pull_trip.sh` in the ycgsf repo) and diagnose from the real data.

## graphify

This project has a knowledge graph at graphify-out/ with god nodes, community structure, and cross-file relationships.

Rules:
- For codebase questions, first run `graphify query "<question>"` when graphify-out/graph.json exists. Use `graphify path "<A>" "<B>"` for relationships and `graphify explain "<concept>"` for focused concepts. These return a scoped subgraph, usually much smaller than GRAPH_REPORT.md or raw grep output.
- If graphify-out/wiki/index.md exists, use it for broad navigation instead of raw source browsing.
- Read graphify-out/GRAPH_REPORT.md only for broad architecture review or when query/path/explain do not surface enough context.
- After modifying code, run `graphify update .` to keep the graph current (AST-only, no API cost).
- A committed graphify-out/graph.json is rewritten whole on every build, so a large diff to it in a pull request is expected. Do not flag it as churn or suggest skipping the graph rebuild or its hooks.

## Using graphify on Pip (contract)

- **Graph first.** Before reading or grepping code to answer a question or plan a change, run `graphify query`, `graphify path` or `graphify explain`. Open source files after that, for the exact lines.
- **Keep it current.** After changing code, run `graphify update .`. The git commit hook does this for code only; after changing docs (README, CLAUDE.md, docs/), run `/graphify --update`.
- **What it skips:** graphify skips `design/tokens.json` because the word "tokens" looks like a secret to it. That file is not secret; read it directly.
