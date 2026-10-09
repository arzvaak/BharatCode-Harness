import { build } from 'esbuild';
import { createRequire } from 'node:module';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { examples } from '../src/examples.js';
import { diagramExamples } from '../src/diagram-examples.js';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const requireDesktop = createRequire(join(root, '../../apps/desktop/package.json'));
const electron = requireDesktop('electron');
const directory = await mkdtemp(join(tmpdir(), 'bc-graphics-harness-'));
try {
  const entry = join(directory, 'entry.js');
  await writeFile(entry, `import * as React from ${JSON.stringify(join(root,'node_modules/react/index.js'))};
import {createRoot} from ${JSON.stringify(join(root,'node_modules/react-dom/client.js'))};
const chunks=new Map();
const localRequire=name=>{if(name!=='react')throw Error('Unexpected external module');return React};
localRequire.async=async spec=>{
  if(spec!=='./client.mermaid.js')throw Error('Unexpected local chunk');
  if(!chunks.has(spec))await new Promise((resolve,reject)=>{const script=document.createElement('script');script.src='/client.mermaid.js';script.onload=resolve;script.onerror=()=>reject(Error('Local diagram module unavailable'));document.head.append(script)});
  return chunks.get(spec);
};
window.__ModuleLoader__={load(record){
  if(record.chunk){if(record.id!=='@local/dsh-visuals'||record.chunk!=='client.mermaid.js')throw Error('Unexpected chunk identity');chunks.set('./'+record.chunk,record.factory(localRequire));return;}
  const client=record.factory(localRequire);
  const dispose=[];
  const locale={register:()=>()=>{},bind:()=>key=>({gallery:'Visuals',galleryIntro:'Offline core',source:'Source',copy:'Copy source',copied:'Copied',export:'Export SVG',data:'View data'}[key]||key),subscribe:()=>()=>{},getSnapshot:()=>({revision:0})};
  const slots={entries:()=>[],subscribe:()=>()=>{},register(options,Component){if(options.id==='visuals')createRoot(document.getElementById('root')).render(React.createElement(Component));return()=>{}},inject(_name,fn){dispose.push(fn())}};
  client.apply({locale,slots,effect:fn=>dispose.push(fn())});
}};`);
  const harness = join(directory, 'harness.js');
  const expected = join(directory, 'expected.json');
  await writeFile(expected, JSON.stringify({ chart: examples[0].source, diagram: diagramExamples[0].source }));
  await build({ entryPoints: [entry], outfile: harness, bundle: true, platform: 'browser', format: 'iife', define: { 'process.env.NODE_ENV': '"production"' }, target: 'es2022' });
  const child = spawn(electron, [...(process.platform === 'linux' ? ['--ozone-platform=x11'] : []), join(root, 'scripts/native-export.cjs')], {
    stdio: 'inherit', env: { ...process.env, WAYLAND_DISPLAY: '', BC_VISUALS_HARNESS: harness, BC_VISUALS_EXPECTED: expected, BC_VISUALS_PROFILE: join(directory, 'profile') },
  });
  const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  if (code !== 0) throw Error('Native graphics qualification failed: ' + code);
} finally { await rm(directory, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
