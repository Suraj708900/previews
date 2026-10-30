# TradeLab AI 5.0 — English-only, operator-approved Spot Trading Prototype

This repository contains a **real exchange order path** (Binance Spot), plus a paper simulator, a Spot Testnet mode and a separate Live mode. **No account is connected, no real trades have been placed, and live execution is disabled by default.** It is an operator-controlled prototype, not a production-ready unattended AI trader or guaranteed-profit system.

## Features

- English-only premium responsive research dashboard with closed-candle candlestick chart, EMA overlay, and five-asset Opportunity Radar.
- Explainable signal scores, stale-feed / volatility / trend No-Trade gates, source and freshness monitor.
- Six deterministic review roles; optional OpenAI Responses API **explanations only** with a server-side LLM key, no tool access or trade authority.
- Public Binance visible-depth snapshot, fixed historical EMA20/50 backtesting (70/30 split), paper trading with virtual balances.
- Binance Spot **LIMIT GTC** signed order endpoint via HMAC, server-held API keys, whitelist, quote size and daily caps, fresh data gate, 90-second ticket expiry, exact approval phrase, one order per arming, per-session kill switch, persistent kill-lock, audit journal, order status query endpoint.

## Run locally — Paper Mode

Use Node.js 20 or newer. No external npm packages are needed.

```bash
cp .env.example .env
# Edit .env and replace OPERATOR_TOKEN with a unique random 32+ character secret.
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
node --env-file=.env server.js
```

Open **http://127.0.0.1:8787**, paste `OPERATOR_TOKEN` into the login screen (not Binance keys), scan markets and use paper trading. Do not run two instances sharing `.runtime`.

Run tests:

```bash
npm test
```

## Binance Spot Testnet

Set `TRADING_MODE=testnet` and set **Testnet-only** `BINANCE_API_KEY` / `BINANCE_API_SECRET` in `.env`. Use `ARM TESTNET` in the interface, generate a ticket and manually enter `EXECUTE <ID>`. Testnet balances are not real funds; the public market-data analysis still uses Binance public market data, so exchange/testnet price differences might reject orders. Never use production keys in testnet mode.

## Live execution — gated and disabled by default

Live order code **can submit a real exchange order**, but deployment requires security and operational review first. Only after carefully understanding risks and verifying local end-to-end Testnet behavior, configure the private server with `TRADING_MODE=live`, `LIVE_TRADING_ENABLED=true`, exchange Spot TRADE-only keys and a strong operator token. Use the distinct `ARM LIVE` phrase, then approve each 90-second order ticket with `EXECUTE <ID>` and the browser confirmation. Only 5 whitelisted USDT spot pairs are supported; no futures, leverage, withdrawals or transfer API paths.

**Always disable withdrawals on exchange API keys and, if supported, IP-whitelist the server. Never commit real `.env` to GitHub or put exchange secrets in frontend JavaScript.** Default per order $25, daily gross notional $50, 2 submissions/day, reference-only estimated price risk $0.75. The server rechecks price and signal before submitting. Limits are gross request caps, **not a guaranteed stop-loss / maximum drawdown guard**. Exchange and API failures can still cause losses.

### Important limitations (read before using real funds)

1. The stop-price field is only a **reference for position sizing**. The code does **not** place a stop-loss order at the exchange. LIMIT orders may remain open, partially fill or fill without further monitoring. This app cannot guarantee exiting a position or limiting realized losses.
2. A request timeout may mean an order was accepted; the server marks ticket used, records an audit event, and **never retries**. Check the actual exchange order status before another trade.
3. The emergency kill switch blocks **new orders from this service only**; it does **not** cancel outstanding Binance orders or liquidate positions. The kill state is persisted in `.runtime/state.json` and requires intentional local administrative intervention to reset after investigation.
4. No authentication beyond a local operator token, no TLS, no external penetration test, no exchange user-data stream or external order reconciliation, no reliable 24×7 hosting, no multi-user controls, no external stop monitoring. **This prototype must bind to loopback only. Do not expose it to the internet or host publicly without substantial security work.** Ordinary static shared hosting / GitHub Pages cannot execute signed private orders.
5. A deterministic rules engine is used for signal generation and vetoes; optional LLM explains signals but cannot access exchange tools or place orders. These are not proven profitable signals. AI confidence scores are NOT success probabilities.
6. Markets, Binance permissions, exchange endpoints and local regulations differ by jurisdiction. Confirm account access and applicable requirements before making live trades.

### Production readiness checklist

Operator authentication with MFA, secure HTTPS reverse proxy, hardened secret store, isolated private backend, rate limits, audit integrity, centralized monitoring/alerts, position reconciliation and fill tracking, protected stops/OCO as supported, recovery from restarts, exchange time synchronization, compliance and security review, supervised Testnet dry runs. **Do not switch on live mode simply because tests pass.**

## API surface

All APIs require `Authorization: Bearer OPERATOR_TOKEN` (in browser memory): `/api/status`, `/api/market`, `/api/radar`, `/api/depth`, `/api/backtest`, `/api/desk`, `/api/explain`, `/api/portfolio`, `/api/ticket` (POST), `/api/arm` (POST), `/api/execute` (POST), `/api/order-status`, `/api/kill` (POST), `/api/audit`. No unauthenticated order endpoint exists.

## Data and model references

- Spot API documentation: https://developers.binance.com/en/docs/products/spot/rest-api
- Binance Spot Testnet: https://developers.binance.com/en/docs/products/spot/testnet
- Responses API: https://platform.openai.com/docs/api-reference/responses

Free Plan: this prototype charges users nothing and has no billing integration.
