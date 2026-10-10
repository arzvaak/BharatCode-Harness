import assert from 'node:assert/strict';
import { test } from 'node:test';
import { installationBlock } from '../src/eligibility.js';
import { en, zh } from '../src/locales.js';

const view = { bcVersion: '0.2.0-rc.2', platform: 'linux' };
const entry = {
  status: 'qualified', bcVersion: '>=0.2.0-rc.2', platforms: ['linux'], artifact: { bytes: 1 },
  qualification: { linux: ['packed-install', 'lifecycle', 'workflow'] },
};

test('qualified compatible release is installable including prerelease versions', () => {
  assert.equal(installationBlock(entry, view), undefined);
});

test('each installation gate has a translated explanation without allowing an unqualified release', () => {
  const cases = [
    [{ status: 'preview' }, 'unavailableRelease'],
    [{ bcVersion: '>=1.0.0' }, 'incompatibleVersion'],
    [{ platforms: ['win32'] }, 'unsupportedPlatform'],
    [{ artifact: undefined }, 'missingDownload'],
    [{ qualification: {} }, 'unverifiedPlatform'],
    [{ qualification: { linux: ['packed-install', 'lifecycle'] } }, 'unverifiedPlatform'],
  ];
  for (const [changes, reason] of cases) {
    assert.equal(installationBlock({ ...entry, ...changes }, view), reason);
    assert.ok(en[reason]);
    assert.ok(zh[reason]);
  }
});
