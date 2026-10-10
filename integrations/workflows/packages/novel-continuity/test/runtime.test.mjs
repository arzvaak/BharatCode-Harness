import {test} from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {Context} from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as plugin from '../lib/index.js'
test('versioned project, chapter, context, lorebook, audit and disposal through real tools',async()=>{
 const root=await mkdtemp(join(tmpdir(),'bharatcode-novel-'));const ctx=new Context()
 ctx.provide('systemPrompt',{tools:()=>()=>{},section:()=>()=>{}});await ctx.plugin(ToolRuntime,{mode:'native'})
 const fiber=await ctx.plugin(plugin,plugin.Config({dataDir:root}))
 async function call(name,args){const result=await ctx.tools.execute({name,arguments:args,callId:name,signal:new AbortController().signal});assert.equal(result.isError,false,JSON.stringify(result));assert.doesNotMatch(JSON.stringify(result),/\p{Script=Han}/u);return result.value}
 try{
  const created=await call('novel_create_project',{title:'Evidence Story'});assert.equal(created.ok,true);const id=created.value.id
  const blocked=await call('novel_phase',{projectId:id,phase:'writing'});assert.equal(blocked.ok,false);assert.equal(blocked.error.code,'INVALID_STATE')
  const lore=await call('lorebook_create_entry',{name:'Mira',content:'Mira is a botanist.',keywords:'Mira',book_id:id});assert.equal(lore.ok,true)
  const chapter=await call('novel_commit_chapter',{projectId:id,chapterNo:1,title:'The Garden',text:'Mira walked into the garden.',brief:'Mira enters the garden.'});assert.equal(chapter.ok,true);assert.equal(chapter.value.chapter.no,1)
  const context=await call('novel_write_chapter',{projectId:id,chapterNo:2,brief:'Mira returns.'});assert.equal(context.ok,true);assert.ok(context.value.prevChapters.length)
  const stats=await call('novel_stats',{projectId:id});assert.equal(stats.ok,true)
  const audit=await call('novel_audit',{projectId:id});assert.equal(audit.ok,true);assert.ok(audit.value.length>=2)
  await fiber.dispose();assert.equal(ctx.tools.get('novel_projects'),undefined)
 }finally{await ctx.fiber.dispose();await rm(root,{recursive:true,force:true})}
})
