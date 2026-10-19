import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import vm from 'node:vm';
import {patchClient} from '../english.mjs';

test('pinned compiled DeepBlend UI defaults to final and displays English and playable per-job delivery', {skip:!process.env.BC_DEEPBLEND_PACKAGE},async()=>{
 const source=await readFile(join(process.env.BC_DEEPBLEND_PACKAGE,'node_modules/@deepblend/dsh-blender-ui/lib/client.js'),'utf8');
 const patched=patchClient(source);
 assert.equal(patchClient(patched),patched);
 let registration;
 vm.runInNewContext(patched,{window:{__ModuleLoader__:{load(value){registration=value}}},document:{documentElement:{lang:'zh-CN'}},setTimeout,clearTimeout,setInterval,clearInterval,URL});
 const {workbench}=registration.factory(()=>{throw Error('Unexpected React import in core view')});
 const store=workbench.createWorkbenchStore({fetch:async()=>{throw Error('Unexpected fetch')}});
 const state=store.getState();
 assert.equal(state.forms.profile,'final');
 const label=workbench.el('input',{'aria-label':'杯身高度（毫米）'},'青釉带把手杯');
 assert.equal(label.props['aria-label'],'Cup height (mm)');
 assert.equal(label.children[0],'Glazed handled cup');
 state.view='jobs';state.activeProjectId='cup';
 state.selected={scene:{revision:'r0003',project:{frameStart:1,frameEnd:48,fps:24}}};
 state.jobs=[{jobId:'render-0002',status:'completed',progress:{completed:48,expected:48,percent:100,missing:0,corrupt:0},delivery:{verified:true,sha256:'a'.repeat(64)},frameStart:1,frameEnd:48}];
 const tree=workbench.renderView({state,actions:{}});
 const nodes=[];
 function walk(node){if(!node||typeof node!=='object')return;if(Array.isArray(node)){node.forEach(walk);return;}nodes.push(node);node.children?.forEach(walk);}
 walk(tree);
 const video=nodes.find(node=>node.tag==='video');
 assert.equal(video.props.controls,true);
 assert.match(video.props.src,/renders\/render-0002\/encoded\/render-0002\.mp4/);
 assert.ok(nodes.some(node=>node.tag==='a'&&node.props.download==='render-0002.mp4'));
 assert.ok(!/[\u3400-\u9fff]/u.test(JSON.stringify(tree)));
 assert.ok(patched.includes("deliveryVideo(projectId, job) ? h('div'"),'chat tool-card also offers video playback');
});

test('English adaptation preserves recipe geometry and timing and rebinds exact scene hashes', {skip:!process.env.BC_DEEPBLEND_PACKAGE},async()=>{
 const {mkdtemp,mkdir,copyFile}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {createHash}=await import('node:crypto');
 const {adaptEnglish}=await import('../english.mjs');
 const root=await mkdtemp(join(tmpdir(),'bc-deepblend-english-'));
 const base='node_modules/@deepblend/';
 const names=['glass-ceramic','glazed-cup','metal-lamp','modular-speaker'];
 const files=['dsh-blender-ui/lib/client.js','dsh-blender-ui/lib/index.js','dsh-blender-preset/presets/deepblend/preset.yml','dsh-blender-preset/presets/deepblend-dev/preset.yml','dsh-blender-preset/presets/deepblend/agent.cordis.yml','dsh-blender-preset/presets/deepblend/skills/deepblend-studio/SKILL.md',...names.flatMap(name=>['recipe.json','scene-spec.json'].map(file=>`dsh-blender-host/recipes/${name}/${file}`))];
 for(const file of files){const destination=join(root,base,file);await mkdir((await import('node:path')).dirname(destination),{recursive:true});await copyFile(join(process.env.BC_DEEPBLEND_PACKAGE,base,file),destination);}
 const originals=await Promise.all(names.map(name=>readFile(join(root,base,`dsh-blender-host/recipes/${name}/scene-spec.json`),'utf8').then(JSON.parse)));
 await adaptEnglish(root);
 for(const preset of ['deepblend','deepblend-dev']) {const text=await readFile(join(root,base,`dsh-blender-preset/presets/${preset}/preset.yml`),'utf8');assert.ok(!/[\u3400-\u9fff]/u.test(text.split('\n').filter(line=>!line.trim().startsWith('#')).join('\n')),'preset name and description are English');}
 for(const [index,name] of names.entries()) {
  const prefix=join(root,base,`dsh-blender-host/recipes/${name}`);
  const bytes=await readFile(join(prefix,'scene-spec.json'));
  const scene=JSON.parse(bytes), recipe=JSON.parse(await readFile(join(prefix,'recipe.json'),'utf8'));
  assert.equal(recipe.input.sha256,createHash('sha256').update(bytes).digest('hex'));
  assert.equal(/[\u3400-\u9fff]/u.test(JSON.stringify(recipe)+bytes.toString()),false);
  const before=structuredClone(originals[index]);
  for(const key of ['title','goal']) {delete before.project[key];delete scene.project[key];}
  assert.deepEqual(scene,before,'all geometry, appearance and timeline data are preserved');
 }
 const first=await Promise.all(files.map(file=>readFile(join(root,base,file),'utf8')));
 await adaptEnglish(root);
 assert.deepEqual(await Promise.all(files.map(file=>readFile(join(root,base,file),'utf8'))),first);
});
