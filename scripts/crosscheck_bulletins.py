"""Cross-check our measured PM against official CPCB bulletin AQI, and reconcile Delhi Diwali 2025.

Our number is a PM-ONLY AQI ESTIMATE (CPCB sub-index breakpoints applied to our PM2.5/PM10). It is
NOT official AQI: CPCB uses up to 8 pollutants, its own station set and its own data feed.

Method (matches the bulletin's reporting period):
  * window: hours starting 16:00 IST on X-1 up to 16:00 IST on X (bulletin dated X)
  * default analysis rule (flat-line and unsupported spike hours excluded)
  * station: >= 16 valid hours per pollutant; station AQI = max(PM2.5, PM10 sub-index)
  * city: mean of station AQIs (>= 3 stations), primary stations only
Writes docs/crosscheck_bulletins.json. Run: python scripts/crosscheck_bulletins.py
"""
import json
import sys
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from backend.analysis.aqi import sub_index  # noqa: E402
from backend.pipeline import config as C, derive  # noqa: E402

SRC = derive.SRC_OPENAQ


def load():
    st = pd.read_parquet(ROOT / "data/processed/stations.parquet")
    h = pd.read_parquet(ROOT / "data/processed/station_hourly.parquet")
    h = h[h["source"] == SRC].copy()
    city_of = st[st["tier"] == "primary"].drop_duplicates("sensor_key")[["sensor_key", "city"]]
    h["supported"] = derive.supported_spikes(h, city_of)["supported"].astype(bool)
    h = h.merge(city_of, on="sensor_key", how="inner")          # primary only
    h["use"] = h["valid_hour"] & ~h["flag_flatline"] & ~(h["flag_spike"] & ~h["supported"])
    # bulletin date X covers hours starting [X-1 16:00, X 16:00)
    h["bulletin_date"] = (h["hour"] + pd.Timedelta(hours=8)).dt.date
    aqi = pd.read_parquet(ROOT / "data/app/city_daily_aqi.parquet")
    return h, aqi


def estimate(h: pd.DataFrame, how: str = "mean_of_station_aqi", min_hours: int = 16) -> pd.DataFrame:
    """PM-only AQI estimate per city and bulletin date from hourly rows (column `use` selects hours)."""
    x = h[h["use"]]
    sd = x.groupby(["city", "bulletin_date", "location_id", "pollutant"])["value"].agg(["mean", "size"])
    sd = sd[sd["size"] >= min_hours]["mean"].unstack("pollutant")
    for p in ("pm25", "pm10"):
        if p not in sd:
            sd[p] = np.nan
    if how == "aqi_of_city_mean":
        cm = sd.groupby(["city", "bulletin_date"]).agg(pm25=("pm25", "mean"), pm10=("pm10", "mean"),
                                                       n=("pm25", "size"))
        cm["est"] = [np.nanmax([sub_index("pm25", a), sub_index("pm10", b)]) for a, b in zip(cm.pm25, cm.pm10)]
        return cm[cm["n"] >= 3][["est", "n"]].reset_index()
    sd["station_aqi"] = [np.nanmax([sub_index("pm25", a), sub_index("pm10", b)])
                         if not (np.isnan(a) and np.isnan(b)) else np.nan for a, b in zip(sd.pm25, sd.pm10)]
    c = sd.dropna(subset=["station_aqi"]).groupby(["city", "bulletin_date"])["station_aqi"].agg(["mean", "size"])
    c = c[c["size"] >= 3].rename(columns={"mean": "est", "size": "n"})
    return c.reset_index()


def compare(est: pd.DataFrame, aqi: pd.DataFrame) -> dict:
    a = aqi[aqi["prominent_pollutant"].fillna("").str.contains("PM")]
    j = est.merge(a[["city", "bulletin_date", "aqi"]], on=["city", "bulletin_date"])
    out = {}
    for city, g in j.groupby("city"):
        d = g["est"] - g["aqi"]
        out[city] = {"days": int(len(g)), "correlation": round(float(np.corrcoef(g["est"], g["aqi"])[0, 1]), 3),
                     "mean_difference_ours_minus_official": round(float(d.mean()), 1),
                     "mean_absolute_difference": round(float(d.abs().mean()), 1),
                     "median_difference": round(float(d.median()), 1),
                     "within_20pct": round(float((d.abs() <= 0.2 * g["aqi"]).mean() * 100), 1),
                     "period": f"{g.bulletin_date.min()}..{g.bulletin_date.max()}"}
    return out


def delhi_diwali(h: pd.DataFrame, aqi: pd.DataFrame, bdate=date(2025, 10, 21)) -> dict:
    official = aqi[(aqi.city == "Delhi") & (aqi.bulletin_date == bdate)].iloc[0]
    d = h[h.city == "Delhi"]
    win = d[d.bulletin_date == bdate]
    one = lambda e: round(float(e.loc[e.city == "Delhi", "est"].iat[0]), 1) if (e.city == "Delhi").any() else None
    nst = lambda e: int(e.loc[e.city == "Delhi", "n"].iat[0]) if (e.city == "Delhi").any() else 0
    res = {"official": {"bulletin_date": str(bdate), "aqi": int(official.aqi), "stations": int(official.no_stations),
                        "period": f"{official.period_start_ist} -> {official.period_end_ist}"}}

    def add(name, rows, how="mean_of_station_aqi", note=""):
        e = estimate(rows, how)
        res[name] = {"estimate": one(e), "stations": nst(e), "note": note}

    add("A_default_4pm_window", win, note="16:00 -> 16:00 window, default rule, mean of station AQIs")
    cal = d[d.hour.dt.date == bdate - timedelta(days=1)].assign(bulletin_date=bdate)
    add("B_calendar_day_20_oct", cal, note="midnight-to-midnight 20 Oct instead of the bulletin window")
    add("C_drop_hours_over_999", win[win.value <= 999], note="as if the >999 hours were blank (OpenCity-style)")
    add("D_cap_hours_at_999", win.assign(value=win.value.clip(upper=999)), note="hourly values capped at 999")
    add("E_aqi_of_city_mean", win, how="aqi_of_city_mean", note="sub-index of the city-mean PM (not station mean)")
    upto = win[win.hour < pd.Timestamp(f"{bdate - timedelta(days=1)} 20:00", tz=C.IST)]
    pre = win[(win.hour < pd.Timestamp(f"{bdate - timedelta(days=1)} 20:00", tz=C.IST)) |
              (win.hour >= pd.Timestamp(f"{bdate} 06:00", tz=C.IST))]
    add("F_without_night_20h_to_06h", pre, note="night hours removed (what a feed missing the night would show)")

    # diagnostics
    x = win[win.use]
    per_hour = x.groupby("hour")["location_id"].nunique()
    sd = x.groupby(["location_id", "pollutant"])["value"].agg(["mean", "size"]).unstack("pollutant")
    pm25 = sd[("mean", "pm25")][sd[("size", "pm25")] >= 16]
    res["diagnostics"] = {
        "stations_reporting_per_hour_min_median_max": [int(per_hour.min()), int(per_hour.median()), int(per_hour.max())],
        "hours_in_window": int(per_hour.size),
        "valid_hours_total": int(len(x)), "hours_over_999": int((x.value > 999).sum()),
        "stations_with_pm25_24h_over_250 (sub-index > 400)": int((pm25 > 250).sum()),
        "stations_with_pm25_24h_over_380 (sub-index capped at 500)": int((pm25 > 380).sum()),
        "station_pm25_24h_median": round(float(pm25.median()), 1),
        "city_pm25_hourly_median_by_hour": {str(k.strftime('%d %H:00')): round(float(v), 0) for k, v in
                                            x[x.pollutant == "pm25"].groupby("hour")["value"].median().items()},
        "official_pm25_needed_for_351": "a station-mean PM2.5 sub-index of 351 corresponds to about 187 ug/m3",
    }
    return res


def main():
    h, aqi = load()
    est = estimate(h)
    out = {"what": "PM-only AQI estimate vs official CPCB bulletin AQI (NOT official AQI)",
           "by_city": compare(est, aqi), "delhi_diwali_2025": delhi_diwali(h, aqi)}
    (ROOT / "docs" / "crosscheck_bulletins.json").write_text(json.dumps(out, indent=1, default=str))
    print(json.dumps(out, indent=1, default=str))


if __name__ == "__main__":
    main()
