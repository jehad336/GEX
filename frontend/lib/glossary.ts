/**
 * Term explanations shown on hover.
 *
 * Each entry states plainly whether the number is observed market data or a
 * model estimate, because that distinction is the easiest one to lose in a
 * dashboard and the most expensive one to get wrong.
 */

export interface GlossaryEntry {
  title: string;
  body: string;
  origin: 'observed' | 'model_derived';
}

export const GLOSSARY: Record<string, GlossaryEntry> = {
  gex: {
    title: 'GEX — Gamma Exposure',
    body:
      'Gamma × Open Interest × contract multiplier × spot² × 0.01, summed across the chain. ' +
      'Read as the dollar amount of hedging flow implied per 1% move in the underlying. ' +
      'The sign depends on an assumed dealer positioning convention, so this is an estimate of ' +
      'dealer gamma, not a published figure.',
    origin: 'model_derived',
  },
  net_gex: {
    title: 'Net GEX',
    body:
      'Call GEX plus Put GEX under the active sign convention. Positive suggests dealers hedge ' +
      'against the move (dampening volatility); negative suggests they hedge with it (amplifying).',
    origin: 'model_derived',
  },
  gamma_flip: {
    title: 'Gamma Flip / Zero Gamma',
    body:
      'The hypothetical spot price where the modelled net gamma profile crosses zero. Found by ' +
      'repricing every contract with Black-Scholes across a band of prices and interpolating ' +
      'between the two samples that straddle the crossing.',
    origin: 'model_derived',
  },
  call_wall: {
    title: 'Call Wall',
    body:
      'The strike above spot with the strongest call gamma concentration. Scored as ' +
      '0.55×gamma + 0.25×open interest, weighted by distance from spot and boosted by same-day ' +
      'gamma. Often behaves as resistance, but it is a heuristic, not a rule.',
    origin: 'model_derived',
  },
  put_wall: {
    title: 'Put Wall',
    body:
      'The mirror of the call wall: the strike below spot with the strongest put gamma ' +
      'concentration. Often behaves as support.',
    origin: 'model_derived',
  },
  dex: {
    title: 'DEX — Delta Exposure',
    body:
      'Delta × Open Interest × multiplier × spot. Approximates the directional share exposure ' +
      'implied by the open option book under the active sign convention.',
    origin: 'model_derived',
  },
  vanna: {
    title: 'Vanna Exposure',
    body:
      'Vanna is dDelta/dVol. Vanna exposure estimates how much delta hedging demand shifts per ' +
      'one volatility point of IV change — the mechanism behind vol-driven price drift.',
    origin: 'model_derived',
  },
  charm: {
    title: 'Charm Exposure',
    body:
      'Charm is dDelta/dTime. Charm exposure estimates the hedging flow generated purely by the ' +
      'passage of one calendar day, holding spot and vol fixed.',
    origin: 'model_derived',
  },
  vgex: {
    title: 'VGEX Proxy',
    body:
      'The GEX formula computed on traded volume instead of open interest. It measures today’s ' +
      'gamma activity, NOT dealer inventory. Kept separate from GEX for that reason.',
    origin: 'model_derived',
  },
  open_interest: {
    title: 'Open Interest',
    body:
      'The number of contracts outstanding, reported by the exchange once per session. It is not ' +
      'tick-by-tick, so intraday GEX uses the most recent published figure.',
    origin: 'observed',
  },
  volume: {
    title: 'Volume',
    body: 'Contracts traded in the current session. Exchange reported.',
    origin: 'observed',
  },
  iv: {
    title: 'Implied Volatility',
    body:
      'The volatility implied by the option price. Vendor-supplied where available, otherwise ' +
      'solved from the mid price with Black-Scholes.',
    origin: 'observed',
  },
  expected_move: {
    title: 'Expected Move',
    body:
      'The ATM straddle price: the call plus the put at the strike nearest spot with both legs ' +
      'quoted. A rough one-standard-deviation range priced by the market for that expiry.',
    origin: 'observed',
  },
  pin_risk: {
    title: 'Pin Risk',
    body:
      'A heuristic score combining proximity to a dominant gamma strike, how dominant that strike ' +
      'is, time remaining, and same-day gamma share. It is not a probability and not a forecast.',
    origin: 'model_derived',
  },
  regime: {
    title: 'Gamma Regime',
    body:
      'A transparent rule-based label derived from net GEX and the distance to the gamma flip. ' +
      'No machine learning is involved — the inputs are listed in the explanation.',
    origin: 'model_derived',
  },
  put_call_ratio: {
    title: 'Put/Call Ratio',
    body:
      'Put volume divided by call volume (or the same for open interest). High readings are often ' +
      'read as hedging demand, but a put can be a hedge on a long book rather than a bearish bet.',
    origin: 'observed',
  },
  skew: {
    title: 'Volatility Skew',
    body:
      'IV plotted against strike or delta. Downside strikes usually trade at higher IV than ' +
      'upside ones in index options, because of persistent hedging demand.',
    origin: 'observed',
  },
  risk_reversal: {
    title: '25-Delta Risk Reversal',
    body:
      'The 25-delta call IV minus the 25-delta put IV. Negative values mean puts are bid over ' +
      'calls, the normal state for index options.',
    origin: 'observed',
  },
  term_structure: {
    title: 'IV Term Structure',
    body:
      'ATM implied volatility by expiry. An upward slope is typical; inversion usually signals ' +
      'near-term event risk.',
    origin: 'observed',
  },
  concentration: {
    title: 'Gamma Concentration',
    body:
      'The share of total absolute gamma sitting within a given percentage band of spot. High ' +
      'near-spot concentration means small moves change hedging demand quickly.',
    origin: 'model_derived',
  },
  aggressor: {
    title: 'Trade Aggressor',
    body:
      'Where the print landed relative to the prevailing bid and ask. It does NOT identify ' +
      'opening versus closing trades, and a call is not automatically bullish.',
    origin: 'observed',
  },
  volume_oi: {
    title: 'Volume / OI Ratio',
    body:
      'Session volume divided by open interest. A ratio above 1 means more contracts traded today ' +
      'than were outstanding — often new positioning, though it cannot be confirmed from OI alone.',
    origin: 'observed',
  },
};
