import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {runInNewContext} from 'node:vm';
import React from 'react';
import * as jsx from 'react/jsx-runtime';
import {setup} from './ui-fixture.js';
import {act} from 'react';
test('native Harness module loader receives a callable Provider Hub plugin',async()=>{
 const f=setup();let registration;const window={__ModuleLoader__:{load:value=>{registration=value;}}};
 runInNewContext(readFileSync(new URL('../lib/client.js',import.meta.url),'utf8'),{window});
 assert.equal(registration.id,'@arzvaak/dsh-provider-hub');const plugin=registration.factory(id=>{if(id==='react')return React;if(id==='react/jsx-runtime')return jsx;throw new Error('Unexpected host module '+id);});
 assert.equal(typeof plugin.apply,'function');assert.ok(plugin.inject.includes('remote.llm'));
 try{await act(async()=>f.root.render(React.createElement(plugin.ProviderHub,{controller:f.controller,slots:f.slots})));assert.match(document.body.textContent,/Model endpoints/);}finally{await act(async()=>f.root.unmount());f.dom.window.close();}
});
