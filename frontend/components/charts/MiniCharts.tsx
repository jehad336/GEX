'use client';

import { useMemo } from 'react';

import { EChart, baseTooltip, themeColors } from './EChart';
import {
  formatDateShort,
  formatExposureAuto,
  formatIv,
  formatNumber,
  formatPrice,
  formatTime,
} from '@/lib/format';
import type { ExpiryGex, HistoryPoint, IvResponse, StrikeGex } from '@/lib/types';

/* ------------------------------------------------------------- by expiry */

export function GexByExpiryChart({
  rows,
  height = 260,
  theme,
}: {
  rows: ExpiryGex[];
  height?: number;
  theme: string;
}) {
  const colors = useMemo(() => themeColors(theme), [theme]);

  const option = useMemo(() => {
    const c = colors;
    return {
      animation: false,
      grid: { left: 62, right: 14, top: 26, bottom: 46 },
      tooltip: {
        ...baseTooltip(c),
        trigger: 'axis',
        formatter: (params: unknown) => {
          const arr = params as { dataIndex: number }[];
          const row = rows[arr[0]?.dataIndex ?? 0];
          if (!row) return '';
          return [
            `<b>${formatDateShort(row.expiration)}</b> · ${row.dte < 1 ? '0DTE' : `${Math.round(row.dte)} DTE`}`,
            `<hr style="border:none;border-top:1px solid ${c.line};margin:5px 0" />`,
            `Net GEX: <b>${formatExposureAuto(row.net_gex)}</b>`,
            `Call: <span style="color:${c.pos}">${formatExposureAuto(row.call_gex)}</span>`,
            `Put: <span style="color:${c.neg}">${formatExposureAuto(row.put_gex)}</span>`,
            `ATM IV: ${formatIv(row.atm_iv)}`,
            `Contracts: ${formatNumber(row.contract_count)}`,
          ].join('<br/>');
        },
      },
      legend: { top: 0, right: 6, itemWidth: 10, itemHeight: 8, textStyle: { color: c.muted, fontSize: 10 } },
      xAxis: {
        type: 'category',
        data: rows.map((r) => formatDateShort(r.expiration)),
        axisLine: { lineStyle: { color: c.line } },
        axisTick: { show: false },
        axisLabel: { color: c.faint, fontSize: 9, rotate: 40, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: c.line, opacity: 0.4 } },
        axisLabel: { color: c.faint, fontSize: 10, formatter: formatExposureAuto },
      },
      series: [
        {
          name: 'Call',
          type: 'bar',
          stack: 'g',
          data: rows.map((r) => r.call_gex),
          itemStyle: { color: c.pos },
          barMaxWidth: 20,
        },
        {
          name: 'Put',
          type: 'bar',
          stack: 'g',
          data: rows.map((r) => r.put_gex),
          itemStyle: { color: c.neg },
          barMaxWidth: 20,
        },
      ],
    };
  }, [rows, colors]);

  return <EChart option={option} height={height} theme={theme} />;
}

/* ------------------------------------------------------------- OI / volume */

export function OiVolumeChart({
  rows,
  spot,
  mode,
  height = 260,
  theme,
}: {
  rows: StrikeGex[];
  spot: number;
  mode: 'oi' | 'volume';
  height?: number;
  theme: string;
}) {
  const colors = useMemo(() => themeColors(theme), [theme]);

  const option = useMemo(() => {
    const c = colors;
    const strikes = rows.map((r) => r.strike);
    const calls = rows.map((r) => (mode === 'oi' ? r.call_oi : r.call_volume));
    // Puts render downward, so the two sides never visually compete.
    const puts = rows.map((r) => -(mode === 'oi' ? r.put_oi : r.put_volume));

    let spotIdx = 0;
    let best = Infinity;
    strikes.forEach((s, i) => {
      const d = Math.abs(s - spot);
      if (d < best) {
        best = d;
        spotIdx = i;
      }
    });

    return {
      animation: false,
      grid: { left: 56, right: 14, top: 24, bottom: 32 },
      tooltip: {
        ...baseTooltip(c),
        trigger: 'axis',
        axisPointer: { type: 'shadow' },
        formatter: (params: unknown) => {
          const arr = params as { dataIndex: number }[];
          const row = rows[arr[0]?.dataIndex ?? 0];
          if (!row) return '';
          const call = mode === 'oi' ? row.call_oi : row.call_volume;
          const put = mode === 'oi' ? row.put_oi : row.put_volume;
          return [
            `<b>Strike ${formatPrice(row.strike)}</b>`,
            `Call ${mode === 'oi' ? 'OI' : 'Volume'}: <b style="color:${c.pos}">${formatNumber(call)}</b>`,
            `Put ${mode === 'oi' ? 'OI' : 'Volume'}: <b style="color:${c.neg}">${formatNumber(put)}</b>`,
            mode === 'volume' && row.total_oi
              ? `Vol/OI: ${((row.call_volume + row.put_volume) / row.total_oi).toFixed(2)}`
              : '',
          ]
            .filter(Boolean)
            .join('<br/>');
        },
      },
      legend: { top: 0, right: 6, itemWidth: 10, itemHeight: 8, textStyle: { color: c.muted, fontSize: 10 } },
      xAxis: {
        type: 'category',
        data: strikes.map((s) => formatPrice(s, s % 1 === 0 ? 0 : 2)),
        axisLine: { lineStyle: { color: c.line } },
        axisTick: { show: false },
        axisLabel: { color: c.faint, fontSize: 9, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        splitLine: { lineStyle: { color: c.line, opacity: 0.4 } },
        axisLabel: {
          color: c.faint,
          fontSize: 10,
          formatter: (v: number) => formatNumber(Math.abs(v)),
        },
      },
      series: [
        {
          name: 'Call',
          type: 'bar',
          data: calls,
          itemStyle: { color: c.pos },
          barMaxWidth: 14,
          markLine: {
            silent: true,
            symbol: 'none',
            data: [
              {
                xAxis: spotIdx,
                lineStyle: { color: c.ink, width: 1.5 },
                label: { formatter: 'SPOT', color: c.ink, fontSize: 9 },
              },
            ],
          },
        },
        { name: 'Put', type: 'bar', data: puts, itemStyle: { color: c.neg }, barMaxWidth: 14 },
      ],
    };
  }, [rows, spot, mode, colors]);

  return <EChart option={option} height={height} theme={theme} />;
}

/* ------------------------------------------------------------- skew */

export function SkewChart({
  data,
  xMode,
  height = 240,
  theme,
}: {
  data: IvResponse;
  xMode: 'strike' | 'delta';
  height?: number;
  theme: string;
}) {
  const colors = useMemo(() => themeColors(theme), [theme]);

  const option = useMemo(() => {
    const c = colors;
    const toPoint = (p: IvResponse['skew_points'][number]) => [
      xMode === 'strike' ? p.strike : Math.abs(p.delta ?? 0),
      p.iv * 100,
    ];
    const calls = data.skew_points.filter((p) => p.type === 'call').map(toPoint);
    const puts = data.skew_points.filter((p) => p.type === 'put').map(toPoint);

    return {
      animation: false,
      grid: { left: 46, right: 14, top: 24, bottom: 32 },
      tooltip: {
        ...baseTooltip(c),
        trigger: 'item',
        formatter: (params: unknown) => {
          const p = params as { seriesName: string; value: [number, number] };
          return `${p.seriesName}<br/>${xMode === 'strike' ? 'Strike' : '|Delta|'}: <b>${xMode === 'strike' ? formatPrice(p.value[0]) : p.value[0].toFixed(2)}</b><br/>IV: <b>${p.value[1].toFixed(2)}%</b>`;
        },
      },
      legend: { top: 0, right: 6, itemWidth: 10, itemHeight: 8, textStyle: { color: c.muted, fontSize: 10 } },
      xAxis: {
        type: 'value',
        // Frame the plotted strikes instead of anchoring the axis at zero,
        // which would squeeze the whole curve into the right-hand edge.
        scale: true,
        axisLine: { lineStyle: { color: c.line } },
        axisLabel: {
          color: c.faint,
          fontSize: 10,
          formatter: (v: number) => (xMode === 'strike' ? formatPrice(v, 0) : v.toFixed(2)),
        },
        splitLine: { show: false },
      },
      yAxis: {
        type: 'value',
        name: 'IV %',
        nameTextStyle: { color: c.faint, fontSize: 10 },
        scale: true,
        splitLine: { lineStyle: { color: c.line, opacity: 0.4 } },
        axisLabel: { color: c.faint, fontSize: 10, formatter: (v: number) => `${v.toFixed(0)}%` },
      },
      series: [
        {
          name: 'Calls',
          type: 'line',
          data: calls,
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: c.pos, width: 2.5 },
          itemStyle: { color: c.pos },
        },
        {
          name: 'Puts',
          type: 'line',
          data: puts,
          symbol: 'circle',
          symbolSize: 3,
          lineStyle: { color: c.neg, width: 1.5, type: 'dashed' },
          itemStyle: { color: c.neg },
        },
      ],
    };
  }, [data, xMode, colors]);

  return <EChart option={option} height={height} theme={theme} />;
}

/* ------------------------------------------------------------- term structure */

export function TermStructureChart({
  data,
  height = 200,
  theme,
}: {
  data: IvResponse['term_structure'];
  height?: number;
  theme: string;
}) {
  const colors = useMemo(() => themeColors(theme), [theme]);

  const option = useMemo(() => {
    const c = colors;
    return {
      animation: false,
      grid: { left: 46, right: 14, top: 16, bottom: 42 },
      tooltip: {
        ...baseTooltip(c),
        trigger: 'axis',
        formatter: (params: unknown) => {
          const arr = params as { dataIndex: number }[];
          const row = data[arr[0]?.dataIndex ?? 0];
          if (!row) return '';
          return `<b>${formatDateShort(row.expiration)}</b><br/>${row.dte < 1 ? '0DTE' : `${Math.round(row.dte)} DTE`}<br/>ATM IV: <b>${formatIv(row.atm_iv, 2)}</b>`;
        },
      },
      xAxis: {
        type: 'category',
        data: data.map((r) => formatDateShort(r.expiration)),
        axisLine: { lineStyle: { color: c.line } },
        axisTick: { show: false },
        axisLabel: { color: c.faint, fontSize: 9, rotate: 40, hideOverlap: true },
      },
      yAxis: {
        type: 'value',
        scale: true,
        splitLine: { lineStyle: { color: c.line, opacity: 0.4 } },
        axisLabel: { color: c.faint, fontSize: 10, formatter: (v: number) => `${(v * 100).toFixed(0)}%` },
      },
      series: [
        {
          type: 'line',
          data: data.map((r) => r.atm_iv),
          symbol: 'circle',
          symbolSize: 5,
          lineStyle: { color: c.accent, width: 2 },
          itemStyle: { color: c.accent },
          areaStyle: { color: c.accent, opacity: 0.1 },
        },
      ],
    };
  }, [data, colors]);

  return <EChart option={option} height={height} theme={theme} />;
}

/* ------------------------------------------------------------- intraday GEX */

export function IntradayGexChart({
  points,
  height = 260,
  theme,
}: {
  points: HistoryPoint[];
  height?: number;
  theme: string;
}) {
  const colors = useMemo(() => themeColors(theme), [theme]);

  const option = useMemo(() => {
    const c = colors;
    const times = points.map((p) => formatTime(p.captured_at));

    return {
      animation: false,
      grid: { left: 62, right: 62, top: 26, bottom: 34 },
      tooltip: { ...baseTooltip(c), trigger: 'axis' },
      legend: {
        top: 0,
        right: 6,
        itemWidth: 10,
        itemHeight: 8,
        textStyle: { color: c.muted, fontSize: 10 },
      },
      xAxis: {
        type: 'category',
        data: times,
        axisLine: { lineStyle: { color: c.line } },
        axisTick: { show: false },
        axisLabel: { color: c.faint, fontSize: 9, hideOverlap: true },
      },
      yAxis: [
        {
          type: 'value',
          name: 'Net GEX',
          nameTextStyle: { color: c.faint, fontSize: 9 },
          splitLine: { lineStyle: { color: c.line, opacity: 0.4 } },
          axisLabel: { color: c.faint, fontSize: 9, formatter: formatExposureAuto },
        },
        {
          type: 'value',
          name: 'Price',
          nameTextStyle: { color: c.faint, fontSize: 9 },
          scale: true,
          splitLine: { show: false },
          axisLabel: { color: c.faint, fontSize: 9, formatter: (v: number) => formatPrice(v, 0) },
        },
      ],
      series: [
        {
          name: 'Net GEX',
          type: 'line',
          data: points.map((p) => p.net_gex),
          symbol: 'none',
          lineStyle: { color: c.accent, width: 2 },
          areaStyle: { color: c.accent, opacity: 0.1 },
        },
        {
          name: '0DTE GEX',
          type: 'line',
          data: points.map((p) => p.dte0_net_gex),
          symbol: 'none',
          lineStyle: { color: c.warn, width: 1, type: 'dashed' },
        },
        {
          name: 'Spot',
          type: 'line',
          yAxisIndex: 1,
          data: points.map((p) => p.spot),
          symbol: 'none',
          lineStyle: { color: c.ink, width: 1 },
        },
        {
          name: 'Gamma Flip',
          type: 'line',
          yAxisIndex: 1,
          data: points.map((p) => p.gamma_flip),
          symbol: 'none',
          connectNulls: true,
          lineStyle: { color: c.warn, width: 1 },
        },
        {
          name: 'Call Wall',
          type: 'line',
          yAxisIndex: 1,
          data: points.map((p) => p.call_wall),
          symbol: 'none',
          connectNulls: true,
          lineStyle: { color: c.pos, width: 1, type: 'dotted' },
        },
        {
          name: 'Put Wall',
          type: 'line',
          yAxisIndex: 1,
          data: points.map((p) => p.put_wall),
          symbol: 'none',
          connectNulls: true,
          lineStyle: { color: c.neg, width: 1, type: 'dotted' },
        },
      ],
    };
  }, [points, colors]);

  return <EChart option={option} height={height} theme={theme} />;
}
