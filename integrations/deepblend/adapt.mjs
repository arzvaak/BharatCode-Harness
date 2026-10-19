import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
export const UPSTREAM={version:'0.15.0',sourceCommit:'467a83991d8353ffcc3db9446e3a9d22f65cb236',sha256:'b67542e9cd6108a5c3a1182672e3cde05bd7e40b3b4e9316b24fd72515cff05a'};
/** Metadata adaptation only. The release worker verifies the input archive first. */
export async function adaptDeepBlend(root) {
  const target='0.2.0-rc.2';
  const edits=[['package.json','engines','dsh'],['node_modules/@deepblend/dsh-blender-preset/package.json','peerDependencies','@deepseek-ai/dsh-app-boot'],['node_modules/@deepblend/dsh-blender-tool/package.json','peerDependencies','@deepseek-ai/dsh-tools']];
  // Read and validate every file before changing any of them.
  const manifests=await Promise.all(edits.map(async([relative,field,key])=>{
    const value=JSON.parse(await readFile(join(root,relative),'utf8'));
    if(value.version!==UPSTREAM.version || typeof value[field]?.[key]!=='string') throw Error(`Expected DeepBlend ${UPSTREAM.version} metadata in ${relative}`);
    return {relative,field,key,value};
  }));
  const changed=[];
  for(const {relative,field,key,value} of manifests) {
    const range=value[field][key];
    if(range.split('||').map(part=>part.trim()).includes(target)) continue;
    value[field][key]=`${range} || ${target}`;
    await writeFile(join(root,relative),JSON.stringify(value,null,2)+'\n');changed.push(relative);
  }
  return {upstream:UPSTREAM,hostVersion:target,changed};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(!process.argv[2]) throw Error('Usage: node adapt.mjs /path/to/verified/extracted/package');
  console.log(JSON.stringify(await adaptDeepBlend(resolve(process.argv[2])),null,2));
}
