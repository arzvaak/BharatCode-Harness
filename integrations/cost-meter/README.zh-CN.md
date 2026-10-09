# BharatCode Cost Meter

English fork of Cost Meter 1.8.12 for the BharatCode Harness UI. Conversation, turn and daily usage remain in the original ledger and session projection. The browser entry and statistics chunk register the fork's native Harness loader identity.

API cost estimates require an exact provider route and model price. Known direct API routes are `openai`, `anthropic`, and `deepseek`. Custom gateways, BharatCode routes, local servers, missing provider identity and unknown model IDs remain unpriced until the user configures the actual route tariff. A model's vendor name does not establish a gateway's price. Configure exact rates under `prices.providers.<route>.models.<model>` or an explicit `priceOverrides` mapping after confirming the route's tariff.

Codex, Claude, Grok, Copilot and Antigravity subscription usage is classified as plan usage. Their token usage never acquires an API monetary charge from the direct API rate table. Subscription quota status comes from provider adapters and is separate from estimated API spend. A zero monetary ledger value for an unpriced route means that its cost is unknown; turn details show unpriced usage explicitly.

The default sidebar shows token usage, with USD for explicitly priced estimates. Official-provider balance cards, unrelated coding plans and first-run tours are off. Global pricing-time strips and alerts are omitted because the sidebar does not establish the active provider route. Explicit saved currency choices remain respected.

Default direct-provider rate sources were checked October 8, 2026. See [pricing scope](docs/bharatcode-pricing.md). Estimates exclude tools, unreported usage, modality-specific prices, negotiated discounts, taxes and processing-tier or regional surcharges. Configure your actual price when it differs. DeepSeek Pro retains its own tariff; the upstream fork's erroneous Pro-to-Flash assumption is removed.

Build with `npm run build`. Run `node --test test/bharatcode-pricing.test.mjs test/bharatcode-native.test.mjs` for exact-route pricing, subscription separation, cache and long-context billing, unpriced custom routes, configurable tariffs, native loader behavior and persisted ledger checks. Original upstream tests remain available under `test/`; some assert upstream multilingual and fuzzy-pricing behavior intentionally changed in this fork.

Original MIT license retained in LICENSE. This package is a local review artifact and has not been published.
