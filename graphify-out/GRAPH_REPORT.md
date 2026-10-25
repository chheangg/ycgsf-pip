# Graph Report - ycgsf-pip  (2026-10-25)

## Corpus Check
- 21 files · ~56,380 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 14 file(s) not represented in the graph (top: .glsl 5, (none) 3, .pbxproj 1)

## Summary
- 602 nodes · 1469 edges · 31 communities (19 shown, 12 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 71 edges (avg confidence: 0.86)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `fb2a8ba7`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- Sensors
- Pip web UI (web/index.html)
- app.js
- ARSense
- say
- PipWebView
- Camera
- render
- Mic
- app.py
- Voice
- SlamMap
- post
- ui.js
- walkCue
- PipWebView.swift
- locate
- panorama
- re
- backtrack
- Design Check and Trip Tools
- replayPoints
- _crop
- Detector Lookalike Filter
- Icons
- run.sh Launcher
- Trip Pull Script
- _drop_lookalikes
- .write
- Bridge

## God Nodes (most connected - your core abstractions)
1. `say()` - 57 edges
2. `log()` - 34 edges
3. `ARSense` - 32 edges
4. `render()` - 29 edges
5. `Voice` - 26 edges
6. `Sensors` - 25 edges
7. `Camera` - 22 edges
8. `Pip web UI (web/index.html)` - 21 edges
9. `SlamMap` - 20 edges
10. `act()` - 20 edges

## Surprising Connections (you probably didn't know these)
- `06 Teach screen (orient, recording, getting bearings)` --implements--> `Pip design screens (01 Start, 02 Listening, 03 Guiding, 04 Find, 05 Setup)`  [AMBIGUOUS]
  web/index.html → CLAUDE.md
- `App Transport Security: NSAllowsArbitraryLoads` --conceptually_related_to--> `RTX 4090 model server over Tailscale`  [INFERRED]
  ios/project.yml → README.md
- `Bundled web folder resources (../web)` --references--> `Pip web UI (web/index.html)`  [INFERRED]
  ios/project.yml → web/index.html
- `Model server Python requirements` --references--> `Kokoro-82M voice (kokoro-onnx)`  [AMBIGUOUS]
  server/requirements.txt → README.md
- `Model server Python requirements` --references--> `Qwen3-14B brain (conversation + planning agent, llama.cpp Q4_K_M)`  [AMBIGUOUS]
  server/requirements.txt → README.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Pip open-weight model stack on the RTX 4090 server** — readme_rtx_4090_model_server, readme_distil_whisper_small_en, readme_qwen3_14b, readme_qwen2_5_vl_7b, readme_kokoro_82m, readme_yolo11n, readme_depth_anything_v2_small, readme_owlv2 [EXTRACTED 1.00]
- **Web UI screens and tokens built from the pen.dev design** — claude_untitled_pen, claude_design_screens, claude_design_tokens, web_index_css_tokens, web_index_scr_start, web_index_scr_listen, web_index_scr_guide, web_index_scr_find, web_index_scr_setup [INFERRED 0.95]

## Communities (31 total, 12 thin omitted)

### Community 1 - "Pip web UI (web/index.html)"
Cohesion: 0.07
Nodes (47): CLAUDE.md (Pip project instructions), tools/check_design.py design check, Pip design screens (01 Start, 02 Listening, 03 Guiding, 04 Find, 05 Setup), Design tokens (design/tokens.json), untitled.pen (pen.dev design file), Pip iOS XcodeGen project (project.yml), App Transport Security: NSAllowsArbitraryLoads, Pip iOS app target (com.ycgsf.pip, iOS 17, portrait) (+39 more)

### Community 2 - "app.js"
Cohesion: 0.06
Nodes (49): audioLoop(), backCue(), checkServer(), chunks, cue(), cycleListen(), fallbackVoice(), findKey() (+41 more)

### Community 3 - "ARSense"
Cohesion: 0.08
Nodes (12): ARSense, .depth, .frameId, .jpeg, .mapping, .mapsDir, .pose, .supported (+4 more)

### Community 4 - "say"
Cohesion: 0.21
Nodes (26): act(), answerLocally(), askPip(), b64ToBlob(), describe(), ensureCamera(), ensureGPS(), findStart() (+18 more)

### Community 5 - "PipWebView"
Cohesion: 0.23
Nodes (3): PipWebView, PipWKWebView, ScreenPreview

### Community 6 - "Camera"
Cohesion: 0.13
Nodes (3): Camera, .jpeg, Depth

### Community 7 - "render"
Cohesion: 0.16
Nodes (32): askNative(), atSign(), backtrack(), doorStep(), endLeg(), giveUp(), goToSign(), handleStep() (+24 more)

### Community 8 - "Mic"
Cohesion: 0.09
Nodes (10): ARKit, AVFoundation, CoreImage, CoreLocation, CoreMotion, Foundation, Mic, simd (+2 more)

### Community 9 - "app.py"
Cohesion: 0.16
Nodes (13): _bearing(), find_places(), geocode(), get_route(), health(), LatLon, maps_link(), _meters() (+5 more)

### Community 11 - "SlamMap"
Cohesion: 0.14
Nodes (8): Cell, free, occupied, unknown, Door, Frontier, SlamMap, .knownCells

### Community 12 - "post"
Cohesion: 0.13
Nodes (14): check_room(), confirm(), describe(), device(), door(), get(), local(), locate() (+6 more)

### Community 13 - "ui.js"
Cohesion: 0.12
Nodes (25): frame(), stopAll(), avail(), countTurns(), drawLog(), drawPlaces(), fillRing(), fillSegs() (+17 more)

### Community 14 - "walkCue"
Cohesion: 0.23
Nodes (18): currentDirection(), distWords(), goalOf(), gpsCue(), gpsGood(), gpsLeg(), instruct(), legStart() (+10 more)

### Community 15 - "PipWebView.swift"
Cohesion: 0.15
Nodes (10): PipApp, .body, PipView, .body, LogFile, Screen, .body, MapKit (+2 more)

### Community 16 - "locate"
Cohesion: 0.11
Nodes (36): angleDiff(), bearing(), buildPath(), circMean(), compassNow(), deg(), dist(), endSegment() (+28 more)

### Community 17 - "panorama"
Cohesion: 0.18
Nodes (7): _json(), panorama(), describe_view(), place_of(), plain_target(), turn_phrase(), wrong_place()

### Community 18 - "re"
Cohesion: 0.21
Nodes (7): agent(), chat(), llm(), llm_json(), names_a_location(), same_thing(), _stem()

### Community 19 - "backtrack"
Cohesion: 0.20
Nodes (7): backtrack(), BacktrackRequest, decide_slam(), PlanRequest, Segment, SlamCandidate, SlamDecision

### Community 21 - "replayPoints"
Cohesion: 0.17
Nodes (16): arReady(), doneChime(), findCue(), findStep(), findStop(), findSweep(), invert(), note() (+8 more)

## Ambiguous Edges - Review These
- `Model server Python requirements` → `Kokoro-82M voice (kokoro-onnx)`  [AMBIGUOUS]
  server/requirements.txt · relation: references
- `Model server Python requirements` → `Qwen3-14B brain (conversation + planning agent, llama.cpp Q4_K_M)`  [AMBIGUOUS]
  server/requirements.txt · relation: references
- `07 Places screen` → `Pip design screens (01 Start, 02 Listening, 03 Guiding, 04 Find, 05 Setup)`  [AMBIGUOUS]
  web/index.html · relation: implements
- `09 Route preview screen` → `Pip design screens (01 Start, 02 Listening, 03 Guiding, 04 Find, 05 Setup)`  [AMBIGUOUS]
  web/index.html · relation: implements
- `08 Search screen (no taught route)` → `Pip design screens (01 Start, 02 Listening, 03 Guiding, 04 Find, 05 Setup)`  [AMBIGUOUS]
  web/index.html · relation: implements
- `06 Teach screen (orient, recording, getting bearings)` → `Pip design screens (01 Start, 02 Listening, 03 Guiding, 04 Find, 05 Setup)`  [AMBIGUOUS]
  web/index.html · relation: implements

## Knowledge Gaps
- **23 isolated node(s):** `Vision`, `.supported`, `.jpeg`, `.depth`, `.tracking` (+18 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 156 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **12 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `Sensors` connect `Sensors` to `ARSense`, `PipWebView`, `Camera`, `Mic`, `Voice`, `PipWebView.swift`, `Bridge`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Are the 3 inferred relationships involving `ARSense` (e.g. with `SlamMap` and `Sensors`) actually correct?**
  _`ARSense` has 3 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Vision`, `.supported`, `.jpeg` to the rest of the system?**
  _23 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Pip web UI (web/index.html)` be split into smaller, more focused modules?**
  _Cohesion score 0.07474600870827286 - nodes in this community are weakly interconnected._
- **Why does `ARSense` connect `ARSense` to `Mic`, `Sensors`, `SlamMap`, `Bridge`?**
  _High betweenness centrality (0.062) - this node is a cross-community bridge._

### Low-confidence Hints
_AMBIGUOUS edges — the extractor was unsure. Verify before acting on these._

- **What is the exact relationship between `Model server Python requirements` and `Kokoro-82M voice (kokoro-onnx)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._
- **What is the exact relationship between `Model server Python requirements` and `Qwen3-14B brain (conversation + planning agent, llama.cpp Q4_K_M)`?**
  _Edge tagged AMBIGUOUS (relation: references) - confidence is low._