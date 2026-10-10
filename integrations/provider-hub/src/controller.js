const RESERVED = new Set(['__proto__', 'prototype', 'constructor', 'codex', 'copilot', 'claude', 'grok', 'antigravity']);
const PROTOCOLS = new Set(['openai-completions', 'openai-responses']);
export function unwrap(result) {
  if (!result?.ok) throw new Error(result?.error?.message || 'The host could not complete this request.');
  return result.value;
}
export function bharatCodeDraft() {
  return { route: 'bharatcode', displayName: 'BharatCode', baseURL: 'https://bharatcode.ai/api/model/v1', api: 'openai-completions', apiKeyEnv: 'BHARATCODE_API_KEY',
    models: [{id:'qwen-3.8-27b', name:'Qwen 3.8 27B', contextWindow:262144, maxTokens:32000}, {id:'deepseek-v4.1-flash', name:'DeepSeek V4.1 Flash', contextWindow:1000000, maxTokens:32000}] };
}
export function customDraft() {
  return {route:'custom',displayName:'Custom provider',baseURL:'',api:'openai-completions',apiKeyEnv:'CUSTOM_API_KEY',models:[]};
}
export function validateDraft(draft, { requireModels = true } = {}) {
  const route = String(draft.route || '').trim();
  if (!/^[a-z][a-z0-9-]{0,63}$/.test(route) || RESERVED.has(route)) throw new Error('Choose a unique route using lowercase letters, digits and hyphens. Subscription routes are reserved.');
  let url; try { url = new URL(draft.baseURL); } catch { throw new Error('Enter a complete API base URL.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) throw new Error('Use an HTTP or HTTPS base URL without credentials, query parameters or fragments.');
  const loopback = ['localhost','127.0.0.1','[::1]'].includes(url.hostname);
  if (url.protocol === 'http:' && !loopback) throw new Error('Use HTTPS for remote providers. Localhost endpoints may use HTTP.');
  if (!PROTOCOLS.has(draft.api)) throw new Error('Select Chat Completions or Responses.');
  const apiKeyEnv = String(draft.apiKeyEnv || '').trim();
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(apiKeyEnv)) throw new Error('Enter a valid credential reference such as BHARATCODE_API_KEY.');
  const models = draft.models || [];
  if (!Array.isArray(models) || models.length > 512 || (requireModels && !models.length)) throw new Error('Discover or enter at least one model (maximum 512).');
  const seen = new Set();
  const normalized = models.map(model => {
    const id = String(model.id || '').trim();
    if (!id || id.length > 256 || seen.has(id)) throw new Error('Each model needs a distinct, non-empty ID.');
    seen.add(id);
    const contextWindow = Number(model.contextWindow ?? 32768), maxTokens = Number(model.maxTokens ?? 4096);
    if (![contextWindow,maxTokens].every(n => Number.isSafeInteger(n) && n > 0) || maxTokens > contextWindow) throw new Error('Model capacities must be positive integers, with output no larger than context.');
    return {...model, id, name: model.name || id, contextWindow, maxTokens};
  });
  return {route, displayName: String(draft.displayName || route).trim(), baseURL: url.href.replace(/\/+$/, ''), api:draft.api, apiKeyEnv, models:normalized};
}
export class ProviderController {
  constructor(remote) { this.remote = remote; }
  async load() {
    const [settings, directory, providers] = await Promise.all([
      this.remote.settings.describe().then(unwrap), this.remote.llm.listConfigurableProviders().then(unwrap), this.remote.llm.listProviders().then(unwrap),
    ]);
    // The native catalog declares openai even when no OpenAI route is active.
    const native = directory.find(row => row.provider === 'openai' && row.settingsPath?.[0] === 'providers');
    this.section = native && settings.namespaces.find(row => row.ns === native.settingsNs);
    if (!this.section) throw new Error('Enable the native @deepseek-ai/dsh-llm-pi-ai adapter in this profile, then reopen Providers.');
    this.directory = directory; this.writable = settings.writable;
    return {ns:this.section.ns, writable:settings.writable, providers, profiles: this.section.value?.providers || {}};
  }
  async discover(draft) {
    const profile = validateDraft(draft, {requireModels:false});
    if (!this.section) await this.load();
    const existing = this.section.value?.providers?.[profile.route];
    // A draft key takes precedence. Without a new key the host may use the
    // stored credential only when interrogating the existing endpoint.
    if (!draft.apiKey && existing && existing.baseURL !== profile.baseURL) throw new Error('Enter a key for the changed endpoint before discovery.');
    return unwrap(await this.remote.llm.discoverModels(this.section.ns, {
      baseURL:profile.baseURL, api:profile.api,
      ...existing && !draft.apiKey ? {provider:profile.route} : {},
      ...draft.apiKey ? {apiKey:draft.apiKey} : {},
    }));
  }
  async save(draft) {
    const {route,...profile} = validateDraft(draft);
    if (!this.section) await this.load();
    if (!this.writable) throw new Error('This host has read-only settings.');
    const owner = this.directory.find(row => row.provider === route);
    if (owner && owner.settingsNs !== this.section.ns) throw new Error('This route belongs to another adapter. Choose a different route.');
    const existing = this.section.value?.providers?.[route] || {};
    // Preserve advanced options and per-model reasoning/compat overrides.
    profile.models = profile.models.map(model => ({...existing.models?.find(m => m.id === model.id), ...model}));
    unwrap(await this.remote.settings.mutate(this.section.ns,
      [{op:'set',path:['providers',route],value:{...existing,...profile}}], this.section.revision));
    if (draft.apiKey) {
      try { unwrap(await this.remote.credentials.set(profile.apiKeyEnv,draft.apiKey)); }
      catch { throw new Error('The provider profile was saved, but its key could not be stored. Check credential permissions and save the key again.'); }
    }
    return this.load();
  }
}

export function providerDraft(id) {
  if (id === "bharatcode") return bharatCodeDraft();
  const preset = {mistral: ["Mistral", "https://api.mistral.ai/v1", "MISTRAL_API_KEY"], opencode: ["OpenCode", "https://opencode.ai/zen/v1", "OPENCODE_API_KEY"]}[id];
  return preset ? {...customDraft(), route:id, displayName:preset[0], baseURL:preset[1], apiKeyEnv:preset[2]} : customDraft();
}
