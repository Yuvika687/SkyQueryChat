"""City outlines for the Explore map from DataMeet's Census 2011 district map (CC BY 2.5 India):
https://github.com/datameet/maps/tree/master/Districts/Census_2011 . Reads the shapefile directly (no GIS library),
keeps the districts that make up each of the six cities, simplifies them and writes public/geo/city-outlines.geojson.

  python3 scripts/build-city-outlines.py <folder with 2011_Dist.shp and 2011_Dist.dbf>
"""
import json
import struct
import sys
from pathlib import Path

CITIES = {  # app city -> (state, districts) as named in the 2011 district map
    "Delhi": ("NCT of Delhi", None),                     # every district of the National Capital Territory
    "Mumbai": ("Maharashtra", {"Mumbai", "Mumbai Suburban"}),
    "Kolkata": ("West Bengal", {"Kolkata"}),
    "Chennai": ("Tamil Nadu", {"Chennai"}),
    "Bengaluru": ("Karnataka", {"Bangalore"}),
    "Hyderabad": ("Andhra Pradesh", {"Hyderabad"}),      # Telangana was part of Andhra Pradesh in 2011
}
TOL = 0.0008  # degrees (about 90 m)


def dbf_rows(path):
    b = Path(path).read_bytes()
    n, hlen, rlen = struct.unpack("<IHH", b[4:12])
    fields, off = [], 32
    while b[off] != 0x0D:
        name = b[off:off + 11].split(b"\0")[0].decode()
        fields.append((name, b[off + 16]))
        off += 32
    for i in range(n):
        rec, pos, row = b[hlen + i * rlen: hlen + (i + 1) * rlen], 1, {}
        for name, ln in fields:
            row[name] = rec[pos:pos + ln].decode("latin-1").strip()
            pos += ln
        yield row


def shp_polygons(path):
    b = Path(path).read_bytes()
    pos = 100
    while pos < len(b):
        _, clen = struct.unpack(">ii", b[pos:pos + 8])
        content = b[pos + 8: pos + 8 + clen * 2]
        pos += 8 + clen * 2
        if struct.unpack("<i", content[:4])[0] != 5:
            yield []
            continue
        nparts, npts = struct.unpack("<ii", content[36:44])
        parts = list(struct.unpack(f"<{nparts}i", content[44:44 + 4 * nparts])) + [npts]
        p0 = 44 + 4 * nparts
        pts = [struct.unpack("<dd", content[p0 + 16 * k: p0 + 16 * (k + 1)]) for k in range(npts)]
        yield [pts[parts[k]:parts[k + 1]] for k in range(nparts)]


def dp(pts, tol):
    if len(pts) < 3:
        return pts
    keep = [False] * len(pts); keep[0] = keep[-1] = True
    stack = [(0, len(pts) - 1)]
    while stack:
        a, c = stack.pop()
        (x1, y1), (x2, y2) = pts[a], pts[c]
        dx, dy = x2 - x1, y2 - y1; L = dx * dx + dy * dy or 1e-18
        best, idx = -1.0, None
        for i in range(a + 1, c):
            x, y = pts[i]
            t = max(0.0, min(1.0, ((x - x1) * dx + (y - y1) * dy) / L))
            d = (x1 + t * dx - x) ** 2 + (y1 + t * dy - y) ** 2
            if d > best:
                best, idx = d, i
        if idx is not None and best > tol * tol:
            keep[idx] = True; stack += [(a, idx), (idx, c)]
    return [p for p, k in zip(pts, keep) if k]


def main(folder):
    folder = Path(folder)
    rows = list(dbf_rows(folder / "2011_Dist.dbf"))
    feats = []
    for row, rings in zip(rows, shp_polygons(folder / "2011_Dist.shp")):
        for city, (state, names) in CITIES.items():
            if row["ST_NM"] == state and (names is None or row["DISTRICT"] in names):
                lines = [[[round(x, 5), round(y, 5)] for x, y in dp(r, TOL)] for r in rings if len(r) > 3]
                feats.append({"type": "Feature", "properties": {"city": city, "district": row["DISTRICT"]},
                              "geometry": {"type": "MultiLineString", "coordinates": lines}})
    found = {f["properties"]["city"] for f in feats}
    missing = set(CITIES) - found
    if missing:
        sys.exit(f"no districts found for {missing}")
    out = {"type": "FeatureCollection", "attribution": "Districts: DataMeet (Census of India 2011), CC BY 2.5 India",
           "features": feats}
    dest = Path(__file__).resolve().parents[1] / "public" / "geo" / "city-outlines.geojson"
    dest.write_text(json.dumps(out, separators=(",", ":")))
    for f in feats:
        print(f["properties"]["city"], "-", f["properties"]["district"], sum(len(l) for l in f["geometry"]["coordinates"]), "points")
    print(dest, dest.stat().st_size // 1024, "KB")


if __name__ == "__main__":
    main(sys.argv[1])
