import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseComposition, assertComposition } from './composition.mjs'
const healthy = `- id: llm\n- id: session\n- id: agent-default-model\n  config: {provider: bharatcode, model: deepseek-v4.1-flash, reasoningEffort: max}\n- id: web\n  config: {searchProvider: searxng, fetchProvider: http}\n- id: agent-preset-registry\n  config: {default: standard, selectedDefault: cordis}\n- id: max-tokens-continue\n  name: '@local/max-tokens-continue'\n  config: {enabled: true, maxContinuations: 9, requireProgress: true}\n- id: llm-pi-ai\n  config:\n    providers:\n      bharatcode:\n        models: [{id: deepseek-v4.1-flash, contextWindow: 1000000, maxTokens: 32000}]\n`
test('composition rejects renamed targets and wrong provider selection', () => {
  assert.doesNotThrow(() => assertComposition(parseComposition(healthy), true))
  assert.throws(() => assertComposition(parseComposition(healthy.replace('id: web', 'id: renamed-web')), true), /web/)
  assert.throws(() => assertComposition(parseComposition(healthy.replace('searchProvider: searxng', 'searchProvider: deepseek-official')), true), /searchProvider/)
})
test('composition rejects disabled required plugin and incorrect continuation budget', () => {
  assert.throws(() => assertComposition(parseComposition(healthy.replace("name: '@local/max-tokens-continue'", "name: '@local/max-tokens-continue'\n  disabled: true")), true), /disabled/)
  assert.throws(() => assertComposition(parseComposition(healthy.replace('maxContinuations: 9', 'maxContinuations: 99')), true), /maxContinuations/)
})
