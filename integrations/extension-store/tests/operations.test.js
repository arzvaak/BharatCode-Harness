import test from 'node:test';
import assert from 'node:assert/strict';
import { validateOperation } from '../src/operations.js';

test('store operations validate intent before reaching native services', () => {
  for (const input of [null, [], {}, { action: 'outside' }, { action: 'install', id: '../escape' },
    { action: 'profile-enable', id: 'duckdb', enabled: 'true' },
    { action: 'workspace-enable', id: 'duckdb', enabled: true, workspace: '' },
    { action: 'cancel', requestId: '../../outside' }, { action: 'connect', token: 'short' },
    { action: 'connect-extension', id: 'duckdb', token: ' '.repeat(20) }])
    assert.throws(() => validateOperation(input));
});
test('validated operations retain only their owned fields without adding defaults', () => {
  assert.deepEqual(validateOperation({action:'inspect-dependencies',id:'duckdb',dependencyIds:['outside']}),{action:'inspect-dependencies',id:'duckdb'});
  assert.deepEqual(validateOperation({action:'workspace-enable',id:'duckdb',workspace:'workspace:fixture',enabled:false,token:'unrelated'}),{action:'workspace-enable',id:'duckdb',enabled:false,workspace:'workspace:fixture'});
  assert.deepEqual(validateOperation({action:'refresh',id:'ignored'}),{action:'refresh'});
  assert.deepEqual(validateOperation({action:'connect-extension',id:'duckdb',token:'owned token'}),{action:'connect-extension',id:'duckdb',token:'owned token'});
  assert.deepEqual(validateOperation({action:'setup-dependencies',id:'duckdb',dependencyIds:['outside']}),{action:'setup-dependencies',id:'duckdb'});
  assert.deepEqual(validateOperation({action:'remove-dependency',id:'python-data-runtime',version:'3.12.14',directory:'/outside'}),{action:'remove-dependency',id:'python-data-runtime',version:'3.12.14'});
  assert.throws(() => validateOperation({action:'remove-dependency',id:'python-data-runtime',version:'../outside'}));
});
