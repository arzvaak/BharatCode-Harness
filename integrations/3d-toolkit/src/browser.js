// This module is bundled into the generated-code origin, never executed in Node.
export function bootstrap(engine) {
  const imports = engine === 'three'
    ? `import {GLTFExporter} from 'three/addons/exporters/GLTFExporter.js';`
    : `import {GLTF2Export} from '@babylonjs/serializers/glTF'; import {SceneSerializer} from '@babylonjs/core/Misc/sceneSerializer.js';`;
  const draw = engine === 'three' ? 'value.renderer.render(value.scene, value.camera)' : 'value.scene.render()';
  const exportCode = engine === 'three'
    ? `const data = await new GLTFExporter().parseAsync(value.scene, {binary: true}); return encode(new Uint8Array(data));`
    : `if (format === 'babylon') return JSON.stringify(SceneSerializer.Serialize(value.scene)); const result = await GLTF2Export.GLBAsync(value.scene, 'scene'); return encode(new Uint8Array(await result.glTFFiles['scene.glb'].arrayBuffer()));`;
  return `${imports}
import {createScene} from 'bc-project';
const canvas = document.querySelector('canvas');
const errors = [];
let value, frame, playing = true, logicalTime = 0, playbackStarted = 0;
const report = error => { const message = String(error?.message ?? error); errors.push(message); document.querySelector('#error').textContent = message; window.BC3D.error = message; };
window.BC3D = {ready: false, error: null, errors};
window.addEventListener('error', event => report(event.error ?? event.message));
window.addEventListener('unhandledrejection', event => report(event.reason));
function encode(bytes) { let raw = ''; for(let start = 0; start < bytes.length; start += 8192) raw += String.fromCharCode(...bytes.subarray(start, start + 8192)); return btoa(raw); }
function draw(time) { logicalTime = time; window.BC3D.time = time; value.update?.(time); ${draw}; }
async function initialize() {
  // A cached app pane can mount its iframe before layout gives it any area.
  while (innerWidth < 1 || innerHeight < 1) await new Promise(requestAnimationFrame);
  const width = innerWidth, height = innerHeight;
  value = await createScene({canvas, width, height});
  if (!value?.scene || !${engine === 'three' ? 'value.camera || !value.renderer' : 'value.engine'}) throw Error('createScene returned an incomplete ${engine} runtime');
  ${engine === 'babylon' ? 'await value.scene.whenReadyAsync();' : ''}
  const resize = () => {
    if (innerWidth < 1 || innerHeight < 1) return;
    ${engine === 'three' ? `value.renderer.setSize(innerWidth, innerHeight);
    if (value.camera.isPerspectiveCamera) { value.camera.aspect = innerWidth / innerHeight; value.camera.updateProjectionMatrix(); }` : 'value.engine.setSize(innerWidth, innerHeight);'}
    if (!playing) draw(logicalTime);
  };
  resize();
  window.addEventListener('resize', resize);
  const observer = new ResizeObserver(resize);
  observer.observe(document.documentElement);
  draw(0);
  const meshes = ${engine === 'three' ? '[]; value.scene.traverse(object => {if(object.isMesh) meshes.push(object);})' : 'value.scene.meshes.filter(mesh => mesh.getTotalVertices() > 0)'};
  window.BC3D.metrics = {meshes: meshes.length, engine: '${engine}'};
  window.BC3D.step = async time => { playing = false; window.BC3D.playing = false; cancelAnimationFrame(frame); draw(time); await new Promise(requestAnimationFrame); ${draw}; if(window.BC3D.error) throw Error(window.BC3D.error); return window.BC3D.metrics; };
  window.BC3D.play = () => { if (playing) return; playing = true; window.BC3D.playing = true; playbackStarted = performance.now() - logicalTime * 1000; frame = requestAnimationFrame(loop); };
  const publishState = () => parent.postMessage({type:'bc3d-state', playing, time:logicalTime}, '*');
  window.BC3D.pause = () => { playing = false; window.BC3D.playing = false; cancelAnimationFrame(frame); publishState(); };
  window.BC3D.export = async format => { await window.BC3D.step(logicalTime); ${exportCode} };
  const onControl = event => {
    if (event.source !== parent || event.data?.type !== 'bc3d-control') return;
    if (event.data.command === 'play') window.BC3D.play();
    else if (event.data.command === 'pause') window.BC3D.pause();
    else if (event.data.command === 'seek' && Number.isFinite(event.data.time) && event.data.time >= 0 && event.data.time <= 86400) window.BC3D.step(event.data.time).then(publishState).catch(report);
  };
  window.addEventListener('message', onControl);
  window.BC3D.ready = true;
  // The opaque sandbox requires a message; no parent DOM access is granted.
  parent.postMessage({type:'bc3d-ready'}, '*');
  window.BC3D.playing = true;
  playbackStarted = performance.now();
  function loop(now) { if (!playing) return; try { draw((now - playbackStarted) / 1000); frame = requestAnimationFrame(loop); } catch(error) {report(error);} }
  frame = requestAnimationFrame(loop);
  window.addEventListener('beforeunload', () => { cancelAnimationFrame(frame); observer.disconnect(); window.removeEventListener('resize', resize); window.removeEventListener('message', onControl); value.dispose?.(); });
}
initialize().catch(report);
`;
}
export function viewerHTML(title, inlineScript) {
  const safeTitle = title.replace(/[&<>"']/g, char => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[char]));
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${safeTitle}</title><style>html,body{margin:0;width:100%;height:100%;overflow:hidden;background:#17202b}canvas{display:block;width:100%;height:100%;touch-action:none}#error{position:fixed;top:0;left:0;right:0;background:#751b27;color:white;white-space:pre-wrap;font:14px monospace;z-index:5}#error:empty{display:none}</style></head><body><canvas aria-label="3D scene"></canvas><div id="error" role="alert"></div>${inlineScript === undefined ? '<script src="app.js"></script>' : `<script>${inlineScript.replace(/<\/script/gi, '<\\/script')}</script>`}</body></html>`;
}
