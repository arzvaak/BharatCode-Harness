import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ProviderController, validateDraft, providerDraft, bharatCodeDraft } from '../src/controller.js';
const ok = value => ({ ok: true, value });
function fixture() {
  const calls = [];
  const section = { ns: 'llm', revision: 8, value: { providers: { bharatcode: { ...bharatCodeDraft(), timeoutMs: 90000, compat: { thinkingFormat: 'deepseek' } }, other: { models: [{ id: 'keep' }] } } } };
  const remote = { settings: { describe: async () => ok({ writable: true, namespaces: [section] }), mutate: async (...args) => { calls.push(['mutate', ...args]); return ok(section); } },
    credentials: { set: async (...args) => { calls.push(['key', ...args]); return ok(); } },
    llm: { listConfigurableProviders: async () => ok([{ provider: 'openai', settingsNs: 'llm', settingsPath: ['providers', 'openai'] }]), listProviders: async () => ok([{id:'codex', name:'ChatGPT'}]), discoverModels: async (...args) => { calls.push(['discover', ...args]); return ok([{ id:'discovered', contextWindow: 64000 }]); } } };
  return { remote, calls, section, controller: new ProviderController(remote) };
}
test('BharatCode preset preserves deployment prefix and known model capacities', () => {
  const draft = validateDraft(bharatCodeDraft());
  assert.equal(draft.baseURL, 'https://bharatcode.ai/api/model/v1');
  assert.ok(draft.models.some(m => m.id === 'qwen-3.8-27b'));
});
test('rejects credentials in URL, unsafe routes and invalid model capacities', () => {
  for (const changes of [{route:'__proto__'}, {route:'codex'}, {baseURL:'https://secret:password@example.com/v1'}, {baseURL:'file:///etc'}, {models:[{id:'x',contextWindow:0,maxTokens:5}]}]) assert.throws(() => validateDraft({...bharatCodeDraft(), ...changes}));
});
test('updates only selected route with optimistic concurrency; keeps extra options and credentials separate', async () => {
  const {controller,calls} = fixture();
  await controller.load();
  await controller.save({...bharatCodeDraft(), apiKey:'test-key'});
  const mutation = calls.find(c => c[0] === 'mutate');
  assert.equal(mutation[1], 'llm'); assert.equal(mutation[3], 8);
  assert.deepEqual(mutation[2][0].path, ['providers','bharatcode']);
  assert.equal(mutation[2][0].value.timeoutMs, 90000);
  assert.equal(mutation[2][0].value.compat.thinkingFormat, 'deepseek');
  assert.ok(!JSON.stringify(mutation).includes('test-key'));
  assert.deepEqual(calls.find(c => c[0] === 'key'), ['key','BHARATCODE_API_KEY','test-key']);
});
test('failed profile validation never writes a key', async () => {
  const {controller,calls,remote} = fixture(); await controller.load();
  remote.settings.mutate = async () => ({ok:false,error:{message:'configuration rejected'}});
  await assert.rejects(controller.save({...bharatCodeDraft(),apiKey:'test-key'}), /configuration rejected/);
  assert.equal(calls.length,0);
});
test('discovery passes a draft endpoint and temporary key, without writing either', async () => {
  const {controller,calls} = fixture(); await controller.load();
  const models = await controller.discover({...bharatCodeDraft(),apiKey:'one-shot'});
  assert.equal(models[0].id,'discovered');
  assert.equal(calls[0][0],'discover'); assert.equal(calls[0][2].baseURL,'https://bharatcode.ai/api/model/v1');
  assert.equal(calls[0][2].apiKey,'one-shot'); assert.equal(calls.length,1);
});
test('missing native adapter produces setup instructions', async () => {
  const {controller,remote} = fixture(); remote.llm.listConfigurableProviders = async () => ok([]);
  await assert.rejects(controller.load(), /pi-ai/);
});
test('credential failure reports the saved-profile state and supports retry', async () => {
 const {controller,remote,calls}=fixture();await controller.load();
 remote.credentials.set=async()=>({ok:false,error:{message:'write refused'}});
 await assert.rejects(controller.save({...bharatCodeDraft(),apiKey:'fixture'}), /profile was saved, but its key could not be stored/);
 assert.equal(calls[0][0],'mutate');
});
test('discovery refuses to forward a stored key to a changed draft URL', async () => {
 const {controller,calls}=fixture();await controller.load();
 await assert.rejects(controller.discover({...bharatCodeDraft(),baseURL:'https://another.example/v1'}), /changed endpoint/);
 assert.equal(calls.length,0);
});

test("named setup presets keep keys separate and CLI subscriptions are not API presets", () => {
  assert.equal(providerDraft("mistral").apiKeyEnv, "MISTRAL_API_KEY");
  assert.equal(providerDraft("opencode").displayName, "OpenCode");
  assert.equal(providerDraft("muse").route, "custom");
  assert.equal(providerDraft("bharatcode").route, "bharatcode");
});
