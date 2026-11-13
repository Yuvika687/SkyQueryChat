"use client";

// A station's 30 days: dates on the x-axis, straight segments between consecutive days with a value, a dot for
// every day (so a single isolated day is still visible), and shaded bands where there is no 24-hour value.
import { CATEGORY_STYLE, pmCategory } from "@/lib/categories";
import { gapRuns, type Pollutant, POLLUTANT_LABEL } from "@/lib/explore";
import { fmtDate } from "@/lib/format";

export function StationChart({ dates, values, day, pollutant }: { dates: string[]; values: (number | null)[]; day: number; pollutant: Pollutant }) {
  const W = 320, H = 132, L = 32, R = 8, T = 10, B = 22;
  const n = dates.length;
  const have = values.filter((v): v is number => v != null);
  if (!have.length) return <p className="text-[13px] text-faint">No 24-hour values in these 30 days.</p>;
  const top = Math.max(60, Math.ceil(Math.max(...have) / 50) * 50);
  const X = (i: number) => L + (i * (W - L - R)) / (n - 1);
  const Y = (v: number) => T + (1 - v / top) * (H - T - B);
  const step = (W - L - R) / (n - 1);
  const segs: string[] = [];
  let d = "";
  values.forEach((v, i) => {
    if (v == null) { if (d) segs.push(d); d = ""; return; }
    d += `${d ? "L" : "M"}${X(i).toFixed(1)},${Y(v).toFixed(1)}`;
  });
  if (d) segs.push(d);
  const gaps = gapRuns(values);
  const widest = gaps.reduce<[number, number] | null>((a, g) => (!a || g[1] - g[0] > a[1] - a[0] ? g : a), null);
  const ticks = [0, Math.round((n - 1) / 2), n - 1];
  const label = `${POLLUTANT_LABEL[pollutant]} 24-hour means, ${fmtDate(dates[0])} to ${fmtDate(dates[n - 1])}: ` +
    values.map((v, i) => `${fmtDate(dates[i])} ${v == null ? "no value" : v}`).join("; ");
  return (
    <figure className="m-0">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        {gaps.map(([a, b]) => (
          <rect key={a} x={X(a) - step / 2} y={T} width={(b - a + 1) * step} height={H - T - B} fill="rgb(148 170 214 / 0.10)" />
        ))}
        {widest && widest[1] - widest[0] >= 2 && (
          <text x={(X(widest[0]) + X(widest[1])) / 2} y={T + 12} textAnchor="middle" fontSize="9.5" fill="#8391AE">no 24-hour value</text>
        )}
        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line x1={L} x2={W - R} y1={Y(v)} y2={Y(v)} stroke="rgb(148 170 214 / 0.14)" />
            <text x={L - 5} y={Y(v) + 3} textAnchor="end" fontSize="9.5" fill="#8391AE">{v}</text>
          </g>
        ))}
        <line x1={X(day)} x2={X(day)} y1={T} y2={H - B} stroke="#2DD4BF" strokeOpacity="0.6" strokeDasharray="3 3" />
        {segs.map((p, i) => <path key={i} d={p} fill="none" stroke="#9FB3D9" strokeWidth="1.6" strokeLinejoin="round" />)}
        {values.map((v, i) => {
          if (v == null) return null;
          const c = pmCategory(v, pollutant);
          return <circle key={i} cx={X(i)} cy={Y(v)} r={i === day ? 4 : 2.6} fill={c ? CATEGORY_STYLE[c].bg : "#64748B"}
            stroke={i === day ? "#FFFFFF" : "rgb(6 10 20 / 0.9)"} strokeWidth={i === day ? 1.5 : 1} />;
        })}
        {ticks.map((i) => (
          <text key={i} x={X(i)} y={H - 6} textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"} fontSize="10" fill="#8391AE">
            {fmtDate(dates[i]).replace(/ \d{4}$/, "")}
          </text>
        ))}
      </svg>
      <figcaption className="mt-1 flex items-center gap-1.5 text-[11px] text-faint">
        <span aria-hidden className="inline-block h-2.5 w-3.5 rounded-sm bg-[rgb(148_170_214/0.18)]" />
        Shaded: no 24-hour value (under 16 valid hours or no readings). Dashed line: selected day. µg/m³
      </figcaption>
    </figure>
  );
}
