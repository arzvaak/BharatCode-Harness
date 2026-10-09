import {test} from 'node:test'
import assert from 'node:assert/strict'
import {Context} from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as plugin from '../lib/types/index.js'
test('upstream reading engine registers in real ToolRuntime, estimates without model, and reports in English',async()=>{
 const ctx=new Context();const requests=[]
 ctx.provide('systemPrompt',{tools:()=>()=>{},section:()=>()=>{}})
 ctx.provide('fs',{resolve:p=>p,readText:async()=> 'Local evidence: study sample size was 40.\n\nThe observed gain was 12 percent.'})
 ctx.provide('llm',{listProviders:()=>[{id:'fixture'}],listModels:()=>['fixture-model'],async *stream(options){requests.push(options);yield {type:'text-delta',text:JSON.stringify({title:'Evidence report',summary:'Observed evidence from a local fixture.',thesis:'The study reports a measured gain.',arguments:[{claim:'12 percent gain',evidence:'Sample of 40',quote:'observed gain was 12 percent',source:'paragraph 2'}],quotes:[],concepts:[],questions:['Does the sample represent the population?'],structure:[]})};yield {type:'finish'}}})
 ctx.provide('web',{fetch:async()=>{throw new Error('No external requests permitted')}})
 ctx.provide('agentDefaultModel',{currentSelection:()=>({provider:'fixture',model:'fixture-model'})});ctx.provide('sandboxPolicy',{})
 await ctx.plugin(ToolRuntime,{mode:'native'});const fiber=await ctx.plugin(plugin,plugin.Config({}));const call=args=>ctx.tools.execute({name:'deepread',arguments:args,callId:'reading',signal:new AbortController().signal})
 try{
 assert.ok(ctx.tools.get('deepread'))
 const estimate=await call({text:'A local source. '.repeat(100),estimate:true,depth:'deep'});assert.equal(estimate.isError,false,JSON.stringify(estimate));assert.equal(estimate.value.kind,'estimate');assert.equal(requests.length,0)
 const quick=await call({path:'/fixture.txt',depth:'quick'});assert.equal(quick.isError,false,JSON.stringify(quick));assert.equal(quick.value.title,'Evidence report');assert.ok(requests.length>0)
 const book=await call({text:'The sample size was forty. '.repeat(200),depth:'book'});assert.equal(book.isError,false,JSON.stringify(book));assert.equal(book.value.meta.depth,'book')
 const invalid=await call({text:'Source',depth:'feynman'});assert.equal(invalid.isError,true)
 for(const request of requests)assert.doesNotMatch(JSON.stringify(request),/\p{Script=Han}/u)
 assert.doesNotMatch(JSON.stringify(quick.value),/\p{Script=Han}/u)
 await fiber.dispose();assert.equal(ctx.tools.get('deepread'),undefined)
 }finally{await ctx.fiber.dispose()}
})
