"""Store-specific Walmart aisle lookup through SerpApi."""

import atexit
import logging

import httpx


logging.getLogger("httpx").setLevel(logging.WARNING)  # INFO includes the credential-bearing URL.
client = httpx.Client(timeout=10)
atexit.register(client.close)


def fetch_location(store_no: str, item_id: str, api_key: str) -> dict:
    response = client.get("https://serpapi.com/search.json", params={
        "engine": "walmart_product", "store_id": store_no, "product_id": item_id,
        "api_key": api_key,
        "json_restrictor": "search_metadata.status,error,search_information.location.store_id,"
                           "product_result.{us_item_id,title,pickup_option.{aisle,location}}",
    })
    response.raise_for_status()
    data = response.json()
    if not isinstance(data, dict) or data.get("error") or (data.get("search_metadata") or {}).get("status") != "Success":
        raise ValueError("Provider did not confirm success")
    location = (data.get("search_information") or {}).get("location") or {}
    product = data.get("product_result") or {}
    if not isinstance(location, dict) or not isinstance(product, dict):
        raise ValueError("Provider returned invalid identities")
    if str(location.get("store_id")) != store_no or str(product.get("us_item_id")) != item_id:
        raise ValueError("Provider returned mismatched identities")
    pickup = product.get("pickup_option") or {}
    if not isinstance(pickup, dict) or not isinstance(pickup.get("aisle"), (str, type(None))):
        raise ValueError("Provider returned an invalid aisle")
    aisle = pickup.get("aisle")
    aisle = aisle.strip() or None if aisle else None
    return {"store_no": store_no, "store_name": str(pickup.get("location") or "")[:160],
            "item_id": item_id, "name": str(product.get("title") or "")[:160],
            "aisle": aisle, "status": "located" if aisle else "location_unavailable"}
