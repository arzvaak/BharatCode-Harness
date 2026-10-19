import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Studio} from '../src/runtime.js';
import {registerTools} from '../src/tools.js';
test('both engine tool families execute workspace-owned projects and return real image attachments', {timeout:120000}, async () => {
  const directory = await mkdtemp(join(tmpdir(), 'bc-3d-tools-'));
  const studio = new Studio({directory});
  const definitions = new Map(), images = [];
  const ctx = {tools: {register(tool) {definitions.set(tool.name, tool); return () => definitions.delete(tool.name);}},
    attachments: {async saveImage(image) {images.push(image); return {attachmentId:'attachment-test', mediaType:'image/png', bytes:image.data.length, width:320, height:240};}},
    workspaceRegistry: {list: () => [{id:'workspace-a', sessionIds:['agent-a']}]} };
  const dispose = registerTools(ctx, studio);
  const execute = (name,args,agent='agent-a') => definitions.get(name).execute(args, {agent:{id:agent}, signal: new AbortController().signal});
  try {
    assert.equal(definitions.get('three_project_create').parameters.type,'object');
    assert.deepEqual(definitions.get('three_project_create').parameters.required,['title']);
    for (const engine of ['three', 'babylon']) {
      for (const verb of ['projects','project_create','project_get','project_update','preview','render','export']) assert.ok(definitions.has(`${engine}_${verb}`));
      const p = await execute(`${engine}_project_create`, {title:'Tool-created object'});
      assert.ok((await execute(`${engine}_project_get`, {projectId:p.id})).source);
      await assert.rejects(execute(`${engine}_project_get`, {projectId:p.id},'other-agent'), /workspace/i);
      const rendered = await execute(`${engine}_render`, {projectId:p.id,width:320,height:240});
      assert.ok(rendered.path.endsWith('.png'));
      assert.equal(rendered.attachment.attachmentId,'attachment-test');
      assert.equal(definitions.get(`${engine}_render`).output.render({},rendered)[1].type,'image');
      const result = await execute(`${engine}_export`, {projectId:p.id,format:'glb'});
      assert.ok(result.path.endsWith('.glb'));
    }
    assert.equal(images.length,2);
    assert.ok(images.every(image => image.data.length > 2000));
  } finally {dispose(); await studio.close();}
  assert.equal(definitions.size,0);
});
