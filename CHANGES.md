# Changes in this package (17 Nov 2026)

Starting point: GitHub `main` at commit `41b1f79` ("Refresh the review screenshots with the chat-first Ask page").
Deploy steps: [DEPLOY.md](DEPLOY.md).

## 1. Official AQI for every city in CPCB's daily bulletin

The six metros keep their full station-level PM analysis. Every other bulletin city now has official AQI only.

- **Data:** new table `data/app/city_aqi_all.parquet`: 329 cities, 150,757 rows, 18 Feb 2025 to 16 Nov 2026,
  0.3 MB (the whole span is kept; `data/app` is 3.7 MB, well under the 8 MB guard). Built from UrbanEmissions' parsed
  bulletins and then CPCB's own PDFs (`load_all_bulletins` in `backend/pipeline/build.py`), and rebuilt by the daily
  refresh. A city listed twice in one bulletin with different values (Kalyan, 6–16 Nov 2026) is dropped for that date
  and recorded in the manifest, never guessed. `scripts/build_city_aqi_all.py` rebuilds only this table.
- **City names:** `backend/analysis/official_aqi.py` understands every bulletin city, older names (Bangalore → Bengaluru,
  Bombay → Mumbai, Gurgaon → Gurugram, Banaras → Varanasi…) and small misspellings ("Lucknoww"). A place outside the
  bulletin gets an honest message plus the three nearest covered cities ("Shimla isn't in CPCB's daily AQI bulletin.
  The nearest cities it covers are Baddi, Chandigarh and Panchkula.").
- **Map locations:** `backend/config/cpcb_city_coordinates.json` from GeoNames (CC BY 4.0,
  `scripts/build_city_coordinates.py`): 300 of 329 cities have a confident match; the other 29 are listed, not plotted.
- **AI tool:** `official_aqi(city, period)`: latest AQI, category, main pollutant, change from the previous bulletin,
  and the period's mean, highest, lowest and trend, all calculated in Python and covered by the number checker.
  Non-metro answers carry the note that station-level PM analysis covers only the six cities. "This week" counts back
  from the latest bulletin.
- **API (read-only, no AI):** `/api/aqi/cities` and `/api/aqi/city/{name}`.
- **Explore:** a layer switch "Six cities (stations) / All CPCB cities": small dots coloured by category, six metros
  highlighted, hover cards, a searchable list, and a city panel (AQI, category, main pollutant, change, 30-day chart with
  gaps, "Ask about this city"). The selection is kept in the address (`?layer=cpcb&cpcb=Lucknow`).
- **Home:** "Find your city" search across all bulletin cities; it opens that city's panel on Explore.
- Every value is labelled "Official AQI (CPCB 4 PM bulletin, <date>)". GeoNames is credited on the map and in the
  Data & accuracy panel.

## 2. Answers are always live

- Saved demo answers are no longer served first: every question goes to live Gemini. Saved answers are used only as an
  emergency fallback when the day's AI quota is used up (the 6-hour cache of live answers stays, to save quota).
- Answers and suggestions never imply live data: "right now", "today", "currently" are rejected by the checker
  ("latest available" instead).
- The code-written fallback for trend answers now always states the trend result, including "no clear trend".
- Answers name a city as the bulletin does (Bengaluru, not Bangalore).

## 3. UI polish (same colours and fonts)

- **One design system** (`frontend/src/app/globals.css`): one card style (`card`), soft tint tiles inside cards
  (`tile`, no nested borders), one page-title style on every page, body text 15 px, fewer divider lines.
- **Navigation bar** is fully opaque with a solid band behind it, so content never shows through (was broken on Compare).
- **Ask:** no title row (New chat / Recent chats are small icon buttons on the content line); each answer is one block:
  meta line (data type · period · "✓ N numbers checked" · copy and link), a 21 px headline with bold, clickable numbers,
  2–4 key-number tiles (comparisons get a "3.1× · +105.0 µg/m³" tile), short explanation, one "What this means" callout
  with CPCB's health statement, follow-up chips. Live steps collapse into one small line. The evidence panel has three
  clean tabs (Chart, Data, How it was made). The sources line is a small "Sources" link under the input.
- **Compare:** two columns on wide screens (slim controls left, results right), a summary strip (highest city, lowest
  city, ratio or "too close to call", calculated in Python), one action row (Copy link, Download CSV, Explain this with
  AI), clean ranking rows with 95% range bars, trend badges (Rising / Falling / No clear trend) and coverage warnings.
- **Explore:** the six city dots in the India view were made robust (they no longer depend on a one-time map "idle"
  signal) and gained hover cards; the long full-forms paragraph is one line with tooltips; the timeline mini chart has
  thin, subtle lines and the Diwali marker.
- **Home and City pages:** the shared card, spacing and type scale; no footer divider.

## 4. Fixes found on the way

- All text files are read and written as UTF-8, so "µg/m³" shows correctly on Windows too.
- `frontend/scripts/copy-maplibre-worker.mjs` works on Windows paths.
- GitHub Actions in `refresh-data.yml` updated to Node 24 versions (checkout v7, setup-python v7, cache v6).

## 5. Tests and checks (run on this machine, 17 Nov 2026)

| Check | Result |
|---|---|
| Backend tests (pytest) | 336 passed, 2 skipped (the Linux-only memory check and one CI-only test) |
| Frontend unit tests (Vitest) | 80 passed |
| Lint, typecheck, production build | pass |
| Browser tests (Playwright, desktop, tablet and phone) with axe accessibility | 102 passed, 15 skipped by screen size, 0 failed; no serious or critical accessibility issues on any page (`review.spec.ts`, a screenshot generator, was not run) |
| Live non-metro questions (real Gemini) | 5/5 after one wording fix (Lucknow, Pune this week, Bangalore, Shimla, "Lucknoww"), every number traced |
| Backend memory after every data endpoint, the agent and live answers | about 300 MB peak (Render limit 512 MB) |

New tests: `tests/test_official_aqi.py`, `tests/test_wording.py`, `frontend/src/lib/cpcb.test.ts`, and Explore browser
tests for the six dots and the all-cities layer. Screenshots of every page at 1440×900 and 390×844:
`docs/screenshots/current/` (regenerate with `node frontend/scripts/capture-screens.mjs`).

## 6. Still open

- The full first-pass run of `evals/conversation.json` (19 questions) is waiting for the Gemini quota to reset: today's
  evaluation runs had used 601k of the 680k-token safety cap. Run after midnight Pacific time:
  `python scripts/run_eval.py --set conversation`.
- After deploying, ask "AQI in Lucknow" on the live site and confirm the daily refresh workflow runs green.

## 7. Follow-up on the same day: backup key, answer fixes and a livelier interface

- **Backup Gemini key:** set `GEMINI_API_KEY_2` on Render (ideally a key from a different Google project). When the first
  key's models run out, the app uses the same models on the backup key. Checked: the first key's `gemini-3.5-flash-lite`
  had used its daily quota, which is why answers fell back and some failed.
- **Fixes in answers:** Diwali 2026 can be named as 8 Nov (it was rejected before); a new question no longer shows
  numbers from an earlier question in its tiles and Data tab; a repeated tile (Diwali 2025 twice) is gone.
- **Compare:** official AQI for any of 329 bulletin cities (search box), 2026 periods (2026 so far, summer, monsoon,
  post-monsoon, Diwali 2026) as chips.
- **Look and feel (same colours and fonts):** animated India map on Home with every bulletin city as a coloured dot,
  "Across India" section, word-by-word headline, live counters, sliding tab highlights, glowing cards, a moving border on
  the Ask box, a softer Ask start screen, AQI charts coloured by category. Explore's city panel keeps its title in view.

## 8. Any festival or date, and all pages polished

- **Ask about any festival or any date, for any of 329 bulletin cities:** Holi, Dussehra, Durga Puja, Navratri, Karva
  Chauth, Dhanteras, Govardhan Puja, Bhai Dooj, Chhath, Guru Nanak Jayanti, Eid, Bakrid, Christmas, New Year, Lohri,
  Makar Sankranti, Republic Day, Independence Day, Raksha Bandhan, Janmashtami, Ganesh Chaturthi, Onam, Shivratri, or a
  date such as "9 November". The answer gives the bulletins that cover the day and its night, the average, the week
  before and the change. Moon-dependent dates are flagged; every answer states the date used.
- **Diwali for any bulletin city:** "Rohtak AQI on Diwali 2025 and 2026" now answers 362.5 and 306.5 (Very Poor). It
  used to say Rohtak was not covered.
- Checked live (Gemini): Rohtak Diwali, Delhi Holi 2026 (151.5, Moderate), Lucknow on 9 November, Patna on Chhath,
  Jaipur on New Year 2026, Rohtak vs Delhi on Diwali 2026; all answered with every number checked.
- **Pages:** Compare (animated title, tinted summary tiles with count-up, "At a glance" bars, glowing city toggles), Ask
  (festival question strip, answers rise in with a running light, tinted number tiles) and Explore (glass panels, title
  chip, lists that stagger in). Same colours and fonts; all motion off with reduced motion.
- Tests: `tests/test_occasions.py` (7), `frontend/src/lib/event-chart.test.ts` (2).
