"use client";

import { useMemo, useRef, useState } from "react";
import {
  AlertTriangle, CalendarRange, Check, Copy, Database, Download, FileImage, Gauge, Info, MapPin, Sparkles, Table2,
} from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { EChart, type EChartHandle } from "@/components/chart/echart";
import { CATEGORY_STYLE, DATA_TYPE_LABEL, normaliseCategory, aqiCategory } from "@/lib/categories";
import { buildOption, isAQI } from "@/lib/chart-options";
import { chartTable, download, slug, toCSV } from "@/lib/chart-data";
import type { Evidence } from "@/lib/evidence";
import { fmtDate, fmtRange, fmtValue, pollutantLabel } from "@/lib/format";
import type { Card, ChartSpec, DataType, ResolvedQuery, SourceRef } from "@/lib/types";
import { cn } from "@/lib/utils";

// ------------------------------------------------------------------ data type label
const TYPE_STYLE: Record<string, string> = {
  measured: "border-teal/40 text-teal",
  modelled: "border-modelled/50 text-modelled",
  official_aqi: "border-[#60A5FA]/50 text-[#93C5FD]",
  mixed: "border-modelled/50 text-modelled",
};

export function DataTypeBadge({ type, className }: { type: DataType | string; className?: string }) {
  return (
    <span className={cn("inline-flex h-6 items-center gap-1 rounded-full border px-2 text-xs font-medium", TYPE_STYLE[type] ?? "border-line text-subtle", className)}>
      {DATA_TYPE_LABEL[type] ?? type}
    </span>
  );
}

// ------------------------------------------------------------------ metric cards
function cardPeriod(c: Card, sources: SourceRef[]): string | null {
  // The label already names its period (dates, a month or a year such as "Diwali 2025"): don't add the
  // dataset's wider data window, which could be mistaken for the card's own period.
  if (/\b(19|20)\d{2}\b/.test(c.label)) return null;
  const s = sources.find((x) => x.dataset_id === c.dataset_id);
  return s ? fmtRange(s.date_range.start, s.date_range.end) : null;
}

function prettyLabel(label: string): string {
  return label.replace(/(\d{4}-\d{2}-\d{2})/g, (m) => fmtDate(m));
}

export function MetricCards({ cards, sources }: { cards: Card[]; sources: SourceRef[] }) {
  if (!cards.length) return null;
  return (
    <ul className={cn("grid gap-3", cards.length === 1 ? "grid-cols-1 sm:grid-cols-2" : cards.length === 3 ? "grid-cols-1 sm:grid-cols-3" : "grid-cols-1 sm:grid-cols-2")}>
      {cards.map((c) => {
        const aqi = c.data_type === "official_aqi" && /index/i.test(c.unit);
        const cat = aqi ? aqiCategory(c.value) : null;
        const period = cardPeriod(c, sources);
        return (
          <li key={`${c.dataset_id}.${c.field}`} className="flex flex-col gap-2 rounded-xl border border-line bg-surface p-4">
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs leading-4 font-medium text-subtle">{prettyLabel(c.label)}</p>
              <DataTypeBadge type={c.data_type} className="h-5 shrink-0 px-1.5 text-[11px]" />
            </div>
            <p className="flex items-baseline gap-1.5">
              <span className="font-mono text-[28px] leading-[34px] font-medium tabular-nums">{fmtValue(c.value)}</span>
              {c.unit && <span className="text-sm text-subtle">{aqi ? "AQI" : c.unit}</span>}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              {cat && <CategoryChip category={cat} prefix="AQI category" />}
              {period && <span className="text-xs leading-4 text-subtle">{period}</span>}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export function CategoryChip({ category, prefix }: { category: string; prefix?: string }) {
  const cat = normaliseCategory(category);
  const st = cat ? CATEGORY_STYLE[cat] : CATEGORY_STYLE.None;
  return (
    <span className="inline-flex h-6 items-center rounded-md px-2 text-xs font-medium" style={{ background: st.bg, color: st.fg }}>
      {prefix ? <span className="sr-only">{prefix}: </span> : null}
      {st.label}
    </span>
  );
}

// ------------------------------------------------------------------ chart + table + actions
export function ChartPanel({ spec, dataType, answerText }: { spec: ChartSpec; dataType: DataType | null; answerText: string }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const [copied, setCopied] = useState(false);
  const chartRef = useRef<EChartHandle>(null);
  const option = useMemo(() => buildOption(spec, dataType), [spec, dataType]);
  const table = useMemo(() => chartTable(spec), [spec]);
  const height = spec.type === "calendar_heatmap" ? 230 : spec.type === "bar" ? Math.max(200, (spec.series[0]?.data.length ?? 4) * 40 + 60) : 300;
  const name = slug(spec.title);
  const aqi = isAQI(spec);
  const notes = (spec.notes ?? []).filter((n) => !/colours?:/i.test(n));

  const csv = () => download(`${name}.csv`, URL.createObjectURL(new Blob([toCSV(table)], { type: "text/csv;charset=utf-8" })));
  const png = () => {
    if (view !== "chart") setView("chart");
    const url = chartRef.current?.toPNG();
    if (url) download(`${name}.png`, url);
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(answerText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard blocked */
    }
  };

  return (
    <section aria-label="Chart" className="rounded-xl border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-2 border-b border-line px-4 py-3">
        <h3 className="min-w-0 flex-1 text-sm font-semibold">
          {spec.title}
          <span className="ml-2 font-normal text-subtle">{aqi ? "AQI (index)" : spec.units}</span>
        </h3>
        <div role="tablist" aria-label="Chart or table" className="flex rounded-lg border border-line p-0.5">
          {(["chart", "table"] as const).map((v) => (
            <button
              key={v}
              role="tab"
              type="button"
              aria-selected={view === v}
              onClick={() => setView(v)}
              className={cn("h-7 rounded-md px-2.5 text-xs font-medium", view === v ? "bg-raised text-teal" : "text-subtle hover:text-foreground")}
            >
              {v === "chart" ? "Chart" : "Data table"}
            </button>
          ))}
        </div>
      </div>
      <div className={cn("px-2 pt-2", view !== "chart" && "hidden")}>
        <EChart ref={chartRef} option={option} height={height} ariaLabel={`${spec.title}. Open the data table for the values.`} />
      </div>
      {view === "table" && <DataTable columns={table.columns} rows={table.rows} caption={spec.title} />}
      {notes.length > 0 && (
        <ul className="space-y-1 px-4 pt-1 text-xs leading-4 text-subtle">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
      <div className="flex flex-wrap gap-1.5 px-3 py-3">
        <ActionButton icon={Table2} label={view === "table" ? "View chart" : "View data table"} onClick={() => setView(view === "table" ? "chart" : "table")} />
        <ActionButton icon={Download} label="Download CSV" onClick={csv} />
        <ActionButton icon={FileImage} label="Download PNG" onClick={png} />
        <ActionButton icon={copied ? Check : Copy} label={copied ? "Copied" : "Copy answer"} onClick={copy} />
      </div>
    </section>
  );
}

export function CopyOnly({ answerText }: { answerText: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <ActionButton
      icon={copied ? Check : Copy}
      label={copied ? "Copied" : "Copy answer"}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(answerText);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* ignore */
        }
      }}
    />
  );
}

function ActionButton({ icon: Icon, label, onClick }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-2.5 text-xs font-medium text-subtle hover:border-teal hover:text-teal"
    >
      <Icon className="size-4" aria-hidden />
      {label}
    </button>
  );
}

export function DataTable({ columns, rows, caption }: { columns: string[]; rows: (string | number | null)[][]; caption: string }) {
  return (
    <div className="max-h-80 overflow-auto px-4 pt-3" tabIndex={0} aria-label={`Data table: ${caption}`}>
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="sticky top-0 bg-surface">
          <tr>
            {columns.map((c) => (
              <th key={c} scope="col" className="border-b border-line px-2 py-1.5 text-left font-medium text-subtle">{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="odd:bg-raised/40">
              {r.map((v, j) => (
                <td key={j} className={cn("px-2 py-1 whitespace-nowrap", typeof v === "number" && "text-right font-mono tabular-nums")}>
                  {v == null ? <span className="text-subtle">no data</span> : String(v)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ------------------------------------------------------------------ interpreted query
export function InterpretedQuery({ rq }: { rq: ResolvedQuery }) {
  const cities = rq.cities?.length ? rq.cities.join(", ") : rq.city;
  return (
    <section aria-label="How the question was read" className="rounded-xl border border-line bg-surface/60 px-4 py-3 text-sm">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="text-xs font-medium text-subtle">Interpreted as</span>
        {cities && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5 text-subtle" aria-hidden />{cities}</span>}
        {rq.pollutant && <span className="inline-flex items-center gap-1"><Gauge className="size-3.5 text-subtle" aria-hidden />{pollutantLabel(rq.pollutant)}</span>}
        {rq.start_date && (
          <span className="inline-flex items-center gap-1"><CalendarRange className="size-3.5 text-subtle" aria-hidden />{fmtRange(rq.start_date, rq.end_date)}</span>
        )}
      </p>
      {rq.assumptions?.length > 0 && (
        <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-xs leading-4 text-subtle">
          {rq.assumptions.map((a) => <li key={a}>{a.replace(/(\d{4}-\d{2}-\d{2})/g, (m) => fmtDate(m))}</li>)}
        </ul>
      )}
    </section>
  );
}

// ------------------------------------------------------------------ evidence bar
export function EvidenceBar({ ev }: { ev: Evidence }) {
  const chips: { key: string; icon: React.ComponentType<{ className?: string }>; label: string; detail: React.ReactNode; warn?: boolean; tone?: string }[] = [];
  if (ev.dataType) {
    chips.push({
      key: "type", icon: Sparkles, label: ev.dataType, tone: TYPE_STYLE[ev.dataTypeKey ?? ""],
      detail: TYPE_DETAIL[ev.dataTypeKey ?? ""] ?? ev.dataType,
    });
  }
  if (ev.period) chips.push({ key: "period", icon: CalendarRange, label: ev.period, detail: "The dates the calculation used (Indian Standard Time calendar days)." });
  if (ev.stations) chips.push({ key: "stations", icon: MapPin, label: ev.stations, detail: ev.stationsDetail });
  if (ev.coverageText) {
    chips.push({
      key: "coverage", icon: ev.lowCoverage ? AlertTriangle : Gauge, label: ev.lowCoverage && /%/.test(ev.coverageText) ? `Low coverage: ${ev.coverageText.replace(" coverage", "")}` : ev.coverageText,
      warn: ev.lowCoverage,
      detail: (
        <>
          {ev.coverageDetail}
          {ev.lowCoverage && ev.coverage !== 0 && <span className="mt-1 block text-warn">Fewer than 70% of days have enough valid data, so treat this result with care.</span>}
        </>
      ),
    });
  }
  if (ev.source) chips.push({ key: "source", icon: Database, label: shortSource(ev.source), detail: <SourceList sources={ev.sources} /> });
  if (!chips.length) return null;
  return (
    <section aria-label="Evidence" className="flex flex-wrap gap-1.5">
      {chips.map((c) => (
        <Popover key={c.key}>
          <PopoverTrigger
            render={
              <button
                type="button"
                className={cn(
                  "inline-flex h-8 max-w-full items-center gap-1.5 rounded-full border bg-surface px-2.5 text-xs font-medium hover:bg-raised",
                  c.warn ? "border-warn/50 text-warn" : c.tone ?? "border-line text-foreground",
                )}
              />
            }
          >
            <c.icon className="size-3.5 shrink-0" aria-hidden />
            <span className="truncate">{c.label}</span>
          </PopoverTrigger>
          <PopoverContent className="w-80 border-line bg-raised text-xs leading-5">{c.detail}</PopoverContent>
        </Popover>
      ))}
    </section>
  );
}

const TYPE_DETAIL: Record<string, string> = {
  measured: "Measured: averages of readings from CPCB reference monitors (via OpenAQ), calculated in Python.",
  modelled: "Modelled: estimates from a computer model, not monitor readings. Treat as context, not proof.",
  official_aqi: "Official AQI: CPCB's daily city bulletin. AQI is an index of several pollutants, not a PM concentration.",
  mixed: "Measured PM from monitors, paired with modelled weather (Open-Meteo reanalysis). Relationships are associations, not causes.",
};

function shortSource(s: string) {
  return s.split(";")[0].replace(/\s*\(.*?\)\s*/g, " ").trim().slice(0, 48);
}

function SourceList({ sources }: { sources: SourceRef[] }) {
  return (
    <ul className="space-y-2">
      {sources.map((s) => (
        <li key={s.dataset_id}>
          <p className="font-medium text-foreground">{s.title}</p>
          <p className="text-subtle">{s.source}</p>
          <p className="text-subtle">{DATA_TYPE_LABEL[s.data_type]} · {fmtRange(s.date_range.start, s.date_range.end)}</p>
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ warnings
export function Callout({ tone, title, children, icon: Icon = tone === "warn" ? AlertTriangle : Info }: {
  tone: "warn" | "info" | "error" | "modelled";
  title?: string;
  children: React.ReactNode;
  icon?: React.ComponentType<{ className?: string }>;
}) {
  const cls = {
    warn: "border-warn/40 bg-warn/10 text-foreground [&_svg]:text-warn",
    info: "border-line bg-surface text-foreground [&_svg]:text-teal",
    error: "border-danger/40 bg-danger/10 text-foreground [&_svg]:text-danger",
    modelled: "border-modelled/40 bg-modelled/10 text-foreground [&_svg]:text-modelled",
  }[tone];
  return (
    <div className={cn("flex gap-2.5 rounded-xl border px-3.5 py-3 text-sm", cls)} role={tone === "error" ? "alert" : undefined}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        {title && <p className="font-medium">{title}</p>}
        <div className={cn(title && "mt-0.5 text-subtle")}>{children}</div>
      </div>
    </div>
  );
}

