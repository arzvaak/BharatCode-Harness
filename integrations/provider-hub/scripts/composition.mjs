import {registerHooks} from 'node:module';
import {pathToFileURL} from 'node:url';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {createServer} from 'node:http';
import assert from 'node:assert/strict';
import {ProviderController,customDraft} from '../src/controller.js';
const harness=process.env.DSH_SOURCE;
if (!harness) throw new Error('Set DSH_SOURCE to a built DeepSeek Harness checkout before running this integration test.');
const file=p=>join(harness,p), url=p=>pathToFileURL(file(p)).href;
registerHooks({resolve(s,c,next){const aliases={'@deepseek-ai/cordis':'vendor/cordis/lib/index.js','@deepseek-ai/cordis-plugin-loader':'vendor/loader/lib/index.js'};return aliases[s]?{url:url(aliases[s]),shortCircuit:true}:next(s,c);}});
const {Context}=await import(url('vendor/cordis/lib/index.js'));
const {default:Loader}=await import(url('vendor/loader/lib/index.js'));
const {initProfile,mountRootInclude,readProfilePatches}=await import(url('packages/boot/app-boot/lib/index.js'));
const {default:ConfigEditor}=await import(url('packages/boot/config-editor/lib/index.js'));
const {default:Settings}=await import(url('packages/settings/settings/lib/index.js'));
const {BlockAssembler}=await import(url('packages/llm/llm/lib/index.js'));
const {default:yaml}=await import(url('node_modules/js-yaml/index.js'));
const root=await mkdtemp(join(tmpdir(),'dsh-provider-hub-')), calls=[];
const server=createServer(async(request,response)=>{
 let body='';for await(const chunk of request)body+=chunk;
 calls.push({path:request.url,key:request.headers.authorization,body:body?JSON.parse(body):undefined});
 if(request.url==='/v1/models'){response.setHeader('content-type','application/json');response.end(JSON.stringify({data:[{id:'hub-model',context_window:65536,max_output_tokens:4096}]}));return;}
 response.setHeader('content-type','text/event-stream');
 for(const event of [{choices:[{delta:{role:'assistant',content:'PROVIDER_HUB_OK'},index:0,finish_reason:null}]},{choices:[{delta:{},index:0,finish_reason:'stop'}],usage:{prompt_tokens:2,completion_tokens:3}}])response.write(`data: ${JSON.stringify(event)}\n\n`);
 response.end('data: [DONE]\n\n');
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));const baseURL=`http://127.0.0.1:${server.address().port}/v1`,ctx=new Context();
try{
 const dir=join(root,'profile');initProfile(dir,['hub-test']);const bundle=join(dir,'node_modules/hub-test');await mkdir(bundle,{recursive:true});
 await writeFile(join(root,'package.json'),'{"name":"hub-fixture"}');await writeFile(join(bundle,'package.json'),JSON.stringify({name:'hub-test',version:'0.1.0',dsh:{bundle:{patch:'cordis.patch.yml'}}}));
 const rows=[{id:'llm-service',name:file('packages/llm/llm/lib/index.js')},{id:'credentials',name:file('packages/credentials/credentials-local/lib/index.js'),config:{path:join(root,'.credentials.yaml'),watch:false}},{id:'llm',name:file('packages/llm/llm-pi-ai/lib/index.js')},{id:'provider-hub',name:resolve('src/host.js')}];
 await writeFile(join(bundle,'cordis.patch.yml'),yaml.dump([{insert:rows}]));await writeFile(join(dir,'cordis.yml'),'[]\n');
 const profile={name:'test',startedBundles:['hub-test'],dir,patchPath:join(dir,'cordis.patch.yml'),installAnchor:join(root,'package.json'),cwd:root,home:root,overlays:[]};
 ctx.baseUrl=pathToFileURL(root+'/').href;await ctx.plugin(Loader);ctx.provide('profileContext',profile);await ctx.plugin(ConfigEditor);await ctx.plugin(Settings);
 await mountRootInclude(ctx,join(dir,'cordis.yml'),readProfilePatches('test',profile));await ctx.loader.await();assert.ok(ctx.get('settings'));assert.ok(ctx.get('llm'));
 const result=async fn=>{try{return{ok:true,value:await fn()};}catch(error){return{ok:false,error:{message:error.message}};}};
 const remote={settings:{describe:()=>result(()=>({writable:ctx.settings.writable,namespaces:ctx.settings.describe({redactSecrets:true})})),mutate:(...args)=>result(()=>ctx.settings.mutate(...args))},credentials:{set:(ref,key)=>result(()=>ctx.credentials.set(ref,key))},llm:{listProviders:()=>result(()=>ctx.llm.listProviders()),listConfigurableProviders:()=>result(()=>ctx.llm.listConfigurableProviders()),discoverModels:(...args)=>result(()=>ctx.llm.discoverModels(...args))}};
 const controller=new ProviderController(remote);await controller.load();const draft={...customDraft(),route:'hub-fixture',baseURL,apiKeyEnv:'DSH_HUB_FIXTURE_KEY',apiKey:'fixture-only-key'};
 const models=await controller.discover(draft);assert.equal(models[0].id,'hub-model');draft.models=models.map(m=>({id:m.id,contextWindow:m.contextWindow||32768,maxTokens:m.maxTokens||4096}));await controller.save(draft);
 assert.ok(ctx.llm.listProviders().some(p=>p.id==='hub-fixture'));const raw=await readFile(profile.patchPath,'utf8');assert.ok(raw.includes('hub-fixture'));assert.ok(!raw.includes('fixture-only-key'));assert.equal((await ctx.llm.listModels('hub-fixture'))[0].id,'hub-model');
 const assembler=new BlockAssembler();for await(const chunk of ctx.llm.stream({provider:'hub-fixture',model:'hub-model',messages:[]}))assembler.push(chunk);
 assert.equal(assembler.message({provider:'hub-fixture',model:'hub-model'}).content[0].text,'PROVIDER_HUB_OK');assert.equal(calls.at(-1).key,'Bearer fixture-only-key');assert.equal(calls.at(-1).path,'/v1/chat/completions');
 console.log('Real profile + Loader + Settings + credential store + pi-ai: discovery, provider persistence, model catalog and streamed inference passed.');
}finally{await ctx.fiber.dispose();await new Promise(r=>server.close(r));await rm(root,{recursive:true,force:true});}
