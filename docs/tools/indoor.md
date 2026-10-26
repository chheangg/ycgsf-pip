# Indoor workflow

Pip exposes one model tool, `indoor_workflow`, through the existing function-schema → `run_tool()` → JSON result/app action convention. The camera and movement remain on the phone. No additional agent framework or dependencies are used.

## Operations

| Operation | Arguments | Behavior |
| --- | --- | --- |
| `set_place` | `place_id`, or `name`, `address`, optional `floor`, `venue_type`; optional known Home Depot `store_no` | Select a venue/floor and recall its shared records. A known place/floor change cancels the current workflow and resets local geometry. Naming an anonymous visit preserves its observations. |
| `scan` | Optional `goal`; `mode: view` (default) or `around` | Request a coherent camera observation or a bounded four-view look-around. |
| `recall` | Optional `query`, `place_id`, `cursor` | Return at most five sections, their evidence, observed objects and current spatial usability. Follow `next_cursor` for additional results. |
| `navigate` | Existing `section_id` | Prepare a measured local approach route and ask before walking. |
| `save` | Optional `section_ids`; defaults to current sections | Save a snapshot only after an explicit request such as “remember this building.” A name, address and known floor are required. |
| `correct` | Existing `section_id`, `label`, optional `aliases` | Record a user correction, preserving original observations. Corrections to an already-saved section update the library with revision checking. |
| `forget` | Explicit `section_ids` or current `place_id` | Delete the requested shared records after an explicit forget/delete request. Forgetting the place also removes its stored address. |

Example requests: “What aisles are around me?”, “Where are beverages?”, “Remember this building”, “Actually, that is the cleaning aisle”, and “Take me to East Wing.” Pip asks for missing place/floor information or an ambiguous section choice.

## Evidence and perception

Native capture retains one AR frame for the JPEG, Apple Vision OCR, camera pose and measured sign projections. Text retains its original bounding box and OCR confidence. A stale camera frame is rejected. A browser or non-AR camera can provide category descriptions without a navigable anchor.

The vision model interprets supplied OCR line indexes as area labels, directional signs, directories, product labels or unclear text. Exact text comes from OCR, not model-generated quotations. Literal arrows and floor-directory entries cannot become destination anchors. Shelf/product labels do not establish aisle signs.

Object-based categories remain `inferred`. Bottled water plus juice may support beverages; generic cans alone do not. Official wing/floor names cannot be inferred from furniture. Sections can be `observed`, `inferred`, `user_confirmed` or `conflicting`; a correction does not create coordinates.

An `around` scan captures at most four views about 90° apart during a stationary turn, bounded to 30 seconds. Interrupted turns or failed views report partial coverage. Each interpretation has a maximum 40-second model timeout, with a 130-second total interpretation budget and a 20-second spoken-summary timeout inside the 180-second upload deadline. A single bounded queue prevents unbounded vision concurrency. Successful views survive other view failures.

## Conversation and device protocol

The normal `/talk` envelope remains `heard`, `say`, `action`, `tools`. A pending camera or route action ends that model turn immediately. Product observations are not supplied as tool arguments by the model.

All device work uses app action type `indoor_workflow`, with internal operations `capture`, `prepare_route`, `guiding`, `verify`, `save_map` or `context_changed`. The frontend advertises protocol version 1, a stable installation ID, current AR frame identity and current tracking status. Older native clients do not advertise support.

- `POST /indoor_workflow/observations`: multipart `images` (one to four JPEGs, at most 2 MB each) and JSON `metadata` containing session/request/visit/device/frame/floor identities, view metadata and current app context. Around scans also report measured rotation. Paused route-turn observations set `decision: true`.
- `POST /indoor_workflow/events`: JSON with the same correlation identities plus an event and its measured outcome. Events include `route_ready`, `confirmed`, `approach_reached`, `map_saved`, `cancelled`, `blocked`, `no_path`, `stale_map`, `outside_map`, `tracking_unavailable` and `camera_unavailable`.

Completed callback responses are cached for idempotent replay. An in-progress duplicate does not run vision again. New requests, visit changes and cancellation invalidate older actions. Callback replies may report/recall observations; they cannot grant permission to walk, save, rescan, or invoke unrelated navigation tools.

Route preparation produces a spoken plan in the existing listening interface. A positive user reply is handled by the phone, which holds and revalidates the path before posting `confirmed`. There is no model `confirmed=true` argument. The existing outdoor GPS preview is not reused.

## Persistence and spatial identity

Temporary observations stay in the conversation's visit state. They do not enter the shared library until explicitly saved. The shared library is SQLite with place, section, observation and anchor records; saved records retain evidence timestamps and revisions. Revisions prevent a stale device from overwriting or deleting another device's edits. Re-select the saved place to reload after a conflict.

The default database is `data/indoor_workflow.sqlite3` under the application root. Override it with `INDOOR_WORKFLOW_DB` in the server environment. It is ignored by Git, lives outside the deployable server files and is preserved by deployment. The database contains structured evidence, not raw images; existing trip recordings are separate. No API keys are needed for this tool's local vision/OCR pipeline.

The library is intentionally shared among clients connected to this prototype's server. Device IDs identify spatial-map ownership; they are not authentication credentials. Names and categories can be recalled on another device, but its coordinates are unusable there.

Saving a section can also request the existing native AR world-map save. If that fails, descriptions remain saved and the map reference is marked unavailable. On the same device, saved anchors can be tried only after the saved frame is restored and tracking is stable. Current floor geometry must still yield a valid path. Another device must observe a fresh anchor. An address or retailer aisle label is never a physical route.

## Local guidance

This version guides only inside the existing 30 × 30 metre local map. It does not join floors, rooms or wings into a building-wide route graph.

The workflow's strict path mode excludes unknown/occupied cells, keeps obstacle clearance, prevents diagonal corner cutting and does not force occupied endpoints free. Signs use a reachable free-floor approach point rather than their wall/shelf surface. A failed path is never replaced with a straight line, timed steps, compass alignment or generic exploration.

The frontend checks tracking freshness, frame identity and path validity before starting and during guidance. It pauses for new section observations at route turns, then checks the route again. Obstacles and failed paths stop the task. Pause/resume/stop use the existing controls. Late callbacks cannot restart a cancelled task.

Reaching the approach point triggers a fresh observation. A matching sign can verify the section label; it does not establish that the user is inside the area. No shelf-item search starts automatically.

The Home Depot product tool is an optional, independent integration. When it is installed, `set_place` can resolve a known `store_no`, and an aisle/bay string can be a visual search goal. Without it, supply the place name, address and floor. Retailer labels supply no coordinates, and scanning does not initiate billable retailer lookups.

## Verification

Use Python 3.12+ with the existing server dependencies installed:

```sh
python -m unittest discover -s tests -p 'test_indoor_workflow.py'
node --test tests/test_indoor_frontend.cjs
python tools/check_code.py
node --check frontend/app.js
```

The tests exercise schemas/dispatch, asynchronous callbacks, cancellation, classification rules, Unicode result limits, explicit saving, revision conflicts, shared recall, saved-map eligibility and frontend route handoff. HTTP, model and native responses are mocked. They do not simulate a walk or establish live recognition accuracy.

Before physical use, build the app with Xcode's iOS components installed and validate on a LiDAR iPhone. Record actual visits and use the existing trip-report tooling to inspect failures. Required checks:

- Read a real aisle sign and retain its exact label.
- Identify likely beverages from several drink products; keep generic cans ambiguous.
- Treat a wing arrow and a floor directory as directions/listings rather than arrival.
- Save and recall a venue/floor across app and server restarts.
- Recall on a second phone without using the first phone's coordinates.
- Test both successful and failed same-device map restoration.
- Guide over a verified local path; stop on unknown space, blockage or tracking loss.
- Cancel during capture/processing and verify that late results never restart guidance.
- Verify the label at the approach point in both a store and another building.

These real-device checks remain separate from automated protocol verification. Preparing this implementation does not deploy or restart the running server.
