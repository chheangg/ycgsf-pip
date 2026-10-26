# Walmart aisle tool

`get_walmart_location(store_no, item_id)` returns a store-specific Walmart US aisle through SerpApi.

- **Setup:** set `SERPAPI_API_KEY` in the server environment.
- **Inputs:** numeric store and item IDs as strings, supplied by the user or previously verified. No search or store discovery.
- **Output:** store/item IDs and names, `aisle`, and `status`. Missing aisle: `location_unavailable`; failed or mismatched response: `error`.
- **Limits:** one request per turn, no retries, 10-second HTTP timeout. Provider cache may be up to one hour old.
- **Meaning:** a shelf label; no stock guarantee or navigation.

Example: `get_walmart_location("2479", "10450114")` returned `A21` in the live smoke test.

Code: [provider](../../../server/walmart.py), [tool registration and dispatch](../../../server/app.py).
