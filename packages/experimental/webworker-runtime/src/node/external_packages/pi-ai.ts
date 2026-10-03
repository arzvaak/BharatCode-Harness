/**
 * `@earendil-works/pi-ai` stub, including its `/providers/all` and `/api/*.lazy`
 * subpaths. The package is Node-only (no `require`/`browser` conditions, Node
 * builtins plus five cloud SDKs in its transport layer) and `llm-pi-ai` imports it
 * statically at module scope, so the row cannot mount without it.
 *
 * Imported symbols are present so configured routes can activate. The builtin
 * catalog exposes provider ids without models; configured providers own an
 * in-memory model registry. Protocol bindings refuse when requests are streamed.
 */
import { notImplementedFail } from '../notImplementedFail.ts'

const MODULE = '@earendil-works/pi-ai'

interface WorkerProvider {
  id: string
  models?: readonly WorkerModel[]
  getModels?: () => readonly WorkerModel[]
  stream?: (...args: unknown[]) => unknown
  streamSimple?: (...args: unknown[]) => unknown
}

interface WorkerModel {
  id: string
  provider?: string
}

/**
 * Provider factory used by configured routes; protocol bindings own request refusal.
 * @param input - Provider identity, configured models, and protocol binding.
 * @returns the provider registry entry.
 */
export function createProvider(input: {
  id: string
  models: readonly WorkerModel[]
  api: { stream: (...args: unknown[]) => unknown; streamSimple: (...args: unknown[]) => unknown }
}): WorkerProvider {
  return {
    id: input.id,
    getModels: () => input.models,
    stream: (...args) => input.api.stream(...args),
    streamSimple: (...args) => input.api.streamSimple(...args),
  }
}

/**
 * Create the small Models surface consumed by llm-pi-ai without importing the
 * package's aggregate catalog and its Node-only provider bindings.
 * @returns an isolated registry of configured providers and models.
 */
export function createModels(): {
  setProvider(provider: WorkerProvider): void
  deleteProvider(id: string): void
  clearProviders(): void
  getProviders(): WorkerProvider[]
  getProvider(id: string): WorkerProvider | undefined
  getModels(provider?: string): readonly WorkerModel[]
  getModel(provider: string, id: string): WorkerModel | undefined
  stream(model: WorkerModel, ...args: unknown[]): unknown
  streamSimple(model: WorkerModel, ...args: unknown[]): unknown
} {
  const providers = new Map<string, WorkerProvider>()
  const requireProvider = (model: WorkerModel): WorkerProvider => {
    const provider = model.provider === undefined ? undefined : providers.get(model.provider)
    if (provider === undefined) throw new Error(`pi-ai worker has no provider for model "${model.id}"`)
    return provider
  }
  return {
    setProvider(provider): void { providers.set(provider.id, provider) },
    deleteProvider(id): void { providers.delete(id) },
    clearProviders(): void { providers.clear() },
    getProviders: () => [...providers.values()],
    getProvider: id => providers.get(id),
    getModels: id => id === undefined
      ? [...providers.values()].flatMap(provider => provider.getModels?.() ?? provider.models ?? [])
      : (providers.get(id)?.getModels?.() ?? providers.get(id)?.models ?? []),
    getModel: (provider, id) => {
      const model = (providers.get(provider)?.getModels?.() ?? providers.get(provider)?.models ?? [])
        .find(candidate => candidate.id === id)
      return model === undefined ? undefined : { ...model, provider }
    },
    stream: (model, ...args) => requireProvider(model).stream?.(model, ...args)
      ?? notImplementedFail(MODULE, 'Models.stream')(),
    streamSimple: (model, ...args) => requireProvider(model).streamSimple?.(model, ...args)
      ?? notImplementedFail(MODULE, 'Models.streamSimple')(),
  }
}

/**
 * Worker-safe replacement for `/providers/all` builtinModels().
 * @param _options - Catalog options, unused because the worker has no builtin models.
 * @returns an empty provider registry.
 */
export function builtinModels(_options?: unknown): ReturnType<typeof createModels> {
  return createModels()
}

/** Thinking-level catalog (unavailable). */
export const getSupportedThinkingLevels = notImplementedFail(MODULE, 'getSupportedThinkingLevels')

/** Context-overflow predicate (unavailable). */
export const isContextOverflow = notImplementedFail(MODULE, 'isContextOverflow')

/** Builtin provider ids of pi-ai 0.84.2, in catalog order. */
const BUILTIN_PROVIDER_IDS: readonly string[] = [
  'amazon-bedrock', 'ant-ling', 'anthropic', 'azure-openai-responses', 'baseten', 'cerebras',
  'cloudflare-ai-gateway', 'cloudflare-workers-ai', 'deepseek', 'fireworks', 'github-copilot',
  'google', 'google-vertex', 'groq', 'huggingface', 'kimi-coding', 'minimax', 'minimax-cn',
  'mistral', 'moonshotai', 'moonshotai-cn', 'nvidia', 'openai', 'openai-codex', 'opencode',
  'opencode-go', 'openrouter', 'qwen-token-plan', 'qwen-token-plan-cn',
  'qwen-token-plan-individual', 'together',
  'vercel-ai-gateway', 'xai', 'xiaomi', 'xiaomi-token-plan-ams', 'xiaomi-token-plan-cn',
  'xiaomi-token-plan-sgp', 'zai', 'zai-coding-cn',
]

/**
 * Installed catalog providers, read while `llm-pi-ai` activates. Each carries the
 * api-key auth marker the adapter filters on, and no models: the provider
 * directory therefore matches the served deployment while every request path
 * lands on a loud symbol above.
 * @returns one entry per builtin provider.
 */
export function builtinProviders(): unknown[] {
  return BUILTIN_PROVIDER_IDS.map(id => ({
    id,
    name: id,
    auth: { apiKey: { type: 'api-key' } },
    models: [],
  }))
}

/**
 * Provider route ids of the installed catalog. `llm-pi-ai` registers the whole
 * catalog as configurable the moment it mounts and rejects an empty
 * registration, so these are pi-ai's real ids rather than an empty list.
 * @returns the builtin provider ids.
 */
export function getBuiltinProviders(): string[] {
  return [...BUILTIN_PROVIDER_IDS]
}

/**
 * Models of one installed catalog provider.
 * @returns no models.
 */
export function getBuiltinModels(): unknown[] {
  return []
}

/** Build a provider binding that can be constructed at activation but refuses requests. */
function unavailableProviderStreams(name: string): { stream: () => never; streamSimple: () => never } {
  return {
    stream: notImplementedFail(MODULE, `${name}.stream`),
    streamSimple: notImplementedFail(MODULE, `${name}.streamSimple`),
  }
}

/** Anthropic messages API binding.
 * @returns stream methods that explicitly refuse worker requests.
 */
export function anthropicMessagesApi(): { stream: () => never; streamSimple: () => never } {
  return unavailableProviderStreams('anthropicMessagesApi')
}

/** OpenAI completions API binding.
 * @returns stream methods that explicitly refuse worker requests.
 */
export function openAICompletionsApi(): { stream: () => never; streamSimple: () => never } {
  return unavailableProviderStreams('openAICompletionsApi')
}

/** OpenAI responses API binding.
 * @returns stream methods that explicitly refuse worker requests.
 */
export function openAIResponsesApi(): { stream: () => never; streamSimple: () => never } {
  return unavailableProviderStreams('openAIResponsesApi')
}

/** CommonJS interop marker: the worker loader hands `default` to default imports. */
export const __esModule = true

/** CommonJS default export: the members `require()` hands a caller of this module. */
export default {
  createProvider, createModels, builtinModels, getSupportedThinkingLevels, isContextOverflow, builtinProviders,
  getBuiltinModels, getBuiltinProviders, anthropicMessagesApi, openAICompletionsApi,
  openAIResponsesApi,
}
