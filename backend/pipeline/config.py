"""Fixed settings for the data pipeline. Change only with evidence (see docs/data-source-check.md)."""
from __future__ import annotations

import json
from datetime import date, timedelta
from pathlib import Path
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[2]
RAW = ROOT / "data" / "raw"
PROCESSED = ROOT / "data" / "processed"
IST = ZoneInfo("Asia/Kolkata")

POLLUTANTS = ("pm25", "pm10")
UNITS = "µg/m³"

# Hard gap in OpenAQ API + archive for CPCB stations: never treat as continuous.
GAP_START, GAP_END = date(2022, 11, 1), date(2025, 2, 18)

# Validity rules
MIN_VALID_READING_FRACTION_PER_HOUR = 0.75   # e.g. >= 3 of 4 quarter-hour readings
MIN_VALID_HOURS_PER_DAY = 16                 # station-day is valid with >= 16 valid hours
VALUE_MIN_EXCLUSIVE = 0.0                    # values <= 0 are invalid (PM cannot be zero/negative)
VALUE_MAX_INCLUSIVE = 5000.0                 # values > 5000 µg/m³ are physically implausible -> invalid
FLAG_HIGH = 1000.0                           # values > 1000 µg/m³ are KEPT and flagged (real Diwali peaks)
OPENCITY_LIMIT = 999.0                       # OpenCity blanks every value above this

# Sensor-fault flags (flag for review, never delete)
FLATLINE_MIN_HOURS = 6        # >= 6 consecutive hours with an identical hourly value
SPIKE_MIN_PEERS = 3           # need >= 3 other same-city reference sensors that hour
SPIKE_RATIO = 3.0             # value > 3x the peer median ...
SPIKE_MIN_EXCESS = 250.0      # ... and > peer median + 250 µg/m³ ...
SPIKE_NEIGHBOUR_RATIO = 0.5   # ... and the sensor's own previous and next hours are <= 50% of it

# City value rule: equal-weight mean of valid station-days, requiring
# at least max(3, ceil(50% of the city's primary stations)) valid stations.
CITY_MIN_STATIONS_ABS = 3
CITY_MIN_STATIONS_FRACTION = 0.5

EVENTS = json.loads((ROOT / "backend" / "config" / "events.json").read_text())


def diwali_date(year: int) -> date:
    return date.fromisoformat(EVENTS["diwali"][str(year)]["date"])


def festival_days(year: int) -> list[date]:
    d = diwali_date(year)
    return [d, d + timedelta(days=1)]


def baseline_days(year: int) -> list[date]:
    d = diwali_date(year)
    return [d - timedelta(days=k) for k in range(14, 7, -1)]


def bulletin_dates_for(local_days: list[date]) -> list[date]:
    """Bulletin dated X covers 16:00 IST X-1 -> 16:00 IST X, so the evening/night of
    local day L is reported in the bulletin dated L+1."""
    return [d + timedelta(days=1) for d in local_days]

# City centres (same as scripts/select_candidates.py)
CITY_CENTRES = {
    "Delhi": (28.6139, 77.2090), "Mumbai": (19.0760, 72.8777), "Kolkata": (22.5726, 88.3639),
    "Chennai": (13.0827, 80.2707), "Bengaluru": (12.9716, 77.5946), "Hyderabad": (17.3850, 78.4867),
}
CITIES = list(CITY_CENTRES)
