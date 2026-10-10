# BharatCode Subscriptions

English | [中文](README.zh.md)

Local English fork of `dsh-plugin-subscriptions` 0.9.7. Supports Codex (ChatGPT), Claude, Grok (X Premium), GitHub Copilot, and Google Antigravity through the original provider adapters. OAuth, device authorization, token refresh, account pools, model discovery and usage RPCs remain adapter-owned.

Install `@arzvaak/bharatcode-subscriptions` into the same profile as Provider Hub. Host route IDs remain `codex`, `claude`, `grok`, `copilot`, and `antigravity`; the UI slot remains `subscriptions`. The renamed browser loader factory matches this fork's package identity. English strings are registered under both existing locale IDs.

Provider Hub reuses this package's settings component and real `subscriptions-auth` RPC injection. Copilot device authorization shows the user code before opening the verification site. Each user's own provider authorization is required. Availability depends on their plan, provider account and current upstream service restrictions.

`npm run build` compiles host and native browser artifacts. `npm test` executes the simulated adapter, authorization, refresh, translation, routing, usage and client tests. Local validation uses isolated fixture homes and fake credentials; real account login and live provider inference are not verified.

This fork is packaged locally; nothing is published. The original MIT license is retained in LICENSE.

Subscription grants now use the host native credential service (`dsh-plugin-subscriptions/accounts`, schema version 1). All five provider routes and the account settings page use the same serialized record. On the first account operation, an absent native record imports the existing subscriptions auth file, or its older router location, once. Legacy files remain unchanged as recoverable backups; they no longer receive runtime token writes. An empty native record records logout and prevents legacy accounts from reappearing. Unsupported native schemas and credential service failures are reported without falling back to a file. Standalone explicit-file helpers remain available for maintenance tooling.
