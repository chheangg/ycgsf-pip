# External tooling docs

Documentation maintained by the people who build the tools Pip uses. Each entry links upstream and identifies the relevant part of this repo.

## Development and deployment

| Tool | Upstream documentation | Use in Pip |
| --- | --- | --- |
| pen.dev / Pencil | [Documentation](https://docs.pencil.dev/) | Design source in `design/untitled.pen`; workflow in [CLAUDE.md](../../../CLAUDE.md#design-contract-with-pendev). |
| XcodeGen | [README and usage](https://github.com/yonaskolb/XcodeGen) | Generates the iOS project from [ios/project.yml](../../../ios/project.yml). |
| Tailscale | [Documentation](https://tailscale.com/docs) | Connects the phone and development machines to the GPU server; [deployment script](../../../tools/deploy.sh). |

The repo also uses **graphify** for its code graph. [Local instructions](../../../CLAUDE.md#graphify) exist, but the repo does not identify its upstream package or documentation URL. Confirm the installed implementation before adding an external link.

## Server and model tooling

| Tool | Upstream documentation | Use in Pip |
| --- | --- | --- |
| llama.cpp | [llama-server reference](https://github.com/ggml-org/llama.cpp/tree/master/tools/server) | Runs the Qwen brain and vision servers; commands in [server setup](../../../README.md#model-server). |
| FastAPI | [Documentation](https://fastapi.tiangolo.com/) | HTTP endpoints in [server/app.py](../../../server/app.py). |
| Transformers | [Documentation](https://huggingface.co/docs/transformers/index) | Loads speech recognition, depth estimation, and object-finding models in `server/app.py`. |
| Ultralytics | [Documentation](https://docs.ultralytics.com/) | Runs YOLO object detection in `server/app.py`. |
| kokoro-onnx | [README and examples](https://github.com/thewh1teagle/kokoro-onnx) | Speech synthesis in `server/app.py`. |
| Apple ARKit | [Documentation](https://developer.apple.com/documentation/arkit) | Native tracking and scene sensing in [ARSense.swift](../../../ios/Pip/ARSense.swift). |

Model-specific sources and licenses are listed in the [main README's model table](../../../README.md#models). Python dependencies are listed in [server/requirements.txt](../../../server/requirements.txt).

## External API tools

| Provider | Upstream documentation | Use in Pip |
| --- | --- | --- |
| Unwrangle: Home Depot product lookup | [Product API](https://docs.unwrangle.com/homedepot-product-data-api/) | Product and aisle/bay lookup in [server/home_depot.py](../../../server/home_depot.py). |
| Unwrangle: Home Depot search | [Search API](https://docs.unwrangle.com/homedepot-search-results-api/) | Keyword search for the `home_depot` model tool. |
| Unwrangle: Home Depot categories | [Category API](https://docs.unwrangle.com/homedepot-category-api/) | Product ID discovery in [discover_home_depot.py](../../../tools/discover_home_depot.py). |
| SerpApi: Walmart | [Walmart Product API](https://serpapi.com/walmart-product-api) | Provider used by `get_walmart_location`, implemented in [server/walmart.py](../../../server/walmart.py). |
| Nominatim | [Search API](https://nominatim.org/release-docs/latest/api/Search/) | OpenStreetMap place search in `server/app.py`. |

Unwrangle and SerpApi are third-party providers, not retailer-owned APIs. See the [Home Depot tool](homedepot.md) for setup, inputs, outputs, and limits.

## Maintaining this index

Add links to the tool author's documentation alongside the file or workflow that uses it. Keep Pip-specific setup in the existing project guides and link to it here. This is a curated starting point, not a complete dependency inventory; sponsor resources and credits remain in [hackathon links](../links.md).

External links reviewed October 25, 2026. Apple serves its documentation through a JavaScript viewer. Upstream docs can describe newer releases than those installed for Pip.
