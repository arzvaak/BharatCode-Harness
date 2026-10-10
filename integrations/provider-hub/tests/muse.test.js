import {test} from 'node:test';
import assert from 'node:assert/strict';
import {MuseBridge} from '../src/muse.js';
import {trusted} from '../src/http.js';
test('permission decisions use the current server stage and reject stale choices',async()=>{
  const bridge=new MuseBridge({});const calls=[];
  bridge.sessionId='owned-session';bridge.connection={command:async(...args)=>{calls.push(args);return {};}};
  const requirement={approvalId:'a',sourceIndex:2};
  bridge.observe({method:'approval/requested',params:{approvalId:'a',currentRequirementId:requirement,availableChoices:[{choiceId:'deny',label:'Deny'}],rawArgs:'owned command'}});
  assert.equal(calls.length,0);
  await assert.rejects(()=>bridge.decide('a','allow_once'),/no longer available/);
  await bridge.decide('a','deny');
  assert.deepEqual(calls[0][1],{sessionId:'owned-session',approvalId:'a',requirementId:requirement,choiceId:'deny'});
  bridge.observe({method:'approval/resolved',params:{approvalId:'a'}});
  assert.equal(bridge.snapshot().approvals.length,0);
});
test('questions, streamed output and cancellation remain session-owned',async()=>{
  const bridge=new MuseBridge({});const calls=[];
  bridge.sessionId='owned';bridge.turnId='turn';bridge.connection={command:async(...args)=>{calls.push(args);return {};}};
  bridge.observe({method:'item/delta',params:{sessionId:'other',itemId:'wrong',delta:'hidden'}});
  bridge.observe({method:'item/delta',params:{sessionId:'owned',itemId:'reply',delta:'hello'}});
  bridge.observe({method:'item/delta',params:{sessionId:'owned',itemId:'reply',delta:' world'}});
  assert.equal(bridge.snapshot().items[0].text,'hello world');
  bridge.observe({method:'userInput/requested',params:{userInputId:'q',questions:[{id:'one',question:'Choose'}]}});
  await bridge.answer('q',[{questionId:'one',freeText:'answer'}]);
  assert.equal(calls[0][0],'userInput/answer');
  await bridge.cancel();assert.equal(calls[1][0],'turn/cancel');assert.equal(calls[1][1].turnId,'turn');
  bridge.observe({method:'userInput/settled',params:{userInputId:'q'}});assert.equal(bridge.snapshot().questions.length,0);
});
test('local Muse route rejects cross-origin and unauthenticated requests',()=>{
  const req={socket:{remoteAddress:'127.0.0.1'},headers:{host:'127.0.0.1:4444',cookie:'dsh-auth-test=owned'}};
  assert.equal(trusted(req),true);assert.equal(trusted({...req,headers:{host:'127.0.0.1:4444'}}),false);
  assert.equal(trusted({...req,headers:{...req.headers,origin:'https://evil.example'}}),false);
  assert.equal(trusted({...req,socket:{remoteAddress:'192.0.2.1'}}),false);
});
