import io
import json
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "tools"))
import collect_home_depot as collector
import discover_home_depot as discovery
from server import home_depot


class HomeDepotTests(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.stores = collector.read_stores()[:2]
        self.category = "https://www.homedepot.com/b/Tools/N-5yc1vZc1xy"

    def page(self, parameters, store, key):
        page = parameters["page"]
        return {"page": page, "no_of_pages": 2, "total_results": 2,
                "results": [{"id": str(100000000 + page), "name": "Fixture"}]}

    def test_discovery_resume_budget_and_export(self):
        with patch.object(discovery, "fetch_payload", side_effect=self.page) as fetch:
            self.assertEqual(discovery.discover(self.db, self.stores, [self.category], "key", 1, 0), 1)
            self.assertEqual(discovery.discover(self.db, self.stores, [self.category], "key", 9, 0), 3)
            self.assertEqual(discovery.discover(self.db, self.stores, [self.category], "key", 9, 0), 0)
            self.assertEqual(fetch.call_count, 4)
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / "products.txt"
            discovery.export_discovery(self.db, output)
            self.assertEqual(output.read_text(), "100000001\n100000002\n")

    def test_pagination_cap_reports_incomplete(self):
        def capped(parameters, store, key):
            payload = self.page(parameters, store, key)
            payload.update(no_of_pages=46, total_results=46)
            return payload
        with patch.object(discovery, "fetch_payload", side_effect=capped):
            self.assertEqual(discovery.discover(self.db, self.stores[:1], [self.category], "key", 99, 0), 45)
        with tempfile.TemporaryDirectory() as directory, self.assertLogs(level="WARNING") as logs:
            discovery.export_discovery(self.db, Path(directory) / "ids.txt")
        self.assertIn("Incomplete coverage", logs.output[0])

    def test_failure_leaves_page_pending_without_key_leak(self):
        error = HTTPError("https://example.test/?api_key=secret", 429, "limited", {}, None)
        with patch.object(discovery, "fetch_payload", side_effect=error):
            with self.assertRaises(RuntimeError) as caught:
                discovery.discover(self.db, self.stores, [self.category], "secret", 1, 0)
        self.assertNotIn("secret", str(caught.exception))
        self.assertEqual(self.db.execute("SELECT COUNT(*) FROM category_pages").fetchone()[0], 0)
        with patch.object(discovery, "fetch_payload", side_effect=self.page):
            self.assertEqual(discovery.discover(self.db, self.stores, [self.category], "secret", 1, 0), 1)

    def test_invalid_or_empty_page_not_marked_complete(self):
        cases = [
            {"page": 2, "no_of_pages": 2, "total_results": 2, "results": []},
            {"page": 1, "no_of_pages": 2, "total_results": 2, "results": []},
            {"page": 1, "results": []},
            {"page": 1, "no_of_pages": 1, "total_results": 1, "results": [{"id": "bad"}]},
        ]
        for payload in cases:
            with self.subTest(payload=payload), self.assertRaises(ValueError):
                discovery.parse_page(payload, 1)
        self.assertEqual(discovery.parse_page(
            {"page": 1, "no_of_pages": 0, "total_results": 0, "results": []}, 1), (0, 0, {}))

    def test_collector_resumes_and_preserves_missing_location(self):
        with patch.object(collector, "fetch_detail", return_value=({"name": "Fixture"}, None)) as fetch:
            self.assertEqual(collector.collect(self.db, self.stores, ["100000001"], "key", 1, 0), 1)
            self.assertEqual(collector.collect(self.db, self.stores, ["100000001"], "key", 9, 0), 1)
            self.assertEqual(collector.collect(self.db, self.stores, ["100000001"], "key", 9, 0), 0)
            self.assertEqual(fetch.call_count, 2)
        self.assertEqual(self.db.execute("SELECT DISTINCT status FROM locations").fetchall(),
                         [("location_unavailable",)])

    def test_provider_identity_validation(self):
        payload = {"success": True, "store_no": "669", "item_id": "100000001",
                   "detail": {"name": "Fixture", "aisle_bay": "  Aisle 1 Bay 2  "}}
        with patch.object(home_depot, "urlopen", return_value=io.BytesIO(json.dumps(payload).encode())):
            self.assertEqual(collector.fetch_detail("100000001", self.stores[0], "key")[1], "Aisle 1 Bay 2")
        for field, bad in (("store_no", "9999"), ("item_id", "100000002"), ("success", False)):
            wrong = {**payload, field: bad}
            with self.subTest(field=field), patch.object(home_depot, "urlopen", return_value=io.BytesIO(json.dumps(wrong).encode())):
                with self.assertRaises(ValueError):
                    collector.fetch_detail("100000001", self.stores[0], "key")

    def test_preview_has_no_network_or_database_side_effects(self):
        with tempfile.TemporaryDirectory() as directory:
            database = Path(directory) / "missing.sqlite3"
            with patch.object(discovery, "fetch_payload") as fetch, patch.object(sys, "argv", [
                "discover_home_depot.py", "--database", str(database)
            ]):
                self.assertEqual(discovery.main(), 0)
                fetch.assert_not_called()
                self.assertFalse(database.exists())


if __name__ == "__main__":
    unittest.main()
