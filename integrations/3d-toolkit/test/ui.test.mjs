import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp,mkdir,writeFile,readFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {build} from 'esbuild';
import {chromium} from 'playwright-core';
import {Studio,browserExecutable} from '../src/runtime.js';
import {apiHandler} from '../src/http.js';
test('native studio controls create, edit, preview, render and download both engines', {timeout:120000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bc-3d-ui-'));
  const studio=new Studio({directory});
  await studio.projects.create('other-workspace','three','Other workspace scene');
  const api=apiHandler({workspaceRegistry:{list:()=>[{id:'other-workspace',name:'Other workspace'},{id:'ui-workspace',name:'Test workspace'}]}},studio);
  const result=await build({stdin:{contents:"import React from 'react';import{createRoot}from'react-dom/client';import{StudioPage,apply}from'./src/client.jsx';apply({effect(fn){fn()},slots:{inject(){}}});createRoot(document.getElementById('root')).render(React.createElement(StudioPage,{context:{get(name){return name==='sessions'?{list:{getSnapshot:()=>({ids:['active-session'],byId:{'active-session':{id:'active-session',retainedBy:{mainView:1}}},phase:'ready'})}}:{list:{getSnapshot:()=>({items:[{workspaceId:'ui-workspace',sessionIds:['active-session']}]})}}}}}));",resolveDir:resolve(import.meta.dirname,'..'),loader:'jsx'},bundle:true,write:false,format:'iife',platform:'browser',jsx:'automatic',logLevel:'silent'});
  const server=createServer((req,res)=>{if(req.url.startsWith('/api/bc-3d'))return void api(req,res);if(req.url==='/ui.js'){res.writeHead(200,{'Content-Type':'text/javascript'});res.end(result.outputFiles[0].contents);return;}res.writeHead(200,{'Content-Type':'text/html'});res.end('<html><body><div id="root"></div><script src="/ui.js"></script></body></html>');});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const browser=await chromium.launch({executablePath:await browserExecutable(process.env.BC_3D_CHROMIUM),headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:960}});
    page.setDefaultTimeout(45000);
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    await page.waitForFunction(()=>document.querySelector('select[aria-label=Workspace]')?.options.length===2,{},{timeout:3000});
    assert.equal(await page.getByLabel('Workspace',{exact:true}).inputValue(),'ui-workspace');
    assert.equal(await page.getByRole('button',{name:/Other workspace scene/}).count(),0);
    for(const engine of ['three','babylon']) {
      await page.getByLabel('Engine',{exact:true}).selectOption(engine);
      await page.getByLabel('Scene name').fill(`UI ${engine}`);
      await page.getByRole('button',{name:'Create scene',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Scene created'}).waitFor();
      let frame=await (await page.locator('iframe').elementHandle()).contentFrame();
      assert.ok(frame);
      await frame.waitForURL(/index\.html/);
      await frame.waitForFunction(()=>window.BC3D?.ready||window.BC3D?.error);
      assert.equal(await frame.evaluate(()=>window.BC3D.error),null);
      if(!await page.locator('details').evaluate(element=>element.open)) await page.getByText('Edit scene source',{exact:true}).click();
      const source=await page.locator('textarea').inputValue();
      await page.locator('textarea').fill(source+'\n// UI edit verification\n');
      assert.equal(await page.getByRole('button',{name:'Update preview',exact:true}).isDisabled(),true);
      assert.equal(await page.getByRole('button',{name:'Render PNG',exact:true}).isDisabled(),true);
      await page.getByRole('button',{name:'Save and preview',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Saved revision 2.'}).waitFor();
      await page.getByRole('button',{name:'Update preview',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Preview built from revision 2.'}).waitFor();
      frame=await(await page.locator('iframe').elementHandle()).contentFrame();
      await page.getByLabel('Render width',{exact:true}).fill('320');
      await page.getByLabel('Render height',{exact:true}).fill('240');
      await page.getByLabel('Animation time (seconds)',{exact:true}).fill('1.25');
      await page.getByRole('button',{name:'Seek to time',exact:true}).click();
      await frame.waitForFunction(()=>window.BC3D.time===1.25);
      await page.getByRole('button',{name:'Play animation',exact:true}).click();
      await frame.waitForFunction(()=>window.BC3D.time>1.25);
      await page.getByRole('button',{name:'Pause animation',exact:true}).click();
      await frame.waitForFunction(()=>window.BC3D.playing===false);
      const pausedTime=await frame.evaluate(()=>window.BC3D.time);
      await page.waitForFunction(time=>Math.abs(Number(document.querySelector('.bc3d-playback input').value)-time)<0.00001,pausedTime,{timeout:3000});
      await page.getByRole('button',{name:'Render PNG',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Rendered revision 2'}).waitFor();
      await page.getByRole('img',{name:`UI ${engine} rendered frame`}).waitFor();
      const image=await page.getByRole('img',{name:`UI ${engine} rendered frame`}).evaluate(async element=>Array.from(new Uint8Array(await(await fetch(element.src)).arrayBuffer())));
      const png=Buffer.from(image);assert.equal(png.readUInt32BE(16),320);assert.equal(png.readUInt32BE(20),240);
      for(const format of ['glb','viewer','source',...(engine==='babylon'?['babylon']:[])]) {
        await page.getByLabel('Export format',{exact:true}).selectOption(format);
        await page.getByRole('button',{name:'Export',exact:true}).click();
        await page.getByRole('link',{name:`Download ${format}`,exact:true}).waitFor();
        const downloadPromise=page.waitForEvent('download');await page.getByRole('link',{name:`Download ${format}`,exact:true}).click();
        const download=await downloadPromise;assert.equal(await download.failure(),null);
        const bytes=await readFile(await download.path());assert.ok(bytes.length>100);
      }
      await page.getByLabel('Animation time (seconds)',{exact:true}).fill('2');
      await page.getByRole('button',{name:'Seek to time',exact:true}).click();
      await frame.waitForFunction(()=>window.BC3D.time===2);
      await page.locator('textarea').fill(source+'\n// second edit after paused animation\n');
      await page.getByRole('button',{name:'Save and preview',exact:true}).click();
      await page.getByRole('status').filter({hasText:'Saved revision 3.'}).waitFor();
      await page.getByRole('button',{name:'Pause animation',exact:true}).waitFor();
      assert.equal(await page.getByLabel('Animation time (seconds)',{exact:true}).inputValue(),'0');
      assert.equal(await page.getByRole('img',{name:`UI ${engine} rendered frame`}).count(),0);
      if(process.env.BC_3D_EVIDENCE_DIR) {
        await mkdir(process.env.BC_3D_EVIDENCE_DIR,{recursive:true});
        if(await page.locator('details').evaluate(element=>element.open)) await page.getByText('Edit scene source',{exact:true}).click();
        await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('.bc3d').scrollTop=0;document.body.style.fontFamily='system-ui, sans-serif';});
        await page.screenshot({path:join(process.env.BC_3D_EVIDENCE_DIR,`ui-${engine}.png`),fullPage:true});
      }
    }
    await page.getByLabel('Workspace',{exact:true}).selectOption('other-workspace');
    await page.getByRole('button',{name:/Other workspace scene/}).waitFor();
    assert.equal(await page.getByRole('button',{name:/UI babylon/}).count(),0);
    assert.equal(/[\u3400-\u9fff]/u.test(await page.locator('body').innerText()),false);
    assert.equal((await studio.projects.list('ui-workspace')).length,2);
  }finally{await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));await studio.close();}
});
