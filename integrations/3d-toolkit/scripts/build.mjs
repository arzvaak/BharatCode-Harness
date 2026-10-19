import {build} from 'esbuild';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {dirname,join} from 'node:path';
await mkdir('lib/licenses',{recursive:true});
await build({entryPoints:['src/client.jsx'],outfile:'lib/client.js',bundle:true,platform:'browser',format:'cjs',target:'es2022',jsx:'automatic',external:['react','react/jsx-runtime'],legalComments:'eof',banner:{js:'window.__ModuleLoader__.load({id:"@bharatcode/3d-toolkit",factory(require){const module={exports:{}};const exports=module.exports;'},footer:{js:'return module.exports;}});'}});
const require=createRequire(import.meta.url);
const manifest=JSON.parse(await readFile('package.json','utf8'));
const notices=['# Third-party notices\n\nExact dependency versions are recorded in package-lock.json. Dependencies retain their upstream licences.\n'];
for(const name of Object.keys(manifest.dependencies)) {
  let directory;
  try{directory=dirname(require.resolve(`${name}/package.json`));}catch{directory=join(process.cwd(),'node_modules',name);}
  let copied=false;
  for(const filename of ['LICENSE','LICENSE.md','LICENSE.txt','license.md','license']) {
    try{await copyFile(join(directory,filename),join('lib/licenses',`${name.replaceAll('/','-')}-LICENSE`));copied=true;break;}catch{}
  }
  if(!copied&&name.startsWith('@react-three/')) {await copyFile(join('licenses',`${name.split('/')[1]==='fiber'?'react-three-fiber':'react-three-rapier'}-LICENSE`),join('lib/licenses',`${name.replaceAll('/','-')}-LICENSE`));copied=true;}
  if(!copied) throw Error(`Missing licence for ${name}`);
  notices.push(`- ${name} ${manifest.dependencies[name]}: lib/licenses/${name.replaceAll('/','-')}-LICENSE`);
}
notices.push('\nReact Three Fiber licence source: https://github.com/pmndrs/react-three-fiber/blob/v9.8.2/LICENSE\nReact Three Rapier licence source: https://github.com/pmndrs/react-three-rapier/blob/ae5c3fede5ca489fd7eaa8271e9d9c5eabc88e98/LICENSE');
await writeFile('THIRD_PARTY_NOTICES.md',notices.join('\n')+'\n');
