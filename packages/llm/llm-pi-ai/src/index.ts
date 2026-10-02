/**
 * Generic pi-ai-backed LLM adapter plugin. One plugin instance owns a dict of
 * provider routes; a route naming an installed pi-ai provider inherits that
 * provider's endpoint, protocol, and model catalog as defaults, and a route
 * pi-ai does not ship is declared outright. Profile facts resolve per request
 * over the optional `llm-pi-ai` user-settings section and the optional
 * credential seam, so a changed key, endpoint, model, or knob reaches the next
 * request without a restart; a changed *route set* (or a route's
 * registration-captured retry policy) re-registers the same adapter instance
 * in place.
 *
 * ```yaml
 * - id: llm
 *   name: '@deepseek-ai/dsh-llm-pi-ai'
 *   config:
 *     providers:
 *       # Catalog route: everything but the credential comes from pi-ai.
 *       openai:
 *         apiKeyEnv: OPENAI_API_KEY
 *         retryPolicy:
 *           mode: normal
 *           maxRetries: 2
 *       # Catalog route with the catalog narrowed and one capacity corrected.
 *       anthropic:
 *         apiKeyEnv: ANTHROPIC_API_KEY
 *         models:
 *           - id: claude-sonnet-4-5
 *             contextWindow: 200000
 *       # Hand-declared route: pi-ai ships nothing under this key.
 *       acme-gateway:
 *         displayName: Acme Gateway
 *         apiKeyEnv: ACME_GATEWAY_API_KEY
 *         api: openai-completions
 *         baseURL: https://gateway.acme.example/v1
 *         # Reasoning dialect for a URL pi-ai cannot recognize.
 *         compat:
 *           thinkingFormat: deepseek
 *         models:
 *           - id: acme-large
 *             name: Acme Large
 *             contextWindow: 65536
 *             maxTokens: 4096
 *           - id: acme-think
 *             name: Acme Think
 *             contextWindow: 262144
 *             maxTokens: 32768
 *             # key = selectable level, value = wire spelling; only off may
 *             # leave the value empty (supported, send nothing).
 *             reasoningEfforts:
 *               off:
 *               high: high
 *               max: ultra
 * ```
 *
 * @module @deepseek-ai/dsh-llm-pi-ai
 */
import type {} from '@deepseek-ai/dsh-settings'

import type {} from '@deepseek-ai/cordis-plugin-loader'

import type { Context } from '@deepseek-ai/cordis'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { assertUsableApiKey, LlmError, resolveImageAttachmentAccess } from '@deepseek-ai/dsh-llm'
import type { AdapterRegistrationHandle, DirectoryRegistrationHandle, LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
import type {} from '@deepseek-ai/dsh-fs'
import { deepEqualJson } from '@deepseek-ai/dsh-util-values'
import { PiAiAdapter } from './adapter.ts'
import { authContextFrom, credentialStoreFrom } from './auth.ts'
import { catalogModels, catalogProviderIds, MODALITIES } from './catalog.ts'
import type { PiAiModality } from './catalog.ts'
import { assertServiceable, Config, resolveProfiles } from './config.ts'
import type { PiAiModelProfile, ResolvedPiAiProviderProfile } from './config.ts'
import { discoverModels } from './discovery.ts'
import type { StoredModelDiscoveryProfile } from './discovery.ts'
import { registerPiAiFlows } from './login.ts'

export { PiAiAdapter } from './adapter.ts'
export type { PiAiAdapterOptions } from './adapter.ts'
export { Config } from './config.ts'
export type {
  Options,
  PiAiCompatProfile,
  PiAiModality,
  PiAiModelOverride,
  PiAiModelProfile,
  PiAiProviderProfile,
  PiAiReasoningEfforts,
  PiAiThinkingFormat,
  ResolvedPiAiProviderProfile,
} from './config.ts'
export { recordKeyFor } from './auth.ts'
export { supportedProtocols } from './provider.ts'

export const name = 'llm-pi-ai'
export const inject = ['llm']

const NS = 'llm-pi-ai'

/**
 * The registry captures these per route; a change here must re-register.
 * Sorted by provider so a settings document that merely reorders its keys is
 * not mistaken for a route change.
 */
function registrationFacts(profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>): unknown {
  return [...profiles.entries()]
    // `displayName` rides along because the registry hands it to every selector
    // through `providerInfo()`: a rename that did not re-register would leave
    // the old label showing until some unrelated fact happened to change.
    .map(([provider, profile]) => ({
      provider,
      displayName: profile.displayName,
      retryPolicy: profile.retryPolicy,
    }))
    .sort((left, right) => left.provider.localeCompare(right.provider))
}

/**
 * The configurable-provider directory: every installed catalog route, plus
 * every route the current profiles declare. A hand-declared route has no
 * catalog entry, so without this union it would have no settings address and
 * configuration surfaces could neither show nor edit it.
 * @param profiles - the currently resolved provider profiles.
 * @returns the directory entries in catalog order, declared routes last.
 */
function directoryEntries(
  profiles: ReadonlyMap<string, ResolvedPiAiProviderProfile>,
  settingsNs: string,
): LlmConfigurableProvider[] {
  const catalog = new Set(catalogProviderIds())
  const entries = new Map<string, LlmConfigurableProvider>()
  const declare = (provider: string, displayName: string, error?: string): void => {
    entries.set(provider, {
      provider,
      displayName,
      settingsNs,
      settingsPath: ['providers', provider],
      // Membership of the installed catalog, not of the settings document:
      // narrowing a shipped provider's models stores a profile too, and that
      // route is still one pi-ai knows.
      declared: !catalog.has(provider),
      ...error === undefined ? {} : { error },
    })
  }
  for (const provider of catalog) declare(provider, provider)
  for (const [provider, profile] of profiles) declare(provider, profile.displayName, profile.catalogError)
  return [...entries.values()]
}

/** Register one generic pi-ai adapter for all configured provider routes. */
export function apply(ctx: Context, config: Config): void {
  /** Settings service captured when available; auto-import needs it to persist a listing. */
  let settingsService: { update(ns: string, patch: object): Promise<void> } | undefined
  ctx.inject(['settings'], (child) => {
    settingsService = child.settings
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
    // A route whose import pump ran before settings existed gets its second
    // attempt as soon as the service that can persist a listing lands.
    queueMicrotask(pumpPendingImports)
  })
  const settingsNs = ctx.fiber.entry?.options.id ?? NS
  let lastRaw: ReturnType<Config['providers']['get']> | undefined
  let memoized: ReadonlyMap<string, ResolvedPiAiProviderProfile> | undefined
  /**
   * The resolved profiles for the current configuration, memoized by the raw
   * snapshot's identity — which is also what makes the adapter's own snapshot
   * stable across operations that observe no change.
   *
   * Catalog diagnostics stay in the snapshot beside serviceable models, so
   * stored configuration remains visible after an installed catalog changes.
   * Scalar configuration errors still reject resolution.
   */
  const profiles = (): ReadonlyMap<string, ResolvedPiAiProviderProfile> => {
    const raw = config.providers.get()
    if (raw === lastRaw && memoized !== undefined) return memoized
    const next = resolveProfiles(structuredClone(raw) as import('./config.ts').Options['providers'], 'deferred')
    lastRaw = raw
    memoized = next
    return next
  }
  profiles()
  ctx.on('internal/config', function (this: import('@deepseek-ai/cordis').Fiber, _raw, next) {
    const raw: unknown = next()
    if (this !== ctx.fiber) return raw
    const candidate = Config(raw as import('./config.ts').Options)
    assertServiceable(
      { providers: structuredClone(candidate.providers.get()) } as import('./config.ts').Options,
      { providers: structuredClone(config.providers.get()) } as import('./config.ts').Options,
    )
    return raw
  })

  const resolveApiKey = async (
    provider: string,
    profile: ResolvedPiAiProviderProfile,
  ): Promise<string | undefined> => {
    const ref = profile.apiKeyEnv
    // Only a profile that names no credential at all defers to pi-ai's
    // provider-native discovery. Once one is named, a miss must fail loud:
    // handing pi-ai `undefined` would let it pick up an unrelated ambient key
    // (OPENAI_API_KEY and friends), billing another tenant for a request the
    // deployment meant to authenticate differently.
    if (ref === undefined) return undefined
    const credentials = ctx.get('credentials')
    const hit = credentials !== undefined
      ? (await credentials.resolve(ref))?.value
      // Without the seam the environment is the whole credential plane.
      : launchEnvironmentOf(ctx).get(ref)?.value
    if (hit !== undefined && hit.length > 0) return assertUsableApiKey(hit, 'llm-pi-ai', ref)
    throw new LlmError(
      `llm-pi-ai: no credential for provider route "${provider}"; its profile resolves ${ref}, which is not`
      + ` set — store ${ref} through the credentials service (the web Models page writes it) or export it,`
      + ' and remove apiKeyEnv only if this provider should authenticate from pi-ai\'s own environment discovery',
      'MISSING_CREDENTIAL',
    )
  }

  // One store and one ambient context for the whole plugin instance: both read
  // through `ctx` per call, so they stay correct across the collection rebuilds
  // a configuration change causes, and a sign-in survives one.
  const auth = { credentials: credentialStoreFrom(ctx), authContext: authContextFrom(ctx) }
  const adapter = new PiAiAdapter({
    profiles,
    resolveApiKey,
    auth,
    resolveAttachments: () => ctx.get('attachments'),
    resolveImageAccess: (attachments, ref) => resolveImageAttachmentAccess(
      attachments,
      hostPath => ctx.get('fs')?.processPathFromHostPath(hostPath),
      ref,
    ),
    onReplayDegrade: ({ provider, model, reason }) => {
      ctx.logger.warn(
        `llm-pi-ai: unusable replay state on assistant history for route "${provider}/${model}";`
        + ` sending that message as provider-neutral content (${reason})`,
      )
    },
  })
  // Independent of the route set: signing in is what makes a route worth
  // adding, so the flows are offered before any profile names their provider.
  // Scoped to the authorization seam rather than injected outright, because a
  // composition without it (headless, ACP) simply has no surface to sign in
  // from, while everything else this plugin does still works.
  ctx.inject(['authorization'], (authorized) => { registerPiAiFlows(authorized, auth) })
  // The full installed catalog is configurable from the moment the plugin
  // mounts — dormant or not — so configuration surfaces can offer every
  // pi-ai provider before any route exists. Hand-declared routes join it as
  // profiles appear, and leave with them.
  let directory: DirectoryRegistrationHandle | undefined
  let directoryFacts: unknown
  const ensureDirectory = (): void => {
    const entries = directoryEntries(profiles(), settingsNs)
    if (deepEqualJson(entries, directoryFacts)) return
    // Atomic replace, never dispose-then-register: a route another adapter
    // family already declares (a profile keyed `deepseek-official`) would
    // otherwise leave this plugin's whole directory withdrawn and the Models
    // page empty. The candidate set is validated first, so a collision keeps
    // the previous entries serving and only costs a diagnostic.
    if (directory === undefined) {
      directory = ctx.llm.registerConfigurableProviders(entries)
    } else {
      directory.replace(entries)
    }
    directoryFacts = entries
  }
  ensureDirectory()
  /** Host-owned request inputs for discovery of one configured route. */
  const storedDiscoveryProfile = (
    provider: string | undefined,
  ): StoredModelDiscoveryProfile | undefined => {
    if (provider === undefined) return undefined
    const profile = profiles().get(provider)
    if (profile === undefined) return undefined
    return {
      headers: profile.headers,
      resolveApiKey: () => resolveApiKey(provider, profile),
    }
  }
  // Interrogating an endpoint is a configuration-time action over a draft, so
  // it is offered for the whole namespace rather than per route: the provider
  // a surface is adding does not exist yet. The draft is the whole request
  // except the stored credential and deployment-owned headers: the curated UI
  // accepts neither, so an already-configured route supplies both inside the
  // Host rather than widening the discovery request.
  ctx.llm.registerModelDiscovery(settingsNs, (request, signal) => discoverModels(
    { ...request, ...signal === undefined ? {} : { signal } },
    () => storedDiscoveryProfile(request.provider),
  ))
  // Route effects bind to this apply fiber via the stable `ctx` reference,
  // even when a swap runs inside the scoped settings callback below. A bare
  // mount (zero routes) is the dormant posture: nothing registers until a
  // settings section supplies profiles, and routes drop when it empties.
  let registration: AdapterRegistrationHandle | undefined
  let registeredFacts: unknown
  const ensureRegistrationFacts = (): void => {
    const facts = registrationFacts(profiles())
    if (deepEqualJson(facts, registeredFacts)) return
    // The registry captures the route set and each route's retry policy at
    // registration, so a change to either must re-register. The swap is
    // atomic (same adapter instance, validated before anything moves): a
    // conflicting route leaves the previous routes serving requests, and
    // `registeredFacts` only advances once the registry actually holds the
    // new set — so returning to a working configuration always re-applies.
    const routes = [...profiles().keys()]
    if (registration === undefined) {
      // Dormant bare mount: nothing is registered until a section supplies
      // profiles, and an empty section keeps it that way.
      if (routes.length === 0) {
        registeredFacts = facts
        return
      }
      registration = ctx.llm.registerAdapter(routes, adapter)
    } else {
      registration.replace(routes)
    }
    registeredFacts = facts
  }
  ensureRegistrationFacts()

  ctx.on('loader/volatile-update', () => {
    try { ensureRegistrationFacts(); ensureDirectory() }
    catch (error) {
      ctx.logger.error('llm-pi-ai: configuration conflicts with an existing provider route')
      ctx.logger.error(error)
    }
    // A probe that lost the race with composition retries here; the
    // deep-equality guard below keeps a settled route from re-writing.
    pumpPendingImports()
  })

  // ---- endpoint-owned model lists (`autoImport`) ----
  // A route flagged `autoImport` has its model membership owned by its own
  // endpoint: when the route's credential appears (or, for a route that still
  // lists no models, once settings are mounted), `GET {baseURL}/models` is the
  // answer and its reply is stored into the profile configuration. Declared
  // capability fields the listing cannot speak — reasoning-effort maps and
  // compat switches — are carried over per id, so an import refreshes what the
  // endpoint changed without discarding what only the operator knows. A route
  // that already lists models and has no credential change is left alone: no
  // credential means no network, and a failed probe keeps the stored list.
  const importing = new Set<string>()
  /** Read the raw configured models of one route (pre-resolution configuration). */
  const configuredModels = (route: string): readonly PiAiModelProfile[] => {
    // The raw schema materializes readonly collections; the shape is otherwise
    // the same profile type, so this is a view over configuration, not a copy.
    const providers = config.providers.get() as unknown as
      Record<string, { models?: readonly PiAiModelProfile[] } | undefined>
    return providers[route]?.models ?? []
  }

  /**
   * Probe one `autoImport` route and persist the endpoint's listing. The
   * endpoint is the source of truth for model membership: a stored seed keeps
   * the route serviceable with no network and no key, a credential event
   * forces a re-sync from what the API advertises, and a boot retry only
   * probes a route that still lists nothing — so an unrelated settings write
   * never turns into network.
   * @param route - provider route key.
   * @param force - probe even though a model list is already stored.
   * @returns fulfillment after the probe settles; failures are logged, never thrown.
   */
  async function autoImportRoute(route: string, force: boolean): Promise<void> {
    const profile = profiles().get(route)
    if (profile?.autoImport !== true || profile.baseURL === undefined) return
    if (settingsService === undefined || importing.has(route)) return
    if (!force && configuredModels(route).length > 0) return
    // A route the installed catalog describes keeps its shipped entries: the
    // catalog carries capabilities no listing endpoint reports, and importing
    // over it would pin a snapshot of the catalog into user configuration.
    if (catalogModels(route).size > 0) return
    importing.add(route)
    try {
      const discovered = await discoverModels(
        {
          provider: route,
          baseURL: profile.baseURL,
          ...profile.api === undefined ? {} : { api: profile.api },
          // Bound so a hanging endpoint can neither stall a test process's
          // teardown nor keep a boot probe pending forever.
          signal: AbortSignal.timeout(15_000),
        },
        () => storedDiscoveryProfile(route),
      )
      if (discovered.length === 0) return
      const previous = new Map(configuredModels(route).map(model => [model.id, model]))
      const models: PiAiModelProfile[] = discovered.map((model) => {
        const declared = previous.get(model.id)
        const listed = model.inputModalities === undefined ? undefined
          : [...model.inputModalities].filter(modality => (MODALITIES as readonly string[]).includes(modality)) as PiAiModality[]
        // The listing is the answer for membership and disclosed capacities;
        // anything it cannot say (effort maps, compat switches) is kept from
        // the configuration that previously declared this id.
        const merged: PiAiModelProfile = { id: model.id }
        const name = model.name ?? declared?.name
        if (name !== undefined) merged.name = name
        const contextWindow = model.contextWindow ?? declared?.contextWindow
        if (contextWindow !== undefined) merged.contextWindow = contextWindow
        const maxTokens = model.maxTokens ?? declared?.maxTokens
        if (maxTokens !== undefined) merged.maxTokens = maxTokens
        const input = listed !== undefined && listed.length > 0 ? listed : declared?.input
        if (input !== undefined) merged.input = [...input]
        if (declared?.reasoningEfforts !== undefined) merged.reasoningEfforts = declared.reasoningEfforts
        if (declared?.compat !== undefined) merged.compat = declared.compat
        return merged
      })
      if (deepEqualJson(models, configuredModels(route))) return
      await settingsService.update(settingsNs, { providers: { [route]: { models } } })
      ctx.logger.info(`llm-pi-ai: imported ${String(models.length)} model(s) for route "${route}" from its endpoint`)
    } catch (error) {
      // No stored credential is the expected state before onboarding: stay
      // quiet and let the credential event below retry. Anything else is an
      // endpoint problem worth logging while the stored list keeps serving.
      if (error instanceof LlmError && error.code === 'MISSING_CREDENTIAL') return
      ctx.logger.warn(`llm-pi-ai: model import for route "${route}" failed; keeping the stored model list`)
      ctx.logger.warn(error)
    } finally {
      importing.delete(route)
    }
  }

  /** Probe flagged routes that still list nothing, once settings exist. */
  function pumpPendingImports(): void {
    if (settingsService === undefined) return
    for (const route of profiles().keys()) void autoImportRoute(route, false)
  }
  pumpPendingImports()
  // A credential write for a flagged route's reference re-runs its probe: this
  // is the onboarding path (the welcome flow stores the key) and the refresh
  // path (a rotated key re-confirms what the endpoint now serves). Forced, so
  // it runs even though a seed is stored — this is the endpoint test.
  ctx.on('credentials/reference-updated', (ref) => {
    for (const [route, profile] of profiles()) {
      if (profile.autoImport === true && profile.apiKeyEnv === ref) void autoImportRoute(route, true)
    }
  })
}
