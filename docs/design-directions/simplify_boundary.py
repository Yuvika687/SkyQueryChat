"""Simplify DataMeet's india-composite.geojson (official boundary of India as per the Survey of India, CC0) for the
mockup maps. Every island is kept; rings that would collapse keep their full outline.

  curl -L -o india-composite.geojson https://raw.githubusercontent.com/datameet/maps/master/Country/india-composite.geojson
  python simplify_boundary.py india-composite.geojson shared/india-official.geojson 0.01
"""
import json
import sys


def dp(pts, tol):
    """Douglas-Peucker line simplification (tolerance in degrees)."""
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts)
    keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, b = stack.pop()
        (x1, y1), (x2, y2) = pts[a][:2], pts[b][:2]
        dx, dy = x2 - x1, y2 - y1
        length = (dx * dx + dy * dy) or 1e-18
        best, idx = -1.0, None
        for i in range(a + 1, b):
            x, y = pts[i][:2]
            t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / length))
            d = (x1 + t * dx - x) ** 2 + (y1 + t * dy - y) ** 2
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol * tol:
            keep[idx] = True
            stack += [(a, idx), (idx, b)]
    return [p for p, k in zip(pts, keep) if k]


def main(src: str, out: str, tol: float) -> None:
    g = json.load(open(src))["features"][0]["geometry"]
    polys = g["coordinates"] if g["type"] == "MultiPolygon" else [g["coordinates"]]
    res = []
    for poly in polys:
        rings = []
        for ring in poly:
            s = dp(ring, tol)
            if len(s) < 4:                       # tiny island: keep its full outline
                s = ring
            rings.append([[round(x, 4), round(y, 4)] for x, y, *_ in s])
        res.append(rings)
    geo = {"type": "FeatureCollection", "features": [{"type": "Feature", "properties": {
        "name": "India",
        "source": "DataMeet india-composite.geojson (official boundary of India as per the Survey of India), CC0",
        "simplified": f"Douglas-Peucker {tol} degrees"}, "geometry": {"type": "MultiPolygon", "coordinates": res}}]}
    json.dump(geo, open(out, "w"), separators=(",", ":"))
    print(len(polys), "polygons kept;", sum(len(r) for p in res for r in p), "points")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], float(sys.argv[3]))
