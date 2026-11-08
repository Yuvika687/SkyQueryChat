"use client";

import { useMemo, useRef, useState } from "react";
import { AlertTriangle, CalendarRange, Check, ChevronDown, Copy, Download, FileImage, Gauge, Info, MapPin } from "lucide-react";
import { EChart, type EChartHandle } from "@/components/chart/echart";
import { CATEGORY_STYLE, DATA_TYPE_LABEL, normaliseCategory } from "@/lib/categories";
import { buildOption, eventKey, isAQI } from "@/lib/chart-options";
import { chartTable, download, slug, toCSV } from "@/lib/chart-data";
import type { Evidence } from "@/lib/evidence";
import { fmtDate, fmtRange, pollutantLabel } from "@/lib/format";
import { keyNumbers } from "@/lib/key-numbers";
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

// ------------------------------------------------------------------ key numbers (compact strip, no boxes)
export function KeyNumbers({ cards, answerType }: { cards: Card[]; answerType: DataType | null }) {
  const items = keyNumbers(cards);
  if (!items.length) return null;
  const mixedTypes = new Set(items.map((k) => k.dataType)).size > 1;
  return (
    <dl aria-label="Key numbers" className="flex flex-wrap gap-x-8 gap-y-3">
      {items.map((k) => (
        <div key={k.key} className="flex min-w-0 flex-col gap-0.5">
          <dt className="flex items-center gap-1.5 text-xs leading-4 font-medium text-subtle">
            {k.label}
            {mixedTypes && k.dataType !== answerType && <DataTypeBadge type={k.dataType} className="h-4 px-1 text-[10px]" />}
          </dt>
          <dd className="flex items-baseline gap-1.5">
            <span className="num text-[26px] leading-8 font-medium" title={k.value !== String(k.exact) ? `Exact: ${k.exact}` : undefined}>{k.value}</span>
            {k.unit && <span className="text-sm text-subtle">{k.unit}</span>}
            {k.category && <CategoryChip category={k.category} prefix="AQI category" />}
          </dd>
          {k.sub && <dd className="text-xs leading-4 text-subtle/80">{k.sub}</dd>}
        </div>
      ))}
    </dl>
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
  const height = spec.type === "calendar_heatmap" ? 230 : spec.type === "bar" ? Math.max(160, (spec.series[0]?.data.length ?? 4) * 36 + 56) : 280;
  const name = slug(spec.title);
  const aqi = isAQI(spec);
  const key = eventKey(spec);
  const notes = (spec.notes ?? []).filter((n) => !/colours?:/i.test(n) && !/^Each point is one CPCB bulletin/i.test(n));

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
    <section aria-label="Chart" className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h3 className="w-full min-w-0 text-sm font-medium sm:w-auto sm:flex-1">
          {spec.title}
          <span className="ml-2 font-normal text-subtle">{aqi ? "AQI (index)" : spec.units}</span>
        </h3>
        <div className="ml-auto flex items-center gap-0.5">
          <div role="tablist" aria-label="Chart or table" className="mr-1 flex rounded-lg bg-surface p-0.5">
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
          <IconAction icon={Download} label="Download CSV" onClick={csv} />
          <IconAction icon={FileImage} label="Download PNG" onClick={png} />
          <IconAction icon={copied ? Check : Copy} label={copied ? "Copied" : "Copy answer"} onClick={copy} />
        </div>
      </div>
      {key && view === "chart" && <p className="text-xs leading-4 text-subtle">{key}</p>}
      <div className={cn("-mx-1", view !== "chart" && "hidden")}>
        <EChart ref={chartRef} option={option} height={height} ariaLabel={`${spec.title}. Open the data table for the values.`} />
      </div>
      {view === "table" && <DataTable columns={table.columns} rows={table.rows} caption={spec.title} />}
      {notes.length > 0 && (
        <ul className="space-y-1 text-xs leading-4 text-subtle">
          {notes.map((n) => <li key={n}>{n}</li>)}
        </ul>
      )}
    </section>
  );
}

export function CopyOnly({ answerText }: { answerText: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <IconAction
      icon={copied ? Check : Copy}
      label={copied ? "Copied" : "Copy answer"}
      withText
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

/** Quiet secondary action: icon button with an accessible name and a hover title. */
function IconAction({ icon: Icon, label, onClick, withText }: { icon: React.ComponentType<{ className?: string }>; label: string; onClick: () => void; withText?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className={cn(
        "inline-flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-subtle hover:bg-surface hover:text-teal",
        withText ? "px-2" : "w-8",
      )}
    >
      <Icon className="size-4" aria-hidden />
      {withText && label}
    </button>
  );
}

export function DataTable({ columns, rows, caption }: { columns: string[]; rows: (string | number | null)[][]; caption: string }) {
  return (
    <div className="max-h-80 overflow-auto rounded-lg border border-line" tabIndex={0} aria-label={`Data table: ${caption}`}>
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
            <tr key={i} className="odd:bg-surface/50">
              {r.map((v, j) => (
                <td key={j} className={cn("px-2 py-1 whitespace-nowrap", typeof v === "number" && "num text-right")}>
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

// ------------------------------------------------------------------ evidence: one compact row + expandable details
export function EvidenceArea({ ev, rq, explanation, notes }: { ev: Evidence; rq: ResolvedQuery | null; explanation: string; notes: string[] }) {
  const [open, setOpen] = useState(false);
  const items: { key: string; label: string; tone?: string }[] = [];
  if (ev.dataType) items.push({ key: "type", label: ev.dataType, tone: TYPE_TEXT[ev.dataTypeKey ?? ""] });
  if (ev.period) items.push({ key: "period", label: ev.period });
  if (ev.stations) items.push({ key: "stations", label: ev.stations });
  if (ev.coverageText) {
    items.push({
      key: "coverage",
      label: ev.lowCoverage && /%/.test(ev.coverageText) ? `Low coverage: ${ev.coverageText.replace(" coverage", "")}` : ev.coverageText,
      tone: ev.lowCoverage ? "text-warn" : undefined,
    });
  }
  if (ev.source) items.push({ key: "source", label: shortSource(ev.source) });
  if (!items.length) return null;
  const id = "evidence-details";
  return (
    <section aria-label="Evidence" className="border-t border-line pt-3 text-xs leading-5">
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-subtle">
        {items.map((it, i) => (
          <span key={it.key} className={cn("inline-flex min-w-0 items-center gap-1.5", it.tone)}>
            {i > 0 && <span aria-hidden className="text-line">•</span>}
            {it.key === "coverage" && ev.lowCoverage && <AlertTriangle className="size-3.5" aria-hidden />}
            <span className="truncate">{it.label}</span>
          </span>
        ))}
        <button
          type="button"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
          className="ml-1 inline-flex h-7 items-center gap-1 rounded-md px-1.5 font-medium text-foreground hover:text-teal"
        >
          {open ? "Hide details" : "Details"}
          <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} aria-hidden />
        </button>
      </div>
      {ev.lowCoverage && ev.coverage !== 0 && (
        <p className="mt-1 text-warn">Fewer than 70% of days have enough valid data, so treat this result with care.</p>
      )}
      {open && (
        <div id={id} className="mt-3 grid gap-3 text-subtle sm:grid-cols-[120px_1fr]">
          {rq && (
            <>
              <p className="font-medium text-foreground">Interpreted as</p>
              <InterpretedQuery rq={rq} />
            </>
          )}
          {ev.dataTypeKey && TYPE_DETAIL[ev.dataTypeKey] && (
            <>
              <p className="font-medium text-foreground">Data type</p>
              <p>{TYPE_DETAIL[ev.dataTypeKey]}</p>
            </>
          )}
          {ev.stationsDetail && (
            <>
              <p className="font-medium text-foreground">Stations</p>
              <p>{ev.stationsDetail}</p>
            </>
          )}
          {ev.coverageDetail && (
            <>
              <p className="font-medium text-foreground">Coverage</p>
              <p>{ev.coverageDetail}</p>
            </>
          )}
          {explanation && (
            <>
              <p className="font-medium text-foreground">Method</p>
              <p>{explanation.replace(/(\d{4}-\d{2}-\d{2})/g, (m) => fmtDate(m))}</p>
            </>
          )}
          <p className="font-medium text-foreground">Sources</p>
          <SourceList sources={ev.sources} />
          {notes.length > 0 && (
            <>
              <p className="font-medium text-foreground">Notes</p>
              <ul className="list-disc space-y-1 pl-4">
                {notes.map((w) => <li key={w}>{w}</li>)}
              </ul>
            </>
          )}
        </div>
      )}
    </section>
  );
}

export function InterpretedQuery({ rq }: { rq: ResolvedQuery }) {
  const cities = rq.cities?.length ? rq.cities.join(", ") : rq.city;
  return (
    <section aria-label="How the question was read">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-foreground">
        {cities && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5 text-subtle" aria-hidden />{cities}</span>}
        {rq.pollutant && <span className="inline-flex items-center gap-1"><Gauge className="size-3.5 text-subtle" aria-hidden />{pollutantLabel(rq.pollutant)}</span>}
        {rq.start_date && (
          <span className="inline-flex items-center gap-1"><CalendarRange className="size-3.5 text-subtle" aria-hidden />{fmtRange(rq.start_date, rq.end_date)}</span>
        )}
      </p>
      {rq.assumptions?.length > 0 && (
        <ul className="mt-1 list-disc space-y-0.5 pl-4">
          {rq.assumptions.map((a) => <li key={a}>{a.replace(/(\d{4}-\d{2}-\d{2})/g, (m) => fmtDate(m))}</li>)}
        </ul>
      )}
    </section>
  );
}

const TYPE_TEXT: Record<string, string> = {
  measured: "text-teal",
  modelled: "text-modelled",
  official_aqi: "text-[#93C5FD]",
  mixed: "text-modelled",
};

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
    <ul className="space-y-1.5">
      {sources.map((s) => (
        <li key={s.dataset_id}>
          <span className="text-foreground">{s.title}</span> · {s.source} · {DATA_TYPE_LABEL[s.data_type]} · {fmtRange(s.date_range.start, s.date_range.end)}
        </li>
      ))}
    </ul>
  );
}

// ------------------------------------------------------------------ required notes (always shown, no box)
export function RequiredNotes({ notes }: { notes: { code: string; text: string }[] }) {
  if (!notes.length) return null;
  return (
    <ul aria-label="Important notes" className="flex flex-col gap-1 border-l-2 border-warn/60 pl-3 text-[13px] leading-5 text-subtle">
      {notes.map((w) => <li key={`${w.code}:${w.text}`}>{w.text}</li>)}
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

