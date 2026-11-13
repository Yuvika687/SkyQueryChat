# SkyQueryChat website plan

SkyQueryChat is a professional air quality website for six Indian cities, led by an interactive India map and an AI analyst that proves every number. Every page explains itself in one line, so a first-time visitor knows what it is for and how to use it without reading any theory.

## Pages

| Page | What it is for | How a visitor uses it |
| --- | --- | --- |
| Home (/) | See today's air across six cities at a glance | Read the map and city cards, or type a question |
| Explore (/explore) | Look closer at monitoring stations | Click a city, then a station; press play to see 30 days |
| Ask (/ask) | Get an answer to any air quality question | Type a question; click any number to see its proof |
| City (/city/[name]) | Full profile of one city | Scroll the trend, calendar, Diwali and stations |
| Compare (/compare) | Compare cities side by side | Pick cities, pollutant and period |

There is no separate "How it works" page and no long explanation text anywhere. Data sources and accuracy live in one small "Data & accuracy" panel opened from the footer.

## Making every page easy to understand

- Each page starts with a one-line title that says what it is for.
- A short usage hint sits next to the main control (for example, "Click a city to see its stations"). It is one line and can be dismissed.
- Every number shows its unit, category and date.
- The pollution scale bar shows where a value sits from Good to Severe, so no prior knowledge is needed.
- Empty, loading and error states say what is happening and what to do next.

## Design language

A premium, professional data product: calm, confident and clear, not a dashboard template.

| Element | Direction |
| --- | --- |
| Base | Deep navy with layered surfaces |
| Accent | One accent colour; CPCB category colours used only for data |
| Panels | Translucent floating panels over the map |
| Typography | A refined display font for headlines, a clean sans font for text, even-width numerals for figures |
| Numbers | Large hero figures that count up when they appear |
| Motion | Subtle transitions and animated agent steps; disabled for reduced-motion users |
| Charts | Custom-styled, readable labels, visible data gaps |
| Navigation | Slim floating top bar on desktop, bottom bar on phones |

### Signature elements

1. **Living map:** six cities glow in their pollution colour, with a play button that animates 30 days of real data.
2. **Pollution scale bar:** a gradient from Good to Severe with a marker for the value.
3. **Animated agent steps:** the AI's plan and tool use appear step by step as it works.
4. **Proof drawer:** click any number to see the data, method and stations behind it.

## Page details

### Home

- Full-screen India map hero with the six cities glowing in their latest PM2.5 category
- Headline "Ask India's air anything" and a floating question box with 4 suggested questions
- "Latest available" badge with the exact date
- Six city cards: value, category, scale bar and 7-day sparkline; each opens its city page
- "Three ways to use SkyQueryChat": Ask, Explore and Compare, one line each
- Footer with data sources and the Data & accuracy panel

### Explore

- Click a city to fly into its stations; markers coloured by category, grey when data is insufficient
- Station panel: provider, monitor type, value, category, valid hours, last update, sparkline and "Ask about this station"
- 30-day playback slider, PM2.5 and PM10 toggle, low-cost sensor toggle
- City ranking side panel and a one-line map legend

### Ask

- Insight card: model-written headline, key numbers with scale bars and a short explanation
- Chart chosen for the question
- Animated agent steps while it works, collapsing afterwards
- Proof drawer for every number, evidence line, warnings and data-type badge
- 2-3 follow-up questions and chat history in the browser
- Natural wording and readable dates

### City pages

- Latest value, category and stations reporting
- 30-day trend and monthly calendar heatmap
- Diwali official AQI for 2024, 2025 and 2026
- Unusual days, weather association, station list and coverage
- "Ask about this city" button

### Compare

- Pick 2-6 cities, a pollutant and a period
- Multi-line chart over matching dates, ranking with confidence intervals, trend direction with significance
- "Explain this with AI" button that opens Ask

## Work left

| Step | Work | Priority |
| --- | --- | --- |
| 1 | Three design directions as screenshots, then choose one | Must |
| 2 | Design system, navigation and Home page | Must |
| 3 | Explore map with fly-in, station panel and playback | Must |
| 4 | Ask redesign, wording fixes and proof drawer | Must |
| 5 | Stronger analysis: multi-line comparison, weather trend, confidence intervals, significance | Should |
| 6 | City pages and Compare page | Should |
| 7 | Data & accuracy panel, mobile polish, speed, accessibility, README and demo video | Must |

## Rules that stay fixed

- Real data only; never invent values or markers.
- Never interpolate between stations or draw heat surfaces where no monitors exist.
- Never call the data live; show "latest available" with exact dates.
- The AI writes answers, Python calculates every number, the checker verifies them.
- Keep measured, modelled and official AQI data separate; AQI and PM on separate charts.
- Weather results are associations, never causes.
- Show India's boundary as per the Government of India's official map.
- Fast, responsive, keyboard accessible, no colour-only meaning.
- Never use phase or day labels in commits, docs, code or the interface.
