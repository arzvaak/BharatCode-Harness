import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {adaptDeepBlend} from '../adapt.mjs';
test('DeepBlend adapter adds only the exact qualified host version to three metadata ranges',async()=>{
  const root=await mkdtemp(join(tmpdir(),'bc-deepblend-adapter-'));
  const files={
    'package.json':{name:'@deepblend/dsh-blender-bundle',version:'0.15.0',engines:{dsh:'0.1.5-rc.2 || 0.2.1-rc.1'}},
    'node_modules/@deepblend/dsh-blender-preset/package.json':{version:'0.15.0',peerDependencies:{'@deepseek-ai/dsh-app-boot':'0.1.5-rc.2 || 0.2.1-rc.1'}},
    'node_modules/@deepblend/dsh-blender-tool/package.json':{version:'0.15.0',peerDependencies:{'@deepseek-ai/dsh-tools':'>=0.2.1-rc.1 <0.2.2-0'}},
  };
  for(const [relative,value] of Object.entries(files)){await mkdir(dirname(join(root,relative)),{recursive:true});await writeFile(join(root,relative),JSON.stringify(value));}
  const result=await adaptDeepBlend(root);
  assert.equal(result.changed.length,3);
  for(const [relative,original] of Object.entries(files)) {
    const actual=JSON.parse(await readFile(join(root,relative),'utf8'));
    const field=relative==='package.json'?'engines':'peerDependencies';
    const key=Object.keys(original[field])[0];
    assert.equal(actual[field][key],`${original[field][key]} || 0.2.0-rc.2`);
    actual[field][key]=original[field][key]; assert.deepEqual(actual,original);
  }
  assert.equal((await adaptDeepBlend(root)).changed.length,0);
  const manifest=JSON.parse(await readFile(join(root,'package.json'),'utf8'));manifest.version='0.16.0';await writeFile(join(root,'package.json'),JSON.stringify(manifest));
  await assert.rejects(adaptDeepBlend(root),/0.15.0/);
});
