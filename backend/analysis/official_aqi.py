"""Official AQI for every city in CPCB's daily 4 PM bulletin (the city_aqi_all table).

The six analysed cities keep their full station-level PM analysis; for every other bulletin city the app has CPCB's
official AQI only. Python calculates every number here (latest value, change from the previous bulletin, period mean,
Mann-Kendall trend with Sen's slope); nothing is estimated or filled in.

City names: every bulletin city, common older or local names (Bangalore, Bombay, Gurgaon...) and close misspellings.
A place that is not in the bulletins is located with a small GeoNames list of Indian towns
(backend/config/india_places.json) so the nearest covered cities can be suggested.
"""
from __future__ import annotations

import difflib
import json
import math
import re
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import pandas as pd

from . import stats as ST
from .result import AnalysisResult, ChartSpec, r
from .store import Store

CONFIG = Path(__file__).resolve().parents[1] / "config"
METROS = ("Delhi", "Mumbai", "Kolkata", "Chennai", "Bengaluru", "Hyderabad")
SOURCE = "CPCB daily AQI bulletin (4 PM; via UrbanEmissions, then CPCB's own PDFs)"
DATA_TYPE = "official measured AQI (city average)"
UNITS = "index (0-500)"
DEFAULT_DAYS = 30
METRO_NOTE = ("Station-level PM2.5 and PM10 analysis covers only Delhi, Mumbai, Kolkata, Chennai, Bengaluru and "
              "Hyderabad; for this city the app has CPCB's official AQI only.")

# Older or local names people type -> the bulletin's name (used only when that name is in the bulletin).
OTHER_NAMES = {
    "bangalore": "Bengaluru", "bengalooru": "Bengaluru", "bombay": "Mumbai", "calcutta": "Kolkata", "madras": "Chennai",
    "gurgaon": "Gurugram", "poona": "Pune", "newdelhi": "Delhi", "delhincr": "Delhi", "baroda": "Vadodara",
    "banaras": "Varanasi", "benares": "Varanasi", "kashi": "Varanasi", "allahabad": "Prayagraj", "vizag": "Visakhapatnam",
    "trivandrum": "Thiruvananthapuram", "cochin": "Kochi", "ernakulam": "Kochi", "mysore": "Mysuru",
    "pondicherry": "Puducherry", "pondy": "Puducherry", "calicut": "Kozhikode", "mangalore": "Mangaluru",
    "belgaum": "Belagavi", "hubli": "Hubballi", "gulbarga": "Kalaburagi", "cawnpore": "Kanpur", "secunderabad": "Hyderabad",
    "cuttack": "Cuttack", "navimumbai": "Navi Mumbai", "thane": "Thane", "tirunelveli": "Tirunelveli",
    "trichy": "Tiruchirappalli", "tiruchi": "Tiruchirappalli", "bhubneshwar": "Bhubaneswar", "gauhati": "Guwahati",
    "simla": "Shimla", "ooty": "Ooty", "bareli": "Bareilly", "noida": "Noida", "greaternoida": "Greater Noida",
}


def _key(s: str) -> str:
    return re.sub(r"[^a-z]", "", str(s).lower())


def _km(a: tuple[float, float], b: tuple[float, float]) -> float:
    la1, lo1, la2, lo2 = map(math.radians, (a[0], a[1], b[0], b[1]))
    h = math.sin((la2 - la1) / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin((lo2 - lo1) / 2) ** 2
    return 6371 * 2 * math.asin(math.sqrt(h))


@lru_cache(maxsize=1)
def coordinates() -> dict[str, dict]:
    """{bulletin city: {lat, lon, plotted, ...}} from GeoNames (scripts/build_city_coordinates.py)."""
    p = CONFIG / "cpcb_city_coordinates.json"
    return json.loads(p.read_text(encoding="utf-8"))["cities"] if p.exists() else {}


@lru_cache(maxsize=1)
def places() -> list[dict]:
    """Indian towns (GeoNames, population >= 15,000) to locate a place that is not in the bulletin."""
    p = CONFIG / "india_places.json"
    return json.loads(p.read_text(encoding="utf-8"))["places"] if p.exists() else []


class BulletinCities:
    def __init__(self, names: list[str]):
        self.names = sorted(set(names))
        self.by_key = {_key(c): c for c in self.names}
        for k, v in OTHER_NAMES.items():
            if v in self.names and k not in self.by_key:
                self.by_key[k] = v

    def resolve(self, text: str) -> dict:
        """{"city"} (with a "note" when the name was read differently) or {"city": None, "message", "nearest"}."""
        raw = (text or "").strip()
        k = _key(re.sub(r"\b(city|district|town|ncr)\b", "", raw, flags=re.I)) or _key(raw)
        if not k:
            return {"city": None, "message": "Please name a city.", "nearest": []}
        if k in self.by_key:
            c = self.by_key[k]
            out = {"city": c}
            if _key(raw) != _key(c):
                out["note"] = f"read '{raw}' as {c}"
            return out
        close = difflib.get_close_matches(k, list(self.by_key), n=1, cutoff=0.84)
        if close:
            c = self.by_key[close[0]]
            return {"city": c, "note": f"read '{raw}' as {c}"}
        nearest = self.nearest(raw)
        return {"city": None, "nearest": nearest,
                "message": f"{raw.strip().title()} isn't in CPCB's daily AQI bulletin."}

    def nearest(self, text: str, n: int = 3) -> list[str]:
        k = _key(text)
        here = next((p for p in places() if _key(p["name"]) == k), None)
        coords = coordinates()
        if here:
            pts = [(c, (v["lat"], v["lon"])) for c, v in coords.items() if v.get("plotted") and c in self.names]
            return [c for c, _ in sorted(pts, key=lambda x: _km((here["lat"], here["lon"]), x[1]))[:n]]
        # not a known town: only names that are close in spelling (never an unrelated city)
        return list(dict.fromkeys(self.by_key[x] for x in difflib.get_close_matches(k, list(self.by_key), n=n,
                                                                                     cutoff=0.75)))


def cities_of(table: pd.DataFrame) -> BulletinCities:
    return BulletinCities([str(c) for c in table["city"].unique()])


def bulletin_cities(store: Store) -> BulletinCities:
    if not hasattr(store, "bulletin_cities"):
        store.bulletin_cities = cities_of(store.tables["city_aqi_all"])
    return store.bulletin_cities


def _rows(store: Store, city: str) -> pd.DataFrame:
    t = store.tables["city_aqi_all"]
    g = t[t["city"] == city].copy()
    g["bulletin_date"] = pd.to_datetime(g["bulletin_date"]).dt.date
    return g.sort_values("bulletin_date").reset_index(drop=True)


def latest_date(store: Store, city: str) -> date:
    return _rows(store, city)["bulletin_date"].max()


def label(d) -> str:
    """'Official AQI (CPCB 4 PM bulletin, 16 Nov 2026)': how these values are labelled everywhere."""
    t = pd.Timestamp(d)
    return f"Official AQI (CPCB 4 PM bulletin, {t.day} {t:%b %Y})"


def _cat(x) -> str | None:
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else str(x)


def _pol(x) -> str | None:
    s = _cat(x)
    return s if s and s.lower() not in ("nan", "none", "") else None


def _int(x):
    try:
        return None if x is None or math.isnan(float(x)) else int(x)
    except (TypeError, ValueError):
        return None


def _latest(g: pd.DataFrame) -> dict:
    L = g.iloc[-1]
    return {"date": L["bulletin_date"].isoformat(), "aqi": int(L["aqi"]), "category": _cat(L["aqi_category"]),
            "main_pollutant": _pol(L["prominent_pollutant"]), "stations_reporting": _int(L["no_stations"])}


def official_aqi(store: Store, city: str, start: date | None = None, end: date | None = None) -> AnalysisResult:
    """Latest bulletin, change from the previous bulletin, and the period's mean, highest, lowest and trend.
    Default period: the 30 days up to the city's latest bulletin."""
    g = _rows(store, city)
    if g.empty:
        raise ValueError(f"No official AQI for {city} in the bulletin data.")
    last = g["bulletin_date"].max()
    if end is None or end > last:
        end = last
    if start is None:
        start = end - timedelta(days=DEFAULT_DAYS - 1)
    p = g[(g["bulletin_date"] >= start) & (g["bulletin_date"] <= end)]
    if p.empty:
        raise ValueError(f"No official AQI for {city} between {start} and {end}; its bulletins run "
                         f"{g['bulletin_date'].min()} to {last}.")
    latest = _latest(p)
    prev = p.iloc[-2] if len(p) > 1 else None
    previous = {"date": prev["bulletin_date"].isoformat(), "aqi": int(prev["aqi"])} if prev is not None else None
    change = latest["aqi"] - previous["aqi"] if previous else None
    hi, lo = p.loc[p["aqi"].idxmax()], p.loc[p["aqi"].idxmin()]
    tr = ST.trend(list(p["bulletin_date"]), [float(x) for x in p["aqi"]], start, end)
    if "slope_per_month" in tr:
        tr["slope_per_month"] = r(tr["slope_per_month"], 2)
        if "change_over_period" in tr:
            tr["change_over_period"] = r(tr["change_over_period"], 1)
        tr["p_value"] = r(tr["p_value"], 3) if tr["p_value"] >= 0.001 else "< 0.001"
    days = (end - start).days + 1
    summary = {"mean": r(float(p["aqi"].mean())), "n_bulletins": int(len(p)),
               "highest": {"date": hi["bulletin_date"].isoformat(), "aqi": int(hi["aqi"])},
               "lowest": {"date": lo["bulletin_date"].isoformat(), "aqi": int(lo["aqi"])}, "trend": tr}
    is_metro = city in METROS
    warns = [] if is_metro else [METRO_NOTE]
    if len(p) < days:
        warns.append(f"Bulletin values exist for {len(p)} of the {days} days in this period; missing days are left "
                     "as gaps, never filled in.")
    lab = label(latest["date"])
    series = [[d.isoformat(), int(v)] for d, v in zip(p["bulletin_date"], p["aqi"])]
    chart = ChartSpec(type="line", title=f"{city} official AQI (CPCB 4 PM bulletin)", x={"field": "date", "type": "time"},
                      y={"field": "aqi", "label": "Official AQI"}, series=[{"name": city, "data": series}],
                      units=UNITS, colour_scale="cpcb_aqi")
    return AnalysisResult(
        kind="official_aqi", title=f"Official AQI in {city}", metric="aqi", units=UNITS, data_type=DATA_TYPE,
        source=SOURCE, date_range={"start": str(start), "end": str(end)},
        stations={"count": latest["stations_reporting"], "tier": "all stations in CPCB city bulletin"},
        coverage={"days_in_period": days, "days_with_bulletin": int(len(p))}, quality={},
        method="CPCB's official city AQI from its daily 4 PM bulletin (average of the past 24 hours). Mean of the "
               "bulletin values in the period; trend: Mann-Kendall test with Sen's slope (direction only when "
               "p < 0.05; at least 20 days).",
        warnings=warns,
        values={"city": city, "is_metro": is_metro, "label": lab, "latest": latest, "previous": previous,
                "change_from_previous": change, "summary": summary},
        chart=chart)


def latest_all(store: Store) -> list[dict]:
    """Every bulletin city's latest official AQI with map coordinates (null when no confident match)."""
    t = store.tables["city_aqi_all"]
    t = t.assign(bulletin_date=pd.to_datetime(t["bulletin_date"]).dt.date)
    last = t.sort_values("bulletin_date").groupby("city", observed=True).tail(1)
    coords = coordinates()
    out = []
    for _, x in last.sort_values("city").iterrows():
        c = str(x["city"])
        co = coords.get(c) or {}
        plotted = bool(co.get("plotted"))
        out.append({"city": c, "date": x["bulletin_date"].isoformat(), "aqi": int(x["aqi"]),
                    "category": _cat(x["aqi_category"]), "main_pollutant": _pol(x["prominent_pollutant"]),
                    "stations_reporting": _int(x["no_stations"]), "is_metro": c in METROS,
                    "label": label(x["bulletin_date"]),
                    "lat": co.get("lat") if plotted else None, "lon": co.get("lon") if plotted else None,
                    "state": co.get("state")})
    return out


def city_series(store: Store, city: str, days: int = DEFAULT_DAYS) -> dict:
    """One city's last `days` days of official AQI (null on days without a bulletin value)."""
    g = _rows(store, city)
    last = g["bulletin_date"].max()
    start = last - timedelta(days=days - 1)
    p = g[g["bulletin_date"] >= start]
    by = {d: (int(a), _cat(c)) for d, a, c in zip(p["bulletin_date"], p["aqi"], p["aqi_category"])}
    series = []
    for i in range(days):
        d = start + timedelta(days=i)
        a, c = by.get(d, (None, None))
        series.append({"date": d.isoformat(), "aqi": a, "category": c})
    latest = _latest(g)
    prev = g.iloc[-2] if len(g) > 1 else None
    co = coordinates().get(city) or {}
    return {"city": city, "is_metro": city in METROS, "label": label(latest["date"]),
            "metro_note": None if city in METROS else METRO_NOTE, "source": SOURCE, "latest": latest,
            "change_from_previous": latest["aqi"] - int(prev["aqi"]) if prev is not None else None,
            "previous_date": prev["bulletin_date"].isoformat() if prev is not None else None,
            "n_days_with_value": sum(1 for s in series if s["aqi"] is not None), "series": series,
            "lat": co.get("lat") if co.get("plotted") else None, "lon": co.get("lon") if co.get("plotted") else None}


def diwali_tables(store: Store, city: str) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Diwali levels and baseline windows for ANY bulletin city, built from its bulletins exactly as the pipeline
    builds them for the six analysed cities (same festival days, bulletin alignment and windows). Cached per city."""
    cache = store.__dict__.setdefault("_diwali_cache", {})
    if city not in cache:
        from backend.pipeline.derive import diwali_aqi_table
        g = _rows(store, city)
        lv, bl = diwali_aqi_table(g)
        for t in (lv, bl):
            if "source" not in t:
                t["source"] = None
            t["source"] = t["source"].fillna(SOURCE)
        cache[city] = (lv, bl)
    return cache[city]
