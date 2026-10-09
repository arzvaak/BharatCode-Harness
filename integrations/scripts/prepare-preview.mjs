/** Prepare a new linked plugin profile without modifying a user's existing profile. */
import { readFileSync, writeFileSync, mkdirSync, existsSync, symlinkSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../..');
const home=resolve(process.argv[2] ?? join(homedir(),'.local/share/bharatcode-plugin-preview-20261008'));
const profile=join(home,'profiles','integrations');
if(existsSync(join(profile,'package.json')) && !existsSync(join(profile,'.bharatcode-owned'))) throw Error('Choose a new profile home; existing profiles are preserved.');
mkdirSync(join(profile,'node_modules'),{recursive:true});
const rows=JSON.parse(readFileSync(join(root,'integrations/registry.json'),'utf8')).plugins.filter(row=>row.enabled);
const dependencies={};
for(const row of rows){
 const dir=resolve(root,row.directory),pkg=JSON.parse(readFileSync(join(dir,'package.json'),'utf8'));
 const link=join(profile,'node_modules',pkg.name);mkdirSync(dirname(link),{recursive:true});
 if(!existsSync(link))symlinkSync(dir,link,'dir');
 dependencies[pkg.name]=`link:${dir}`;
}
writeFileSync(join(profile,'package.json'),JSON.stringify({name:'bharatcode-integrations-preview',private:true,dependencies,dsh:{profile:{bundles:['@deepseek-ai/dsh-base','@deepseek-ai/dsh-web-app',...Object.keys(dependencies)]}}},null,2)+'\n');
writeFileSync(join(profile,'cordis.yml'),'[]\n');
writeFileSync(join(profile,'cordis.patch.yml'),`- id: locale\n  config:\n    preference: en\n- id: ui-plugin-manager\n  disabled: false\n- id: dsh-engram\n  config:\n    dbDir: ${JSON.stringify(join(home,'engram'))}\n    modelCacheDir: ${JSON.stringify(join(homedir(),'.dsh/engram/models'))}\n    ingest: light\n- id: novel-continuity\n  config:\n    dataDir: ${JSON.stringify(join(home,'novel-continuity'))}\n- id: browser-playwright\n  config:\n    launch:\n      channel: chromium\n`);
writeFileSync(join(profile,'.bharatcode-owned'),'English plugin preview only. No live credentials or sessions copied.\n');
console.log(JSON.stringify({home,profile,plugins:rows.map(row=>row.id)},null,2));
