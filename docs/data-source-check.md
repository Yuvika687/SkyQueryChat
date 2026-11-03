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
