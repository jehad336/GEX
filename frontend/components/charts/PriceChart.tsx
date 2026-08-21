'use client';

import {
  ColorType,
  CrosshairMode,
  LineStyle,
  createChart,
  type IChartApi,
  type ISeriesApi,
  type UTCTimestamp,
} from 'lightweight-charts';
import { useEffect, useRef } from 'react';

import { themeColors, withAlpha } from './EChart';
import type { Bar, Level, Underlying } from '@/lib/types';

export interface PriceLevel {
  price: number;
  label: string;
  color: string;
  style?: LineStyle;
}

/**
 * Candles, volume and VWAP with the options-derived levels drawn on top. The
 * levels are the reason this chart exists: price alone is available anywhere.
 */
export function PriceChart({
  bars,
  levels,
  height = 420,
  theme,
}: {
  bars: Bar[];
  levels: PriceLevel[];
  height?: number;
  theme: string;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null);
  const volumeRef = useRef<ISeriesApi<'Histogram'> | null>(null);
  const vwapRef = useRef<ISeriesApi<'Line'> | null>(null);
  // A theme change tears the chart down and rebuilds it. React runs every
  // cleanup before any effect, so this flag lets the later cleanups know the
  // series they captured is already gone.
  const disposedRef = useRef(false);

  useEffect(() => {
    if (!containerRef.current) return;
    const c = themeColors();
    disposedRef.current = false;

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: 'transparent' },
        textColor: c.faint,
        fontSize: 10,
      },
      grid: {
        vertLines: { color: c.line, style: LineStyle.Dotted },
        horzLines: { color: c.line, style: LineStyle.Dotted },
      },
      rightPriceScale: { borderColor: c.line, scaleMargins: { top: 0.08, bottom: 0.26 } },
      timeScale: { borderColor: c.line, timeVisible: true, secondsVisible: false },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: { color: c.faint, labelBackgroundColor: c.accent },
        horzLine: { color: c.faint, labelBackgroundColor: c.accent },
      },
    });
    chartRef.current = chart;

    candleRef.current = chart.addCandlestickSeries({
      upColor: c.pos,
      downColor: c.neg,
      borderUpColor: c.pos,
      borderDownColor: c.neg,
      wickUpColor: c.pos,
      wickDownColor: c.neg,
    });

    volumeRef.current = chart.addHistogramSeries({
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({ scaleMargins: { top: 0.82, bottom: 0 } });

    vwapRef.current = chart.addLineSeries({
      color: c.accent,
      lineWidth: 1,
      lineStyle: LineStyle.Dashed,
      priceLineVisible: false,
      lastValueVisible: false,
      title: 'VWAP',
    });

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (entry) chart.applyOptions({ width: entry.contentRect.width });
    });
    observer.observe(containerRef.current);
    chart.applyOptions({ width: containerRef.current.clientWidth });

    return () => {
      disposedRef.current = true;
      observer.disconnect();
      chart.remove();
      chartRef.current = null;
      candleRef.current = null;
      volumeRef.current = null;
      vwapRef.current = null;
    };
  }, [height, theme]);

  // Candles / volume / VWAP.
  useEffect(() => {
    const candles = candleRef.current;
    const volume = volumeRef.current;
    const vwap = vwapRef.current;
    if (disposedRef.current || !candles || !volume || !vwap || bars.length === 0) return;
    const c = themeColors(theme);

    const toTime = (iso: string) => (new Date(iso).getTime() / 1000) as UTCTimestamp;

    candles.setData(
      bars.map((b) => ({ time: toTime(b.t), open: b.o, high: b.h, low: b.l, close: b.c })),
    );
    volume.setData(
      bars.map((b) => ({
        time: toTime(b.t),
        value: b.v,
        // themeColors() yields rgb(...) tokens, so alpha must be applied
        // structurally - appending a hex suffix produces an invalid colour.
        color: withAlpha(b.c >= b.o ? c.pos : c.neg, 0.28),
      })),
    );
    const vwapPoints = bars
      .filter((b) => b.vwap !== null)
      .map((b) => ({ time: toTime(b.t), value: b.vwap as number }));
    vwap.setData(vwapPoints);

    chartRef.current?.timeScale().fitContent();
  }, [bars, theme]);

  // Horizontal option-derived levels, redrawn whenever they move.
  useEffect(() => {
    const candles = candleRef.current;
    if (disposedRef.current || !candles) return;
    const lines = levels
      .filter((l) => Number.isFinite(l.price))
      .map((l) =>
        candles.createPriceLine({
          price: l.price,
          color: l.color,
          lineWidth: 1,
          lineStyle: l.style ?? LineStyle.Dashed,
          axisLabelVisible: true,
          title: l.label,
        }),
      );
    return () => {
      // Removing a line from an already-disposed series throws; skip instead.
      if (disposedRef.current) return;
      for (const line of lines) {
        try {
          candles.removePriceLine(line);
        } catch {
          /* series torn down between render and cleanup */
        }
      }
    };
  }, [levels, theme]);

  return <div ref={containerRef} style={{ height }} className="w-full" />;
}

/** Builds the overlay set from the GEX levels plus the session's own prices. */
export function buildPriceLevels(
  levels: Record<string, Level> | undefined,
  underlying: Underlying | null | undefined,
  expectedMove: { upper: number | null; lower: number | null } | null | undefined,
  theme: string = 'dark',
): PriceLevel[] {
  const c = themeColors(theme);
  const out: PriceLevel[] = [];
  const push = (price: number | null | undefined, label: string, color: string, style?: LineStyle) => {
    if (price === null || price === undefined || !Number.isFinite(price)) return;
    out.push({ price, label, color, style });
  };

  push(levels?.gamma_flip?.price, 'Gamma Flip', c.warn, LineStyle.Solid);
  push(levels?.call_wall?.price, 'Call Wall', c.pos, LineStyle.Solid);
  push(levels?.put_wall?.price, 'Put Wall', c.neg, LineStyle.Solid);
  push(levels?.largest_call_gamma?.price, 'Top Call Γ', c.pos, LineStyle.Dotted);
  push(levels?.largest_put_gamma?.price, 'Top Put Γ', c.neg, LineStyle.Dotted);
  push(expectedMove?.upper, 'EM High', c.accent, LineStyle.Dashed);
  push(expectedMove?.lower, 'EM Low', c.accent, LineStyle.Dashed);
  push(underlying?.previous_close, 'Prev Close', c.faint, LineStyle.Dotted);
  push(underlying?.open, 'Day Open', c.faint, LineStyle.Dotted);
  push(underlying?.high, 'Day High', c.faint, LineStyle.Dotted);
  push(underlying?.low, 'Day Low', c.faint, LineStyle.Dotted);

  return out;
}
