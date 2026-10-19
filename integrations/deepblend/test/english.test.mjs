import {test} from 'node:test';
import assert from 'node:assert/strict';
import {englishText,translateRecipe,patchClient,deliveryVideo} from '../english.mjs';

test('English recipe copy translates known upstream labels without changing IDs or geometry',()=>{
 const original={id:'deepblend.glazed-cup',title:'青釉带把手杯',parameters:[{id:'cup-height-mm',title:'杯身高度（毫米）',default:105}],entities:[{id:'cup',geometry:{height:0.105}}]};
 const translated=translateRecipe(original);
 assert.equal(translated.title,'Glazed handled cup');
 assert.equal(translated.parameters[0].title,'Cup height (mm)');
 assert.deepEqual(translated.entities,original.entities);
 assert.equal(original.title,'青釉带把手杯');
 assert.equal(englishText('Goal: 青釉带把手杯'),'Goal: Glazed handled cup');
 assert.equal(englishText('My custom project'),'My custom project');
});

test('English client patch defaults delivery to final, explains full range, and removes hardcoded Chinese notices',()=>{
 const original=`function readLocale() {\n      const named = typeof document === 'undefined' ? '' : String(document.documentElement?.lang ?? '')\n      const key = named.toLowerCase().split('-')[0]\n      return Object.prototype.hasOwnProperty.call(STRINGS, key) ? key : 'en'\n    }\nfunction flatten(list) {\n const out=[]; for(const item of list) { out.push(item) }\n}\nforms: { title: '', goal: '', recipe: null, recipeParameters: {}, patch: null, frameStart: '', frameEnd: '', profile: 'preview' },\nel('h4', null, t('jobs.startDelivery')),\n · 缺失 0 · 损坏 0\n`;
 const result=patchClient(original);
 assert.match(result,/profile: 'final'/);
 assert.match(result,/Full project range/);
 assert.match(result,/missing/);
 assert.match(result,/corrupt/);
 assert.match(result,/return 'en'/);
 assert.equal(patchClient(result),result);
 assert.throws(()=>patchClient('unexpected upstream content'),/Expected/);
});


test('animation playback uses the verified immutable job video, never the mutable latest output',()=>{
 const job={jobId:'render-0002',delivery:{verified:true,sha256:'a'.repeat(64)}};
 assert.equal(deliveryVideo('my cup',job),'/deepblend/artifacts/my%20cup/renders/render-0002/encoded/render-0002.mp4?v=aaaaaaaaaaaa');
 assert.equal(deliveryVideo('cup',{...job,delivery:{verified:false}}),null);
 assert.equal(deliveryVideo('cup',{...job,jobId:'../other'}),null);
});
