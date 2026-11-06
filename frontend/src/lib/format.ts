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
