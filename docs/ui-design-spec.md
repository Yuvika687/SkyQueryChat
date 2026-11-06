# SkyQueryChat UI design spec

SkyQueryChat is a dark, map-led air quality analyst with three screens: Explore, Ask and Accuracy. Every number shown must carry its unit, source, data type and freshness.

## Design direction

The product should feel like a calm intelligence workspace: the map creates impact, the chat gives depth, and the evidence builds trust. The signature element is the evidence bar under every answer.

| Reference | Keep | Avoid |
| --- | --- | --- |
| Dark map dashboard | Dark map, compact cards, watchlist layout | A forecast heatmap without a real forecast source |
| Delhi analytics dashboard | Time-range control, metric cards, multi-city summaries | "ppm" for particulate matter, noise data, news feed |
| Delhi AQI map | Numbered markers, station detail panel | Full-screen red areas, non-Indian category names |
| Agent chat with chart | Visible steps and charts inside the chat | Smoothed lines, raw SQL shown to normal users |
| Banking AI assistant | Clean sidebar and polished chat layout | Decoration that competes with the data |
| Chat beside dashboard | Answers paired with evidence | A dense wall of charts |

## Screen layouts

The website has three screens. Accuracy uses a simpler report layout.

### Explore layout

- Left: sidebar with Explore, Ask and Accuracy.
- Top: bar with city, pollutant and data freshness.
- Main area: a large station map with markers, legend and filters.
- Below the map: six city cards.
- Bottom: city ranking and an "Ask a question" bar.
- The right panel appears when a station is selected.

### Ask layout

- Left: sidebar with recent chats.
- Top: bar with city, pollutant and data freshness.
- Centre column, in order: direct answer, metric cards, interactive chart, evidence bar and question composer.
- Right: agent timeline.

## Design system

Use deep navy surfaces, one teal accent, and pollution colours only for data meaning. The pollution ranges below are from India's National AQI table, while the hex values are tuned for this dark interface.

### Core colours

| Token | Hex | Use |
| --- | --- | --- |
| Background | #0B1020 | Page background |
| Surface | #121A2E | Cards, sidebar and panels |
| Raised surface | #1B2540 | Hover, popovers and selected rows |
| Border | #2A3556 | Dividers and card outlines |
| Primary text | #E6EAF5 | Headings, values and body text |
| Secondary text | #94A0BC | Labels, timestamps and helper text |
| Accent | #2DD4BF | Primary actions, focus and active navigation |
| Accent hover | #5EEAD4 | Hovered primary actions and links |
| Modelled data | #A78BFA | Modelled badges and dashed chart lines |
| Warning | #F5B942 | Low coverage, stale data and notices |
| Error | #F87171 | Failed actions only |

### Pollution categories

Categories use 24-hour averages. Round values first, then assign a category.

| Category | PM2.5 (µg/m³) | PM10 (µg/m³) | Hex | Marker text |
| --- | --- | --- | --- | --- |
| Good | 0–30 | 0–50 | #22C55E | Dark |
| Satisfactory | 31–60 | 51–100 | #A3E635 | Dark |
| Moderate | 61–90 | 101–250 | #FACC15 | Dark |
| Poor | 91–120 | 251–350 | #FB923C | Dark |
| Very poor | 121–250 | 351–430 | #EF4444 | White |
| Severe | Above 250 | Above 430 | #B91C1C | White |
| No valid average | No category | No category | #64748B | White |

Show the label as "PM2.5 category" or "PM10 category". Don't call it overall AQI, because that needs at least three pollutants.

### Type, spacing and shape

| Element | Specification |
| --- | --- |
| Interface font | Inter |
| Figure font | JetBrains Mono |
| Page title | 24/32 px, semibold |
| Section title | 18/26 px, semibold |
| Body text | 14/22 px, regular |
| Labels and captions | 12/16 px, medium |
| Main metric | 28/34 px, medium, monospaced |
| Spacing scale | 4, 8, 12, 16, 24, 32 and 48 px |
| Corner radius | 8 px controls, 12 px cards, 16 px large panels |
| Borders | 1 px solid Border token |
| Icons | Lucide outline icons, 16 or 20 px |
| Motion | 150–200 ms ease-out, disabled for reduced-motion users |

## App shell

Every screen shares a slim sidebar and a 56 px top bar, so users always know the selected city, pollutant and data freshness.

| Element | Size or position | Contents |
| --- | --- | --- |
| Sidebar | 240 px, collapses to 64 px | Logo, Explore, Ask, Accuracy, recent chats |
| Top bar | 56 px high | Page title, city selector, PM2.5 and PM10 toggle, freshness pill |
| City selector | Top bar | Delhi, Mumbai, Kolkata, Chennai, Bengaluru, Hyderabad |
| Freshness pill | Top bar, right side | "Station data updated" time, or a warning during an outage |
| Footer note | Below page content | OpenAQ, CPCB, Open-Meteo and map attribution |

Recent chats can be stored only in the visitor's browser, so the app doesn't need login.

## Explore screen

Explore is the landing page: users see station conditions first, then move into a city or ask a question. The main hierarchy is map, city cards, then ranking.

### Map

- Start with an India view showing six labelled city hubs.
- Clicking a city zooms to its station markers.
- Each marker is a 32 px rounded square showing the 24-hour mean.
- Marker colour shows the pollutant category, and the selected marker gets a 2 px teal ring.
- Hovering shows station name, value, unit and last-updated time.
- Grey markers mean there aren't enough valid hours for a 24-hour average.
- Reference monitors are visible by default. A "Low-cost sensors" toggle reveals sensors separately.
- Controls sit top right: zoom, reset view and monitor filter.
- The category legend sits bottom left.

### Station panel

Clicking a marker opens a 360 px right panel:

- Station name, city, provider and monitor type
- 24-hour PM2.5 and PM10 means with category chips
- Latest reading, last-updated time and valid hours
- A 7-day sparkline with gaps preserved
- An "Ask about this station" button

### City cards

Show six cards below the map, with 3 columns on large screens. Each card includes:

- City name and selected pollutant
- 24-hour city mean in µg/m³
- Category chip
- 7-day sparkline
- Change from the previous 7 days
- Stations reporting, such as "12 of 18"
- Last-updated time

### Ranking and question bar

Add a compact horizontal bar ranking for the six cities, sorted highest to lowest. Below it, add a question bar with the prompt "Ask about air quality in these cities".

## Ask screen

Ask is the main product experience: the user sees the agent work, then receives an answer with evidence. Use a centred conversation up to 760 px wide and a 320 px agent panel on the right.

### Empty state

Show the heading "What do you want to know about the air?" and these question cards:

- Compare Delhi and Mumbai over the last 30 days
- Was Delhi worse around Diwali 2025 than Diwali 2024?
- Show PM2.5 levels in Kolkata for the last 30 days
- Which days were unusually polluted in Delhi?
- How did wind speed relate to PM2.5 in Hyderabad?

The Diwali answer uses official CPCB AQI for all six cities. Delhi PM2.5 and PM10 appear only as supporting context.

### Answer structure

Each answer appears in this order:

1. **Direct answer:** one or two plain sentences.
2. **Metric cards:** two to four key numbers with units and periods.
3. **Chart:** the best visual for the question.
4. **Explanation:** what changed, what the comparison means, and any caveat.
5. **Evidence bar:** data type, period, stations, valid coverage and source.
6. **Actions:** view data table, download CSV, download PNG and copy answer.
7. **Follow-ups:** up to three suggested questions.

### Evidence bar

Use small chips in one row: Measured, Modelled or Official AQI, interpreted date range, station count, coverage percentage, and source. Clicking a chip opens the detail. Low coverage uses the Warning colour and explains the problem in words.

### Agent timeline

The right panel shows plain-language steps as they happen:

1. Understanding the question
2. Finding cities and dates
3. Loading station data
4. Running the calculation
5. Adding weather context, when needed
6. Checking every number
7. Preparing the answer

Each step has waiting, running, done, warning or failed status, and can expand to show the input summary, result summary and duration. Don't show raw prompts or API keys.

### Composer

The fixed bottom composer includes an expanding text box, Send, Stop while generating, and a small note: "Answers use the data available and may contain gaps."

## Accuracy screen

Accuracy proves that the project is a tested analytics system, not a scripted demo. Every number here must come from a real evaluation run.

| Section | What it shows |
| --- | --- |
| Summary cards | Questions tested, correct tool choice, numeric match rate, correct "no data" handling |
| Evaluation table | Question, expected tools, result, pass or fail, and notes |
| Official data check | Sample calculated values compared with CPCB records |
| Coverage grid | Valid data by city and month |
| Data sources | What each source provides, measured or modelled, date range and licence |
| Methods | City averages, valid-hour rules, unusual-day method and Diwali baseline |
| Known limits | The late 2022 to February 2025 gap, feed outages and unavailable data |

Show the evaluation date and app version at the top. Use the empty state "Evaluation has not been run yet" until real results exist.

## Charts

The question decides the chart, and every chart must make its time period, unit and data type obvious.

| Question | Main chart | X axis | Y axis | Required details |
| --- | --- | --- | --- | --- |
| 30-day trend | Daily line | Date | µg/m³ | 7-day rolling mean, reference lines, visible gaps |
| City comparison | Multi-line | Date | µg/m³ | Direct city labels and matching date range |
| Today's ranking | Horizontal bars | µg/m³ | City | Zero baseline and sorted values |
| Diwali comparison | Aligned multi-line | Days from Diwali | Official AQI | Festival band, baseline dates, and levels shown before any percentage |
| Unusual days | Line with dots | Date | µg/m³ | Rolling median, flagged days and reason |
| Long-term pattern | Calendar heatmap | Day | Month | Category colours and grey missing days |
| Weather relationship | Scatter | Weather value | µg/m³ | Trend line, correlation and number of days |
| Weather over time | Two stacked lines | Date | Separate panels | Shared time axis, no dual-axis chart |

### Chart rules

- Use straight line segments, not smoothed curves.
- Leave a gap where data is missing.
- Keep AQI and PM values on separate charts.
- Use solid lines for measured data and dashed Modelled colour lines for modelled data.
- Start bars at zero.
- Add WHO and India reference lines as thin dashed lines when they help.
- Support hover values, zoom, data table, CSV and PNG.
- Keep to six city colours: Delhi #2DD4BF, Mumbai #60A5FA, Kolkata #F59E0B, Chennai #F472B6, Bengaluru #A78BFA and Hyderabad #E2E8F0.
- Reference values: WHO 24-hour PM2.5 is 15 µg/m³ and PM10 is 45 µg/m³. India's PM2.5 standard is 60 µg/m³. Confirm India's PM10 reference before launch.

## Data shown

Use real API responses in the final UI, and clearly label any design-only sample values while you are drawing screens.

| UI item | Source | Unit or format | Rule |
| --- | --- | --- | --- |
| Station name, location and provider | OpenAQ API | Text and coordinates | Show provider on station details |
| Latest reading | OpenAQ API | µg/m³ | Show with exact last-updated time |
| 24-hour station mean | Python calculation | µg/m³ | Needs at least 16 valid hours |
| City mean | Python calculation | µg/m³ | Show stations used and coverage |
| 7-day and 30-day trend | OpenAQ archive and recent API data | µg/m³ | Keep gaps visible |
| Historical CPCB data | OpenAQ archive | µg/m³ | Most stations start from 18 February 2025 after the gap |
| Official Diwali AQI | CPCB bulletin | AQI | Never mix with PM charts |
| Weather | Open-Meteo Weather | °C, %, km/h, mm | Label as modelled and include Open-Meteo and Copernicus attribution |
| Modelled pollution | Open-Meteo Air Quality | µg/m³ | Use only with a Modelled label |
| Unusual-day flags | Python calculation | Value and baseline | Explain the method used |
| Agent steps | Backend stream | Status and duration | Show plain-language summaries |
| Accuracy results | Evaluation runs | Counts and percentages | Show run date and version |

Diwali dates in the app are 31 October 2024, 20 October 2025 and 8 November 2026. Delhi's 2024 window also includes 1 November, and bulletin values use CPCB's 4 PM reporting period. Delhi PM supporting context must warn that readings above 999 µg/m³ are blank in this source, and it must not show PM percentage changes.

## Screen states

Design the failure states too, because air quality feeds have real gaps and outages.

| State | What the user sees |
| --- | --- |
| Loading map | Dark map skeleton and a small "Loading stations" label |
| Loading answer | Agent timeline plus an answer skeleton |
| Backend waking up | "Starting the analysis service. This can take up to a minute." |
| No question yet | Empty state with suggested questions |
| Station stale | Grey marker, last-updated time and "No recent data" |
| Provider outage | Warning banner: "CPCB updates are delayed. Showing the latest available data." |
| Low coverage | Warning chip and a short explanation |
| No measured data | "Measured data isn't available for this period" with available alternatives |
| Modelled fallback | Modelled badge and dashed line |
| Diwali 2026 not available | "Diwali 2026 falls on 8 November. Data isn't available yet." |
| Rate limit | "The AI service is busy. Try again in a moment." |
| Request failed | Plain message with Retry, without technical error text |
| Unsupported city | Explain the six supported cities and offer them as chips |

## Responsive and accessibility rules

Design for desktop first because placement reviewers will likely open it on a laptop, then adapt it cleanly for phones.

| Width | Layout |
| --- | --- |
| 1280 px and above | Sidebar, main content and right panel |
| 768–1279 px | Collapsed sidebar, agent panel as a drawer |
| Below 768 px | Bottom navigation, 45% screen-height map, single-column cards, station details as a bottom sheet |

Accessibility rules:

- Never use colour alone. Always show the value or category.
- Keep normal text contrast at 4.5:1 or higher.
- Make every chart available as a data table.
- Give all controls visible keyboard focus.
- Keep touch targets at least 44 px high on phones.
- Announce new agent steps to screen readers.
- Turn off non-essential motion for reduced-motion users.

## Build priority

Build the Ask screen first, because it proves the agent. Then build the map, and polish the remaining details if time allows.

| Priority | Feature |
| --- | --- |
| Must ship | Ask screen, agent timeline, answer cards, evidence bar, line and comparison charts, unusual-day chart |
| Must ship | Explore map, station panel, six city cards, freshness and error states |
| Must ship | Accuracy screen with real test results |
| Should ship | Weather scatter, Diwali chart, CSV and PNG downloads, low-cost sensor toggle |
| Later | Calendar heatmap, mobile polish, station comparison and modelled forecast view |

### Open questions

- Which free map tiles will be used, and what attribution do they need?
- Does Next.js support the installed Node version?
