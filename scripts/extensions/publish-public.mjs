/** Publish the reviewed public extension source and exact locally qualified archives. */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createHash, createPublicKey } from 'node:crypto';
import { signCatalog } from './catalog-release.mjs';
import { verifyCatalog } from '../../integrations/extension-store/src/contracts.js';
const repository = 'arzvaak/BharatCode-Extensions';
const [keyFile, sourceCommit] = process.argv.slice(2);
if (!keyFile || !/^[a-f0-9]{40}$/.test(sourceCommit ?? '')) throw Error('Provide an external signing key file and the public source commit.');
const key = await readFile(resolve(keyFile), 'utf8');
const publicKey = await readFile('integrations/extension-store/catalog-public-key.pem', 'utf8');
if (createPublicKey(key).export({type:'spki',format:'pem'}) !== publicKey) throw Error('Public channel signing key does not match the installed trust key.');
function gh(args) { const result = spawnSync('gh', args, {encoding:'utf8'}); if (result.status !== 0) throw Error('Public extension publication failed; inspect repository access or release state.'); return result.stdout; }
if (JSON.parse(gh(['api',`repos/${repository}`])).private !== false) throw Error('Extension distribution must be public.');
const inventory = JSON.parse(await readFile('dist/packed-core/inventory.json'));
if (inventory.platform !== 'linux' || !Array.isArray(inventory.assets) || !inventory.assets.length) throw Error('Native Linux packed-install inventory required.');
for (const asset of inventory.assets) {
  if (!/^[A-Za-z0-9._-]+\.tgz$/.test(asset.name) || !asset.license || asset.license === 'UNRESOLVED') throw Error('Invalid distribution inventory.');
  const bytes = await readFile(join('dist/packed-core',asset.name));
  if (bytes.length !== asset.bytes || createHash('sha256').update(bytes).digest('hex') !== asset.sha256) throw Error('Qualified distribution archive changed.');
}
const core = JSON.parse(await readFile('integrations/core.json'));
// The native subscription adapter's OAuth client configuration is reviewed separately.
const publicPackages = core.packages.filter(row => row.packageName !== '@arzvaak/bharatcode-subscriptions');
const selected = inventory.assets.filter(asset => publicPackages.some(row => row.packageName === asset.packageName));
if (selected.length !== publicPackages.length) throw Error('Core archive inventory is incomplete.');
const directory = resolve('dist/public-extensions'); await mkdir(directory,{recursive:true});
const catalog = JSON.parse(await readFile('integrations/extension-store/catalog.json'));
catalog.revision = 2; catalog.channel = 'preview';
for (const entry of catalog.entries) if (entry.source === 'https://github.com/arzvaak/Bharatcode-Harness') { entry.source=`https://github.com/${repository}`;entry.sourceCommit=sourceCommit; }
const signed = signCatalog(Buffer.from(JSON.stringify(catalog,null,2)+'\n'),key);
verifyCatalog(signed.bytes,signed.signature,publicKey);
await writeFile(join(directory,'catalog.json'),signed.bytes); await writeFile(join(directory,'catalog.sig'),signed.signature+'\n');
await writeFile(join(directory,'inventory.json'),JSON.stringify({...inventory,assets:selected},null,2)+'\n');
const assets = selected;
await writeFile(join(directory,'SHA256SUMS'),`${signed.sha256}  catalog.json\n`+assets.map(asset=>`${asset.sha256}  ${asset.name}\n`).join(''));
await writeFile(join(directory,'RELEASE.md'),'Thirteen public BharatCode core extension packages and six starter skills. The subscription adapter remains bundled with the application and is excluded from this public snapshot pending OAuth client configuration review. Downloads require no GitHub account. The advertised package bytes participated in the native Linux packed-install fixture; these downloads are extension archives for the existing app, not a standalone app/dependency installer. Optional catalog candidates retain their qualification status; subscription accounts, Windows GUI workflows and the complete release matrix are separate checks.\n');
gh(['release','create','extensions-preview-2',...selected.map(asset=>resolve('dist/packed-core',asset.name)),...['catalog.json','catalog.sig','inventory.json','SHA256SUMS'].map(name=>join(directory,name)),'--repo',repository,'--target',sourceCommit,'--prerelease','--title','BharatCode public extensions preview 2','--notes-file',join(directory,'RELEASE.md')]);
console.log(`Published https://github.com/${repository}/releases/tag/extensions-preview-2`);
