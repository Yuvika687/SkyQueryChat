# Demo script (about 2½ minutes)

Shot list for a screen recording at 1440×900. The silent walkthrough in `docs/demo/walkthrough.mp4` (1 min 31 s,
recorded with Playwright on the local production build) follows these shots at a faster pace; for a narrated video,
record live with the lines below and hold each shot for the time shown.

| # | Time | Screen | What to click | What to say |
|---|---|---|---|---|
| 1 | 0:00–0:15 | Home | Nothing; let the map settle. | "SkyQueryChat is an AI air-quality analyst for six Indian cities. Every number it shows comes from real monitoring data and can be traced to its source." |
| 2 | 0:15–0:30 | Home, city cards | Scroll to "Six cities, highest first". | "Home shows the latest available 24-hour PM2.5 for each city, with its CPCB category and the last seven days." |
| 3 | 0:30–0:55 | Explore | Click **Explore**, then **Delhi**, then **Play 30 days**. | "Explore puts every monitoring station on the map. Play steps through the last 30 days; grey stations didn't have enough valid hours that day, so they show no value instead of a guess." |
| 4 | 0:55–1:05 | Explore station | Click **DTU, New Delhi**. | "Each station has its own 30-day chart. The shaded gaps are days without a 24-hour value." |
| 5 | 1:05–1:35 | Ask | Click **Ask** and type "How bad was Delhi's air on Diwali 2025?" | "Ask takes a plain question. The model plans which tools to call, Python does every calculation, and a checker matches each number before the answer appears." |
| 6 | 1:35–1:55 | Ask proof | Click the highlighted **352**. | "Click any highlighted number to see its proof: the two CPCB bulletins, the 4 PM-to-4 PM period each covers, and the formula: (351 + 353) ÷ 2." |
| 7 | 1:55–2:15 | City page | Open **/city/delhi** and scroll to Calendar, Diwali and Weather. | "Each city has its own page: a 30-day trend with a significance test, a calendar, Diwali AQI for three years, unusual days with their reasons, and a weather association that's clearly labelled as an association, not a cause." |
| 8 | 2:15–2:35 | Compare | Open **Compare** and add **Kolkata**. | "Compare puts cities side by side on the same dates. The ranking shows 95% ranges, and when two cities' ranges overlap it says 'too close to call' rather than pretending one is worse." |
| 9 | 2:35–2:45 | Data & accuracy | Click **Data & accuracy**. | "And the Data & accuracy panel lists the sources, licences, first-pass test scores and known limits. Thanks for watching." |

## Tips

- Use the saved Diwali 2025 demo answer (no AI quota needed). A new question uses the live model and takes about
  10 seconds.
- If the free backend is asleep, open the site a minute before recording.
