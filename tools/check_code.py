#!/usr/bin/env python3
"""Check Pip's code (frontend, iPhone app, server, tools) for leftovers: unused functions, variables and icons,
debug prints, commented-out code.

It looks for names that appear only where they are defined, so it can miss a name that is reused for
something else. Generated files (frontend/shaders.js, graphify-out/) are skipped.

Run:  python3 tools/check_code.py      (exit code 0 = clean, 1 = something to clean up)
"""
import ast
import re
import sys
from pathlib import Path

root = Path(__file__).resolve().parent.parent
js_files = [root / "frontend" / f for f in ("app.js", "ui.js", "icons.js")]
html = (root / "frontend/index.html").read_text()
swift_files = sorted((root / "ios/Pip").glob("*.swift"))
js = {p: p.read_text() for p in js_files}
swift = {p: p.read_text() for p in swift_files}
all_js = "\n".join(js.values()) + "\n" + html
all_swift = "\n".join(swift.values())

problems = []


def uses(name: str, text: str) -> int:
    return len(re.findall(r"(?<![\w$-])" + re.escape(name) + r"(?![\w$-])", text))


# 1. JS functions and top-level variables that nothing uses (Swift counts too: it calls JS by name)
for p, src in js.items():
    for m in re.finditer(r"\bfunction\s+(\w+)|\b(?:const|let|var)\s+(\w+)\s*=", src):
        name = m.group(1) or m.group(2)
        if uses(name, all_js + all_swift) <= 1:
            problems.append(f"{p.relative_to(root)}: '{name}' is defined but never used")

# 2. Icons in icons.js that no screen shows
icons = re.findall(r'^  "([\w-]+)":', js[root / "frontend/icons.js"], re.M)
screens = js[root / "frontend/app.js"] + js[root / "frontend/ui.js"] + html
for name in icons:
    if uses(name, screens) == 0:
        problems.append(f"frontend/icons.js: icon '{name}' is never shown")

# 3. Swift private functions and properties that nothing uses
for p, src in swift.items():
    for m in re.finditer(r"\bprivate(?:\(set\))?\s+(?:static\s+)?(?:func|var|let)\s+(\w+)", src):
        if uses(m.group(1), all_swift) <= 1:
            problems.append(f"{p.relative_to(root)}: '{m.group(1)}' is defined but never used")

# 4. Python functions and top-level variables that nothing uses (decorated ones are server routes, called by URL)
py = {p: p.read_text() for p in [root / "server/app.py", *sorted((root / "tools").glob("*.py"))] if p.exists()}
all_py = "\n".join(py.values())
for p, src in py.items():
    for node in ast.parse(src).body:
        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)) and not node.decorator_list:
            names = [node.name]
        elif isinstance(node, ast.Assign):
            names = [t.id for t in node.targets if isinstance(t, ast.Name)]
        else:
            continue
        for name in names:
            if name != "__name__" and uses(name, all_py) <= 1:
                problems.append(f"{p.relative_to(root)}:{node.lineno}: '{name}' is defined but never used")

# 5. Debug leftovers and commented-out code
code_line = re.compile(r"^\s*//\s*(const|let|var|function|if|for|return|await|func)\b.*[;{)]\s*$")
for p, src in [*js.items(), *swift.items()]:
    for i, line in enumerate(src.splitlines(), 1):
        if re.search(r"\bconsole\.log\(|\bdebugger\b|^\s*print\(", line):
            problems.append(f"{p.relative_to(root)}:{i}: debug print left in")
        elif code_line.match(line):
            problems.append(f"{p.relative_to(root)}:{i}: commented-out code (delete it; git keeps the history)")

if problems:
    print(f"Code check: {len(problems)} thing(s) to clean up")
    for p in problems:
        print("  -", p)
    sys.exit(1)
print("Code check: clean")
