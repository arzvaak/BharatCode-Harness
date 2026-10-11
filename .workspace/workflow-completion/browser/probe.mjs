import { createRequire } from 'node:module';
const { chromium } = createRequire(new URL('../../../apps/web/package.json', import.meta.url))('playwright');
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
const page=await browser.newPage({viewport:{width:1280,height:900}});const errors=[];const workers=[];const navigations=[];page.on('request',r=>{if(r.url().includes('/navigation-probe'))navigations.push(r.url())});page.on('pageerror',e=>errors.push(e.message));page.on('worker',w=>workers.push(w.url()));
try{
await page.goto('http://127.0.0.1:5193');
await page.locator('.monaco-editor').waitFor();
await page.frameLocator('iframe').frameLocator('iframe').locator('#state[data-opaque=yes]').waitFor();
assert.equal(await page.locator('body').getAttribute('data-called'),'render');
assert.equal(await page.locator('body').getAttribute('data-escaped'),null);
assert.match(await page.frameLocator('iframe').frameLocator('iframe').locator('#state').getAttribute('data-forbidden'),/not allowed/);
const source=await page.locator('#prose-state').textContent();assert.equal(source,'# Title\n\nA **bold** sentence.\n');
await page.getByRole('textbox',{name:'Prose',exact:true}).click();await page.keyboard.press('Control+End');await page.keyboard.type(' Added.');
await page.waitForFunction(()=>document.querySelector('#prose-state').textContent.includes('Added.'));
await page.locator('.monaco-editor .view-lines').click({position:{x:60,y:10}});await page.keyboard.press('Control+End');await page.keyboard.type('// browser edit');await page.keyboard.press('Control+s');
await page.waitForFunction(()=>document.querySelector('#code-state').textContent.includes('// browser edit'));
assert.equal(await page.locator('body').getAttribute('data-saved'),'yes');
await page.evaluate(()=>globalThis.MonacoEnvironment.getWorker(null,'editorWorkerService'));
await page.waitForTimeout(100);
assert.equal(await page.locator('#error').textContent(),'');assert.deepEqual(errors,[]);assert.ok(workers.length>0,'Monaco worker started');
await page.screenshot({path:'.workspace/workflow-completion/browser.png',fullPage:true});await page.frameLocator('iframe').frameLocator('iframe').locator('#state').evaluate(()=>{location.href='http://127.0.0.1:5193/navigation-probe'});await page.waitForTimeout(100);assert.deepEqual(navigations,[]);console.log(JSON.stringify({passed:true,monacoWorkers:workers.length,checks:['Monaco edits/save/worker','Lexical exact mount and content edit','MCP Apps negotiation/tool bridge','foreign tool rejection','opaque origin isolation','app self-navigation denied'],errors}));
}finally{await browser.close()}
