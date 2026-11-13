"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef } from "react";
import * as echarts from "echarts/core";
import { BarChart, HeatmapChart, LineChart, ScatterChart } from "echarts/charts";
import {
  CalendarComponent, DataZoomComponent, GridComponent, LegendComponent, MarkAreaComponent, MarkLineComponent,
  TooltipComponent, VisualMapComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";

echarts.use([
  LineChart, BarChart, ScatterChart, HeatmapChart, GridComponent, TooltipComponent, LegendComponent, DataZoomComponent,
  MarkLineComponent, MarkAreaComponent, CalendarComponent, VisualMapComponent, CanvasRenderer,
]);

export interface EChartHandle {
  toPNG: () => string | null;
}

interface Props {
  option: Record<string, unknown>;
  height: number;
  ariaLabel: string;
  /** Receives the chart handle (PNG export). A plain prop, because lazily loaded components do not forward refs. */
  handle?: React.MutableRefObject<EChartHandle | null>;
}

export const EChart = forwardRef<EChartHandle, Props>(function EChart({ option, height, ariaLabel, handle }, ref) {
  const el = useRef<HTMLDivElement>(null);
  const chart = useRef<echarts.ECharts | null>(null);

  useImperativeHandle(ref, () => ({
    toPNG: () => chart.current?.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#121A2E" }) ?? null,
  }));

  useEffect(() => {
    if (!el.current) return;
    const c = echarts.init(el.current, undefined, { renderer: "canvas" });
    chart.current = c;
    if (handle) handle.current = { toPNG: () => c.getDataURL({ type: "png", pixelRatio: 2, backgroundColor: "#121A2E" }) };
    const ro = new ResizeObserver(() => c.resize());
    ro.observe(el.current);
    return () => {
      ro.disconnect();
      c.dispose();
      chart.current = null;
      if (handle) handle.current = null;
    };
  }, [handle]);

  useEffect(() => {
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    chart.current?.setOption({ ...option, animation: !reduce }, true);
  }, [option]);

  // The canvas is not readable by screen readers; the Table tab carries the same data.
  return <div ref={el} role="img" aria-label={ariaLabel} style={{ height, width: "100%" }} />;
});
