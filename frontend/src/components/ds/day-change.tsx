// "▲ 12.4 vs 10 Nov": change against the previous day, calculated in Python (/api/latest). Nothing is shown when
// the previous day has no value. Up/down is in the arrow AND the words (screen readers), never colour alone.
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function DayChange({ change, previous, unit = "µg/m³", className }: {
  change: number | null | undefined;
  previous: { date: string; value: number } | null | undefined;
  unit?: string;
  className?: string;
}) {
  if (change == null || !previous) return null;
  const day = fmtDate(previous.date).replace(/ \d{4}$/, "");
  const word = change > 0 ? "up" : change < 0 ? "down" : "no change";
  return (
    <span className={cn("num inline-flex items-center gap-1 text-[12px] whitespace-nowrap", change > 0 ? "text-[#FDBA74]" : change < 0 ? "text-teal" : "text-subtle", className)}>
      <span aria-hidden>{change > 0 ? "▲" : change < 0 ? "▼" : "■"}</span>
      <span aria-hidden>{Math.abs(change).toFixed(1)} vs {day}</span>
      <span className="sr-only">{word} {Math.abs(change).toFixed(1)} {unit} from {fmtDate(previous.date)}</span>
    </span>
  );
}
