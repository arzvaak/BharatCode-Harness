const textOutput = {schema: {type:'json'}, render: (_args, value) => [{type:'text', text:JSON.stringify(value)}]};
const projectParameter = {projectId: {type:'string', required:true, description:'Project ID returned by project_create or projects in this workspace.'}};
const frameParameters = {width:{type:'integer',description:'Image width, 64–4096 pixels. Default 960.'}, height:{type:'integer',description:'Image height, 64–4096 pixels. Default 640.'}, time:{type:'number',description:'Deterministic animation time in seconds, 0–86400. Default 0.'}};
export const TOOL_VERBS = ['projects','project_create','project_get','project_update','preview','render','export'];
export function workspaceFor(ctx, exec) {
  const workspace = ctx.workspaceRegistry.list().find(item => item.sessionIds.includes(exec.agent?.id));
  if (!workspace) throw Error('A registered workspace and live agent session are required');
  return workspace.id;
}
export function registerTools(ctx, studio) {
  const disposers = [];
  for (const engine of ['three','babylon']) {
    const add = (verb, description, parameters, action, output = textOutput) => disposers.push(ctx.tools.register(defineTool({
      name:`${engine}_${verb}`, description, parameters, output,
      isConcurrencySafe: () => !['project_update','project_create','render','export'].includes(verb),
      execute: async (args, exec) => {exec.signal?.throwIfAborted(); return action(workspaceFor(ctx,exec), args, exec);},
    })));
    add('projects', `List editable ${engine} projects in the calling workspace.`, {}, async scope => (await studio.projects.list(scope)).filter(project => project.engine === engine));
    add('project_create', `Create an editable ${engine} project. Omit source for a working lit, animated 3D starter. Source is a full JS/TS/TSX module exporting async createScene({canvas,width,height}). It returns ${engine === 'three' ? '{scene,camera,renderer,update(time),dispose()}' : '{scene,engine,update(time),dispose()}'}. Import bundled libraries, never Node modules.`,
      {title:{type:'string', required:true, description:'Project title, 1–160 characters.'}, source:{type:'string',description:'Optional full scene module, up to 1 MiB. Call project_get to inspect the starter contract.'}},
      (scope,args) => studio.projects.create(scope, engine, args.title, args.source));
    add('project_get', 'Read complete editable scene source, engine and current revision before editing.', projectParameter, (scope,args) => studio.projects.get(scope,args.projectId,engine));
    add('project_update', 'Save a new immutable source revision. Use expectedRevision from project_get; stale edits fail. Call preview or render after edits to catch compiler and scene errors.',
      {...projectParameter,source:{type:'string',required:true,description:'Full replacement scene module.'},expectedRevision:{type:'integer',required:true,description:'Exact current revision from project_get.'}},
      (scope,args) => studio.projects.update(scope,args.projectId,engine,args));
    add('preview', 'Build a project and return an interactive preview URL. Open it in 3D Studio or a browser. A build does not prove successful scene initialization; render to inspect actual pixels and runtime errors.', projectParameter,
      (scope,args,exec) => studio.preview(scope,args.projectId,engine,{signal:exec.signal}));
    add('render', 'Render the actual project at a chosen time to a PNG and return a durable image attachment plus renderer metrics. Inspect this image before claiming the scene looks correct. Initialization errors and empty scenes fail.', {...projectParameter,...frameParameters},
      async (scope,args,exec) => {
        const result = await studio.render(scope,args.projectId,engine,{...args,signal:exec.signal});
        const attachment = await ctx.attachments.saveImage({data:result.bytes,mediaType:'image/png',name:`${engine}-${args.projectId}-r${result.revision}.png`});
        return {...result,bytes:result.bytes.length,attachment};
      }, {schema:{type:'json'},render:(_args,value) => [...textOutput.render({},value),{type:'image',attachment:value.attachment}]});
    add('export', `Export ${engine} project: glb for interoperable 3D geometry/materials, source for editable project ZIP, viewer for an offline runnable HTML viewer ZIP${engine === 'babylon' ? ', babylon for native scene JSON' : ''}. Return the absolute output path to the user. Exports preserve the source revision.`,
      {...projectParameter,format:{type:'string',enum:['glb','source','viewer',...(engine === 'babylon'?['babylon']:[])],required:true,description:'Export format.'},...frameParameters},
      (scope,args,exec) => studio.export(scope,args.projectId,engine,{...args,signal:exec.signal}));
  }
  return () => {for(const dispose of disposers.reverse()) dispose();};
}
import {defineTool} from '@deepseek-ai/dsh-tools';
