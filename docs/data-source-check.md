# Data Source Check — OpenAQ

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

---

# Part 3: Pre-download audit (2026-11-03, about 08:30–09:30 UTC)

**Approved before this step:** candidate stations (subject to this audit), `truststore` for local development only, and the Diwali 2024 plan (bulletin AQI for all six cities; Delhi measured PM from OpenCity 2024 + OpenAQ 2025).

**Status: STOPPED at check 3.** A check failed and a decision is needed. The full download was **not** started.

## Setup
- `truststore` 0.10.5 is in `requirements-dev.txt` only, not in `requirements.txt`. It's loaded optionally in `backend/pipeline/net.py`, and verification stays on (`CERT_REQUIRED`). Test: 11 of 12 TLS requests succeeded. One still failed because Sophos's CA isn't fully trusted even in the keychain, so retries remain necessary.
- `backend/config/events.json` holds the verified Diwali dates and the rule. Festival days are **D and D+1** (Delhi 2024 = 31 Oct + 1 Nov). Baseline is **D−14 … D−8**. Bulletins are aligned to **D+1 and D+2** for the festival and **D−13 … D−7** for the baseline, because the bulletin dated X covers 16:00 on X−1 to 16:00 on X.
- `backend/pipeline/transform.py` contains the readers, cleaning, hourly/daily aggregation, city rule and bulletin alignment. Tests are pending.

## Check 1: name-rule audit (PASS)

Every station inside 25 km that the name rule rejected was reviewed. All rejections are correct:

| City | Rejected | Why |
|---|---:|---|
| Delhi | 18 | 16 Noida/Ghaziabad/Gurugram/Faridabad (UPPCB/HSPCB/IMD), including 3 AirGradient; 2 old records with no PM dates ("Civil Lines", "IGI Airport") |
| Mumbai | 13 | Navi Mumbai (its name contains "Mumbai" but CPCB reports it separately), Thane, CBD Belapur, Mira-Bhayandar |
| Kolkata | 7 | 5 Howrah, Barrackpore, 1 old 2017 record (Victoria Memorial – WBSPCB) |
| Chennai | 2 | Old 2018 records ("IIT", "Alandur Bus Depot") |
| Bengaluru | 2 | Old 2018 records ("City Railway Station – KSPCB", "SaneguravaHalli – KSPCB") of stations already included under newer names. The "Bangalore"/"Blore" spellings were checked and none was wrongly rejected. |
| Hyderabad | 0 | — |

**Open question (not blocking):** some stations CPCB names after the city lie just **outside** 25 km:
- **Delhi:** Narela (25.5 km) and Najafgarh (27.3 km). Both are inside Delhi. OpenCity's 39 Delhi files are exactly our 37 plus these 2.
- **Hyderabad:** ICRISAT Patancheru and Ramachandrapuram (26.6 km), IDA Pashamylaram (32.8 km), IITH Kandi (44.3 km). These are industrial outskirts in Sangareddy district.

The approved 25 km rule is kept for now.

## Check 2: OpenCity timestamps and match with OpenAQ (PASS)

**8 Delhi stations × 8 dates in 2025** (Feb, Apr, Jun, Aug, Sep, 20 Oct, Nov, Dec) were compared at raw 15-minute level:
- **8,689 reading pairs, 100.00% identical at 0 shift** for every station and every date with data.
- **Validation note (added in Part 5):** this match test only compared readings present in *both* sources. It did **not** cover values above 999 µg/m³, because OpenCity blanks them (Part 4). The 100% match holds for values ≤ 999 only.
- ±15 min: 11–77% identical (CPCB repeats values within an hour). ±5.5 h: 0–4%.
- **The timestamps are IST and the station mapping is correct.** *(Correction, Part 4: the labels mark the END of each interval, not the start.)*
- 2025-04-10: no archive file for any of the 8 stations (a feed-wide outage).
- All 37 Delhi primary stations map one-to-one to OpenCity files by name.

**New archive limitation:** OpenAQ archive files **never contain the 00:00, 00:15 and 00:30 IST readings**. They're in no other file, while OpenCity has them. So with archive data the midnight hour is never valid, and a day has at most 23 valid hours. To keep cross-source comparisons fair, those 3 slots are also dropped from OpenCity (`align_to_archive_slots`, counted, raw files untouched). This choice is reversible.

## Check 3: Delhi Diwali coverage and same-station panel (FAIL with the approved sources)

Rule: a station passes a year for a pollutant if **both festival days are valid (≥ 16 valid hours) and at least 5 of 7 baseline days are valid.**

| Source plan | PM2.5 pass 2024 | PM2.5 pass 2025 | PM2.5 panel | PM10 pass 2024 | PM10 pass 2025 | PM10 panel |
|---|---:|---:|---:|---:|---:|---:|
| **Approved:** OpenCity 2024 + OpenAQ archive 2025 | 33 | **0** | **0** | 33 | **0** | **0** |
| **Alternative:** OpenCity for both years | 33 | 33 | **30** | 33 | 28 | **25** |

**Cause: on 2025-10-20 (Diwali day), OpenAQ is missing 10:00–14:00 and 20:00–22:00 IST at every station.**
- Delhi archive, valid PM2.5 stations by hour: hours 10–14 and 20–21 are **0/37**; hour 22 is 1/37.
- **OpenCity has those same hours** (about 137–148 PM2.5 readings per hour across 37 stations). So CPCB recorded the data and OpenAQ didn't ingest it.
- **The OpenAQ API has the same gap.** `/sensors/{id}/measurements` for Mandir Marg and Kurla had 0 readings in hours 10–13 and 21.
- **All six cities are affected.** Two nearest primary stations per city, archive, 2025-10-20: Mumbai, Kolkata, Chennai, Bengaluru and Hyderabad are all missing IST hours 10–14 and 20–22, leaving only 13–15 valid hours. Chennai Royapuram has no file at all.
- 21 Oct 2025, 00:00–05:00: data is thin in **both** sources, so that's a real CPCB data gap.

**Implications:**
1. With OpenAQ, Diwali day 2025 is invalid in all six cities, and the missing hours are exactly the firecracker evening. Relaxing the 16-hour rule would bias results **low**, so it isn't acceptable.
2. The planned *measured* Diwali 2025 vs 2026 comparison isn't possible from OpenAQ for any city. For Delhi it is possible using OpenCity 2025.
3. Bulletin AQI is unaffected: it comes straight from CPCB, with 22/22 days in both years.

## Check 4: proposed city-average rule (ready; not yet applied)

- **Station-day:** valid when it has at least 16 valid IST hours. An hour is valid with at least 75% of its expected readings (3 of 4 for 15-minute data). The daily mean uses valid hours only; otherwise it's empty, never filled.
- **City-day:** equal-weight mean of valid primary station-days. The median, minimum and maximum are stored too.
- **Minimum stations:** `max(3, ceil(50% of the city's primary stations))`, so the value never rests on one or two monitors.
- Event comparisons use a **fixed panel** (the same stations in every period), not "whatever reported".

| City | Primary stations | Minimum valid stations for a city value |
|---|---:|---:|
| Delhi | 37 | 19 |
| Mumbai | 22 | 11 |
| Kolkata | 7 | 4 |
| Chennai | 6 | 3 |
| Bengaluru | 6 | 3 |
| Hyderabad | 9 | 5 |

## Checks 5 and the full build: not run (waiting for a decision)

---

# Part 4: Midnight readings, pilot findings (2026-11-03, about 10:00–11:30 UTC)

**Decisions received:**
- Delhi Option A (OpenCity both years, fixed panel). Other cities use bulletin AQI for Diwali, with measured Diwali 2025 PM marked incomplete.
- City rule approved.
- Don't drop midnight readings in OpenCity-only comparisons.
- Narela, Najafgarh and the 4 Hyderabad outskirt stations stay out of primary city averages and are listed as possible later additions.

**Status: STOPPED during the pilot.** A new decision is needed (section 4.3). The full build was not run, and nothing new is committed.

## 4.1 Midnight readings: what's actually missing

Checked on 12 primary stations (2 per city) × 6 dates (Mar 2025 – Sep 2026), reading each day's file and both neighbouring files (209 files); the API was also checked.

1. **Archive timestamps mark the END of each interval.** Archive `datetime` equals API `period.datetimeTo` for 100% of matched readings (2025-06-15: 87/87; 2026-09-15: 83/83). Equality with `datetimeFrom` was only 76–78%. OpenCity matches the archive at the same labels, so **OpenCity also labels interval ends**. *This corrects Part 3, which said "start".*
2. **Old format (2025-02 → about 2026-08-17):** each day file holds readings ending 00:45 … 23:45. **Readings ending 00:00, 00:15 and 00:30 are missing.** They're not in neighbouring files, and the API lacks them too (on 2025-06-15 the first API period is 00:30→00:45). **They are truly missing from OpenAQ.**
3. **New format (from about 2026-08-18; mixed 18–27 Aug, consistent from Sep 2026):** each day file holds readings ending 00:15 … 24:00. The reading ending at 24:00 is stored in day d's file, labelled with day d+1. **These days are complete.**
4. **Fix applied:** a reading belongs to the hour in which its interval **starts**: `hour = floor(ts − native interval)`. OpenAQ daily values keep the missing readings out (nothing is filled). Because of this, hour 00 is valid on only ~3% of old-format days, against ~95% for other hours.
5. **Matching rule:** `align_to_archive_slots` drops the same three slots from the OpenCity side **only** when a comparison mixes OpenCity with old-format OpenAQ data. Delhi 2025 (OpenCity) vs 2026 (OpenAQ, new format) won't need it. OpenCity-only comparisons use every reading.

## 4.2 Pilot (Delhi + Chennai; 1–31 Oct 2025 and 3 Oct – 2 Nov 2026)

Passed: one unit (`µg/m³`); **0 duplicate** sensor-hours or sensor-days; IST dates; every hour on the hour; `daily_mean` is empty exactly when the day has fewer than 16 valid hours; no gap filling; city rule met on 94–100% of city-days.

Problems found:
1. **The upper-value rule removed real Diwali peaks (my bug).** 1,460 OpenAQ readings above 1,000 µg/m³ were dropped in Oct 2025, almost all at Delhi stations on 15–24 Oct (Anand Vihar peaked at 1,824). **Proposed fix:** keep values above 1,000 and flag them (`n_above_1000`); only remove physically implausible values (above 5,000).
2. **OpenCity blanks every value above 999 µg/m³.** All 1,158 OpenAQ readings above 999 on 19–22 Oct 2025 are blank in OpenCity, while readings at or below 999 match 99.99% (21,856 pairs). OpenCity's maximum over all 37 files is exactly 1000.0. **OpenCity's "Diwali-night gap" (2025-10-20 23:00 → 21 Oct 03:00, 24% of stations reporting) is this blanking, not an outage.**
3. **The blanking hits the two Diwalis very differently** (OpenCity blank share, 18:00–06:00):

| Night | PM2.5 blank | PM10 blank | Values ≥ 950 present |
|---|---:|---:|---|
| 2024 baseline (17–23 Oct) | 10.9% | 7.9% | 0.0% / 0.2% |
| 2024 Diwali (31 Oct) | 11.9% | 20.4% | 1.4% / 2.1% |
| 2024 (1 Nov) | 11.2% | 13.2% | 0.2% / 1.6% |
| 2025 baseline (6–12 Oct) | 4.2% | 3.6% | 0% / 0% |
| **2025 Diwali (20 Oct)** | **35.2%** | **45.7%** | 2.5% / 1.9% |

With Option A, 2025 Diwali values are understated much more than 2024. The pilot output (31 PM2.5 / 28 PM10 panel stations; PM2.5 baseline→festival +37% in 2024 vs +394% in 2025) is **not a fair comparison** and must not be used.

4. **The archive publishes with a delay.** 2026-10-31 → 11-02 shows as a 72-hour "gap", but the files simply haven't been published yet. Fix: end the build at the last date most stations have published, and label later days "not yet available", not as gaps.
5. **New-format hour 23** often has only 1–3 of 4 readings (the reading ending at 24:00 is often absent), so hour 23 is valid on ~72% of days against ~98% for other hours. This is a limitation to record.

Network-wide OpenAQ gaps in the pilot windows (all-city scope, fraction of primary sensors reporting < 0.5):
- **2025:** 10 Oct 17:00 (1 h), 11 Oct 00:00 (1 h), 15 Oct 18:00–20:00 (2 h), **20 Oct 10:00–14:00 and 20:00–22:00**, 20 Oct 23:00 → 21 Oct 03:00 (4 h, 31% reporting), **26 Oct 11:00 → 27 Oct 03:00 (16 h)**, 28 Oct 11:00 and 20:00–22:00.
- **2026:** 4 Oct 18:00 → 5 Oct 03:00 (9 h), 7 Oct 20:00–23:00, 18 Oct 14:00–23:00, **23 Oct 21:00 → 27 Oct 08:00 (83 h)**, plus 31 Oct onward (publishing delay, not an outage).

## 4.3 Decision needed

The approved Delhi plan (OpenCity for both years) is consistent in *source* but not in *data completeness*. See the summary to the user for the options.

---

# Part 5: Decisions applied and full build (2026-11-03)

## 5.1 Decisions (user, 2026-11-03)

**Diwali comparison (Option A):**
- **CPCB bulletin AQI is the main Diwali comparison for all six cities, including Delhi.**
- Delhi OpenCity PM2.5/PM10 is **supporting context only**, always shown with the warning: "Readings above 999 µg/m³ are blank in this source; Diwali-night peaks are under-represented", plus the blank rates.
- **No PM percentage changes** are calculated or shown for Diwali 2024 vs 2025. The pilot's +37% / +394% figures are withdrawn and not stored in any app output.
- The same rule applies to a future Delhi Diwali 2025 vs 2026 comparison unless a source without the 999 limit is verified.

**Value rules:**
- Invalid (removed, counted per reason): **≤ 0** and **> 5,000 µg/m³**.
- Values **> 1,000 µg/m³ are kept and flagged.**
- Sensor-fault patterns are **flagged for review, not deleted**: flat-lines (identical hourly values) and isolated spikes that nearby stations don't show.
- **No imputation.** A blank is labelled "blanked by source limit" only where it's proven (OpenCity blank while OpenAQ has a value > 999 at the same station and time). Otherwise it's "missing or blank".

## 5.2 Code changes

- **Value rule:** removed if `≤ 0` or `> 5,000` (counted as `n_nonpositive` / `n_above_max`). Values above 1,000 are kept and counted (`n_above_1000` in the cleaning log, `n_readings_above_1000` per sensor-day).
- **Fault flags** (hourly booleans, plus daily counts `n_flatline_hours` / `n_spike_hours`; nothing deleted):
  - *Flat-line:* 6 or more consecutive hours with an identical hourly value.
  - *Isolated spike:* value > 3× the same-city reference median **and** > median + 250 µg/m³, with at least 3 peers, **and** the sensor's own previous and next hours are ≤ 50% of the value. A citywide rise (like Diwali) is never flagged.
- **Blanks:** `opencity_blanks.parquet` gives per sensor-day `n_blank`, `n_blank_source_limit_proven` (OpenCity blank while OpenAQ shows > 999 at the same time; only provable from 2025-02-18) and `n_missing_or_blank` (everything else). Nothing is imputed.
- **Publishing delay:** the build ends at the last date on which at least 50% of primary stations have an archive file. Later days are written to `date_quality` as `status = not_yet_published` and aren't treated as gaps.
- **Diwali output:** `role = main` (AQI), `supporting` (Delhi OpenCity PM, with `warning`, `blank_rate_festival_nights`, `blank_rate_baseline_nights` and `blank_proven_share_festival_nights`) or `status` (other cities' PM). The build asserts that **no PM row has a `change_pct`**. The pilot's +37% / +394% figures no longer exist in any output.

## 5.3 Pilot rerun (Delhi + Chennai)

| Check | 1–31 Oct 2025 | 3 Oct – 2 Nov 2026 |
|---|---|---|
| Duplicate sensor-hours / sensor-days | 0 / 0 | 0 / 0 |
| Units | µg/m³ only | µg/m³ only |
| Removed ≤ 0 | 5,436 (mostly US embassy monitors) | 3,428 |
| Removed > 5,000 | 19: sensor faults (Manali, Chennai up to 85,370; CRRI Mathura Road 1.1×10¹⁴) | 0 |
| Kept and flagged > 1,000 | 1,441 (Delhi, 15–24 Oct) | 0 |
| Flat-line hours flagged | 3,739 (3,554 in OpenCity 2024–25, e.g. stuck at 5.0 or 13.0) | 4,051 |
| Isolated-spike hours flagged | 241 | 225 |
| Not yet published | — | 31 Oct – 2 Nov 2026 (labelled, not treated as a gap) |
| PM `change_pct` stored | none | none |

Blank rates now use the **fixed panel** and **both festival nights** (18:00–06:00 after D and D+1), so they're lower than the single-night, all-station figures in Part 4. In 2025: PM2.5 17.8% vs 3.9% on baseline nights, of which 10.0% are proven > 999. PM10: 23.2% vs 2.6%, with 15.9% proven. In 2024: PM2.5 7.4% vs 4.7%; PM10 15.1% vs 4.2%. Whether 2024 blanks were above 999 can't be proven, because there is no OpenAQ data for 2024.

*(The pilot outputs are in the gitignored `data/raw/pilot/` and aren't used by the app.)*

## 5.4 Full six-city build (finished 2026-11-03; command: `python scripts/build_dataset.py`)

- **OpenAQ range:** 2025-02-18 → **2026-10-30** (last published date). 2026-10-31 → 11-02 are `not_yet_published`.
- 62,927 location-days checked, 57,103 archive files present. 46 downloads failed on the first pass because of Sophos TLS errors and all succeeded on retry; a failed download is never counted as missing data.
- Build time was 3.7 h, mostly downloads through Sophos. Reruns reuse the cache in `data/raw/openaq_archive/`.
- **0 duplicate** sensor-hours, sensor-days or city-days. One unit (µg/m³). 0 rows from non-selected sensors.
- Output: about 19 MB of Parquet in `data/processed/` (the largest is `station_hourly.parquet` at 16.8 MB, 3.49 M rows).

**Stations (locations):**

| City | Primary (reference) | Low-cost | US supporting | Delhi Diwali panel |
|---|---:|---:|---:|---|
| Delhi | 37 | 5 | 2 | PM2.5 31, PM10 28 (OpenCity, both years) |
| Mumbai | 22 | 1 | 1 | — |
| Kolkata | 7 | 1 | 2 | — |
| Chennai | 6 | 0 | 2 | — |
| Bengaluru | 6 | 7 | 0 | — |
| Hyderabad | 9 | 1 | 2 | — |

**Coverage (OpenAQ, primary stations, 2025-02-19 → 2026-10-30):**

| City | Sensor-days | Valid (≥ 16 h) | Mean valid hours | City-days meeting rule (PM2.5 / PM10) | City-days low quality |
|---|---:|---:|---:|---|---:|
| Delhi | 43,278 | 83.3% | 19.4 | 96.7% / 97.4% | 26.4% |
| Mumbai | 24,125 | 74.6% | 18.2 | 95.1% / 94.0% | 26.2% |
| Kolkata | 7,966 | 87.0% | 19.5 | 96.6% / 96.6% | 25.8% |
| Chennai | 6,685 | 84.3% | 19.6 | 96.7% / 96.8% | 28.1% |
| Bengaluru | 6,757 | 76.4% | 18.5 | 92.4% / 93.5% | 29.3% |
| Hyderabad | 10,179 | 74.8% | 18.4 | 91.9% / 91.4% | 28.1% |

OpenCity Delhi: 52,931 sensor-days (2024-01-01 → 2025-12-31), 95.0% valid. Low-cost: 4,917 sensor-days; US supporting: 1,282 sensor-days (kept out of city values).

**Cleaning (counts per reason):**

| Source | Raw | Missing / blank | Removed ≤ 0 | Removed > 5,000 | Kept and flagged > 1,000 | Flat-line hours | Isolated-spike hours |
|---|---:|---:|---:|---:|---:|---:|---:|
| OpenAQ archive | 8,010,630 | 0 | 71,714 | 4,031 | 10,036 | 20,496 | 1,158 |
| CPCB via OpenCity | 5,183,956 | 401,343 | 0 | 0 | 0 (source caps at 999) | 3,554 | 220 |

There were no exact or conflicting duplicates and no unexpected units.

**Network-wide gaps (OpenAQ, all six cities; < 50% of active primary sensors reporting):**
- 179 runs, 1,036 hours in total. **185 of 620 dates are low quality** (at least 1 gap hour).
- Largest runs:

| Start (IST) | End (IST) | Hours |
|---|---|---:|
| 2026-01-10 18:00 | 2026-01-20 20:00 | **242** |
| 2026-10-23 21:00 | 2026-10-27 08:00 | 83 |
| 2025-04-09 06:00 | 2025-04-11 19:00 | 61 (contains 2025-04-10) |
| 2026-06-23 17:00 | 2026-06-25 21:00 | 52 |
| 2026-08-27 15:00 | 2026-08-28 23:00 | 32 |
| 2026-02-16 10:00 | 2026-02-17 12:00 | 26 |
| 2025-05-25 18:00 | 2025-05-26 18:00 | 24 |
| 2026-08-29 07:00 | 2026-08-30 06:00 | 23 |

- Repeated hours: no hour of day is systematically missing. Each hour is a gap on 5–9% of days, except hour 00 at 13.7% (the old-format midnight limitation).
- OpenCity Delhi: only 3 runs (8 h). The largest, 2025-10-20 23:00 → 21 Oct 03:00, is the >999 blanking on Diwali night, not an outage.

**Diwali: MAIN comparison, CPCB bulletin AQI** (baseline bulletins D−13…D−7 vs festival bulletins D+1, D+2):

| City | 2024 baseline → festival | 2024 change | 2025 baseline → festival | 2025 change |
|---|---|---:|---|---:|
| Delhi | 307.7 → 327.5 | +6.4% | 139.9 → 352.0 | +151.7% |
| Mumbai | 74.0 → 188.5 | +154.7% | 113.4 → 160.5 | +41.5% |
| Kolkata | 79.7 → 198.5 | +149.0% | 87.1 → 160.0 | +83.6% |
| Chennai | 64.4 → 106.5 | +65.3% | 81.1 → 106.5 | +31.3% |
| Bengaluru | 51.0 → 128.5 | +152.0% | 70.7 → 88.0 | +24.4% |
| Hyderabad | 72.7 → 126.0 | +73.3% | 99.6 → 94.5 | −5.1% |

2026: `not_available` (Diwali is on 8 Nov).

**Delhi measured PM: SUPPORTING only** (OpenCity, fixed panel; no % change; warning attached):

| Year | Metric | Panel | Baseline mean | Festival mean | Blank, festival nights | Blank, baseline nights | Proven > 999 |
|---|---|---:|---:|---:|---:|---:|---:|
| 2024 | PM2.5 | 31 | 155.6 | 213.7 | 7.4% | 4.7% | not provable |
| 2025 | PM2.5 | 31 | 48.7 | 240.6 | 17.8% | 3.9% | 10.0% |
| 2024 | PM10 | 28 | 324.2 | 340.3 | 15.1% | 4.2% | not provable |
| 2025 | PM10 | 28 | 138.4 | 347.9 | 23.2% | 2.6% | 15.9% |

Festival values are lower bounds. 2025-10-20/21 are low quality in OpenCity because of the blanking.

**Other cities' measured PM (status rows only):** 2024 `no_data` (NO_MEASURED_DATA); 2025 `incomplete` (OPENAQ_INGESTION_GAP, user text "Measured PM data is incomplete for Diwali 2025."); 2026 `not_available`.

## 5.5 Tests

`pytest`: **37 passed**.
- `tests/test_transform.py`: readers and timezones, cleaning counts, duplicates, units, hour assignment, 75% hourly rule, 16-hour daily rule, no imputation, city rule, bulletin alignment, festival rule.
- `tests/test_quality.py`: gap detection, partial outages, inactive sensors, recurring hours, flat-lines, isolated spikes vs a citywide rise, publication tail.
- `tests/test_build.py`: end-to-end on synthetic files; repeatable rerun with identical outputs, no duplicates, > 1,000 kept, old-format midnight hour not filled, proven vs unproven blanks, no PM % change, user message text.

## 5.6 Remaining limitations

1. Old-format OpenAQ (to about 2026-08-17) lacks readings ending 00:00/00:15/00:30, so hour 00 is rarely valid. The new format sometimes lacks the reading ending 24:00 (hour 23 valid about 72%).
2. 30% of dates have at least one network-wide gap hour, including a 10-day outage in January 2026. These dates are low quality for comparisons.
3. Delhi Diwali PM is censored at 999 in OpenCity, so it's supporting only. 2024 blanks can't be proven to be > 999.
4. Measured PM for Diwali 2025 is incomplete for five cities, and there is no measured PM for 2024 outside Delhi.
5. Bulletin AQI is a city average of whichever stations reported (24 h to 4 PM). The station mix changes daily, and AQI is capped at 500. Delhi's 2024 baseline was already "Very Poor" (307.7), so its 2024 % change is small.
6. Fault flags are heuristics for review: 20,496 flat-line hours and 1,158 isolated-spike hours in OpenAQ. Nothing is deleted.
7. US supporting data before 2025-02-18 was downloaded but isn't included (the build window starts 2025-02-18).
8. The bulletin parquet ends 2026-10-25, so Diwali 2026 AQI needs a refresh after 8 Nov.
9. Narela, Najafgarh and the 4 Hyderabad outskirt stations are excluded from city averages (possible later additions).
10. The full build takes hours through Sophos. Cached reruns are faster.

---

# Part 6: Data checks, weather and analysis functions (2026-11-04)

No full re-download was needed. All checks used `data/processed/`, the cached raw files and 6 new weather requests.

## 6.1 Exact bulletin dates (check 1)

The bulletin dated X covers 16:00 IST on X−1 → 16:00 IST on X.

| Year | "During" bulletins | "Before" bulletins (original method W1) |
|---|---|---|
| 2024 | 2024-11-01, 2024-11-02 (evenings of 31 Oct, 1 Nov) | 2024-10-18 … 2024-10-24 |
| 2025 | 2025-10-21, 2025-10-22 (evenings of 20, 21 Oct) | 2025-10-07 … 2025-10-13 |

Per city, the AQI values on those bulletins are stored in `data/app/diwali_aqi_levels.parquet` (role `festival` / `context`, D−14 … D+3).

## 6.2 Delhi's 2025 baseline and alternative windows (checks 2–3)

Delhi 2025, by local day: bulletin AQI for that evening / rainfall that day (Open-Meteo):

5 Oct 105/1 mm · **6 Oct 73/15 mm · 7 Oct 81/5 mm** · 8 Oct 100 · 9 Oct 170 · 10 Oct 199 · 11 Oct 167 · 12 Oct 189 · 13 Oct 211 · 14 Oct 233 · 15 Oct 245 · 16 Oct 254 · 17 Oct 268 · 18 Oct 296 · 19 Oct 345 · **20 Oct 351 · 21 Oct 353** · 22 Oct 305.

**Explanation:** the original window (D−14 … D−8) begins right after 20 mm of rain cleaned the air (AQI 73–100). AQI then rose every day with no rain and reached 345 the day *before* Diwali. The baseline of 140 mixes the post-rain clean spell with the build-up, so +152% mostly reflects the season, not only Diwali.

Baselines by window (AQI; bulletins = local day + 1):

| Year | City | During | W1 D−14…D−8 | W2 D−7…D−1 | W3 D−3…D−1 | W4 after D+7…D+13 | W5 = W2 + W4 |
|---|---|---:|---:|---:|---:|---:|---:|
| 2024 | Delhi | 328 | 308 | 298 | 301 | 371 | 334 |
| 2024 | Mumbai | 188 | 74 | 124 | 119 | 142 | 133 |
| 2024 | Kolkata | 198 | 80 | 63 | 68 | 112 | 88 |
| 2024 | Chennai | 106 | 64 | 123 | 140 | 62 | 93 |
| 2024 | Bengaluru | 128 | 51 | 123 | 116 | 71 | 97 |
| 2024 | Hyderabad | 126 | 73 | 108 | 115 | 105 | 107 |
| 2025 | Delhi | 352 | 140 | 265 | 303 | 306 | 285 |
| 2025 | Mumbai | 160 | 113 | 136 | 155 | 57 | 97 |
| 2025 | Kolkata | 160 | 87 | 133 | 119 | 54 | 93 |
| 2025 | Chennai | 106 | 81 | 69 | 89 | 82 | 75 |
| 2025 | Bengaluru | 88 | 71 | 61 | 57 | 69 | 65 |
| 2025 | Hyderabad | 94 | 100 | 87 | 97 | 61 | 74 |

% change vs each window (spread = max − min across W1, W2, W3, W5):

| Year | City | W1 | W2 | W3 | W4 | W5 | Spread (pp) |
|---|---|---:|---:|---:|---:|---:|---:|
| 2024 | Delhi | +6 | +10 | +9 | −12 | −2 | 12 |
| 2024 | Mumbai | +155 | +52 | +58 | +32 | +41 | 113 |
| 2024 | Kolkata | +149 | +213 | +190 | +78 | +127 | 86 |
| 2024 | Chennai | +65 | −14 | −24 | +71 | +15 | 89 |
| 2024 | Bengaluru | +152 | +4 | +10 | +81 | +32 | 148 |
| 2024 | Hyderabad | +73 | +17 | +10 | +20 | +18 | 63 |
| 2025 | Delhi | +152 | +33 | +16 | +15 | +23 | 136 |
| 2025 | Mumbai | +41 | +18 | +4 | +180 | +66 | 62 |
| 2025 | Kolkata | +84 | +20 | +34 | +199 | +71 | 63 |
| 2025 | Chennai | +31 | +54 | +20 | +31 | +41 | 35 |
| 2025 | Bengaluru | +24 | +44 | +54 | +28 | +35 | 30 |
| 2025 | Hyderabad | −5 | +9 | −2 | +55 | +28 | 33 |

Rain in 2025 windows (mm, W1/W2/W3/W4):
- Delhi 20/0/0/0; Mumbai 4/9/2/41; Kolkata 30/2/2/48; Chennai 35/125/49/102; Bengaluru 75/52/40/5; Hyderabad 15/5/2/46.
- Chennai's W2 included 125 mm of rain. Weather data starts 2025-02-18, so 2024 rainfall isn't available here.

**Conclusion:** percentages aren't stable (spread 12–148 points). **AQI levels are the main result.** Percentages are stored with `percent_status = pending_user_approval`, and the analysis function withholds them (`APPROVED_DIWALI_BASELINE = None`).

**Recommended method (for approval):**
1. Headline: festival-level AQI (bulletins D+1, D+2) with its category and the bulletin dates.
2. Context: the daily AQI line from D−14 to D+3, so the build-up is visible, with rainfall shown.
3. If a % is wanted: use **W2 (D−7 … D−1)**, labelled "vs the week before Diwali". Show it only when W1/W2/W3 agree within 25 points. Otherwise show "varies with baseline: X–Y%". Under that rule only Delhi 2024 would show a single %.

## 6.3 Blank rates reconciled (check 4)

Blank share of 15-min OpenCity slots, 18:00–06:00 IST, by definition:

| Definition | 2024 PM2.5 | 2024 PM10 | 2025 PM2.5 | 2025 PM10 |
|---|---:|---:|---:|---:|
| A (pilot, Part 4): all 37 stations, Diwali night only, slots by end label | 11.9% | 20.4% | 35.2% | 45.7% |
| B: panel stations, Diwali night only, by interval start | 8.7% | 19.2% | 33.8% | 45.1% |
| C: all 37 stations, both festival nights, by interval start | 11.5% | 16.8% | 19.1% | 24.7% |
| **D (final build): panel, both festival nights, by interval start** | **7.4%** | **15.1%** | **17.8%** | **23.2%** |

The difference is mainly **one night vs two nights**; the second night is far less affected. Station group changes figures by 1–3 points. `delhi_pm_diwali_support.parquet` stores: Diwali night (panel), both festival nights (panel), Diwali night (all 37), baseline nights (panel), and the proven-above-999 share (2025 only). The definition is stored with the data.

## 6.4 Severity levels (check 5)

Per city and IST date, gap hours = city-scope gaps ∪ network-wide gaps:
- **none:** 0 gap hours
- **minor:** 1–2 h and the run is < 6 h
- **moderate:** 3–7 h or a 6–23 h run
- **severe:** ≥ 8 h, or part of a run ≥ 24 h

`extent` = **network** (≥ 4 cities affected that date) or **local**. Days the archive hasn't published are `not_yet_published`.

| City | none | minor | moderate | severe |
|---|---:|---:|---:|---:|
| Delhi | 424 | 106 | 40 | 50 |
| Mumbai | 421 | 110 | 40 | 49 |
| Kolkata | 418 | 109 | 40 | 53 |
| Chennai | 410 | 105 | 43 | 62 |
| Bengaluru | 402 | 114 | 46 | 58 |
| Hyderabad | 409 | 108 | 47 | 56 |

1,126 of 1,236 non-none city-dates are network-wide. OpenCity Delhi: 727 none, 3 minor, 1 moderate. Analysis functions report the worst severity and the severe dates within each requested period.

## 6.5 Effect of fault flags (check 6)

Measured on 2.13 M primary OpenAQ hours (flat-line 0.93%, isolated spike 0.054%), city-day values vs the all-hours values:

| Rule | Median change | 95th percentile | City-days changed > 5% | > 10% | City values lost |
|---|---:|---:|---:|---:|---:|
| Drop isolated spikes | 0.0% | 3.4% | 284 | 206 | 3 |
| Drop flat-lines | 0.0% | 14.1% | 482 | 398 | 25 |
| Drop both | 0.0% | 21.7% | 695 | 555 | 28 |

- Flat-line runs are clearly faults. 794 runs, median 15 h, longest 283 h. Two Mumbai stations (Borivali East, Colaba) were stuck at **985.0 for 283 h** at the same time, and Mulund West at 1000.0 for 209 h. Chennai's flat-line share is 3.9%, Mumbai's 2.0%.
- Isolated spikes skew small cities by up to 67% (Chennai, 2026-04-24).
- **Recommended and applied default rule:** exclude both flag types from analysis values; keep them stored; report `flagged_hours_excluded` with every result. The all-hours value is also kept (`city_mean_all_hours`).

**New checks from check 7:**
- **Physically impossible PM2.5 > PM10** (PM2.5 > 1.2 × PM10 and > PM10 + 20): 102 station-days are flagged and excluded from the default value. Most are at Chennai Kodungaiyur/Manali, Delhi NSIT Dwarka and Mumbai Powai/Sion. Example: Royapuram on 2025-08-17/18 had PM2.5 1,553–1,939 against PM10 44–60.
- **Peer outlier** (> 3 × the median of other same-city stations and > +100): 192 station-days, flagged only.

## 6.6 Cross-check against CPCB bulletins (check 7)

Our measured PM was converted to a **PM-only AQI estimate**. This is *not* the official AQI, which uses up to 8 pollutants.
- CPCB sub-index breakpoints were applied to 24-hour means over the same 16:00–16:00 window, with ≥ 16 valid hours per station and flagged hours excluded.
- Station value = max of the PM2.5 and PM10 sub-indices; city value = mean over stations (≥ 3).
- Compared on 3,260 bulletin days where PM is a prominent pollutant (96.8% of all days), 2025-02-19 → 2026-10-25.

| City | Days | Correlation | Median (ours − official) | Within ±20% | Same category | Ours > official + 20% | Ours < official − 20% |
|---|---:|---:|---:|---:|---:|---:|---:|
| Delhi | 516 | 0.987 | +1.4 | 97.5% | 89.1% | 1.2% | 1.4% |
| Kolkata | 520 | 0.988 | −2.8 | 90.0% | 88.3% | 1.5% | 8.5% |
| Mumbai | 564 | 0.982 | −2.9 | 93.1% | 84.9% | 2.5% | 4.4% |
| Hyderabad | 565 | 0.901 | +1.8 | 94.7% | 88.5% | 4.2% | 1.1% |
| Bengaluru | 545 | 0.924 | −5.9 | 75.8% | 73.4% | 1.8% | **22.4%** |
| Chennai | 550 | 0.758 | −3.2 | 76.5% | 80.5% | **10.0%** | 13.5% |

Sample days (official AQI / our PM-only estimate):

| City | 2025-06-15 | 2025-10-21 | 2025-12-15 | 2026-03-15 | 2026-09-15 |
|---|---|---|---|---|---|
| Delhi | 140 / 136 | 351 / **481** | 427 / 441 | 175 / 167 | 98 / 100 |
| Mumbai | 53 / 50 | 211 / 241 | 122 / 117 | 91 / 96 | 44 / 38 |
| Kolkata | 46 / 44 | 174 / 180 | 142 / 135 | 57 / 58 | 65 / 57 |
| Chennai | 53 / 41 | 142 / **326** | 108 / 105 | 60 / 54 | 90 / 59 |
| Bengaluru | 48 / 30 | 97 / 68 | 103 / 108 | 111 / 112 | 68 / 59 |
| Hyderabad | 80 / 65 | 116 / 107 | 104 / 113 | 73 / 78 | 52 / 53 |

**Mismatches explained:**
- **Chennai:** most high mismatches (25 days > +50%) came from **Royapuram**, which reported impossible PM2.5 (1,500–1,900 with PM10 44–73). These station-days are now excluded by the PM2.5 > PM10 rule.
- **Bengaluru:** ours is lower on 22% of days. We use 6 primary stations within 25 km; CPCB's bulletin uses 7–14, including stations our rules exclude (outside 25 km, or partial).
- **Delhi on Diwali 2025-10-21:** ours 481 vs official 351. 268 of 1,438 valid hours were > 999. Removing them gives 422 from 24 stations. **The 999 limit explains part of the gap, not all of it** (unproven; CPCB's method on extreme days isn't documented here).
- These are **different metrics and station sets**. The cross-check validates our data's level and timing; it doesn't make ours official.

## 6.7 Weather (Part 2)

- **Source:** Open-Meteo Historical Weather API (`archive-api.open-meteo.com/v1/archive`), reanalysis = **modelled**.
- **Request:** one per city (6 in total), daily variables, `timezone=Asia/Kolkata` (`utc_offset_seconds` = 19800, checked on parse).
- **Coverage:** **2025-02-18 → 2026-11-03, 624 days × 6 cities, 0 missing values.** The last 7 days are flagged `preliminary`. The grid cell used is stored (for example, Delhi 28.576, 77.187).
- **Variables and units** (checked against the API's `daily_units`): `temperature_mean_c` (°C), `relative_humidity_mean_pct` (%), `wind_speed_mean_kmh` (km/h), `precipitation_sum_mm` (mm).
- **Limits** (open-meteo.com/en/terms, read 2026-11-04): 600/min, 5,000/h, 10,000/day, 300,000/month; **free tier is non-commercial only**. Header seen: `x-ratelimit-limit: 600`; a long request costs about 11.4 calls.
- **Attribution (CC BY 4.0):** "Weather data by Open-Meteo.com" with a link, plus Copernicus C3S for the reanalysis. Stored in every row and in the app manifest.
- Kept in a separate table (`weather_daily.parquet`) and never merged into pollution tables.

## 6.8 App tables and sizes (check 8)

`python scripts/derive_app_tables.py` reads `data/processed` and writes `data/app/` (no downloads, about 11 s).

| Table | Rows | Size |
|---|---:|---:|
| station_daily | 158,120 | 2.41 MB |
| city_daily | 6,816 | 304 KB |
| city_daily_aqi (6 cities, 2015 → 2026-10-25) | 24,026 | 239 KB |
| weather_daily | 3,744 | 26 KB |
| stations | 204 | 18 KB |
| date_quality (severity) | 4,469 | 14 KB |
| network_gaps | 1,415 | 14 KB |
| diwali_aqi_levels / diwali_aqi_baselines | 324 / 72 | 11 / 10 KB |
| delhi_pm_diwali_support / diwali_pm_status / data_status_reasons | 4 / 30 / 5 | 12 / 7 / 4 KB |
| **Total deployed** | | **3.07 MB** |

**Not deployed:** `data/processed/station_hourly.parquet` (16.8 MB), the other processed tables (rebuild source, about 19 MB in git) and `data/raw/` (808 MB, gitignored).

## 6.9 Analysis functions (Part 3)

`backend/analysis/` reads `data/app` through DuckDB. Every function returns `AnalysisResult` with: kind, title, metric, units, data_type, source, date_range, stations, coverage, quality (severity counts, worst severity, severe dates), method, warnings, values and a typed `ChartSpec`. The output is JSON-safe.

| Function | What it does |
|---|---|
| `city_trend(city, pollutant, start, end, freq D/W/M)` | Period means of valid city-days, coverage per period, highest/lowest day |
| `compare_cities(cities, pollutant, start, end)` | Ranks on **common days only** (every city valid); all-valid-day means for context |
| `diwali_aqi(city, years)` | **Main Diwali result:** festival AQI level and category, bulletin dates, D−14…D+3 line, baseline candidates; % withheld |
| `delhi_pm_context(year)` | Supporting Delhi PM (panel, lower bounds) with blank rates and warning; never a % |
| `unusual_days(city, pollutant, start, end, window=15, threshold=3)` | Rolling median of the surrounding 15 days (excluding the day); robust scale 1.4826 × MAD; method explained |
| `weather_relationship(city, pollutant, variable, start, end)` | Spearman ρ, quartile or dry/rain groups, association-only statement; severe and preliminary days excluded |
| `coverage_summary(city, start, end)` | Stations by tier, valid shares, exclusions, flags, severity; calendar chart |
| `calendar_quality_chart`, `aqi_calendar_chart` | Calendar heatmap specs (AQI uses CPCB category colours and Diwali bands) |
| `aqi.sub_index`, `aqi.category` | CPCB PM sub-index (cross-check only) and AQI category |

Sample real results (2025-03-01 → 2026-10-30):
- Delhi PM2.5 vs wind speed: ρ = −0.24 (weak), 543 days. Mean PM2.5 is 102.9 in the calmest quarter vs 58.2 in the windiest.
- Mumbai PM10 vs rain: ρ = −0.72 (strong), 516 days. Dry days 99.8 vs rain days 51.8 µg/m³.
- These are associations, not causes.

## 6.10 Tests

`pytest`: **77 passed**.
- Pipeline: 37 tests (transform, quality, build).
- Weather: 3 tests (IST, units, fail-loud, preliminary flag, real completeness).
- Derive: 15 tests (severity, flag rule, impossible PM2.5 > PM10, peer outlier, Diwali tables, blank-rate definition).
- Analysis: 22 tests. Synthetic: envelope, JSON, common days, injected spike/dip, flat series, association sign and wording, severe-day exclusion, validation, CPCB sub-index, categories. Real data: Diwali levels equal the bulletins, Delhi PM never has a %, the trend equals an independent pandas recomputation, compare and coverage are consistent, Mumbai rain groups, unusual-days results are reproducible.

---

# Part 7 — Analysis decisions, rule checks and the agent (2026-11-05)

## 7.1 Decisions applied (user, 2026-11-04)
- Diwali main result = official AQI **levels, categories and exact bulletin dates**. No percentage in the default answer.
- A percentage only when asked: baseline **D−7…D−1 (W2)**; a single figure only if W1 (D−14…D−8), W2 and W3 (D−3…D−1) agree within **25 points**, otherwise a range (`diwali_aqi_percent`).
- Chart: x = bulletin day relative to Diwali (bulletin D+1 reports Diwali evening); every point carries its bulletin date and CPCB period ("2025-10-20 16:00 to 2025-10-21 16:00 IST").
- Never say Diwali caused a rise. The result reports `pre_festival_trend` (mean of evenings D−7…D−5 vs D−3…D−1, ±10%) and warns when AQI was already rising.

Percentage rule on real data (✔ = single figure):

| City | 2024 | 2025 |
|---|---|---|
| Delhi | ✔ +9.8% (spread 3.4) | range +16.2 to +151.7% |
| Mumbai | range +51.8 to +154.7% | range +3.5 to +41.5% |
| Kolkata | range +149.0 to +213.0% | range +20.2 to +83.6% |
| Chennai | range −23.9 to +65.3% | range +19.7 to +54.3% |
| Bengaluru | range +4.2 to +152.0% | range +24.4 to +54.4% |
| Hyderabad | range +9.9 to +73.3% | ✔ +8.6% (spread 13.7) |

AQI was already rising before Diwali in 7 of 12 city-years.

## 7.2 Spike exclusion vs real peaks (check)
1,378 spike-flagged hours in total (OpenAQ 1,158; OpenCity 220).
- **Diwali windows:** only 4 spike hours fall within D 12:00 → D+2 12:00. One is real. **Hyderabad Somajiguda read 592 µg/m³ at 22:00 on Diwali 2025** while ECIL Kapra (133), Kokapet (131) and New Malakpet (199) also jumped. That's a local firecracker peak, and the old rule removed it.
- **Corroborated spikes:** 210 spike hours had an unflagged same-city station within ±1 h reading ≥ 50% of the value and > 2 × the city median. Delhi 156, Mumbai 43, Chennai 8.

**New rule (supported events are kept):** a spike-flagged hour stays in analysis values if
1. it lies in a verified Diwali night (18:00 → 06:00 on D and D+1), or
2. another unflagged primary station in the same city, within ±1 h, reads ≥ 50% of it **and** > 2 × that hour's city median.

Result: 173 hours kept (OpenAQ 94 corroborated + 2 festival-night; OpenCity 77 corroborated) and 1,205 still excluded. Each station-day/city-day reports `n_supported_spike_hours_kept`.

Effect:
- 26 city-days change by > 1%, and 9 by > 5%.
- Unusual-day detections: 327 → 325. Delhi PM2.5 adds 2025-11-27; Mumbai PM10 drops 2025-11-30 and 2025-12-24; Chennai PM2.5 drops 2025-10-09.
- **Largest effect:** Chennai PM10 on Diwali day 2025-10-20 goes 227.5 → 423.6. Kodungaiyur's festival-night hour (4,909 µg/m³) is kept, which makes its day valid (16 h, mean 1,012). That station-day is a **peer outlier** (flag only, as decided), so the city value carries that flag.

## 7.3 PM2.5 > PM10 tolerance (check)
On 62,935 station-days with ≥ 16 matched hours, the PM2.5/PM10 ratio has median 0.42, 99th percentile 0.83 and 99.5th 0.90. Only 0.33% exceed 1.0.

| Rule | Station-days flagged |
|---|---:|
| ratio > 1.0 | 208 |
| > 1.1 and +10 | 121 |
| **> 1.2 and +20 (chosen)** | 89 |
| > 1.5 and +50 | 49 |

**Tolerance:** PM2.5 > PM10 + max(20% × PM10, 20 µg/m³). That's two separate instruments at about ±10% each, plus an absolute floor for low concentrations.

**Two tests, either one flags the day:**
- (a) Station-day means.
- (b) Means over matched hours (both valid and unflagged, ≥ 16 h).

Matched hours alone would have **released real faults**. At Bengaluru 6973 on 2025-05-15, PM2.5 was 12.7 on the 16 matched hours but about 400 on 6 hours without PM10. Daily means alone miss faults hidden by different hour sets.

Result: 103 station-day pairs flagged (was 102). Peer outliers remain flag-only.

## 7.4 Cross-check vs CPCB bulletins (PM-only estimate — not official AQI)
`scripts/crosscheck_bulletins.py` → `docs/crosscheck_bulletins.json`.

**Method:**
- Bulletin window 16:00 → 16:00 IST, default rule (supported spikes kept).
- ≥ 16 h per station; station = max PM sub-index; city = mean of station AQIs (≥ 3).
- Only days where PM is a prominent pollutant.

| City | Days | Correlation | Mean diff (ours − official) | Mean abs diff | Within ±20% |
|---|---:|---:|---:|---:|---:|
| Delhi | 516 | 0.987 | +6.0 | 10.4 | 97.5% |
| Kolkata | 520 | 0.988 | −2.9 | 5.7 | 90.0% |
| Mumbai | 564 | 0.981 | −2.3 | 5.6 | 92.9% |
| Hyderabad | 565 | 0.901 | +1.8 | 5.5 | 94.7% |
| Bengaluru | 545 | 0.924 | −6.2 | 9.7 | 75.8% |
| Chennai | 550 | 0.754 | −0.1 | 13.3 | 76.4% |

**Delhi, Diwali 2025 (bulletin 2025-10-21, official 351, 35 stations):**

| Variant | PM-only estimate | Stations |
|---|---:|---:|
| A. Bulletin window (16:00 20 Oct → 16:00 21 Oct), default rule | **481.1** | 35 |
| B. Calendar day 20 Oct instead (wrong window) | 410.9 | 20 |
| C. Hours > 999 dropped (as the CPCB/OpenCity feed blanks them) | 421.6 | 24 |
| C′. Same, ≥ 12 h per station | 414.9 | 36 |
| D. Hours capped at 999 | 477.6 | 35 |
| E. Sub-index of the city-mean PM | 500.0 | 35 |
| F. Night 20:00–06:00 removed (≥ 12 h) | 376.7 | 33 |

**Findings:**
- **The 4 PM window** is already used. A calendar day would be the wrong period.
- **Gaps:** 3 of 24 hours have no valid readings (20:00, 21:00, 00:00; midnight is the known old-format gap). They fall in the rising phase, so filling them would *raise* our estimate.
- **The 999 limit** explains about 60 of the 130 points (481 → 422).
- **Saturation:** the station-median 24-h PM2.5 is 453 µg/m³. 21 of 35 stations exceed 380 µg/m³, so their sub-index is capped at 500.
- To reach 351, the station-mean PM2.5 would have to be about 187 µg/m³. **No tested variant reaches 351**, not even removing the whole night (377).
- The rest of the gap is **unexplained**. The likely cause is CPCB's real-time feed or validation at bulletin time, which we can't verify.
- PM-only estimates are a data check only. The app never shows them as AQI.

## 7.5 Model verification (2026-11-05)
- **Pydantic AI** `pydantic-ai-slim[groq,google]==2.66.0` (Python ≥ 3.11). It pulls groq 1.7.0, google-genai 2.34.0 and pydantic 2.14.2.
- **Groq** (live `/models` list for this key): gpt-oss-120b, gpt-oss-20b, qwen3.8-27b. `llama-3.3-70b-versatile` returns **404** for this key, although the docs page lists it.
  - Live headers for gpt-oss-120b: 1,000 requests/day, 8,000 tokens/min.
  - Daily tokens are not in the headers. A 429 body confirmed **200,000 tokens/day**.
- **Gemini:** `gemini-2.5-flash` is retired for new users (404, which recommends gemini-3.8-flash). `gemini-3.5-flash-lite` and `gemini-3.8-flash` respond.
  - The free-tier quotas are **only visible in AI Studio**. Web sources disagree, so they're unverified.
- **Tool-calling trials (small requests):**
  - gpt-oss-120b and gpt-oss-20b both called the tool correctly on a simple request.
  - With the full agent, gpt-oss-120b at reasoning **low** failed 3/3 (Groq `output_parse_failed`); at **medium** it passed 3/3.
  - qwen3.8-27b: 1/2, slow.
  - gpt-oss-20b: parse failure.
  - Groq rejects JSON mode combined with tools.
- **Chain (`backend/config/models.json`):** Groq gpt-oss-120b (medium) → Gemini 3.5 Flash-Lite → Gemini 3.8 Flash. Override with env `SKYQ_MODEL_CHAIN`.

## 7.6 Agent (terminal only)
`backend/agent/`:
- **resolver:** cities with aliases and typo tolerance, pollutants, periods (relative ones anchored to the latest data), Diwali events with availability.
- **tools:** 10 typed tools around the analysis functions. Each returns a `dataset_id` plus a compact summary, never raw tables.
- **session:** dataset registry and last 3 turns of memory (thinking parts dropped).
- **verify:** number and causal-language checks.
- **schemas:** `LLMAnswer`, `FinalAnswer`, `StepEvent`.
- **core:** the loop, verification with up to 3 retries, events and errors.

Run it with `scripts/ask.py`.

**Number rule:**
- Every number in the answer, explanation and metric labels must equal a tool-result number after rounding (shares may be written as %).
- Metric values must equal a numeric field of their own dataset.
- From the question, only years and small counts may be echoed.
- On failure the model gets the list of bad numbers and retries. If it still fails, a clear error is returned.

**Step events:**
- Event types: run_started, plan, model_request, tool_call, tool_result, tool_error, verification, retry, fallback (with the error class), answer, error.
- They're typed and JSON-serialisable, ready for SSE.

## 7.7 Live evaluation (`evals/questions.json`, `scripts/run_eval.py`)
47 questions (51 turns):
- trend 7, comparison 6, Diwali 7, unusual days 5, weather 4, follow-up 4×2
- missing data 5, unsupported 4
- traps 5 (PM Diwali %, injection ×2, code, causal claim)

Run in batches of 5 with 20–25 s gaps.

| Score | Result |
|---|---|
| Tool choice | 43/43 (100%) |
| Numbers traceable to tool results (answered turns) | 40/40 (100%) |
| Reference values correct | 7/8 (87.5%); D1 gave both bulletins (351, 353) instead of their average 352 |
| Correct refusals / unavailable | 14/14 (100%) |
| Errors | 0 after rerun (first pass: W5 "models unavailable"; both Gemini models failed once) |
| Overall pass | 50/51 (first pass 49/51) |
| Verifier retries | 8 across 51 turns |

**Model split:**
- Only 2 turns ran on Groq. Groq's 200K tokens/day for gpt-oss-120b was used up by development trials earlier that day.
- After that, the chain fell back to Gemini 3.5 Flash-Lite. The rest of the run used Gemini directly, so no request was spent on a guaranteed 429.
- **The primary model is therefore under-tested and needs a Groq re-run.**

**Changes made after reviewing results:**
- Metric cards must match a numeric field. In X3 a label had been attached to a number found inside text, and it passed. X3 was rerun after the fix.
- The first pass is kept in `evals/results/live_first_pass.jsonl`.

---

# Part 8 — Agent hardening, evaluation and FastAPI (2026-11-05)

## 8.1 Token reduction
- **Tool results:** now `{id, type, units, period, fields, notes}` with named values only and at most 2 short notes. Full results stay in the session registry.
- **Smaller model surface:** the answer schema is shorter (status, answer, card field names, chart id), instructions are about 45% shorter, and there are 8 tools instead of 10 (percentage is now an option on `diwali_aqi`; `dataset_details` dropped).
- **Memory:** the last 2 turns only. Tool results from older turns shrink to their id and field names, and thinking parts are dropped.

| Measure | Before (first agent version) | After |
|---|---:|---:|
| Fixed prompt per model request (instructions + tool and answer schemas) | ≈ 2,230 tokens | ≈ 1,340 tokens |
| Typical tool result | 1,170–3,200 chars | 460–870 chars |
| Main set, Gemini 3.5 Flash-Lite, tokens per question: median / mean / max | 6,391 / 7,882 / 17,449 | **3,602 / 4,237 / 7,993** |
| Questions under 6,000 tokens | 26/50 | **46/50** |
| Holdout (Gemini), median / max | — | 5,116 / 7,666 |
| Groq gpt-oss-120b | 2 turns: 1,786 and 5,168 | not measured (daily quota exhausted, see 8.4) |

## 8.2 Cards, charts and explanation built by code
- The model writes 1–3 sentences and names card fields (`ds1.mean`) plus a chart dataset.
- **Code fills in:** the card's value, label (with city, period or date), unit, data type, source and warnings, plus the chart and a deterministic explanation (data type, period, stations, coverage, method).
- A card that isn't a numeric tool field is rejected and the model retries.
- The written answer still passes the number check.

## 8.3 Other hardening
- **Natural date ranges:** "March to June 2026", "between March and June", "Oct 2025 to Jan 2026", "15 Oct to 5 Nov 2025", "1-15 November 2025", "since/until", "Q1 2026", "first half of 2026", "2025-11", "11/2025", and a month or range without a year (latest in the data, with a note). 22 tests.
- **Chennai and other non-Delhi Diwali answers** use official AQI only. The measured-PM status ("incomplete" or "no data") comes back as a warning.
- **Peer-outlier warning:** a city-day where a flag-only peer-outlier station moves the city value by more than 25% (`peer_outlier_major`). 92 city-days affected (Bengaluru PM10 48, Chennai PM10 28, …). Chennai PM10 on 2025-10-20 is +86%. Trend, compare, unusual-days and weather results now warn about these days.
- **PM-only AQI estimates** stay internal (scripts/docs only). The known limits, including Delhi 481 vs 351, are in `backend/config/known_limits.json` and `/api/limits`.

## 8.4 Evaluation (first-pass results are the main results; reruns are separate)
**Independent references:** `evals/references.py` holds 24 values computed with pandas straight from Parquet, not through `backend.analysis`. 22 checks are wired into the main set and 7 into the Groq set.

| Run (first pass) | Model | Pass | Tool choice | Numbers traceable | Reference values | Refusals / unavailable | Tokens (median) |
|---|---|---|---|---|---|---|---|
| **Main, 47 q / 51 turns** (`20261105-1348_main_first`) | gemini-3.5-flash-lite | 47/50 | 100% | 100% | 21/21 | 13/14 | 3,602 |
| | model error (both Gemini models unavailable) | 0/1 (T5) | | | | | |
| **Holdout, 10 q / 11 turns** (`20261105-1417_holdout_first`) | gemini-3.5-flash-lite | 11/11 | 100% | 100% | — | 4/4 | 5,116 |
| **Groq, 15 q** (`20261105-1352`, `-1354`) | gpt-oss-120b | incomplete: 0/1 then stopped after 3 | | | | | |
| First agent version, main set (archived, older code) | gemini 47/48, gpt-oss 2/2 | 49/51 | | | | | 5,959 |

**Main first-pass failures:**
- T4: answered "Bangalore" where the check requires "Bengaluru".
- T5: both Gemini models were unavailable.
- D7: correct lower bounds, but the 999 warning wasn't in the text.
- M1: said "unavailable" rather than the required "not available".
- Reference values: 21/22 overall. The only miss is T5's error.

**Holdout finding (not fixed, because the holdout is not used for tuning):**
- H02 asked about the "2025 post-monsoon" season. The resolver doesn't read the year-first form, so the model fell back to all of 2025 (and said so).
- The automated checks passed it, which shows they're too shallow for period scope.
- Proposed: fix the resolver, then rotate in fresh holdout questions.

**Groq test:** not completed.
- The first run's G01 asked for clarification on a period format; the resolver now handles 2025-11, 11/2025 and Nov-2025.
- That run then crashed on a network error in the quota probe.
- The fresh run stopped at Groq's daily limit. Groq counts a rolling 24 h window, and earlier development runs had used 199,449 of 200,000 tokens.
- The guard now requires about 6K tokens of headroom before starting. Run `python scripts/run_eval.py --set groq` when quota frees (it stops on its own before any limit).

## 8.5 FastAPI (`backend/api/`)

> **Partly replaced.** Visitor identification by `X-Visitor-Id` was replaced on 2026-11-06 (Part 10: hashed IP from
> True-Client-IP / CF-Connecting-IP; X-Visitor-Id and X-Forwarded-For are not trusted). The single 150,000 daily
> token budget was replaced on 2026-11-06 by per-model daily budgets (Part 9). The token cap and request timeout
> are now set as in Part 11. `GET /api/visitor` and `GET /api/quota` were added later. The endpoint list below is
> otherwise current.

| Endpoint | Purpose |
|---|---|
| `POST /api/chat` | SSE stream: `meta → step* → answer → cards → chart → sources → warnings → done`, or `… → error → done`. Body `{message (1–500 chars), session_id?}` |
| `GET /api/health` | Instant status for cold starts: data loaded, AI configured (boolean only), budget left, data windows |
| `GET /api/meta`, `/api/limits` | Cities, pollutants, attribution, rule, demo questions; known limits |
| `GET /api/stations?city=` | Station list (tier, provider, coordinates) |
| `GET /api/cities` | Per city: last-30-day measured PM2.5/PM10 and latest official AQI |
| `GET /api/cities/{city}/summary?period=` | PM2.5 and PM10 summary for any period phrase |
| `GET /api/trends?city&pollutant&period&freq` | Full `city_trend` result with chart |
| `GET /api/coverage?city&period` | Coverage and quality, with calendar chart |
| `GET /api/diwali/{city}?years=` | Official AQI Diwali result (chart labelled by bulletin and 4 PM period) |
| `GET /api/accuracy` | Evaluation scoreboard (first pass and reruns, per model) |

**Request handling:**
- **Request IDs:** an `X-Request-ID` header is accepted if valid, otherwise generated. It appears in every error and in SSE `meta`/`done`.
- **Safe errors:** JSON `{error: {code, message, request_id}}`, with no tracebacks or provider text.
- **CORS:** from `ALLOWED_ORIGINS`.
- **Keys:** stay in the backend environment. Health only reports `ai_configured: true/false`.

**Demo protection:**
- Per-visitor rate limits (`X-Visitor-Id`, else client IP): 4/min and 30/day by default, with a 429 and `Retry-After`.
  *(Replaced: visitor = trusted client-IP header, Part 10; production limits can't be raised, Part 11.)*
- A per-question token cap (12,000) and a daily token budget (150,000). *(Replaced: per-model daily budgets, Part 9;
  one 12,000 cap for the run limit and the quota reservation, Part 11.)*
- An answer cache for repeated first-turn questions (6 h) and 8 pre-built demo answers (`data/app/demo_answers.json`), both served without an LLM.
- The `ai_limit` message is shown when the budget or a provider quota runs out.
- Data endpoints never call an LLM.

**Live check (uvicorn):**
- `/api/health`: 11 ms after start.
- Live question "Mumbai average PM10 from March to June 2026": 8.8 s, 3,391 tokens. Card 71.0 µg/m³ matches the independent reference.
- Demo replay: 13 ms.
- A burst from one visitor returned 200 ×4 then 429.

**Memory:** peak RSS 312 MB with the data, all endpoints and the agent built (macOS measurement), against Render's 512 MB.

# Part 9 — Shared AI quota across visitors (2026-11-06)

**Provider limits (stored in `backend/config/models.json` → `quota.providers`):**

| Model | RPM | TPM | RPD | Daily tokens | Day resets | Source |
|---|---|---|---|---|---|---|
| groq:openai/gpt-oss-120b | 30 | 8,000 | 1,000 | 200,000 (provider) | rolling 24 h | live headers + Groq docs |
| google:gemini-3.5-flash-lite | 15 | 250,000 | 500 | 800,000 (our budget) | midnight Pacific | owner's AI Studio, 2026-11-06 |
| google:gemini-3.8-flash | 5 | 250,000 | 20 | 80,000 (our budget) | midnight Pacific | placeholder, not checked |

Effective caps = limit × 0.8. Public visitors may use 85% of the daily caps; 15% is the demo reserve.

**Requests per question** (`scripts/measure_requests.py`, saved runs, no API calls): current code, 61
questions: mean 2.43, median 2, p90 3–4, max 4 (distribution 1:3, 2:33, 3:21, 4:4). The first agent version was
mean 2.70, max 5. A new question therefore reserves room for 4 requests.

**Capacity estimate (public caps, mean question):** Groq about 31 questions/day and 1.5/minute (TPM is the
bottleneck); Gemini Flash-Lite about 139/day (RPD) and 4.9/minute (RPM).

**Live check (3 questions, 2026-11-06):** the limiter worked with the real Groq and Gemini models.
First estimate (JSON chars / 4) was about 2× the real tokens and made Groq skip to Gemini on the 4th
request; recalibrated to chars / 7, now 1.33× real, and Groq answered a 3-request question alone.

## Part 9b — Gemini 3.1 Flash Lite added as a fallback (2026-11-06)

> **Chain replaced.** The "Final chain" at the end of this part (Groq first) was replaced the same day by the owner's
> order in Part 10, and on 2026-11-08 Groq was disabled (Part 11). Current live chain: gemini-3.5-flash-lite →
> gemini-3.1-flash-lite → gemini-3.8-flash (`backend/config/models.json`). The limits and the per-model quota
> finding below are still current.

Limits updated from AI Studio (its usage numbers are 28-day peaks, not today's use): Gemini 3.8 Flash
5 RPM / 250K TPM / 20 RPD; Gemini 3.1 Flash Lite 15 RPM / 250K TPM / 500 RPD (`gemini-3.1-flash-lite`,
the stable ID; a `-preview` ID also exists).

**Sample on gemini-3.1-flash-lite alone** (run `20261106-1154_main_model_check`, 13 questions, 14 turns):
13/14 pass; tool choice 10/10; numbers traceable 100%; reference values 7/7; refusals 5/6; 1 verifier retry
(D1, fixed on retry); tokens median 3,362, max 5,462. The miss (M1) said "currently unavailable" with
status `unavailable`; the check wants the words "not available" (same wording miss as 3.5 Flash-Lite).

**Separate quota, from the provider's response:** 20 sequential tiny requests in 51 s were all accepted;
a parallel burst of 20 got 9 x 200 and 11 x 429. The 429 body: `quotaId
GenerateRequestsPerMinutePerProjectPerModel-FreeTier`, `quotaDimensions {location: global, model:
gemini-3.1-flash-lite}`, `quotaValue 15`. A gemini-3.5-flash-lite request one second later returned 200,
and 3.1 Flash Lite still returned 429. Only the per-minute quota was observed directly; the daily quota
is assumed to be per model too (same quota family naming, and AI Studio lists it per model).

**Final chain:** Groq gpt-oss-120b → gemini-3.5-flash-lite → gemini-3.1-flash-lite → gemini-3.8-flash.
*(Replaced: see Part 10 and Part 11.)*

# Part 10 — Pre-frontend fixes and fresh holdout (2026-11-06)

**Model order (owner's decision):** gemini-3.5-flash-lite → gemini-3.1-flash-lite → Groq gpt-oss-120b →
gemini-3.8-flash. Change only if the full Groq test gives strong evidence. *(Replaced 2026-11-08: Groq disabled, Part 11.)*

**Rescoring of earlier runs (separate; headline first-pass scores unchanged):**

| Run | Original | With resolved check | Lenient wording |
|---|---|---|---|
| main first pass (1348) | 47/51 | 47/51 (35 checked from stored sources) | 50/51 (+T4, D7, M1) |
| holdout v1 (1417) | 11/11 | **10/11 — H02 used all of 2025 instead of Oct–Nov** | 11/11 |
| 3.1 Flash Lite check (1154) | 13/14 | 13/14 | 14/14 (+M1) |

**Fresh holdout v2, first pass (20261106-1213_holdout2_first):** 10/11 turns. Tool choice 100%, numbers
traceable 100%, references 7/8, resolved checks 7/8, refusals 100%. Answered by gemini-3.5-flash-lite (9 turns)
and gemini-3.1-flash-lite (2 turns, after the shared per-minute limit on 3.5 Flash-Lite). The failure, N07
("from August to October 2025"), was caught by the new resolved check: the model passed the period as
"2025-08-01..2025-10-31" (our own payload format), the resolver rejected it, and the model fell back to all
of 2025. Fixed generally (accept "a..b"); a separate rerun of N07 passed (51 µg/m³ = reference). The
first-pass score stays 10/11.

# Part 11 — Gemini-only chain, timeouts and limits (2026-11-08)

No data rules, analysis results or evaluation scores changed.

| Setting | Before | Now |
|---|---|---|
| Live model chain | 3.5 Flash-Lite → 3.1 Flash Lite → Groq gpt-oss-120b → 3.8 Flash | 3.5 Flash-Lite → 3.1 Flash Lite → 3.8 Flash. Groq kept in `models.json` with `"enabled": false`, not listed in `/api/health` or `/api/quota`; `run_eval.py --set groq` still tests it |
| Per-request timeout | none (only the 60 s question timeout) | 20 s per model request (`limits.model_request_timeout_s`); a timeout moves to the next model; all timed out → error `model_timeout` |
| Token cap per question | API 12,000 (`TOKENS_PER_QUESTION`), terminal/eval 16,000 (`models.json`), quota reservation 12,000 | one value, 12,000 (`limits.max_tokens_per_question`), used for the run limit and the reservation; env may only lower it |
| Rate limits | env could set any value | production (`RENDER` set or `SKYQ_ENV=production`) ignores values above 4/min and 30/day; `/api/health` shows the active limits |

**Why 12,000 tokens:** it equals what the shared quota reserves for a new question, so a question can't use more than
it reserved. The largest question on current code used 9,825 tokens (holdout2 first pass; main 7,993, holdout 7,666),
leaving about 20% headroom. 16,000 was only reached by the first agent version (17,449 max) before the token reduction.

**Why 20 s per request:** a question makes 2–4 model requests (mean 2.43) inside a 60 s question limit, so a stuck
request must fail early enough for a backup model to answer. Saved runs record time per question, not per request;
the 20 s choice is a judgement, to check in the first live runs.

Diwali percentage status in `data/app/manifest.json`: `approved_on_request_range` (approved 2026-11-04, see 7.1).
The per-window `percent_status` in `diwali_aqi_baselines` stays `pending_user_approval` (no single fixed baseline).
