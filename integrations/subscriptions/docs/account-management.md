# Account and model management

Configure accounts under **Settings → Subscriptions → provider → Manage**. Changes remain local drafts until saved; Cancel does not update the configuration.

## What the settings mean

- **Alias**: For example, “Personal” or “Work.” Independent model entries show the alias, while their internal binding uses a stable account key; changing the alias does not change the binding.
- **Join automatic pool**: Allows this account to participate in automatic routing for regular chat-model entries. Enabled by default.
- **Pool model list**: Limits which models this account may serve in the pool. “Follow all models” includes newly discovered models; explicitly selecting all applies only to the current list; clearing the selection allows no models.
- **Independent model entry**: Adds a separate model-picker entry for the account. Disabled by default; when enabled, it binds directly to this account and does not switch with the pool.

## Work and personal account example

| Account | Alias | Join automatic pool | Independent model entry |
|---|---|---|---|
| Personal account | Personal | Enabled | Optional |
| Work account | Work | Disabled | Enabled |

Regular model entries use only accounts allowed to participate in the pool. After selecting an independent model entry with the “Work” alias, calls for that model use only the work account. If the account is deleted, its independent entry is disabled, its credentials expire, or its quota is exhausted, the request does not silently fall back to the personal account.

## Scope and limitations

These settings constrain the plugin’s **LLM chat-model routing**; they are not a session-wide privacy-isolation switch. Image generation, video generation, X search, and other tools retain their own account policies. Agents that explicitly select another model are not automatically bound to an account by these settings. Do not rely on this feature alone for strict work/personal data isolation.

The provider-level **Edit model list** continues to manage model visibility, context, and tool preferences; account management does not reset those settings. The default-account star and pool-participation switch are separate settings.

---

Open **Settings → Subscriptions → provider → Manage** to edit account aliases, automatic-pool participation, per-account pool model allowlists, and independent model entries.

Existing accounts default to participating in the pool, with independent entries disabled. An absent model allowlist follows all discovered models, including future additions; an empty allowlist permits none. Independent entries bind a stable account key, not its editable alias, and do not fall back to another account when unavailable.

These controls govern LLM model routing only. Image/video generation, X search, and agents explicitly selecting other models retain their own routing policies. This feature is not a session-wide privacy-isolation guarantee.
