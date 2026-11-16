"""Coordinates for every city in CPCB's daily AQI bulletin, from GeoNames (geonames.org, CC BY 4.0).

  python -I scripts/build_city_coordinates.py <path to GeoNames IN.zip or IN.txt>
  -> backend/config/cpcb_city_coordinates.json and backend/config/india_places.json

The GeoNames India dump (https://download.geonames.org/export/dump/IN.zip) is downloaded by hand into its own folder and
never committed; only the small results are. A bulletin city is plotted only with a confident match:
  * candidates are GeoNames populated places (feature class P) whose name, ASCII name or alternate name equals the
    bulletin name (case, spaces and hyphens ignored); a name with a state in brackets ("Aurangabad (Bihar)") keeps only
    candidates in that state;
  * confident when there is one candidate, or the most populous one has at least 5 times the population of the next,
    or it is a seat of government (PPLC/PPLA/PPLA2) while no other candidate is;
  * the six analysed cities use the project's own centres (mean of their primary stations).
Anything else is listed in the app but not plotted ("not on the map").
india_places.json holds Indian towns with at least 15,000 people, to suggest the nearest covered cities for a place
that is not in the bulletin.
"""
from __future__ import annotations

import io
import json
import re
import sys
import zipfile
from datetime import date
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "backend" / "config"
COLS = ["geonameid", "name", "asciiname", "alternatenames", "lat", "lon", "fclass", "fcode", "cc", "cc2", "admin1",
        "admin2", "admin3", "admin4", "population", "elevation", "dem", "tz", "modified"]
# a state named in brackets -> a city in that state, to read its GeoNames admin1 code from the data itself
STATE_ANCHOR = {"bihar": "Patna", "maharashtra": "Mumbai", "meghalaya": "Shillong", "assam": "Guwahati",
                "uttarpradesh": "Lucknow", "madhyapradesh": "Bhopal", "rajasthan": "Jaipur", "karnataka": "Bengaluru"}
SEAT = {"PPLC", "PPLA", "PPLA2"}
# the project's own city centres (mean of primary stations), kept identical to the Home and Explore maps
METRO_CENTRES = {"Delhi": (28.6139, 77.2090), "Mumbai": (19.0760, 72.8777), "Kolkata": (22.5726, 88.3639),
                 "Chennai": (13.0827, 80.2707), "Bengaluru": (12.9716, 77.5946), "Hyderabad": (17.3850, 78.4867)}


def key(s: str) -> str:
    return re.sub(r"[^a-z]", "", str(s).lower())


def read_geonames(path: Path) -> pd.DataFrame:
    if path.suffix == ".zip":
        with zipfile.ZipFile(path) as z:
            raw = z.read("IN.txt")
        src = io.BytesIO(raw)
    else:
        src = path
    g = pd.read_csv(src, sep="\t", header=None, names=COLS, dtype=str, keep_default_na=False, quoting=3)
    g = g[g["fclass"] == "P"].copy()
    g["population"] = pd.to_numeric(g["population"], errors="coerce").fillna(0).astype(int)
    g["lat"], g["lon"] = g["lat"].astype(float), g["lon"].astype(float)
    return g


def metro_centres() -> dict[str, tuple[float, float]]:
    """Mean of each analysed city's primary stations, when the station table is present."""
    p = ROOT / "data" / "app" / "stations.parquet"
    if not p.exists():
        return METRO_CENTRES
    st = pd.read_parquet(p)
    tier = st["tier"] if "tier" in st else pd.Series("primary", index=st.index)
    st = st[tier == "primary"]
    out = dict(METRO_CENTRES)
    for c, g in st.groupby("city"):
        if c in out:
            out[c] = (round(float(g["lat"].mean()), 4), round(float(g["lon"].mean()), 4))
    return out


def main() -> None:
    src = Path(sys.argv[1])
    g = read_geonames(src)
    index: dict[str, set[int]] = {}
    for i, n, a, alt in zip(g.index, g["name"], g["asciiname"], g["alternatenames"]):
        for x in {n, a, *alt.split(",")}:
            k = key(x)
            if k:
                index.setdefault(k, set()).add(i)
    t = pd.read_parquet(ROOT / "data" / "app" / "city_aqi_all.parquet", columns=["city"])
    cities = sorted(t["city"].astype(str).unique())
    centres = metro_centres()
    out, unplotted = {}, []
    for c in cities:
        if c in centres:
            lat, lon = centres[c]
            out[c] = {"lat": lat, "lon": lon, "plotted": True, "match": "project city centre"}
            continue
        m = re.fullmatch(r"(.+?)\s*\((.+)\)", c)
        base, state = (m.group(1), m.group(2)) if m else (c, None)
        cand = g.loc[sorted(index.get(key(base), set()))]
        if state:
            anchor = STATE_ANCHOR.get(key(state))
            codes = set(g.loc[sorted(index.get(key(anchor), set())), "admin1"]) if anchor else set()
            cand = cand[cand["admin1"].isin(codes)] if codes else cand.iloc[0:0]
        cand = cand.sort_values("population", ascending=False)
        pick, why = None, ""
        if len(cand) == 1:
            pick, why = cand.iloc[0], "only match"
        elif len(cand) > 1:
            a, b = cand.iloc[0], cand.iloc[1]
            seats = cand[cand["fcode"].isin(SEAT)]
            if a["population"] > 0 and a["population"] >= 5 * max(b["population"], 1):
                pick, why = a, "most populous by 5x"
            elif len(seats) == 1:
                pick, why = seats.iloc[0], "only seat of government"
        if pick is None:
            out[c] = {"lat": None, "lon": None, "plotted": False,
                      "match": "no match" if cand.empty else f"{len(cand)} places share this name"}
            unplotted.append(c)
        else:
            out[c] = {"lat": round(float(pick["lat"]), 4), "lon": round(float(pick["lon"]), 4), "plotted": True,
                      "match": why, "geonameid": int(pick["geonameid"])}
    doc = {"_note": "Bulletin city coordinates from GeoNames (geonames.org), CC BY 4.0. Built by "
                    "scripts/build_city_coordinates.py; only confident matches are plotted.",
           "source": "GeoNames (geonames.org), CC BY 4.0", "built": str(date.today()),
           "n_cities": len(cities), "n_plotted": len(cities) - len(unplotted), "not_plotted": unplotted,
           "cities": out}
    (CONFIG / "cpcb_city_coordinates.json").write_text(json.dumps(doc, indent=1, ensure_ascii=False), encoding="utf-8")
    towns = g[g["population"] >= 15000].sort_values("population", ascending=False).drop_duplicates("asciiname")
    pl = [{"name": n, "lat": round(la, 3), "lon": round(lo, 3)} for n, la, lo in zip(towns["asciiname"], towns["lat"],
                                                                                      towns["lon"])]
    (CONFIG / "india_places.json").write_text(json.dumps(
        {"_note": "Indian towns with at least 15,000 people, from GeoNames (geonames.org), CC BY 4.0. Used only to "
                  "suggest the nearest covered cities for a place that is not in CPCB's bulletin.",
         "places": pl}, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    print(f"{len(cities)} bulletin cities, {len(cities) - len(unplotted)} plotted, {len(unplotted)} not plotted: "
          f"{', '.join(unplotted)}")
    print(f"{len(pl)} towns in india_places.json")


if __name__ == "__main__":
    main()
