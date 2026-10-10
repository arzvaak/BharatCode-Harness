import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { connectHarness } from '../zero/scripts/harness.mjs';
connectHarness(process.env.DSH_SOURCE);
const { Context } = await import('@deepseek-ai/cordis');
const { LlmAdapter, createAssistantMessage, createUserMessage, createToolResultMessage } = await import('@deepseek-ai/dsh-llm');
const { default: Loader } = await import('@deepseek-ai/cordis-plugin-loader');
const { initProfile, mountRootInclude, readProfilePatches } = await import('@deepseek-ai/dsh-app-boot');
const { default: ConfigEditor } = await import('@deepseek-ai/dsh-config-editor');
const { default: Settings } = await import('@deepseek-ai/dsh-settings');
const dir = mkdtempSync(join(tmpdir(),'bharatcode-guard-')); const ctx = new Context();
try {
 const profileDir=join(dir,'profile'); initProfile(profileDir,['guard-test']);
 const bundle=join(profileDir,'node_modules/guard-test');mkdirSync(bundle,{recursive:true});
 writeFileSync(join(bundle,'package.json'),JSON.stringify({name:'guard-test',dsh:{bundle:{patch:'cordis.patch.yml'}}}));
 const source=resolve(process.env.GUARD_SOURCE ?? 'integrations/tool-call-guard/src/tool-call-guard.js');
 writeFileSync(join(bundle,'cordis.patch.yml'),`- insert:\n    - id: llm\n      name: '@deepseek-ai/dsh-llm'\n    - id: guard\n      name: ${JSON.stringify(source)}\n`);
 writeFileSync(join(profileDir,'cordis.yml'),'[]\n');writeFileSync(join(dir,'package.json'),'{"name":"guard-fixture"}');
 const profile={name:'guard',startedBundles:['guard-test'],dir:profileDir,patchPath:join(profileDir,'cordis.patch.yml'),installAnchor:join(dir,'package.json'),cwd:dir,home:dir,overlays:[]};
 ctx.baseUrl=pathToFileURL(dir+'/').href;await ctx.plugin(Loader);ctx.provide('profileContext',profile);await ctx.plugin(ConfigEditor);await ctx.plugin(Settings);
 await mountRootInclude(ctx,join(profileDir,'cordis.yml'),readProfilePatches('guard',profile));await ctx.loader.await();
 assert.ok(ctx.get('llm'));
 const canonical=[{role:'assistant',content:[{type:'tool-call',id:'bad',name:'read',arguments:'{"path":'},{type:'tool-call',id:'good',name:'read',arguments:'{"path":"ok"}'}]},{role:'user',content:[{type:'text',text:'Keep this note'},{type:'tool-result',toolCallId:'bad',content:[{type:'text',text:'Bad call output'}]},{type:'tool-result',toolCallId:'good',content:[{type:'text',text:'Valid call output'}]}]}];
 canonical[0]=createAssistantMessage({content:canonical[0].content});canonical[1]=createUserMessage({content:canonical[1].content,source:{kind:'user'}});
 const before=JSON.stringify(canonical);let wire;
 class FixtureAdapter extends LlmAdapter { async *stream(options){wire=options.messages;yield {type:'finish',reason:{kind:'stop'}};} }
 const stop=ctx.llm.registerAdapter(['fixture'],new FixtureAdapter());
 for await(const chunk of ctx.llm.stream({provider:'fixture',model:'fixture',messages:canonical,system:[],tools:[],signal:new AbortController().signal})){}
 assert.ok(wire,'real adapter invoked');assert.equal(wire[0].content[0].type,'text','guard intercepts sibling LLM scope');assert.equal(wire[0].content[1].type,'tool-call');
 assert.equal(wire[1].content.length,3,'mixed valid content preserved');assert.equal(wire[1].content[1].type,'text');assert.equal(wire[1].content[2].type,'tool-result');assert.equal(JSON.stringify(canonical),before,'canonical history unchanged');
 const modern=[
   createAssistantMessage({content:[{type:'tool-call',id:'modern-bad',name:'read',arguments:'{"path":'},{type:'tool-call',id:'modern-good',name:'read',arguments:'{"path":"ok"}'}]}),
   createToolResultMessage({callId:'modern-bad',isError:true,content:[{type:'text',text:'Invalid arguments'}]}),
   createToolResultMessage({callId:'modern-good',isError:false,content:[{type:'text',text:'Valid output'}]}),
 ];
 const modernBefore=JSON.stringify(modern);
 for await(const chunk of ctx.llm.stream({provider:'fixture',model:'fixture',messages:modern,system:[],tools:[],signal:new AbortController().signal})){}
 assert.equal(wire[0].content[0].type,'text');assert.equal(wire[0].content[1].type,'tool-call');
 assert.equal(wire[1].role,'user','modern invalid result becomes an ordinary message');
 assert.equal(wire[1].toolCallId,undefined,'no orphan call identity remains');assert.equal(wire[1].isError,undefined);
 assert.equal(wire[1].content[0].text,'[Tool Result: read] Invalid arguments');
 assert.equal(wire[2],modern[2],'valid modern result preserved by identity');
 assert.equal(JSON.stringify(modern),modernBefore,'frozen modern canonical history unchanged');
 [...ctx.loader.entries()].find(e=>e.subtree).subtree.remove('guard');await ctx.loader.await();
 for await(const chunk of ctx.llm.stream({provider:'fixture',model:'fixture',messages:canonical,system:[],tools:[],signal:new AbortController().signal})){}
 assert.equal(wire,canonical,'unload removes interceptor');stop();
 console.log('PASS native Loader + sibling LLM adapter: V3/V4 malformed repair, mixed blocks, canonical preservation, unload');
} finally {await ctx.fiber.dispose();rmSync(dir,{recursive:true,force:true});}
