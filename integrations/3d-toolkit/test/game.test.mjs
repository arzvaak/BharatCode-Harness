import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {chromium} from 'playwright-core';
import {unzipSync} from 'fflate';
import {Studio,browserExecutable} from '../src/runtime.js';
const source=`import {Engine,Scene,ArcRotateCamera,Vector3,HemisphericLight,MeshBuilder,StandardMaterial,Color3} from '@babylonjs/core';
export function createScene({canvas,width,height}) {
 const engine=new Engine(canvas,true,{preserveDrawingBuffer:true});engine.setSize(width,height);
 const scene=new Scene(engine);new HemisphericLight('sky',new Vector3(0,1,0),scene);
 const camera=new ArcRotateCamera('camera',-Math.PI/2,Math.PI/4,8,new Vector3(0,0,0),scene);
 const player=MeshBuilder.CreateBox('player',{size:0.6},scene);player.position.y=0.3;
 const collectible=MeshBuilder.CreateSphere('collectible',{diameter:0.35},scene);collectible.position.set(1.5,0.3,0);
 const material=new StandardMaterial('collectible-green',scene);material.diffuseColor=Color3.Green();collectible.material=material;
 MeshBuilder.CreateGround('floor',{width:12,height:8},scene);
 let pressed=false,previous=0,score=0;
 const down=event=>{if(event.key==='ArrowRight')pressed=true;};const up=()=>{pressed=false;};
 addEventListener('keydown',down);addEventListener('keyup',up);
 window.gameState={x:0,score:0};
 return {scene,engine,update(time){const dt=Math.max(0,Math.min(0.05,time-previous));previous=time;if(pressed)player.position.x+=3*dt;if(!score&&player.position.x>1){score=1;collectible.setEnabled(false);}window.gameState={x:player.position.x,score};},dispose(){removeEventListener('keydown',down);removeEventListener('keyup',up);scene.dispose();engine.dispose();}};
}`;
test('Babylon keyboard gameplay survives an exported offline viewer', {timeout:60000},async()=>{
  const directory=await mkdtemp(join(tmpdir(),'bc-3d-game-'));
  const studio=new Studio({directory});
  const browser=await chromium.launch({executablePath:await browserExecutable(process.env.BC_3D_CHROMIUM),headless:true,args:['--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const project=await studio.projects.create('game-workspace','babylon','Collect the green orb',source);
    const preview=await studio.preview('game-workspace',project.id,'babylon');
    const exported=await studio.export('game-workspace',project.id,'babylon',{format:'viewer'});
    const files=unzipSync(await readFile(exported.path));
    const offline=join(directory,'game.html');await writeFile(offline,files['index.html']);
    const page=await browser.newPage();
    for(const url of [preview.url,`file://${offline}`]) {
      await page.goto(url);
      await page.waitForFunction(()=>window.BC3D?.ready||window.BC3D?.error);
      assert.equal(await page.evaluate(()=>window.BC3D.error),null);
      assert.equal(await page.evaluate(()=>window.gameState.score),0);
      await page.keyboard.down('ArrowRight');
      await page.waitForFunction(()=>window.gameState.score===1);
      await page.keyboard.up('ArrowRight');
      assert.ok(await page.evaluate(()=>window.gameState.x>1));
    }
  }finally{await browser.close();await studio.close();}
});
