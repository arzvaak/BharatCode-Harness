/** Isolated Loader fixture; does not launch or change the user's Desktop profile. */
import { registerHooks } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import assert from 'node:assert/strict';
const harness = process.env.DSH_SOURCE || fileURLToPath(new URL('../../../', import.meta.url));
const url = path => pathToFileURL(join(harness, path)).href;
// Use the built Cordis library, independently of temporary source-checkout test stubs.
registerHooks({ resolve(specifier, context, next) {
  if (specifier === '@deepseek-ai/cordis') return { url: url('vendor/cordis/lib/index.js'), shortCircuit: true };
  if (specifier === '@deepseek-ai/cordis-plugin-loader') return { url: url('vendor/loader/lib/index.js'), shortCircuit: true };
  return next(specifier, context);
} });
const { Context } = await import(url('vendor/cordis/lib/index.js'));
const { Loader } = await import(url('vendor/loader/lib/index.js'));
const { SlotCore } = await import(url('packages/client/ui-slots/lib/index.js'));
const { installAssistantWrapper } = await import('../src/integration.js');
const fixture = await mkdtemp(join(tmpdir(), 'dsh-visuals-composition-'));
const ctx = new Context();
try {
  await writeFile(join(fixture, 'cordis.yml'), [
    `- id: prompt\n  name: ${JSON.stringify(url('packages/core/system-prompt/lib/index.js'))}\n  config: {}`,
    `- id: visuals\n  name: ${JSON.stringify(new URL('../src/host.js', import.meta.url).href)}`,
  ].join('\n') + '\n');
  await ctx.plugin(Loader, { baseUrl: pathToFileURL(fixture + '/').href });
  await ctx.loader.create({ name: url('vendor/include/lib/index.js'), config: { path: 'cordis.yml' } });
  await ctx.loader.await();
  assert.ok(ctx.systemPrompt, 'system prompt service activated through YAML Loader');
  const assembly = await ctx.systemPrompt.assemble();
  assert.ok(assembly.sections.some(s => s.name === 'dsh-visuals:guide' && s.text.includes('sequenceDiagram')));
  const include = [...ctx.loader.entries()].find(e => e.subtree)?.subtree;
  include.remove('visuals');
  await ctx.loader.await();
  assert.equal((await ctx.systemPrompt.assemble()).sections.some(s => s.name === 'dsh-visuals:guide'), false);

  const slots = new SlotCore(), Native = () => null;
  slots.register({ name: 'root', children: { 'conversation.chat.node': { kind: 'keyed', scope: 'session' } } }, () => null);
  slots.register({ name: 'conversation.chat.node', key: 'assistant-step' }, Native);
  const fiber = await ctx.plugin({ name: 'visual-fixture', apply(owner) {
    installAssistantWrapper({ slots, effect: owner.effect.bind(owner) }, component => ({ native: component }));
  } });
  assert.equal(slots.entriesOfSlot('conversation.chat.node')[0].component.native, Native);
  await fiber.dispose();
  assert.equal(slots.entriesOfSlot('conversation.chat.node')[0].component, Native);
  console.log('Real YAML Loader: prompt activated and disposed. Real Cordis fiber + SlotCore: native renderer shadowed and restored.');
} finally { await ctx.fiber.dispose(); await rm(fixture, { recursive: true, force: true }); }
