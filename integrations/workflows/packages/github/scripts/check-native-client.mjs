import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {createRequire} from 'node:module'
import {runInNewContext} from 'node:vm'
import {Context} from '@deepseek-ai/cordis'
import {SlotRegistry} from '../node_modules/@deepseek-ai/dsh-client-ui-renderer/lib/types/client/registry.js'
const ctx=new Context();new SlotRegistry(ctx)
ctx.slots.register({name:'root',children:{'settings.section':{kind:'list',scope:'root'}}},()=>null)
ctx.provide('locale',{bind:()=>key=>key,register:()=>()=>{}})
ctx.provide('connection',{})
ctx.provide('remote',{$on:()=>()=>{},credentials:{describe:async()=>({ok:true,value:{GITHUB_TOKEN:{configured:false,writable:true}}}),set:async()=>{}}})
ctx.provide('remote.credentials',ctx.remote.credentials)
let plugin;const require=createRequire(import.meta.url)
runInNewContext(await readFile(new URL('../lib/client.js',import.meta.url),'utf8'),{window:{__ModuleLoader__:{load:({factory})=>{plugin=factory(id=>id==='@deepseek-ai/dsh-client-ui-primitives'?{Button:()=>null,IconLoadingOutlineRegular:()=>null}:require(id))}}}})
try{for(let cycle=0;cycle<2;cycle++){const fiber=await ctx.plugin(plugin);await new Promise(setImmediate);const entries=ctx.slots.entries('settings.section');assert.equal(entries.length,1);assert.equal(entries[0].options.id,'dsh-github');await fiber.dispose();assert.equal(ctx.slots.entries('settings.section').length,0)}console.log('PASS GitHub native settings section activation/disposal/reactivation')}finally{await ctx.fiber.dispose()}
