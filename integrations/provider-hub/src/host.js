import { MuseBridge } from './muse.js';
import { trusted, json, body } from './http.js';
export const name = 'dsh-provider-hub';
export const inject = ['llm', 'settings'];
/** No CLI runs until a user explicitly probes, signs in or connects. */
export function apply(ctx) {
  ctx.inject(['webServer', 'connection', 'subprocess', 'workspaceRegistry'], ctx => {
  const bridge=new MuseBridge(ctx.subprocess);let login;
  const workspaces=()=>ctx.workspaceRegistry.list().filter(row=>row.path).map(row=>({title:row.title||row.path,path:row.path}));
  const snapshot=()=>({...bridge.snapshot(),workspaces:workspaces(),login:login ? {running:!login.finished,output:login.handle.collected.stdout.readFrom(0).text} : undefined});
  const off=ctx.webServer.register({kind:'exact',path:'/api/bc-muse',handler:async(req,res)=>{
    if(ctx.connection.requestRejection(req)!==undefined||!trusted(req)){json(res,403,{error:'Authenticated local desktop required'});return;}
    try {
      if(req.method==='GET'){json(res,200,snapshot());return;}
      if(req.method!=='POST'){json(res,405,{error:'Method not allowed'});return;}
      const value=await body(req);
      switch(value.action){
        case 'connect':if(!workspaces().some(row=>row.path===value.cwd))throw Error('Select a registered workspace.');await bridge.connect(value.cwd);break;
        case 'send':await bridge.send(value.text);break;
        case 'cancel':await bridge.cancel();break;
        case 'decide':await bridge.decide(value.approvalId,value.choiceId);break;
        case 'answer':await bridge.answer(value.userInputId,value.answers);break;
        case 'close':await bridge.close();break;
        case 'login':{
          if(login&&!login.finished)throw Error('Muse sign-in is already running.');
          const cwd=workspaces()[0]?.path;if(!cwd)throw Error('Create a workspace first.');
          const handle=ctx.subprocess.spawn({argv:['muse','login'],cwd,graceMs:2000,stdio:{stdin:'ignore',stdout:{maxBytes:8192},stderr:{maxBytes:4096}}});
          const current={handle,finished:false};login=current;handle.done.finally(()=>{current.finished=true;}).catch(()=>{});break;
        }
        default:throw Error('Unknown Muse action');
      }
      json(res,200,snapshot());
    }catch(error){json(res,400,{error:error.message});}
  }});
  ctx.effect(()=>async()=>{off();if(login&&!login.finished){login.handle.terminate();await login.handle.done.catch(()=>{});}await bridge.close();},'provider-hub.muse');
  });
}
