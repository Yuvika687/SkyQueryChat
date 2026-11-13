"""Builds docs/readme/banner.svg (README banner). Not app code.

India outline: frontend/public/geo/india-official.geojson (official boundary of India as per the Survey of India, via
DataMeet, CC0), heavily simplified (Douglas-Peucker). City dots: mean position of each city's primary stations and the
colour of its PM2.5 category on the latest available day, both read from data/app (real data, no numbers shown).
Run: .venv/bin/python docs/readme/make_banner.py
"""
import json
import math
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from backend.analysis import functions as F  # noqa: E402
from backend.analysis.store import Store  # noqa: E402

W, H = 1200, 320
COLOURS = {"Good": "#22C55E", "Satisfactory": "#A3E635", "Moderate": "#FACC15", "Poor": "#FB923C",
           "Very poor": "#EF4444", "Severe": "#B91C1C"}   # Severe shown brighter than the app's maroon so it reads on navy
BREAKS = [(30, "Good"), (60, "Satisfactory"), (90, "Moderate"), (120, "Poor"), (250, "Very poor")]
LON0, LAT0, LAT1 = 68.0, 6.6, 37.2
K = 268 / (LAT1 - LAT0)
COS = math.cos(math.radians(22))
X0, Y0 = 842, 26


def cat(v):
    return next((c for b, c in BREAKS if round(v) <= b), "Severe")


def proj(lon, lat):
    return X0 + (lon - LON0) * K * COS, Y0 + (LAT1 - lat) * K


def dp(pts, tol):
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    dx, dy = x2 - x1, y2 - y1
    norm = math.hypot(dx, dy) or 1e-9
    i, dmax = 0, 0.0
    for k in range(1, len(pts) - 1):
        d = abs(dy * pts[k][0] - dx * pts[k][1] + x2 * y1 - y2 * x1) / norm
        if d > dmax:
            i, dmax = k, d
    if dmax <= tol:
        return [pts[0], pts[-1]]
    return dp(pts[: i + 1], tol)[:-1] + dp(pts[i:], tol)


def outline() -> str:
    g = json.loads((ROOT / "frontend/public/geo/india-official.geojson").read_text())
    polys = g["features"][0]["geometry"]["coordinates"]
    out = []
    for poly in sorted(polys, key=lambda p: -len(p[0])):
        ring = poly[0]
        if len(ring) < 40:
            continue
        pts = [proj(x, y) for x, y in ring]
        # a closed ring starts and ends on the same point: split at the farthest point, simplify each half
        far = max(range(len(pts)), key=lambda k: math.hypot(pts[k][0] - pts[0][0], pts[k][1] - pts[0][1]))
        tol = 0.9 if len(ring) > 1000 else 0.6
        s = dp(pts[: far + 1], tol)[:-1] + dp(pts[far:], tol)
        if len(s) < 4:
            continue
        out.append("M" + "L".join(f"{x:.1f},{y:.1f}" for x, y in s) + "Z")
    return "".join(out)


def main():
    latest = F.latest_city_values(Store.from_dir(), "pm25")
    dots, labels = [], []
    left = {"Mumbai", "Bengaluru"}
    for i, c in enumerate(sorted(latest["cities"], key=lambda c: c["city"])):
        x, y = proj(c["lon"], c["lat"])
        col = COLOURS[cat(c["value"])]
        d = f"{i * 0.45:.2f}s"
        dots.append(f'<g><circle class="ring" cx="{x:.1f}" cy="{y:.1f}" r="5" fill="none" stroke="{col}" stroke-width="2" style="animation-delay:{d}"/>'
                    f'<circle class="halo" cx="{x:.1f}" cy="{y:.1f}" r="11" fill="{col}" style="animation-delay:{d}"/>'
                    f'<circle cx="{x:.1f}" cy="{y:.1f}" r="5" fill="{col}" stroke="#0A1222" stroke-width="2"/></g>')
        lx = x - 12 if c["city"] in left else x + 12
        labels.append(f'<text class="city" x="{lx:.1f}" y="{y + 4:.1f}" text-anchor="{"end" if c["city"] in left else "start"}">{c["city"]}</text>')
    day = latest["date"]
    y_, m_, d_ = day.split("-")
    nice = f"{int(d_)} {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'][int(m_) - 1]} {y_}"
    svg = f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}" role="img" aria-labelledby="t d">
<title id="t">SkyQueryChat</title>
<desc id="d">An AI air-quality analyst that shows the proof behind every number. India map with Delhi, Mumbai, Kolkata, Chennai, Bengaluru and Hyderabad coloured by their PM2.5 category on {nice}, the latest available day.</desc>
<defs>
<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B1428"/><stop offset="1" stop-color="#060A14"/></linearGradient>
<radialGradient id="glow" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#2DD4BF" stop-opacity="0.30"/><stop offset="0.55" stop-color="#2DD4BF" stop-opacity="0.08"/><stop offset="1" stop-color="#2DD4BF" stop-opacity="0"/></radialGradient>
<radialGradient id="glow2" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="#60A5FA" stop-opacity="0.16"/><stop offset="1" stop-color="#60A5FA" stop-opacity="0"/></radialGradient>
<linearGradient id="land" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#16264A"/><stop offset="1" stop-color="#0F1B36"/></linearGradient>
<clipPath id="panel"><rect width="{W}" height="{H}" rx="24"/></clipPath>
</defs>
<style>
.title{{font:400 66px Georgia,"Times New Roman",serif;fill:#F2F5FB;letter-spacing:-0.5px}}
.tag{{font:500 22px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;fill:#B8C3DA}}
.small{{font:400 14px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;fill:#7F8CA8}}
.city{{font:600 12px -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;fill:#DDE4F2}}
.ring{{transform-box:fill-box;transform-origin:center;animation:pulse 2.8s ease-out infinite;opacity:0}}
.halo{{opacity:.18;animation:breathe 2.8s ease-in-out infinite}}
.drift{{animation:drift 9s ease-in-out infinite alternate}}
@keyframes pulse{{0%{{transform:scale(1);opacity:.85}}100%{{transform:scale(3.4);opacity:0}}}}
@keyframes breathe{{0%,100%{{opacity:.12}}50%{{opacity:.32}}}}
@keyframes drift{{from{{transform:translate(0,0)}}to{{transform:translate(-26px,10px)}}}}
@media (prefers-reduced-motion:reduce){{.ring,.halo,.drift{{animation:none}}}}
</style>
<g clip-path="url(#panel)">
<rect width="{W}" height="{H}" fill="url(#bg)"/>
<g class="drift"><ellipse cx="975" cy="160" rx="300" ry="220" fill="url(#glow)"/></g>
<ellipse cx="160" cy="330" rx="420" ry="160" fill="url(#glow2)"/>
<path d="{outline()}" fill="url(#land)" stroke="#6F8BC4" stroke-width="1.3" stroke-linejoin="round" fill-rule="evenodd"/>
{"".join(dots)}
{"".join(labels)}
<circle cx="74" cy="92" r="9" fill="#2DD4BF"><animate attributeName="opacity" values="1;.55;1" dur="3s" repeatCount="indefinite"/></circle>
<text class="title" x="96" y="114">SkyQueryChat</text>
<text class="tag" x="68" y="168">An AI air-quality analyst that shows</text>
<text class="tag" x="68" y="200">the proof behind every number</text>
<text class="small" x="68" y="262">Delhi · Mumbai · Kolkata · Chennai · Bengaluru · Hyderabad</text>
<text class="small" x="68" y="286">Dots: PM2.5 category on {nice}, the latest available day</text>
</g>
<rect x="0.5" y="0.5" width="{W - 1}" height="{H - 1}" rx="23.5" fill="none" stroke="#2A3A62" stroke-opacity="0.9"/>
</svg>
'''
    out = ROOT / "docs/readme/banner.svg"
    out.write_text(svg)
    print(out, len(svg.encode()), "bytes")


if __name__ == "__main__":
    main()
