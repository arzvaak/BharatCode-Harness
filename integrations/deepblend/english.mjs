import {readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const COPY=JSON.parse(await readFile(new URL('./english-copy.json',import.meta.url),'utf8'));
const entries=Object.entries(COPY).sort((a,b)=>b[0].length-a[0].length);
const CONTRACT_COPY=JSON.parse(await readFile(new URL('./english-contract-copy.json',import.meta.url),'utf8'));
export function patchContracts(source) {
  if(!source.includes('export function buildQaView') || !source.includes('export function describeJobForHuman')) throw Error('Expected pinned DeepBlend display contracts');
  for(const [original,english] of Object.entries(CONTRACT_COPY).sort((a,b)=>b[0].length-a[0].length)) source=source.split(original).join(english);
  return source;
}
export function englishText(value) {
  if(typeof value!=='string') return value;
  for(const [original,english] of entries) value=value.split(original).join(english);
  return value;
}
export function translateRecipe(value) {
  if(typeof value==='string') return englishText(value);
  if(Array.isArray(value)) return value.map(translateRecipe);
  if(value&&typeof value==='object') return Object.fromEntries(Object.entries(value).map(([key,item])=>[key,translateRecipe(item)]));
  return value;
}
function replaceOnce(source,original,replacement) {
  if(source.includes(replacement)) return source;
  if(source.split(original).length!==2) throw Error(`Expected one upstream anchor: ${original.slice(0,100)}`);
  return source.replace(original,replacement);
}
export function patchClient(source) {
  source=replaceOnce(source,`      const named = typeof document === 'undefined' ? '' : String(document.documentElement?.lang ?? '')\n      const key = named.toLowerCase().split('-')[0]\n      return Object.prototype.hasOwnProperty.call(STRINGS, key) ? key : 'en'`,`      return 'en' // BharatCode English edition`);
  source=replaceOnce(source,"profile: 'preview' },","profile: 'final' },");
  source=replaceOnce(source,"el('h4', null, t('jobs.startDelivery')),",`el('h4', null, t('jobs.startDelivery')),
          el('p', { className: 'db-muted', 'data-delivery-scope': true }, state.selected?.scene?.project
            ? 'Full project range: ' + state.selected.scene.project.frameStart + '–' + state.selected.scene.project.frameEnd + ' at ' + state.selected.scene.project.fps + ' fps (' + (state.selected.scene.project.frameEnd - state.selected.scene.project.frameStart + 1) + ' frames). Leave both range fields empty to render every frame. Final is the delivery profile. A still preview is not an animation.'
            : 'Full project range is used when both range fields are empty. Final is the delivery profile.'),`);
  source=source.replaceAll(' · 缺失 ', ' · missing ').replaceAll(' · 损坏 ', ' · corrupt ').replaceAll('} 分`','} points`');
  source=replaceOnce(source,'out.push(item)',"out.push(typeof item === 'string' ? englishRecipeText(item) : item)");
  if(!source.includes('const BC_ENGLISH_COPY =')) {
    const helper=`const deliveryVideo = ${deliveryVideo.toString()};\n    const BC_ENGLISH_COPY = ${JSON.stringify(entries)};\n    function englishRecipeText(value) { for (const [original, english] of BC_ENGLISH_COPY) value = value.split(original).join(english); return value; }\n    `;
    source=replaceOnce(source,'function flatten(list) {',helper+'function flatten(list) {');
  }
  const oldVideo="job.delivery ? el('div', { className: 'db-muted db-mono' }, `video ${job.delivery.videoPath || ''}`) : null,";
  if(source.includes(oldVideo)) source=replaceOnce(source,oldVideo,`deliveryVideo(state.activeProjectId, job) ? el('div', { 'data-animation-delivery': job.jobId },
                el('video', { controls: true, preload: 'metadata', 'aria-label': 'Rendered animation ' + job.jobId, style: { width: '100%', maxHeight: '420px' }, src: deliveryVideo(state.activeProjectId, job) }),
                el('a', { href: deliveryVideo(state.activeProjectId, job), download: job.jobId + '.mp4' }, 'Download animation MP4'))
                : job.delivery ? el('div', { className: 'db-muted db-mono' }, 'Delivery verification pending') : null,`);
  const oldCard="job.delivery ? h('div', { className: 'db-muted db-mono' }, String(job.delivery.videoPath || '')) : null,";
  if(source.includes(oldCard)) source=replaceOnce(source,oldCard,`deliveryVideo(projectId, job) ? h('div', { 'data-animation-delivery': job.jobId },
            h('video', { controls: true, preload: 'metadata', 'aria-label': 'Rendered animation ' + job.jobId, style: { width: '100%', maxHeight: '420px' }, src: deliveryVideo(projectId, job) }),
            h('a', { href: deliveryVideo(projectId, job), download: job.jobId + '.mp4' }, 'Download animation MP4')) : null,`);
  const oldElement="return { tag, props: props === null || props === undefined ? {} : props, children: flatten(children) }";
  if(source.includes(oldElement)) source=replaceOnce(source,oldElement,`const attributes = { ...(props || {}) };
      for (const name of ['aria-label', 'title', 'placeholder']) if (typeof attributes[name] === 'string') attributes[name] = englishRecipeText(attributes[name]);
      return { tag, props: attributes, children: flatten(children) }`);
  return source;
}
export function deliveryVideo(projectId,job) {
  if(!projectId || !/^render-\d+$/.test(job?.jobId??'') || job.delivery?.verified!==true || !/^[a-f0-9]{64}$/.test(job.delivery?.sha256??'')) return null;
  const id=job.jobId;
  return `/deepblend/artifacts/${encodeURIComponent(projectId)}/renders/${id}/encoded/${id}.mp4?v=${job.delivery.sha256.slice(0,12)}`;
}
export async function adaptEnglish(root) {
  const base=join(root,'node_modules/@deepblend');
  const changes=new Map();
  const bundleClient=patchClient(await readFile(join(root,'lib/client.js'),'utf8'));
  const load=async relative=>readFile(join(base,relative),'utf8');
  changes.set('dsh-blender-contracts/lib/ui-api.js',patchContracts(await load('dsh-blender-contracts/lib/ui-api.js')));
  changes.set('dsh-blender-ui/lib/client.js',patchClient(await load('dsh-blender-ui/lib/client.js')));
  let host=await load('dsh-blender-ui/lib/index.js');
  host=host.replaceAll('DeepBlend 工作台未能启动：','DeepBlend workbench could not start: ').replaceAll("'DeepBlend 工作台'","'DeepBlend workbench'");
  changes.set('dsh-blender-ui/lib/index.js',host);
  for(const name of ['glass-ceramic','glazed-cup','metal-lamp','modular-speaker']) {
    const prefix=`dsh-blender-host/recipes/${name}/`;
    const scene=JSON.parse(await load(prefix+'scene-spec.json'));
    const originalBytes=await load(prefix+'scene-spec.json');
    const translated=translateRecipe(scene);
    const sceneBytes=JSON.stringify(translated,null,2)+'\n';
    const recipe=translateRecipe(JSON.parse(await load(prefix+'recipe.json')));
    const oldHash=createHash('sha256').update(originalBytes).digest('hex');
    if(recipe.input.sha256!==oldHash) throw Error(`Recipe scene hash mismatch: ${name}`);
    recipe.input.sha256=createHash('sha256').update(sceneBytes).digest('hex');
    changes.set(prefix+'scene-spec.json',sceneBytes);
    changes.set(prefix+'recipe.json',JSON.stringify(recipe,null,2)+'\n');
  }
  for(const [name,description] of [['deepblend','Create and refine editable Blender models with DeepSeek. Inspect real previews, adjust dimensions, preserve revisions, and deliver complete renders and animations.'],['deepblend-dev','Develop and debug DeepBlend Studio with the full coding toolset.']]) {
    const relative=`dsh-blender-preset/presets/${name}/preset.yml`;
    let source=await load(relative);
    if(!/^description: /m.test(source)) throw Error(`Expected preset description: ${name}`);
    source=source.replace(/^description: .*$/m,`description: ${description}`).replace(/^name: .*$/m,`name: ${name==='deepblend'?'DeepBlend Studio':'DeepBlend Developer'}`);
    changes.set(relative,source);
  }
  const persona='dsh-blender-preset/presets/deepblend/agent.cordis.yml';
  let agent=await load(persona);
  agent=replaceOnce(agent,'      Load the deepblend-studio skill before starting real work.', '      Load the deepblend-studio skill before starting real work.\n      Respond in English. Use English for project titles, goals, notes and delivery receipts.');
  changes.set(persona,agent);
  const skill='dsh-blender-preset/presets/deepblend/skills/deepblend-studio/SKILL.md';
  let guide=await load(skill);
  const original=guide.match(/### 导入模型的部件材质\n[\s\S]*?(?=\n### )/);
  if(original) guide=guide.replace(original[0],`### Materials on imported model parts

Save the imported asset checkpoint first, then read exact partId values from blender_scene_get.assetParts.
For slotIndex use the original sourceMaterialSlots index; materialSlots describes the current result and may have been merged by a whole-object override.
Replace local bindings with entity.materialBindings.set, retaining unmodified entries. Each entry is {partId,materialId,slotIndex?}.
An omitted slot selects every slot on that mesh; an explicit slot takes precedence. Preserve geometry, UVs and face material indices.
A parent part path does not select descendants. An empty array restores original materials or the existing entity.materialId override.
Image materials require matching UVs on the affected meshes. Never guess selectors.
`);
  if(!guide.includes('## Full animation delivery')) guide+=`\n## Full animation delivery\n\nUse English for user-facing text, project titles, goals and receipts. For an animation request, inspect animationTracks and the project frame range before rendering. A range with no changing track is a static sequence, not demonstrated motion. Add or preserve the intended tracks and inspect distinct frames. Call blender_final_render with profileName final and omit frames/frameStart/frameEnd for the complete project timeline unless the user requests a sub-range. Never silently reduce an animation to one frame. Poll blender_job_status to completion, then call blender_export and inspect the verified delivery manifest, frame count, fps and duration. A job ID or a still preview does not prove animation delivery.\n`;
  changes.set(skill,guide);
  // Validate and prepare every edit before writing any files. Recipe input hashes
  // are rebound to translated SceneSpec bytes; geometry and timing are preserved.
  for(const [relative,source] of changes) await writeFile(join(base,relative),source);
  await writeFile(join(root,'lib/client.js'),bundleClient);
  return {edition:'bharatcode-english',changed:['lib/client.js (bundle entry)',...changes.keys()]};
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href) {
  if(!process.argv[2]) throw Error('Usage: node english.mjs /path/to/verified/adapted/package');
  console.log(JSON.stringify(await adaptEnglish(resolve(process.argv[2])),null,2));
}
