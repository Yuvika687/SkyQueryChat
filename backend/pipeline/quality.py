"""Network-wide data-quality detection.

A network-wide gap hour is an IST hour in which fewer than GAP_FRACTION of the stations
that SHOULD be reporting (sensor's own first..last dates cover the hour) have ANY reading.
Contiguous gap hours are merged into runs. A local date with >= 1 gap hour is low quality
for comparisons, even if individual stations still reach 16 valid hours.
"""
from __future__ import annotations

import pandas as pd

GAP_FRACTION = 0.5
MIN_ACTIVE = 3


def network_coverage(hourly: pd.DataFrame, active: pd.DataFrame, start: pd.Timestamp,
                     end: pd.Timestamp) -> pd.DataFrame:
    """hourly: rows with sensor_key, hour (IST) — any row means the sensor reported that hour.
    active: sensor_key, first, last (IST timestamps) of each sensor in the network.
    Returns one row per hour in [start, end): n_active, n_reporting, fraction."""
    hours = pd.date_range(start, end, freq="h", inclusive="left")
    act = pd.Series(0, index=hours)
    for _, a in active.iterrows():
        lo, hi = max(a["first"], start), min(a["last"], end)
        if lo < hi:
            act[(hours >= lo.floor("h")) & (hours <= hi.floor("h"))] += 1
    keys = set(active["sensor_key"])
    rep = (hourly[hourly["sensor_key"].isin(keys)]
           .drop_duplicates(["sensor_key", "hour"]).groupby("hour").size()
           .reindex(hours, fill_value=0))
    cov = pd.DataFrame({"hour": hours, "n_active": act.values, "n_reporting": rep.values})
    cov["fraction"] = cov["n_reporting"] / cov["n_active"].where(cov["n_active"] > 0)
    cov["is_gap"] = (cov["n_active"] >= MIN_ACTIVE) & (cov["fraction"] < GAP_FRACTION)
    return cov


def gap_runs(cov: pd.DataFrame) -> pd.DataFrame:
    """Merge contiguous gap hours into runs: gap_start, gap_end (exclusive), hours, min_fraction."""
    g = cov[cov["is_gap"]].sort_values("hour")
    if g.empty:
        return pd.DataFrame(columns=["gap_start", "gap_end", "hours", "min_fraction"])
    run_id = (g["hour"].diff() != pd.Timedelta(hours=1)).cumsum()
    r = g.groupby(run_id).agg(gap_start=("hour", "min"), last=("hour", "max"),
                              hours=("hour", "size"), min_fraction=("fraction", "min"))
    r["gap_end"] = r["last"] + pd.Timedelta(hours=1)
    return r[["gap_start", "gap_end", "hours", "min_fraction"]].reset_index(drop=True)


def date_quality(cov: pd.DataFrame) -> pd.DataFrame:
    """Per IST local date: number of gap hours and the low_quality flag."""
    c = cov.assign(local_date=cov["hour"].dt.date)
    d = c.groupby("local_date").agg(gap_hours=("is_gap", "sum"),
                                    min_fraction=("fraction", "min")).reset_index()
    d["gap_hours"] = d["gap_hours"].astype("int64")
    d["low_quality"] = d["gap_hours"] > 0
    return d


def recurring_gap_hours(cov: pd.DataFrame) -> pd.Series:
    """Share of days on which each IST hour-of-day is a network gap (finds repeated gaps)."""
    c = cov.assign(hod=cov["hour"].dt.hour)
    return c.groupby("hod")["is_gap"].mean()


# --------------------------------------------------------------------------- sensor faults
def flag_flatlines(hourly: pd.DataFrame, min_hours: int) -> pd.Series:
    """True for hours inside a run of >= min_hours CONSECUTIVE hours with an identical
    hourly value (rounded to 0.01) for the same sensor. Flag only, never delete."""
    h = hourly.sort_values(["source", "sensor_key", "hour"])
    v = h["value"].round(2)
    new_run = ((h["sensor_key"] != h["sensor_key"].shift()) | (h["source"] != h["source"].shift())
               | (v != v.shift()) | (h["hour"] - h["hour"].shift() != pd.Timedelta(hours=1)))
    run = new_run.cumsum()
    size = run.map(run.value_counts())
    return (size >= min_hours).reindex(hourly.index)


def flag_isolated_spikes(hourly: pd.DataFrame, peers: pd.DataFrame, min_peers: int, ratio: float,
                         min_excess: float, neighbour_ratio: float) -> pd.Series:
    """True where a sensor-hour is far above same-city reference peers at that hour AND its own
    previous/next hours are much lower. hourly needs columns source, sensor_key, pollutant, hour,
    value; peers maps sensor_key -> city for REFERENCE sensors (the comparison group)."""
    h = hourly.merge(peers, on="sensor_key", how="left")
    ref = h[h["city"].notna()]
    grp = ref.groupby(["source", "city", "pollutant", "hour"])["value"]
    stats = pd.DataFrame({"n": grp.size(), "med": grp.median()}).reset_index()
    # peer median excluding self is approximated by the group median with >= min_peers+1 members
    x = hourly.merge(peers, on="sensor_key", how="left").merge(
        stats, on=["source", "city", "pollutant", "hour"], how="left")
    x.index = hourly.index
    srt = x.sort_values(["source", "sensor_key", "hour"])
    same = srt["sensor_key"].eq(srt["sensor_key"].shift())
    prev = srt["value"].shift().where(same & (srt["hour"] - srt["hour"].shift() == pd.Timedelta(hours=1)))
    same_n = srt["sensor_key"].eq(srt["sensor_key"].shift(-1))
    nxt = srt["value"].shift(-1).where(same_n & (srt["hour"].shift(-1) - srt["hour"] == pd.Timedelta(hours=1)))
    isolated = (prev.isna() | (prev <= neighbour_ratio * srt["value"])) & \
               (nxt.isna() | (nxt <= neighbour_ratio * srt["value"])) & (prev.notna() | nxt.notna())
    far = (srt["n"] >= min_peers + 1) & (srt["value"] > ratio * srt["med"]) & \
          (srt["value"] > srt["med"] + min_excess)
    return (far & isolated).reindex(hourly.index).fillna(False).astype(bool)


def publication_tail(presence: pd.DataFrame, min_share: float = 0.5):
    """presence: local_date, share of locations with an archive file that day.
    Returns the last date with share >= min_share (later dates = not yet published)."""
    ok = presence[presence["share"] >= min_share]
    return None if ok.empty else max(ok["local_date"])
