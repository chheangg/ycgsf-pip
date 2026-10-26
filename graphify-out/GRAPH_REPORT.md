# Graph Report - ycgsf-pip  (2026-10-25)

## Corpus Check
- 25 files · ~101,009 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 19 file(s) not represented in the graph (top: .glsl 9, (none) 3, .woff2 2)

## Summary
- 739 nodes · 1870 edges · 38 communities (24 shown, 14 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 57 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `d764b8d5`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- gpsCue
- index.html (Pip screen markup and styles)
- app.js
- How it works
- log
- ARSense
- ui.js
- app.py
- Mic
- Camera
- Voice
- post
- SlamMap
- re
- PipWebView.swift
- render
- Trip
- asyncio
- PipWebView
- Sensors
- trip_report.py
- rad
- ARSense.swift
- json
- Bridge
- .session
- icons.js
- Sensors.swift
- dist
- shaders.js
- run.sh
- deploy.sh
- trip_file
- pull_trip.sh
- .readText
- .snapshot
- say

## God Nodes (most connected - your core abstractions)
1. `say()` - 70 edges
2. `log()` - 54 edges
3. `ARSense` - 33 edges
4. `render()` - 30 edges
5. `act()` - 27 edges
6. `Sensors` - 26 edges
7. `Voice` - 25 edges
8. `roomDist()` - 24 edges
9. `index.html (Pip screen markup and styles)` - 24 edges
10. `Camera` - 23 edges

## Surprising Connections (you probably didn't know these)
- `PipWebView` --references--> `index.html (Pip screen markup and styles)`  [INFERRED]
  ios/Pip/PipWebView.swift → frontend/index.html
- `Model server Python requirements` --references--> `Kokoro-82M voice (af_heart, kokoro-onnx, /tts)`  [AMBIGUOUS]
  server/requirements.txt → README.md
- `Info.plist privacy usage descriptions (camera, mic, motion, location, local network)` --references--> `ARSense`  [INFERRED]
  ios/project.yml → ios/Pip/ARSense.swift
- `Info.plist privacy usage descriptions (camera, mic, motion, location, local network)` --references--> `Camera`  [INFERRED]
  ios/project.yml → ios/Pip/Camera.swift
- `Info.plist privacy usage descriptions (camera, mic, motion, location, local network)` --references--> `Mic`  [INFERRED]
  ios/project.yml → ios/Pip/Mic.swift

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Models on the RTX 4090** — readme_brain_qwen3_14b, readme_qwen2_5_vl_7b, readme_speech_to_text, readme_kokoro_82m, readme_yolo11n, readme_depth_anything_v2, readme_owlv2 [EXTRACTED 1.00]
- **Room-by-room navigation loop (plan, guide, check, backtrack)** — readme_long_term_planner, readme_short_term_planner, readme_arrival_check, readme_backtracking, readme_unknown_places [EXTRACTED 1.00]
- **Design contract implemented in index.html (tokens, shared components, button states, accessibility)** — claude_pen_dev_design_contract, frontend_index_css_tokens, frontend_index_voice_bar, frontend_index_key_states, frontend_index_reduce_motion, frontend_index_larger_text [INFERRED 0.85]
- **iOS app bundles and shows the web frontend** — ios_project_pip_target, ios_pip_pipwebview_pipwebview, frontend_index, frontend_ui, frontend_app [INFERRED 0.85]

## Communities (38 total, 14 thin omitted)

### Community 0 - "gpsCue"
Cohesion: 0.10
Nodes (43): angleDiff(), backCue(), bearing(), blockedStep(), buildPath(), compassNow(), cue(), currentDirection() (+35 more)

### Community 1 - "index.html (Pip screen markup and styles)"
Cohesion: 0.05
Nodes (37): CLAUDE.md (Pip project instructions), Button States frame (ready, pressed, working, done, unavailable), tools/check_code.py code check (must print "clean"), tools/check_design.py design check (must print "matches"), Pip design screens (01 Start through 09 Route preview), Design tokens (design/tokens.json, CSS variables --bg, --fg, --accent), Pip model server (server/ on the RTX 4090, reached over Tailscale), Motion + Gestures frame (+29 more)

### Community 2 - "app.js"
Cohesion: 0.05
Nodes (61): aRoom(), askPip(), audioLoop(), b64ToBlob(), bestPlace(), checkServer(), chunks, doorHow() (+53 more)

### Community 3 - "How it works"
Cohesion: 0.08
Nodes (34): Apple Maps walking directions, Apple Vision text recognition (signs, exit signs), Published studies with blind users (turn words, tap rates, progress tones), Brain: Qwen3-14B tool-calling agent, Browser (desk testing), Clew (occamLab route-following app), Depth-Anything-V2-Small (camera-only distance), Harnesses (find object, obstacle stop, door coaching, room check, door vs look-alike) (+26 more)

### Community 4 - "log"
Cohesion: 0.14
Nodes (31): act(), cleanQuery(), describe(), doorBlocked(), endLeg(), ensureCamera(), ensureGPS(), goalOf() (+23 more)

### Community 5 - "ARSense"
Cohesion: 0.14
Nodes (8): ARSense, .depth, .frameId, .jpeg, .mapping, .mapsDir, .supported, .tracking

### Community 6 - "ui.js"
Cohesion: 0.11
Nodes (27): frame(), stopAll(), avail(), countTurns(), drawLog(), drawPlaces(), fillRing(), fillSegs() (+19 more)

### Community 7 - "app.py"
Cohesion: 0.15
Nodes (14): _bearing(), find_places(), geocode(), get_route(), LatLon, maps_link(), _meters(), plan() (+6 more)

### Community 9 - "Camera"
Cohesion: 0.12
Nodes (3): Camera, .jpeg, Depth

### Community 11 - "post"
Cohesion: 0.12
Nodes (13): _crop(), device(), door(), door_words(), _drop_lookalikes(), get(), health(), _iou() (+5 more)

### Community 12 - "SlamMap"
Cohesion: 0.14
Nodes (8): Cell, free, occupied, unknown, Door, Frontier, SlamMap, .knownCells

### Community 13 - "re"
Cohesion: 0.23
Nodes (6): agent(), names_a_location(), run_tool(), same_thing(), _stem(), talk()

### Community 14 - "PipWebView.swift"
Cohesion: 0.15
Nodes (10): PipApp, .body, PipView, .body, LogFile, Screen, .body, MapKit (+2 more)

### Community 15 - "render"
Cohesion: 0.19
Nodes (30): askNative(), backtrack(), doneChime(), doorStep(), doorThrough(), frameBlob(), giveUp(), hopCheck() (+22 more)

### Community 17 - "asyncio"
Cohesion: 0.21
Nodes (6): chat(), check_room(), confirm(), describe(), path_ahead(), see()

### Community 18 - "PipWebView"
Cohesion: 0.23
Nodes (3): PipWebView, PipWKWebView, ScreenPreview

### Community 20 - "trip_report.py"
Cohesion: 0.09
Nodes (14): uses(), build(), cell(), changed_state(), draw_map(), dot(), line(), load() (+6 more)

### Community 21 - "rad"
Cohesion: 0.24
Nodes (11): addBlock(), arReady(), move(), rad(), relativeAlign(), replay(), replayPoints(), replayTimed() (+3 more)

### Community 22 - "ARSense.swift"
Cohesion: 0.25
Nodes (5): ARKit, CoreImage, simd, UIKit, Vision

### Community 23 - "json"
Cohesion: 0.13
Nodes (13): backtrack(), BacktrackRequest, decide_slam(), _json(), llm(), panorama(), describe_view(), place_of() (+5 more)

### Community 27 - "Sensors.swift"
Cohesion: 0.29
Nodes (4): AVFoundation, CoreLocation, CoreMotion, Foundation

### Community 28 - "dist"
Cohesion: 0.13
Nodes (23): circMean(), deg(), dist(), endSegment(), followRoute(), learnEnd(), learnTick(), leaveGoal() (+15 more)

### Community 32 - "trip_file"
Cohesion: 0.27
Nodes (4): trip_dir(), trip_file(), trip_have(), trip_trace()

### Community 38 - "say"
Cohesion: 0.16
Nodes (22): answerLocally(), aroundCheck(), askPipNow(), atSign(), findCue(), findKey(), findStart(), findStep() (+14 more)

## Ambiguous Edges - Review These
- `Model server Python requirements` → `Kokoro-82M voice (af_heart, kokoro-onnx, /tts)`  [AMBIGUOUS]
  server/requirements.txt · relation: references

## Knowledge Gaps
- **36 isolated node(s):** `Vision`, `.supported`, `.jpeg`, `.depth`, `.tracking` (+31 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 189 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Sensors` connect `Sensors` to `index.html (Pip screen markup and styles)`, `.snapshot`, `ARSense`, `Mic`, `Camera`, `Voice`, `PipWebView.swift`, `PipWebView`, `Bridge`, `Sensors.swift`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `ARSense` (e.g. with `SlamMap` and `Sensors`) actually correct?**
  _`ARSense` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Vision`, `.supported`, `.jpeg` to the rest of the system?**
  _36 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `gpsCue` be split into smaller, more focused modules?**
  _Cohesion score 0.10299003322259136 - nodes in this community are weakly interconnected._
- **Why does `ARSense` connect `ARSense` to `index.html (Pip screen markup and styles)`, `.readText`, `.snapshot`, `Mic`, `SlamMap`, `Sensors`, `ARSense.swift`, `.session`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Should `index.html (Pip screen markup and styles)` be split into smaller, more focused modules?**
  _Cohesion score 0.05200501253132832 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Model server Python requirements` and `Kokoro-82M voice (af_heart, kokoro-onnx, /tts)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._