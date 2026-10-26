"""Protocol and persistence tests; these do not simulate or validate physical walks."""
import copy
import io
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from fastapi.testclient import TestClient
from PIL import Image
from server import app
from server import indoor_workflow as indoor


class IndoorWorkflowTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.environment = patch.dict(os.environ, {"INDOOR_WORKFLOW_DB": str(Path(self.directory.name) / "library.sqlite3")})
        self.environment.start()
        self.addCleanup(self.environment.stop)
        self.addCleanup(app._sessions.clear)
        self.sess = {"heard": "Look around", "history": [], "places": {}, "routes": {}}
        self.ctx = {"indoor": {"version": 1, "device_id": "phone-a", "frame_id": "frame-a", "tracking": "ok"}}

    def call(self, operation, **args):
        return app.run_tool(self.sess, self.ctx, "indoor_workflow", {"operation": operation, **args})

    def place(self, **args):
        return self.call("set_place", name="Test Library", address="1 Test St", floor="1", **args)[0]["place"]

    def capture(self, interpretation=None, raw=None):
        _, action = self.call("scan")
        view = {"observation_id": indoor.identifier(), "captured_at": 1, "frame_id": "frame-a", "tracking": "ok",
                "pose": {"x": 0, "z": 0}, "lines": [{"text": "Beverages", "conf": 0.95, "x": 2, "z": 0, "d": 2}]}
        if raw:
            view.update(raw)
        meta = {**action, "views": [view]}
        model = interpretation if interpretation is not None else {"signs": [{"lines": [0], "role": "label", "arrow": "none"}]}
        indoor.observations(self.sess, meta, [b"fixture"], lambda image, prompt: model)
        return indoor.state(self.sess), meta

    def test_one_tool_registration_and_argument_rejection(self):
        names = [t["function"]["name"] for t in app.TOOLS]
        self.assertEqual(names.count("indoor_workflow"), 1)
        for args in ({"operation": "scan", "coordinates": [1, 2]}, {"operation": "navigate", "confirmed": True},
                     {"operation": ["scan"]},
                     {"operation": "scan", "mode": "all"}, {"operation": "recall", "cursor": True}):
            self.assertEqual(indoor.dispatch(self.sess, self.ctx, args)[0]["error"], "invalid_arguments")

    def test_old_client_is_rejected(self):
        self.assertEqual(indoor.dispatch(self.sess, {}, {"operation": "scan"})[0]["error"], "unsupported_client")

    def test_scan_is_pending_and_stops_model_action_loop(self):
        app._sessions["scan"] = self.sess
        call = {"id": "one", "function": {"name": "indoor_workflow", "arguments": '{"operation":"scan"}'}}
        with patch.object(app, "chat", return_value={"tool_calls": [call, call]}) as model:
            result = app.agent("scan", "What aisles are around me?", self.ctx)
        self.assertEqual(model.call_count, 1)
        self.assertEqual(len(result["tools"]), 1)
        self.assertEqual(result["action"]["operation"], "capture")
        self.assertEqual(indoor.state(self.sess)["sections"], {})

    def test_no_automatic_persistence_and_save_needs_identity_and_request(self):
        st, _ = self.capture()
        self.assertEqual(self.call("save")[0]["error"], "explicit_request_required")
        self.sess["heard"] = "Remember this building"
        self.assertEqual(self.call("save")[0]["error"], "place_identity_required")
        db = indoor.database()
        self.assertEqual(db.execute("SELECT COUNT(*) FROM sections").fetchone()[0], 0)
        db.close()
        self.assertEqual(len(st["sections"]), 1)

    def test_naming_anonymous_visit_preserves_observations_and_floor(self):
        st, _ = self.capture()
        sid = next(iter(st["sections"]))
        self.place()
        self.assertIn(sid, st["sections"])
        self.assertEqual(st["sections"][sid]["anchor"]["floor"], "1")

    def test_save_restart_and_other_device_recall(self):
        self.place()
        st, _ = self.capture()
        self.sess["heard"] = "Save these sections"
        result, _ = self.call("save")
        self.assertEqual(result["status"], "saved")
        place, sections = indoor.load_place(result["place_id"])
        other = {"heard": "Recall this building"}
        ctx = {"indoor": {**self.ctx["indoor"], "device_id": "phone-b"}}
        indoor.dispatch(other, ctx, {"operation": "set_place", "place_id": place["id"]})
        result, _ = indoor.dispatch(other, ctx, {"operation": "recall"})
        self.assertEqual(result["sections"][0]["location"], "foreign_device")
        self.assertEqual(len(sections), len(st["sections"]))

    def test_save_is_idempotent_and_preserves_inferred_status(self):
        self.place()
        st, _ = self.capture({"objects": ["water bottles", "soda bottles"], "categories": ["beverages"]}, {"lines": []})
        self.sess["heard"] = "Save this section"
        self.call("save")
        self.call("save")
        section = next(iter(st["sections"].values()))
        self.assertEqual(section["revision"], 1)
        self.assertEqual(section["evidence"], "inferred")
        self.assertEqual(self.call("navigate", section_id=section["id"])[0]["error"], "unverified_section")

    def test_correction_keeps_original_evidence_and_does_not_create_anchor(self):
        st, _ = self.capture({"objects": ["water bottles", "juice cartons"], "categories": ["beverages"]},
                             {"tracking": "unavailable", "pose": {}, "lines": []})
        section = next(iter(st["sections"].values()))
        self.sess["heard"] = "Actually, that is the cleaning aisle"
        self.call("correct", section_id=section["id"], label="Cleaning")
        self.assertEqual(section["evidence"], "user_confirmed")
        self.assertEqual(len(section["observations"]), 2)
        self.assertNotIn("anchor", section)

    def test_directional_and_directory_signs_have_no_destination_anchor(self):
        for text in ("East Wing →", "Radiology Floor 2"):
            with self.subTest(text=text):
                self.sess.pop("indoor_workflow", None)
                st, _ = self.capture(raw={"lines": [{"text": text, "conf": 1, "x": 2, "z": 0, "d": 2}]})
                section = next(iter(st["sections"].values()))
                self.assertNotIn("anchor", section)
                self.assertIn(section["role"], ("directional", "directory"))

    def test_product_label_is_not_an_aisle_sign(self):
        st, _ = self.capture({"signs": [{"lines": [0], "role": "product_label"}]})
        section = next(iter(st["sections"].values()))
        self.assertEqual(section["label"], "unknown")
        self.assertEqual(section["evidence"], "inferred")

    def test_generic_cans_and_official_names_are_not_inferred(self):
        for interpretation in ({"objects": ["cans", "food cans"], "categories": ["beverages"]},
                               {"objects": ["desk", "chair"], "categories": ["East Wing"]}):
            self.sess.pop("indoor_workflow", None)
            st, _ = self.capture(interpretation, {"lines": []})
            self.assertEqual(next(iter(st["sections"].values()))["label"], "unknown")

    def test_conflicting_signs_remain_distinct(self):
        st, _ = self.capture()
        self.capture(raw={"lines": [{"text": "Cleaning", "conf": 0.95, "x": 2, "z": 0, "d": 2}]})
        self.assertEqual({s["label"] for s in st["sections"].values()}, {"Beverages", "Cleaning"})
        self.assertTrue(all(s["evidence"] == "conflicting" for s in st["sections"].values()))

    def test_cross_floor_and_frame_changes_invalidate_pending_callbacks(self):
        _, action = self.call("scan")
        for field in ("request_id", "visit_id", "device_id", "frame_id", "floor"):
            with self.subTest(field=field), self.assertRaises(ValueError):
                indoor.event(self.sess, {**action, field: "wrong", "event": "cancelled"})

    def test_cancel_while_vision_is_running_does_not_merge_late_results(self):
        _, action = self.call("scan")
        raw = {"observation_id": "one", "frame_id": "frame-a", "lines": []}
        def describe(image, prompt):
            indoor.cancel(self.sess)
            return {"objects": ["water", "juice"], "categories": ["beverages"]}
        with self.assertRaises(ValueError):
            indoor.observations(self.sess, {**action, "views": [raw]}, [b"fixture"], describe)
        self.assertEqual(indoor.state(self.sess)["sections"], {})

    def test_revision_conflict_rolls_back_the_whole_save(self):
        place = self.place()
        st, _ = self.capture()
        self.capture(raw={"lines": [{"text": "Bakery", "conf": 0.95, "x": 5, "z": 0, "d": 3}]})
        self.sess["heard"] = "Save this building"
        self.call("save")
        _, stale = indoor.load_place(place["id"])
        ids = list(stale)
        concurrent = copy.deepcopy(stale[ids[1]])
        concurrent["label"] = "Other device correction"
        indoor.persist(place, [concurrent])
        stale[ids[0]]["label"] = "Must roll back"
        stale[ids[1]]["label"] = "Stale edit"
        result = indoor.persist(place, list(stale.values()))
        self.assertEqual(result["error"], "revision_conflict")
        _, stored = indoor.load_place(place["id"])
        self.assertNotEqual(stored[ids[0]]["label"], "Must roll back")
        self.assertEqual(stored[ids[1]]["label"], "Other device correction")

    def test_forget_requires_explicit_target_and_removes_shared_records(self):
        self.place()
        st, _ = self.capture()
        self.sess["heard"] = "Save this place"
        self.call("save")
        self.sess["heard"] = "Forget this section"
        self.assertEqual(self.call("forget")[0]["error"], "explicit_target_required")
        sid = next(iter(st["sections"]))
        self.assertEqual(self.call("forget", section_ids=[sid])[0]["status"], "forgotten")
        self.assertEqual(indoor.load_place(st["place"]["id"])[1], {})

    def test_route_preparation_confirmation_and_arrival_are_separate(self):
        st, _ = self.capture()
        sid = next(iter(st["sections"]))
        _, prepare = self.call("navigate", section_id=sid)
        self.assertEqual(prepare["operation"], "prepare_route")
        with self.assertRaises(ValueError):
            indoor.event(self.sess, {**prepare, "event": "confirmed", "tracking": "ok"})
        ready, action = indoor.event(self.sess, {**prepare, "event": "route_ready", "distance_m": 3, "tracking": "ok"})
        self.assertIsNone(action)
        self.assertEqual(ready["status"], "awaiting_confirmation")
        _, guiding = indoor.event(self.sess, {**prepare, "event": "confirmed", "tracking": "ok"})
        self.assertEqual(guiding["operation"], "guiding")
        _, verify = indoor.event(self.sess, {**guiding, "event": "approach_reached"})
        self.assertEqual(verify["operation"], "verify")

    def test_result_size_pagination_and_candidate_context(self):
        st = indoor.state(self.sess)
        for i in range(20):
            s = indoor.new_section("Long label " * 18 + str(i), "label", "observed", [], {"id": str(i)})
            st["sections"][s["id"]] = s
        result, _ = self.call("recall", cursor=5)
        candidates = list(st["candidates"])
        self.assertLessEqual(len(result["sections"]), 5)
        self.assertLess(len(json.dumps(result)), 2500)
        self.assertIsNotNone(result["next_cursor"])
        indoor.summary(self.sess, self.ctx)
        self.assertEqual(st["candidates"], candidates)

    def test_callback_cannot_move_rescan_or_save(self):
        ctx = {**self.ctx, "_indoor_callback": True}
        for name, args in (("indoor_workflow", {"operation": "scan"}),
                           ("indoor_workflow", {"operation": "save"}), ("start_navigation", {})):
            result, action = app.run_tool(self.sess, ctx, name, args)
            self.assertEqual(result["error"], "observation_only")
            self.assertIsNone(action)

    def test_http_observation_replay_is_idempotent_and_cancelled_callbacks_rejected(self):
        app._sessions["http"] = self.sess
        _, action = self.call("scan")
        image = io.BytesIO()
        Image.new("RGB", (2, 2)).save(image, "JPEG")
        metadata = {**action, "session": "http", "ctx": self.ctx,
                    "views": [{"observation_id": "view", "frame_id": "frame-a", "lines": []}]}
        with TestClient(app.app) as client, patch.object(app, "see", return_value='{"objects":[],"categories":[]}') as vision, \
                patch.object(app, "chat", return_value={"content": "I couldn't identify a section."}):
            def post():
                return client.post("/indoor_workflow/observations", data={"metadata": json.dumps(metadata)},
                                   files=[("images", ("view.jpg", image.getvalue(), "image/jpeg"))])
            first = post()
            self.assertEqual(first.status_code, 200, first.text)
            self.assertEqual(post().json(), first.json())
            self.assertEqual(vision.call_count, 1)
            indoor.cancel(self.sess)
            self.assertEqual(post().status_code, 409)

    def test_http_route_replay_does_not_restart_actions(self):
        app._sessions["route"] = self.sess
        st, _ = self.capture()
        _, action = self.call("navigate", section_id=next(iter(st["sections"])))
        meta = {**action, "session": "route", "event": "route_ready", "distance_m": 2, "tracking": "ok"}
        with TestClient(app.app) as client:
            response = client.post("/indoor_workflow/events", json=meta)
            self.assertEqual(response.status_code, 200)
            self.assertIn("Want me", response.json()["say"])
            self.assertEqual(client.post("/indoor_workflow/events", json=meta).json(), response.json())

    def test_known_floor_change_clears_visit_and_requests_fresh_geometry(self):
        self.place()
        st, _ = self.capture()
        visit = st["visit_id"]
        _, action = self.call("set_place", name="Test Library", address="1 Test St", floor="2")
        self.assertTrue(action["reset_map"])
        self.assertNotEqual(st["visit_id"], visit)
        self.assertEqual(st["sections"], {})

    def test_saved_map_restoration_requires_same_device_and_new_frame_confirmation(self):
        self.place()
        st, _ = self.capture()
        self.sess["heard"] = "Save this place"
        _, saving = self.call("save")
        result, _ = indoor.event(self.sess, {**saving, "event": "map_saved", "ok": True})
        self.assertTrue(result["map_saved"])
        section = next(iter(st["sections"].values()))
        self.ctx["indoor"]["frame_id"] = "new-frame"
        _, restoring = self.call("navigate", section_id=section["id"])
        self.assertTrue(restoring["restore"])
        with self.assertRaises(ValueError):
            indoor.event(self.sess, {**restoring, "event": "route_ready", "distance_m": 2, "tracking": "ok"})
        result, _ = indoor.event(self.sess, {**restoring, "frame_id": "frame-a", "event": "route_ready", "distance_m": 2, "tracking": "ok"})
        self.assertEqual(result["status"], "awaiting_confirmation")

    def test_decision_observations_preserve_existing_guidance_authorization(self):
        st, _ = self.capture()
        _, prepare = self.call("navigate", section_id=next(iter(st["sections"])))
        indoor.event(self.sess, {**prepare, "event": "route_ready", "tracking": "ok", "distance_m": 2})
        _, guiding = indoor.event(self.sess, {**prepare, "event": "confirmed", "tracking": "ok"})
        result = indoor.observations(self.sess, {**guiding, "decision": True,
            "views": [{"observation_id": "decision", "frame_id": "frame-a", "lines": []}]}, [b"fixture"],
            lambda image, prompt: {"objects": ["desk", "chairs"], "categories": ["waiting area"]})
        self.assertEqual(result["status"], "observed")
        self.assertEqual(st["pending"]["operation"], "guiding")
        self.assertEqual(st["pending"]["phase"], "active")

    def test_partial_batch_keeps_successful_views(self):
        _, action = self.call("scan", mode="around")
        views = [{"observation_id": str(i), "frame_id": "frame-a", "lines": []} for i in range(2)]
        with patch.object(indoor, "parse_observation", wraps=indoor.parse_observation):
            calls = iter([{"objects": ["water", "juice"], "categories": ["beverages"]}, ValueError("failed")])
            def describe(image, prompt):
                result = next(calls)
                if isinstance(result, Exception):
                    raise result
                return result
            result = indoor.observations(self.sess, {**action, "views": views, "rotation_degrees": 150}, [b"a", b"b"], describe)
        self.assertTrue(result["partial"])
        self.assertEqual(result["sections"][0]["label"], "beverages")
        self.assertEqual(result["sections"][0]["observed_objects"], ["water", "juice"])

    def test_corrected_category_does_not_remain_a_search_alias(self):
        st, _ = self.capture({"objects": ["water", "soda"], "categories": ["beverages"]}, {"lines": []})
        sid = next(iter(st["sections"]))
        self.sess["heard"] = "Actually this is cleaning"
        self.call("correct", section_id=sid, label="Cleaning")
        self.assertEqual(self.call("recall", query="beverages")[0]["sections"], [])

    def test_forgetting_place_removes_its_address_from_shared_library(self):
        place = self.place()
        self.capture()
        self.sess["heard"] = "Save this place"
        self.call("save")
        self.sess["heard"] = "Forget this building"
        self.assertEqual(self.call("forget", place_id=place["id"])[0]["status"], "forgotten")
        self.assertIsNone(indoor.load_place(place["id"])[0])

    def test_unicode_pages_remain_valid_and_advance(self):
        st = indoor.state(self.sess)
        for i in range(6):
            s = indoor.new_section("飲料" * 60, "objects", "inferred", [],
                                   {"id": str(i), "source": "camera", "objects": ["果汁" * 60] * 3})
            st["sections"][s["id"]] = s
        result, _ = self.call("recall")
        self.assertGreater(len(result["sections"]), 0)
        self.assertGreater(result["next_cursor"], 0)
        self.assertLess(len(json.dumps(result)), 2500)

    def test_partial_place_identity_can_be_completed_without_losing_observations(self):
        self.call("set_place", venue_type="store")
        st, _ = self.capture()
        ids = set(st["sections"])
        self.place()
        self.assertEqual(set(st["sections"]), ids)

    def test_malformed_capabilities_are_rejected(self):
        for capability in ([], "old", {"version": True, "device_id": "phone"}):
            result, _ = indoor.dispatch(self.sess, {"indoor": capability}, {"operation": "scan"})
            self.assertEqual(result["error"], "unsupported_client")

    def test_qualified_yes_does_not_authorize_movement(self):
        for text in ("yes, but don't start", "okay, where is it?", "yes stop"):
            self.assertFalse(indoor.is_confirmation(text))
        for text in ("yes please", "go ahead", "yes, let's go"):
            self.assertTrue(indoor.is_confirmation(text))

    def test_save_request_survives_identity_clarification_and_can_be_revoked(self):
        self.call("set_place", name="Test Library", address="1 Test St")
        st, _ = self.capture()
        self.sess["heard"] = "Remember this building"
        self.assertEqual(self.call("save")[0]["error"], "place_identity_required")
        self.sess["heard"] = "It is floor one"
        self.place()
        self.assertEqual(len(st["sections"]), 1)
        self.assertEqual(self.call("save")[0]["status"], "saved")
        self.sess["heard"] = "Save this again"
        self.assertTrue(indoor.explicit(self.sess, "save"))
        indoor.user_turn(self.sess, "Do not save it")
        self.sess["heard"] = "Floor one"
        self.assertFalse(indoor.explicit(self.sess, "save"))

    def test_question_about_saving_is_not_a_save_request(self):
        self.place()
        self.capture()
        self.sess["heard"] = "Do you save sections automatically?"
        self.assertEqual(self.call("save")[0]["error"], "explicit_request_required")


if __name__ == "__main__":
    unittest.main()
