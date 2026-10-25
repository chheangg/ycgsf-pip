# Graph Report - ycgsf-pip  (2026-10-25)

## Corpus Check
- 0 files · ~0 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 679 nodes · 1664 edges · 34 communities (22 shown, 12 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 50 edges (avg confidence: 0.85)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- locate()
- index.html (Pip screen markup and styles)
- app.js
- How it works
- say()
- ARSense
- ui.js
- app.py
- Mic
- Camera
- Voice
- post
- SlamMap
- json
- Sensors
- render()
- slamMap()
- _json()
- missionStep()
- PipWebView.swift
- PipWebView
- Bridge
- .write()
- panorama()
- replayPoints()
- llm()
- icons.js
- same_thing()
- shaders.js
- run.sh
- deploy.sh

## God Nodes (most connected - your core abstractions)
1. `say()` - 63 edges
2. `log()` - 48 edges
3. `ARSense` - 31 edges
4. `render()` - 29 edges
5. `Voice` - 25 edges
6. `Sensors` - 24 edges
7. `slamMap()` - 24 edges
8. `index.html (Pip screen markup and styles)` - 24 edges
9. `act()` - 23 edges
10. `Camera` - 22 edges

## Surprising Connections (you probably didn't know these)
- `PipWebView` --references--> `index.html (Pip screen markup and styles)`  [INFERRED]
  ios/Pip/PipWebView.swift → frontend/index.html
- `Model server Python requirements` --references--> `Kokoro-82M voice (af_heart, kokoro-onnx, /tts)`  [AMBIGUOUS]
  server/requirements.txt → README.md
- `Info.plist privacy usage descriptions (camera, mic, motion, location, local network)` --references--> `Sensors`  [INFERRED]
  ios/project.yml → ios/Pip/Sensors.swift
- `Pip iOS app target (com.ycgsf.pip, iOS 17)` --references--> `PipApp`  [INFERRED]
  ios/project.yml → ios/Pip/PipApp.swift
- `Info.plist privacy usage descriptions (camera, mic, motion, location, local network)` --references--> `ARSense`  [INFERRED]
  ios/project.yml → ios/Pip/ARSense.swift

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Models on the RTX 4090** — readme_brain_qwen3_14b, readme_qwen2_5_vl_7b, readme_speech_to_text, readme_kokoro_82m, readme_yolo11n, readme_depth_anything_v2, readme_owlv2 [EXTRACTED 1.00]
- **Room-by-room navigation loop (plan, guide, check, backtrack)** — readme_long_term_planner, readme_short_term_planner, readme_arrival_check, readme_backtracking, readme_unknown_places [EXTRACTED 1.00]
- **Design contract implemented in index.html (tokens, shared components, button states, accessibility)** — claude_pen_dev_design_contract, frontend_index_css_tokens, frontend_index_voice_bar, frontend_index_key_states, frontend_index_reduce_motion, frontend_index_larger_text [INFERRED 0.85]
- **iOS app bundles and shows the web frontend** — ios_project_pip_target, ios_pip_pipwebview_pipwebview, frontend_index, frontend_ui, frontend_app [INFERRED 0.85]

## Communities (34 total, 12 thin omitted)

### Community 0 - "locate()"
Cohesion: 0.07
Nodes (63): angleDiff(), backCue(), bearing(), buildPath(), circMean(), compassNow(), cue(), currentDirection() (+55 more)

### Community 1 - "index.html (Pip screen markup and styles)"
Cohesion: 0.05
Nodes (36): CLAUDE.md (Pip project instructions), Button States frame (ready, pressed, working, done, unavailable), tools/check_code.py code check (must print "clean"), tools/check_design.py design check (must print "matches"), Pip design screens (01 Start through 09 Route preview), Design tokens (design/tokens.json, CSS variables --bg, --fg, --accent), Pip model server (server/ on the RTX 4090, reached over Tailscale), Motion + Gestures frame (+28 more)

### Community 2 - "app.js"
Cohesion: 0.07
Nodes (46): askPip(), audioLoop(), bestPlace(), checkServer(), chunks, EXIT_WORDS, fallbackVoice(), HAND_WORDS (+38 more)

### Community 3 - "How it works"
Cohesion: 0.08
Nodes (35): Apple Maps walking directions, Apple Vision text recognition (signs, exit signs), Published studies with blind users (turn words, tap rates, progress tones), Brain: Qwen3-14B tool-calling agent, Browser (desk testing), Clew (occamLab route-following app), Depth-Anything-V2-Small (camera-only distance), Harnesses (find object, obstacle stop, door coaching, room check, door vs look-alike) (+27 more)

### Community 4 - "say()"
Cohesion: 0.15
Nodes (37): act(), answerLocally(), askPipNow(), cleanQuery(), describe(), ensureCamera(), ensureGPS(), findCue() (+29 more)

### Community 5 - "ARSense"
Cohesion: 0.09
Nodes (11): ARSense, .depth, .frameId, .jpeg, .mapping, .mapsDir, .pose, .supported (+3 more)

### Community 6 - "ui.js"
Cohesion: 0.12
Nodes (25): frame(), stopAll(), avail(), countTurns(), drawLog(), drawPlaces(), fillRing(), fillSegs() (+17 more)

### Community 7 - "app.py"
Cohesion: 0.12
Nodes (17): BacktrackRequest, _bearing(), find_places(), geocode(), get_route(), LatLon, maps_link(), _meters() (+9 more)

### Community 8 - "Mic"
Cohesion: 0.09
Nodes (10): ARKit, AVFoundation, CoreImage, CoreLocation, CoreMotion, Foundation, Mic, simd (+2 more)

### Community 9 - "Camera"
Cohesion: 0.12
Nodes (4): Camera, .depth, .jpeg, Depth

### Community 11 - "post"
Cohesion: 0.13
Nodes (12): _crop(), device(), _drop_lookalikes(), get(), health(), _iou(), local(), locate() (+4 more)

### Community 12 - "SlamMap"
Cohesion: 0.14
Nodes (8): Cell, free, occupied, unknown, Door, Frontier, SlamMap, .knownCells

### Community 13 - "json"
Cohesion: 0.16
Nodes (5): agent(), names_a_location(), talk(), uses(), build()

### Community 15 - "render()"
Cohesion: 0.24
Nodes (18): atSign(), backtrack(), giveUp(), goToSign(), leaveMark(), leaveSample(), obstacleCheck(), previewCancel() (+10 more)

### Community 16 - "slamMap()"
Cohesion: 0.24
Nodes (17): aRoom(), b64ToBlob(), doneChime(), doorBlocked(), frameBlob(), hopCheck(), hopDone(), leaveCheck() (+9 more)

### Community 17 - "_json()"
Cohesion: 0.17
Nodes (9): check_room(), confirm(), decide_slam(), describe(), door(), door_words(), _json(), describe_view() (+1 more)

### Community 18 - "missionStep()"
Cohesion: 0.22
Nodes (16): doorHow(), doorStep(), doorThrough(), doorWait(), doorWaitStart(), endLeg(), HANDLE_LABELS, handleStep() (+8 more)

### Community 19 - "PipWebView.swift"
Cohesion: 0.15
Nodes (10): PipApp, .body, PipView, .body, LogFile, Screen, .body, MapKit (+2 more)

### Community 20 - "PipWebView"
Cohesion: 0.26
Nodes (3): PipWebView, PipWKWebView, ScreenPreview

### Community 23 - "panorama()"
Cohesion: 0.20
Nodes (5): panorama(), place_of(), plain_target(), turn_phrase(), wrong_place()

### Community 24 - "replayPoints()"
Cohesion: 0.33
Nodes (7): arReady(), askNative(), pinLandmark(), readSigns(), replayPoints(), replayTimed(), slamReady()

### Community 25 - "llm()"
Cohesion: 0.40
Nodes (3): backtrack(), chat(), llm()

## Ambiguous Edges - Review These
- `Model server Python requirements` → `Kokoro-82M voice (af_heart, kokoro-onnx, /tts)`  [AMBIGUOUS]
  server/requirements.txt · relation: references

## Knowledge Gaps
- **38 isolated node(s):** `free`, `occupied`, `unknown`, `.knownCells`, `.jpeg` (+33 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 183 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Info.plist privacy usage descriptions (camera, mic, motion, location, local network)` connect `index.html (Pip screen markup and styles)` to `Mic`, `Camera`, `ARSense`, `Sensors`?**
  _High betweenness centrality (0.093) - this node is a cross-community bridge._
- **Are the 2 inferred relationships involving `ARSense` (e.g. with `SlamMap` and `Info.plist privacy usage descriptions (camera, mic, motion, location, local network)`) actually correct?**
  _`ARSense` has 2 INFERRED edges - model-reasoned connections that need verification._
- **What connects `free`, `occupied`, `unknown` to the rest of the system?**
  _38 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `locate()` be split into smaller, more focused modules?**
  _Cohesion score 0.07168458781362007 - nodes in this community are weakly interconnected._
- **Why does `ARSense` connect `ARSense` to `Mic`, `index.html (Pip screen markup and styles)`, `SlamMap`, `Sensors`?**
  _High betweenness centrality (0.078) - this node is a cross-community bridge._
- **Should `index.html (Pip screen markup and styles)` be split into smaller, more focused modules?**
  _Cohesion score 0.05454545454545454 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Model server Python requirements` and `Kokoro-82M voice (af_heart, kokoro-onnx, /tts)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._