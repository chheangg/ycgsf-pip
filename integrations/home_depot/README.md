# Home Depot aisle collection — San Diego city

The shared [store CSV](../../server/home_depot_stores.csv) lists nine locations with San Diego addresses in the [official California directory](https://www.homedepot.com/l/CA), checked October 25, 2026. Each row links to its official store page. Imperial Beach #0671 is included because its address is 525 Saturn Blvd, San Diego. This scope uses the retailer's address city; it is not a municipal-boundary GIS audit.

## Model tool

The repository's model tools follow this convention:

1. `server/app.py` registers function schemas in `TOOLS` and supplies them to the brain's chat request.
2. `run_tool()` dispatches each call and returns `(result_for_model, optional_app_action)`.
3. `agent()` sends the JSON result back as a tool message so the model can answer or select the next tool.
4. The top-level `tools/` directory contains command-line utilities; adding a script there does not expose it to the model.

The model sees exactly one function named `home_depot`, declared inline in `server/app.py`'s `TOOLS` list, like the existing `control` tool. A direct `if name == "home_depot"` branch in `run_tool()` returns `(lookup_home_depot(sess, args), None)`. The normal helper in that file validates arguments and manages conversation state; `server/home_depot.py` contains only shared provider requests and store data, with no tool registry or tool-name dispatcher.

| `home_depot` action | Additional arguments | Result |
| --- | --- | --- |
| `list_stores` | none | Nine stores, numbers, addresses and ZIPs |
| `search_products` | `query`, `store_no` | Up to three candidates with names, Internet IDs and models |
| `get_location` | `item_id`, `store_no` | Store, product, aisle/bay string or null, status and retrieval time |

`action` is required. The handler requires a supported store number for search and location, a 1–200 character query for search, and a nine-digit Internet ID for location. For example:

```json
{"action": "get_location", "store_no": "0669", "item_id": "312504067"}
```

Example: “Find black floor tiles at the Carmel Mtn Home Depot.” The model searches store `0669`, clarifies the exact product if needed, then looks up the selected Internet ID. Product IDs remain in session context for a follow-up answer. A direct nine-digit ID supplied by the user also works. The server rejects invented IDs not present in that context or the current user message. The model asks for the store when unknown. The tool returns no app action and does not start navigation.

Set `UNWRANGLE_API_KEY` in the **server process environment** before starting/restarting the server. The key is never a tool argument or model result. Missing credentials, HTTP errors, null locations and malformed responses have distinct outcomes. There are at most two paid tool invocations per conversation turn, with no automatic HTTP retries. The user speech request timeout is 180 seconds to accommodate two provider reads of up to 60 seconds plus transcription/model time.

`tools/deploy.sh` now includes the shared Python module and store CSV. This change has not been deployed, and no credential has been installed on the server. CLI collectors reuse the same provider and store code. The pilot database is separate from model lookup; the model tool requests live data and does not silently fall back to stale pilot values.

Run both collector and model-dispatch tests under Python 3.12+ with the existing server dependencies installed:

```sh
python -m unittest discover -s tests -p 'test_home_depot*.py'
```

Tests mock HTTP and model responses; they verify the conversation tool loop, product selection across turns, failure handling, credential redaction and request limits. They do not establish how reliably the live Qwen model selects these tools or measure current search-provider coverage.

## Command-line collection

`tools/collect_home_depot.py` iterates over supplied product Internet IDs and these nine stores using the [Unwrangle product endpoint](https://docs.unwrangle.com/homedepot-product-data-api/). It uses Python's standard library. This is a third-party scraping API, not an official Home Depot API.

Put one nine-digit Home Depot Internet ID per line in a text file, or generate it using the category discovery script below. These are the IDs at the end of product URLs, not store SKUs or UPCs. Blank lines, comments beginning with `#`, and duplicate IDs are handled. `pilot_product_ids.txt` contains one verified product for an initial nine-store check; it is not a catalog or proof of local availability.

Preview without credentials, network calls, or database writes:

```sh
python3 tools/collect_home_depot.py --products integrations/home_depot/pilot_product_ids.txt
```

Configure `UNWRANGLE_API_KEY` securely in your local environment, then run:

```sh
python3 tools/collect_home_depot.py --products integrations/home_depot/pilot_product_ids.txt --execute --max-requests 9
```

The cap defaults to nine HTTP attempts per invocation, enough for one product across all nine stores. API credits are not the same as HTTP requests: the provider currently documents 2.5 credits per successful detail request, or 2 on its Enterprise plan. Verify your plan before increasing the cap.

Results are committed after each successful response to `data/locations.sqlite3`. Rerunning skips completed pairs, including successful responses without an aisle location. Failures stop the run and leave that pair pending for the next run; there are no hidden retry requests. Use one collector process per database. For a fresh snapshot, pass a new `--database` path.

`locations` contains store number, Internet ID, store name, ZIP, product name, the provider's original aisle/bay string, status, and UTC retrieval time. `location_unavailable` means no aisle was returned; it does not mean out of stock or not carried. Responses must confirm the requested product and store before being saved. A timestamp records retrieval time, not when Home Depot last updated its shelf data.

## Discover product IDs

`tools/discover_home_depot.py` uses the [Unwrangle category endpoint](https://docs.unwrangle.com/homedepot-category-api/) to traverse pages for the nine stores, deduplicate IDs, and export them to `data/product_ids.txt`. The 26 department links in `category_urls.txt` are starting points. Building Materials, Electrical, and Kitchen links were obtained from Home Depot navigation, but their pages returned HTTP 403 during the initial browser check. Category API compatibility still needs live validation.

```sh
python3 tools/discover_home_depot.py
python3 tools/discover_home_depot.py --execute --max-requests 9
python3 tools/collect_home_depot.py --products integrations/home_depot/data/product_ids.txt --execute --max-requests 9
```

Discovery also defaults to a preview and requires `UNWRANGLE_API_KEY` for execution. Its request budget is separate from the aisle collector's budget. It saves each successful category page and product IDs together in `data/catalog.sqlite3`; rerun the same command to resume. The first nine discovery calls fetch page 1 of the first category at all nine stores. Later runs visit other categories before deeper pages. Use one process per database. A fresh discovery snapshot requires new database and output paths.

The provider limits each category to 45 pages. The script reports categories whose counts indicate incomplete coverage; add narrower category or filter URLs with `--categories` to address those gaps. It does not automatically subdivide categories or enumerate every variant. A fully paginated category is not a guarantee that every catalog product was found. Store context does not imply every returned item is physically stocked there, so the aisle collector retains missing locations separately from stock status.

Live retrieval requires an API key. The October 25, 2026 pilot made nine requests for Internet ID `312504067`: five returned populated aisle/bay values, one returned null, and three returned HTTP 404. Results are saved locally in `data/pilot_results.json` and successful lookups in `data/locations.sqlite3`. HTTP errors do not establish whether the item is stocked. The key was supplied only to the running processes and was not written to repository files. A complete-catalog crawl has not run.

Verified pilot values:

| Store | Aisle/bay result |
| --- | --- |
| Carmel Mtn #0669 | Aisle 33, Bay 006 |
| Imperial Beach #0671 | HTTP 404 — no verified location |
| Sports Arena #0674 | Aisle 25, Bay EC2 |
| Genesee #0680 | Aisle BW, Bay 032 |
| Imperial Marketplace #1032 | HTTP 404 — no verified location |
| Otay Mesa #1034 | null |
| Fairmount Ave #6634 | Aisle 40, Bay 010 |
| Mira Mesa #6679 | Aisle 40, Bay 015 |
| Mission Valley #6910 | HTTP 404 — no verified location |

For product-name lookup, the [Unwrangle search endpoint](https://docs.unwrangle.com/homedepot-search-results-api/) accepts `platform=homedepot_search` and `search=<keywords>`, plus store number and ZIP. Its results contain `name` and `id`; the selected result's `id` becomes `item_id` for aisle lookup. Select the exact variant when keywords match multiple products. Live search followed by location lookup through `run_tool()` passed on October 25, 2026: product `312504067` at Carmel Mtn `0669` returned `Aisle 33, Bay 006`. Live model selection remains unverified. Keyword search is not exposed in the CLI.

Offline tests cover pagination, deduplication, resumption, request limits, response validation, and failure handling:

```sh
python3 -m unittest discover -s tests -p 'test_home_depot.py'
```
