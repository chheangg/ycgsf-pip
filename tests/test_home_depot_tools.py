"""Run with the server dependencies installed; HTTP and model responses are mocked."""

import io
import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import app, home_depot


class HomeDepotToolTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {"UNWRANGLE_API_KEY": "fixture-secret"}).start()
        self.http = patch.object(home_depot, "urlopen").start()
        self.addCleanup(app._sessions.clear)

    def response(self, **fields):
        return io.BytesIO(json.dumps({"success": True, "store_no": "669", **fields}).encode())

    def tool_call(self, action, **args):
        return {"tool_calls": [{"id": "fixture", "type": "function",
                                "function": {"name": "home_depot", "arguments": json.dumps({"action": action, **args})}}]}

    def invoke(self, action, args, session=None):
        if session is None:
            session = {"heard": "Find 312504067"}
        result, app_action = app.run_tool(session, {}, "home_depot", {"action": action, **args})
        self.assertIsNone(app_action)
        return result

    def test_tools_registered_and_store_listing_needs_no_key(self):
        names = [t["function"]["name"] for t in app.TOOLS]
        self.assertEqual(names.count("home_depot"), 1)
        for old_name in ("list_home_depot_stores", "search_home_depot_products", "get_home_depot_location"):
            self.assertNotIn(old_name, names)
        self.assertFalse(hasattr(home_depot, "TOOLS"))
        self.assertFalse(hasattr(home_depot, "TOOL_NAMES"))
        self.assertFalse(hasattr(home_depot, "lookup"))
        schema = next(t["function"]["parameters"] for t in app.TOOLS if t["function"]["name"] == "home_depot")
        self.assertEqual(schema["required"], ["action"])
        self.assertEqual(schema["properties"]["action"]["enum"], ["list_stores", "search_products", "get_location"])
        with patch.dict(os.environ, {}, clear=True):
            result, action = app.run_tool({}, {}, "home_depot", {"action": "list_stores"})
        self.assertIsNone(action)
        self.assertEqual(len(result["stores"]), 9)
        self.http.assert_not_called()

    def test_search_returns_product_identity_and_fixed_endpoint(self):
        self.http.return_value = self.response(results=[
            {"id": "312504067", "name": "Black floor tiles", "model_no": "11N-532-18X18HD"}])
        result = self.invoke("search_products", {"query": "floor tiles", "store_no": "0669"})
        self.assertEqual(result["products"][0]["item_id"], "312504067")
        url = self.http.call_args.args[0]
        self.assertTrue(url.startswith("https://data.unwrangle.com/api/getter/?"))
        self.assertIn("platform=homedepot_search", url)
        self.assertIn("search=floor+tiles", url)
        self.assertIn("zipcode=92128", url)
        self.assertNotIn("fixture-secret", json.dumps(result))

    def test_invalid_arguments_and_missing_key_do_not_call_provider(self):
        for args in ({"query": "tiles"}, {"query": "tiles", "store_no": "9999"},
                     {"query": [], "store_no": "0669"}, {"query": "x" * 201, "store_no": "0669"}):
            self.assertIn("error", self.invoke("search_products", args))
        with patch.dict(os.environ, {}, clear=True):
            result = self.invoke("search_products", {"query": "tiles", "store_no": "0669"})
        self.assertEqual(result["error"], "lookup_not_configured")
        self.http.assert_not_called()

    def test_action_and_action_specific_fields_are_validated(self):
        cases = [None, [], {}, {"action": "unknown"}, {"action": []},
                 {"action": "search_products", "store_no": "0669"},
                 {"action": "search_products", "store_no": "0669", "query": "   "},
                 {"action": "get_location", "store_no": "0669"},
                 {"action": "get_location", "item_id": "312504067"},
                 {"action": "get_location", "store_no": "0669", "item_id": "123"}]
        for args in cases:
            with self.subTest(args=args):
                session = {"heard": "Find 312504067"}
                result, action = app.run_tool(session, {}, "home_depot", args)
                self.assertIn("error", result)
                self.assertIsNone(action)
                self.assertNotIn("home_depot_calls", session)
        self.http.assert_not_called()

    def test_null_is_distinct_from_http_failure_and_secret_is_redacted(self):
        args = {"item_id": "312504067", "store_no": "0669"}
        self.http.return_value = self.response(item_id="312504067", detail={"name": "Tiles", "aisle_bay": None})
        result = self.invoke("get_location", args)
        self.assertIsNone(result["aisle_bay"])
        self.assertEqual(result["status"], "location_unavailable")
        self.http.side_effect = HTTPError("https://example.test/?api_key=fixture-secret", 404, "missing", {}, None)
        with self.assertLogs("ycgsf", level="WARNING") as logs:
            result = self.invoke("get_location", args)
        self.assertEqual(result["http_status"], 404)
        self.assertNotIn("aisle_bay", result)
        self.assertNotIn("fixture-secret", json.dumps(result) + str(logs.output))

    def test_wrong_store_response_does_not_become_a_location(self):
        self.http.return_value = self.response(store_no="9999", item_id="312504067",
                                              detail={"name": "Tiles", "aisle_bay": "Aisle 99, Bay 999"})
        with self.assertLogs("ycgsf", level="WARNING"):
            result = self.invoke("get_location", {"item_id": "312504067", "store_no": "0669"})
        self.assertEqual(result["error"], "lookup_failed")
        self.assertNotIn("aisle_bay", result)

    def test_unverified_or_malformed_product_id_is_rejected(self):
        for item_id in ("312504067", [], None):
            result, action = app.run_tool({}, {}, "home_depot", {"action": "get_location", "item_id": item_id, "store_no": "0669"})
            self.assertIn("error", result)
            self.assertIsNone(action)
        self.http.assert_not_called()

    def test_direct_user_id_is_accepted_indoors(self):
        self.http.return_value = self.response(item_id="312504067", detail={"name": "Tiles", "aisle_bay": "Aisle 25, Bay EC2"})
        result, action = app.run_tool({"heard": "Find 312504067", "outside": False}, {},
                                      "home_depot", {"action": "get_location", "item_id": "312504067", "store_no": "0669"})
        self.assertEqual(result["aisle_bay"], "Aisle 25, Bay EC2")
        self.assertIsNone(action)

    def test_paid_tool_calls_are_bounded(self):
        self.http.side_effect = [self.response(results=[]), self.response(results=[])]
        session = {}
        for _ in range(2):
            app.run_tool(session, {}, "home_depot", {"action": "search_products", "query": "tiles", "store_no": "0669"})
        result, _ = app.run_tool(session, {}, "home_depot", {"action": "search_products", "query": "tiles", "store_no": "0669"})
        self.assertIn("limit", result["error"])
        self.assertEqual(self.http.call_count, 2)

    def test_agent_search_and_next_turn_location_keep_ids_without_navigation(self):
        self.http.side_effect = [
            self.response(results=[{"id": "312504067", "name": "Black floor tiles"}]),
            self.response(item_id="312504067", detail={"name": "Black floor tiles", "aisle_bay": "Aisle 33, Bay 006"}),
        ]
        with patch.object(app, "chat", side_effect=[
            self.tool_call("search_products", query="floor tiles", store_no="0669"),
            {"content": "Do you mean the black floor tiles?"},
        ]) as model:
            first = app.agent("retail-test", "Find floor tiles at Home Depot Carmel Mtn", {})
            self.assertEqual(model.call_count, 2)
        self.assertIsNone(first["action"])
        self.assertEqual(first["tools"][0]["tool"], "home_depot")
        self.assertEqual(first["tools"][0]["args"]["action"], "search_products")
        with patch.object(app, "chat", side_effect=[
            self.tool_call("get_location", item_id="312504067", store_no="0669"),
            {"content": "At Carmel Mtn: Aisle 33, Bay 006."},
        ]) as model:
            second = app.agent("retail-test", "Yes, those tiles", {})
            self.assertIn("312504067", model.call_args_list[0].args[1][0]["content"])
            self.assertEqual(model.call_count, 2)
            tool_message = model.call_args_list[-1].args[1][-1]
            self.assertEqual(json.loads(tool_message["content"])["aisle_bay"], "Aisle 33, Bay 006")
        self.assertIsNone(second["action"])
        self.assertEqual(app._sessions["retail-test"]["home_depot_calls"], 1)

    def test_agent_all_actions_share_existing_tool_loop(self):
        self.http.side_effect = [
            self.response(results=[{"id": "312504067", "name": "Black floor tiles"}]),
            self.response(item_id="312504067", detail={"name": "Black floor tiles", "aisle_bay": "Aisle 33, Bay 006"}),
        ]
        with patch.object(app, "chat", side_effect=[
            self.tool_call("list_stores"),
            self.tool_call("search_products", query="black floor tiles", store_no="0669"),
            self.tool_call("get_location", item_id="312504067", store_no="0669"),
            {"content": "At Carmel Mtn: Aisle 33, Bay 006."},
        ]) as model:
            result = app.agent("all-actions", "Find black floor tiles at Home Depot Carmel Mtn", {})
        self.assertEqual(model.call_count, 4)
        self.assertEqual([t["tool"] for t in result["tools"]], ["home_depot"] * 3)
        self.assertEqual([t["args"]["action"] for t in result["tools"]],
                         ["list_stores", "search_products", "get_location"])
        self.assertIsNone(result["action"])
        self.assertEqual(self.http.call_count, 2)
        messages = model.call_args.args[1]
        tool_results = [json.loads(m["content"]) for m in messages if m["role"] == "tool"]
        self.assertEqual(len(tool_results[0]["stores"]), 9)
        self.assertEqual(tool_results[1]["products"][0]["item_id"], "312504067")
        self.assertEqual(tool_results[2]["aisle_bay"], "Aisle 33, Bay 006")

    def test_malformed_provider_response_is_not_saved_as_a_result(self):
        for fields in ({"results": None}, {"results": [{"name": "Missing ID"}]},
                       {"results": ["invalid"]}):
            with self.subTest(fields=fields):
                self.http.return_value = self.response(**fields)
                session = {}
                with self.assertLogs("ycgsf", level="WARNING"):
                    result = self.invoke("search_products", {"query": "tiles", "store_no": "0669"}, session)
                self.assertEqual(result["error"], "lookup_failed")
                self.assertNotIn("home_depot", session)

    def test_home_depot_store_question_is_not_forced_into_map_search(self):
        with patch.object(app, "chat", return_value={"content": "Which Home Depot store are you in?"}) as model:
            result = app.agent("store-question", "Which aisle has tiles at Home Depot?", {})
        self.assertEqual(model.call_count, 1)
        self.assertEqual(result["tools"], [])
        self.http.assert_not_called()

    def test_search_output_fits_agent_tool_message_limit(self):
        self.http.return_value = self.response(results=[
            {"id": str(100000000 + i), "name": "Long product " * 50, "model_no": "x" * 100}
            for i in range(10)])
        result = self.invoke("search_products", {"query": "tiles", "store_no": "0669"})
        self.assertEqual(len(result["products"]), 3)
        self.assertLess(len(json.dumps(result)), 2500)


if __name__ == "__main__":
    unittest.main()
