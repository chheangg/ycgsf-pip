#!/usr/bin/env python3
"""Discover Home Depot product IDs by category across the nine San Diego stores."""

import argparse
from datetime import datetime, timezone
import logging
import os
from pathlib import Path
import re
import sqlite3
import time
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit

from collect_home_depot import ROOT
from server.home_depot import fetch_payload, read_stores


def read_categories(path):
    urls = list(dict.fromkeys(line.strip() for line in path.read_text().splitlines()
                             if line.strip() and not line.lstrip().startswith("#")))
    for url in urls:
        parsed = urlsplit(url)
        if (parsed.scheme != "https" or parsed.netloc != "www.homedepot.com"
                or not parsed.path.startswith("/b/") or parsed.fragment):
            raise ValueError("Categories must be HTTPS www.homedepot.com/b/ URLs")
    if not urls:
        raise ValueError("No category URLs supplied")
    return urls


def parse_page(payload, expected_page):
    if payload.get("page") != expected_page:
        raise ValueError("Provider did not confirm the requested page")
    pages = payload.get("no_of_pages")
    total = payload.get("total_results")
    rows = payload.get("results")
    if (type(pages) is not int or pages < 0 or type(total) is not int or total < 0
            or not isinstance(rows, list)):
        raise ValueError("Missing or invalid category pagination metadata")
    if (total > 0 and (not rows or pages < expected_page)) or (total == 0 and rows):
        raise ValueError("Category results disagree with pagination metadata")
    products = {}
    for row in rows:
        if not isinstance(row, dict) or not re.fullmatch(r"[0-9]{9}", str(row.get("id", ""))):
            raise ValueError("Category contains an invalid product ID")
        products[str(row["id"])] = row.get("name")
    return pages, total, products


def discover(connection, stores, categories, api_key, max_requests, delay):
    connection.executescript("""
        CREATE TABLE IF NOT EXISTS category_pages (
            store_no TEXT NOT NULL, category_url TEXT NOT NULL, page INTEGER NOT NULL,
            reported_pages INTEGER NOT NULL, total_results INTEGER NOT NULL,
            checked_at TEXT NOT NULL, PRIMARY KEY (store_no, category_url, page)
        );
        CREATE TABLE IF NOT EXISTS category_products (
            store_no TEXT NOT NULL, category_url TEXT NOT NULL, item_id TEXT NOT NULL,
            product_name TEXT, PRIMARY KEY (store_no, category_url, item_id)
        );
    """)
    calls = 0
    # Page-first traversal samples all categories and stores before going deeper.
    for page in range(1, 46):  # Provider-documented maximum: 45 pages per category.
        for category in categories:
            for store in stores:
                key = (store["store_no"], category)
                previous = connection.execute(
                    "SELECT page, reported_pages FROM category_pages WHERE store_no=? "
                    "AND category_url=? ORDER BY page DESC LIMIT 1", key,
                ).fetchone()
                if previous and (page <= previous[0] or page > previous[1]):
                    continue
                if calls >= max_requests:
                    return calls
                if calls:
                    time.sleep(delay)
                calls += 1
                try:
                    payload = fetch_payload({"platform": "homedepot_category",
                                             "url": category, "page": page}, store, api_key)
                    pages, total, products = parse_page(payload, page)
                except HTTPError as error:
                    raise RuntimeError(f"Category discovery stopped on HTTP {error.code}; rerun to resume") from None
                except (URLError, TimeoutError, OSError, ValueError):
                    raise RuntimeError(
                        f"Category lookup failed for store {store['store_no']}, page {page}; "
                        "this page remains pending. Rerun to retry."
                    ) from None
                with connection:
                    connection.executemany("INSERT OR IGNORE INTO category_products VALUES (?, ?, ?, ?)",
                                           [(key[0], key[1], item_id, name)
                                            for item_id, name in products.items()])
                    connection.execute("INSERT INTO category_pages VALUES (?, ?, ?, ?, ?, ?)",
                                       (*key, page, pages, total, datetime.now(timezone.utc).isoformat()))
                logging.info("Store %s, category %s, page %s: %s IDs (reported pages: %s)",
                             key[0], category, page, len(products), pages)
    return calls


def export_discovery(connection, output):
    if not connection.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name='category_products'"
    ).fetchone():
        return
    ids = [row[0] for row in connection.execute(
        "SELECT DISTINCT item_id FROM category_products ORDER BY item_id"
    )]
    if ids:
        output.parent.mkdir(parents=True, exist_ok=True)
        temporary = output.with_name(output.name + ".tmp")
        temporary.write_text("\n".join(ids) + "\n")
        temporary.replace(output)
    logging.info("Discovered %s unique product IDs", len(ids))
    for store, category, last_page, pages, total, found in connection.execute("""
        SELECT p.store_no, p.category_url, MAX(p.page),
               MAX(p.reported_pages), MAX(p.total_results),
               (SELECT COUNT(*) FROM category_products c WHERE c.store_no=p.store_no
                AND c.category_url=p.category_url)
        FROM category_pages p GROUP BY p.store_no, p.category_url
    """):
        if pages > 45 or (last_page >= min(pages, 45) and found < total):
            logging.warning("Incomplete coverage: store %s, %s: %s unique IDs / %s reported; "
                            "add narrower category/filter URLs", store, category, found, total)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    base = ROOT / "integrations/home_depot"
    parser.add_argument("--categories", type=Path, default=base / "category_urls.txt")
    parser.add_argument("--database", type=Path, default=base / "data/catalog.sqlite3")
    parser.add_argument("--output", type=Path, default=base / "data/product_ids.txt")
    parser.add_argument("--max-requests", type=int, default=9,
                        help="Maximum HTTP attempts per invocation (default: 9)")
    parser.add_argument("--delay", type=float, default=1.0,
                        help="Seconds between requests (default: 1, conservative serial pacing)")
    parser.add_argument("--execute", action="store_true", help="Make billable category requests")
    args = parser.parse_args()
    if args.max_requests < 1 or not 0 <= args.delay <= 60:
        parser.error("max-requests must be positive; delay must be between 0 and 60 seconds")
    if args.output.resolve() in (args.database.resolve(), args.categories.resolve()):
        parser.error("Output must not overwrite the database or category input")
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        stores, categories = read_stores(), read_categories(args.categories)
        logging.info("Discovery scope: %s San Diego stores x %s category URLs", len(stores), len(categories))
        logging.info("Request cap: %s; up to 45 pages/category; catalog completeness is unverified", args.max_requests)
        if not args.execute:
            logging.info("Preview only. Add --execute with UNWRANGLE_API_KEY configured.")
            return 0
        api_key = os.environ.get("UNWRANGLE_API_KEY")
        if not api_key:
            parser.error("Set UNWRANGLE_API_KEY before using --execute")
        args.database.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(args.database)
        try:
            calls = discover(connection, stores, categories, api_key, args.max_requests, args.delay)
            logging.info("Discovery made %s requests this run", calls)
        finally:
            try:
                export_discovery(connection, args.output)
            finally:
                connection.close()
        return 0
    except (OSError, ValueError, RuntimeError, sqlite3.Error) as error:
        logging.error("%s", error)
        return 1
    except KeyboardInterrupt:
        logging.error("Interrupted; completed pages saved. Rerun to resume.")
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
