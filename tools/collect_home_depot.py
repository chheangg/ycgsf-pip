#!/usr/bin/env python3
"""Collect store-specific aisle locations through Unwrangle; preview by default."""

import argparse
from datetime import datetime, timezone
import logging
import os
from pathlib import Path
import re
import sqlite3
import sys
import time
from urllib.error import HTTPError, URLError


ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from server.home_depot import fetch_detail, read_stores


def read_inputs(products_path):
    stores = read_stores()
    products = []
    for line in products_path.read_text().splitlines():
        item_id = line.strip()
        if not item_id or item_id.startswith("#"):
            continue
        if not re.fullmatch(r"[0-9]{9}", item_id):
            raise ValueError("Products file must contain one 9-digit Home Depot Internet ID per line")
        products.append(item_id)
    products = list(dict.fromkeys(products))
    if not products:
        raise ValueError("Products file contains no Internet IDs")
    return stores, products


def collect(connection, stores, products, api_key, max_requests, delay):
    connection.execute("""CREATE TABLE IF NOT EXISTS locations (
        store_no TEXT NOT NULL, item_id TEXT NOT NULL, store_name TEXT NOT NULL,
        zipcode TEXT NOT NULL, product_name TEXT, aisle_bay TEXT,
        status TEXT NOT NULL, checked_at TEXT NOT NULL,
        PRIMARY KEY (store_no, item_id)
    )""")
    calls = 0
    for item_id in products:
        for store in stores:
            if connection.execute(
                "SELECT 1 FROM locations WHERE store_no=? AND item_id=?",
                (store["store_no"], item_id),
            ).fetchone():
                continue
            if calls >= max_requests:
                return calls
            if calls:
                time.sleep(delay)
            calls += 1
            try:
                detail, location = fetch_detail(item_id, store, api_key)
            except HTTPError as error:
                # Never log the URL: its query string contains the API key.
                raise RuntimeError(f"Stopped on HTTP {error.code}; rerun to resume") from None
            except (URLError, TimeoutError, OSError, ValueError):
                raise RuntimeError(
                    f"Lookup failed for product {item_id}, store {store['store_no']}; "
                    "no completion recorded for this pair. Rerun to retry."
                ) from None
            with connection:
                connection.execute(
                    "INSERT INTO locations VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
                    (store["store_no"], item_id, store["name"], store["zipcode"],
                     detail.get("name"), location,
                     "located" if location else "location_unavailable",
                     datetime.now(timezone.utc).isoformat()),
                )
            logging.info("Product %s / store %s: %s", item_id, store["store_no"],
                         "located" if location else "location unavailable")
    return calls


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--products", type=Path, required=True,
                        help="Text file with one Home Depot Internet ID per line")
    parser.add_argument("--database", type=Path,
                        default=ROOT / "integrations/home_depot/data/locations.sqlite3")
    parser.add_argument("--max-requests", type=int, default=9,
                        help="Maximum HTTP attempts this run (default: 9)")
    parser.add_argument("--delay", type=float, default=1.0,
                        help="Seconds between calls (default: 1, conservative serial pacing)")
    parser.add_argument("--execute", action="store_true", help="Make billable API requests")
    args = parser.parse_args()
    if args.max_requests < 1 or not 0 <= args.delay <= 60:
        parser.error("max-requests must be positive; delay must be between 0 and 60 seconds")
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        stores, products = read_inputs(args.products)
        logging.info("Scope: %s San Diego stores x %s products = %s pairs",
                     len(stores), len(products), len(stores) * len(products))
        logging.info("Request cap: %s per run; completed pairs are skipped", args.max_requests)
        if not args.execute:
            logging.info("Preview only. Add --execute to collect with UNWRANGLE_API_KEY.")
            return 0
        api_key = os.environ.get("UNWRANGLE_API_KEY")
        if not api_key:
            parser.error("Set UNWRANGLE_API_KEY in your environment before using --execute")
        args.database.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(args.database)
        try:
            calls = collect(connection, stores, products, api_key, args.max_requests, args.delay)
        finally:
            connection.close()
        logging.info("Saved progress to %s (%s requests this run)", args.database, calls)
        return 0
    except (OSError, ValueError, RuntimeError, sqlite3.Error) as error:
        logging.error("%s", error)
        return 1
    except KeyboardInterrupt:
        logging.error("Interrupted; committed results are saved. Rerun to resume.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
