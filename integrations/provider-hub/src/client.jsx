import React, {useEffect, useState, useSyncExternalStore} from 'react';
import {ProviderController, bharatCodeDraft, providerDraft, customDraft} from './controller.js';
import css from './style.js';
import {MusePanel} from './MusePanel.jsx';

export const inject = ['slots','remote','remote.settings','remote.credentials','remote.llm'];
export function apply(ctx) {
  const controller = new ProviderController(ctx.remote);
  ctx.effect(() => {
    const style = document.createElement('style'); style.textContent = css;
    style.dataset.plugin = 'dsh-provider-hub'; document.head.appendChild(style);
    return () => style.remove();
  });
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name:'settings.section', id:'provider-hub', order:85, label:'Providers',
    inject: () => ({controller, slots:ctx.slots}),
  }, ProviderHub));
  ctx.slots.inject('settings.account.provider-setup', () => ctx.slots.register({
    name:'settings.account.provider-setup', inject: () => ({controller, slots:ctx.slots}),
  }, ProviderHub));
}
function SubscriptionPanel({slots,initiallyExpanded=false}) {
  useSyncExternalStore(callback => slots.subscribe('settings.section',callback), () => slots.getVersion('settings.section'));
  const entry = slots.entries('settings.section').find(row => row.options.id === 'subscriptions');
  const [expanded,setExpanded] = useState(initiallyExpanded);
  if (!entry) return <div className="ph-note">Install <code>@arzvaak/bharatcode-subscriptions</code> in this profile to enable ChatGPT (Codex), GitHub Copilot, Claude, Grok and Antigravity sign-in. Restart DSH after installation.</div>;
  // Reuse the installed plugin's own UI, locale binding and OAuth lifecycle.
  // No copy of its source or credentials is required.
  const Component = entry.component;
  return <div className="ph-subscriptions">
    <button type="button" className="ph-secondary" aria-expanded={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Hide subscription sign-in' : 'Manage subscription sign-in'}</button>
    {expanded && <div className="ph-subscription-body"><Component {...entry.inject?.()} /></div>}
  </div>;
}
export function ProviderHub({controller,slots}) {
  const [view,setView] = useState(null), [draft,setDraft] = useState(bharatCodeDraft), [key,setKey] = useState('');
  const [busy,setBusy] = useState(false), [error,setError] = useState(''), [notice,setNotice] = useState(''), [selected,setSelected] = useState('bharatcode');
  useEffect(() => {let active=true; controller.load().then(v => {if(active){setView(v);if(v.profiles.bharatcode)setDraft({...bharatCodeDraft(),...v.profiles.bharatcode,route:'bharatcode'});}}).catch(e => {if(active)setError(e.message);}); return () => {active=false;};},[controller]);
  const change = (field,value) => setDraft(old => ({...old,[field]:value}));
  const updateModel = (index,field,value) => setDraft(old => ({...old,models:old.models.map((model,i) => i === index ? {...model,[field]:value} : model)}));
  const run = async action => {setBusy(true);setError('');setNotice('');try {await action();} catch(e) {setError(e.message);} finally {setBusy(false);}};
  const choose = selected => {
    setSelected(selected);setKey(''); setNotice(''); setError('');
    if (['muse','codex','google'].includes(selected)) return;
    const preset = providerDraft(selected);
    const existing = view?.profiles?.[selected];
    setDraft(existing ? {...preset,...existing,route:selected,models:existing.models || preset.models} : preset);
  };
  return <section className="ph-root">
    <header><h2>Providers</h2><p>Use your BharatCode subscription, connect another subscription, or add an API key.</p></header>
    <section aria-labelledby="ph-sub-title"><h3 id="ph-sub-title">Subscriptions</h3>
      <p>ChatGPT uses your Codex subscription. Google uses the Antigravity sign-in flow. GitHub uses GitHub Copilot. Sign in with the installed subscription plugin.</p>
      <SubscriptionPanel slots={slots}/>
    </section>
    <section aria-labelledby="ph-endpoint-title"><h3 id="ph-endpoint-title">Model endpoints</h3>
      <div className="ph-presets">
        <button disabled={busy} type="button" onClick={() => choose('codex')}>Codex subscription</button>
        <button disabled={busy} type="button" onClick={() => choose('google')}>Google subscription</button>
        <button disabled={busy} type="button" onClick={() => choose('bharatcode')}>BharatCode</button>
        <button disabled={busy} type="button" onClick={() => choose('opencode')}>OpenCode</button>
        <button disabled={busy} type="button" onClick={() => choose('mistral')}>Mistral API key</button>
        <button disabled={busy} type="button" onClick={() => choose('muse')}>Muse subscription (CLI)</button>
        <button disabled={busy} type="button" onClick={() => choose('custom')}>Other provider</button>
      </div>
      {selected === 'muse' && <MusePanel/>}
      {['codex','google'].includes(selected) && <SubscriptionPanel slots={slots} initiallyExpanded/>}
      {!['muse','codex','google'].includes(selected) && <>
      {view && <label className="ph-field">Edit configured endpoint<select disabled={busy} value="" onChange={e => choose(e.target.value)}><option value="">Select a provider…</option>{Object.entries(view.profiles).filter(([,p]) => ['openai-completions','openai-responses'].includes(p.api)).map(([route,p]) => <option key={route} value={route}>{p.displayName || route}</option>)}</select></label>}
      <form onSubmit={e => {e.preventDefault();run(async () => {const next=await controller.save({...draft,apiKey:key});setView(next);setKey('');setNotice('Provider saved. Open the model picker to select one of its models.');});}}>
        <fieldset disabled={busy || !view || !view.writable}>
          <div className="ph-grid">
            <label className="ph-field">Provider name<input value={draft.displayName} onChange={e => change('displayName',e.target.value)} required/></label>
            <label className="ph-field">Route ID<input value={draft.route} onChange={e => change('route',e.target.value)} required placeholder="my-provider"/></label>
          </div>
          <label className="ph-field">API base URL<input type="url" value={draft.baseURL} onChange={e => change('baseURL',e.target.value)} required placeholder="https://your-provider.example/v1"/></label>
          <label className="ph-field">API format<select value={draft.api} onChange={e => change('api',e.target.value)}><option value="openai-completions">Chat Completions</option><option value="openai-responses">Responses</option></select></label>
          <div className="ph-grid">
            <label className="ph-field">Key reference<input value={draft.apiKeyEnv} onChange={e => change('apiKeyEnv',e.target.value)} required/></label>
            <label className="ph-field">API key<input type="password" autoComplete="new-password" value={key} onChange={e => setKey(e.target.value)} placeholder="Leave blank to keep the stored key"/></label>
          </div>
          <p className="ph-help">Keys are stored by DSH. You can also export the named key reference before launching DSH. For a local server that accepts any key, enter a placeholder key.</p>
          <div className="ph-model-heading"><h4>Models</h4><button type="button" onClick={() => run(async () => {
            const found = await controller.discover({...draft,apiKey:key});
            if (!found.length) throw new Error('The endpoint returned no models. Enter a model ID manually.');
            change('models',found.map(m => ({...draft.models.find(old => old.id === m.id),id:m.id,name:m.name || m.id,contextWindow:m.contextWindow || 32768,maxTokens:m.maxTokens || 4096,...m.inputModalities ? {input:m.inputModalities} : {}})));
            setNotice('Model list discovered. Review capacities and remove any models you do not want before saving. Missing capacities use 32,768 context and 4,096 output as editable estimates.');
          })}>Discover models</button></div>
          <div className="ph-models">{draft.models.map((model,index) => <div className="ph-model" key={index}>
            <label className="ph-field">Model ID<input value={model.id} onChange={e => updateModel(index,'id',e.target.value)} required/></label>
            <label className="ph-field">Context tokens<input type="number" min="1" value={model.contextWindow ?? 32768} onChange={e => updateModel(index,'contextWindow',Number(e.target.value))} required/></label>
            <label className="ph-field">Max output tokens<input type="number" min="1" value={model.maxTokens ?? 4096} onChange={e => updateModel(index,'maxTokens',Number(e.target.value))} required/></label>
            <button type="button" aria-label={`Remove model ${model.id || index+1}`} onClick={() => change('models',draft.models.filter((_,i) => i !== index))}>Remove</button>
          </div>)}</div>
          <button type="button" className="ph-secondary" onClick={() => change('models',[...draft.models,{id:'',contextWindow:32768,maxTokens:4096}])}>Add model manually</button>
          <p className="ph-help">The BharatCode preset includes Qwen and DeepSeek. Discover models to check the current account catalog. Catalog visibility does not guarantee successful inference.</p>
          <button className="ph-save" type="submit">{busy ? 'Working…' : 'Save provider'}</button>
        </fieldset>
      </form>
      </>}
    </section>
    {error && <p className="ph-error" role="alert">{error}</p>}
    {notice && <p className="ph-notice" role="status">{notice}</p>}
    {view && !view.writable && <p role="status">This host has read-only settings.</p>}
  </section>;
}
