import {JSDOM} from 'jsdom';
import {createRoot} from 'react-dom/client';
export function setup(entries=[], realSlots) {
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost'});
 globalThis.window=dom.window;globalThis.document=dom.window.document;globalThis.localStorage=dom.window.localStorage;globalThis.IS_REACT_ACT_ENVIRONMENT=true;
 const slots=realSlots || {subscribe:()=>()=>{},getVersion:()=>0,entries:()=>entries.map(e=>({...e,inject:e.options.inject}))};
 const saved=[];const controller={load:async()=>({writable:true,profiles:{}}),discover:async()=>[{id:'new-model',contextWindow:64000,maxTokens:4000}],save:async d=>{saved.push(d);return{writable:true,profiles:{}};}};
 const root=createRoot(document.getElementById('root'));
 return{dom,root,slots,controller,saved,button:text=>[...document.querySelectorAll('button')].find(b=>b.textContent===text)};
}
