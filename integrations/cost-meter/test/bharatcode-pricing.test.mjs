import {test} from 'node:test';
import assert from 'node:assert/strict';
import {providerPriceEntryFor,costOf,DEFAULT_PROVIDER_PRICE_TABLE,DEFAULT_PRICE_TABLE} from '../lib/pricing.js';
import {billingClassOf} from '../lib/plan-billing.js';
const prices={...DEFAULT_PRICE_TABLE,providers:DEFAULT_PROVIDER_PRICE_TABLE,currency:'USD'};
test('direct API prices use the exact route and model, including cached usage',()=>{
 const sol=providerPriceEntryFor('openai','gpt-6.1-sol',prices);assert.equal(sol.priced,true);assert.equal(costOf({input:100000,output:100000,cacheRead:100000,cacheWrite:0,reasoning:0},sol.entry),1.21);
 const sonnet=providerPriceEntryFor('anthropic','claude-sonnet-4-6',prices);assert.equal(costOf({input:1e6,output:1e6,cacheRead:1e6,cacheWrite:0,reasoning:0},sonnet.entry),18.3);
 const long=costOf({input:300000,output:100000,cacheRead:0,cacheWrite:0,reasoning:0},sol.entry);assert.equal(long,2.7);
});
test('custom, missing, foreign and unknown routes never borrow a model price',()=>{
 for(const [provider,model]of [['','gpt-6.1-sol'],['bharatcode','gpt-6.1-sol'],['lmstudio','gpt-6.1-sol'],['anthropic','gpt-6.1-sol'],['openai','gpt-6.1-sol-latest'],['custom-deepseek','deepseek-flash'],['openai','unknown-model']])assert.equal(providerPriceEntryFor(provider,model,prices,{mode:'auto'}).priced,false,provider+':'+model);
});
test('subscription quota remains separate from API charges for all five adapters',()=>{
 for(const provider of ['codex','claude','grok','copilot','antigravity']){assert.equal(providerPriceEntryFor(provider,'gpt-6.1-sol',prices).reason,'subscription');assert.equal(billingClassOf(provider,'gpt-6.1-sol',{},new Set(),prices),'plan');}
});
test('unknown provider prices remain configurable by exact route or explicit mapping',()=>{
 const custom={...prices,providers:{...prices.providers,bharatcode:{models:{'custom-model':{input:7,output:9}}}}};assert.equal(providerPriceEntryFor('bharatcode','custom-model',custom).entry.cacheMiss,7);
 const mapped=providerPriceEntryFor('bharatcode','gpt-6.1-sol',prices,{overrides:{'bharatcode:gpt-6.1-sol':'openai:gpt-6.1-sol'}});assert.equal(mapped.priced,true);
});
test('official DeepSeek Pro keeps its own tariff, Flash aliases use Flash tariff',()=>{
 const pro=providerPriceEntryFor('deepseek','deepseek-v4-pro',prices);assert.equal(pro.entry.cacheMiss,.66);assert.equal(pro.entry.output,1.98);
 const flash=providerPriceEntryFor('deepseek','deepseek-flash',prices);assert.equal(flash.entry.cacheMiss,.15);assert.equal(flash.entry.output,.6);
});

test('ledger saves route-specific API charges and subscription tokens without fabricating charges',async()=>{
 const {mkdtempSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {Ledger}=await import('../lib/store.js');
 const home=mkdtempSync(join(tmpdir(),'bharatcode-cost-fixture-'));const saved=process.env.DSH_HOME;process.env.DSH_HOME=home;let ledger;
 try{
  ledger=Ledger.open();assert.ok(ledger.path.startsWith(home));ledger.config.currency='USD';ledger.config.prices=prices;
  ledger.account({input:100000,output:100000,cacheRead:100000},'gpt-6.1-sol','api-fixture',Date.now(),'openai');
  ledger.account({input:100000,output:100000},'gpt-6.1-sol','unknown-fixture',Date.now(),'bharatcode');
  for(const route of ['codex','claude','grok','copilot','antigravity'])ledger.account({input:1000,output:2000},'gpt-6.1-sol',route+'-fixture',Date.now(),route);
  const today=ledger.today();assert.equal(today.apiCost,1.21);assert.equal(today.cost,1.21);assert.equal(today.byProviderModel['codex:gpt-6.1-sol'].apiCost,0);assert.equal(today.byProviderModel['codex:gpt-6.1-sol'].input,1000);assert.equal(today.byProviderModel['bharatcode:gpt-6.1-sol'].cost,0);
  ledger.close();ledger=null;const reopened=Ledger.open();assert.equal(reopened.today().apiCost,1.21);reopened.close();
 }finally{ledger?.close();if(saved===undefined)delete process.env.DSH_HOME;else process.env.DSH_HOME=saved;rmSync(home,{recursive:true,force:true});}
});
