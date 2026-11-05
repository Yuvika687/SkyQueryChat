"""Derive compact, app-ready tables from data/processed (no downloads).

Adds, without deleting any stored data:
  * quality severity per city-date (none/minor/moderate/severe + network/local extent)
  * default analysis rule: hours flagged as flat-line or isolated spike are EXCLUDED from
    daily means (they stay in station_hourly); counts are kept with every row
  * station-day peer-outlier flag (review only)
  * Diwali AQI levels with candidate baselines; percentages marked pending approval
  * Delhi OpenCity PM supporting context with reconciled blank-rate definitions
Writes data/app/*.parquet (the only data the deployed app needs) + manifest.json with sizes.
"""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd

from . import config as C, transform as T
from .weather import ATTRIBUTION as WEATHER_ATTRIBUTION, UNITS as WEATHER_UNITS

SRC_OPENAQ = "OpenAQ archive (CPCB/AirNow/AirGradient)"
SRC_OPENCITY = "CPCB via OpenCity"
APP = C.ROOT / "data" / "app"

# ----------------------------------------------------------------------------- severity
SEVERITY_ORDER = ["none", "minor", "moderate", "severe"]


def classify_severity(gap_hours: int, longest_run_hours: int) -> str:
    """none: 0 gap hours; minor: 1-2 h and run < 6 h; moderate: 3-7 h or run 6-23 h;
    severe: >= 8 gap hours on the date or part of a run >= 24 h."""
    if gap_hours <= 0:
        return "none"
    if gap_hours >= 8 or longest_run_hours >= 24:
        return "severe"
    if gap_hours >= 3 or longest_run_hours >= 6:
        return "moderate"
    return "minor"


def _expand(runs: pd.DataFrame) -> pd.DatetimeIndex:
    hrs = [pd.date_range(s, e, freq="h", inclusive="left") for s, e in zip(runs["gap_start"], runs["gap_end"])]
    return pd.DatetimeIndex(np.concatenate(hrs)) if hrs else pd.DatetimeIndex([], tz=C.IST)


def severity_table(gaps: pd.DataFrame, dates: dict[str, list[date]], source: str,
                   network_scope: str | None = "all_cities") -> pd.DataFrame:
    """Per city and local date: gap hours (city-scope gaps UNION network-scope gaps), longest
    gap run touching the date, number of cities affected that date, severity and extent."""
    g = gaps[gaps["source"] == source]
    net = _expand(g[g["scope"] == network_scope]) if network_scope else pd.DatetimeIndex([], tz=C.IST)
    rows = []
    for city, ds in dates.items():
        hours = net.union(_expand(g[g["scope"] == city])).sort_values()
        s = pd.Series(1, index=hours)
        run_id = (s.index.to_series().diff() != pd.Timedelta(hours=1)).cumsum() if len(s) else s
        run_len = run_id.map(run_id.value_counts()) if len(s) else s
        by_date = pd.DataFrame({"local_date": hours.date, "run_len": run_len.values}) if len(s) else \
            pd.DataFrame(columns=["local_date", "run_len"])
        agg = by_date.groupby("local_date").agg(gap_hours=("run_len", "size"), longest_run_hours=("run_len", "max"))
        for d in ds:
            gh = int(agg["gap_hours"].get(d, 0))
            lr = int(agg["longest_run_hours"].get(d, 0))
            rows.append({"source": source, "city": city, "local_date": d, "gap_hours": gh,
                         "longest_run_hours": lr, "severity": classify_severity(gh, lr)})
    out = pd.DataFrame(rows)
    out["n_cities_affected"] = out.groupby("local_date")["gap_hours"].transform(lambda s: int((s > 0).sum()))
    out["extent"] = np.where(out["gap_hours"] == 0, "none",
                             np.where(out["n_cities_affected"] >= 4, "network", "local"))
    return out


# ----------------------------------------------------------------------------- flag rule
def daily_with_flag_rule(hourly: pd.DataFrame) -> pd.DataFrame:
    """Station-day values under the DEFAULT rule (flat-line and isolated-spike hours excluded)
    plus the all-hours value for transparency."""
    base = hourly.drop(columns=[c for c in ("flag_flatline", "flag_spike", "source", "spike_supported")
                                if c in hourly])
    kept = hourly["spike_supported"] if "spike_supported" in hourly else pd.Series(False, index=hourly.index)
    flagged = hourly["flag_flatline"] | (hourly["flag_spike"] & ~kept)
    d_all = T.to_daily(base)
    d_def = T.to_daily(base.assign(valid_hour=base["valid_hour"] & ~flagged))
    g = hourly.assign(local_date=hourly["hour"].dt.date, f=flagged & hourly["valid_hour"],
                      k=kept & hourly["flag_spike"] & hourly["valid_hour"]).groupby(["sensor_key", "local_date"])
    nflag = pd.concat([g["f"].sum().rename("n_flagged_hours_excluded"),
                       g["k"].sum().rename("n_supported_spike_hours_kept")], axis=1)
    k = ["sensor_key", "location_id", "pollutant", "local_date"]
    out = d_def.merge(d_all[k + ["daily_mean", "valid_hours"]].rename(
        columns={"daily_mean": "daily_mean_all_hours", "valid_hours": "valid_hours_all"}), on=k)
    out = out.merge(nflag.reset_index(), on=["sensor_key", "local_date"], how="left")
    for c in ("n_flagged_hours_excluded", "n_supported_spike_hours_kept"):
        out[c] = out[c].fillna(0).astype("int64")
    return out


def peer_outlier_days(daily: pd.DataFrame, ratio: float = 3.0, min_excess: float = 100.0,
                      min_peers: int = 3) -> pd.Series:
    """Station-day far above the median of OTHER same-city stations that day (review only)."""
    v = daily[daily["is_valid_day"]]
    flags = pd.Series(False, index=daily.index)
    for (_, _, _), g in v.groupby(["city", "pollutant", "local_date"]):
        if len(g) < min_peers + 1:
            continue
        vals = g["daily_mean"].to_numpy()
        for i, idx in enumerate(g.index):
            med = np.median(np.delete(vals, i))
            flags[idx] = vals[i] > ratio * med and vals[i] > med + min_excess
    return flags


PM_RATIO_TOL = 0.20      # PM2.5 may exceed PM10 by up to 20% ...
PM_ABS_TOL = 20.0        # ... or 20 µg/m³, whichever is larger (two separate instruments, ~±10% each)
PM_MIN_MATCHED_HOURS = 16


def _bad_pm_pairs(w: pd.DataFrame) -> pd.Index:
    tol = np.maximum(PM_RATIO_TOL * w["pm10"], PM_ABS_TOL)
    return w[w["pm25"] > w["pm10"] + tol].index


def pm25_exceeds_pm10(daily: pd.DataFrame, hourly: pd.DataFrame | None = None) -> pd.Series:
    """True for BOTH pollutant rows of a station-day where PM2.5 > PM10 + max(20% x PM10, 20 µg/m³).
    PM2.5 is part of PM10, so beyond that measurement tolerance it is physically impossible.
    Two tests, either one flags the day: (1) the two station-day means; (2) with `hourly`, means over
    MATCHED hours (both pollutants valid and unflagged, >= 16 h). Test 1 alone misses faults hidden by
    different hour sets; test 2 alone misses faulty PM2.5 hours where PM10 is missing."""
    v = daily[daily["is_valid_day"]]
    dm = v.pivot_table(index=["source", "location_id", "local_date"], columns="pollutant",
                       values="daily_mean", aggfunc="first")
    if not {"pm25", "pm10"} <= set(dm.columns):
        return pd.Series(False, index=daily.index)
    dm = dm.dropna(subset=["pm25", "pm10"])
    bad = _bad_pm_pairs(dm)
    if hourly is not None:
        h = hourly[hourly["valid_hour"] & ~hourly["flag_flatline"] & ~hourly["flag_spike"]]
        h = h.assign(local_date=h["hour"].dt.date)
        w = h.pivot_table(index=["source", "location_id", "hour", "local_date"], columns="pollutant",
                          values="value", aggfunc="first")
        if {"pm25", "pm10"} <= set(w.columns):
            w = w.dropna(subset=["pm25", "pm10"]).groupby(["source", "location_id", "local_date"]).agg(
                n=("pm25", "size"), pm25=("pm25", "mean"), pm10=("pm10", "mean"))
            w = w[w["n"] >= PM_MIN_MATCHED_HOURS]
            bad = bad.union(_bad_pm_pairs(w))   # either test failing flags the station-day
    key = pd.MultiIndex.from_frame(daily[["source", "location_id", "local_date"]])
    return pd.Series(key.isin(bad), index=daily.index)


# ----------------------------------------------------------------------------- supported spikes
SPIKE_SUPPORT_RATIO = 0.5     # another clean station within +-1 h reads >= 50% of the spike value ...
SPIKE_SUPPORT_VS_MEDIAN = 2.0  # ... and > 2 x the city median that hour (a real local plume)


def festival_night_hours(years=(2024, 2025, 2026)) -> list[tuple[pd.Timestamp, pd.Timestamp]]:
    """Verified festival nights: 18:00 IST on D and D+1 to 06:00 the next morning."""
    out = []
    for y in years:
        for d in C.festival_days(y):
            s = pd.Timestamp(d).tz_localize(C.IST) + pd.Timedelta(hours=18)
            out.append((s, s + pd.Timedelta(hours=12)))
    return out


def supported_spikes(hourly: pd.DataFrame, city_of: pd.DataFrame) -> pd.DataFrame:
    """For spike-flagged hours, decide whether the event is SUPPORTED (kept in analysis values):
      * 'festival_night': the hour lies in a verified Diwali night window (short local bursts expected);
      * 'corroborated': another unflagged primary station in the same city, within +-1 h, reads
        >= 50% of the spike value and > 2 x that hour's city median.
    Returns columns supported (bool) and support_reason, indexed like `hourly`."""
    out = pd.DataFrame({"supported": False, "support_reason": None}, index=hourly.index)
    sp = hourly[hourly["flag_spike"]]
    if sp.empty:
        return out
    h = hourly.merge(city_of, on="sensor_key", how="left")
    h.index = hourly.index
    ref = h[h["city"].notna() & h["valid_hour"]]
    med = ref.groupby(["source", "city", "pollutant", "hour"])["value"].median()
    clean = ref[~ref["flag_spike"] & ~ref["flag_flatline"]].set_index(
        ["source", "city", "pollutant", "hour"]).sort_index()
    nights = festival_night_hours()
    for idx in sp.index:
        r = h.loc[idx]
        if any(a <= r["hour"] < b for a, b in nights):
            out.loc[idx, ["supported", "support_reason"]] = [True, "festival_night"]
            continue
        if pd.isna(r["city"]):
            continue
        m = med.get((r["source"], r["city"], r["pollutant"], r["hour"]), np.nan)
        for dh in (-1, 0, 1):
            k = (r["source"], r["city"], r["pollutant"], r["hour"] + pd.Timedelta(hours=dh))
            if k not in clean.index:
                continue
            o = clean.loc[[k]]
            o = o[o["sensor_key"] != r["sensor_key"]]
            if ((o["value"] >= SPIKE_SUPPORT_RATIO * r["value"]) & (o["value"] > SPIKE_SUPPORT_VS_MEDIAN * m)).any():
                out.loc[idx, ["supported", "support_reason"]] = [True, "corroborated"]
                break
    return out


# ----------------------------------------------------------------------------- Diwali AQI
BASELINE_WINDOWS = {   # local-day offsets from Diwali (D); bulletin = local day + 1
    "W1_d14_d8": (-14, -8, "7 local days D-14..D-8 (original method)"),
    "W2_d7_d1": (-7, -1, "7 local days immediately before (D-7..D-1)"),
    "W3_d3_d1": (-3, -1, "3 local days immediately before (D-3..D-1)"),
    "W4_after_d7_d13": (7, 13, "7 local days after (D+7..D+13); seasonal control only"),
}
PERCENT_STATUS = "pending_user_approval"   # app must not show % until the baseline is approved


def diwali_aqi_table(aqi: pd.DataFrame, years=(2024, 2025, 2026)) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Returns (levels, baselines). levels: one row per city/year/bulletin day (D-7..D+3 local
    evenings) with role 'festival' for D, D+1. baselines: candidate windows with % (pending)."""
    a = aqi.set_index(["city", "bulletin_date"])
    lv, bl = [], []
    for city in sorted(aqi["city"].unique()):
        for y in years:
            D = C.diwali_date(y)
            for k in range(-14, 4):
                ld = D + timedelta(days=k)
                bd = ld + timedelta(days=1)
                row = a.loc[(city, bd)] if (city, bd) in a.index else None
                lv.append({"city": city, "year": y, "diwali_date": D, "offset_days": k, "evening_of": ld,
                           "bulletin_date": bd, "aqi": float(row["aqi"]) if row is not None else np.nan,
                           "aqi_category": row["aqi_category"] if row is not None else None,
                           "prominent_pollutant": row["prominent_pollutant"] if row is not None else None,
                           "no_stations": float(row["no_stations"]) if row is not None else np.nan,
                           "role": "festival" if ld in C.festival_days(y) else "context"})
            fest = [r["aqi"] for r in lv if r["city"] == city and r["year"] == y and r["role"] == "festival"]
            fv = float(np.mean(fest)) if fest and not np.isnan(fest).any() else np.nan
            for wid, (lo, hi, desc) in BASELINE_WINDOWS.items():
                bds = [D + timedelta(days=k + 1) for k in range(lo, hi + 1)]
                vals = [float(a.loc[(city, b), "aqi"]) for b in bds if (city, b) in a.index]
                bv = float(np.mean(vals)) if len(vals) == len(bds) else np.nan
                bl.append({"city": city, "year": y, "window": wid, "description": desc,
                           "bulletin_dates": f"{bds[0]}..{bds[-1]}", "n_days": len(vals),
                           "baseline_aqi": bv, "festival_aqi": fv,
                           "percent_change": (fv - bv) / bv * 100 if bv and not np.isnan(bv) else np.nan,
                           "percent_status": PERCENT_STATUS})
    levels = pd.DataFrame(lv)
    base = pd.DataFrame(bl)
    pre = base[base["window"].isin(["W1_d14_d8", "W2_d7_d1", "W3_d3_d1"])]
    spread = pre.groupby(["city", "year"])["percent_change"].agg(lambda s: s.max() - s.min()).rename("spread_pp")
    base = base.merge(spread.reset_index(), on=["city", "year"], how="left")
    return levels, base


# ----------------------------------------------------------------------------- Delhi PM
def blank_rates(raw: pd.DataFrame, stations: set[int], pollutant: str, nights: list[date]) -> float:
    """Share of 15-min slots blank in 18:00->06:00 windows starting on the given local dates.
    Slots are placed by interval START (label - 15 min). raw = OpenCity readings incl. blanks."""
    x = raw[(raw["pollutant"] == pollutant) & raw["location_id"].isin(stations)]
    start = x["ts"] - pd.Timedelta(minutes=15)
    m = pd.Series(False, index=x.index)
    for d in nights:
        s = pd.Timestamp(d).tz_localize(C.IST) + pd.Timedelta(hours=18)
        m |= (start >= s) & (start < s + pd.Timedelta(hours=12))
    return float(x.loc[m, "value"].isna().mean()) if m.any() else np.nan


def delhi_pm_support(diwali: pd.DataFrame, opencity_raw: pd.DataFrame, panels: dict[str, set[int]],
                     all_stations: set[int]) -> pd.DataFrame:
    rows = []
    sup = diwali[(diwali["role"] == "supporting") & diwali["metric"].isin(C.POLLUTANTS)]
    for _, r in sup.iterrows():
        y, pol = int(r["year"]), r["metric"]
        D, F = C.diwali_date(y), C.festival_days(y)
        rows.append({
            "year": y, "pollutant": pol, "units": C.UNITS, "source": SRC_OPENCITY,
            "data_type": "measured (values > 999 blank in source)", "role": "supporting_context",
            "panel_stations": int(r["n_stations"]),
            "baseline_mean_lower_bound": r["baseline_value"], "festival_mean_lower_bound": r["festival_value"],
            "blank_diwali_night_panel": blank_rates(opencity_raw, panels[pol], pol, [D]),
            "blank_festival_nights_panel": blank_rates(opencity_raw, panels[pol], pol, F),
            "blank_diwali_night_all37": blank_rates(opencity_raw, all_stations, pol, [D]),
            "blank_baseline_nights_panel": blank_rates(opencity_raw, panels[pol], pol, C.baseline_days(y)),
            "proven_over_999_festival_nights_panel": r["blank_proven_share_festival_nights"],
            "blank_definition": "share of 15-min slots blank, 18:00-06:00 IST, slot placed by interval start",
            "warning": r["warning"], "percent_change": np.nan,
        })
    return pd.DataFrame(rows)


# ----------------------------------------------------------------------------- main
def run(processed: Path = C.PROCESSED, out: Path = APP, opencity_dir: Path = C.RAW / "opencity") -> dict:
    out.mkdir(parents=True, exist_ok=True)
    st = pd.read_parquet(processed / "stations.parquet")
    hourly = pd.read_parquet(processed / "station_hourly.parquet")
    gaps = pd.read_parquet(processed / "network_gaps.parquet")
    aqi = pd.read_parquet(processed / "city_daily_aqi.parquet")
    diwali = pd.read_parquet(processed / "diwali.parquet")
    weather = pd.read_parquet(processed / "weather_daily.parquet")
    dq_old = pd.read_parquet(processed / "date_quality.parquet")
    manifest_in = json.loads((processed / "manifest.json").read_text())
    data_end = date.fromisoformat(manifest_in["openaq_data_end"])

    meta = st.drop_duplicates("sensor_key")[["sensor_key", "city", "tier", "monitor_type", "provider"]]
    tables: dict[str, pd.DataFrame] = {}

    # supported spike events are kept in analysis values (reported per station-day)
    city_of = st[st["tier"] == "primary"].drop_duplicates("sensor_key")[["sensor_key", "city"]]
    oc_keys = hourly.loc[hourly["source"] == SRC_OPENCITY, "sensor_key"].unique()
    city_of = pd.concat([city_of, pd.DataFrame({"sensor_key": oc_keys, "city": "Delhi"})], ignore_index=True)
    sup = supported_spikes(hourly, city_of)
    hourly["spike_supported"] = sup["supported"].astype(bool)
    spike_report = hourly.loc[hourly["flag_spike"]].assign(reason=sup.loc[hourly["flag_spike"], "support_reason"]
                                                          .fillna("excluded"))
    spike_summary = spike_report.groupby(["source", "reason"]).size().to_dict()

    # station-day, default rule
    parts = []
    for src, g in hourly.groupby("source"):
        parts.append(daily_with_flag_rule(g).assign(source=src))
    sd = pd.concat(parts, ignore_index=True)
    sd = sd.merge(meta, on="sensor_key", how="left")
    sd.loc[sd["source"] == SRC_OPENCITY, ["city", "tier", "monitor_type", "provider"]] = \
        ["Delhi", "primary", "reference", "CPCB"]
    sd["flag_peer_outlier_day"] = False
    prim_mask = (sd["tier"] == "primary")
    for src in sd["source"].unique():
        m = prim_mask & (sd["source"] == src)
        sd.loc[m, "flag_peer_outlier_day"] = peer_outlier_days(sd[m]).values
    # Physically impossible PM2.5 > PM10: flagged AND excluded from the default analysis value
    sd["flag_pm25_gt_pm10"] = pm25_exceeds_pm10(sd, hourly)
    sd.loc[sd["flag_pm25_gt_pm10"], "is_valid_day"] = False
    sd.loc[sd["flag_pm25_gt_pm10"], "daily_mean"] = np.nan
    sd["units"] = C.UNITS
    sd["data_type"] = "measured"
    tables["station_daily"] = sd[[
        "source", "city", "location_id", "sensor_key", "pollutant", "tier", "monitor_type", "provider",
        "local_date", "valid_hours", "coverage", "is_valid_day", "daily_mean", "daily_mean_all_hours",
        "valid_hours_all", "n_flagged_hours_excluded", "n_supported_spike_hours_kept", "n_readings_above_1000",
        "flag_peer_outlier_day", "flag_pm25_gt_pm10", "units", "data_type"]]

    # severity (OpenAQ: all six cities; OpenCity: Delhi)
    oa_dates = {c: [date(2025, 2, 18) + timedelta(days=i) for i in range((data_end - date(2025, 2, 18)).days + 1)]
                for c in C.CITIES}
    oc_dates = {"Delhi": [date(2024, 1, 1) + timedelta(days=i) for i in range(731)]}
    sev = pd.concat([severity_table(gaps, oa_dates, SRC_OPENAQ),
                     severity_table(gaps, oc_dates, SRC_OPENCITY, network_scope=None)], ignore_index=True)
    pending = dq_old[dq_old["status"] == "not_yet_published"]["local_date"].tolist()
    sev = pd.concat([sev, pd.DataFrame([{"source": SRC_OPENAQ, "city": c, "local_date": d, "gap_hours": np.nan,
                                         "longest_run_hours": np.nan, "severity": "not_yet_published",
                                         "n_cities_affected": np.nan, "extent": "not_yet_published"}
                                        for c in C.CITIES for d in pending])], ignore_index=True)
    tables["date_quality"] = sev

    # city-day (OpenAQ primary, default rule) with severity
    n_primary = st[st["tier"] == "primary"].groupby("city")["location_id"].nunique().to_dict()
    p = sd[(sd["source"] == SRC_OPENAQ) & (sd["tier"] == "primary")]
    cd = T.city_daily(p, n_primary)
    cd_all = T.city_daily(p.assign(daily_mean=p["daily_mean_all_hours"],
                                   is_valid_day=p["valid_hours_all"] >= C.MIN_VALID_HOURS_PER_DAY), n_primary)
    nimp = p.groupby(["city", "pollutant", "local_date"])["flag_pm25_gt_pm10"].sum().rename("n_pm25_gt_pm10_excluded")
    cd = cd.merge(cd_all[["city", "pollutant", "local_date", "city_mean"]].rename(
        columns={"city_mean": "city_mean_all_hours"}), on=["city", "pollutant", "local_date"], how="left")
    nflag = p.groupby(["city", "pollutant", "local_date"])["n_flagged_hours_excluded"].sum().rename("n_flagged_hours_excluded")
    nkept = p.groupby(["city", "pollutant", "local_date"])["n_supported_spike_hours_kept"].sum().rename(
        "n_supported_spike_hours_kept")
    nout = p.groupby(["city", "pollutant", "local_date"])["flag_peer_outlier_day"].sum().rename("n_peer_outlier_stations")
    cd = cd.merge(nflag.reset_index(), on=["city", "pollutant", "local_date"], how="left") \
           .merge(nout.reset_index(), on=["city", "pollutant", "local_date"], how="left") \
           .merge(nkept.reset_index(), on=["city", "pollutant", "local_date"], how="left") \
           .merge(nimp.reset_index(), on=["city", "pollutant", "local_date"], how="left")
    cd = cd.merge(sev[sev["source"] == SRC_OPENAQ][["city", "local_date", "gap_hours", "longest_run_hours",
                                                     "severity", "extent"]], on=["city", "local_date"], how="left")
    cd["source"], cd["data_type"], cd["units"] = SRC_OPENAQ, "measured", C.UNITS
    tables["city_daily"] = cd

    # Diwali AQI (main) + Delhi PM (supporting) + other-city PM status
    levels, baselines = diwali_aqi_table(aqi)
    for t in (levels, baselines):
        t["source"] = "CPCB daily AQI bulletin (via UrbanEmissions)"
        t["data_type"] = "official measured AQI (city average)"
        t["units"] = "index (0-500)"
    tables["diwali_aqi_levels"] = levels
    tables["diwali_aqi_baselines"] = baselines
    m = json.loads((C.RAW / "opencity" / "mapping.json").read_text())
    oc_raw = pd.concat([T.read_opencity_csv(opencity_dir / f"{l}.csv", int(l)) for l in m], ignore_index=True)
    panels = {pol: set(st.loc[st[f"delhi_diwali_panel_{pol}"], "location_id"].astype(int)) for pol in C.POLLUTANTS}
    tables["delhi_pm_diwali_support"] = delhi_pm_support(diwali, oc_raw, panels, {int(l) for l in m})
    tables["diwali_pm_status"] = diwali[diwali["role"] == "status"][
        ["city", "year", "metric", "units", "source", "data_type", "n_stations", "status", "reason_code",
         "low_quality_dates"]].reset_index(drop=True)
    tables["data_status_reasons"] = pd.read_parquet(processed / "data_status_reasons.parquet")

    # pass-through slim tables
    tables["stations"] = st
    tables["city_daily_aqi"] = aqi
    tables["weather_daily"] = weather
    tables["network_gaps"] = gaps

    for name, df in tables.items():
        tmp = out / f"{name}.tmp"
        df.to_parquet(tmp, index=False, compression="zstd")
        tmp.replace(out / f"{name}.parquet")
    sizes = {f.name: f.stat().st_size for f in sorted(out.glob("*.parquet"))}
    manifest = {
        "derived_from": manifest_in["built_utc"], "openaq_data_end": str(data_end),
        "default_analysis_rule": "exclude hours flagged flat-line (>= 6 identical h) or isolated spike, EXCEPT "
                                 "supported spikes (verified Diwali night 18:00-06:00, or corroborated by another "
                                 "clean same-city station within +-1 h at >= 50% of the value and > 2x the city "
                                 "median); exclude station-days where matched-hour PM2.5 > PM10 + max(20% x PM10, "
                                 "20 ug/m3) (impossible); peer-outlier station-days are flagged, not excluded",
        "spike_hours": {f"{k[0]} | {k[1]}": int(v) for k, v in spike_summary.items()},
        "diwali_percent_status": PERCENT_STATUS,
        "attribution": {"openaq": "OpenAQ (openaq.org), CPCB data",
                        "opencity": "CPCB data via OpenCity (data.opencity.in), public domain",
                        "bulletins": "CPCB daily AQI bulletins, parsed by UrbanEmissions.info (GODL)",
                        "weather": WEATHER_ATTRIBUTION},
        "weather_units": WEATHER_UNITS,
        "rows": {k: int(len(v)) for k, v in tables.items()},
        "bytes": sizes, "total_bytes": int(sum(sizes.values())),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, indent=1, default=str))
    return manifest
