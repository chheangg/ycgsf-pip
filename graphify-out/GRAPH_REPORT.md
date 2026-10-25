# Graph Report - ycgsf-pip  (2026-10-25)

## Corpus Check
- 18 files · ~45,867 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 488 nodes · 1209 edges · 16 communities (15 shown, 1 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 62 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Community Hubs (Navigation)
- Assistant actions and replies
- Phone sensors bridge
- Screens and design rules
- ARKit tracking
- App state and speech rules
- Project contracts
- Camera and depth
- Apple frameworks
- Native voice and audio
- SLAM map
- Route geometry
- GPS and direction cues
- Route recording and following
- Find mode
- Audio loop and server
- Guidance cues

## God Nodes (most connected - your core abstractions)
1. `say()` - 57 edges
2. `log()` - 34 edges
3. `ARSense` - 34 edges
4. `render()` - 29 edges
5. `Sensors` - 26 edges
6. `Voice` - 26 edges
7. `Camera` - 23 edges
8. `act()` - 20 edges
9. `SlamMap` - 20 edges
10. `roomDist()` - 19 edges

## Surprising Connections (you probably didn't know these)
- `magicTap()` --implements--> `Motion + Gestures accessibility rules (VoiceOver labels, Magic Tap, Z-scrub, Reduce Motion, Larger Text)`  [INFERRED]
  frontend/ui.js → CLAUDE.md
- `Testing contract: Mac vs phone` --references--> `ARSense`  [INFERRED]
  CLAUDE.md → ios/Pip/ARSense.swift
- `PipWebView` --references--> `index.html (Pip screen markup and styles)`  [INFERRED]
  ios/Pip/PipWebView.swift → frontend/index.html
- `Trip recordings (trips/)` --conceptually_related_to--> `Trip`  [INFERRED]
  CLAUDE.md → ios/Pip/PipWebView.swift
- `setup()` --references--> `05 Setup screen (#scr-setup)`  [INFERRED]
  frontend/ui.js → frontend/index.html

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Design contract pipeline: pen.dev file to tokens to CSS, verified by the design check** — claude_untitled_pen, claude_design_tokens, frontend_index_css_tokens, claude_check_design_py, tools_check_design [EXTRACTED 1.00]
- **Accessibility contract implemented across web and native (Reduce Motion, Larger Text, Magic Tap, Z-scrub)** — claude_accessibility_rules, frontend_index_reduce_motion, frontend_index_larger_text, frontend_ui_magictap, ios_pip_pipwebview_pipwkwebview_accessibilityperformmagictap, ios_pip_pipwebview_pipwkwebview_accessibilityperformescape [INFERRED 0.85]
- **iOS app bundles and shows the web frontend** — ios_project_pip_target, ios_pip_pipwebview_pipwebview, frontend_index, frontend_ui, frontend_app [INFERRED 0.85]

## Communities (16 total, 1 thin omitted)

### Community 0 - "Assistant actions and replies"
Cohesion: 0.10
Nodes (65): act(), answerLocally(), askNative(), askPip(), atSign(), b64ToBlob(), backtrack(), describe() (+57 more)

### Community 1 - "Phone sensors bridge"
Cohesion: 0.05
Nodes (17): PipApp, .body, PipView, .body, Bridge, LogFile, PipWebView, PipWKWebView (+9 more)

### Community 2 - "Screens and design rules"
Cohesion: 0.06
Nodes (52): Button States frame (ready, pressed, working, done, unavailable), Pip design screens (01 Start through 09 Route preview), Motion + Gestures frame, Shared design components (Status Bar, Key, Mute, Mute · On, Say Chip), design/untitled.pen (pen.dev design file), frame(), Key state styles (pressed, work, done, na), Larger Text layout (.large stacks keys) (+44 more)

### Community 3 - "ARKit tracking"
Cohesion: 0.08
Nodes (12): ARSense, .depth, .frameId, .jpeg, .mapping, .mapsDir, .pose, .supported (+4 more)

### Community 4 - "App state and speech rules"
Cohesion: 0.07
Nodes (31): chunks, cycleListen(), HAND_WORDS, LISTEN_LABEL, logLines, N, NATIVE, nativeSpeech (+23 more)

### Community 5 - "Project contracts"
Cohesion: 0.09
Nodes (16): CLAUDE.md (Pip project instructions), tools/check_design.py design check, Design tokens (design/tokens.json), Pip model server, tools/pull_trip.sh (ycgsf repo), Trip recordings (trips/), ycgsf repo (../ycgsf-pip: model server, trips, trip tools), icon() (+8 more)

### Community 6 - "Camera and depth"
Cohesion: 0.11
Nodes (3): Camera, .jpeg, Depth

### Community 7 - "Apple frameworks"
Cohesion: 0.09
Nodes (10): ARKit, AVFoundation, CoreImage, CoreLocation, CoreMotion, Foundation, Mic, simd (+2 more)

### Community 9 - "SLAM map"
Cohesion: 0.14
Nodes (8): Cell, free, occupied, unknown, Door, Frontier, SlamMap, .knownCells

### Community 10 - "Route geometry"
Cohesion: 0.18
Nodes (19): angleDiff(), bearing(), buildPath(), circMean(), deg(), gpsWhere(), hazardCheck(), keypoints() (+11 more)

### Community 11 - "GPS and direction cues"
Cohesion: 0.24
Nodes (19): compassNow(), currentDirection(), distWords(), gpsCue(), gpsGood(), gpsLeg(), instruct(), legGeom() (+11 more)

### Community 12 - "Route recording and following"
Cohesion: 0.21
Nodes (15): dist(), endSegment(), followRoute(), learnEnd(), learnTick(), legDist(), meters(), onFix() (+7 more)

### Community 13 - "Find mode"
Cohesion: 0.24
Nodes (12): arReady(), doneChime(), findCue(), findStep(), findStop(), findSweep(), note(), orient() (+4 more)

### Community 14 - "Audio loop and server"
Cohesion: 0.33
Nodes (9): audioLoop(), checkServer(), fallbackVoice(), invert(), playLine(), speakNow(), start(), tap() (+1 more)

### Community 15 - "Guidance cues"
Cohesion: 0.28
Nodes (9): backCue(), cue(), guiding(), missionCue(), navCue(), offTap(), slamNext(), thinking() (+1 more)

## Knowledge Gaps
- **27 isolated node(s):** `Vision`, `.supported`, `.jpeg`, `.depth`, `.tracking` (+22 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 113 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **1 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `index.html (Pip screen markup and styles)` connect `Project contracts` to `Phone sensors bridge`, `Screens and design rules`, `App state and speech rules`?**
  _High betweenness centrality (0.525) - this node is a cross-community bridge._
- **Are the 5 inferred relationships involving `ARSense` (e.g. with `Testing contract: Mac vs phone` and `SlamMap`) actually correct?**
  _`ARSense` has 5 INFERRED edges - model-reasoned connections that need verification._
- **What connects `Vision`, `.supported`, `.jpeg` to the rest of the system?**
  _27 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Assistant actions and replies` be split into smaller, more focused modules?**
  _Cohesion score 0.09663461538461539 - nodes in this community are weakly interconnected._
- **Why does `Sensors` connect `Phone sensors bridge` to `ARKit tracking`, `Project contracts`, `Camera and depth`, `Apple frameworks`, `Native voice and audio`?**
  _High betweenness centrality (0.338) - this node is a cross-community bridge._
- **Are the 6 inferred relationships involving `Sensors` (e.g. with `PipView` and `.userContentController()`) actually correct?**
  _`Sensors` has 6 INFERRED edges - model-reasoned connections that need verification._
- **Should `Phone sensors bridge` be split into smaller, more focused modules?**
  _Cohesion score 0.05222734254992319 - nodes in this community are weakly interconnected._