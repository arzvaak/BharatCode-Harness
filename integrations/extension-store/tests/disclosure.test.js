import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capabilityState } from '../src/disclosure.js';
test('setup states do not imply availability from catalog presence', () => {
  assert.equal(capabilityState({ installed: false, enabled: false, qualified: false }).status, 'disabled');
  assert.equal(capabilityState({ installed: true, enabled: true, qualified: true, credential: false }).status, 'needs-setup');
  assert.equal(capabilityState({ installed: true, enabled: true, qualified: true }).status, 'ready');
  assert.equal(capabilityState({ failure: 'Runtime crashed' }).status, 'failed');
});
