import test from 'node:test';
import assert from 'node:assert/strict';
import {inspectDependencies} from '../src/dependencies.js';
test('Blender inspection uses a fixed version probe and the configured executable',async()=>{
  const [result]=await inspectDependencies(['blender'],{commands:{blender:'/configured/blender'},runner:async(command,args)=>{assert.equal(command,'/configured/blender');assert.deepEqual(args,['--version']);return{available:true,version:'5.2.1'};}});
  assert.equal(result.available,true);assert.equal(result.version,'5.2.1');
});
