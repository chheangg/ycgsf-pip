# Graph Report - ycgsf-pip  (2026-10-25)

## Corpus Check
- 23 files · ~68,632 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 16 file(s) not represented in the graph (top: .glsl 6, (none) 3, .woff2 2)

## Summary
- 727 nodes · 1812 edges · 29 communities (22 shown, 7 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 56 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f38aaef9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- walkCue
- index.html (Pip screen markup and styles)
- app.js
- How it works
- say
- ARSense
- ui.js
- app.py
- start
- Camera
- Voice
- post
- SlamMap
- re
- render
- _json
- Sensors
- trip_report.py
- panorama
- llm
- icons.js
- locate
- shaders.js
- run.sh
- deploy.sh
- trip_file
- pull_trip.sh
- aroundCheck

## God Nodes (most connected - your core abstractions)
1. `say()` - 68 edges
2. `log()` - 50 edges
3. `ARSense` - 33 edges
4. `render()` - 30 edges
5. `act()` - 27 edges
6. `Sensors` - 26 edges
7. `slamMap()` - 25 edges
8. `Voice` - 25 edges
9. `index.html (Pip screen markup and styles)` - 24 edges
10. `roomDist()` - 23 edges

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

## Communities (29 total, 7 thin omitted)

### Community 0 - "walkCue"
Cohesion: 0.15
Nodes (28): audioLoop(), blockedStep(), compassNow(), cue(), currentDirection(), distWords(), gpsCue(), gpsLeg() (+20 more)

### Community 1 - "index.html (Pip screen markup and styles)"
Cohesion: 0.05
Nodes (37): CLAUDE.md (Pip project instructions), Button States frame (ready, pressed, working, done, unavailable), tools/check_code.py code check (must print "clean"), tools/check_design.py design check (must print "matches"), Pip design screens (01 Start through 09 Route preview), Design tokens (design/tokens.json, CSS variables --bg, --fg, --accent), Pip model server (server/ on the RTX 4090, reached over Tailscale), Motion + Gestures frame (+29 more)

### Community 2 - "app.js"
Cohesion: 0.05
Nodes (57): askPip(), bestPlace(), buildPath(), chunks, cleanQuery(), doorBlocked(), doorHow(), doorWait() (+49 more)

### Community 3 - "How it works"
Cohesion: 0.08
Nodes (34): Apple Maps walking directions, Apple Vision text recognition (signs, exit signs), Published studies with blind users (turn words, tap rates, progress tones), Brain: Qwen3-14B tool-calling agent, Browser (desk testing), Clew (occamLab route-following app), Depth-Anything-V2-Small (camera-only distance), Harnesses (find object, obstacle stop, door coaching, room check, door vs look-alike) (+26 more)

### Community 4 - "say"
Cohesion: 0.18
Nodes (34): act(), answerLocally(), askPipNow(), describe(), ensureCamera(), ensureGPS(), findStart(), goBack() (+26 more)

### Community 5 - "ARSense"
Cohesion: 0.08
Nodes (12): ARSense, .depth, .frameId, .jpeg, .mapping, .mapsDir, .pose, .supported (+4 more)

### Community 6 - "ui.js"
Cohesion: 0.11
Nodes (27): frame(), stopAll(), avail(), countTurns(), drawLog(), drawPlaces(), fillRing(), fillSegs() (+19 more)

### Community 7 - "app.py"
Cohesion: 0.15
Nodes (14): _bearing(), find_places(), geocode(), get_route(), LatLon, maps_link(), _meters(), plan() (+6 more)

### Community 8 - "start"
Cohesion: 0.27
Nodes (10): checkServer(), fallbackVoice(), hush(), pickBuiltinMic(), playLine(), speakNow(), start(), startMic() (+2 more)

### Community 9 - "Camera"
Cohesion: 0.07
Nodes (4): Camera, .jpeg, Depth, Mic

### Community 11 - "post"
Cohesion: 0.13
Nodes (12): _crop(), device(), _drop_lookalikes(), get(), health(), _iou(), local(), locate() (+4 more)

### Community 12 - "SlamMap"
Cohesion: 0.07
Nodes (17): ARKit, AVFoundation, CoreImage, CoreLocation, CoreMotion, Foundation, Cell, free (+9 more)

### Community 13 - "re"
Cohesion: 0.22
Nodes (6): agent(), names_a_location(), run_tool(), same_thing(), _stem(), talk()

### Community 15 - "render"
Cohesion: 0.13
Nodes (42): aRoom(), askNative(), atSign(), b64ToBlob(), backtrack(), doneChime(), doorStep(), doorThrough() (+34 more)

### Community 17 - "_json"
Cohesion: 0.21
Nodes (8): check_room(), confirm(), describe(), door(), door_words(), _json(), describe_view(), see()

### Community 19 - "Sensors"
Cohesion: 0.05
Nodes (17): PipApp, .body, PipView, .body, Bridge, LogFile, PipWebView, PipWKWebView (+9 more)

### Community 20 - "trip_report.py"
Cohesion: 0.09
Nodes (14): uses(), build(), cell(), changed_state(), draw_map(), dot(), line(), load() (+6 more)

### Community 23 - "panorama"
Cohesion: 0.20
Nodes (5): panorama(), place_of(), plain_target(), turn_phrase(), wrong_place()

### Community 25 - "llm"
Cohesion: 0.22
Nodes (6): backtrack(), BacktrackRequest, chat(), decide_slam(), llm(), SlamDecision

### Community 28 - "locate"
Cohesion: 0.11
Nodes (36): angleDiff(), arReady(), backCue(), bearing(), circMean(), deg(), dist(), endSegment() (+28 more)

### Community 32 - "trip_file"
Cohesion: 0.27
Nodes (4): trip_dir(), trip_file(), trip_have(), trip_trace()

### Community 38 - "aroundCheck"
Cohesion: 0.50
Nodes (4): aroundCheck(), rerouteWalk(), trailTick(), walkBackShort()

## Ambiguous Edges - Review These
- `Model server Python requirements` → `Kokoro-82M voice (af_heart, kokoro-onnx, /tts)`  [AMBIGUOUS]
  server/requirements.txt · relation: references

## Knowledge Gaps
- **36 isolated node(s):** `Vision`, `.supported`, `.jpeg`, `.depth`, `.tracking` (+31 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 188 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **7 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Sensors` connect `Sensors` to `index.html (Pip screen markup and styles)`, `ARSense`, `Camera`, `Voice`, `SlamMap`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `ARSense` (e.g. with `SlamMap` and `Sensors`) actually correct?**
  _`ARSense` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Vision`, `.supported`, `.jpeg` to the rest of the system?**
  _36 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `walkCue` be split into smaller, more focused modules?**
  _Cohesion score 0.14814814814814814 - nodes in this community are weakly interconnected._
- **Why does `ARSense` connect `ARSense` to `Camera`, `Sensors`, `SlamMap`, `index.html (Pip screen markup and styles)`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Should `index.html (Pip screen markup and styles)` be split into smaller, more focused modules?**
  _Cohesion score 0.05200501253132832 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Model server Python requirements` and `Kokoro-82M voice (af_heart, kokoro-onnx, /tts)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._