const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2025-11-01" -> "1 Nov 2025" (dates are IST calendar dates; no timezone conversion). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  return `${Number(m[3])} ${MONTHS[Number(m[2]) - 1]} ${m[1]}`;
}

export function fmtRange(a?: string | null, b?: string | null): string {
  if (!a && !b) return "";
  if (a && b && a === b) return fmtDate(a);
  return `${fmtDate(a)} – ${fmtDate(b)}`;
}

export function fmtValue(v: number): string {
  if (!Number.isFinite(v)) return "–";
  if (Math.abs(v) >= 100 || Number.isInteger(v)) return v.toLocaleString("en-IN", { maximumFractionDigits: 1 });
  return v.toLocaleString("en-IN", { maximumFractionDigits: Math.abs(v) < 1 ? 3 : 1 });
}

export function fmtDuration(ms?: number): string {
  if (ms == null) return "";
  if (ms < 1000) return `${ms} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function pollutantLabel(p: string | null | undefined): string {
  if (!p) return "";
  return p.replace(/pm25/gi, "PM2.5").replace(/pm10/gi, "PM10");
}

/** "16:00" -> "4 PM", "09:30" -> "9:30 AM" (24-hour clock times written for people). */
export function fmtTime(hhmm: string): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) return hhmm;
  const h = Number(m[1]), min = m[2];
  const suffix = h < 12 ? "AM" : "PM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min === "00" ? "" : `:${min}`} ${suffix}`;
}

/** Display text for people: ISO dates become "9 Nov 2026" and clock times "4 PM". The text is otherwise
 * unchanged (numbers stay exactly as the backend verified them). */
export function readable(text: string | null | undefined): string {
  if (!text) return "";
  return text
    .replace(/\b(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2})(?::\d{2})?(?:[+-]\d{2}:\d{2})?)?/g, (_, d: string, t?: string) =>
      t ? `${fmtTime(t)}, ${fmtDate(d)}` : fmtDate(d))
    .replace(/\b([01]\d|2[0-3]):([0-5]\d)\b/g, (m) => fmtTime(m));
}

/** Short range for one month or year: "5–11 Nov 2026", "26 Oct – 11 Nov 2026". */
export function fmtSpan(a: string, b: string): string {
  const [ya, ma, da] = a.slice(0, 10).split("-").map(Number), [yb, mb, db] = b.slice(0, 10).split("-").map(Number);
  if (ya === yb && ma === mb) return `${da}–${db} ${MONTHS[mb - 1]} ${yb}`;
  if (ya === yb) return `${da} ${MONTHS[ma - 1]} – ${db} ${MONTHS[mb - 1]} ${yb}`;
  return fmtRange(a, b);
}
