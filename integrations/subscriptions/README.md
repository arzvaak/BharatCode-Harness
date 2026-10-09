# BharatCode Subscriptions

Local English fork of `dsh-plugin-subscriptions` 0.9.7. Supports Codex (ChatGPT), Claude, Grok (X Premium), GitHub Copilot, and Google Antigravity through the original provider adapters. OAuth, device authorization, token refresh, account pools, model discovery and usage RPCs remain adapter-owned.

Install `@arzvaak/bharatcode-subscriptions` into the same profile as Provider Hub. Host route IDs remain `codex`, `claude`, `grok`, `copilot`, and `antigravity`; the UI slot remains `subscriptions`. The renamed browser loader factory matches this fork's package identity. English strings are registered under both existing locale IDs.

Provider Hub reuses this package's settings component and real `subscriptions-auth` RPC injection. Copilot device authorization shows the user code before opening the verification site. Each user's own provider authorization is required. Availability depends on their plan, provider account and current upstream service restrictions.

`npm run build` compiles host and native browser artifacts. `npm test` executes the simulated adapter, authorization, refresh, translation, routing, usage and client tests. Local validation uses isolated fixture homes and fake credentials; real account login and live provider inference are not verified.

This fork is packaged locally; nothing is published. The original MIT license is retained in LICENSE.
