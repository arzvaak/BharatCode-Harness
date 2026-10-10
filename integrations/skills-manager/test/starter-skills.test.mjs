// Test installed starter documents through the existing manager lifecycle.
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
if (!process.env.BC_STARTER_FIXTURE) {
  const home = await mkdtemp(join(tmpdir(), 'bc-starters-'));
  try {
    const result = spawnSync(process.execPath, [import.meta.filename], { stdio: 'inherit', env: { ...process.env, BC_STARTER_FIXTURE: '1', HOME: home, USERPROFILE: home, DSH_HOME: join(home, '.dsh'), DSH_AGENTS_HOME: join(home, '.agents') } });
    assert.equal(result.status, 0);
  } finally { await rm(home, { recursive: true, force: true }); }
} else {
  const { starterSkills, starterDocument } = await import('../lib/starter-skills.js');
  const { importUploadedSkill, state, setSkillEnabled, deleteSkill, userRoots } = await import('../lib/core.js');
  assert.equal(new Set(starterSkills.map(s => s.name)).size, 6);
  const latex = starterSkills.find(skill => skill.name === 'bc-latex-documents');
  assert.ok(latex, 'LaTeX is an inspectable starter workflow');
  assert.match(latex.body, /latexmk/);
  assert.match(latex.body, /shell.escape/);
  assert.match(latex.body, /PDF/);
  for (const skill of starterSkills) {
    const document = starterDocument(skill);
    const result = await importUploadedSkill({ name: skill.name, entries: [{ path: 'SKILL.md', data: Buffer.from(document).toString('base64') }] });
    assert.ok(!result.error, JSON.stringify(result));
    const snapshot = await state();
    const installed = snapshot.roots.find(r => r.key === 'dsh').skills.find(s => s.name === skill.name);
    assert.ok(installed?.loadable, JSON.stringify(installed));
    await setSkillEnabled(userRoots().find(r => r.key === 'dsh'), skill.name, false);
    assert.equal((await state()).roots.find(r => r.key === 'dsh').skills.find(s => s.name === skill.name).enabled, false);
    await deleteSkill(userRoots().find(r => r.key === 'dsh'), skill.name);
    assert.ok(!(await state()).roots.find(r => r.key === 'dsh').skills.some(s => s.name === skill.name));
  }
  console.log('Six starter skills installed, discovered, disabled, and removed through native manager operations.');
}
