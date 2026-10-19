import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {Studio,browserExecutable} from '../src/runtime.js';

for(const engine of ['three','babylon']) test(`${engine} preview survives a zero-size mount and follows the visible viewport`, {timeout:30000}, async()=>{
  const studio=new Studio({directory:await mkdtemp(join(tmpdir(),'bc-3d-preview-'))});
  const project=await studio.projects.create('preview-workspace',engine,'Deferred layout');
  const preview=await studio.preview('preview-workspace',project.id,engine);
  const server=createServer((_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<iframe sandbox="allow-scripts allow-pointer-lock" style="width:0;height:0;border:0" src="${preview.url}"></iframe>`);});
  await new Promise(done=>server.listen(0,'127.0.0.1',done));
  const browser=await chromium.launch({executablePath:await browserExecutable(process.env.BC_3D_CHROMIUM),headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try {
    const page=await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.address().port}`);
    const frame=await(await page.locator('iframe').elementHandle()).contentFrame();
    await frame.waitForFunction(()=>window.BC3D);
    assert.deepEqual(await frame.evaluate(()=>[innerWidth,innerHeight]),[0,0]);
    await page.locator('iframe').evaluate(element=>{element.style.width='600px';element.style.height='360px';});
    await frame.waitForFunction(()=>window.BC3D.ready&&document.querySelector('canvas').width===600&&document.querySelector('canvas').height===360,{},{timeout:7000});
    assert.deepEqual(await frame.evaluate(()=>{const {width,height}=document.querySelector('canvas').getBoundingClientRect();return [width,height];}),[600,360]);
    assert.equal(await frame.evaluate(()=>window.BC3D.error),null);
    assert.ok((await frame.evaluate(()=>window.BC3D.metrics.meshes))>0);
    await frame.evaluate(()=>window.BC3D.step(1.25));
    await page.locator('iframe').evaluate(element=>{element.style.width='800px';element.style.height='400px';});
    await frame.waitForFunction(()=>document.querySelector('canvas').width===800&&document.querySelector('canvas').height===400,{},{timeout:3000});
    assert.deepEqual(await frame.evaluate(()=>{const {width,height}=document.querySelector('canvas').getBoundingClientRect();return [width,height];}),[800,400]);
    await frame.waitForFunction(()=>{const gl=document.querySelector('canvas').getContext('webgl2');const pixel=new Uint8Array(4);gl.readPixels(0,0,1,1,gl.RGBA,gl.UNSIGNED_BYTE,pixel);return pixel[3]===255;},{},{timeout:3000});
    assert.equal(await frame.evaluate(()=>window.BC3D.time),1.25);
  } finally {await browser.close();server.closeAllConnections();await new Promise(done=>server.close(done));await studio.close();}
});
