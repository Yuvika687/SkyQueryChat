"use client";

// ECharts is large: pages load it only when a chart is on screen (its own code chunk).
import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ds/states";

const EChart = dynamic(() => import("./echart").then((m) => m.EChart), {
  ssr: false,
  loading: () => <Skeleton className="h-full min-h-40 w-full" />,
});

export function LazyChart({ option, height, ariaLabel }: { option: Record<string, unknown>; height: number; ariaLabel: string }) {
  return (
    <div style={{ height }}>
      <EChart option={option} height={height} ariaLabel={ariaLabel} />
    </div>
  );
}
