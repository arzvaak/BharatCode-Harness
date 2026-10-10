import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validatePublicRevision } from '../../../scripts/extensions/public-channel.mjs';

test('public publication reserves a revision above every existing preview release', () => {
  const releases = [{tag_name:'extensions-preview-5'}, {tag_name:'extensions-preview-2'}, {tag_name:'other-900'}];
  assert.equal(validatePublicRevision(6, releases), 6);
  assert.throws(() => validatePublicRevision(4, releases), /increase/);
  assert.throws(() => validatePublicRevision(5, releases), /increase/);
  assert.equal(validatePublicRevision(2, []), 2);
  for (const revision of [1, 3.5, NaN, Infinity]) assert.throws(() => validatePublicRevision(revision, []), /revision/);
});
