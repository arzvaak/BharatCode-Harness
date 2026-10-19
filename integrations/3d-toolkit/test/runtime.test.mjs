import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { unzipSync } from 'fflate';
import { ProjectStore } from '../src/projects.js';
import { Studio, browserExecutable } from '../src/runtime.js';
import {chromium} from 'playwright-core';

const temporary = () => mkdtemp(join(tmpdir(), 'bc-3d-test-'));
test('editable projects persist, preserve revisions, and enforce workspace ownership', async () => {
  const root = await temporary(), store = new ProjectStore(root);
  const p = await store.create('workspace-a', 'three', 'Red sculpture');
  assert.equal(p.revision, 1);
  assert.match(p.source, /createScene/);
  const updated = await store.update('workspace-a', p.id, 'three', {source: p.source.replace('0xef6a45', '0x3366ff'), expectedRevision: 1});
  assert.equal(updated.revision, 2);
  assert.equal((await new ProjectStore(root).get('workspace-a', p.id, 'three')).source, updated.source);
  await assert.rejects(store.get('workspace-b', p.id, 'three'), /not found/i);
  await assert.rejects(store.get('workspace-a', p.id, 'babylon'), /engine/i);
  await assert.rejects(store.update('workspace-a', p.id, 'three', {source: p.source, expectedRevision: 1}), /revision/i);
  assert.equal((await store.list('workspace-a')).length, 1);
});
test('rejects traversal, symlinks, oversized source and malformed identifiers', async () => {
  const root = await temporary(), store = new ProjectStore(root);
  await assert.rejects(store.get('a', '../escape', 'three'), /id/i);
  await assert.rejects(store.create('a', 'unknown', 'x'), /engine/i);
  const p = await store.create('a', 'three', 'x');
  await assert.rejects(store.update('a', p.id, 'three', {source: 'x'.repeat(1024 * 1024 + 1), expectedRevision: 1}), /source/i);
  const target = await temporary();
  await mkdir(join(target, 'fake'));
  await symlink(target, join(root, 'linked'));
  await assert.rejects(new ProjectStore(join(root, 'linked')).create('a', 'three', 'escape'), /symlink/i);
});
for (const engine of ['three', 'babylon']) test(`${engine} creates actual pixels and valid exports from editable source`, {timeout: 120000}, async () => {
  const studio = new Studio({directory: await temporary(), browserPath: process.env.BC_3D_CHROMIUM});
  try {
    const p = await studio.projects.create('a', engine, 'Real render');
    const preview = await studio.preview('a', p.id, engine);
    const page = await fetch(preview.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /connect-src 'none'/);
    const capture = await studio.render('a', p.id, engine, {width: 640, height: 480, time: 0});
    assert.ok(capture.bytes.length > 4000);
    assert.ok(capture.metrics.meshes > 0);
    assert.equal(capture.revision, 1);
    const glb = await studio.export('a', p.id, engine, {format: 'glb'});
    const buffer = await readFile(glb.path);
    assert.equal(buffer.readUInt32LE(0), 0x46546c67);
    assert.equal(buffer.readUInt32LE(4), 2);
    assert.equal(buffer.readUInt32LE(8), buffer.length);
    const jsonLength = buffer.readUInt32LE(12);
    const document = JSON.parse(buffer.subarray(20, 20 + jsonLength).toString());
    assert.ok(document.meshes.length > 0);
    for (const format of ['source', 'viewer']) {
      const exported = await studio.export('a', p.id, engine, {format});
      const files = unzipSync(await readFile(exported.path));
      assert.ok(files['project.json']);
      assert.ok(files['scene.tsx']);
      if (format === 'viewer') {
        assert.ok(files['index.html']); assert.ok(files['app.js']);
        const {writeFile}=await import('node:fs/promises');
        const directory=await temporary(); await writeFile(join(directory,'index.html'),files['index.html']);
        const browser=await chromium.launch({executablePath:await browserExecutable(process.env.BC_3D_CHROMIUM),headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
        try {
          const page=await browser.newPage();
          await page.goto(`file://${join(directory,'index.html')}`);
          await page.waitForFunction(()=>window.BC3D?.ready||window.BC3D?.error);
          assert.equal(await page.evaluate(()=>window.BC3D.error),null);
          assert.ok((await page.evaluate(()=>window.BC3D.metrics)).meshes>0);
        }finally{await browser.close();}
      }
    }
    if (engine === 'babylon') {
      const native = await studio.export('a', p.id, engine, {format: 'babylon'});
      assert.ok(JSON.parse(await readFile(native.path, 'utf8')).meshes.length > 0);
    }
    const result = await studio.projects.update('a', p.id, engine, {source: 'export function createScene() { throw Error("deliberate failure"); }', expectedRevision: 1});
    assert.equal(result.revision, 2);
    await assert.rejects(studio.render('a', p.id, engine, {width: 320, height: 240}), /deliberate failure/);
  } finally { await studio.close(); }
});
test('generated imports cannot read Node files and preview origins reject unauthenticated paths',async()=>{
  const studio=new Studio({directory:await temporary()});
  try{
    const p=await studio.projects.create('a','three','Boundary');
    const preview=await studio.preview('a',p.id,'three');
    assert.equal((await fetch(new URL('/index.html',preview.url))).status,404);
    assert.equal((await fetch(new URL('project.json',preview.url))).status,404);
    await studio.projects.update('a',p.id,'three',{expectedRevision:1,source:"import fs from 'node:fs'; export function createScene() { return fs.readFileSync('/etc/passwd'); }"});
    await assert.rejects(studio.preview('a',p.id,'three'),/Unsupported import/);
  }finally{await studio.close();}
});
test('unloading during an active scene operation aborts it and leaves no preview server',async()=>{
  const studio=new Studio({directory:await temporary()});
  const p=await studio.projects.create('a','babylon','Unload');
  const pending=studio.preview('a',p.id,'babylon');
  await studio.close();
  await assert.rejects(pending,/abort|closed/i);
  assert.equal(studio.activeBrowsers.size,0);
  assert.ok(!studio.server.server?.listening);
});
test('render cancellation and invalid dimensions fail without a leaked browser', async () => {
  const studio = new Studio({directory: await temporary(), browserPath: process.env.BC_3D_CHROMIUM});
  try {
    const p = await studio.projects.create('a', 'three', 'cancel');
    await assert.rejects(studio.render('a', p.id, 'three', {width: 99999}), /dimension/i);
    const signal = AbortSignal.abort();
    await assert.rejects(studio.render('a', p.id, 'three', {signal}), /abort/i);
    assert.equal(studio.activeBrowsers.size, 0);
  } finally { await studio.close(); }
});
test('editable source exports preserve unfinished code without requiring compilation',async()=>{
  const studio=new Studio({directory:await temporary()});
  try{
    const source='export async function createScene( {';
    const project=await studio.projects.create('a','three','Unfinished project',source);
    const result=await studio.export('a',project.id,'three',{format:'source'});
    const files=unzipSync(await readFile(result.path));
    assert.equal(new TextDecoder().decode(files['scene.tsx']),source);
    assert.equal(JSON.parse(new TextDecoder().decode(files['project.json'])).revision,1);
    assert.equal(studio.server.server,undefined);
  }finally{await studio.close();}
});
test('module-scope scene exceptions report the actual error instead of waiting for readiness',async()=>{
  const studio=new Studio({directory:await temporary()});
  const abort=new AbortController();const timeout=setTimeout(()=>abort.abort(Error('Test readiness deadline')),10000);
  try{
    const project=await studio.projects.create('a','three','Module failure','throw Error("module scope failure"); export function createScene() {}');
    await assert.rejects(studio.render('a',project.id,'three',{signal:abort.signal}),/module scope failure/);
  }finally{clearTimeout(timeout);await studio.close();}
});
