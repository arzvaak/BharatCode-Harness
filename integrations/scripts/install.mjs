/** Install reviewed local plugin archives through the Harness profile package manager. */
import { readFileSync, writeFileSync, existsSync, mkdirSync, copyFileSync, chmodSync, statSync } from 'node:fs';
import { dirname, resolve, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseDocument, isSeq, isMap } from 'yaml';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const args=process.argv.slice(2), option=name=>{const n=args.indexOf(name);return n<0?undefined:args[n+1];};
const home=option('--home'),profile=option('--profile'),cli=option('--cli');
if(!home||!profile||!cli)throw Error('Usage: node integrations/scripts/install.mjs --home DSH_HOME --profile PROFILE --cli DSH_EXECUTABLE [--dry-run]');
const registry=JSON.parse(readFileSync(join(root,'integrations/registry.json'),'utf8'));
const archives=registry.plugins.filter(p=>p.enabled).map(p=>{if(!p.artifact)throw Error(`No qualified archive for ${p.id}`);const path=resolve(root,p.artifact);if(!existsSync(path))throw Error(`Missing archive: ${path}`);if(p.sha256&&createHash('sha256').update(readFileSync(path)).digest('hex')!==p.sha256)throw Error(`Archive digest mismatch: ${p.id}`);return path;});
const prefix=/\.(?:mjs|js)$/.test(cli)?[process.execPath,[resolve(cli)]]:[resolve(cli),[]];
let command=[...prefix[1],'plugin','--profile',profile,'add',...archives];
if(args.includes('--dry-run')){console.log(JSON.stringify({executable:prefix[0],args:command,home:resolve(home)},null,2));process.exit(0);}
const profileDir=join(resolve(home),'profiles',profile),backup=join(resolve(home),'integration-backups',new Date().toISOString().replaceAll(':','-'));
mkdirSync(backup,{recursive:true,mode:0o700});
chmodSync(backup,0o700);
if((statSync(backup).mode & 0o777)!==0o700)throw Error('Profile backups require a filesystem that supports owner-only permissions.');
for(const name of ['package.json','cordis.patch.yml','pnpm-lock.yaml','pnpm-workspace.yaml'])if(existsSync(join(profileDir,name))){copyFileSync(join(profileDir,name),join(backup,name));chmodSync(join(backup,name),0o600);if((statSync(join(backup,name)).mode & 0o777)!==0o600)throw Error('Could not secure profile metadata backup.');}
const archiveCache=join(resolve(home),'integration-archives');mkdirSync(archiveCache,{recursive:true,mode:0o700});
const qualified=archives.map(path=>{const digest=createHash('sha256').update(readFileSync(path)).digest('hex');const destination=join(archiveCache,`${digest}-${basename(path)}`);if(!existsSync(destination))copyFileSync(path,destination);if(createHash('sha256').update(readFileSync(destination)).digest('hex')!==digest)throw Error('Cached archive digest mismatch');return destination;});
command=[...prefix[1],'plugin','--profile',profile,'add',...qualified];
const result=spawnSync(prefix[0],command,{stdio:'inherit',env:{...process.env,DSH_HOME:resolve(home)}});
if(result.error)throw result.error;
if(result.status!==0)process.exit(result.status??1);
const manifestPath=join(profileDir,'package.json'),manifest=JSON.parse(readFileSync(manifestPath,'utf8'));
const names=registry.plugins.filter(p=>p.enabled).map(p=>JSON.parse(readFileSync(resolve(root,p.directory,'package.json'),'utf8')).name);
manifest.dsh??={};manifest.dsh.profile??={};
manifest.dsh.profile.bundles=[...new Set([...(manifest.dsh.profile.bundles??[]),...names])];
writeFileSync(manifestPath,JSON.stringify(manifest,null,2)+'\n');
const patchPath=join(profileDir,'cordis.patch.yml');
const patches=parseDocument(existsSync(patchPath)?readFileSync(patchPath,'utf8'):'[]\n');
if(patches.errors.length||!isSeq(patches.contents))throw Error('Profile patch must be a valid YAML list; metadata backup is retained.');
const managerRows=patches.contents.items.filter(item=>isMap(item)&&item.get('id')==='ui-plugin-manager');
if(managerRows.length)managerRows.at(-1).set('disabled',false);
else patches.add({id:'ui-plugin-manager',disabled:false});
writeFileSync(patchPath,patches.toString());

console.log(`Installed ${archives.length} English plugin packages. Profile metadata backup: ${backup}`);
