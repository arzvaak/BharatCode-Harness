import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as plugin from '../lib/index.js'

test('local fixture API, canonical ToolRuntime outputs, English failures, and disposal', async () => {
 const routes = []
 const server = createServer((req, res) => {
  routes.push(req.url)
  const url = new URL(req.url, 'http://localhost')
  res.setHeader('content-type','application/json')
  res.setHeader('Total-Results','1')
  if (url.pathname === '/connector/ping') { res.end('{}'); return }
  if (url.searchParams.get('format') === 'bibtex') { res.end('@article{ABC12345, title={Evidence}}'); return }
  if (url.pathname.endsWith('/items/ABC12345/children')) {res.end(JSON.stringify([{key:'NOTE1234',data:{itemType:'note',note:'<p>Useful <b>evidence</b></p>'}}]));return}
  if (url.pathname.endsWith('/items/ABC12345')) {res.end(JSON.stringify({key:'ABC12345',data:{itemType:'journalArticle',title:'Evidence'},meta:{}}));return}
  res.end(JSON.stringify([{key:'ABC12345', data:{itemType:'journalArticle',title:'Evidence',date:'2025',creators:[{lastName:'Researcher'}]}}]))
 })
 await new Promise(resolve => server.listen(0,'127.0.0.1',resolve))
 const ctx = new Context()
 ctx.provide('systemPrompt',{tools:()=>()=>{},section:()=>()=>{}})
 await ctx.plugin(ToolRuntime, {mode:'native'})
 const fiber = await ctx.plugin(plugin, plugin.Config({port:server.address().port}))
 const call = (name,args) => ctx.tools.execute({name,arguments:args,callId:name,signal:new AbortController().signal})
 try {
  assert.equal(ctx.tools.schemas().filter(t=>t.name.startsWith('zotero_')).length,10)
  const found = await call('zotero_search_items',{query:'Evidence'})
  assert.equal(found.isError,false,JSON.stringify(found));assert.equal(found.value.items[0].year,2025)
  assert.equal(found.value.items[0].title,'Evidence')
  const item = await call('zotero_get_item',{itemKey:'ABC12345',includeChildren:true})
  assert.equal(item.isError,false,JSON.stringify(item));assert.equal(item.value.notes[0].text,'Useful evidence')
  const bib = await call('zotero_get_bibtex',{itemKeys:['ABC12345']})
  assert.equal(bib.isError,false,JSON.stringify(bib));assert.match(bib.value.export,/@article/)
  const bad = await call('zotero_get_bibtex',{itemKeys:[]})
  assert.equal(bad.isError,true);assert.match(JSON.stringify(bad),/requires at least one/)
  assert.ok(routes.every(r=>r.startsWith('/api/users/0/')||r==='/connector/ping'))
  await fiber.dispose();assert.equal(ctx.tools.get('zotero_search_items'),undefined)
 } finally { await ctx.fiber.dispose();await new Promise(resolve=>server.close(resolve)) }
})
