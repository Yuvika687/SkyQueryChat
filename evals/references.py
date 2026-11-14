"""Independent reference values for the evaluation.

Computed with plain pandas straight from data/app/*.parquet — NOT through backend.analysis — so
that an agent answer is checked against a second implementation. Each reference returns
{"numbers": [...]} (all must appear), {"any_of": [[...], [...]]} (one group must all appear),
{"text": [...]} (substrings), and optional "tol" (absolute tolerance for numbers).
"""
from __future__ import annotations

import json
import os
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

# Frozen copy of the app tables (evals/data/), so scores stay reproducible while data/app refreshes daily.
# SKYQ_EVAL_DATA may point at another copy (for example data/app) for a clearly labelled one-off check.
APP = Path(os.environ.get("SKYQ_EVAL_DATA") or Path(__file__).resolve().parent / "data")
EVENTS = json.loads((Path(__file__).resolve().parents[1] / "backend" / "config" / "events.json").read_text())
CITIES = ["Delhi", "Mumbai", "Kolkata", "Chennai", "Bengaluru", "Hyderabad"]


def _load():
    cd = pd.read_parquet(APP / "city_daily.parquet")
    cd["local_date"] = pd.to_datetime(cd["local_date"]).dt.date
    aqi = pd.read_parquet(APP / "city_daily_aqi.parquet")
    aqi["bulletin_date"] = pd.to_datetime(aqi["bulletin_date"]).dt.date
    w = pd.read_parquet(APP / "weather_daily.parquet")
    w["local_date"] = pd.to_datetime(w["local_date"]).dt.date
    return cd, aqi, w


CD, AQI, W = _load()
# "All data" questions use the measured data end recorded with the app tables (it moves when new data arrives).
DATA_END = date.fromisoformat(json.loads((APP / "manifest.json").read_text())["openaq_data_end"])


def _days(city, pol, a, b):
    x = CD[(CD.city == city) & (CD.pollutant == pol) & (CD.local_date >= a) & (CD.local_date <= b) & CD.meets_rule]
    return x


def mean(city, pol, a, b):
    return round(float(_days(city, pol, a, b).city_mean.mean()), 1)


def highest(city, pol, a, b):
    return round(float(_days(city, pol, a, b).city_mean.max()), 1)


def compare(cities, pol, a, b):
    frames = {c: _days(c, pol, a, b) for c in cities}
    common = set.intersection(*(set(f.local_date) for f in frames.values()))
    means = {c: round(float(f[f.local_date.isin(common)].city_mean.mean()), 1) for c, f in frames.items()}
    return dict(sorted(means.items(), key=lambda kv: -kv[1])), {c: len(f) for c, f in frames.items()}


def diwali(city, year):
    D = date.fromisoformat(EVENTS["diwali"][str(year)]["date"]) if isinstance(EVENTS["diwali"][str(year)], dict) \
        else date.fromisoformat(EVENTS["diwali"][str(year)])
    a = AQI[AQI.city == city].set_index("bulletin_date")["aqi"]
    fest = [float(a[D + timedelta(days=1)]), float(a[D + timedelta(days=2)])]
    level = round(sum(fest) / 2, 1)
    # baselines: evenings D+lo..D+hi -> bulletins D+lo+1..D+hi+1
    pcts = []
    for lo, hi in ((-14, -8), (-7, -1), (-3, -1)):
        base = float(np.mean([a[D + timedelta(days=k + 1)] for k in range(lo, hi + 1)]))
        pcts.append(round((level - base) / base * 100, 1))
    cat = AQI[(AQI.city == city) & (AQI.bulletin_date == D + timedelta(days=1))].aqi_category.iat[0]
    return {"level": level, "bulletins": fest, "pcts": pcts, "w2": pcts[1], "stable": max(pcts) - min(pcts) <= 25,
            "category_d1": cat}


def spearman(city, pol, var, a, b):
    x = _days(city, pol, a, b)
    x = x[x.severity != "severe"][["local_date", "city_mean"]]
    y = W[(W.city == city) & ~W.preliminary][["local_date", var]]
    j = x.merge(y, on="local_date")
    return round(float(np.corrcoef(j.city_mean.rank(), j[var].rank())[0, 1]), 2)


def rain_groups(city, pol, a, b):
    x = _days(city, pol, a, b)
    x = x[x.severity != "severe"][["local_date", "city_mean"]]
    j = x.merge(W[(W.city == city) & ~W.preliminary][["local_date", "precipitation_sum_mm"]], on="local_date")
    return round(float(j[j.precipitation_sum_mm < 1].city_mean.mean()), 1), round(float(j[j.precipitation_sum_mm >= 1].city_mean.mean()), 1)


def unusual_count(city, pol, a, b, half=7, thr=3.0):
    """Second implementation of the rolling-median rule (centred 15-day window, day excluded)."""
    x = _days(city, pol, a - timedelta(days=half), b + timedelta(days=half)).set_index("local_date")["city_mean"]
    idx = pd.date_range(min(x.index), max(x.index), freq="D").date
    s = x.reindex(idx)
    med = {}
    for t in idx:
        nb = [s[t + timedelta(days=k)] for k in range(-half, half + 1)
              if k != 0 and (t + timedelta(days=k)) in s.index and pd.notna(s[t + timedelta(days=k)])]
        med[t] = float(np.median(nb)) if len(nb) >= max(3, half) else np.nan
    res = pd.Series({t: s[t] - med[t] for t in idx if pd.notna(s[t]) and a <= t <= b}).dropna()
    scale = 1.4826 * float(np.median(np.abs(res)))
    return int((np.abs(res) > thr * scale).sum())


def references() -> dict:
    d = date
    nov = (d(2025, 11, 1), d(2025, 11, 30))
    winter = (d(2025, 12, 1), d(2026, 2, 28))
    monsoon = (d(2025, 6, 1), d(2025, 9, 30))
    w_rank, _ = compare(CITIES, "pm25", *winter)
    y_rank, _ = compare(CITIES, "pm25", d(2025, 1, 1), d(2025, 12, 31))
    jul_rank, _ = compare(CITIES, "pm25", d(2026, 7, 1), d(2026, 7, 31))
    dec_dm, _ = compare(["Delhi", "Mumbai"], "pm10", d(2025, 12, 1), d(2025, 12, 31))
    mk_dec, mk_valid = compare(["Mumbai", "Kolkata"], "pm25", d(2025, 12, 1), d(2025, 12, 31))
    dl25, dl24 = diwali("Delhi", 2025), diwali("Delhi", 2024)
    mb24, mb25 = diwali("Mumbai", 2024), diwali("Mumbai", 2025)
    hy25, hy24 = diwali("Hyderabad", 2025), diwali("Hyderabad", 2024)
    allp = (d(2025, 2, 18), DATA_END)
    dry, rain = rain_groups("Mumbai", "pm25", *allp)
    return {
        "delhi_pm25_2025_nov_dec": {"numbers": [mean("Delhi", "pm25", *nov), mean("Delhi", "pm25", d(2025, 12, 1), d(2025, 12, 31))]},
        "mumbai_pm10_nov2025": {"numbers": [mean("Mumbai", "pm10", *nov)]},
        "kolkata_pm25_winter2025": {"any_of": [[mean("Kolkata", "pm25", *winter)],
                                               [mean("Kolkata", "pm25", d(2025, 12, 1), d(2025, 12, 31))]]},
        "chennai_pm25_2026_max": {"numbers": [highest("Chennai", "pm25", d(2026, 1, 1), DATA_END)]},
        "delhi_pm25_monsoon2025": {"any_of": [[mean("Delhi", "pm25", *monsoon)],
                                              [mean("Delhi", "pm25", d(2025, 7, 1), d(2025, 7, 31))]]},
        "winter2025_top_city": {"text": [next(iter(w_rank))], "numbers": [next(iter(w_rank.values()))]},
        "pm25_2025_top_city": {"text": [next(iter(y_rank))]},
        "jul2026_cleanest": {"text": [list(jul_rank)[-1]]},
        "delhi_mumbai_pm10_dec2025": {"any_of": [[dec_dm["Delhi"]], [mean("Delhi", "pm10", d(2025, 12, 1), d(2025, 12, 31))]]},
        "mumbai_kolkata_valid_days_dec2025": {"numbers": [mk_valid["Mumbai"]]},
        "delhi_diwali2025_level": {"any_of": [[dl25["level"]], dl25["bulletins"]]},
        "mumbai_diwali_2024_2025": {"any_of": [[mb24["level"], mb25["level"]], mb24["bulletins"] + mb25["bulletins"]]},
        "delhi_diwali2025_pct": {"numbers": [min(dl25["pcts"]), max(dl25["pcts"])]} if not dl25["stable"]
        else {"numbers": [dl25["w2"]]},
        "delhi_diwali2024_pct": {"numbers": [dl24["w2"]]} if dl24["stable"]
        else {"numbers": [min(dl24["pcts"]), max(dl24["pcts"])]},
        "kolkata_diwali2024_category": {"text": [diwali("Kolkata", 2024)["category_d1"]]},
        "hyderabad_diwali2025": {"any_of": [[hy25["level"]], hy25["bulletins"][:1]]},
        "hyderabad_diwali2024": {"any_of": [[hy24["level"]], hy24["bulletins"][:1]]},
        "delhi_pm25_nov2025": {"numbers": [mean("Delhi", "pm25", *nov)]},
        "delhi_pm10_nov2025": {"numbers": [mean("Delhi", "pm10", *nov)]},
        "delhi_wind_rho": {"numbers": [spearman("Delhi", "pm25", "wind_speed_mean_kmh", *allp)], "tol": 0.006},
        "chennai_rain_rho": {"numbers": [spearman("Chennai", "pm25", "precipitation_sum_mm", *allp)], "tol": 0.006},
        "mumbai_rain_groups_pm25": {"numbers": [dry, rain]},
        "delhi_unusual_2025": {"numbers": [unusual_count("Delhi", "pm25", d(2025, 1, 1), d(2025, 12, 31))]},
        "mumbai_pm10_mar_jun2026": {"numbers": [mean("Mumbai", "pm10", d(2026, 3, 1), d(2026, 6, 30))]},
        **holdout2_refs(),
        **diwali2026_refs(),
        **analysis_refs(),
    }


def diwali2026_refs() -> dict:
    """Diwali 2026 set (evals/diwali2026.json) and main-set questions whose answer changed when the 9 and 10 Nov
    2026 bulletins arrived (M1, M4, groq G11). Empty when the 2026 festival bulletins are not in the data."""
    try:
        dl26, dl25 = diwali("Delhi", 2026), diwali("Delhi", 2025)
    except (KeyError, IndexError):
        return {}
    mb26, kk26, kk25, ch26 = diwali("Mumbai", 2026), diwali("Kolkata", 2026), diwali("Kolkata", 2025), diwali("Chennai", 2026)
    hy = [diwali("Hyderabad", y) for y in (2024, 2025, 2026)]
    bl26, bl25 = diwali("Bengaluru", 2026), diwali("Bengaluru", 2025)
    return {
        "delhi_diwali2026_level": {"any_of": [[dl26["level"]], dl26["bulletins"]]},
        "delhi_diwali_2025_2026": {"any_of": [[dl25["level"], dl26["level"]], dl25["bulletins"] + dl26["bulletins"]]},
        "mumbai_diwali2026_bulletins": {"any_of": [[mb26["level"]], mb26["bulletins"]]},
        "kolkata_diwali2026_pct": {"numbers": [kk26["w2"]]} if kk26["stable"]
        else {"numbers": [min(kk26["pcts"]), max(kk26["pcts"])]},
        "kolkata_diwali_2025_2026": {"any_of": [[kk25["level"], kk26["level"]], kk25["bulletins"] + kk26["bulletins"]]},
        "chennai_diwali2026_category": {"text": [ch26["category_d1"]]},
        "hyderabad_diwali_3yrs": {"any_of": [[h["level"] for h in hy], [b for h in hy for b in h["bulletins"]]]},
        "bengaluru_diwali2026_level": {"any_of": [[bl26["level"]], bl26["bulletins"]]},
        "bengaluru_diwali2025_level": {"any_of": [[bl25["level"]], bl25["bulletins"]]},
    }


def holdout2_refs() -> dict:
    """Fresh holdout (evals/holdout2.json, 2026-11-06). Written before any run; never used for tuning."""
    d = date
    dk, _ = compare(["Delhi", "Kolkata"], "pm10", d(2026, 3, 1), d(2026, 5, 31))
    ch, ch_valid = compare(["Chennai", "Hyderabad"], "pm25", d(2026, 3, 1), d(2026, 3, 31))
    ch24 = diwali("Chennai", 2024)
    more = max(ch_valid, key=ch_valid.get)
    return {
        "h2_hyd_pm25_postmonsoon2025": {"numbers": [mean("Hyderabad", "pm25", d(2025, 10, 1), d(2025, 11, 30))]},
        "h2_delhi_kolkata_pm10_summer2026": {"text": [next(iter(dk))],
                                             "any_of": [[dk[next(iter(dk))]],
                                                        [mean(next(iter(dk)), "pm10", d(2026, 3, 1), d(2026, 5, 31))]]},
        "h2_mumbai_pm25_feb2026_max": {"numbers": [highest("Mumbai", "pm25", d(2026, 2, 1), d(2026, 2, 28))]},
        "h2_chennai_diwali2024": {"any_of": [[ch24["level"]], ch24["bulletins"]]},
        "h2_mumbai_temp_pm10_rho": {"numbers": [spearman("Mumbai", "pm10", "temperature_mean_c", d(2025, 2, 18), DATA_END)],
                                    "tol": 0.006},
        "h2_blr_pm10_aug_oct2025": {"numbers": [mean("Bengaluru", "pm10", d(2025, 8, 1), d(2025, 10, 31))]},
        "h2_chennai_hyd_pm25_mar2026": {"any_of": [[ch["Chennai"], ch["Hyderabad"]],
                                                   [mean("Chennai", "pm25", d(2026, 3, 1), d(2026, 3, 31)),
                                                    mean("Hyderabad", "pm25", d(2026, 3, 1), d(2026, 3, 31))]]},
        "h2_chennai_hyd_more_days_mar2026": {"text": [more], "numbers": [ch_valid[more]]},
    }


def trend_ref(city, pol, a, b):
    """Second implementation of the trend: scipy's Theil-Sen slope and Kendall's tau against time."""
    from scipy import stats as SS
    x = _days(city, pol, a, b).sort_values("local_date")
    t = np.array([(v - x.local_date.iat[0]).days for v in x.local_date], dtype=float)
    slope = SS.theilslopes(x.city_mean.to_numpy(), t).slope * 365.25 / 12
    p = SS.kendalltau(t, x.city_mean.to_numpy()).pvalue
    return {"n": len(x), "slope_per_month": round(float(slope), 1), "p": float(p)}


def wind_ends(city, pol, a, b):
    """Mean PM on the calmest and windiest quarter of matched days (pd.qcut quartiles)."""
    x = _days(city, pol, a, b)
    x = x[x.severity != "severe"][["local_date", "city_mean"]]
    j = x.merge(W[(W.city == city) & ~W.preliminary][["local_date", "wind_speed_mean_kmh"]], on="local_date")
    q = pd.qcut(j.wind_speed_mean_kmh, 4, labels=False, duplicates="drop")
    return round(float(j[q == 0].city_mean.mean()), 1), round(float(j[q == q.max()].city_mean.mean()), 1)


def analysis_refs() -> dict:
    """Analysis set (evals/analysis.json): comparisons with 95% ranges, trends, weather associations."""
    d = date
    winter = (d(2025, 12, 1), d(2026, 2, 28))
    w_rank, _ = compare(CITIES, "pm25", *winter)
    mar = compare(["Delhi", "Bengaluru"], "pm25", d(2026, 3, 1), d(2026, 3, 31))[0]
    ch = trend_ref("Chennai", "pm25", d(2026, 3, 1), d(2026, 4, 30))
    calm, windy = wind_ends("Delhi", "pm25", d(2025, 2, 18), DATA_END)
    dry, rain = rain_groups("Mumbai", "pm25", d(2025, 2, 18), DATA_END)
    return {
        "an_winter_top_two": {"numbers": [w_rank["Delhi"], w_rank["Kolkata"]]},
        "an_mar_delhi_bengaluru": {"numbers": [mar["Delhi"], mar["Bengaluru"]]},
        "an_chennai_trend": {"any_of": [[ch["slope_per_month"]], [abs(ch["slope_per_month"])]], "tol": 0.15,
                             "_p": ch["p"]},
        "an_delhi_wind": {"any_of": [[calm, windy], [spearman("Delhi", "pm25", "wind_speed_mean_kmh", d(2025, 2, 18), DATA_END)]]},
        "an_mumbai_rain": {"any_of": [[dry, rain], [spearman("Mumbai", "pm25", "precipitation_sum_mm", d(2025, 2, 18), DATA_END)]]},
    }


def check(ref: dict, numbers: list[float], text: str) -> bool:
    tol = ref.get("tol", 0.051)

    def has(v):
        return any(abs(n - v) <= tol or (float(v).is_integer() and n == v) or round(v) == n and abs(n - v) < 0.5
                   for n in numbers)
    ok = all(has(v) for v in ref.get("numbers", []))
    if "any_of" in ref:
        ok = ok and any(all(has(v) for v in grp) for grp in ref["any_of"])
    low = text.lower()
    return ok and all(t.lower() in low for t in ref.get("text", []))


if __name__ == "__main__":
    print(json.dumps(references(), indent=1, default=str))
