"use client";

import ReactECharts from "echarts-for-react";
import type { DashboardData } from "@/lib/types";

const axis = { axisLine: { lineStyle: { color: "#344054" } }, axisLabel: { color: "#8b98aa", fontSize: 10 }, splitLine: { lineStyle: { color: "rgba(128,145,165,.09)" } } };
const tooltip = { trigger: "axis" as const, backgroundColor: "#121923", borderColor: "#293445", textStyle: { color: "#dbe4ef", fontSize: 11 } };

export function GexChart({ data }: { data: DashboardData }) {
  const option = { animationDuration: 500, grid: { left: 62, right: 18, top: 30, bottom: 42 }, tooltip, legend: { data: ["Call GEX", "Put GEX", "Net GEX"], textStyle: { color: "#98a7ba" }, top: 0 }, xAxis: { ...axis, type: "category", data: data.byStrike.map(x => x.strike.toFixed(0)), name: "STRIKE", nameTextStyle: { color: "#64748b" } }, yAxis: { ...axis, type: "value", axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${v / 1e9}B` } }, series: [{ name: "Call GEX", type: "bar", stack: "gross", data: data.byStrike.map(x => x.callGex), itemStyle: { color: "#20c997" } }, { name: "Put GEX", type: "bar", stack: "gross", data: data.byStrike.map(x => x.putGex), itemStyle: { color: "#f04464" } }, { name: "Net GEX", type: "line", smooth: true, symbol: "none", data: data.byStrike.map(x => x.netGex), lineStyle: { width: 2, color: "#7c8cff" } }], visualMap: undefined };
  return <ReactECharts option={option} style={{ height: 330 }} notMerge />;
}

export function ProfileChart({ data }: { data: DashboardData }) {
  const markLine = [data.spot, data.gammaFlip, data.callWall, data.putWall].map((x, i) => ({ xAxis: x, name: ["Spot", "Flip", "Call wall", "Put wall"][i] }));
  const option = { grid: { left: 62, right: 20, top: 24, bottom: 42 }, tooltip, xAxis: { ...axis, type: "value", min: "dataMin", max: "dataMax", axisLabel: { ...axis.axisLabel, formatter: (v: number) => v.toFixed(0) } }, yAxis: { ...axis, type: "value", axisLabel: { ...axis.axisLabel, formatter: (v: number) => `${v / 1e9}B` } }, series: [{ type: "line", smooth: .25, showSymbol: false, data: data.profile.map(x => [x.price, x.netGex]), lineStyle: { width: 3, color: "#7c8cff" }, areaStyle: { color: "rgba(124,140,255,.10)" }, markLine: { symbol: "none", label: { color: "#aebbd0", formatter: "{b}" }, lineStyle: { type: "dashed", color: "#667085" }, data: markLine } }] };
  return <ReactECharts option={option} style={{ height: 300 }} notMerge />;
}

export function PriceChart({ data }: { data: DashboardData }) {
  const category = data.candles.map(c => new Date(c.time).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
  const levels = [{ name: "Gamma Flip", yAxis: data.gammaFlip }, { name: "Call Wall", yAxis: data.callWall }, { name: "Put Wall", yAxis: data.putWall }];
  const option = { grid: [{ left: 62, right: 50, top: 20, height: "65%" }, { left: 62, right: 50, top: "78%", height: "14%" }], tooltip, xAxis: [{ ...axis, type: "category", data: category, boundaryGap: true, axisLabel: { show: false } }, { ...axis, gridIndex: 1, type: "category", data: category, axisLabel: { ...axis.axisLabel, interval: 7 } }], yAxis: [{ ...axis, scale: true, position: "right" }, { ...axis, gridIndex: 1, axisLabel: { show: false } }], dataZoom: [{ type: "inside", xAxisIndex: [0, 1], start: 10, end: 100 }], series: [{ type: "candlestick", name: data.symbol, data: data.candles.map(c => [c.open, c.close, c.low, c.high]), itemStyle: { color: "#20c997", color0: "#f04464", borderColor: "#20c997", borderColor0: "#f04464" }, markLine: { symbol: "none", label: { color: "#b8c2d0", formatter: "{b}" }, lineStyle: { type: "dashed", width: 1 }, data: levels } }, { type: "line", name: "VWAP", symbol: "none", data: data.candles.map(c => c.vwap), lineStyle: { color: "#f5b942", width: 1.5 } }, { type: "bar", name: "Volume", xAxisIndex: 1, yAxisIndex: 1, data: data.candles.map(c => c.volume), itemStyle: { color: "rgba(124,140,255,.35)" } }] };
  return <ReactECharts option={option} style={{ height: 390 }} notMerge />;
}
