"""Select CANDIDATE stations for the six cities from saved OpenAQ probe outputs.

Inputs (from the Day-1 probe, in gitignored data/raw/probe/):
  india_locations.json  - all OpenAQ locations with countries_id=9
  sensor_survey.json    - per-location PM sensors with their OWN first/last dates

Output: data/processed/station_candidates.json (status = "candidate", not final)

Rules:
  * Within RADIUS_KM of the city centre AND the station name names the target city
    (stops Noida/Ghaziabad/Gurugram/Faridabad -> Delhi, Navi Mumbai/Thane -> Mumbai,
    Howrah -> Kolkata).
  * Sensors chosen by their own first/last dates, never by location dates.
  * Reference (isMonitor) and low-cost sensors are kept in separate tiers.
  * Locations with no provider name ("N/A") are excluded as unverified.
  * US embassy/consulate monitors are "supporting_single_station" only.
"""
from __future__ import annotations

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PROBE = ROOT / "data" / "raw" / "probe"
OUT = ROOT / "data" / "processed" / "station_candidates.json"

RADIUS_KM = 25
CITIES = {
    "Delhi":     {"centre": (28.6139, 77.2090), "names": ["delhi"]},
    "Mumbai":    {"centre": (19.0760, 72.8777), "names": ["mumbai"]},
    "Kolkata":   {"centre": (22.5726, 88.3639), "names": ["kolkata"]},
    "Chennai":   {"centre": (13.0827, 80.2707), "names": ["chennai"]},
    "Bengaluru": {"centre": (12.9716, 77.5946), "names": ["bengaluru", "bangalore"]},
    "Hyderabad": {"centre": (17.3850, 78.4867), "names": ["hyderabad", "secunderabad"]},
}
# Neighbouring cities that CPCB reports separately; their names disqualify a station.
OTHER_CITIES = r"noida|ghaziabad|gurugram|gurgaon|faridabad|khora|loni|navi mumbai|thane|kalyan|howrah"
SUPPORTING_PROVIDERS = {"AirNow", "StateAir Kolkata", "StateAir Hyderabad", "StateAir Chennai", "StateAir NewDelhi"}

# Windows a primary sensor must cover (by its own first/last dates).
NEED_FIRST_BEFORE = "2025-10-05"   # covers Diwali-2025 baseline (Diwali 2025 = 20 Oct)
NEED_LAST_AFTER = "2026-10-25"     # currently reporting
GAP = ("2022-11-01", "2025-02-18")  # known OpenAQ/archive gap; never treated as continuous


def name_city_ok(name: str, city: str) -> tuple[bool, str]:
    n = name.lower()
    if re.search(OTHER_CITIES, n):
        return False, "name places it in a neighbouring city"
    if any(k in n for k in CITIES[city]["names"]):
        return True, ""
    return False, "name does not mention the target city"


def partial_reason(sensors: dict) -> str:
    """Explain, per pollutant, why a reference station is not primary."""
    parts = []
    for p, s in sensors.items():
        if s is None:
            parts.append(f"no {p} sensor")
        elif s["last"][:10] < GAP[0]:
            parts.append(f"{p} retired before the 2022-25 gap (last {s['last'][:10]})")
        elif s["last"][:10] < NEED_LAST_AFTER:
            parts.append(f"{p} stopped reporting {s['last'][:10]}")
        elif s["first"][:10] > NEED_FIRST_BEFORE:
            parts.append(f"{p} started {s['first'][:10]}, after Diwali-2025 baseline")
    return "; ".join(parts)


def pick_sensor(sensors: list[dict], param: str) -> dict | None:
    """Most recent sensor for this parameter, by its own last date."""
    cands = [s for s in sensors if s["param"] == param and s["last"]]
    return max(cands, key=lambda s: s["last"]) if cands else None


def main() -> None:
    locs = {x["id"]: x for x in json.loads((PROBE / "india_locations.json").read_text())}
    survey = json.loads((PROBE / "sensor_survey.json").read_text())

    result = {"status": "candidate", "radius_km": RADIUS_KM, "gap_not_continuous": GAP,
              "rules": __doc__.split("Rules:")[1].strip(), "cities": {}}
    for city, rows in survey.items():
        tiers = {"primary": [], "partial": [], "supporting_single_station": [], "low_cost": [], "excluded": []}
        for r in rows:
            loc = locs[r["id"]]
            base = {
                "location_id": r["id"], "name": r["name"], "provider": r["provider"],
                "is_reference": r["isMonitor"], "km_from_centre": r["km"],
                "lat": loc["coordinates"]["latitude"], "lon": loc["coordinates"]["longitude"],
                "location_last_utc": (loc.get("datetimeLast") or {}).get("utc"),
            }
            pm25, pm10 = pick_sensor(r["sensors"], "pm25"), pick_sensor(r["sensors"], "pm10")
            base["sensors"] = {p: ({"id": s["id"], "first": s["first"], "last": s["last"]} if s else None)
                               for p, s in (("pm25", pm25), ("pm10", pm10))}
            base["older_sensors"] = [s for s in r["sensors"] if s not in (pm25, pm10)]

            if r["provider"] == "N/A":
                tiers["excluded"].append({**base, "reason": "no provider name; unverified"}); continue
            if r["provider"] in SUPPORTING_PROVIDERS:
                tiers["supporting_single_station"].append(base); continue
            ok, why = name_city_ok(r["name"], city)
            if not r["isMonitor"]:
                # Low-cost sensors are kept separate, never mixed with reference data.
                # Many have no city in their name, so allow distance-only matching
                # unless the name points to a neighbouring city.
                if not ok and why.startswith("name places"):
                    tiers["excluded"].append({**base, "reason": why}); continue
                tiers["low_cost"].append({**base, "city_match": "name" if ok else "distance_only"}); continue
            if not ok:
                tiers["excluded"].append({**base, "reason": why}); continue
            if pm25 is None and pm10 is None:
                tiers["excluded"].append({**base, "reason": "no dated PM sensors"}); continue

            def covers(s):
                return s and s["first"][:10] <= NEED_FIRST_BEFORE and s["last"][:10] >= NEED_LAST_AFTER
            if covers(pm25) and covers(pm10):
                tiers["primary"].append(base)
            else:
                tiers["partial"].append({**base, "reason": partial_reason(base["sensors"])})
        for t in tiers.values():
            t.sort(key=lambda x: x["km_from_centre"])
        result["cities"][city] = tiers

    OUT.write_text(json.dumps(result, indent=1))
    print(f"wrote {OUT.relative_to(ROOT)}\n")
    print(f"{'city':10} {'primary':>7} {'partial':>7} {'support':>7} {'lowcost':>7} {'excluded':>8}")
    for city, t in result["cities"].items():
        print(f"{city:10} " + " ".join(f"{len(t[k]):>7}" for k in ("primary", "partial", "supporting_single_station", "low_cost")) + f" {len(t['excluded']):>8}")


if __name__ == "__main__":
    main()
