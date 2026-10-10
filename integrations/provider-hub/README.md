# BharatCode Provider Hub

English | [中文](README.zh.md)

English provider setup for the BharatCode Harness UI. The Providers settings section mounts the subscription fork's own `subscriptions` settings slot, so account login, quota refresh, device codes, errors, and account management use the real adapter implementation.

Install this local package and `@arzvaak/bharatcode-subscriptions` into the same web or desktop profile. The bundle self-activation patch mounts the host entry; `lib/client.js` registers a native Harness module-loader factory. Restart the profile after installing.

The BharatCode endpoint preset and custom OpenAI-compatible routes use the host's settings, credential store, model discovery, and LLM adapter. Keys are stored separately from profile configuration. Model discovery is catalog evidence; it does not prove that the provider will accept inference requests.

Build with `npm run build`. Run `npm test`, then `DSH_SOURCE=<built-host> npm run test:composition` for a local HTTP fixture through the real Loader, profile patch, credential store, discovery and streamed inference. Run `DSH_SOURCE=<built-host> SUBSCRIPTIONS_SOURCE=<subscriptions-fork> npm run test:compatibility` for all five providers' simulated login, connected status, quota refresh and error handling. These tests never sign in to real accounts.

Original MIT license retained in LICENSE.

Provider setup is optional during onboarding. BharatCode is the default endpoint/model preset; Codex and Google subscription buttons open their native subscription adapters, while OpenCode and Mistral use their own API-key presets. Users can continue without configuring a provider and return through Settings → Providers.

Muse subscription sessions use the official `@muse-code/sdk` MSP connection to an installed `muse serve` CLI. The host launches the CLI only after an explicit user action, restricts the workspace to a registered directory, and supports streamed items, approval decisions, user questions, follow-ups and cancellation. Muse manages its own subscription login; BharatCode does not import its credentials. This session currently runs in the Muse setup panel rather than the standard chat model picker. A real installed CLI has been checked with its offline echo provider; subscription inference still requires a user account.
