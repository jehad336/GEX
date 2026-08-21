'use client';

import * as echarts from 'echarts/core';
import { BarChart, HeatmapChart, LineChart, ScatterChart } from 'echarts/charts';
import {
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { useEffect, useRef } from 'react';

echarts.use([
  BarChart,
  LineChart,
  ScatterChart,
  HeatmapChart,
  GridComponent,
  TooltipComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  VisualMapComponent,
  DataZoomComponent,
  CanvasRenderer,
]);

/** Applies an alpha channel to an `rgb(...)` token produced by themeColors(). */
export function withAlpha(color: string, alpha: number): string {
  const m = color.match(/^rgb\(([^)]+)\)$/);
  if (!m || !m[1]) return color;
  return `rgba(${m[1]},${alpha})`;
}

/** Reads the live CSS custom properties so charts follow the theme exactly. */
export function themeColors(theme: string = 'dark') {
  if (typeof window === 'undefined') {
    return theme === 'light'
      ? { ink: '#141a26', muted: '#5a6476', faint: '#8a94a6', line: '#dee2ea', pos: '#0e915a', neg: '#ca2c2c', warn: '#b08008', accent: '#2563eb', surface: '#ffffff' }
      : { ink: '#e8ecf5', muted: '#94a0b4', faint: '#606c80', line: '#262c3a', pos: '#22c57e', neg: '#f45454', warn: '#eab308', accent: '#60a5fa', surface: '#0f121a' };
  }
  const s = getComputedStyle(document.documentElement);
  const rgb = (name: string, fallback: string) => {
    const v = s.getPropertyValue(name).trim();
    return v ? `rgb(${v.split(/\s+/).join(',')})` : fallback;
  };
  return {
    ink: rgb('--ink', '#e8ecf5'),
    muted: rgb('--muted', '#94a0b4'),
    faint: rgb('--faint', '#606c80'),
    line: rgb('--line', '#262c3a'),
    pos: rgb('--pos', '#22c57e'),
    neg: rgb('--neg', '#f45454'),
    warn: rgb('--warn', '#eab308'),
    accent: rgb('--accent', '#60a5fa'),
    surface: rgb('--surface', '#0f121a'),
  };
}

export function baseTooltip(colors: ReturnType<typeof themeColors>) {
  return {
    backgroundColor: colors.surface,
    borderColor: colors.line,
    borderWidth: 1,
    textStyle: { color: colors.ink, fontSize: 11 },
    extraCssText: 'box-shadow: 0 8px 24px rgba(0,0,0,0.35); border-radius: 6px;',
  };
}

export function EChart({
  option,
  height,
  className,
  theme,
  onEvents,
}: {
  option: echarts.EChartsCoreOption;
  height: number;
  className?: string;
  /** Included in the dependency list so a theme switch forces a full re-style. */
  theme?: string;
  onEvents?: Record<string, (params: unknown) => void>;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<echarts.ECharts | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current, undefined, { renderer: 'canvas' });
    chartRef.current = chart;

    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(ref.current);

    return () => {
      observer.disconnect();
      chart.dispose();
      chartRef.current = null;
    };
    // Re-created on theme change so every baked-in colour is refreshed.
  }, [theme]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart) return;
    // notMerge: stale series from a previous symbol must not linger.
    chart.setOption(option, { notMerge: true, lazyUpdate: true });
    // `theme` is a dependency because the effect above disposes and rebuilds the
    // chart on a theme change; the fresh instance has no option until this runs.
  }, [option, theme]);

  useEffect(() => {
    const chart = chartRef.current;
    if (!chart || !onEvents) return;
    for (const [name, handler] of Object.entries(onEvents)) {
      chart.on(name, handler);
    }
    return () => {
      for (const name of Object.keys(onEvents)) chart.off(name);
    };
  }, [onEvents]);

  return <div ref={ref} className={className} style={{ height, width: '100%' }} />;
}
