import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
test('malformed preview request cannot crash the native host',()=>{
  const source=`import{PreviewServer}from ${JSON.stringify(new URL('../src/server.js',import.meta.url).href)};import{createConnection}from'node:net';const server=new PreviewServer();await server.start();const socket=createConnection(new URL(server.origin).port,'127.0.0.1');socket.on('connect',()=>socket.write('GET http://[ HTTP/1.1\\r\\nHost: 127.0.0.1:'+new URL(server.origin).port+'\\r\\nConnection: close\\r\\n\\r\\n'));socket.on('data',chunk=>{if(!chunk.toString().includes('400'))process.exitCode=2;});await new Promise(done=>socket.on('close',done));await server.close();console.log('SURVIVED');`;
  const result=spawnSync(process.execPath,['--input-type=module','-e',source],{encoding:'utf8',timeout:5000});
  assert.equal(result.status,0,result.stderr);
  assert.match(result.stdout,/SURVIVED/);
});
