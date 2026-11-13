// Shared helpers for the design mockups: readable dates, CPCB categories, scale bar, sparkline, chart and map.
// Every value comes from shared/data.js (generated from data/app by build_data.py).
(function () {
  const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const parse = (iso) => { const [y, m, d] = iso.slice(0, 10).split("-").map(Number); return { y, m, d }; };

  /** "11 Nov 2026"; short: "11 Nov" */
  function fmtDate(iso, short) {
    const { y, m, d } = parse(iso);
    return short ? `${d} ${MON[m - 1]}` : `${d} ${MON[m - 1]} ${y}`;
  }
  /** "26 Oct – 11 Nov 2026", "9–10 Nov 2026" */
  function fmtRange(a, b) {
    const A = parse(a), B = parse(b);
    if (A.y === B.y && A.m === B.m) return `${A.d}–${B.d} ${MON[B.m - 1]} ${B.y}`;
    if (A.y === B.y) return `${A.d} ${MON[A.m - 1]} – ${B.d} ${MON[B.m - 1]} ${B.y}`;
    return `${fmtDate(a)} – ${fmtDate(b)}`;
  }
  /** "2026-11-08 16:00" -> "4 PM, 8 Nov" */
  function fmtTime(s) {
    const h = Number(s.slice(11, 13));
    const t = h === 0 ? "12 AM" : h < 12 ? `${h} AM` : h === 12 ? "12 PM" : `${h - 12} PM`;
    return `${t}, ${fmtDate(s, true)}`;
  }

  // CPCB categories (docs/ui-design-spec.md, dark-tuned hexes). Colours are for data only.
  const CATS = [
    { name: "Good", pm25: [0, 30], aqi: [0, 50], bg: "#22C55E", fg: "#06140B" },
    { name: "Satisfactory", pm25: [31, 60], aqi: [51, 100], bg: "#A3E635", fg: "#0F1A03" },
    { name: "Moderate", pm25: [61, 90], aqi: [101, 200], bg: "#FACC15", fg: "#1A1503" },
    { name: "Poor", pm25: [91, 120], aqi: [201, 300], bg: "#FB923C", fg: "#1C0D02" },
    { name: "Very poor", pm25: [121, 250], aqi: [301, 400], bg: "#EF4444", fg: "#1A0404" },
    { name: "Severe", pm25: [251, Infinity], aqi: [401, 500], bg: "#B91C1C", fg: "#FFFFFF" },
  ];
  /** Round first, then assign (spec rule). kind: "pm25" | "aqi" */
  function category(v, kind) {
    if (v == null) return null;
    const r = Math.round(v);
    return CATS.find((c) => r >= c[kind][0] && r <= c[kind][1]) || CATS[5];
  }
  const rangeText = (c, kind) => (c[kind][1] === Infinity ? `above ${c[kind][0] - 1}` : `${c[kind][0]}–${c[kind][1]}`);

  /** Pollution scale bar: six equal segments, marker placed inside the value's segment. */
  function scaleBar(v, kind, opts = {}) {
    const c = category(v, kind), i = CATS.indexOf(c);
    const [lo, hi] = c[kind], top = hi === Infinity ? (kind === "aqi" ? 500 : 350) : hi;
    const frac = Math.max(0.04, Math.min(0.96, (Math.round(v) - lo) / Math.max(1, top - lo)));
    const pos = ((i + frac) / 6) * 100;
    const unit = kind === "aqi" ? "AQI" : "µg/m³";
    const label = `${v} ${unit}: ${c.name} (${rangeText(c, kind)}${kind === "aqi" ? "" : " µg/m³"}) on a scale from Good to Severe`;
    return `<div class="sq-scale ${opts.cls || ""}" role="img" aria-label="${label}">
      <div class="sq-scale-track">${CATS.map((k) => `<span style="background:${k.bg}"></span>`).join("")}</div>
      <div class="sq-scale-marker" style="left:${pos.toFixed(1)}%"></div>
      ${opts.ends === false ? "" : `<div class="sq-scale-ends"><span>Good</span><span>Severe</span></div>`}
    </div>`;
  }

  /** Category chip: colour plus the category name (never colour alone). */
  function chip(v, kind, cls = "") {
    const c = category(v, kind);
    return `<span class="sq-chip ${cls}" style="background:${c.bg};color:${c.fg}">${c.name}</span>`;
  }

  /** 7-day sparkline (gaps stay as breaks). */
  function sparkline(points, { w = 120, h = 32, stroke = "currentColor", dot = true, label = "" } = {}) {
    const vals = points.map((p) => p.pm25).filter((x) => x != null);
    const min = Math.min(...vals), max = Math.max(...vals), pad = 3;
    const X = (i) => pad + (i * (w - 2 * pad)) / (points.length - 1);
    const Y = (v) => h - pad - ((v - min) / Math.max(1e-9, max - min)) * (h - 2 * pad);
    let d = "", pen = false;
    points.forEach((p, i) => {
      if (p.pm25 == null) { pen = false; return; }
      d += `${pen ? "L" : "M"}${X(i).toFixed(1)},${Y(p.pm25).toFixed(1)}`; pen = true;
    });
    const last = points.length - 1;
    return `<svg class="sq-spark" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" role="img" aria-label="${label}">
      <path d="${d}" fill="none" stroke="${stroke}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>
      ${dot ? `<circle cx="${X(last).toFixed(1)}" cy="${Y(points[last].pm25).toFixed(1)}" r="2.6" fill="${stroke}"/>` : ""}
    </svg>`;
  }

  /** Official AQI line chart by bulletin date: straight segments, dots coloured by category, gap where a
   * bulletin is missing, festival band, AQI category boundaries as faint gridlines. */
  function aqiChart(points, t) {
    const W = t.width || 760, H = t.height || 280, L = 40, R = 16, T = 28, B = 34;
    const n = points.length, X = (i) => L + (i * (W - L - R)) / (n - 1), Y = (v) => T + (1 - v / 500) * (H - T - B);
    const band = t.band; // [startDate, endDate]
    const bi = points.findIndex((p) => p.date === band[0]), bj = points.findIndex((p) => p.date === band[1]);
    let g = "";
    g += `<rect x="${X(bi) - 9}" y="${T}" width="${X(bj) - X(bi) + 18}" height="${H - T - B}" fill="${t.band_fill}" rx="3"/>`;
    g += `<text x="${(X(bi) + X(bj)) / 2}" y="${T - 10}" text-anchor="middle" class="sq-ch-band">${t.band_label}</text>`;
    [100, 200, 300, 400, 500].forEach((v) => {
      g += `<line x1="${L}" x2="${W - R}" y1="${Y(v)}" y2="${Y(v)}" stroke="${t.grid}" stroke-width="1"/>`;
      g += `<text x="${L - 8}" y="${Y(v) + 4}" text-anchor="end" class="sq-ch-axis">${v}</text>`;
    });
    g += `<line x1="${L}" x2="${W - R}" y1="${Y(0)}" y2="${Y(0)}" stroke="${t.axis}" stroke-width="1"/>`;
    g += `<text x="${L - 8}" y="${Y(0) + 4}" text-anchor="end" class="sq-ch-axis">0</text>`;
    let d = "", pen = false;
    points.forEach((p, i) => { if (p.aqi == null) { pen = false; return; } d += `${pen ? "L" : "M"}${X(i)},${Y(p.aqi)}`; pen = true; });
    g += `<path d="${d}" fill="none" stroke="${t.line}" stroke-width="2" stroke-linejoin="round"/>`;
    // Date labels: festival dates first, then regular ones that keep at least `gap` pixels from any chosen label.
    const gap = 42, chosen = [bi, ...(W < 500 ? [] : [bj])];
    for (let i = 0; i < n - 1; i += t.every || 2) if (chosen.every((c) => Math.abs(X(c) - X(i)) >= gap)) chosen.push(i);
    points.forEach((p, i) => {
      if (chosen.includes(i)) g += `<text x="${X(i)}" y="${H - 12}" text-anchor="middle" class="sq-ch-axis">${fmtDate(p.date, true)}</text>`;
      if (p.aqi == null) {
        g += `<text x="${X(i)}" y="${Y(40)}" text-anchor="end" class="sq-ch-note">${fmtDate(p.date, true)} not yet published</text>`;
        return;
      }
      const c = category(p.aqi, "aqi");
      g += `<circle cx="${X(i)}" cy="${Y(p.aqi)}" r="${t.dot || 4}" fill="${c.bg}" stroke="${t.dot_stroke}" stroke-width="1.5"><title>${fmtDate(p.date)}: AQI ${p.aqi} (${c.name})</title></circle>`;
      if (p.date === band[0] || p.date === band[1]) {
        g += `<text x="${X(i)}" y="${Y(p.aqi) - 11}" text-anchor="middle" class="sq-ch-value">${p.aqi}</text>`;
      }
    });
    return `<svg class="sq-chart" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img"
      aria-label="Delhi official AQI by bulletin date, ${fmtRange(points[0].date, points[n - 2].date)}">${g}</svg>`;
  }

  // ------------------------------------------------------------------ map
  // Basemap: OpenFreeMap "dark" vector style (no API key; OpenMapTiles schema, OpenStreetMap data). Its border,
  // label and road layers are removed; India is drawn from the official-boundary outline (Survey of India via
  // DataMeet, CC0) on top. If the basemap cannot load, the outline is drawn on its own as an SVG.
  const STYLE_URL = "https://tiles.openfreemap.org/styles/dark";
  const BOUNDS = [[66.2, 5.6], [99.0, 37.6]];

  function ringsOf(geo) { return geo.features[0].geometry.coordinates; }

  function maskGeo() {
    const holes = ringsOf(window.SQ_INDIA).map((poly) => poly[0]);
    return { type: "Feature", properties: {}, geometry: { type: "Polygon",
      coordinates: [[[-179, -80], [179, -80], [179, 80], [-179, 80], [-179, -80]], ...holes] } };
  }

  async function mountMap(el, theme, cities, markerEl) {
    const done = (mode) => { el.dataset.map = mode; window.SQ_MAP_READY = true; };
    try {
      const cv = document.createElement("canvas");
      if (!window.maplibregl || !(cv.getContext("webgl2") || cv.getContext("webgl"))) throw new Error("no webgl");
      const style = await (await fetch(STYLE_URL)).json();
      const keep = (l) => l.type === "background" || l.id === "water" || l.id === "waterway" ||
        l.id.startsWith("landcover") || l.id.startsWith("landuse");
      style.layers = style.layers.filter(keep).map((l) => {
        if (l.type === "background") l.paint = { "background-color": theme.land };
        if (l.id === "water") l.paint = { "fill-color": theme.water };
        if (l.id === "waterway") l.paint = { "line-color": theme.water_line || theme.water, "line-width": 0.6 };
        if (l.id.startsWith("land")) l.paint = { ...(l.paint || {}), "fill-opacity": 0.12 };
        return l;
      });
      const map = new maplibregl.Map({
        container: el, style, bounds: BOUNDS, fitBoundsOptions: { padding: theme.padding || 40 },
        attributionControl: false, dragRotate: false, pitchWithRotate: false, touchPitch: false,
        scrollZoom: false, fadeDuration: 0, preserveDrawingBuffer: true,
      });
      map.touchZoomRotate.disableRotation();
      map.on("load", () => {
        map.addSource("india", { type: "geojson", data: window.SQ_INDIA });
        map.addSource("mask", { type: "geojson", data: maskGeo() });
        map.addLayer({ id: "mask", type: "fill", source: "mask", paint: { "fill-color": theme.mask, "fill-opacity": theme.mask_opacity } });
        map.addLayer({ id: "india-fill", type: "fill", source: "india", paint: { "fill-color": theme.india_fill, "fill-opacity": theme.india_fill_opacity ?? 1 } });
        map.addLayer({ id: "india-line", type: "line", source: "india", paint: { "line-color": theme.outline, "line-width": theme.outline_width || 1 } });
        cities.forEach((c) => new maplibregl.Marker({ element: markerEl(c), anchor: "center" }).setLngLat([c.lon, c.lat]).addTo(map));
        map.once("idle", () => done("basemap"));
      });
      map.on("error", (e) => { if (!map.isStyleLoaded()) { map.remove(); drawOutline(el, theme, cities, markerEl); done("outline"); } else console.warn(e && e.error); });
      return map;
    } catch (e) {
      drawOutline(el, theme, cities, markerEl);
      done("outline");
    }
  }

  /** Fallback: official-boundary India outline as SVG (Web Mercator), with the same city markers. */
  function drawOutline(el, theme, cities, markerEl) {
    const w = el.clientWidth, h = el.clientHeight, pad = theme.padding || 40;
    const pt = (lon, lat) => [lon * Math.PI / 180, Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360))];
    const [a, b] = [pt(...BOUNDS[0]), pt(...BOUNDS[1])];
    const pl = typeof pad === "number" ? { top: pad, bottom: pad, left: pad, right: pad } : pad;
    const s = Math.min((w - pl.left - pl.right) / (b[0] - a[0]), (h - pl.top - pl.bottom) / (b[1] - a[1]));
    const ox = pl.left + (w - pl.left - pl.right - s * (b[0] - a[0])) / 2, oy = pl.top + (h - pl.top - pl.bottom - s * (b[1] - a[1])) / 2;
    const P = (lon, lat) => { const [x, y] = pt(lon, lat); return [ox + (x - a[0]) * s, h - (oy + (y - a[1]) * s)]; };
    const d = ringsOf(window.SQ_INDIA).map((poly) => poly.map((r) => "M" + r.map(([x, y]) => P(x, y).map((v) => v.toFixed(1)).join(",")).join("L") + "Z").join("")).join("");
    el.innerHTML = `<svg width="${w}" height="${h}" style="position:absolute;inset:0;background:${theme.mask}" aria-hidden="true">
      <path d="${d}" fill="${theme.india_fill}" stroke="${theme.outline}" stroke-width="${theme.outline_width || 1}" fill-rule="evenodd"/></svg>`;
    cities.forEach((c) => {
      const m = markerEl(c), [x, y] = P(c.lon, c.lat);
      m.style.position = "absolute"; m.style.left = x + "px"; m.style.top = y + "px"; m.style.transform = "translate(-50%,-50%)";
      el.appendChild(m);
    });
  }

  const ATTRIBUTION = {
    map: `Basemap <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://openmaptiles.org" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> · India boundary as per the Survey of India (<a href="https://github.com/datameet/maps" target="_blank" rel="noopener">DataMeet</a>, CC0)`,
    data: "PM2.5: OpenAQ (CPCB stations) · Official AQI: CPCB daily bulletins",
  };

  // ------------------------------------------------------------------ the saved answer (evaluation E01)
  /** Builds the Ask content from the saved answer: numbers in the text become proof links; the proof for each
   * number lists the bulletin rows behind it. Nothing is computed except the readable dates. */
  function answer() {
    const A = window.SQ_DATA.ask, [b1, b2] = A.bulletins;
    const card = (f) => A.cards.find((c) => c.field === f);
    const fest = card("2026_festival_aqi"), c1 = card(`2026_bulletin_${b1.date}`), c2 = card(`2026_bulletin_${b2.date}`);
    const link = (text, id, v) => text.replace(String(v), `<button class="n-link" type="button" data-proof="${id}" aria-haspopup="dialog">${v}</button>`);
    const fmtV = (v) => (Number.isInteger(v) ? String(v) : v.toFixed(1));
    const headline = link(A.answer, "festival", fmtV(fest.value));
    let explanation = link(A.explanation, "b1", fmtV(c1.value));
    explanation = link(explanation, "b2", fmtV(c2.value));
    const brow = (b) => ({ title: `Bulletin dated ${fmtDate(b.date)}`, sub: `Covers ${fmtTime(b.from)} to ${fmtTime(b.to)} IST`,
      value: b.aqi, category: category(b.aqi, "aqi").name, stations: `${b.stations} of ${b.stations_total} stations reported`, pollutant: b.pollutant });
    const facts = [
      ["Data type", "Official AQI: an index of several pollutants, not a PM2.5 concentration"],
      ["Source", "CPCB daily AQI bulletin (PDF from cpcb.gov.in)"],
      ["City value", "CPCB's average over the stations that reported that day"],
      ["Answer run", `${A.model}, ${A.seconds} s`],
    ];
    const check = `Copied exactly from the analysis result. All ${A.verification.numbers_checked} numbers in this answer were checked.`;
    const proofs = {
      festival: { eyebrow: "Proof", title: "Delhi festival AQI, Diwali 2026", value: fest.value, unit: "AQI",
        calc: `Mean of the two festival bulletins: (<span class="num">${b1.aqi}</span> + <span class="num">${b2.aqi}</span>) ÷ 2 = <span class="num">${fest.value}</span>`,
        rows: [brow(b1), brow(b2)], facts, check },
      b1: { eyebrow: "Proof", title: `Delhi bulletin, ${fmtDate(b1.date)}`, value: b1.aqi, unit: "AQI",
        calc: `Reports Diwali evening and night (Diwali was ${fmtDate("2026-11-08")}).`, rows: [brow(b1)], facts, check },
      b2: { eyebrow: "Proof", title: `Delhi bulletin, ${fmtDate(b2.date)}`, value: b2.aqi, unit: "AQI",
        calc: "The second festival bulletin: the day after Diwali.", rows: [brow(b2)], facts, check },
    };
    const keys = [
      { id: "festival", label: "Festival level", sub: `Mean of bulletins, ${fmtRange(b1.date, b2.date)}`, value: fest.value },
      { id: "b1", label: `Bulletin, ${fmtDate(b1.date, true)}`, sub: "Covers Diwali night", value: b1.aqi },
      { id: "b2", label: `Bulletin, ${fmtDate(b2.date, true)}`, sub: "Day after Diwali", value: b2.aqi },
    ];
    const pts = A.chart.filter((p) => p.aqi != null);
    const steps = [
      "Checked that Delhi and Diwali 2026 are in the data",
      "Loaded official CPCB bulletins around Diwali 2026",
      "Left out measured PM, because the question did not ask about it",
      `Checked ${A.verification.numbers_checked} numbers against the analysis: all matched`,
    ];
    return { A, headline, explanation, keys, proofs, steps, chart: A.chart, b1, b2,
      period: fmtRange(pts[0].date, pts[pts.length - 1].date),
      warnings: ["AQI is an index of several pollutants, not a PM2.5 concentration.",
                 "Not a cause: AQI often rises through October and November for seasonal reasons."] };
  }

  /** Wire number links to a proof drawer; render(proof) fills it. */
  function wireProof(render) {
    const open = (id, btn) => {
      document.querySelectorAll(".n-link[aria-expanded]").forEach((b) => b.removeAttribute("aria-expanded"));
      if (btn) btn.setAttribute("aria-expanded", "true");
      render(answer().proofs[id]);
      document.body.classList.add("proof-open");
    };
    document.addEventListener("click", (e) => {
      const b = e.target.closest("[data-proof]");
      if (b) open(b.dataset.proof, b);
      if (e.target.closest("[data-close]")) document.body.classList.remove("proof-open");
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") document.body.classList.remove("proof-open"); });
    if (location.hash.startsWith("#proof")) {
      const id = location.hash.split("=")[1] || "festival";
      open(id, document.querySelector(`.n-link[data-proof="${id}"]`));
    }
  }

  window.SQ = { D: window.SQ_DATA, fmtDate, fmtRange, fmtTime, CATS, category, rangeText, scaleBar, chip, sparkline, aqiChart, mountMap, ATTRIBUTION, answer, wireProof };
})();
