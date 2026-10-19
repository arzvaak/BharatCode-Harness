import {join} from 'node:path';
import {Studio} from './runtime.js';
import {registerTools} from './tools.js';
import {apiHandler} from './http.js';
export const name='bc-3d-toolkit';
export const inject=['tools','attachments','profileContext','workspaceRegistry','webServer','systemPrompt'];
export const GUIDE=`Use three_* tools for Three.js/React Three Fiber scenes and babylon_* tools for Babylon.js games and scenes. Start with project_create, read project_get, edit the complete JS/TS/TSX source with project_update using expectedRevision, then preview and render. createScene({canvas,width,height}) returns {scene,camera,renderer,update(timeSeconds),dispose()} for Three or {scene,engine,update(timeSeconds),dispose()} for Babylon. Imports are bundled offline: three and addons, react, react-dom, @react-three/fiber, @react-three/drei, @react-three/rapier, @babylonjs/core, @babylonjs/loaders, @babylonjs/serializers. Node APIs, filesystem access and dependency installs are unavailable inside generated scenes. Use procedural geometry or embedded data URLs rather than fetching external assets. Interactive previews run browser code on a separate origin with CSP restrictions; they are not a complete network sandbox. Build animation and game input in the scene module; use update(timeSeconds) for reproducible rendering. Return actual rendered image attachments. Use export(glb) for models, export(viewer) for a runnable offline HTML ZIP and export(source) for editable source; Babylon supports native scene JSON. A successful preview build does not prove the scene runs; render and inspect output before claiming completion. Give users the saved output paths and preserve the editable project.`;
export function apply(ctx,config={}) {
  const studio=new Studio({directory:config.directory ?? join(ctx.profileContext.dir,'bc-3d-toolkit'),browserPath:config.browserPath});
  const disposeTools=registerTools(ctx,studio);
  const disposeRoute=ctx.webServer.register({kind:'exact',path:'/api/bc-3d',handler:apiHandler(ctx,studio)});
  ctx.systemPrompt.section({name:'bc-3d-toolkit:guide',order:100,text:GUIDE,interpolate:false});
  ctx.effect(()=>()=>{disposeTools();disposeRoute();return studio.close();},'bc-3d-toolkit.lifecycle');
}
