import {readFile} from 'node:fs/promises';
import {randomUUID} from 'node:crypto';
export function trustedRequest(req) {
  if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(req.socket?.remoteAddress) || req.headers['sec-fetch-site'] === 'cross-site') return false;
  try {
    const host = new URL(`http://${req.headers.host}`);
    if (!['127.0.0.1','localhost','[::1]'].includes(host.hostname) || host.pathname !== '/' || host.username || host.password) return false;
    if (req.headers.origin) return new URL(req.headers.origin).host === host.host;
    return req.headers['sec-fetch-site'] === 'same-origin' || /(?:^|;)\s*dsh-auth-[^=]+=.+/.test(req.headers.cookie ?? '');
  } catch {return false;}
}
export function json(res,status,value) {res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(JSON.stringify(value));}
async function body(req) {
  if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] ?? '')) throw Error('JSON request required');
  let size=0; const chunks=[];
  for await(const chunk of req) {size += chunk.length;if(size > 1100000) throw Error('Request too large');chunks.push(chunk);}
  const value=JSON.parse(Buffer.concat(chunks).toString());
  if(!value || typeof value !== 'object' || Array.isArray(value)) throw Error('Invalid action');
  return value;
}
export function apiHandler(ctx,studio) {
  const downloads = new Map();
  return async (req,res) => {
    if (!trustedRequest(req)) return json(res,403,{error:'Local authenticated UI required'});
    try {
      const url = new URL(req.url,'http://localhost');
      if(req.method === 'GET' && url.searchParams.has('artifact')) {
        const file = downloads.get(url.searchParams.get('artifact'));
        if(!file) return json(res,404,{error:'Export not found'});
        const bytes=await readFile(file.path);
        res.writeHead(200,{'Content-Type':file.path.endsWith('.png')?'image/png':'application/octet-stream','Content-Disposition':`attachment; filename="${file.name}"`,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});res.end(bytes);return;
      }
      const workspaces=ctx.workspaceRegistry.list().map(item=>({id:item.id,name:item.name ?? item.title ?? item.id}));
      if(req.method === 'GET') {
        const projects=[];
        for(const workspace of workspaces) for(const project of await studio.projects.list(workspace.id)) projects.push({...project,workspace:workspace.id});
        return json(res,200,{workspaces,projects});
      }
      if(req.method !== 'POST') return json(res,405,{error:'Unsupported method'});
      const args=await body(req);
      if(!workspaces.some(workspace=>workspace.id===args.workspace)) throw Error('Registered workspace required');
      let value;
      if(args.action === 'create') value=await studio.projects.create(args.workspace,args.engine,args.title,args.source);
      else if(args.action === 'get') value=await studio.projects.get(args.workspace,args.projectId,args.engine);
      else if(args.action === 'update') value=await studio.projects.update(args.workspace,args.projectId,args.engine,args);
      else if(args.action === 'preview') value=await studio.preview(args.workspace,args.projectId,args.engine);
      else if(args.action === 'render' || args.action === 'export') {
        value=await studio[args.action](args.workspace,args.projectId,args.engine,args);
        const id=randomUUID();
        const extension=value.path.split('.').pop();
        downloads.set(id,{path:value.path,name:`${args.engine}-${args.projectId}-r${value.revision}.${extension}`});
        value={...value,bytes:typeof value.bytes==='number'?value.bytes:value.bytes.length,downloadURL:`/api/bc-3d?artifact=${id}`};
      } else throw Error('Unknown 3D Studio action');
      return json(res,200,value);
    } catch(error) {return json(res,400,{error:error.message});}
  };
}
