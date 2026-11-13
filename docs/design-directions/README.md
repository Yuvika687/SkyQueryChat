# Design directions

Three clearly different looks for SkyQueryChat, each shown on the same two screens: **Home** and an **Ask answer**.
They are standalone mockups. The live app is unchanged. Pick one direction, and the rebuild will follow it.

All screenshots are in `screenshots/`, at 2x scale:
- Desktop pages are 1440 px wide and phone pages 390 px wide, captured full page.
- The Ask screen with the proof drawer open is captured at the visible window size: 1440x900 on desktop, 390x844 on phone.

| Screen | A · Night Observatory | B · Broadsheet | C · Instrument |
| --- | --- | --- | --- |
| Home, desktop | `a-night-observatory--home--desktop.png` | `b-broadsheet--home--desktop.png` | `c-instrument--home--desktop.png` |
| Home, phone | `a-night-observatory--home--mobile.png` | `b-broadsheet--home--mobile.png` | `c-instrument--home--mobile.png` |
| Ask, desktop | `a-night-observatory--ask--desktop.png` | `b-broadsheet--ask--desktop.png` | `c-instrument--ask--desktop.png` |
| Ask, phone | `a-night-observatory--ask--mobile.png` | `b-broadsheet--ask--mobile.png` | `c-instrument--ask--mobile.png` |
| Proof drawer open, desktop | `a-night-observatory--ask-proof--desktop.png` | `b-broadsheet--ask-proof--desktop.png` | `c-instrument--ask-proof--desktop.png` |
| Proof drawer open, phone | `a-night-observatory--ask-proof--mobile.png` | `b-broadsheet--ask-proof--mobile.png` | `c-instrument--ask-proof--mobile.png` |

## A · Night Observatory

India's map fills the whole first screen, like a night sky. The six cities glow in their category colour, and every control floats above the map on translucent panels. It feels calm, premium and cinematic, with an elegant serif headline over a quiet sans-serif interface. The proof drawer slides in as a frosted panel on the right.

| | |
| --- | --- |
| **Fonts** | Instrument Serif (headlines), Inter (text and figures, with tabular numerals) |
| **Base** | `#060A14` page, `#111A2F` panels, translucent `rgba(16,25,46,0.72)` floating panels |
| **Text** | `#EAF0FB` main, `#A9B6D0` secondary, `#8391AE` captions |
| **Accent** | Teal `#2DD4BF` (buttons, focus, links) |
| **Layout** | Full-bleed map hero with the headline column on the left, then a 3x2 grid of rounded cards; a centred answer column; a floating pill nav, and a floating tab bar on phones |

## B · Broadsheet

This direction reads like a serious newspaper's data desk: an editorial serif headline, hairline rules, square corners and no glow. The map is a framed figure with a caption, and the city cards form a ruled table with large monospaced figures. The answer is laid out as an article with a margin rail for evidence. The proof opens as an ivory "paper" sheet, which makes the source behind each number stand out.

| | |
| --- | --- |
| **Fonts** | Newsreader (headlines and reading text), IBM Plex Sans (interface), IBM Plex Mono (figures) |
| **Base** | `#11100E` warm ink black, `#181715` raised, `#34312C` rules; proof sheet `#F3EEE4` with `#1B1A17` ink |
| **Text** | `#EFE9DD` main, `#B9B1A3` secondary, `#8F887C` captions |
| **Accent** | Periwinkle `#A9B8FF` (button, links, active tab, highlighted numbers) |
| **Layout** | Split hero, with an editorial column on the left and a framed map on the right; ruled 3-column city table; article plus margin rail; full-width tab bar on phones |

## C · Instrument

This direction feels like a precise analysis workstation: graphite panels, a faint dot grid and compact readouts. The question box works like a command line. Next to the map, a ranked readout rail lists the cities from highest to lowest. The Ask screen is a two-pane workspace, with the conversation on the left and an evidence inspector on the right. The proof replaces the inspector, so the answer always stays visible.

| | |
| --- | --- |
| **Fonts** | Space Grotesk (headlines), Geist (text), Geist Mono (figures and labels) |
| **Base** | `#0A0C0F` page with a dot grid, `#101318` panels, `#151A21` raised, `#222A34` borders |
| **Text** | `#E7ECF2` main, `#A3AFBD` secondary, `#7C8796` captions |
| **Accent** | Sky blue `#5CC8FF` (button, focus, highlighted numbers, map outline) |
| **Layout** | Headline with a command bar, then a map panel beside a ranked city rail and three tiles; a two-pane Ask workspace; the proof inspector becomes a bottom sheet on phones |

## Shared in all three

**Real data only.** Every number comes from `shared/data.js`, which `build_data.py` writes from the project's own files:
- **Home:** each city's PM2.5 24-hour city average for the latest available day, 11 Nov 2026 (`data/app/city_daily.parquet`).
  - The sparklines show the 7 days from 5 to 11 Nov 2026.
  - "Stations" is the number of reference stations that reported that day.
  - The map markers sit at the mean position of each city's primary stations (`data/app/stations.parquet`).
- **Ask:** the real first-pass answer to evaluation question E01, "How bad was Delhi's air on Diwali 2026?", from run `evals/runs/20261112-1507_diwali2026_first` (gemini-3.5-flash-lite, 9.4 s, 10 numbers checked).
  - The proof drawer lists the two CPCB bulletin rows behind its numbers (`data/app/city_daily_aqi.parquet`).
  - Only the dates are reformatted for reading, for example "26 Oct – 11 Nov 2026". The answer text is the model's own.
- **Wording:** "Latest available" is used everywhere; nothing is called live.

**Map.**
- **Basemap:** the OpenFreeMap "dark" vector style. It needs no API key and is free with no view limits. Its attribution is "OpenFreeMap © OpenMapTiles Data from OpenStreetMap" (code MIT, data ODbL). Its border, label and road layers are removed, so only land and water remain.
- **India's boundary:** drawn on top from DataMeet's `india-composite.geojson`. That file follows the official boundary of India as per the Survey of India and is released as CC0.
  - `simplify_boundary.py` simplifies it to 4,929 points.
  - All 80 parts are kept, including every Andaman and Nicobar and Lakshadweep island.
- **Fallback:** if WebGL or the basemap cannot load, the same official outline is drawn as SVG with the same markers.
- **Other rules:** there are no heat surfaces and no values between cities.
- **Attribution:** shown on every home screen.

**Colour and accessibility.**
- **CPCB colours:** the category colours (from `docs/ui-design-spec.md`) are used only for data, meaning map glows, chips, scale bars and chart dots.
- **Never colour alone:** every coloured item also shows the category name, or for chart dots, a labelled key.
- **One change from the spec:** "Very poor" chips use dark text `#1A0404`. White text on `#EF4444` is only 3.8:1, while dark text is 5.2:1.
- **Contrast against each page background** (all pass WCAG AA's 4.5:1):

| Direction | Main text | Secondary | Captions | Button text |
| --- | --- | --- | --- | --- |
| A | 17.3 | 9.7 | 6.2 | 8.9 |
| B | 15.7 | 8.9 | 5.4 | 9.5 |
| C | 16.5 | 8.8 | 5.4 (4.8 on panels) | 9.8 |

**Behaviour.**
- Each screen has a one-line purpose and a one-line usage hint next to its main control.
- Clicking an underlined or highlighted number opens the proof drawer; Escape closes it.
- Motion is switched off for visitors who ask for reduced motion.
- Phones get a bottom tab bar.

## Rebuild the data and screenshots

```bash
.venv/bin/python docs/design-directions/build_data.py
python3 -m http.server 8765 --directory docs/design-directions &
node docs/design-directions/capture.mjs          # needs the frontend's Playwright install
```

The mockups load Google Fonts, MapLibre GL 4.7.1 (unpkg) and OpenFreeMap tiles, so they need an internet connection.
