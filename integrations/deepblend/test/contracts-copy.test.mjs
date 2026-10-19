import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {patchContracts} from '../english.mjs';

test('backend QA, job progress, durations and capability copy are English for all statuses', {skip:!process.env.BC_DEEPBLEND_PACKAGE},async()=>{
 const path=join(process.env.BC_DEEPBLEND_PACKAGE,'node_modules/@deepblend/dsh-blender-contracts/lib/ui-api.js');
 const original=await readFile(path,'utf8');
 const patched=patchContracts(original);
 assert.equal(patchContracts(patched),patched);
 const source=patched.replace(/from '(\.[^']+)'/g,(_all,relative)=>`from '${new URL(relative,pathToFileURL(path)).href}'`);
 const api=await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 const replies=[];
 for(const status of ['queued','running','stopping','recovering','completed','failed','cancelled']) replies.push(api.describeJobForHuman({status,completedFrames:12,expectedFrames:48,estimatedRemainingMs:65000,delivery:{verified:true}}));
 replies.push(api.formatDuration(65000),api.formatDuration(3700000));
 replies.push(api.buildQaView({projectId:'cup',revision:'r0003'}));
 replies.push(api.buildQaView({projectId:'cup',revision:'r0003',validation:{errors:[],warnings:[]}}));
 replies.push(api.buildSettingsCard(null));
 assert.equal(/[\u3400-\u9fff]/u.test(JSON.stringify(replies)),false);
 assert.equal(api.describeJobForHuman({status:'completed',completedFrames:48,expectedFrames:48,delivery:{verified:true}}),'Delivered: 48/48 frames; video verified');
});
