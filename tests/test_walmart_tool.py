"""Walmart tool contract; provider and model calls are mocked."""

import json
import os
from pathlib import Path
import sys
import unittest
from unittest.mock import Mock, patch

import httpx

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import app, walmart


class WalmartToolTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        patch.dict(os.environ, {"SERPAPI_API_KEY": "fixture-secret"}).start()
        self.get = patch.object(walmart.client, "get").start()
        self.addCleanup(app._sessions.clear)
        self.get.return_value = Mock()
        self.get.return_value.json.return_value = self.payload()

    def payload(self, **changes):
        data = {"search_metadata": {"status": "Success"},
                "search_information": {"location": {"store_id": "2479"}},
                "product_result": {"us_item_id": "10450114", "title": "Great Value Whole Vitamin D Milk, Gallon",
                                   "pickup_option": {"location": "San Diego College Ave Supercenter", "aisle": "A21"}}}
        data.update(changes)
        return data

    def invoke(self, session=None, **args):
        session = session if session is not None else {"heard": "Walmart store 2479, item 10450114"}
        result, action = app.run_tool(session, {}, "get_walmart_location", args or
                                      {"store_no": "2479", "item_id": "10450114"})
        self.assertIsNone(action)
        return result

    def test_schema_dispatch_and_verified_aisle(self):
        schemas = [t["function"] for t in app.TOOLS if t["function"]["name"] == "get_walmart_location"]
        self.assertEqual(len(schemas), 1)
        self.assertEqual(schemas[0]["parameters"]["required"], ["store_no", "item_id"])
        result = self.invoke()
        self.assertEqual(result, {"store_no": "2479", "store_name": "San Diego College Ave Supercenter",
                                  "item_id": "10450114", "name": "Great Value Whole Vitamin D Milk, Gallon",
                                  "aisle": "A21", "status": "located"})
        self.get.assert_called_once()
        self.assertEqual(self.get.call_args.args, ("https://serpapi.com/search.json",))
        params = self.get.call_args.kwargs["params"]
        self.assertEqual((params["engine"], params["store_id"], params["product_id"]),
                         ("walmart_product", "2479", "10450114"))
        self.assertIn("pickup_option.{aisle,location}", params["json_restrictor"])

    def test_invalid_unverified_and_missing_key_never_request(self):
        for args in (None, [], {}, {"store_no": "2479"}, {"item_id": "10450114"},
                     {"store_no": "0", "item_id": "10450114"},
                     {"store_no": 2479, "item_id": "10450114"},
                     {"store_no": "2479", "item_id": "abc"}):
            with self.subTest(args=args):
                result, action = app.run_tool({"heard": "Walmart store 2479, item 10450114"}, {},
                                              "get_walmart_location", args)
                self.assertIn("error", result)
                self.assertIsNone(action)
        self.assertEqual(self.invoke({"heard": "Walmart item 10450114"})["error"], "unverified_store_no")
        self.assertEqual(self.invoke({"heard": "Walmart store 2479"})["error"], "unverified_item_id")
        with patch.dict(os.environ, {}, clear=True):
            self.assertEqual(self.invoke()["error"], "lookup_not_configured")
        self.get.assert_not_called()

    def test_identity_mismatch_provider_failure_timeout_and_absent_aisle(self):
        for change in ({"search_information": {"location": {"store_id": "9999"}}},
                       {"product_result": {"us_item_id": "999", "pickup_option": {"aisle": "A21"}}},
                       {"error": "fixture-secret bad request"},
                       {"search_metadata": {"status": "Error"}}):
            with self.subTest(change=change), self.assertLogs("ycgsf", level="WARNING") as logs:
                self.get.return_value.json.return_value = self.payload(**change)
                result = self.invoke()
                self.assertEqual(result["error"], "lookup_failed")
                self.assertNotIn("aisle", result)
                self.assertNotIn("fixture-secret", json.dumps(result) + str(logs.output))
        self.get.return_value.json.return_value = self.payload()
        self.get.return_value.json.return_value["product_result"]["pickup_option"]["aisle"] = None
        self.assertEqual(self.invoke()["status"], "location_unavailable")
        self.get.side_effect = httpx.ReadTimeout("fixture-secret")
        with self.assertLogs("ycgsf", level="WARNING") as logs:
            result = self.invoke()
        self.assertEqual(result["error"], "lookup_failed")
        self.assertNotIn("fixture-secret", json.dumps(result) + str(logs.output))
        self.get.side_effect = httpx.HTTPStatusError("fixture-secret", request=httpx.Request("GET", "https://example.test"),
                                                    response=httpx.Response(503))
        with self.assertLogs("ycgsf", level="WARNING") as logs:
            result = self.invoke()
        self.assertEqual(result["error"], "lookup_failed")
        self.assertNotIn("fixture-secret", json.dumps(result) + str(logs.output))

    def test_one_provider_request_per_turn_and_prior_user_ids(self):
        session = {"heard": "Find the aisle", "history": [
            {"role": "user", "content": "Walmart store 2479"},
            {"role": "assistant", "content": "Which item ID?"},
            {"role": "user", "content": "10450114"}]}
        self.assertEqual(self.invoke(session)["aisle"], "A21")
        self.assertIn("limit", self.invoke(session)["error"])
        self.assertEqual(self.get.call_count, 1)

    def test_walmart_question_does_not_force_map_lookup(self):
        with patch.object(app, "chat", return_value={"content": "Which Walmart store number and item ID?"}) as model:
            result = app.agent("walmart-question", "Which aisle is the milk in at Walmart?", {})
        self.assertEqual(model.call_count, 1)
        self.assertEqual(result["tools"], [])
        self.assertIsNone(result["action"])
        self.assertFalse(app._sessions["walmart-question"].get("outside"))
        self.get.assert_not_called()

    def test_agent_lookup_uses_one_request_and_no_navigation(self):
        call = {"tool_calls": [{"id": "fixture", "type": "function", "function": {
            "name": "get_walmart_location", "arguments": json.dumps({"store_no": "2479", "item_id": "10450114"})}}]}
        with patch.object(app, "chat", side_effect=[call, call, {"content": "Aisle A21 at San Diego College Ave."}]) as model:
            result = app.agent("walmart-lookup", "Walmart store 2479, item 10450114: which aisle?", {})
        self.assertEqual(model.call_count, 3)
        self.assertEqual(self.get.call_count, 1)
        self.assertEqual([entry["tool"] for entry in result["tools"]], ["get_walmart_location"] * 2)
        self.assertIsNone(result["action"])
        self.assertFalse(app._sessions["walmart-lookup"].get("outside"))


if __name__ == "__main__":
    unittest.main()
