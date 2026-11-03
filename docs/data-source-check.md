# Data Source Check — OpenAQ (Day 1, part 2)

**Date:** 2026-11-03
**Session window:** 07:17:39 – 07:25:31 UTC (12:47:39 – 12:55:31 IST)
**Tooling:** `scripts/openaq_client.py` (httpx; key read from `.env`, sent only in the `X-API-Key` header, never logged)
**Requests used:** ~245 OpenAQ API requests (peak 24/60 in one minute; never hit 429), plus a few unauthenticated S3 archive requests.
**Raw probe outputs:** `data/raw/probe/` (gitignored)

Times below are IST, taken from the request log and file write times.

---

## Summary

| # | Fact from earlier research | Result |
|---|---|---|
| 1 | Limits 60/min and 2,000/hour; respect headers; retry on 429 | **Confirmed.** Headers show only the per-minute window. The 2,000/hour limit comes from the official docs. |
| 2 | `/countries?iso=IN` is ignored | **Confirmed.** It returns all 159 countries. India is `countries_id=9`. On `/locations`, both `countries_id=9` and `iso=IN` work. |
| 3 | `locality` may be missing | **Confirmed, and worse than expected.** 769 of 775 Indian locations have no locality. |
| 4 | CPCB feed stale after 2026-10-07 14:30 UTC | **Changed: it recovered.** There was a 4 h gap at that point. A newer **84 h feed-wide gap started 2026-10-23 14:30 UTC**. |
| 5 | Long requests may time out; use ≤30-day slices | **Not reproduced.** 30-day, 45-day and 90-day hourly requests took 1–4 s with no timeouts. We'll still use ≤30-day slices as a safety margin. |
| 6 | Use IST dates for daily averages | **Confirmed as necessary.** CPCB hourly periods start at `:30 UTC` (whole IST hours), and archive files are split by IST day. |
| — | **NEW: no data for Nov 2022 – Feb 2025** | Most CPCB stations have no data between ~Oct 2022 and 2025-02-18, in both the API and the S3 archive. **Diwali 2024 is effectively not covered for CPCB stations.** |
| — | **NEW: duplicate sensors per location** | Each location has an old sensor (ends 2022) and a new one (starts 2025-02-18) for the same pollutant. You have to pick sensors by their own date range. |
| — | **NEW: `/hours` overlapping windows** | For some sensors, `/hours` returns overlapping 1-hour windows starting at both `:00` and `:30`, so a 744-hour window returned 918 rows. Data from it needs deduplicating. |
| — | **NEW: API `coverage` field unreliable** | One sensor reported `percentComplete = 934675`. We'll calculate coverage ourselves. |

---

## 1. API key and rate limits — 12:47 IST

- `GET /v3/countries?limit=200` → **200 OK**, 1.58 s, so the key works.
- Headers: `x-ratelimit-limit: 60`, `x-ratelimit-used: 1`, `x-ratelimit-remaining: 59`, `x-ratelimit-reset: 60` (seconds until reset).
- Official docs (docs.openaq.org/using-the-api/rate-limits, read 12:55 IST): **60 requests/minute and 2,000/hour** per API key. Exceeding them returns **429**, and repeated abuse can lead to a temporary or permanent ban. Only the minute window appears in the headers, so **the client must count hourly usage itself.**

## 2. India filter — 12:47 IST

- `/countries?iso=IN` → `found: 159`. The first results were ID, MY, CL, BO and PE, so **the filter is ignored.**
- India's country record: `id 9`, `code IN`, `datetimeFirst 2016-01-30`, `datetimeLast 2026-11-03T06:30Z`.
- `/locations?countries_id=9` → **775 locations**, all `country.code == IN`.
- `/locations?iso=IN` → also 775. On this endpoint the `iso` filter *does* work.
- Validation: all 775 have coordinates inside India's bounding box (lat 6–37.5, lon 68–97.5). 0 rejected.
- **Decision:** use `countries_id=9` and still validate country code and coordinates on every location.

## 3. Providers returning Indian data — 12:48 IST

Newest `datetimeLast` per provider, from location metadata:

| Provider | Locations | Newest reading (UTC) | Updated in last 48 h |
|---|---:|---|---:|
| CPCB | 576 | 2026-11-03 04:30 | 482 |
| caaqm | 76 | 2022-10-31 02:00 | 0 (retired) |
| AirGradient (low-cost) | 57 | 2026-11-03 06:00 | 37 |
| N/A (provider not named) | 48 | 2026-11-03 04:30 | 45 |
| AirNow (US embassy/consulates) | 4 | 2026-11-03 06:30 | 2 |
| Clarity (low-cost) | 1 | 2026-11-03 04:50 | 1 |
| Clean Air Catalyst | 3 | 2024-06-30 | 0 |
| StateAir Kolkata | 2 | 2025-03-04 | 0 |
| data.gov.in | 2 | 2022-03-24 | 0 |
| StateAir Hyderabad / Chennai / NewDelhi | 1 each | 2016-11-09 | 0 |
| SPARTAN / Spartan / HabitatMap | 1 each | 2019 or none | 0 |

`isMonitor` (reference-grade): 643 true, 132 false. The 48 "N/A" locations are current, but their source isn't identified yet, so they need checking before any are used.

## 4. CPCB feed recovery — 12:48–12:50 IST

- Metadata: 501 CPCB locations have `datetimeLast` after 2026-10-07 14:30 UTC, and 472 updated on 2026-11-03.
- Hourly data, 2026-10-04 → 2026-11-03, for Mandir Marg, Delhi (sensor 12234778) and Royapuram, Chennai (sensor 12236299):

| Gap start (UTC) | Length | Delhi | Chennai |
|---|---|:-:|:-:|
| 2026-10-04 11:30 | 10 h | ✓ | ✓ |
| **2026-10-07 13:30** | **4 h** | ✓ | ✓ |
| 2026-10-11 07:30 | 23 h | ✓ | — |
| 2026-10-18 07:30 | 10 h | ✓ | ✓ |
| **2026-10-23 14:30** | **84 h** | ✓ | ✓ |

- Hours present on 6–9 Oct: 93/96 at both stations.
- Coverage over the 30 days: Delhi 594/720 h (82.5%), Chennai 616/720 h (85.6%).
- **Conclusion:** the 7 Oct outage lasted about 4 h and CPCB has since recovered. Gaps that appear at the same times in two cities are **feed-wide outages**, not station faults. The feed is usable but has gaps, so coverage must always be reported.

## 5. Locations near the six cities — 12:48–12:53 IST

Haversine distance from the city centre. Counts are for locations within 25 km (40 km in brackets) that report **both PM2.5 and PM10**:

| City | Total ≤25 km | Both PM | Reference with both | Reference fresh now | Low-cost |
|---|---:|---:|---:|---:|---:|
| Delhi | 97 (116) | 83 (100) | 74 (87) | 48 (60) | 16 |
| Mumbai | 44 (53) | 42 (51) | 40 (46) | 29 (34) | 3 |
| Kolkata | 19 (19) | 17 | 14 | 11 | 3 |
| Chennai | 11 (14) | 7 (10) | 7 (10) | 7 | 0 |
| Bengaluru | 26 (28) | 14 (16) | 11 (12) | 7 | 8 |
| Hyderabad | 14 (19) | 9 (14) | 9 (14) | 8 (11) | 1 |

**Sensor date-range survey.** 209 `/locations/{id}/sensors` calls checked whether any PM sensor's date range overlaps each window. Counts are reference monitors only:

| City | PM2.5 Diwali 2024 | PM2.5 Diwali 2025 | PM2.5 now | PM10 Diwali 2024 | PM10 Diwali 2025 |
|---|---:|---:|---:|---:|---:|
| Delhi | 1 | 49 | 49 | 0 | 48 |
| Mumbai | 1 | 34 | 30 | 0 | 33 |
| Kolkata | 1 | 11 | 11 | 0 | 11 |
| Chennai | 1 | 8 | 7 | 0 | 7 |
| Bengaluru | 0 | 10 | 7 | 0 | 12 |
| Hyderabad | 1 | 11 | 9 | 0 | 9 |

The only stations with PM2.5 data in the Diwali 2024 window (15 Oct – 15 Nov 2024):

| City | Station | Provider | Type | Sensor range |
|---|---|---|---|---|
| Delhi | New Delhi (US Embassy) | AirNow | reference | 2016 → now |
| Delhi | GK1 (Oberoi Terrace) | AirGradient | low-cost | 2024-05 → now |
| Mumbai | Mumbai (US Consulate) | AirNow | reference | 2016 → now |
| Kolkata | US Diplomatic Post: Kolkata | StateAir | reference | 2022-10 → **2025-03** |
| Chennai | Chennai (US Consulate) | AirNow | reference | 2022-10 → **2026-10-15** |
| Bengaluru | SiriJaya | AirGradient | low-cost | 2024-03 → **2025-05** |
| Hyderabad | Hyderabad (US Consulate) | AirNow | reference | 2016 → **2026-04-06** |

None of them report PM10, and none covers all of 2024, 2025 and 2026 in every city.

**Why sensors matter:** location 6358 (Mandir Marg) has pm25 sensor `17770` (2018-08-10 → 2022-10-31) **and** pm25 sensor `12234778` (2025-02-18 → now). Choosing by location or by parameter name alone picks the wrong one.

## 6. Slice size and reliability — 12:50–12:55 IST

| Request (Delhi pm25 12234778) | Rows | Pages | Time |
|---|---:|---:|---:|
| 30 days (2026-10-04 → 11-03) | 594 | 1 | 2.1 s |
| 90 days (2026-08-05 → 11-03) | 1,731 | 2 | 4.1 s |
| 45 days, Diwali 2025 window | 991 | 1 | 2.4 s |

No timeouts. We'll keep ≤30-day slices anyway, as a cheap safety margin.

**`/hours` overlap problem.** For sensors 23534, 23320 and 7951363 in Oct–Nov 2024, `/hours` returned 918 rows for a 744-hour window. Every row is a 1-hour period, but 711 start at `:30` and 207 at `:00`, so they overlap, and values repeat (85, 85, 72, 72 …). Mumbai's AirNow sensor also returned **NaN and negative values** (−15, −3).

**S3 archive check** (`openaq-data-archive`, public, no key):

| Location | 2022 | 2023 | 2024 | 2025 | 2026 |
|---|---|---|---|---|---|
| 6358 Mandir Marg | 125 files (Jan–Oct) | **0** | **0** | 315 (Feb–Dec) | 289 (Jan–Oct) |
| 11578 Royapuram | 118 files (Jan–Oct) | **0** | **0** | 276 (Feb–Dec) | 274 (Jan–Oct) |

Sample file `location-6358-20251020.csv.gz` (Diwali 2025): 4.5 KB, 802 rows. Columns: `location_id, sensors_id, location, datetime, lat, lon, parameter, units, value`.

- Timestamps are local IST (`+05:30`) at 15-minute intervals.
- 67 of 96 possible readings for each of PM2.5 and PM10.
- PM2.5 ranged from 78 to 643 µg/m³.
- The archive gives **raw readings with IST dates and no API rate limit**, but has the same 2023–2024 gap.

## Environment issue

Sophos SSL inspection caused one `CERTIFICATE_VERIFY_FAILED` error on S3. The next 4 retries all succeeded, so it's intermittent. Certificate verification was **not** disabled. The pipeline needs retry-on-connect-error. If failures become frequent, add `truststore` so Python uses the macOS keychain. That needs approval because it's a new dependency.

## Recommendation (for approval; stations not selected)

1. **Continue with OpenAQ**, using **the S3 archive for historical data** and the API for metadata (locations and sensors) and recent updates. The archive provides raw 15-minute IST readings, avoids the `/hours` overlap problem and doesn't count against the rate limit.
2. **Diwali comparisons need a revised plan**, because measured CPCB data for 2024 doesn't exist in OpenAQ:
   - Primary: **Diwali 2025 vs 2026**, measured with the same CPCB stations. 2026 data will arrive after 8 Nov.
   - 2024: either (a) use the US embassy/consulate PM2.5 monitors, which give one station per city, PM2.5 only, no Bengaluru reference monitor, and different stations from the CPCB set; or (b) use Open-Meteo **modelled** data, clearly labelled; or (c) say "no measured data".
   - A separate CPCB-portal fallback would be a bigger plan change and isn't recommended now.
3. Cleaning must handle duplicate sensors per location, overlapping hourly windows, NaN and negative values, and feed-wide outages. Calculate our own coverage.

---

# Part 2: Diwali 2024 sources and candidate stations

**Date:** 2026-11-03, about 07:30–08:15 UTC (13:00–13:45 IST)
**Approved before this step:** the archive-first approach (OpenAQ S3 archive for history; API for station discovery and recent data).
**No Groq or Gemini calls. No full-dataset download.** Small sample files were saved to `data/raw/probe/bulletins/` and `data/raw/probe/opencity/` (gitignored).

## A. Diwali dates (verified)

| Year | Main Diwali / Lakshmi Puja | Evidence | Notes |
|---|---|---|---|
| 2024 | **Thu 31 Oct 2024** | DoPT O.M. dated 03-07-2023 (central government holidays 2024): "Diwali (Deepavali) … Thursday, October 31, 2024". Most state holiday notices (TN, KA, TS, AP and others) give 31 Oct. | Drik Panchang lists Lakshmi Puja in New Delhi on **Fri 1 Nov 2024**, and Haryana declared 1 Nov. Celebrations ran across **both nights**, so the analysis window must include 31 Oct and 1 Nov. |
| 2025 | **Mon 20 Oct 2025** | DoPT O.M. dated 09-07-2024: "Monday, October 20, 2025". Drik Panchang (New Delhi): Lakshmi Puja Mon 20 Oct 2025. | Some outlets suggested 21 Oct. The official sources say 20 Oct. |
| 2026 | **Sun 8 Nov 2026** | DoPT O.M. dated 03-07-2025, as reported by several sites. I didn't open the official PDF. | Some states observe Naraka Chaturdashi a day earlier (7 Nov). |

DoPT memos also note that "in certain States" Diwali is observed a day earlier, on Naraka Chaturdashi, which matters for Chennai.

Sources: [DoPT 2024 list (staffnews)](https://www.staffnews.in/2023/07/list-of-holidays-2024-dopt-order-reg-gazetted-and-restricted-holidays.html), [DoPT 2025 list (staffnews)](https://www.staffnews.in/2024/07/holidays-to-be-observed-in-central-government-offices-year-2025.html), [DoPT 2026 list (staffnews)](https://www.staffnews.in/2025/07/list-of-holidays-2026-dopt-order-reg-closed-and-restricted-holidays.html), [Drik Panchang 2024](https://www.drikpanchang.com/festivals/lakshmipuja/festivals-lakshmipuja-timings.html?year=2024), [Drik Panchang 2025](https://www.drikpanchang.com/festivals/lakshmipuja/festivals-lakshmipuja-timings.html?year=2025).

## B. CPCB daily AQI bulletins (UrbanEmissions `AQI_bulletins`)

| Field | Finding |
|---|---|
| Source | CPCB daily AQI bulletin PDFs ([cpcb.gov.in/AQI_Bulletin.php](https://cpcb.gov.in/AQI_Bulletin.php)), parsed by UrbanEmissions.info ([github.com/urbanemissionsinfo/AQI_bulletins](https://github.com/urbanemissionsinfo/AQI_bulletins)) |
| Repo status | Active: last push 2026-11-01 18:04 UTC |
| File checked | `data/Processed/aqi-bulletins.parquet` (1.9 MB): 543,294 rows, **2015-05-01 → 2026-10-25**, 329 cities |
| Columns | `date, city, no_stations, aqi_category, aqi, prominent_pollutant, year, month` |
| **Metric** | **City-level AQI (a unitless 0–500 index)**, not a concentration. It covers all measured pollutants, and the "prominent pollutant" is the one driving the AQI. |
| Averaging | From CPCB's own PDF (bulletin dated 2 Nov 2026): **"Air Quality Index on Nov 02, 2026 @ 4 PM (Average of past 24 hours)"**. **Diwali-night pollution appears in the D+1 bulletin.** |
| City value | CPCB note: "In case of a city with multiple monitoring locations, average value is used… averaging is not a scientifically sound approach." Cities can be dropped "due to insufficient data". |
| Licence | Repo code: **GPL-3.0**. Dataset `metadata.json`: **GODL** (Government Open Data License – India), source CPCB. The CPCB PDF asks users to "duly acknowledge the contribution of respective agencies". |
| City names | Exact matches for Delhi, Mumbai, Kolkata, Chennai, Bengaluru and Hyderabad. Navi Mumbai is a separate city. |

**Coverage around Diwali** (window D−14 … D+7 = 22 days):

| City | 2024 days | 2024 stations | 2025 days | 2025 stations |
|---|---:|---|---:|---|
| Delhi | 22/22 | 31–40 | 22/22 | 35–39 |
| Mumbai | 22/22 | 21–25 | 22/22 | 19–28 |
| Kolkata | 22/22 | 6–7 | 22/22 | 5–7 |
| Chennai | 22/22 | 6–8 | 22/22 | 4–8 |
| Bengaluru | 22/22 | 9–13 | 22/22 | 7–14 |
| Hyderabad | 22/22 | 9–14 | 22/22 | 10–14 |

There are no duplicate city-days, and `no_stations == 0` occurred in 0% of rows for these cities from 2016 to 2026.

**Limitations:** AQI is not PM2.5 and must never be presented as PM2.5. There's one value per city per day, with no station or hourly detail, and the 4 PM-to-4 PM window doesn't match a calendar day. Which stations are averaged changes from day to day. The parquet currently stops at 2026-10-25, so Diwali 2026 (8 Nov) will need a later repo update or the CPCB PDFs.

## C. OpenCity: Delhi CPCB station files

| Field | Finding |
|---|---|
| Source | [data.opencity.in/dataset/delhi-hourly-air-quality-reports](https://data.opencity.in/dataset/delhi-hourly-air-quality-reports); organisation listed as CPCB; the ITO resource names the CPCB CAAQM repository as its source |
| Licence | Catalogue: "Other (Public Domain)" (`other-pd`) |
| Contents | 78 CSV resources: 39 Delhi stations × (2017–2023 hourly, **2024–25 at 15 minutes**). Metadata last modified 2026-01-15. |
| **Delhi only** | No files for the other five cities |
| File checked | Mandir Marg DPCC 2024–25 (11.9 MB): 70,177 rows, 2024-01-01 00:00 → 2025-12-31 23:45, 15-minute steps. Columns include `PM2.5 (µg/m³)`, `PM10 (µg/m³)` and weather (AT, RH, WS, WD, RF). |
| Metric / units | **Measured concentration, µg/m³**: the same metric as OpenAQ |
| Diwali 2024 window (17 Oct – 7 Nov) | 2,112/2,112 time slots present; **PM2.5 non-null 1,850 (88%)**, **PM10 1,956 (93%)** |
| Values | PM2.5 1–996, PM10 2–998; 0 values ≤ 0. Values ≥ 990 (4 each) may be the monitor's upper limit and need flagging. |
| **Timezone** | Timestamps are labelled `+0000`, but **they are IST**. Matched against the OpenAQ archive (IST) for 2025-10-20: **67/67 readings identical, correlation 1.000, at 0 h shift**; 0% identical at ±5.5 h. **Treat OpenCity times as IST and ignore the `+0000` label.** |
| Same source as OpenAQ? | **Yes**: identical values show they come from the same CPCB feed |

Sample daily means at Mandir Marg (IST days, simple mean of 15-minute values, for inspection only):

| Date | PM2.5 | n | PM10 | n |
|---|---:|---:|---:|---:|
| 2024-10-29 | 118.7 | 83 | 170.6 | 91 |
| 2024-10-30 | 153.9 | 89 | 213.0 | 96 |
| 2024-10-31 (Diwali) | 209.1 | 87 | 264.4 | 96 |
| 2024-11-01 | 217.5 | 88 | 265.9 | 88 |
| 2024-11-02 | 222.4 | 95 | 271.9 | 96 |

**Limitations:** Delhi only. The timezone label is wrong. Only one of 39 files was checked, so others may have different gaps. Metadata text says "2017–2023" while file names say 2024–25.

## D. US embassy / consulate monitors (AirNow / StateAir)

These were already checked in Part 1. Each city has one station, **PM2.5 only**, measured with a reference-grade monitor. Coverage: New Delhi and Mumbai are current; Chennai stopped 2026-10-15, Hyderabad 2026-04-06 and Kolkata 2025-03-04. Bengaluru has none. Mumbai returned NaN and negative values. **Use only as single-station supporting data.**

## E. Open-Meteo (not re-checked in this step)

This source is modelled (CAMS), about 45 km resolution, from Aug 2022, and may under-predict South Asian extremes. **Use for Diwali only as clearly labelled modelled context, never as primary evidence.** It hasn't been tested yet; that's scheduled for the pipeline step.

## F. Agreed source rules (2026-11-03)

- AQI and PM2.5 are different metrics and are never interchangeable or shown on the same axis without saying so.
- Bulletin data is shown as **official measured AQI (city average, 24 h to 4 PM)**.
- US embassy data is **supporting, single-station** only.
- Open-Meteo for Diwali is **modelled context** only.
- Measured Diwali 2025 vs 2026 runs after 8 Nov **only if coverage is sufficient**.
- If there is no measured data for a period, the app says so.

## G. Candidate stations (status: candidate, not final)

Script: `scripts/select_candidates.py` → `data/processed/station_candidates.json`. Each entry stores its coordinates, location last-updated time, the chosen PM2.5/PM10 sensor IDs **with that sensor's own first and last dates**, and the older sensors.

**Rules applied:**
- Within 25 km of the centre **and** the station name names the target city.
- Reference monitors only for "primary". The primary sensor must start ≤ 2025-10-05 and still report ≥ 2026-10-25.
- Low-cost sensors are a separate tier.
- "N/A" provider is excluded.
- US monitors are a separate supporting tier.

**25 km mixing check:** without the name rule, the 25 km circle would have pulled in 16 Delhi-area stations from Noida, Ghaziabad, Gurugram, Faridabad and Khora/Loni (UPPCB/HSPCB), 11 Mumbai-area stations from Navi Mumbai, Thane and Mira-Bhayandar, and 5 Howrah stations into Kolkata. All are excluded now.

| City | Primary (reference, PM2.5 + PM10) | Partial | US supporting | Low-cost | Excluded | CPCB bulletin station count, Oct 2025 |
|---|---:|---:|---:|---:|---:|---|
| Delhi | **37** | 25 (all retired pre-gap records) | 2 (1 current) | 5 | 26 | 35–39 |
| Mumbai | **22** | 7 (4 retired, 3 stopped in 2026) | 1 | 1 | 13 | 19–28 |
| Kolkata | **7** | 2 (retired) | 2 (0 current) | 1 | 7 | 5–7 |
| Chennai | **6** | 1 (PM10 stopped 2026-10-21) | 2 (0 current) | 0 | 2 | 4–8 |
| Bengaluru | **6** | 10 (4 retired, 4 stopped, 2 no PM2.5) | 0 | 8 | 2 | 7–14 |
| Hyderabad | **9** | 2 (1 retired, 1 no PM10) | 2 (0 current) | 1 | 0 | 10–14 |

The primary counts are close to the number of stations CPCB uses in its own city bulletins, which is a useful check. Every primary sensor starts on or after 2025-02-18, so **none spans the 2022–2025 gap**.

**Open questions:**
- Four CPCB-provider sites flagged `isMonitor=false` (New Moti Bagh MHUA, BKC IITM, BWSSB Kadabesanahalli, Jigani) are kept in the low-cost tier until their type is verified.
- The 8 "N/A" Delhi-area locations have DPCC/IITM-style names but are unverified.
- Bengaluru has only 6 primary stations, with 4 stopping during 2026. Watch coverage.

## H. Data design decisions (agreed)

1. **Archive first:** raw 15-minute readings from the OpenAQ S3 archive. The API is only for discovery, metadata and recent top-ups.
2. **No overlapping hourly windows** in any average. If API `/hours` data is used, keep only IST-aligned (`:30 UTC`) periods and deduplicate by `(sensor, period start)`.
3. **Coverage is calculated by us:** valid readings ÷ expected readings, per sensor-day and per city-day. The API `coverage` field is ignored.
4. **No continuity across the gap:** 2022-11-01 → 2025-02-18 is a hard gap. Old and new sensors are never stitched into one series.
5. **Hourly API budget:** the client counts requests in a rolling 60-minute window, stays under 2,000/h with a margin, honours `x-ratelimit-*` headers and backs off on 429.
6. **Outages:** feed-wide gaps (the same gap at several stations) are recorded as outages and shown as "no data", never filled in.
7. **OpenCity (if used for Delhi 2024):** treat timestamps as IST, flag values ≥ 990, and label it "CPCB via OpenCity". It only covers Delhi.
8. **Network:** Sophos HTTPS inspection intermittently breaks Python TLS. Use retries now. A trust-store fix (`truststore`) needs approval.
