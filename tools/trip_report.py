#!/usr/bin/env python3
"""Turn one trip recording into something readable: a timeline and pictures of the floor map.

A trip is the folder the phone records per app launch (see Trip in ios/Pip/PipWebView.swift):
trace.jsonl (sensors 5x/s, Pip's state 2x/s, every log line, every spoken line), photos/, maps/.
Get one with tools/pull_trip.sh.

Run:  python3 tools/trip_report.py trips/<trip>              timeline + pictures in trips/<trip>/report/
      python3 tools/trip_report.py trips/<trip> --at 312     every recorded line from 302 s to 322 s

Writes to <trip>/report/:
  timeline.txt  marks first, then what was heard, said, logged and decided, with the position every 2 s
  map.png       the last floor map, the whole walk (green), marks (red), doors (blue)
  mark-<n>.png  the floor map just before mark n, the walk up to it, the heading (purple), Pip's plan then (orange)
Map colors: gray unknown, white floor, black obstacle. Up is the way the phone faced when the app started.
"""
import argparse
import json
import math
import re
import struct
import zlib
from pathlib import Path

N = 300           # floor map: 300 x 300 cells (SlamMap.n)
RES = 0.1         # 10 cm per cell (SlamMap.res)
EVERY = 2.0       # seconds between position lines in the timeline
COLORS = {0: (128, 128, 128), 1: (255, 255, 255), 2: (0, 0, 0)}
GREEN, RED, BLUE, ORANGE, PURPLE = (0, 160, 0), (220, 0, 0), (0, 90, 230), (240, 140, 0), (150, 0, 200)


def load(trip: Path):
    events = []
    for n, line in enumerate((trip / "trace.jsonl").read_text(errors="replace").splitlines(), 1):
        try:
            events.append(json.loads(line))
        except ValueError:
            print(f"trace.jsonl line {n}: not JSON, skipped")
    return events


def cell(x: float, z: float):
    return round(x / RES) + N // 2, round(z / RES) + N // 2


def pose_of(e: dict):
    p = (e.get("sensors") or {}).get("pose")
    return (p["x"], p["z"]) if p else None


def marks_of(events: list):
    return [e for e in events if re.match(r"\S+ MARK\b", e.get("log", ""))]


def changed_state(prev: dict, now: dict) -> str:
    """The parts of Pip's state that changed, in a few words: mode, phase, which point, the cue, the hint."""
    def pick(s):
        out = {"mode": s.get("mode"), "cue": s.get("cue"), "hint": s.get("hint"), "paused": s.get("paused")}
        for k in ("mission", "walk", "find", "timed", "learning"):
            if s.get(k):
                sub = s[k]
                out.update({f"{k}.{f}": sub.get(f) for f in ("phase", "i", "on", "room", "name", "target", "move", "via")
                            if f in sub and not isinstance(sub.get(f), (dict, list))})
        return out
    a, b = pick(prev), pick(now)
    return ", ".join(f"{k}={b[k]}" for k in b if a.get(k) != b[k])


def timeline(events: list, t0: float) -> list:
    out, prev_state, last_pos = [], {}, -EVERY
    for e in events:
        t = e["t"] - t0
        stamp = f"{t:7.1f}s"
        if "log" in e:
            out.append(f"{stamp}  {'>>> ' if re.match(r'\S+ MARK', e['log']) else ''}{e['log']}")
        elif "voice" in e:
            v = e["voice"]
            out.append(f"{stamp}  SAID {v.get('text')!r} (waited {v.get('wait_ms')} ms{', failed' if not v.get('ok') else ''})")
        elif "pip" in e and e["pip"]:
            diff = changed_state(prev_state, e["pip"])
            if diff:
                out.append(f"{stamp}  PIP {diff}")
            prev_state = e["pip"]
        elif "sensors" in e and t - last_pos >= EVERY:
            s, last_pos = e["sensors"], t
            p, d, g = s.get("pose"), s.get("depth"), s.get("gps")
            bits = [f"heading {s.get('heading', 0):.0f}"]
            if p:
                bits.insert(0, f"at x {p['x']:.1f} z {p['z']:.1f}")
                bits.append(f"tracking {p.get('tracking')}")
            if d:
                bits.append(f"clear ahead {d.get('ahead', 0):.1f} m")
            if g:
                bits.append(f"gps ±{g.get('acc', 0):.0f} m")
            if "mapped_m2" in s:
                bits.append(f"mapped {s['mapped_m2']:.0f} m2")
            out.append(f"{stamp}  ·  " + ", ".join(bits))
    return out


def png(path: Path, rgb: list, w: int, h: int):
    rows = b"".join(b"\x00" + bytes(c for px in rgb[y * w:(y + 1) * w] for c in px) for y in range(h))
    chunk = lambda kind, data: struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    path.write_bytes(b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
                     + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b""))


def draw_map(path: Path, grid: bytes, walk: list, marks: list, doors: list, plan: list, heading):
    """grid: 300 x 300 bytes; walk, marks, doors, plan: (x, z) in meters. Cropped to what's known, scaled up."""
    pts = [cell(*p) for p in walk + marks + doors + plan]
    known = [(k % N, k // N) for k in range(N * N) if grid and grid[k]]
    xs, ys = [p[0] for p in known + pts], [p[1] for p in known + pts]
    if not xs:
        return
    x0, x1, y0, y1 = max(min(xs) - 10, 0), min(max(xs) + 10, N - 1), max(min(ys) - 10, 0), min(max(ys) + 10, N - 1)
    w, h = x1 - x0 + 1, y1 - y0 + 1
    k = max(2, min(8, 800 // max(w, h)))   # pixels per 10 cm cell
    img = [COLORS.get(grid[(y0 + j // k) * N + x0 + i // k], COLORS[0]) if grid else COLORS[0]
           for j in range(h * k) for i in range(w * k)]

    def dot(c, color, r):
        cx, cy = round((c[0] - x0) * k + k // 2), round((c[1] - y0) * k + k // 2)
        for j in range(cy - r, cy + r + 1):
            for i in range(cx - r, cx + r + 1):
                if 0 <= i < w * k and 0 <= j < h * k and (i - cx) ** 2 + (j - cy) ** 2 <= r * r:
                    img[j * w * k + i] = color

    def line(a, b, color, r):
        steps = max(round(max(abs(b[0] - a[0]), abs(b[1] - a[1])) * k), 1)   # one dot per pixel: a solid line
        for s in range(steps + 1):
            dot((a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps), color, r)

    cells = [cell(*p) for p in walk]
    for a, b in zip(cells, cells[1:]):
        line(a, b, GREEN, max(1, k // 3))
    planned = cells[-1:] + [cell(*p) for p in plan]   # from where they were, along Pip's plan
    for a, b in zip(planned, planned[1:]):
        line(a, b, ORANGE, max(1, k // 3))
    for p in doors:
        dot(cell(*p), BLUE, k)
    for p in marks:
        dot(cell(*p), RED, k + 2)
    if cells:
        dot(cells[-1], GREEN, k + 1)
        if heading is not None:   # heading: clockwise degrees from the start direction (up)
            h_rad = math.radians(heading)
            tip = (cells[-1][0] + 8 * math.sin(h_rad), cells[-1][1] - 8 * math.cos(h_rad))
            line(cells[-1], tip, PURPLE, max(1, k // 3))
    png(path, img, w * k, h * k)


def plan_of(state: dict) -> list:
    """Where Pip meant to go at that moment: the mission's floor-map path or the taught route's next point."""
    m, w = state.get("mission") or {}, state.get("walk") or {}
    path = [(p["x"], p["z"]) for p in m.get("path") or [] if isinstance(p, dict) and "x" in p]
    target = (w.get("target") or {}).get("ar")
    return path + ([(target["x"], target["z"])] if target else [])


def main():
    ap = argparse.ArgumentParser(description="Turn one trip recording into a timeline and floor map pictures.")
    ap.add_argument("trip", type=Path)
    ap.add_argument("--at", type=float, help="seconds since the trip started: print every line from 10 s before to 10 s after")
    args = ap.parse_args()
    events = load(args.trip)
    if not events:
        raise SystemExit(f"{args.trip}/trace.jsonl is empty")
    t0 = events[0]["t"]
    if args.at is not None:
        for e in events:
            if abs(e["t"] - t0 - args.at) <= 10:
                print(f"{e['t'] - t0:7.1f}s  {json.dumps({k: v for k, v in e.items() if k != 't'})}")
        return

    out = args.trip / "report"
    out.mkdir(exist_ok=True)
    marks = marks_of(events)
    maps = sorted((float(p.stem), p) for p in (args.trip / "maps").glob("*.bin"))
    photos = sorted((args.trip / "photos").glob("*.jpg"))
    walk = [(e["t"], pose_of(e)) for e in events if pose_of(e)]
    last = next((e["sensors"] for e in reversed(events) if "sensors" in e), {})
    doors = [(d["x"], d["z"]) for d in last.get("doors") or []]

    def pos_at(t):
        before = [p for tt, p in walk if tt <= t]
        return before[-1] if before else None

    head = [f"Trip {args.trip.name}: {events[-1]['t'] - t0:.0f} s, {len(events)} lines, "
            f"{len(photos)} photos, {len(maps)} floor maps, {len(marks)} marks", ""]
    if marks:
        head.append("MARKS (said \"mark that\" or \"that was wrong\"; the moment itself is ~1 s earlier, while they spoke):")
        for n, e in enumerate(marks, 1):
            near = min(photos, key=lambda p: abs(float(p.stem) - e["t"]), default=None)
            head.append(f"  {n}. {e['t'] - t0:.1f}s  {e['log']}   photo {near.name if near else '-'}   picture report/mark-{n}.png")
        head.append("")
    (out / "timeline.txt").write_text("\n".join(head + timeline(events, t0)) + "\n")

    grid = maps[-1][1].read_bytes() if maps else b""
    mark_pos = [p for p in (pos_at(e["t"]) for e in marks) if p]
    draw_map(out / "map.png", grid, [p for _, p in walk], mark_pos, doors, [], last.get("heading"))
    for n, e in enumerate(marks, 1):
        grid_then = next((p.read_bytes() for t, p in reversed(maps) if t <= e["t"]), grid)
        state = next((x["pip"] for x in reversed(events) if "pip" in x and x["t"] <= e["t"] and x["pip"]), {})
        sensors = next((x["sensors"] for x in reversed(events) if "sensors" in x and x["t"] <= e["t"]), {})
        draw_map(out / f"mark-{n}.png", grid_then, [p for t, p in walk if t <= e["t"]], [], doors, plan_of(state),
                 sensors.get("heading"))
    print("\n".join(head) + f"Wrote {out}/timeline.txt, map.png" + (f", mark-<n>.png for {len(marks)} mark(s)" if marks else ""))


if __name__ == "__main__":
    main()
