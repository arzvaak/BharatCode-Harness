# BharatCode Provider Hub

English provider setup for the BharatCode Harness UI. The Providers settings section mounts the subscription fork's own `subscriptions` settings slot, so account login, quota refresh, device codes, errors, and account management use the real adapter implementation.

Install this local package and `@arzvaak/bharatcode-subscriptions` into the same web or desktop profile. The bundle self-activation patch mounts the host entry; `lib/client.js` registers a native Harness module-loader factory. Restart the profile after installing.

The BharatCode endpoint preset and custom OpenAI-compatible routes use the host's settings, credential store, model discovery, and LLM adapter. Keys are stored separately from profile configuration. Model discovery is catalog evidence; it does not prove that the provider will accept inference requests.

Build with `npm run build`. Run `npm test`, then `DSH_SOURCE=<built-host> npm run test:composition` for a local HTTP fixture through the real Loader, profile patch, credential store, discovery and streamed inference. Run `DSH_SOURCE=<built-host> SUBSCRIPTIONS_SOURCE=<subscriptions-fork> npm run test:compatibility` for all five providers' simulated login, connected status, quota refresh and error handling. These tests never sign in to real accounts.

Original MIT license retained in LICENSE.
