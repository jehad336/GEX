'use client';

import { useMemo } from 'react';

import { EChart, baseTooltip, themeColors } from './EChart';
import { formatDateShort, formatExposureAuto, formatNumber, formatPrice } from '@/lib/format';
import type { HeatmapResponse } from '@/lib/types';

/**
 * Strike (y) by expiration (x) grid of gamma exposure.
 *
 * Diverging scale centred on zero, so positive and negative gamma are visually
 * distinct rather than merely different intensities of one hue.
 */
export function GexHeatmap({
  data,
  height = 420,
  theme,
}: {
  data: HeatmapResponse;
  height?: number;
  theme: string;
}) {
  const colors = useMemo(() => themeColors(theme), [theme]);

  const option = useMemo(() => {
    const c = colors;
    const values = data.cells.map((cell) => cell.value);
    const peak = values.length ? Math.max(...values.map(Math.abs)) : 1;

    const spotIndex = data.strikes.reduce(
      (best, strike, i) =>
        Math.abs(strike - data.spot) < Math.abs((data.strikes[best] ?? 0) - data.spot) ? i : best,
      0,
    );

    const diverging =
      data.metric === 'net'
        ? [c.neg, 'rgba(120,130,150,0.12)', c.pos]
        : data.metric === 'call'
          ? ['rgba(120,130,150,0.10)', c.pos]
          : [c.neg, 'rgba(120,130,150,0.10)'];

    return {
      animation: false,
      grid: { left: 62, right: 20, top: 12, bottom: 56 },
      tooltip: {
        ...baseTooltip(c),
        formatter: (params: unknown) => {
          const p = params as { dataIndex: number };
          const cell = data.cells[p.dataIndex];
          if (!cell) return '';
          return [
            `<b>${formatPrice(cell.strike)} · ${formatDateShort(cell.expiration)}</b>`,
            `<span style="color:${c.faint}">${cell.dte < 1 ? '0DTE' : `${Math.round(cell.dte)} DTE`}</span>`,
            `<hr style="border:none;border-top:1px solid ${c.line};margin:5px 0" />`,
            `GEX: <b style="color:${cell.value >= 0 ? c.pos : c.neg}">${formatExposureAuto(cell.value)}</b>`,
            `DEX: ${formatExposureAuto(cell.net_dex)}`,
            `Call OI: ${formatNumber(cell.call_oi)} · Put OI: ${formatNumber(cell.put_oi)}`,
            `Call Vol: ${formatNumber(cell.call_volume)} · Put Vol: ${formatNumber(cell.put_volume)}`,
          ].join('<br/>');
        },
      },
      visualMap: {
        min: data.metric === 'net' ? -peak : data.metric === 'put' ? -peak : 0,
        max: data.metric === 'put' ? 0 : peak,
        calculable: false,
        orient: 'horizontal',
        left: 'center',
        bottom: 4,
        itemWidth: 10,
        itemHeight: 90,
        textStyle: { color: c.faint, fontSize: 9 },
        formatter: (v: number) => formatExposureAuto(v),
        inRange: { color: diverging },
      },
      xAxis: {
        type: 'category',
        data: data.expirations.map(formatDateShort),
        splitArea: { show: false },
        axisLine: { lineStyle: { color: c.line } },
        axisTick: { show: false },
        axisLabel: { color: c.faint, fontSize: 9, hideOverlap: true, rotate: 40 },
      },
      yAxis: {
        type: 'category',
        data: data.strikes.map((s) => formatPrice(s, s % 1 === 0 ? 0 : 2)),
        splitArea: { show: false },
        axisLine: { lineStyle: { color: c.line } },
        axisTick: { show: false },
        axisLabel: { color: c.faint, fontSize: 9, hideOverlap: true },
      },
      series: [
        {
          type: 'heatmap',
          data: data.cells.map((cell) => [cell.x, cell.y, cell.value]),
          progressive: 2000,
          itemStyle: { borderWidth: 0 },
          emphasis: { itemStyle: { borderColor: c.ink, borderWidth: 1 } },
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              {
                yAxis: spotIndex,
                lineStyle: { color: c.ink, width: 1.5, type: 'dashed' },
                label: {
                  formatter: `SPOT ${formatPrice(data.spot)}`,
                  color: c.ink,
                  fontSize: 9,
                  position: 'insideEndTop',
                },
              },
            ],
          },
        },
      ],
    };
  }, [data, colors]);

  return <EChart option={option} height={height} theme={theme} />;
}
