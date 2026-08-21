'use client';

import { useMemo } from 'react';

import { EChart, baseTooltip, themeColors } from './EChart';
import { formatExposureAuto, formatNumber, formatPrice } from '@/lib/format';
import type { Level, StrikeGex } from '@/lib/types';

interface Props {
  rows: StrikeGex[];
  spot: number;
  height?: number;
  theme: string;
  levels?: Record<string, Level>;
  metric?: 'gex' | 'dex' | 'vanna' | 'charm';
}

const METRIC_LABEL: Record<NonNullable<Props['metric']>, string> = {
  gex: 'Gamma Exposure',
  dex: 'Delta Exposure',
  vanna: 'Vanna Exposure',
  charm: 'Charm Exposure',
};

export function GexByStrikeChart({
  rows,
  spot,
  height = 320,
  theme,
  levels,
  metric = 'gex',
}: Props) {
  const colors = useMemo(() => themeColors(theme), [theme]);

  const option = useMemo(() => {
    const c = colors;
    const strikes = rows.map((r) => r.strike);

    const callSeries = rows.map((r) =>
      metric === 'gex' ? r.call_gex : metric === 'dex' ? r.call_dex : 0,
    );
    const putSeries = rows.map((r) =>
      metric === 'gex' ? r.put_gex : metric === 'dex' ? r.put_dex : 0,
    );
    const netSeries = rows.map((r) =>
      metric === 'vanna' ? r.net_vanna : metric === 'charm' ? r.net_charm : r.net_gex,
    );
    const stacked = metric === 'gex' || metric === 'dex';

    // Vertical markers for spot and each derived level.
    const markLines: Record<string, unknown>[] = [
      {
        xAxis: closestIndex(strikes, spot),
        lineStyle: { color: c.ink, width: 1.5, type: 'solid' },
        label: {
          formatter: `SPOT ${formatPrice(spot)}`,
          color: c.ink,
          fontSize: 10,
          position: 'insideEndTop',
        },
      },
    ];
    const overlay: [string | undefined, number | null | undefined, string][] = [
      ['FLIP', levels?.gamma_flip?.price, c.warn],
      ['CALL WALL', levels?.call_wall?.price, c.pos],
      ['PUT WALL', levels?.put_wall?.price, c.neg],
    ];
    for (const [label, price, color] of overlay) {
      if (price === null || price === undefined || !strikes.length) continue;
      markLines.push({
        xAxis: closestIndex(strikes, price),
        lineStyle: { color, width: 1, type: 'dashed' },
        label: { formatter: label, color, fontSize: 9, position: 'insideEndBottom' },
      });
    }

    const series: Record<string, unknown>[] = stacked
      ? [
          {
            name: 'Call',
            type: 'bar',
            stack: 'exposure',
            data: callSeries,
            itemStyle: { color: c.pos, borderRadius: 0 },
            barMaxWidth: 14,
          },
          {
            name: 'Put',
            type: 'bar',
            stack: 'exposure',
            data: putSeries,
            itemStyle: { color: c.neg },
            barMaxWidth: 14,
          },
          {
            name: 'Net',
            type: 'line',
            data: netSeries,
            symbol: 'none',
            lineStyle: { color: c.accent, width: 1.5 },
            markLine: { silent: true, symbol: 'none', data: markLines },
          },
        ]
      : [
          {
            name: 'Net',
            type: 'bar',
            data: netSeries,
            barMaxWidth: 14,
            // Colour by sign so the zero line reads instantly.
            itemStyle: {
              color: (p: { value: number }) => (p.value >= 0 ? c.pos : c.neg),
            },
            markLine: { silent: true, symbol: 'none', data: markLines },
          },
        ];

    return {
      animation: false,
      grid: { left: 62, right: 16, top: 28, bottom: 34 },
      tooltip: {
        ...baseTooltip(c),
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: unknown) => {
          const arr = params as { dataIndex: number }[];
          const first = arr[0];
          if (!first) return '';
          const row = rows[first.dataIndex];
          if (!row) return '';
          const away = ((row.strike - spot) / spot) * 100;
          return [
            `<b>Strike ${formatPrice(row.strike)}</b> <span style="color:${c.faint}">(${away >= 0 ? '+' : ''}${away.toFixed(2)}% from spot)</span>`,
            `<hr style="border:none;border-top:1px solid ${c.line};margin:5px 0" />`,
            `Call GEX: <b style="color:${c.pos}">${formatExposureAuto(row.call_gex)}</b>`,
            `Put GEX: <b style="color:${c.neg}">${formatExposureAuto(row.put_gex)}</b>`,
            `Net GEX: <b>${formatExposureAuto(row.net_gex)}</b>`,
            `Net DEX: ${formatExposureAuto(row.net_dex)}`,
            `<hr style="border:none;border-top:1px solid ${c.line};margin:5px 0" />`,
            `Call OI: ${formatNumber(row.call_oi)} &nbsp; Put OI: ${formatNumber(row.put_oi)}`,
            `Call Vol: ${formatNumber(row.call_volume)} &nbsp; Put Vol: ${formatNumber(row.put_volume)}`,
          ].join('<br/>');
        },
      },
      legend: stacked
        ? {
            top: 0,
            right: 8,
            itemWidth: 10,
            itemHeight: 8,
            textStyle: { color: c.muted, fontSize: 10 },
          }
        : undefined,
      xAxis: {
        type: 'category',
        data: strikes.map((s) => formatPrice(s, s % 1 === 0 ? 0 : 2)),
        axisLine: { lineStyle: { color: c.line } },
        axisLabel: { color: c.faint, fontSize: 10, hideOverlap: true },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        name: METRIC_LABEL[metric],
        nameTextStyle: { color: c.faint, fontSize: 10, align: 'left' },
        nameGap: 12,
        splitLine: { lineStyle: { color: c.line, opacity: 0.45 } },
        axisLabel: { color: c.faint, fontSize: 10, formatter: formatExposureAuto },
      },
      series,
    };
  }, [rows, spot, levels, metric, colors]);

  return <EChart option={option} height={height} theme={theme} />;
}

function closestIndex(values: number[], target: number): number {
  let best = 0;
  let bestDiff = Infinity;
  for (let i = 0; i < values.length; i += 1) {
    const v = values[i];
    if (v === undefined) continue;
    const diff = Math.abs(v - target);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  }
  return best;
}
