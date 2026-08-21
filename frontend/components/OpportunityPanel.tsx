'use client';

import Link from 'next/link';

import { useApi } from '@/lib/hooks';
import { formatIv, formatNumber, formatPrice, formatTime } from '@/lib/format';
import type { DashboardSettings, OpportunityRecord, OpportunityResponse } from '@/lib/types';
import { EmptyBlock, ErrorBlock, FreshnessBadge, LoadingBlock, Panel } from './ui';

export function OpportunityPanel({
  symbol,
  settings,
}: {
  symbol: string;
  settings: DashboardSettings;
}) {
  const provider = settings.provider ? `?provider=${encodeURIComponent(settings.provider)}` : '';
  const query = useApi<OpportunityResponse>(`/api/opportunities/${symbol}${provider}`, {
    refreshInterval: Math.min(settings.refreshSeconds * 1000, 5_000),
    revalidateOnFocus: true,
  });
  const data = query.data;

  return (
    <Panel
      title="Continuous Opportunity Scanner"
      className="border-accent/30"
      right={
        <div className="flex items-center gap-1.5">
          <span className="chip border-pos/40 bg-pos/10 text-pos">● Scanning</span>
          {data?.demo ? <FreshnessBadge status="DEMO" /> : null}
        </div>
      }
    >
      {query.error ? <ErrorBlock error={query.error} onRetry={() => query.mutate()} /> : null}
      {!data && !query.error ? <LoadingBlock rows={3} label="Scanning normalized option chain" /> : null}
      {data && data.records.length === 0 ? (
        <EmptyBlock message="Scanner is active. No contract currently clears the 65/100 structure, liquidity and quote-quality threshold." />
      ) : null}
      {data?.records.length ? (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2 text-[10px] text-faint">
            <span>Last scan: <b className="tnum text-muted">{formatTime(data.last_scan_at, settings.timezone)}</b></span>
            <span>15-minute de-duplication · in-app log only · no order transmission</span>
          </div>
          <div className="grid gap-2 xl:grid-cols-2">
            {data.records.slice(0, 6).map((record) => (
              <CandidateCard key={record.id} record={record} />
            ))}
          </div>
        </div>
      ) : null}
      <p className="mt-3 border-t border-line pt-2 text-[10px] leading-relaxed text-faint">
        MODEL-DERIVED WATCH CANDIDATES — not investment advice. The scanner never places an order.
        It requires a coherent GEX snapshot, explicit gamma structure, quoted contracts, OI, volume,
        acceptable spread and a minimum score of 65/100.
      </p>
    </Panel>
  );
}

function CandidateCard({ record }: { record: OpportunityRecord }) {
  const directionTone = record.direction === 'call' ? 'text-exposurePos' : 'text-exposureNeg';
  return (
    <article className="rounded border border-line bg-raised/35 p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-1.5">
            <span className={`chip border-current/30 bg-bg ${directionTone}`}>
              {record.direction === 'call' ? '▲ CALL' : '▼ PUT'} candidate
            </span>
            <span className="chip border-warn/30 bg-warn/5 text-warn">Score {record.score}/100</span>
          </div>
          <div className="mt-2 tnum text-sm font-bold text-ink">{record.option_symbol}</div>
          <div className="mt-0.5 text-[10px] text-faint">
            {record.expiration} · {record.dte.toFixed(1)} DTE · Strike {formatPrice(record.strike)}
          </div>
        </div>
        <Link
          href={`/exposure?symbol=${encodeURIComponent(record.symbol)}&expiry=single&expirations=${record.expiration}&range=3&metric=all`}
          className="btn"
        >
          Inspect ladder
        </Link>
      </div>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-xs">
        <CandidateMetric label="Bid / Ask" value={`${formatPrice(record.bid)} / ${formatPrice(record.ask)}`} />
        <CandidateMetric label="OI / Volume" value={`${formatNumber(record.open_interest)} / ${formatNumber(record.volume)}`} />
        <CandidateMetric label="IV / Delta" value={`${formatIv(record.iv)} / ${record.delta?.toFixed(3) ?? '--'}`} />
      </dl>

      <ul className="mt-3 space-y-1 text-[11px] leading-relaxed text-muted">
        {record.reasons.map((reason) => <li key={reason}>• {reason}</li>)}
      </ul>
      <div className="mt-2 rounded border border-line bg-bg/60 p-2 text-[10px] leading-relaxed">
        <p><b className="text-accent">Trigger:</b> <span className="text-muted">{record.trigger}</span></p>
        <p className="mt-1"><b className="text-warn">Invalidation:</b> <span className="text-muted">{record.invalidation}</span></p>
      </div>
      <div className="mt-2 flex flex-wrap gap-1 text-[9px] text-faint">
        {Object.entries(record.score_components).map(([key, value]) => (
          <span key={key} className="rounded bg-bg px-1.5 py-0.5">{key.replaceAll('_', ' ')} +{value}</span>
        ))}
      </div>
    </article>
  );
}

function CandidateMetric({ label, value }: { label: string; value: string }) {
  return <div><dt className="stat-label">{label}</dt><dd className="tnum mt-0.5 font-semibold text-ink">{value}</dd></div>;
}

