import {test} from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {ProviderHub} from './client.bundle.js';
import {setup} from './ui-fixture.js';
test('page discovers models and saves through its form; key is cleared after save',async()=>{
 const f=setup();try{
 await act(async()=>f.root.render(React.createElement(ProviderHub,{controller:f.controller,slots:f.slots})));
 assert.match(document.body.textContent,/Install @arzvaak\/bharatcode-subscriptions/);
 await act(async()=>f.button('Discover models').click());
 assert.ok([...document.querySelectorAll('input')].some(i=>i.value==='new-model'));
 await act(async()=>document.querySelector('form').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true})));
 assert.equal(f.saved[0].models[0].id,'new-model');assert.match(document.body.textContent,/Provider saved/);
 assert.equal(document.querySelector('input[type=password]').value,'');
 }finally{await act(async()=>f.root.unmount());f.dom.window.close();}
});
test('reuses an installed subscription entry and its injected props',async()=>{
 const received=[];function Subscription({rpc}){received.push(rpc);return React.createElement('p',null,'Installed subscription controls');}
 const rpc={};const f=setup([{options:{id:'subscriptions',inject:()=>({rpc})},component:Subscription}]);
 try{await act(async()=>f.root.render(React.createElement(ProviderHub,{controller:f.controller,slots:f.slots})));await act(async()=>f.button('Manage subscription sign-in').click());assert.equal(received[0],rpc);assert.match(document.body.textContent,/Installed subscription controls/);await act(async()=>f.button('Hide subscription sign-in').click());assert.ok(!document.body.textContent.includes('Installed subscription controls'));}finally{await act(async()=>f.root.unmount());f.dom.window.close();}
});
