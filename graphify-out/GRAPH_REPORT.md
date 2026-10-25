# Graph Report - ycgsf-pip  (2026-10-25)

## Corpus Check
- 21 files · ~61,430 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 14 file(s) not represented in the graph (top: .glsl 5, (none) 3, .pen 1)

## Summary
- 674 nodes · 1734 edges · 27 communities (23 shown, 4 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 87 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `e679b88f`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Models
- index.html (Pip screen markup and styles)
- app.js
- ui.js
- Camera
- ARSense
- learnEnd
- render
- Voice
- rad
- SlamMap
- post
- say
- locate
- app.py
- Sensors
- missionStep
- panorama
- replan
- plan
- llm
- PipApp
- Bridge
- PipWebView.swift
- .write
- PipWebView
- re

## God Nodes (most connected - your core abstractions)
1. `say()` - 62 edges
2. `log()` - 46 edges
3. `ARSense` - 34 edges
4. `render()` - 29 edges
5. `Sensors` - 26 edges
6. `Voice` - 25 edges
7. `slamMap()` - 24 edges
8. `Camera` - 23 edges
9. `act()` - 22 edges
10. `lookAround()` - 21 edges

## Surprising Connections (you probably didn't know these)
- `Testing contract: Mac vs phone` --references--> `ARSense`  [INFERRED]
  CLAUDE.md → ios/Pip/ARSense.swift
- `PipWebView` --references--> `index.html (Pip screen markup and styles)`  [INFERRED]
  ios/Pip/PipWebView.swift → frontend/index.html
- `Trip recordings (trips/: sensors, photos, floor map)` --conceptually_related_to--> `Trip`  [INFERRED]
  CLAUDE.md → ios/Pip/PipWebView.swift
- `Don't hide errors` --references--> `log()`  [EXTRACTED]
  CLAUDE.md → frontend/app.js
- `Names say what things do` --references--> `planTo()`  [EXTRACTED]
  CLAUDE.md → frontend/app.js

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Before-done verification gate (code check, design check, graph update)** — claude_definition_of_done, claude_check_code_py, claude_check_design_py, claude_graphify_contract [EXTRACTED 1.00]
- **Pip guidance pipeline (hear, decide, plan, guide, speak)** — readme_speech_to_text, readme_brain_qwen3_14b, readme_long_term_planner, readme_short_term_planner, readme_tap_guidance, readme_kokoro_82m [EXTRACTED 1.00]
- **Open-weight models served on one RTX 4090** — readme_brain_qwen3_14b, readme_qwen2_5_vl_7b, readme_speech_to_text, readme_kokoro_82m, readme_yolo11n, readme_depth_anything_v2, readme_owlv2 [EXTRACTED 1.00]
- **iOS app bundles and shows the web frontend** — ios_project_pip_target, ios_pip_pipwebview_pipwebview, frontend_index, frontend_ui, frontend_app [INFERRED 0.85]

## Communities (27 total, 4 thin omitted)

### Community 0 - "Models"
Cohesion: 0.06
Nodes (46): ARKit, AVFoundation, Pip model server (server/ on the RTX 4090, reached over Tailscale), CoreImage, CoreLocation, CoreMotion, Foundation, project.yml (XcodeGen spec for the Pip iOS app) (+38 more)

### Community 1 - "index.html (Pip screen markup and styles)"
Cohesion: 0.05
Nodes (29): CLAUDE.md (Pip project instructions), tools/check_code.py code check (must print "clean"), tools/check_design.py design check (must print "matches"), Design tokens (design/tokens.json, CSS variables --bg, --fg, --accent), Motion + Gestures frame, tools/pull_trip.sh (ycgsf repo), Shared design components (Status Bar, Key, Mute, Mute · On, Say Chip), Trip recordings (trips/: sensors, photos, floor map) (+21 more)

### Community 2 - "app.js"
Cohesion: 0.06
Nodes (54): audioLoop(), backCue(), chunks, cue(), EXIT_WORDS, fallbackVoice(), findCue(), findKey() (+46 more)

### Community 3 - "ui.js"
Cohesion: 0.09
Nodes (41): Button States frame (ready, pressed, working, done, unavailable), Pip design screens (01 Start through 09 Route preview), frame(), Key state styles (pressed, work, done, na), Say Chip (.chip), Say type scale (.s64 to .s26), 04 Find screen (#scr-find), 03 Guiding screen (#scr-guide) (+33 more)

### Community 4 - "Camera"
Cohesion: 0.08
Nodes (4): Camera, .jpeg, Depth, Mic

### Community 5 - "ARSense"
Cohesion: 0.08
Nodes (12): ARSense, .depth, .frameId, .jpeg, .mapping, .mapsDir, .pose, .supported (+4 more)

### Community 6 - "learnEnd"
Cohesion: 0.21
Nodes (16): checkServer(), dist(), endSegment(), followRoute(), learnEnd(), learnTick(), legDist(), meters() (+8 more)

### Community 7 - "render"
Cohesion: 0.13
Nodes (39): aRoom(), askNative(), atSign(), b64ToBlob(), backtrack(), doneChime(), doorBlocked(), doorStep() (+31 more)

### Community 8 - "Voice"
Cohesion: 0.14
Nodes (3): 05 Setup screen (#scr-setup), setup(), Voice

### Community 9 - "rad"
Cohesion: 0.14
Nodes (22): angleDiff(), bearing(), buildPath(), circMean(), deg(), hazardCheck(), keypoints(), leaveGoal() (+14 more)

### Community 10 - "SlamMap"
Cohesion: 0.14
Nodes (8): Cell, free, occupied, unknown, Door, Frontier, SlamMap, .knownCells

### Community 11 - "post"
Cohesion: 0.17
Nodes (9): _crop(), device(), get(), health(), local(), locate(), scan(), tts() (+1 more)

### Community 12 - "say"
Cohesion: 0.18
Nodes (33): act(), answerLocally(), arReady(), askPip(), describe(), ensureCamera(), ensureGPS(), findStart() (+25 more)

### Community 13 - "locate"
Cohesion: 0.23
Nodes (20): compassNow(), currentDirection(), distWords(), gpsCue(), gpsGood(), gpsLeg(), gpsWhere(), instruct() (+12 more)

### Community 14 - "app.py"
Cohesion: 0.13
Nodes (7): _bearing(), _drop_lookalikes(), _iou(), _meters(), _rel(), same_thing(), _stem()

### Community 16 - "missionStep"
Cohesion: 0.24
Nodes (14): doorHow(), doorWait(), doorWaitStart(), endLeg(), HANDLE_LABELS, handleStep(), handSide(), missionStep() (+6 more)

### Community 17 - "panorama"
Cohesion: 0.21
Nodes (7): _json(), panorama(), describe_view(), place_of(), plain_target(), turn_phrase(), wrong_place()

### Community 18 - "replan"
Cohesion: 0.21
Nodes (7): check_room(), confirm(), describe(), door(), door_words(), replan(), see()

### Community 19 - "plan"
Cohesion: 0.36
Nodes (8): find_places(), geocode(), get_route(), LatLon, maps_link(), plan(), route(), _up()

### Community 20 - "llm"
Cohesion: 0.17
Nodes (9): backtrack(), BacktrackRequest, chat(), decide_slam(), llm(), PlanRequest, Segment, SlamCandidate (+1 more)

### Community 21 - "PipApp"
Cohesion: 0.20
Nodes (7): PipApp, .body, PipView, .body, Screen, .body, SwiftUI

### Community 23 - "PipWebView.swift"
Cohesion: 0.29
Nodes (4): LogFile, PipWKWebView, MapKit, WebKit

### Community 26 - "re"
Cohesion: 0.29
Nodes (4): agent(), names_a_location(), run_tool(), talk()

## Ambiguous Edges - Review These
- `Model server Python requirements` → `Kokoro-82M voice (af_heart, kokoro-onnx, /tts)`  [AMBIGUOUS]
  server/requirements.txt · relation: references
- `YOLO11n object detector` → `Arrival check (room proof in 3 frames + vision model agrees)`  [AMBIGUOUS]
  README.md · relation: references

## Knowledge Gaps
- **30 isolated node(s):** `Vision`, `.supported`, `.jpeg`, `.depth`, `.tracking` (+25 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 154 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **4 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `index.html (Pip screen markup and styles)` connect `index.html (Pip screen markup and styles)` to `Models`, `PipWebView`, `app.js`, `ui.js`?**
  _High betweenness centrality (0.183) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `ARSense` (e.g. with `Testing contract: Mac vs phone` and `SlamMap`) actually correct?**
  _`ARSense` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Vision`, `.supported`, `.jpeg` to the rest of the system?**
  _30 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Models` be split into smaller, more focused modules?**
  _Cohesion score 0.05673076923076923 - nodes in this community are weakly interconnected._
- **Why does `ARSense` connect `ARSense` to `Models`, `index.html (Pip screen markup and styles)`, `SlamMap`, `Sensors`?**
  _High betweenness centrality (0.181) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Model server Python requirements` and `Kokoro-82M voice (af_heart, kokoro-onnx, /tts)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `YOLO11n object detector` and `Arrival check (room proof in 3 frames + vision model agrees)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._