"""Home Depot provider requests and store data shared by the server and collection scripts."""

import csv
import json
from pathlib import Path
import re
from urllib.parse import urlencode
from urllib.request import urlopen


def read_stores():
    with Path(__file__).with_name("home_depot_stores.csv").open() as file:
        return list(csv.DictReader(file))


def fetch_payload(parameters, store, api_key):
    query = urlencode({**parameters, "store_no": store["store_no"],
                       "zipcode": store["zipcode"], "api_key": api_key})
    # Pilot requests took tens of seconds; cap each provider read at 60 seconds.
    with urlopen("https://data.unwrangle.com/api/getter/?" + query, timeout=60) as response:
        payload = json.load(response)
    if not isinstance(payload, dict) or payload.get("success") is not True:
        raise ValueError("Provider reported an unsuccessful lookup")
    returned_store = str(payload.get("store_no", ""))
    if not returned_store.isdigit() or int(returned_store) != int(store["store_no"]):
        raise ValueError("Provider did not confirm the requested store")
    return payload


def fetch_detail(item_id, store, api_key):
    payload = fetch_payload({"platform": "homedepot_detail", "item_id": item_id}, store, api_key)
    detail = payload.get("detail")
    if not isinstance(detail, dict) or not detail:
        raise ValueError("Provider returned no product detail")
    if str(payload.get("item_id", "")) != item_id:
        raise ValueError("Provider did not confirm the requested product")
    location = detail.get("aisle_bay")
    if location is not None and not isinstance(location, str):
        raise ValueError("Provider returned an unexpected aisle_bay format")
    return detail, (location.strip() or None) if location else None


def fetch_products(query, store, api_key):
    payload = fetch_payload({"platform": "homedepot_search", "search": query}, store, api_key)
    rows = payload.get("results")
    if not isinstance(rows, list):
        raise ValueError("Missing search results")
    matches = {}
    for row in rows:
        if not isinstance(row, dict):
            raise ValueError("Invalid search result")
        item_id, title = str(row.get("id", "")), row.get("name")
        if not re.fullmatch(r"[0-9]{9}", item_id) or not isinstance(title, str):
            raise ValueError("Search result is missing its product identity")
        matches[item_id] = {"item_id": item_id, "name": title[:160],
                            "model": str(row.get("model_no") or "")[:60]}
        if len(matches) == 3:
            break
    return list(matches.values())
