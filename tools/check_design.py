#!/usr/bin/env python3
"""Check that Pip's screen (frontend/index.html + frontend/app.js + frontend/ui.js) follows the pen.dev design.

The design lives in design/untitled.pen (open it in pen.dev). Its colors, font and button labels are copied into
design/tokens.json; this script compares the code against that file.

Run:  python3 tools/check_design.py      (exit code 0 = matches, 1 = something differs)
"""
import json
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
tokens = json.loads((root / "design/tokens.json").read_text())
html = (root / "frontend/index.html").read_text()
js = (root / "frontend/app.js").read_text() + "\n" + (root / "frontend/ui.js").read_text()
code = (html + "\n" + js).lower()

problems = []

# 1. Colors: every design color must be a CSS variable with the same value, e.g. --accent: #FF5CA8
css_vars = {k.lower(): v.lower() for k, v in re.findall(r"--([a-z-]+)\s*:\s*(#[0-9a-fA-F]{3,8})", html)}
for name, value in tokens["colors"].items():
    have = css_vars.get(name)
    if have != value.lower():
        problems.append(f"color --{name}: design {value}, code {have or 'missing'}")

# 2. Font
if tokens["font"].lower() not in html.lower():
    problems.append(f"font: design uses {tokens['font']}, index.html never mentions it")

# 3. Labels on each screen (case doesn't matter: the code may uppercase with CSS)
for screen, s in tokens["screens"].items():
    missing = [l for l in s["labels"] if l.lower() not in code]
    if missing:
        problems.append(f"{screen}: labels not in code: {', '.join(missing)}")

# 4. Shaders: the app must run the design's own GLSL (frontend/shaders.js is generated from design/shaders)
sys.path.insert(0, str(root / "tools"))
from export_shaders import build as build_shaders
shaders_js = root / "frontend/shaders.js"
if not shaders_js.exists() or shaders_js.read_text() != build_shaders():
    problems.append("shaders: frontend/shaders.js differs from design/shaders (run python3 tools/export_shaders.py)")

if problems:
    print(f"Design check: {len(problems)} difference(s) from design/tokens.json")
    for p in problems:
        print("  -", p)
    sys.exit(1)
print("Design check: code matches the design tokens and labels")
