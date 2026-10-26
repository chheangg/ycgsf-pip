# Home Depot tool

`home_depot` looks up products and aisle/bay labels at [nine San Diego city stores](../../../server/home_depot_stores.csv). Uses Unwrangle, a third-party API. Set `UNWRANGLE_API_KEY` in the server environment; never pass it to the model.

| `action` | Required inputs | Output |
| --- | --- | --- |
| `list_stores` | — | Store numbers, names, addresses, ZIPs |
| `search_products` | `store_no`, `query` (1–200 characters) | Up to three products: `item_id`, `name`, `model` |
| `get_location` | `store_no`, `item_id` (nine-digit Internet ID) | `aisle_bay`, `status`, product/store identity, `checked_at` (UTC) |

Ask for the store if unknown. Search, clarify the exact variant, then look up its ID. IDs persist across turns; user-supplied IDs can skip search. Invented IDs are rejected.

```json
{"action":"get_location","store_no":"0669","item_id":"312504067"}
```

Verified live result on October 25, 2026: `"aisle_bay":"Aisle 33, Bay 006"`, `"status":"located"`. Null returns `location_unavailable`; failures return `error`. Neither establishes stock status. Labels do not provide walking directions or start navigation.

One provider request per search/location action; maximum two per turn, no automatic retries. Provider read timeout: 60 seconds; frontend request timeout: 180 seconds. Results are live, not cached.

The schema lives in [server/app.py](../../../server/app.py)'s `TOOLS`; `run_tool()` returns `(lookup_home_depot(...), None)` through the existing `agent()` loop. Shared provider code: [server/home_depot.py](../../../server/home_depot.py). Deployment packaging includes the module and store CSV; server credentials must be configured separately.

Tests (Python 3.12+, existing server dependencies):

```sh
python -m unittest discover -s tests -p 'test_home_depot*.py'
```

Live search → location is verified; live model selection remains unverified.

Optional bulk CLI: [discover_home_depot.py](../../../tools/discover_home_depot.py) exports product IDs; [collect_home_depot.py](../../../tools/collect_home_depot.py) collects locations (`--products <ID-file>`). Both preview by default; `--execute` requires the key, with `--max-requests 9` by default. SQLite progress resumes under `integrations/home_depot/data/`; use one process per database and new database paths for fresh snapshots. Discovery has a 45-page/category limit and does not guarantee a complete catalog. Use `--help` for options.
