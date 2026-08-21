'use client';

import { useMemo } from 'react';

import { EChart, baseTooltip, themeColors } from './EChart';
import { formatExposureAuto, formatPrice } from '@/lib/format';
import type { GammaProfileResponse } from '@/lib/types';

/**
 * Net GEX repriced across hypothetical spot prices. This is the chart that
 * answers "where does dealer hedging change character?", so the zero crossing,
 * the walls and current spot are all marked directly on it.
 */
export function GammaProfileChart({
  data,
  height = 340,
  theme,
}: {
  data: GammaProfileResponse;
  height?: number;
  theme: string;
}) {
  const colors = useMemo(() => themeColors(theme), [theme]);

  const option = useMemo(() => {
    const c = colors;
    const points = data.points;

    // Split at zero so the positive and negative regions read as different states.
    const positive = points.map((p) => [p.price, p.net_gex > 0 ? p.net_gex : null]);
    const negative = points.map((p) => [p.price, p.net_gex <= 0 ? p.net_gex : null]);

    const marks: Record<string, unknown>[] = [
      {
        xAxis: data.spot,
        lineStyle: { color: c.ink, width: 1.5 },
        label: { formatter: `SPOT ${formatPrice(data.spot)}`, color: c.ink, fontSize: 10 },
      },
    ];
    if (data.zero_gamma !== null) {
      marks.push({
        xAxis: data.zero_gamma,
        lineStyle: { color: c.warn, width: 1.5, type: 'dashed' },
        label: {
          formatter: `FLIP ${formatPrice(data.zero_gamma)}`,
          color: c.warn,
          fontSize: 10,
          position: 'insideEndBottom',
        },
      });
    }
    if (data.call_wall?.price != null) {
      marks.push({
        xAxis: data.call_wall.price,
        lineStyle: { color: c.pos, width: 1, type: 'dotted' },
        label: { formatter: 'CALL WALL', color: c.pos, fontSize: 9 },
      });
    }
    if (data.put_wall?.price != null) {
      marks.push({
        xAxis: data.put_wall.price,
        lineStyle: { color: c.neg, width: 1, type: 'dotted' },
        label: { formatter: 'PUT WALL', color: c.neg, fontSize: 9, position: 'insideEndBottom' },
      });
    }

    return {
      animation: false,
      grid: { left: 66, right: 16, top: 24, bottom: 34 },
      tooltip: {
        ...baseTooltip(c),
        trigger: 'axis',
        formatter: (params: unknown) => {
          const arr = params as { axisValue: number }[];
          const first = arr[0];
          if (!first) return '';
          const price = Number(first.axisValue);
          const point = points.reduce((best, p) =>
            Math.abs(p.price - price) < Math.abs(best.price - price) ? p : best,
          );
          const move = ((point.price - data.spot) / data.spot) * 100;
          return [
            `<b>Hypothetical spot ${formatPrice(point.price)}</b>`,
            `<span style="color:${c.faint}">${move >= 0 ? '+' : ''}${move.toFixed(2)}% from current</span>`,
            `<hr style="border:none;border-top:1px solid ${c.line};margin:5px 0" />`,
            `Net GEX: <b style="color:${point.net_gex >= 0 ? c.pos : c.neg}">${formatExposureAuto(point.net_gex)}</b>`,
            `Call leg: ${formatExposureAuto(point.call_gex)}`,
            `Put leg: ${formatExposureAuto(point.put_gex)}`,
          ].join('<br/>');
        },
      },
      xAxis: {
        type: 'value',
        min: points[0]?.price,
        max: points[points.length - 1]?.price,
        axisLine: { lineStyle: { color: c.line } },
        axisLabel: { color: c.faint, fontSize: 10, formatter: (v: number) => formatPrice(v, 0) },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'Net GEX',
        nameTextStyle: { color: c.faint, fontSize: 10, align: 'left' },
        splitLine: { lineStyle: { color: c.line, opacity: 0.4 } },
        axisLabel: { color: c.faint, fontSize: 10, formatter: formatExposureAuto },
      },
      series: [
        {
          name: 'Positive gamma',
          type: 'line',
          data: positive,
          symbol: 'none',
          connectNulls: false,
          lineStyle: { color: c.pos, width: 2 },
          areaStyle: { color: c.pos, opacity: 0.14 },
        },
        {
          name: 'Negative gamma',
          type: 'line',
          data: negative,
          symbol: 'none',
          connectNulls: false,
          lineStyle: { color: c.neg, width: 2 },
          areaStyle: { color: c.neg, opacity: 0.14 },
          markLine: { silent: true, symbol: 'none', data: marks },
        },
      ],
    };
  }, [data, colors]);

  return <EChart option={option} height={height} theme={theme} />;
}
