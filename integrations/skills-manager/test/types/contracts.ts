import type { ApiCall } from '../../src/client-types.js';
import type { InstallRecord, RepositoryDependencies } from '../../src/types.js';
import { createSkill, setSkillEnabled } from '../../src/core.js';
import { parseRepositoryInput } from '../../src/repositories.js';
// Checked only by tsc, not executed at runtime; ensure cross-module errors do not regress to dynamic types.
declare const api: ApiCall;
declare const dependencies: RepositoryDependencies;
const repo = parseRepositoryInput({ url: 'owner/repo', ref: 'main' });
repo.owner.toUpperCase();
// @ts-expect-error Repository branches must be text.
parseRepositoryInput({ url: 'owner/repo', ref: 123 });
// @ts-expect-error Enabled state must be a boolean.
setSkillEnabled('dsh', 'sample', 'false');
// @ts-expect-error Skill body must not be passed as a number.
createSkill({ name: 'sample', description: 'test', body: 42 });
api('/state').then(snapshot => {
    snapshot.roots[0].skills[0].name.toUpperCase();
    // @ts-expect-error Skill names are not numbers.
    snapshot.roots[0].skills[0].name.toFixed();
});
api('/repositories/preview').then(preview => {
    preview.token.toUpperCase();
    // @ts-expect-error Preview responses do not have the name field from installation results.
    preview.name;
});
// @ts-expect-error Unregistered endpoints cannot be requested.
api('/repositories/unknown-action');
const serialResult: Promise<number> = dependencies.serialize(async () => 1);
void serialResult;
// @ts-expect-error The serial queue must preserve the task return type.
const wrongResult: Promise<string> = dependencies.serialize(async () => 1);
void wrongResult;
declare const record: InstallRecord;
// @ts-expect-error File summaries must include a hash, not just a path.
record.files.push({ path: 'SKILL.md' });
