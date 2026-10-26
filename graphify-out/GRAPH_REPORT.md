# Graph Report - ycgsf-pip  (2026-10-25)

## Corpus Check
- 37 files · ~115,176 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 19 file(s) not represented in the graph (top: .glsl 8, (none) 4, .pen 1)

## Summary
- 976 nodes · 2538 edges · 48 communities (30 shown, 18 thin omitted)
- Extraction: 97% EXTRACTED · 3% INFERRED · 0% AMBIGUOUS · INFERRED: 72 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `ddf6dd11`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- gpsCue
- index.html (Pip screen markup and styles)
- app.js
- README.md
- render
- ARSense
- ui.js
- app.py
- Camera
- IndoorWorkflowTests
- Voice
- time
- SlamMap
- re
- PipApp
- say
- Trip
- llm
- PipWebView.swift
- Sensors
- trip_report.py
- roomDist
- Saver
- json
- .userContentController
- indoor_workflow.py
- icons.js
- discover_home_depot.py
- test_indoor_workflow.py
- shaders.js
- run.sh
- deploy.sh
- indoor_events
- pull_trip.sh
- HomeDepotToolTests
- Clean code contract
- Models
- missionStep
- How it works
- test_indoor_frontend.cjs
- HomeDepotTests
- WalmartToolTests
- Indoor workflow
- Info.plist privacy usage descriptions (camera, mic, motion, location, local network)
- _crop
- _drop_lookalikes
- tts

## God Nodes (most connected - your core abstractions)
1. `say()` - 79 edges
2. `log()` - 61 edges
3. `IndoorWorkflowTests` - 38 edges
4. `ARSense` - 36 edges
5. `render()` - 34 edges
6. `act()` - 30 edges
7. `roomDist()` - 26 edges
8. `Sensors` - 26 edges
9. `Voice` - 25 edges
10. `index.html (Pip screen markup and styles)` - 24 edges

## Surprising Connections (you probably didn't know these)
- `Conversation and device protocol` --references--> `guiding()`  [INFERRED]
  docs/tools/indoor.md → frontend/app.js
- `PipWebView` --references--> `index.html (Pip screen markup and styles)`  [INFERRED]
  ios/Pip/PipWebView.swift → frontend/index.html
- `Operations` --references--> `scan()`  [INFERRED]
  docs/tools/indoor.md → server/app.py
- `Indoor workflow` --references--> `run_tool()`  [INFERRED]
  docs/tools/indoor.md → server/app.py
- `Operations` --references--> `recall()`  [INFERRED]
  docs/tools/indoor.md → server/indoor_workflow.py

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Models on the RTX 4090** — readme_brain_qwen3_14b, readme_qwen2_5_vl_7b, readme_speech_to_text, readme_kokoro_82m, readme_yolo11n, readme_depth_anything_v2, readme_owlv2 [EXTRACTED 1.00]
- **Room-by-room navigation loop (plan, guide, check, backtrack)** — readme_long_term_planner, readme_short_term_planner, readme_arrival_check, readme_backtracking, readme_unknown_places [EXTRACTED 1.00]
- **Design contract implemented in index.html (tokens, shared components, button states, accessibility)** — claude_pen_dev_design_contract, frontend_index_css_tokens, frontend_index_voice_bar, frontend_index_key_states, frontend_index_reduce_motion, frontend_index_larger_text [INFERRED 0.85]
- **iOS app bundles and shows the web frontend** — ios_project_pip_target, ios_pip_pipwebview_pipwebview, frontend_index, frontend_ui, frontend_app [INFERRED 0.85]

## Communities (48 total, 18 thin omitted)

### Community 0 - "gpsCue"
Cohesion: 0.12
Nodes (41): addBlock(), angleDiff(), buildPath(), cleanQuery(), compassNow(), currentDirection(), distWords(), gpsCue() (+33 more)

### Community 1 - "index.html (Pip screen markup and styles)"
Cohesion: 0.11
Nodes (27): Button States frame (ready, pressed, working, done, unavailable), Pip design screens (01 Start through 09 Route preview), Design tokens (design/tokens.json, CSS variables --bg, --fg, --accent), Motion + Gestures frame, Shared design components (Status Bar, Key, Talk, Talk · On, Deafen, Deafen · On, Voice Bar, Say Chip), design/untitled.pen (pen.dev design file), index.html (Pip screen markup and styles), Hidden camera video (#cam) (+19 more)

### Community 2 - "app.js"
Cohesion: 0.05
Nodes (72): AMBIENT, ambientLoop(), ambientOn(), arReady(), askPip(), audioLoop(), backCue(), bestPlace() (+64 more)

### Community 3 - "README.md"
Cohesion: 0.16
Nodes (13): Published studies with blind users (turn words, tap rates, progress tones), Browser (desk testing), Clew (occamLab route-following app), iPhone, License, Listening modes (always on, "Hey Pip", push to talk), Pip, Run it (+5 more)

### Community 4 - "render"
Cohesion: 0.15
Nodes (26): answerLocally(), askNative(), askPipNow(), b64ToBlob(), demoRecord(), indoorAction(), indoorCancel(), indoorCapture() (+18 more)

### Community 5 - "ARSense"
Cohesion: 0.09
Nodes (12): ARSense, .depth, .frameId, .jpeg, .mapping, .mapsDir, .pose, .supported (+4 more)

### Community 6 - "ui.js"
Cohesion: 0.10
Nodes (31): frame(), avail(), backgroundLook(), countTurns(), demoView(), drawBackground(), drawLog(), drawPlaces() (+23 more)

### Community 7 - "app.py"
Cohesion: 0.13
Nodes (18): _bearing(), door_words(), find_places(), geocode(), get_route(), health(), LatLon, maps_link() (+10 more)

### Community 8 - "Camera"
Cohesion: 0.05
Nodes (13): ARKit, AVFoundation, CoreImage, CoreLocation, CoreMotion, Foundation, Camera, .jpeg (+5 more)

### Community 11 - "time"
Cohesion: 0.14
Nodes (16): check_room(), confirm(), describe(), device(), door(), get(), indoor_observations(), describe() (+8 more)

### Community 12 - "SlamMap"
Cohesion: 0.14
Nodes (8): Cell, free, occupied, unknown, Door, Frontier, SlamMap, .knownCells

### Community 13 - "re"
Cohesion: 0.19
Nodes (8): agent(), lookup_walmart(), names_a_location(), run_tool(), cancel(), is_confirmation(), user_turn(), fetch_location()

### Community 14 - "PipApp"
Cohesion: 0.20
Nodes (7): PipApp, .body, PipView, .body, Screen, .body, SwiftUI

### Community 15 - "say"
Cohesion: 0.09
Nodes (65): act(), aRoom(), aroundCheck(), backtrack(), demoToggle(), describe(), doneChime(), doorBlocked() (+57 more)

### Community 17 - "llm"
Cohesion: 0.22
Nodes (6): backtrack(), BacktrackRequest, chat(), decide_slam(), llm(), SlamDecision

### Community 18 - "PipWebView.swift"
Cohesion: 0.19
Nodes (6): LogFile, PipWebView, PipWKWebView, ScreenPreview, MapKit, WebKit

### Community 20 - "trip_report.py"
Cohesion: 0.15
Nodes (12): cell(), changed_state(), draw_map(), dot(), line(), load(), main(), marks_of() (+4 more)

### Community 21 - "roomDist"
Cohesion: 0.12
Nodes (30): atSign(), bearing(), blockedStep(), circMean(), deg(), findStart(), goCandidate(), goToSign() (+22 more)

### Community 22 - "Saver"
Cohesion: 0.22
Nodes (4): Recorder, .isRecording, Saver, ReplayKit

### Community 23 - "json"
Cohesion: 0.21
Nodes (7): _json(), panorama(), describe_view(), place_of(), plain_target(), turn_phrase(), wrong_place()

### Community 25 - "indoor_workflow.py"
Cohesion: 0.14
Nodes (30): anchor(), cache_callback(), callback_cached(), callback_context(), correlated(), database(), dispatch(), event() (+22 more)

### Community 27 - "discover_home_depot.py"
Cohesion: 0.18
Nodes (13): lookup_home_depot(), fetch_detail(), fetch_payload(), fetch_products(), read_stores(), collect(), main(), read_inputs() (+5 more)

### Community 32 - "indoor_events"
Cohesion: 0.20
Nodes (6): indoor_events(), indoor_response(), trip_dir(), trip_file(), trip_have(), trip_trace()

### Community 36 - "Clean code contract"
Cohesion: 0.14
Nodes (4): CLAUDE.md (Pip project instructions), tools/check_code.py code check (must print "clean"), tools/check_design.py design check (must print "matches"), Trip recordings (trips/)

### Community 37 - "Models"
Cohesion: 0.17
Nodes (14): Depth-Anything-V2-Small (camera-only distance), Harnesses (find object, obstacle stop, door coaching, room check, door vs look-alike), Kokoro-82M voice (af_heart, kokoro-onnx, /tts), llama.cpp llama-server (brain :8101, vision :8103), Models, OWLv2 open-vocabulary object finder (guides your hand), Qwen2.5-VL-7B-Instruct (eyes: describe views, doors, room check), Speech to text (Distil-Whisper distil-small.en) (+6 more)

### Community 38 - "missionStep"
Cohesion: 0.23
Nodes (14): doorHow(), doorThrough(), doorWait(), doorWaitStart(), endLeg(), HANDLE_LABELS, handleStep(), handSide() (+6 more)

### Community 39 - "How it works"
Cohesion: 0.32
Nodes (8): Apple Maps walking directions, Apple Vision text recognition (signs, exit signs), Brain: Qwen3-14B tool-calling agent, How it works, Known ways (GPS routes, taught routes, go back), LiDAR floor map (10 cm free/blocked/unknown grid, ARKit doors, openings), OpenStreetMap places and foot routing (Nominatim, Overpass; Google Maps optional), Phone sensors (ARKit pose, LiDAR depth, camera, GPS, compass, Core Motion steps)

### Community 40 - "test_indoor_frontend.cjs"
Cohesion: 0.17
Nodes (6): assert, block, { readFileSync }, source, { test }, vm

### Community 43 - "Indoor workflow"
Cohesion: 0.25
Nodes (7): Conversation and device protocol, Evidence and perception, Indoor workflow, Local guidance, Operations, Persistence and spatial identity, Verification

### Community 44 - "Info.plist privacy usage descriptions (camera, mic, motion, location, local network)"
Cohesion: 0.38
Nodes (5): Pip model server (server/ on the RTX 4090, reached over Tailscale), project.yml (XcodeGen spec for the Pip iOS app), Pip iOS app target (com.ycgsf.pip, iOS 17), Info.plist privacy usage descriptions (camera, mic, motion, location, local network), Model server

## Ambiguous Edges - Review These
- `Model server Python requirements` → `Kokoro-82M voice (af_heart, kokoro-onnx, /tts)`  [AMBIGUOUS]
  server/requirements.txt · relation: references

## Knowledge Gaps
- **37 isolated node(s):** `Vision`, `.supported`, `.jpeg`, `.depth`, `.tracking` (+32 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 245 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Conversation and device protocol` connect `Indoor workflow` to `IndoorWorkflowTests`, `say`?**
  _High betweenness centrality (0.411) - this node is a cross-community bridge._
- **Are the 4 inferred relationships involving `ARSense` (e.g. with `SlamMap` and `Sensors`) actually correct?**
  _`ARSense` has 4 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Vision`, `.supported`, `.jpeg` to the rest of the system?**
  _37 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `gpsCue` be split into smaller, more focused modules?**
  _Cohesion score 0.11585365853658537 - nodes in this community are weakly interconnected._
- **Why does `guiding()` connect `say` to `app.js`, `Indoor workflow`?**
  _High betweenness centrality (0.403) - this node is a cross-community bridge._
- **Should `index.html (Pip screen markup and styles)` be split into smaller, more focused modules?**
  _Cohesion score 0.10574712643678161 - nodes in this community are weakly interconnected._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Model server Python requirements` and `Kokoro-82M voice (af_heart, kokoro-onnx, /tts)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._