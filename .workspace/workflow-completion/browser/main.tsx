import React, {useState} from 'react'
import {createRoot} from 'react-dom/client'
import {CodeEditor} from '../../../packages/client/ui-workspace/src/client/workflows/CodeEditor.tsx'
import {ProseEditor} from '../../../packages/client/ui-workspace/src/client/workflows/ProseEditor.tsx'
import {AppFrame} from '../../../packages/client/ui-workspace/src/client/workflows/AppFrame.tsx'
import {configureMonacoWorkers} from '../../../packages/client/ui-workspace/src/client/workflows/monaco-runtime.ts'
import {en} from '../../../packages/client/ui-workspace/src/client/locales.ts'
import {LATEST_PROTOCOL_VERSION} from '@modelcontextprotocol/ext-apps/app-bridge'
configureMonacoWorkers()
const app={server:'fixture',tool:'render',title:'Fixture app',resourceUri:'ui://fixture/test',generation:'fixture-generation',allowedTools:['render']}
const html=`<div id="state">boot</div><script>
let seq=0;const pending=new Map();
function send(method,params){const id=++seq;parent.postMessage({jsonrpc:'2.0',id,method,params},'*');return new Promise(resolve=>pending.set(id,resolve));}
window.addEventListener('message',async event=>{if(event.source!==parent)return;const m=event.data;if(m.id&&pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}
if(m.method==='ui/notifications/tool-input'){document.querySelector('#state').textContent='initialized'; const reply=await send('tools/call',{name:'render',arguments:{message:'hello'}});document.querySelector('#state').textContent=JSON.stringify(reply.result);const forbidden=await send('tools/call',{name:'escape',arguments:{}});document.querySelector('#state').dataset.forbidden=JSON.stringify(forbidden.error); try{parent.document.body.dataset.escaped='yes'}catch{document.querySelector('#state').dataset.opaque='yes'}}});
send('ui/initialize',{appInfo:{name:'fixture',version:'1'},appCapabilities:{},protocolVersion:${JSON.stringify(LATEST_PROTOCOL_VERSION)}}).then(()=>parent.postMessage({jsonrpc:'2.0',method:'ui/notifications/initialized'},'*'));
<\/script>`
const resource={app,html}
function View(){const [text,setText]=useState('const a = 1;\n');const [prose,setProse]=useState('# Title\n\nA **bold** sentence.\n');const [error,setError]=useState('');return <><div style={{height:300}}><CodeEditor path="test.ts" label="Code" text={text} onChange={setText} onSave={()=>{document.body.dataset.saved='yes'}} onSelection={()=>{}} diagnostics={[{severity:1,message:'fixture diagnostic',range:{start:{line:0,character:6},end:{line:0,character:7}}}]}/></div><output id="code-state">{text}</output><ProseEditor label="Prose" text={prose} onChange={setProse} t={key=>en[key]}/><output id="prose-state">{prose}</output><AppFrame resource={resource} argumentsJson="{}" call={async(name,args)=>{document.body.dataset.called=name;return JSON.stringify({content:[{type:'text',text:'ok'}],structuredContent:{args:JSON.parse(args)}})}} error={reason=>setError(String(reason))}/><output id="error">{error}</output></>}
createRoot(document.querySelector('#root')!).render(<View/>);
