"""Daily data refresh: run the existing pipeline end to end, then check the result before anything is published.

  python scripts/refresh_data.py            # build -> weather -> app tables -> CPCB cross-check -> checks
  python scripts/refresh_data.py --full     # same, but rebuild all history from local raw files (needs data/raw)

Steps (each is the existing script, unchanged rules):
  1. scripts/build_dataset.py --incremental --api-topup
                                           Incremental: continues from the committed data/processed tables and
                                           downloads only the days from their OpenAQ archive end (never the full
                                           history). OpenAQ archive (+ API top-up for days the archive has not
                                           published), CPCB bulletins (UrbanEmissions, then CPCB's own PDFs), all
                                           cleaning, validity, fault-flag and gap rules -> data/processed
  2. scripts/fetch_weather.py --append     Open-Meteo weather, new days only -> data/processed
  3. scripts/derive_app_tables.py          compact app tables -> data/app
  4. scripts/crosscheck_bulletins.py       CPCB cross-check figures -> docs/crosscheck_bulletins.json
One unreachable source does not stop the others: OpenAQ or the CPCB bulletins keep their previous data (the build
reports it in manifest["sources"]), and a failed weather step keeps the stored weather. Every source is reported with
its data end before and after, as GitHub warnings and in the run summary.
Checks (any failure exits non-zero, so the workflow commits nothing and the site keeps the last good data):
  * the data end dates never move backwards;
  * values already published do not change (city PM up to the archive end of the previous build, every earlier
    official AQI bulletin and every earlier weather day);
  * data/app stays small enough for Render's free instance (see SIZE_LIMIT_MB).
Writes `data_end=<yyyy-mm-dd>` and `changed=true|false` to $GITHUB_OUTPUT when it is set.
The OpenAQ API key is read from the environment (OPENAQ_API_KEY) and never printed.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import time
from datetime import date
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[1]
APP = ROOT / "data" / "app"
PY = sys.executable
# data/app is 3.3 MB today (about 60 MB in memory; the server peaks near 305 MiB of Render's 512 MB). It grows by
# roughly 2 KB a day. Above this size the refresh stops and asks for a decision (for example a rolling window).
SIZE_LIMIT_MB = 8.0


def _ends(app: Path) -> dict:
    m = json.loads((app / "manifest.json").read_text())
    w = pd.read_parquet(app / "weather_daily.parquet", columns=["local_date"])
    return {"measured": m["openaq_data_end"], "archive": m.get("openaq_archive_end") or m["openaq_data_end"],
            "aqi": (m.get("bulletins") or {}).get("end"), "weather": str(pd.to_datetime(w["local_date"]).max().date())}


def _snapshot(app: Path) -> dict[str, pd.DataFrame]:
    cd = pd.read_parquet(app / "city_daily.parquet", columns=["city", "pollutant", "local_date", "city_mean", "meets_rule"])
    aqi = pd.read_parquet(app / "city_daily_aqi.parquet", columns=["city", "bulletin_date", "aqi", "aqi_category"])
    w = pd.read_parquet(app / "weather_daily.parquet")
    for df, col in ((cd, "local_date"), (aqi, "bulletin_date"), (w, "local_date")):
        df[col] = pd.to_datetime(df[col]).dt.date
    return {"city_daily": cd, "aqi": aqi, "weather": w}


def _unchanged(old: pd.DataFrame, new: pd.DataFrame, keys: list[str], cols: list[str], upto: date, col: str) -> int:
    """Rows on or before `upto` whose values differ (or disappeared) in the new table."""
    o = old[old[col] <= upto].set_index(keys)[cols]
    n = new.set_index(keys)[cols].reindex(o.index)
    diff = ~((o == n) | (o.isna() & n.isna())).all(axis=1)
    return int(diff.sum())


def _run(args: list[str]) -> None:
    t = time.time()
    print(f"\n$ {' '.join(args)}", flush=True)
    subprocess.run([PY, *args], cwd=ROOT, check=True)
    print(f"  ok in {time.time() - t:.0f}s", flush=True)


SOURCE_NAMES = {"openaq": ("Measured PM (OpenAQ)", "measured"), "cpcb_bulletins": ("Official AQI (CPCB bulletins)", "aqi"),
                "weather": ("Weather (Open-Meteo)", "weather")}


def report(before: dict, after: dict, statuses: dict) -> tuple[list[str], list[str]]:
    """(lines, warnings): each source's data end before -> after and whether it was updated."""
    lines, warnings = [], []
    for key, (name, end_key) in SOURCE_NAMES.items():
        status = statuses.get(key, "updated")
        b, a = before.get(end_key), after.get(end_key)
        moved = f"{b} -> {a}" if a != b else f"{a} (no new days)"
        lines.append(f"{name}: {moved}; {status}")
        if not status.startswith("updated"):
            warnings.append(f"{name} was not updated: {status}. Its previous data is kept.")
    return lines, warnings


def check(before_ends: dict, before: dict, app: Path = APP) -> tuple[dict, list[str]]:
    after_ends, after = _ends(app), _snapshot(app)
    problems = []
    for k in ("measured", "aqi", "weather"):
        if before_ends[k] and after_ends[k] and after_ends[k] < before_ends[k]:
            problems.append(f"{k} data end moved backwards: {before_ends[k]} -> {after_ends[k]}")
    # API top-up days may be replaced by archive files, so city PM is compared up to the previous archive end
    n = _unchanged(before["city_daily"], after["city_daily"], ["city", "pollutant", "local_date"], ["city_mean", "meets_rule"],
                   date.fromisoformat(before_ends["archive"]), "local_date")
    if n:
        problems.append(f"{n} published city PM values changed")
    if before_ends["aqi"]:
        n = _unchanged(before["aqi"], after["aqi"], ["city", "bulletin_date"], ["aqi", "aqi_category"],
                       date.fromisoformat(before_ends["aqi"]), "bulletin_date")
        if n:
            problems.append(f"{n} published official AQI values changed")
    wcols = [c for c in before["weather"].columns if c not in ("city", "local_date") and c in after["weather"].columns]
    n = _unchanged(before["weather"], after["weather"], ["city", "local_date"], wcols,
                   date.fromisoformat(before_ends["weather"]), "local_date")
    if n:
        problems.append(f"{n} published weather values changed")
    size = sum(p.stat().st_size for p in app.glob("*") if p.is_file()) / 1e6
    if size > SIZE_LIMIT_MB:
        problems.append(f"data/app is {size:.1f} MB, above the {SIZE_LIMIT_MB} MB limit: decide on a rolling window first")
    print(f"\ndata/app: {size:.2f} MB; ends {after_ends}", flush=True)
    return after_ends, problems


def _changed() -> bool:
    r = subprocess.run(["git", "status", "--porcelain", "--", "data/app", "data/processed", "docs/crosscheck_bulletins.json"],
                       cwd=ROOT, capture_output=True, text=True, check=True)
    return bool(r.stdout.strip())


def main() -> int:
    if not os.getenv("OPENAQ_API_KEY", "").strip():
        from dotenv import load_dotenv                  # local runs: the key lives in .env (never printed)
        load_dotenv(ROOT / ".env")
    t0 = time.time()
    before_ends, before = _ends(APP), _snapshot(APP)
    print(f"before: {before_ends}", flush=True)
    full = "--full" in sys.argv[1:]
    _run(["scripts/build_dataset.py", "--api-topup"] + ([] if full else ["--incremental"]))
    statuses = dict(json.loads((ROOT / "data" / "processed" / "manifest.json").read_text()).get("sources") or {})
    try:
        _run(["scripts/fetch_weather.py", "--append"])
    except subprocess.CalledProcessError:   # the stored weather file is only replaced after a successful fetch
        statuses["weather"] = "not updated (the Open-Meteo step failed; see the log above)"
    _run(["scripts/derive_app_tables.py"])
    _run(["scripts/crosscheck_bulletins.py"])
    after_ends, problems = check(before_ends, before)
    lines, warnings = report(before_ends, after_ends, statuses)
    print("\nSOURCES:\n  " + "\n  ".join(lines), flush=True)
    for w in warnings:
        print(f"::warning title=Data source not updated::{w}", flush=True)
    summary = os.getenv("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a") as f:
            f.write("### Data refresh\n\n" + "".join(f"- {x}\n" for x in lines)
                    + "".join(f"- ⚠️ {x}\n" for x in warnings + problems))
    if problems:
        print("\nREFRESH CHECKS FAILED:\n  " + "\n  ".join(problems), flush=True)
        return 1
    changed = _changed()
    print(f"\nchecks passed in {time.time() - t0:.0f}s; data changed: {changed}; "
          f"measured data now ends {after_ends['measured']}", flush=True)
    out = os.getenv("GITHUB_OUTPUT")
    if out:
        with open(out, "a") as f:
            f.write(f"data_end={after_ends['measured']}\nchanged={'true' if changed else 'false'}\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
