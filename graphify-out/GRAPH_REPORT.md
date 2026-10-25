# Graph Report - ycgsf-pip  (2026-10-25)

## Corpus Check
- 23 files · ~66,879 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 14 file(s) not represented in the graph (top: .glsl 5, (none) 3, .pen 1)

## Summary
- 723 nodes · 1804 edges · 35 communities (25 shown, 10 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 56 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `1d94d1b3`
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
- Sensors.swift
- Camera
- Voice
- post
- SlamMap
- json
- Sensors
- render
- slamMap
- _json
- missionStep
- Trip
- trip_report.py
- rad
- Mic
- panorama
- start
- plan
- icons.js
- .snapshot
- dist
- shaders.js
- run.sh
- deploy.sh
- trip_file
- pull_trip.sh

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

## Communities (35 total, 10 thin omitted)

### Community 0 - "walkCue"
Cohesion: 0.18
Nodes (25): angleDiff(), blockedStep(), buildPath(), compassNow(), currentDirection(), distWords(), gpsCue(), gpsLeg() (+17 more)

### Community 1 - "index.html (Pip screen markup and styles)"
Cohesion: 0.05
Nodes (37): CLAUDE.md (Pip project instructions), Button States frame (ready, pressed, working, done, unavailable), tools/check_code.py code check (must print "clean"), tools/check_design.py design check (must print "matches"), Pip design screens (01 Start through 09 Route preview), Design tokens (design/tokens.json, CSS variables --bg, --fg, --accent), Pip model server (server/ on the RTX 4090, reached over Tailscale), Motion + Gestures frame (+29 more)

### Community 2 - "app.js"
Cohesion: 0.05
Nodes (49): askPip(), backCue(), bestPlace(), chunks, cleanQuery(), cue(), EXIT_WORDS, findCue() (+41 more)

### Community 3 - "How it works"
Cohesion: 0.08
Nodes (34): Apple Maps walking directions, Apple Vision text recognition (signs, exit signs), Published studies with blind users (turn words, tap rates, progress tones), Brain: Qwen3-14B tool-calling agent, Browser (desk testing), Clew (occamLab route-following app), Depth-Anything-V2-Small (camera-only distance), Harnesses (find object, obstacle stop, door coaching, room check, door vs look-alike) (+26 more)

### Community 4 - "say"
Cohesion: 0.18
Nodes (35): act(), answerLocally(), askPipNow(), describe(), ensureCamera(), ensureGPS(), findStart(), goBack() (+27 more)

### Community 5 - "ARSense"
Cohesion: 0.10
Nodes (10): ARSense, .depth, .frameId, .jpeg, .mapping, .mapsDir, .supported, .tracking (+2 more)

### Community 6 - "ui.js"
Cohesion: 0.13
Nodes (24): frame(), avail(), countTurns(), drawLog(), drawPlaces(), fillRing(), fillSegs(), find() (+16 more)

### Community 7 - "app.py"
Cohesion: 0.10
Nodes (14): backtrack(), BacktrackRequest, _bearing(), decide_slam(), _drop_lookalikes(), _iou(), _meters(), PlanRequest (+6 more)

### Community 8 - "Sensors.swift"
Cohesion: 0.13
Nodes (9): ARKit, AVFoundation, CoreImage, CoreLocation, CoreMotion, Foundation, simd, UIKit (+1 more)

### Community 9 - "Camera"
Cohesion: 0.13
Nodes (3): Camera, .jpeg, Depth

### Community 11 - "post"
Cohesion: 0.15
Nodes (11): _crop(), device(), get(), health(), local(), locate(), replan(), scan() (+3 more)

### Community 12 - "SlamMap"
Cohesion: 0.14
Nodes (8): Cell, free, occupied, unknown, Door, Frontier, SlamMap, .knownCells

### Community 13 - "json"
Cohesion: 0.17
Nodes (5): agent(), names_a_location(), run_tool(), uses(), build()

### Community 15 - "render"
Cohesion: 0.18
Nodes (22): aroundCheck(), arReady(), askNative(), atSign(), backtrack(), giveUp(), goToSign(), pinLandmark() (+14 more)

### Community 16 - "slamMap"
Cohesion: 0.26
Nodes (16): aRoom(), b64ToBlob(), doneChime(), doorBlocked(), frameBlob(), hopCheck(), hopDone(), leaveCheck() (+8 more)

### Community 17 - "_json"
Cohesion: 0.21
Nodes (8): check_room(), confirm(), describe(), door(), door_words(), _json(), describe_view(), see()

### Community 18 - "missionStep"
Cohesion: 0.19
Nodes (19): doorHow(), doorStep(), doorThrough(), doorWait(), doorWaitStart(), endLeg(), HANDLE_LABELS, handleStep() (+11 more)

### Community 19 - "Trip"
Cohesion: 0.07
Nodes (15): PipApp, .body, PipView, .body, Bridge, LogFile, PipWebView, PipWKWebView (+7 more)

### Community 20 - "trip_report.py"
Cohesion: 0.15
Nodes (12): cell(), changed_state(), draw_map(), dot(), line(), load(), main(), marks_of() (+4 more)

### Community 21 - "rad"
Cohesion: 0.17
Nodes (18): bearing(), circMean(), deg(), leaveGoal(), leaveMark(), leaveOffset(), leaveSample(), legBearing() (+10 more)

### Community 23 - "panorama"
Cohesion: 0.20
Nodes (5): panorama(), place_of(), plain_target(), turn_phrase(), wrong_place()

### Community 24 - "start"
Cohesion: 0.22
Nodes (14): audioLoop(), checkServer(), fallbackVoice(), hush(), invert(), pickBuiltinMic(), playLine(), speakNow() (+6 more)

### Community 25 - "plan"
Cohesion: 0.26
Nodes (10): chat(), find_places(), geocode(), get_route(), LatLon, llm(), maps_link(), plan() (+2 more)

### Community 28 - "dist"
Cohesion: 0.23
Nodes (14): dist(), endSegment(), followRoute(), learnEnd(), learnTick(), legDist(), meters(), onFix() (+6 more)

### Community 32 - "trip_file"
Cohesion: 0.27
Nodes (4): trip_dir(), trip_file(), trip_have(), trip_trace()

## Ambiguous Edges - Review These
- `Model server Python requirements` → `Kokoro-82M voice (af_heart, kokoro-onnx, /tts)`  [AMBIGUOUS]
  server/requirements.txt · relation: references

## Knowledge Gaps
- **36 isolated node(s):** `Vision`, `.supported`, `.jpeg`, `.depth`, `.tracking` (+31 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 189 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **10 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Sensors` connect `Sensors` to `index.html (Pip screen markup and styles)`, `ARSense`, `Sensors.swift`, `Camera`, `Voice`, `Trip`, `Mic`, `.snapshot`?**
  _High betweenness centrality (0.086) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `ARSense` (e.g. with `SlamMap` and `Sensors`) actually correct?**
  _`ARSense` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Vision`, `.supported`, `.jpeg` to the rest of the system?**
  _36 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `index.html (Pip screen markup and styles)` be split into smaller, more focused modules?**
  _Cohesion score 0.05200501253132832 - nodes in this community are weakly interconnected._
- **Why does `ARSense` connect `ARSense` to `index.html (Pip screen markup and styles)`, `Sensors.swift`, `SlamMap`, `Sensors`, `Trip`, `.snapshot`?**
  _High betweenness centrality (0.070) - this node is a cross-community bridge._
- **Should `app.js` be split into smaller, more focused modules?**
  _Cohesion score 0.05429864253393665 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Model server Python requirements` and `Kokoro-82M voice (af_heart, kokoro-onnx, /tts)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._