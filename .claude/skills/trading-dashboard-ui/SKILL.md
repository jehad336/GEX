---
name: trading-dashboard-ui
description: Build or modify dashboard panels and charts in the Next.js frontend — ECharts and lightweight-charts wiring, level overlays, heatmaps, trading tables, theming, and number formatting. Use when adding a panel, changing a chart, or fixing a rendering or theme issue.
---

# Trading Dashboard UI

## Purpose

Present dense options data so a trader can read it at a glance, in dark and light themes, with
every number's provenance visible.

## When to use

- Adding a panel or a chart
- A chart renders blank, wrong-coloured, or stale after a symbol or theme change
- Adding a filter, an export, or a tooltip

## Inputs

- `frontend/components/ui.tsx` — `Panel`, `Stat`, `Info`, `FreshnessBadge`, `ErrorBlock`,
  `LoadingBlock`, `EmptyBlock`, `SegmentedControl`
- `frontend/components/charts/EChart.tsx` — the ECharts wrapper, `themeColors()`, `withAlpha()`
- `frontend/lib/format.ts` — every number that reaches the screen goes through this
- `frontend/lib/glossary.ts` — hover explanations
- `frontend/lib/hooks.ts` — `usePanel`, `useApi`, `useSymbolStream`

## Workflow

1. **Add the type to `lib/types.ts` first**, mirroring the backend response. No `any`;
   `tsconfig` runs strict with `noUncheckedIndexedAccess`.

2. **Fetch with `usePanel`**, which keys the request to the shared chain filters so every panel
   calculates over the same contracts. Never construct a URL by hand.

3. **Handle all four states.** Loading → `LoadingBlock`. Error → `ErrorBlock` (which shows the
   provider message and states that no substitute data is shown). Empty → `EmptyBlock` with a
   reason. Data → the panel. Skipping the error state is the most common defect here.

4. **Charts:**
   - Read colours from `themeColors()` — it reads live CSS custom properties, so charts follow
     the theme exactly. Never hard-code a hex.
   - For alpha use `withAlpha(color, 0.28)`. These are `rgb(...)` tokens; appending a hex
     suffix produces an invalid colour and throws.
   - Pass `theme` to `<EChart>`; it forces a full re-init so every baked-in colour refreshes.
   - `setOption` runs with `notMerge: true` — stale series from a previous symbol must not linger.
   - For lightweight-charts, every effect that touches the chart must depend on `theme`,
     because a theme change disposes and rebuilds it. Guard cleanups with a `disposedRef`.

5. **Numbers:** `formatExposure` for exposure with the user's unit setting, `formatExposureAuto`
   for axis ticks, `formatIv` (decimal → vol points), `formatPrice`, `formatPct`. Add `tnum`
   for tabular alignment. Put the exact value in a `title` attribute when abbreviating.

6. **Levels always carry distance.** Use `LevelReadout`, which renders price, dollar distance
   and percent distance together.

7. **Provenance is not optional.** Add an `Info term="..."` next to any derived metric, and a
   `FreshnessBadge` wherever data age matters. Add the term to `glossary.ts` with its
   `origin` set correctly.

8. **Guard against cross-symbol data.** When a symbol changes, verify `data.symbol === symbol`
   before rendering. SWR is configured with `keepPreviousData: false` for this reason — showing
   one instrument's exposure under another's name is the worst failure this UI can have.

## Expected outputs

- A `Panel` handling loading, error, empty and data states
- Theme-correct charts in both palettes
- Tooltips distinguishing observed from model-derived values

## Validation

```bash
cd frontend
npm run type-check && npm run lint && npm run build
```

Then load the dashboard and check: both themes, a symbol switch (numbers and header must agree),
a provider error (stop the backend — panels must show the error, not stale values), and 1920×1080
plus 1440×900.

## Failure handling

- Blank chart after a theme toggle → an effect is missing `theme` in its dependency list
- "Cannot parse color" → hex alpha appended to an `rgb()` token; use `withAlpha`
- "Object is disposed" → a cleanup touching a chart already removed; guard with `disposedRef`
- Wrong symbol's numbers → a missing `data.symbol === symbol` guard
