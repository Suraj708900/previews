# AIUseFlow TradeLab 4.0 — free research dashboard

TradeLab 4.0 combines the prior v2 Order Block/FVG/BOS/CHoCH chart with the requested v3.0, v3.5 and v4.0 research tools. **No real orders, no account, no payment, no secret API keys.** The free experience is never automatically charged.

## Start in one minute

- Open `index.html` on any modern browser or serve this folder using `python -m http.server 8000` and visit `http://localhost:8000`.
- For a one-file trial, open **`aiuseflow-tradelab-v4-standalone.html`** supplied separately (or GitHub branch root `index.html`, which is the bundled standalone build).
- To publish on Hostinger, put the project folder files in **a separate TEST subdomain**, not the existing production site's `public_html`.
- The project is static HTML/CSS/JavaScript; no `npm install`, backend, login, subscription, order execution, or Google/AI keys required.

## Actual behavior by phase

| Phase | Feature | Working behavior / limit |
| --- | --- | --- |
| 3.0 | Opportunity Radar | Uses 5 assets × 4 timeframe scanner, sorts confluence by score deviation, labels EACH source LIVE/SAMPLE. Button runs the existing spot scan. Score is not trade probability. |
| 3.0 | No-Trade AI | Transparent rules block sample, stale, invalid, ambiguous and high-volatility setups; otherwise WATCHLIST ONLY. Not an LLM or a financial adviser. |
| 3.0 | Explainable Signals | Reuses v2 EMA, swing, FVG and momentum point contributions and explains every score. |
| 3.0 | Data Health | Shows source, freshness, candle count, last-candle time and missing/stale/synthetic status. |
| 3.5 | Liquidity | Reads public Binance SPOT `/api/v3/depth` top 20 visible levels per side, imbalance/spread/largest displayed wall; manual snapshots, **not streaming**. |
| 3.5 | Funding & Open Interest | Requests public Binance USDⓈ-M `/fapi/v1/premiumIndex` and `/fapi/v1/openInterest`. Failures shown as unavailable; region/network restrictions apply. |
| 3.5 | Smart Alerts | User-defined above/below crossing alerts stored locally, checked on fresh successful chart updates with a best-effort foreground refresh each 60 seconds. **NOT background or push notifications.** |
| 3.5 | Hindi Copilot | Handles trend, risk, FVG and explanation questions; Hindi voice uses browser speech synthesis if supported. **Rule-based, not connected to LLM.** |
| 4.0 | Strategy Backtesting | Fetches up to 800 public historical candles, excludes still-open candle, tests fixed EMA20/50 long-only crossovers at next-candle open, fees + slippage, 70/30 split. No optimization or guaranteed edge. |
| 4.0 | Paper Trading | Virtual $10k spot account, manual buy/close, fee and slippage assumptions, local positions and fills; can practice on clearly labeled SAMPLE data; no exchange orders. |
| 4.0 | Mistake Coach | Rule-based review of local paper fills and journal, flags overtrading/missing notes/loss frequency, without unsupported claims. |
| 4.0 | Six-Role Research Desk | Generates six transparent, **sequential rule-based reports**: Desk Lead, Market Research, Strategy, Risk, Execution (NO orders), Compliance & Journal. NOT six autonomous AI agents. |

## Market data and safety

- Binance market-data-only spot endpoint: `https://data-api.binance.vision/api/v3/klines`, `/ticker/24hr`, `/depth`. Official docs: https://github.com/binance/binance-spot-api-docs/blob/master/faqs/market_data_only.md
- Public derivatives endpoint: `https://fapi.binance.com/fapi/v1/premiumIndex`, `/fapi/v1/openInterest`. Official docs: https://developers.binance.com/en/docs/derivatives/usds-margined-futures/market-data/rest-api/Mark-Price and https://developers.binance.com/en/docs/derivatives/usds-margined-futures/market-data/rest-api/Open-Interest
- Public snapshots require internet and may be restricted, rate limited or blocked by CORS/location. When live data is inaccessible, the chart clearly switches to synthetic SAMPLE; liquidity and derivatives **do not fabricate** replacement figures. Latest candle may still be forming.
- Paper fills at last displayed price are illustrations. Network timing, gaps, fees, depth and actual execution can be very different. Results are not forecasts.
- No paid features or billing installed. Local browser storage is not cross-device, authenticated or encrypted; do not enter secrets. Clearing site data deletes your journal and simulated trades.
- Do not claim regulation approval, investment advice, guaranteed returns, true institutional-trade identification or 'live 24×7' alerts. Check data redistribution rights and applicable financial regulations before public launch.

## Testing

```sh
node --check app.js
node --check intelligence.js
node --check engine-v4.js
node --check v4.js
node test-algorithms.cjs
node test-v4.cjs
```

Algorithm tests currently pass. The browser DOM was smoke tested in a restricted test environment using demo fallback; real Binance connectivity and end-to-end production deployment have **not** been certified. The static site includes no remote system of your own. Before public launch add a server-side proxy, caching, auth (if storing across devices), audit logs, testing, privacy terms, and genuine opt-in server-side notifications. For a real Hindi LLM copilot or autonomous agents, deploy secure model API routes on the backend (never put API keys in browser code).

## GitHub layout

- Branch root `aiuseflow-tradelab-4/index.html`: full **single-file** standalone demo, everything embedded.
- `aiuseflow-tradelab-4/source/`: maintainable original files and automated Node tests.
- Existing `aiuseflow.com` and existing repositories/branches are unaffected by these files.
