"""Build the processed dataset (Parquet) from cached raw sources.

Repeatable: every output is rebuilt from raw inputs and written atomically (tmp + rename),
so a rerun replaces files instead of appending. Primary keys are asserted unique.
Nothing is gap-filled or imputed: missing hours/days stay missing and are counted.

Outputs (in out_dir):
  stations.parquet             selected stations/sensors, tiers, coordinates, Delhi panel flags
  station_hourly.parquet       hourly values per sensor (both sources) + fault flags
  station_daily.parquet        daily values per sensor: valid_hours, coverage, flag counts
  city_daily.parquet           OpenAQ primary city values (city rule) + low-quality flags
  city_daily_aqi.parquet       CPCB bulletin AQI, six cities, aligned to 4 PM reporting period
  network_gaps.parquet         network-wide gap runs (data-quality table)
  date_quality.parquet         per source/scope/date: gap hours, low_quality, publication status
  recurring_gap_hours.parquet  share of days each hour-of-day is a network gap
  opencity_blanks.parquet      Delhi OpenCity blanks per sensor-day: proven source-limit vs other
  diwali.parquet               Diwali rows: AQI = main comparison; PM = supporting/status only
  data_status_reasons.parquet  reason codes + user-facing messages (stored separately)
  cleaning_log.parquet         per-sensor counts of removed/flagged readings
  manifest.json                build metadata and row counts
"""
from __future__ import annotations

import json
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from . import archive, config as C, quality as Q, transform as T

SRC_OPENAQ = "OpenAQ archive (CPCB/AirNow/AirGradient)"
SRC_OPENCITY = "CPCB via OpenCity"
SRC_BULLETIN = "CPCB daily AQI bulletin (via UrbanEmissions)"
MONITOR_TYPE = {"primary": "reference", "low_cost": "low_cost",
                "supporting_single_station": "reference_supporting"}
SUPPORTING_START = date(2024, 1, 1)
OPENCITY_WARNING = ("Readings above 999 µg/m³ are blank in this source; "
                    "Diwali-night peaks are under-represented.")

REASONS = pd.DataFrame([
    {"reason_code": "OPENAQ_INGESTION_GAP",
     "detail": "OpenAQ (archive and API) has network-wide missing hours on a festival or baseline "
               "date (on 2025-10-20: IST hours 10-14 and 20-22 at every station).",
     "user_message": "Measured PM data is incomplete for Diwali {year}."},
    {"reason_code": "NO_MEASURED_DATA",
     "detail": "No measured PM data from the approved sources covers this period "
               "(OpenAQ has no CPCB data 2022-11 to 2025-02-18; OpenCity covers Delhi only).",
     "user_message": "No measured PM data is available for Diwali {year}."},
    {"reason_code": "NOT_YET_AVAILABLE",
     "detail": "The festival has not happened yet or its data has not been published.",
     "user_message": "Data for Diwali {year} is not available yet."},
    {"reason_code": "BELOW_PANEL_RULE",
     "detail": "Fewer stations than required pass coverage (both festival days valid and >= 5 of 7 baseline days).",
     "user_message": "Measured PM data is incomplete for Diwali {year}."},
    {"reason_code": "OPENCITY_999_LIMIT",
     "detail": "OpenCity blanks every value above 999 µg/m³, so festival-night peaks are missing; "
               "blank rates differ by year. Shown as supporting context only; no % change.",
     "user_message": OPENCITY_WARNING},
])


# --------------------------------------------------------------------------- helpers
def _write(df: pd.DataFrame, path: Path) -> None:
    tmp = path.with_suffix(".tmp")
    df.to_parquet(tmp, index=False, compression="zstd")
    tmp.replace(path)


def _assert_unique(df: pd.DataFrame, keys: list[str], name: str) -> None:
    dup = int(df.duplicated(keys).sum())
    if dup:
        raise AssertionError(f"{name}: {dup} duplicate rows on {keys}")


def _ist(s: str) -> pd.Timestamp:
    t = pd.Timestamp(s)
    return t.tz_convert(C.IST) if t.tzinfo else t.tz_localize(C.IST)


def _day_bounds(start: date, end: date) -> tuple[pd.Timestamp, pd.Timestamp]:
    return (pd.Timestamp(start).tz_localize(C.IST),
            pd.Timestamp(end + timedelta(days=1)).tz_localize(C.IST))


# --------------------------------------------------------------------------- stations
def load_stations(candidates: dict, cities: list[str]) -> pd.DataFrame:
    rows = []
    for city in cities:
        for tier, mtype in MONITOR_TYPE.items():
            for s in candidates["cities"][city][tier]:
                for pol in C.POLLUTANTS:
                    sen = s["sensors"].get(pol)
                    if not sen or not sen["last"]:
                        continue
                    rows.append({
                        "city": city, "tier": tier, "monitor_type": mtype,
                        "location_id": s["location_id"], "station_name": s["name"],
                        "provider": s["provider"], "lat": s["lat"], "lon": s["lon"],
                        "km_from_centre": s["km_from_centre"],
                        "location_last_utc": s["location_last_utc"],
                        "pollutant": pol, "sensor_id": int(sen["id"]),
                        "sensor_key": f"openaq:{sen['id']}",
                        "sensor_first": _ist(sen["first"]), "sensor_last": _ist(sen["last"]),
                    })
    return pd.DataFrame(rows)


# --------------------------------------------------------------------------- OpenAQ
def location_days(st: pd.DataFrame, start: date, end: date) -> dict[int, list[date]]:
    out = {}
    for lid, g in st.groupby("location_id"):
        tier = g["tier"].iat[0]
        lo = max(min(start, SUPPORTING_START) if tier == "supporting_single_station" else start,
                 g["sensor_first"].min().date())
        hi = min(end, g["sensor_last"].max().date() + timedelta(days=1))
        if lo <= hi:
            out[int(lid)] = [lo + timedelta(days=i) for i in range((hi - lo).days + 1)]
    return out


def download_openaq(st: pd.DataFrame, start: date, end: date, today: date, workers: int = 16,
                    progress: bool = True):
    """Fetch (or reuse cached) archive files. Returns (paths by location, last published date)."""
    days = location_days(st, start, end)
    jobs = [(lid, d) for lid, ds in days.items() for d in ds]
    paths: dict[int, list[tuple[date, Path]]] = {lid: [] for lid in days}

    def safe(j):
        try:
            return j, archive.fetch(j[0], j[1], today), None
        except RuntimeError as e:          # network failure after retries: NOT "missing"
            return j, None, str(e)

    pending, done = jobs, 0
    for rnd in range(4):                   # first pass + up to 3 retry rounds
        failed = []
        with ThreadPoolExecutor(workers if rnd == 0 else 4) as ex:
            for (lid, d), p, err in ex.map(safe, pending):
                if err:
                    failed.append((lid, d))
                    continue
                if p is not None:
                    paths[lid].append((d, p))
                done += 1
                if progress and done % 10000 == 0:
                    print(f"  archive: {done}/{len(jobs)} checked", flush=True)
        if not failed:
            break
        if progress:
            print(f"  archive: {len(failed)} downloads failed (network/TLS); retry round {rnd + 1}", flush=True)
        time.sleep(30 * (rnd + 1))
        pending = failed
    if failed:
        raise RuntimeError(f"{len(failed)} archive downloads still failing after retries "
                           f"(e.g. {failed[:3]}); not treating them as missing data")
    # Publication tail: last date on which >= 50% of PRIMARY locations have a file.
    prim = set(st.loc[st["tier"] == "primary", "location_id"].astype(int))
    rng = pd.date_range(start, end).date
    have = pd.Series(0, index=rng)
    for lid in prim & set(paths):
        for d, _ in paths[lid]:
            if d in have.index:
                have[d] += 1
    pres = pd.DataFrame({"local_date": rng, "share": (have / max(1, len(prim))).values})
    last_pub = Q.publication_tail(pres) or end
    if progress:
        n = sum(map(len, paths.values()))
        print(f"  archive: {len(jobs)} location-days checked, {n} files present; "
              f"last published date {last_pub}", flush=True)
    return paths, last_pub


def process_openaq(st: pd.DataFrame, paths: dict, start: date, end: date):
    """Returns hourly, cleaning log, rows from non-selected sensors, and raw readings > 999
    (used only to PROVE OpenCity blanks)."""
    hourly_parts, logs, hi_parts, other = [], [], [], 0
    keep = set(st["sensor_key"])
    lo, hi = _day_bounds(start, end)
    for lid, items in paths.items():
        items = [p for d, p in items if d <= end + timedelta(days=1)]
        if not items:
            continue
        raw = pd.concat([T.read_archive_csv(p) for p in items], ignore_index=True)
        other += int((~raw["sensor_key"].isin(keep)).sum())
        raw = raw[raw["sensor_key"].isin(keep)]
        hi_parts.append(raw.loc[raw["value"] > C.OPENCITY_LIMIT, ["location_id", "pollutant", "ts"]])
        clean, log = T.clean_readings(raw)
        logs.append(log)
        h = T.to_hourly(clean)
        hourly_parts.append(h[(h["hour"] >= lo) & (h["hour"] < hi)])
    hourly = pd.concat(hourly_parts, ignore_index=True)
    hourly["source"] = SRC_OPENAQ
    log = pd.concat(logs, ignore_index=True).assign(source=SRC_OPENAQ)
    return hourly, log, other, pd.concat(hi_parts, ignore_index=True).drop_duplicates()


# --------------------------------------------------------------------------- OpenCity
def opencity_blank_hours(raw: pd.DataFrame, proven_hi: pd.DataFrame) -> pd.DataFrame:
    """Per sensor and interval-start hour: n_slots, n_blank, n_blank_proven (OpenCity blank
    while OpenAQ has a value > 999 at the same location/pollutant/time)."""
    r = raw.merge(proven_hi.assign(proven=True), on=["location_id", "pollutant", "ts"], how="left")
    r["blank"] = r["value"].isna()
    r["blank_proven"] = r["blank"] & r["proven"].fillna(False).astype(bool)
    r["hour"] = (r["ts"] - pd.Timedelta(minutes=15)).dt.floor("h")
    return r.groupby(["sensor_key", "location_id", "pollutant", "hour"]).agg(
        n_slots=("ts", "size"), n_blank=("blank", "sum"), n_blank_proven=("blank_proven", "sum")
    ).reset_index()


def process_opencity(st_delhi_primary: pd.DataFrame, opencity_dir: Path, proven_hi: pd.DataFrame):
    parts, logs, blanks = [], [], []
    for lid in sorted(st_delhi_primary["location_id"].unique()):
        f = opencity_dir / f"{lid}.csv"
        if not f.exists():
            continue
        raw = T.read_opencity_csv(f, int(lid))
        blanks.append(opencity_blank_hours(raw, proven_hi[proven_hi["location_id"] == lid]))
        clean, log = T.clean_readings(raw)
        logs.append(log)
        parts.append(T.to_hourly(clean))
    hourly = pd.concat(parts, ignore_index=True)
    hourly["source"] = SRC_OPENCITY
    return (hourly, pd.concat(logs, ignore_index=True).assign(source=SRC_OPENCITY),
            pd.concat(blanks, ignore_index=True))


# --------------------------------------------------------------------------- quality
def build_quality(hourly: pd.DataFrame, active: pd.DataFrame, source: str, scope: str,
                  start: pd.Timestamp, end: pd.Timestamp):
    cov = Q.network_coverage(hourly[hourly["source"] == source], active, start, end)
    runs = Q.gap_runs(cov).assign(source=source, scope=scope)
    dq = Q.date_quality(cov).assign(source=source, scope=scope, status="published")
    rec = Q.recurring_gap_hours(cov).rename("share_of_days").reset_index().assign(source=source, scope=scope)
    return runs, dq, rec


# --------------------------------------------------------------------------- Diwali
def station_event_stats(daily: pd.DataFrame, year: int) -> pd.DataFrame:
    """Per sensor: passes if both festival days valid and >= 5 of 7 baseline days valid."""
    fest, base = C.festival_days(year), C.baseline_days(year)
    d = daily[daily["local_date"].isin(fest + base)]
    rows = []
    for (key, lid, pol), g in d.groupby(["sensor_key", "location_id", "pollutant"]):
        g = g.set_index("local_date")
        fv = [x for x in fest if bool(g["is_valid_day"].get(x, False))]
        bv = [x for x in base if bool(g["is_valid_day"].get(x, False))]
        rows.append({"sensor_key": key, "location_id": lid, "pollutant": pol, "year": year,
                     "festival_valid_days": len(fv), "baseline_valid_days": len(bv),
                     "passes": len(fv) == len(fest) and len(bv) >= 5,
                     "festival_mean": g.loc[fv, "daily_mean"].mean() if fv else np.nan,
                     "baseline_mean": g.loc[bv, "daily_mean"].mean() if bv else np.nan})
    return pd.DataFrame(rows)


def night_blank_rate(blank_hours: pd.DataFrame, ids: list[int], pol: str, nights: list[date]) -> tuple:
    """Blank share (and proven-limit share) for 18:00 -> 06:00 nights starting on given dates."""
    b = blank_hours[(blank_hours["pollutant"] == pol) & blank_hours["location_id"].isin(ids)]
    m = pd.Series(False, index=b.index)
    for d in nights:
        s = pd.Timestamp(d).tz_localize(C.IST) + pd.Timedelta(hours=18)
        m |= (b["hour"] >= s) & (b["hour"] < s + pd.Timedelta(hours=12))
    x = b[m]
    n = x["n_slots"].sum()
    return ((x["n_blank"].sum() / n) if n else np.nan, (x["n_blank_proven"].sum() / n) if n else np.nan)


def low_quality_dates(dq: pd.DataFrame, source: str, scopes: list[str], days: list[date]) -> list[str]:
    q = dq[(dq["source"] == source) & dq["scope"].isin(scopes) & dq["local_date"].isin(days) & dq["low_quality"]]
    return sorted({str(x) for x in q["local_date"]})


def _row(**kw) -> dict:
    base = {"role": None, "city": None, "year": None, "metric": None, "units": None, "source": None,
            "data_type": None, "comparison_group": None, "n_stations": 0,
            "baseline_value": np.nan, "festival_value": np.nan, "change_pct": np.nan,
            "status": None, "reason_code": None, "low_quality": False, "low_quality_dates": "",
            "warning": None, "blank_rate_festival_nights": np.nan, "blank_rate_baseline_nights": np.nan,
            "blank_proven_share_festival_nights": np.nan}
    base.update(kw)
    return base


def build_diwali(daily: pd.DataFrame, stations: pd.DataFrame, aqi: pd.DataFrame, dq: pd.DataFrame,
                 blank_hours: pd.DataFrame | None, cities: list[str], today: date, data_end: date):
    rows, panels = [], {}
    years = (2024, 2025, 2026)

    # 1) MAIN comparison: CPCB bulletin AQI, all cities, aligned to the 4 PM reporting period.
    for city in cities:
        a = aqi[aqi["city"] == city].set_index("bulletin_date")
        last_bulletin = max(a.index, default=date.min)
        for y in years:
            fb, bb = C.bulletin_dates_for(C.festival_days(y)), C.bulletin_dates_for(C.baseline_days(y))
            common = dict(role="main", city=city, year=y, metric="aqi", units="index (0-500)",
                          source=SRC_BULLETIN, data_type="official measured AQI (city average)",
                          comparison_group="all stations in CPCB city bulletin")
            have_f, have_b = [d for d in fb if d in a.index], [d for d in bb if d in a.index]
            if len(have_f) < len(fb):
                code = "NOT_YET_AVAILABLE" if fb[-1] > last_bulletin else "NO_MEASURED_DATA"
                rows.append(_row(**common, status="not_available", reason_code=code)); continue
            bv, fv = a.loc[have_b, "aqi"].mean(), a.loc[have_f, "aqi"].mean()
            ok = len(have_b) >= 5
            rows.append(_row(**common, n_stations=int(a.loc[have_f, "no_stations"].min()),
                             baseline_value=bv, festival_value=fv, change_pct=(fv - bv) / bv * 100,
                             status="ok" if ok else "incomplete",
                             reason_code=None if ok else "BELOW_PANEL_RULE"))

    # 2) Delhi measured PM (OpenCity, fixed panel): SUPPORTING context, no % change.
    oc = daily[daily["source"] == SRC_OPENCITY]
    if "Delhi" in cities and not oc.empty:
        st = pd.concat([station_event_stats(oc, y) for y in (2024, 2025)], ignore_index=True)
        if st.empty:
            for y in (2024, 2025):
                rows.append(_row(role="supporting", city="Delhi", year=y, metric="pm25/pm10",
                                 source=SRC_OPENCITY, status="no_data", reason_code="NO_MEASURED_DATA"))
        for pol in (C.POLLUTANTS if not st.empty else ()):
            ok = st[st["pollutant"] == pol].pivot_table(index="location_id", columns="year",
                                                        values="passes", aggfunc="first")
            ok = ok.reindex(columns=[2024, 2025]).eq(True)
            ids = sorted(int(i) for i in ok.index[ok[2024] & ok[2025]])
            panels[pol] = ids
            for y in (2024, 2025):
                s = st[(st["pollutant"] == pol) & (st["year"] == y) & st["location_id"].isin(ids)]
                fr, fp = night_blank_rate(blank_hours, ids, pol, C.festival_days(y))
                br, _ = night_blank_rate(blank_hours, ids, pol, C.baseline_days(y))
                lq = low_quality_dates(dq, SRC_OPENCITY, ["Delhi"], C.festival_days(y) + C.baseline_days(y))
                rows.append(_row(
                    role="supporting", city="Delhi", year=y, metric=pol, units=C.UNITS,
                    source=SRC_OPENCITY, data_type="measured (values > 999 blank in source)",
                    comparison_group=f"fixed panel ({len(ids)} stations, both years)",
                    n_stations=int(len(s)), baseline_value=s["baseline_mean"].mean(),
                    festival_value=s["festival_mean"].mean(), change_pct=np.nan,
                    status="supporting_only", reason_code="OPENCITY_999_LIMIT",
                    low_quality=bool(lq), low_quality_dates=",".join(lq), warning=OPENCITY_WARNING,
                    blank_rate_festival_nights=fr, blank_rate_baseline_nights=br,
                    # proof needs OpenAQ values at the same time: only possible from 2025-02-18
                    blank_proven_share_festival_nights=fp if y >= C.GAP_END.year else np.nan))
        rows.append(_row(role="supporting", city="Delhi", year=2026, metric="pm25/pm10",
                         source=SRC_OPENAQ, status="not_available", reason_code="NOT_YET_AVAILABLE",
                         warning="2025 side would use OpenCity (999 limit): supporting context only, no % change."))

    # 3) Other cities measured PM: STATUS rows only (no values used for comparison, no % change).
    oa = daily[(daily["source"] == SRC_OPENAQ) & (daily["tier"] == "primary")]
    for city in [c for c in cities if c != "Delhi"]:
        for y in years:
            for pol in C.POLLUTANTS:
                common = dict(role="status", city=city, year=y, metric=pol, units=C.UNITS,
                              source=SRC_OPENAQ, data_type="measured")
                days_ = C.festival_days(y) + C.baseline_days(y)
                if C.festival_days(y)[-1] > data_end:
                    rows.append(_row(**common, status="not_available", reason_code="NOT_YET_AVAILABLE")); continue
                sub = oa[(oa["city"] == city) & (oa["pollutant"] == pol) & oa["local_date"].isin(days_)]
                if sub.empty:
                    rows.append(_row(**common, status="no_data", reason_code="NO_MEASURED_DATA")); continue
                lq = low_quality_dates(dq, SRC_OPENAQ, ["all_cities", city], days_)
                stt = station_event_stats(sub, y)
                n_ok = int(stt["passes"].sum())
                if lq:
                    rows.append(_row(**common, n_stations=n_ok, status="incomplete",
                                     reason_code="OPENAQ_INGESTION_GAP", low_quality=True,
                                     low_quality_dates=",".join(lq))); continue
                n_req = T.min_stations_required(int(stations[(stations.city == city) & (stations.tier == "primary")].location_id.nunique()))
                rows.append(_row(**common, n_stations=n_ok,
                                 status="ok" if n_ok >= n_req else "incomplete",
                                 reason_code=None if n_ok >= n_req else "BELOW_PANEL_RULE"))

    out = pd.DataFrame(rows)
    out["festival_days"] = out["year"].map(lambda y: ",".join(map(str, C.festival_days(y))))
    out["baseline_days"] = out["year"].map(lambda y: f"{C.baseline_days(y)[0]}..{C.baseline_days(y)[-1]}")
    out["bulletin_dates_used"] = np.where(
        out["metric"] == "aqi",
        out["year"].map(lambda y: "festival " + ",".join(map(str, C.bulletin_dates_for(C.festival_days(y))))
                        + "; baseline " + f"{C.bulletin_dates_for(C.baseline_days(y))[0]}.."
                        f"{C.bulletin_dates_for(C.baseline_days(y))[-1]}"), "")
    # Hard guarantee: no PM percentage change is ever stored.
    assert out.loc[out["metric"] != "aqi", "change_pct"].isna().all()
    return out, panels


# --------------------------------------------------------------------------- bulletins
def load_bulletins(path: Path, cities: list[str]) -> pd.DataFrame:
    b = pd.read_parquet(path)
    b = b[b["city"].isin(cities)].copy()
    b["date"] = pd.to_datetime(b["date"]).dt.date
    b = T.align_bulletins(b).rename(columns={"date": "bulletin_date"})
    b["source"] = SRC_BULLETIN
    b["data_type"] = "official measured AQI (city average)"
    b["units"] = "index (0-500)"
    cols = ["city", "bulletin_date", "period_start_ist", "period_end_ist", "evening_of_local_date",
            "aqi", "aqi_category", "prominent_pollutant", "no_stations", "source", "data_type", "units"]
    b = b[cols].drop_duplicates(["city", "bulletin_date"]).sort_values(["city", "bulletin_date"])
    return b.reset_index(drop=True)


# --------------------------------------------------------------------------- main
def run(out_dir: Path, cities: list[str], start: date, end: date, today: date,
        candidates_path: Path, opencity_dir: Path, bulletin_path: Path, progress: bool = True) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    cand = json.loads(candidates_path.read_text())
    st = load_stations(cand, cities)

    paths, last_pub = download_openaq(st, start, end, today, progress=progress)
    data_end = min(end, last_pub)
    h_oa, log_oa, other, proven_hi = process_openaq(st, paths, start, data_end)
    hourly, logs, blank_hours = [h_oa], [log_oa], None
    if "Delhi" in cities:
        h_oc, log_oc, blank_hours = process_opencity(
            st[(st.city == "Delhi") & (st.tier == "primary")], opencity_dir, proven_hi)
        hourly.append(h_oc)
        logs.append(log_oc)
    hourly = pd.concat(hourly, ignore_index=True)
    _assert_unique(hourly, ["source", "sensor_key", "hour"], "station_hourly")

    # Sensor-fault flags (review only; nothing deleted)
    prim = st[st.tier == "primary"]
    peers = pd.concat([prim[["sensor_key", "city"]],
                       pd.DataFrame({"sensor_key": "opencity:" + prim.loc[prim.city == "Delhi", "location_id"].astype(str)
                                     + ":" + prim.loc[prim.city == "Delhi", "pollutant"], "city": "Delhi"})]
                      ).drop_duplicates("sensor_key")
    hourly["flag_flatline"] = Q.flag_flatlines(hourly, C.FLATLINE_MIN_HOURS)
    hourly["flag_spike"] = Q.flag_isolated_spikes(hourly[["source", "sensor_key", "pollutant", "hour", "value"]],
                                                  peers, C.SPIKE_MIN_PEERS, C.SPIKE_RATIO,
                                                  C.SPIKE_MIN_EXCESS, C.SPIKE_NEIGHBOUR_RATIO)

    meta = st.drop_duplicates("location_id")[["location_id", "city", "tier", "monitor_type", "station_name",
                                              "provider", "lat", "lon"]]
    daily = pd.concat([T.to_daily(g).assign(source=s) for s, g in hourly.groupby("source")], ignore_index=True)
    daily = daily.merge(meta, on="location_id", how="left")
    daily["sensor_id"] = daily["sensor_key"].map(st.set_index("sensor_key")["sensor_id"]).astype("Int64")
    daily["units"] = C.UNITS
    daily["data_type"] = "measured"
    _assert_unique(daily, ["source", "sensor_key", "local_date"], "station_daily")

    # Network-wide gaps over PRIMARY reference sensors (OpenAQ: all cities + per city)
    act = prim[["sensor_key", "city"]].assign(first=prim["sensor_first"], last=prim["sensor_last"])
    lo, hi = _day_bounds(start, data_end)
    runs, dqs, recs = [], [], []
    for scope, a in [("all_cities", act)] + [(c, act[act.city == c]) for c in cities]:
        r, d, rc = build_quality(hourly, a, SRC_OPENAQ, scope, lo, hi)
        runs.append(r); dqs.append(d); recs.append(rc)
    if "Delhi" in cities:
        dk = prim[prim.city == "Delhi"].drop_duplicates(["location_id", "pollutant"])
        oc_act = pd.DataFrame({"sensor_key": "opencity:" + dk["location_id"].astype(str) + ":" + dk["pollutant"],
                               "first": pd.Timestamp("2024-01-01", tz=C.IST),
                               "last": pd.Timestamp("2026-01-01", tz=C.IST)})
        r, d, rc = build_quality(hourly, oc_act, SRC_OPENCITY, "Delhi",
                                 pd.Timestamp("2024-01-01", tz=C.IST), pd.Timestamp("2026-01-01", tz=C.IST))
        runs.append(r); dqs.append(d); recs.append(rc)
    # Days the archive has not published yet: "not yet available", NOT outages.
    pending = [data_end + timedelta(days=i) for i in range(1, (end - data_end).days + 1)]
    if pending:
        dqs.append(pd.DataFrame({"local_date": pending, "gap_hours": pd.NA, "min_fraction": np.nan,
                                 "low_quality": False, "source": SRC_OPENAQ, "scope": "all_cities",
                                 "status": "not_yet_published"}))
    gaps = pd.concat(runs, ignore_index=True)
    dq = pd.concat(dqs, ignore_index=True)
    rec = pd.concat(recs, ignore_index=True)

    # City daily (OpenAQ primary only) with low-quality flags
    n_primary = prim.groupby("city")["location_id"].nunique().to_dict()
    cd = T.city_daily(daily[(daily.source == SRC_OPENAQ) & (daily.tier == "primary")], n_primary)
    flag = dq[(dq.source == SRC_OPENAQ) & (dq.status == "published")][["scope", "local_date", "gap_hours", "low_quality"]]
    nat = flag[flag.scope == "all_cities"].rename(columns={"gap_hours": "network_gap_hours_all",
                                                         "low_quality": "lq_all"}).drop(columns="scope")
    loc = flag[flag.scope != "all_cities"].rename(columns={"scope": "city", "gap_hours": "network_gap_hours_city",
                                                          "low_quality": "lq_city"})
    cd = cd.merge(nat, on="local_date", how="left").merge(loc, on=["city", "local_date"], how="left")
    cd["low_quality"] = cd["lq_all"].fillna(False).astype(bool) | cd["lq_city"].fillna(False).astype(bool)
    cd["quality_reason"] = np.where(cd["low_quality"], "OPENAQ_INGESTION_GAP", None)
    cd = cd.drop(columns=["lq_all", "lq_city"])
    cd["source"], cd["data_type"], cd["units"] = SRC_OPENAQ, "measured", C.UNITS
    _assert_unique(cd, ["city", "pollutant", "local_date"], "city_daily")

    aqi = load_bulletins(bulletin_path, cities)
    _assert_unique(aqi, ["city", "bulletin_date"], "city_daily_aqi")

    diwali, panels = build_diwali(daily, st, aqi, dq, blank_hours, cities, today, data_end)

    stations = st.drop(columns=["sensor_first", "sensor_last"]).assign(
        sensor_first=st["sensor_first"].astype(str), sensor_last=st["sensor_last"].astype(str))
    for pol, ids in panels.items():
        stations[f"delhi_diwali_panel_{pol}"] = (stations.city == "Delhi") & stations.location_id.isin(ids)

    outputs = {"stations": stations, "station_hourly": hourly, "station_daily": daily, "city_daily": cd,
               "city_daily_aqi": aqi, "network_gaps": gaps, "date_quality": dq, "recurring_gap_hours": rec,
               "diwali": diwali, "data_status_reasons": REASONS,
               "cleaning_log": pd.concat(logs, ignore_index=True)}
    if blank_hours is not None:
        bd = blank_hours.assign(local_date=blank_hours["hour"].dt.date).groupby(
            ["sensor_key", "location_id", "pollutant", "local_date"])[["n_slots", "n_blank", "n_blank_proven"]].sum().reset_index()
        bd = bd.rename(columns={"n_blank_proven": "n_blank_source_limit_proven"})
        bd["n_missing_or_blank"] = bd["n_blank"] - bd["n_blank_source_limit_proven"]
        outputs["opencity_blanks"] = bd
    for name, df in outputs.items():
        _write(df, out_dir / f"{name}.parquet")
    manifest = {
        "built_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "cities": cities, "openaq_requested": [str(start), str(end)],
        "openaq_data_end": str(data_end), "not_yet_published": [str(d) for d in pending],
        "rules": {"valid_hour_fraction": C.MIN_VALID_READING_FRACTION_PER_HOUR,
                  "valid_day_hours": C.MIN_VALID_HOURS_PER_DAY,
                  "city_min_stations": "max(3, ceil(0.5 * primary stations))",
                  "invalid_values": f"<= {C.VALUE_MIN_EXCLUSIVE} or > {C.VALUE_MAX_INCLUSIVE}",
                  "flagged_kept": f"> {C.FLAG_HIGH}; flat-lines >= {C.FLATLINE_MIN_HOURS} h; isolated spikes",
                  "gap_rule": f"fraction of active primary sensors with any reading < {Q.GAP_FRACTION}",
                  "timestamps": "labels mark END of interval; hour = floor(ts - interval)",
                  "diwali": "AQI is the main comparison; PM rows are supporting/status only; no PM % change"},
        "rows": {k: int(len(v)) for k, v in outputs.items()},
        "other_sensor_rows_ignored": other,
        "delhi_panel": {k: len(v) for k, v in panels.items()},
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, indent=1))
    return manifest
