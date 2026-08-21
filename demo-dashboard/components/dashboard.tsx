"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, BarChart3, Clock3, Moon, RefreshCw, Search, Sun, Wifi, X } from "lucide-react";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getDashboard, searchSymbols } from "@/lib/api";
import type { DashboardData, Freshness } from "@/lib/types";
import { GexChart, PriceChart, ProfileChart } from "./charts";

const money = (v: number, digits = 2) => `$${v.toLocaleString(undefined, { maximumFractionDigits: digits, minimumFractionDigits: digits })}`;
const exposure = (v: number) => `${v < 0 ? "-" : ""}$${Math.abs(v) >= 1e9 ? `${(Math.abs(v) / 1e9).toFixed(2)}B` : `${(Math.abs(v) / 1e6).toFixed(1)}M`}`;
const signed = (value: number) => `${value >= 0 ? "+" : ""}${money(value)}`;

function FreshnessBadge({ value }: { value: Freshness }) {
  const tone = value === "LIVE" ? "good" : value === "STALE" ? "bad" : value === "DEMO DATA" ? "demo" : "warn";
  return <span className={`fresh ${tone}`}><span />{value}</span>;
}

function Card({ label, value, sub, tone, help }: { label: string; value: string; sub?: string; tone?: "good" | "bad"; help?: string }) {
  return <div className="metric" title={help}><div className="metric-label">{label}</div><div className={`metric-value ${tone ?? ""}`}>{value}</div>{sub && <div className="metric-sub">{sub}</div>}</div>;
}

function Panel({ title, eyebrow, children, action }: { title: string; eyebrow?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return <section className="panel"><header><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div>{action}</header>{children}</section>;
}

function SearchBox({ current, onSelect }: { current: string; onSelect: (s: string) => void }) {
  const [value, setValue] = useState(current); const [open, setOpen] = useState(false);
  const query = useQuery({ queryKey: ["symbols", value], queryFn: ({ signal }) => searchSymbols(value, signal), enabled: value.length > 0 && open, staleTime: 300_000 });
  const submit = (e: FormEvent) => { e.preventDefault(); const next = value.trim().toUpperCase(); if (next) { onSelect(next); setOpen(false); } };
  return <div className="search-wrap"><form className="search" onSubmit={submit}><Search size={16}/><input aria-label="Search symbol" value={value} onChange={e => { setValue(e.target.value.toUpperCase().replace(/[^A-Z.]/g, "")); setOpen(true); }} onFocus={() => setOpen(true)} placeholder="Search symbol"/><kbd>↵</kbd></form>{open && query.data && query.data.length > 0 && <div className="search-menu">{query.data.map(s => <button key={s} onClick={() => { setValue(s); onSelect(s); setOpen(false); }}><BarChart3 size={14}/>{s}</button>)}</div>}</div>;
}

function DashboardView({ data, refreshing, retry }: { data: DashboardData; refreshing: boolean; retry: () => void }) {
  const delta = data.spot - data.previousClose, deltaPct = delta / data.previousClose * 100;
  const distance = (level: number) => `${signed(level - data.spot)} · ${((level / data.spot - 1) * 100).toFixed(2)}%`;
  return <>
    {data.isDemo && <div className="demo-banner"><AlertTriangle size={16}/><strong>DEMO DATA</strong><span>Local fixture for product evaluation — not live market data and not suitable for trading decisions.</span></div>}
    <main>
      <div className="summary-grid">
        <Card label="SPOT" value={money(data.spot)} sub={`${delta >= 0 ? "+" : ""}${delta.toFixed(2)} (${deltaPct.toFixed(2)}%)`} tone={delta >= 0 ? "good" : "bad"}/>
        <Card label="NET GEX" value={exposure(data.netGex)} sub={`Calls ${exposure(data.callGex)} · Puts ${exposure(data.putGex)}`} tone={data.netGex >= 0 ? "good" : "bad"} help="Model-derived signed gamma exposure estimate; not reported dealer inventory."/>
        <Card label="REGIME" value={data.regime.replace(" GAMMA", "")} sub={`${Math.abs((data.spot / data.gammaFlip - 1) * 100).toFixed(2)}% from flip`} tone={data.regime === "POSITIVE GAMMA" ? "good" : "bad"}/>
        <Card label="GAMMA FLIP" value={money(data.gammaFlip)} sub={distance(data.gammaFlip)} help="Interpolated price where modeled net GEX changes sign."/>
        <Card label="CALL WALL" value={money(data.callWall)} sub={distance(data.callWall)} help="Model-derived call gamma concentration level."/>
        <Card label="PUT WALL" value={money(data.putWall)} sub={distance(data.putWall)} help="Model-derived put gamma concentration level."/>
        <Card label="EXPECTED MOVE" value={`±${money(data.expectedMove)}`} sub={`${(data.expectedMove / data.spot * 100).toFixed(2)}% · ATM straddle`}/>
        <Card label="0DTE NET GEX" value={exposure(data.zeroDteGex)} sub={`P/C Vol ${data.putCallVolume.toFixed(2)}`} tone={data.zeroDteGex >= 0 ? "good" : "bad"}/>
      </div>
      <div className="primary-grid">
        <Panel title={`${data.symbol} Price & GEX Levels`} eyebrow="UNDERLYING · 5 MIN" action={<button className="icon-button" onClick={retry} aria-label="Refresh"><RefreshCw size={15} className={refreshing ? "spin" : ""}/></button>}><PriceChart data={data}/><div className="ohlc"><span>O <b>{money(data.dayOpen)}</b></span><span>H <b className="good">{money(data.dayHigh)}</b></span><span>L <b className="bad">{money(data.dayLow)}</b></span><span>VOL <b>{(data.dayVolume / 1e6).toFixed(1)}M</b></span></div></Panel>
        <Panel title="Session Intelligence" eyebrow="MODEL-DERIVED LEVELS"><div className="level-stack">
          {[{ n: "Call Wall", v: data.callWall, c: "good" }, { n: "Gamma Flip", v: data.gammaFlip, c: "accent" }, { n: "Put Wall", v: data.putWall, c: "bad" }].map(x => <div className="level" key={x.n}><i className={x.c}/><div><span>{x.n}</span><strong>{money(x.v)}</strong></div><small>{distance(x.v)}</small></div>)}
        </div><div className="facts"><div><span>ATM IV</span><b>{(data.atmIv * 100).toFixed(1)}%</b></div><div><span>PUT/CALL OI</span><b>{data.putCallOi.toFixed(2)}</b></div><div><span>DAY RANGE</span><b>{money(data.dayHigh - data.dayLow)}</b></div><div><span>EXP MOVE HIGH</span><b>{money(data.spot + data.expectedMove)}</b></div><div><span>EXP MOVE LOW</span><b>{money(data.spot - data.expectedMove)}</b></div><div><span>OI AS OF</span><b>PREV SESSION</b></div></div><div className="model-note"><AlertTriangle size={15}/><span>Signed GEX and walls are estimates using the latest available OI, not exchange-reported dealer positions.</span></div></Panel>
      </div>
      <div className="chart-grid">
        <Panel title="GEX by Strike" eyebrow="CALL · PUT · NET"><GexChart data={data}/></Panel>
        <Panel title="Gamma Exposure Profile" eyebrow="SPOT −10% TO +10%"><ProfileChart data={data}/></Panel>
      </div>
      <Panel title="0DTE Positioning" eyebrow="TODAY'S EXPIRATION" action={<FreshnessBadge value={data.freshness}/>}><div className="zero-grid"><Card label="CALL GEX" value={exposure(data.zeroDteCallGex)} tone="good"/><Card label="PUT GEX" value={exposure(data.zeroDtePutGex)} tone="bad"/><Card label="NET GEX" value={exposure(data.zeroDteGex)} tone={data.zeroDteGex >= 0 ? "good" : "bad"}/><Card label="CALL VOLUME" value={data.zeroDte.callVolume.toLocaleString()}/><Card label="PUT VOLUME" value={data.zeroDte.putVolume.toLocaleString()}/><Card label="P/C VOLUME" value={(data.zeroDte.putVolume / data.zeroDte.callVolume).toFixed(2)}/></div><div className="levels-table"><div className="table-head"><span>LEVEL</span><span>STRIKE</span><span>DISTANCE</span></div>{[["Largest Call Gamma", data.zeroDte.largestCallGamma], ["Largest Put Gamma", data.zeroDte.largestPutGamma], ["Largest Call OI", data.zeroDte.largestCallOi], ["Largest Put OI", data.zeroDte.largestPutOi]].map(([name, level]) => <div className="table-row" key={String(name)}><span>{name}</span><b>{money(Number(level))}</b><span>{distance(Number(level))}</span></div>)}</div></Panel>
    </main>
  </>;
}

export function Dashboard() {
  const [symbol, setSymbol] = useState("SPX"); const [dark, setDark] = useState(true);
  useEffect(() => { document.documentElement.dataset.theme = dark ? "dark" : "light"; }, [dark]);
  const query = useQuery({ queryKey: ["dashboard", symbol], queryFn: ({ signal }) => getDashboard(symbol, signal), refetchInterval: 60_000 });
  const updated = useMemo(() => query.data ? new Date(query.data.updatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—", [query.data]);
  return <div className="shell"><nav><div className="brand"><span className="brand-mark"><Activity size={20}/></span><div><strong>GEX</strong><small>POSITIONING INTELLIGENCE</small></div></div><SearchBox current={symbol} onSelect={setSymbol}/><div className="nav-meta">{query.data && <><div><span className="status-dot"/> {query.data.marketStatus}</div><div><Wifi size={14}/> {query.data.provider}</div><FreshnessBadge value={query.data.freshness}/><div><Clock3 size={14}/>{updated}</div></>}<button className="icon-button" onClick={() => setDark(v => !v)} aria-label="Toggle theme">{dark ? <Sun size={17}/> : <Moon size={17}/>}</button></div></nav>
    {query.isLoading && <div className="loading"><Activity size={28}/><strong>Loading {symbol} positioning</strong><span>Requesting normalized market analytics…</span></div>}
    {query.isError && <div className="error-state"><div><X size={24}/></div><h1>Provider unavailable</h1><p>{query.error instanceof Error ? query.error.message : "The market data service could not be reached."}</p><span>No demo data has been substituted.</span><button onClick={() => query.refetch()}><RefreshCw size={16}/>Retry request</button></div>}
    {query.data && <DashboardView data={query.data} refreshing={query.isFetching} retry={() => query.refetch()}/>}<footer><span>Observed: price, OI, volume, Greeks, IV</span><span>Model-derived: signed GEX, gamma flip, walls, regime</span><span>For informational use only</span></footer></div>;
}
