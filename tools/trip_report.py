"""Draw one Pip trip: the floor map, where the phone went, doors, and what Pip was aiming for.
Writes trip.png (the picture) and timeline.txt (what happened, second by second) into the trip folder.
Usage: python3 tools/trip_report.py trips/<date-time>/"""
import json, sys, pathlib
from PIL import Image, ImageDraw

N, RES, SCALE = 300, 0.1, 4
trip = pathlib.Path(sys.argv[1])
events = [json.loads(l) for l in (trip / "trace.jsonl").read_text().splitlines() if l.strip()]
if not events:
    sys.exit(f"{trip}: empty")
t0 = events[0]["t"]
px = lambda x, z: ((x / RES + N / 2) * SCALE, (z / RES + N / 2) * SCALE)   # x right, z down (start facing up)

maps = sorted((trip / "maps").glob("*.bin"), key=lambda p: float(p.stem))
img = Image.new("RGB", (N * SCALE, N * SCALE), (90, 90, 90))
if maps:
    cells = maps[-1].read_bytes()
    small = Image.new("RGB", (N, N))
    small.putdata([{0: (90, 90, 90), 1: (245, 245, 245), 2: (20, 20, 20)}.get(c, (255, 0, 255)) for c in cells])
    img = small.resize((N * SCALE, N * SCALE), Image.NEAREST)
d = ImageDraw.Draw(img)

frames = [e["sensors"].get("frame") for e in events if "sensors" in e and e["sensors"].get("frame")]
last_frame = frames[-1] if frames else None
path, doors, targets, said = [], {}, [], []
for e in events:
    s = e.get("sensors")
    if s and s.get("pose") and (s.get("frame") == last_frame or not last_frame):
        path.append((s["pose"]["x"], s["pose"]["z"], s["pose"].get("tracking")))
        for dr in s.get("doors") or []:
            doors[dr["id"]] = dr
    p = e.get("pip")
    if p:
        tgt = (p.get("mission") or {}).get("target") or ((p.get("walk") or {}).get("target") or {}).get("ar")
        if isinstance(tgt, dict) and "x" in tgt:
            targets.append((tgt["x"], tgt["z"]))
    if "log" in e and " SAY " in e["log"] and path:
        said.append((path[-1][0], path[-1][1], e["log"].split(" SAY ", 1)[1]))

for dr in doors.values():
    x, y = px(dr["x"], dr["z"]); d.rectangle([x - 6, y - 6, x + 6, y + 6], outline=(0, 170, 0), width=3)
for x, z in set(targets):
    a, b = px(x, z); d.ellipse([a - 7, b - 7, a + 7, b + 7], outline=(255, 140, 0), width=3)
for (x1, z1, tr), (x2, z2, _) in zip(path, path[1:]):
    d.line([px(x1, z1), px(x2, z2)], fill=(30, 90, 255) if tr == "ok" else (220, 0, 0), width=3)
if path:
    a, b = px(*path[0][:2]); d.ellipse([a - 6, b - 6, a + 6, b + 6], fill=(0, 200, 0))
    a, b = px(*path[-1][:2]); d.ellipse([a - 6, b - 6, a + 6, b + 6], fill=(220, 0, 0))
for i, (x, z, _) in enumerate(said, 1):
    a, b = px(x, z); d.text((a + 5, b - 12), str(i), fill=(200, 0, 160))

xs = [p[0] for p in path] + [t[0] for t in targets] + [dr["x"] for dr in doors.values()]
zs = [p[1] for p in path] + [t[1] for t in targets] + [dr["z"] for dr in doors.values()]
if xs:
    (l, t), (r, b) = px(min(xs) - 3, min(zs) - 3), px(max(xs) + 3, max(zs) + 3)
    img = img.crop((int(l), int(t), int(r), int(b)))
img.save(trip / "trip.png")

# report.png: the map with a key, plus the camera photo from each moment Pip spoke (numbers match the map)
from PIL import ImageFont
def font(size):
    for f in ["/System/Library/Fonts/Supplemental/Arial.ttf", "/System/Library/Fonts/Helvetica.ttc"]:
        try: return ImageFont.truetype(f, size)
        except OSError: pass
    return ImageFont.load_default()
big, small = font(22), font(15)
photos = sorted((trip / "photos").glob("*.jpg"), key=lambda p: float(p.stem))
said_t = [(e["t"], e["log"].split(" SAY ", 1)[1]) for e in events if "log" in e and " SAY " in e["log"]]
m = img.copy(); m.thumbnail((700, 700))
TW, TH, COLS = 200, 267, 4
rows = (len(said_t) + COLS - 1) // COLS if photos else 0
W = max(m.width + 380, COLS * (TW + 10) + 10)
H = max(m.height, 330) + 40 + rows * (TH + 70)
rep = Image.new("RGB", (W, H), "white"); d2 = ImageDraw.Draw(rep)
rep.paste(m, (10, 10))
key = [((30, 90, 255), "your path (red where tracking was lost)"), ((0, 200, 0), "start"), ((220, 0, 0), "end"),
       ((0, 170, 0), "doors Pip found (squares)"), ((255, 140, 0), "where Pip was aiming (circles)"),
       ((200, 0, 160), "numbers: what Pip said (photos below)"), ((20, 20, 20), "black: blocked on Pip's map"),
       ((200, 200, 200), "white: open floor; gray: not seen")]
x0 = m.width + 30
d2.text((x0, 10), trip.name, fill="black", font=big)
for i, (c, txt) in enumerate(key):
    y = 50 + i * 30; d2.rectangle([x0, y, x0 + 18, y + 18], fill=c, outline="black"); d2.text((x0 + 28, y), txt, fill="black", font=small)
y0 = max(m.height, 330) + 30
for i, (t, txt) in enumerate(said_t):
    ph = min(photos, key=lambda p: abs(float(p.stem) - t)) if photos else None
    x, y = 10 + (i % COLS) * (TW + 10), y0 + (i // COLS) * (TH + 70)
    if ph: rep.paste(Image.open(ph).resize((TW, TH)), (x, y))
    import textwrap
    lines = textwrap.wrap(f"{i + 1}. ({t - t0:.0f}s) {txt}", 24)
    for k, line in enumerate(lines[:3]):
        d2.text((x, y + TH + 4 + k * 18), line + ("…" if k == 2 and len(lines) > 3 else ""), fill="black", font=small)
rep.save(trip / "report.png")

with open(trip / "timeline.txt", "w") as f:
    f.write("blue line = phone's path (red = tracking lost), green dot = start, red dot = end, green squares = doors,\n"
            "orange circles = where Pip was aiming, pink numbers = what Pip said (listed below)\n\n")
    for i, (_, _, txt) in enumerate(said, 1):
        f.write(f"{i}. {txt}\n")
    f.write("\n")
    last, s = -9, {}
    for e in events:
        t = e["t"] - t0
        if "sensors" in e:
            s = e["sensors"]
        elif "log" in e:
            f.write(f"{t:7.1f}s  {e['log']}\n")
        elif "pip" in e and t - last >= 2:
            last = t
            p = e["pip"]
            pose, dep = s.get("pose") or {}, s.get("depth") or {}
            f.write(f"{t:7.1f}s    [{p.get('mode')}] pos ({pose.get('x', 0):.1f}, {pose.get('z', 0):.1f}) heading {s.get('heading', 0):.0f} "
                    f"compass {s.get('compass', -1):.0f} tracking {pose.get('tracking')} ahead {dep.get('ahead', 0):.1f}m "
                    f"cue {json.dumps(p.get('cue'))} {json.dumps(p.get('mission') or p.get('walk') or p.get('timed') or {})[:300]}\n")
print(f"{trip}: {len(path)} poses, {len(doors)} doors, {len(said)} lines spoken -> report.png, trip.png, timeline.txt")
