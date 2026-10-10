import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import {createRequire} from 'node:module';
const require=createRequire(new URL('../../subscriptions/package.json',import.meta.url));
const React=require('react');
test('Cost Meter browser and statistics chunks register the fork package with the native loader',()=>{
 for(const filename of ['client.js','client.statistics.js']){
  let registration;runInNewContext(readFileSync(new URL('../lib/'+filename,import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:r=>registration=r}}});
  assert.equal(registration.id,'@arzvaak/bharatcode-cost-meter');assert.equal(typeof registration.factory,'function');
  const plugin=registration.factory(id=>{if(id==='react')return React;if(id==='@deepseek-ai/dsh-client-ui-primitives')return {Tooltip:()=>null};throw new Error('Unexpected native module '+id);});
  assert.ok(plugin);if(filename==='client.js')assert.equal(typeof plugin.apply,'function');else assert.equal(typeof plugin.mount,'function');
 }
});
test('Typert owns the same package identity as the installed fork',async()=>{
 const {TYPERT}=await import('../lib/typert.host.js');assert.equal(TYPERT.package,JSON.parse(readFileSync(new URL('../package.json',import.meta.url),'utf8')).name);
});
test('retained locale IDs ship identical English messages',()=>{
 const en=JSON.parse(readFileSync(new URL('../locale/en.json',import.meta.url),'utf8')),zh=JSON.parse(readFileSync(new URL('../locale/zh.json',import.meta.url),'utf8'));assert.deepEqual(zh,en);assert.ok(!/[\u3400-\u9fff]/.test(JSON.stringify(en)));
});

test('generated browser price resolver agrees with host route pricing and plan classification',async()=>{
 const {providerPriceEntryFor,DEFAULT_PRICE_TABLE,DEFAULT_PROVIDER_PRICE_TABLE}=await import('../lib/pricing.js');
 const prices={...DEFAULT_PRICE_TABLE,providers:DEFAULT_PROVIDER_PRICE_TABLE,currency:'USD'},config={prices};let registration;
 runInNewContext(readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:r=>registration=r}}});const plugin=registration.factory(id=>id==='react'?React:{Tooltip:()=>null});
 for(const [route,model]of [['openai','gpt-6.1-sol'],['anthropic','claude-sonnet-4-6'],['deepseek','deepseek-flash'],['deepseek-official','deepseek-v4-pro'],['bharatcode','gpt-6.1-sol'],['','deepseek-flash'],['openai','gpt-6.1-sol-latest'],...['codex','claude','grok','copilot','antigravity'].map(route=>[route,'gpt-6.1-sol'])]){
  const client=plugin.__testBilling.resolveClientPrice(route,model,config),host=providerPriceEntryFor(route,model,prices);assert.equal(client.priced,host.priced,route+':'+model);if(host.priced){assert.equal(client.entry.cacheMiss,host.entry.cacheMiss);assert.equal(client.entry.output,host.entry.output);}
 }
 for(const route of ['codex','claude','grok','copilot','antigravity'])assert.equal(plugin.__testBilling.billingClassOfLocal(route,'gpt-6.1-sol',config),'plan');
});

test('fork defaults show token usage in USD without tours or unrelated official provider widgets',async()=>{
 const {defaultConfig}=await import('../lib/store.js');const config=defaultConfig();assert.equal(config.currency,'USD');assert.equal(config.symbol,'$');assert.equal(config.exchangeRate,1);assert.equal(config.sidebarTodayMetric,'tokens');assert.equal(config.goQuota.enabled,false);assert.equal(config.hideOfficialBalance,true);assert.equal(config.peakNotice,false);assert.equal(config.peakAlertEnabled,false);assert.equal(config.sidebarSimplePromptSeen,true);assert.equal(config.quotaStrip.promptSeen,true);
 const source=readFileSync(new URL('../lib/client.js',import.meta.url),'utf8');assert.ok(!source.includes('cost-meter-simple-guide'));assert.ok(!source.includes('cost-meter-qstrip-guide'));assert.ok(!source.includes('cost-meter-balance-click-guide'));let registration;runInNewContext(source,{window:{__ModuleLoader__:{load:r=>registration=r}}});const plugin=registration.factory(id=>id==='react'?React:{Tooltip:()=>null});const helpers=plugin.__testBilling;
 assert.equal(helpers.peakNoticeEl({},config,()=>''),null);assert.equal(helpers.peakNoticeRailEl({},config,()=>''),null);
 assert.equal(helpers.estimatedUsageAmount(0,{byProviderModel:{'bharatcode:gpt-6.1-sol':{input:1000,output:1000}}},config),'price unavailable');
 assert.match(helpers.estimatedUsageAmount(2,{byProviderModel:{'bharatcode:gpt-6.1-sol':{input:1000,output:1000},'openai:gpt-6.1-sol':{input:1000,output:1000}}},config),/unpriced usage/);
});
