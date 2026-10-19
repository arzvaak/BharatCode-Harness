export function starter(engine) {
  if (engine === 'three') return `import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

// Edit this complete module, then update using the current revision number.
export async function createScene({ canvas, width, height }) {
  const renderer = new THREE.WebGLRenderer({canvas, antialias: true, preserveDrawingBuffer: true});
  renderer.setSize(width, height);
  renderer.setPixelRatio(1);
  renderer.shadowMap.enabled = true;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x17202b);
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
  camera.position.set(4, 3, 5);
  camera.lookAt(0, 0.6, 0);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(0, 0.6, 0); controls.update();
  scene.add(new THREE.HemisphereLight(0xddeeff, 0x405060, 2));
  const key = new THREE.DirectionalLight(0xffffff, 4);
  key.position.set(3, 6, 4); key.castShadow = true; scene.add(key);
  const sculpture = new THREE.Mesh(new THREE.TorusKnotGeometry(0.7, 0.22, 128, 24), new THREE.MeshStandardMaterial({color: 0xef6a45, metalness: 0.5, roughness: 0.22}));
  sculpture.position.y = 1; sculpture.castShadow = true; scene.add(sculpture);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({color: 0x354352, roughness: 0.8}));
  floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true; scene.add(floor);
  return {scene, camera, renderer, update(time) { sculpture.rotation.y = time * 0.35; }, dispose() {controls.dispose(); renderer.dispose();}};
}
`;
  return `import { Engine, Scene, ArcRotateCamera, Vector3, HemisphericLight, DirectionalLight, MeshBuilder, PBRMaterial, Color3, Color4, ShadowGenerator } from '@babylonjs/core';

export async function createScene({ canvas, width, height }) {
  const engine = new Engine(canvas, true, {preserveDrawingBuffer: true, stencil: true});
  engine.setSize(width, height);
  const scene = new Scene(engine);
  scene.clearColor = new Color4(0.09, 0.12, 0.17, 1);
  const camera = new ArcRotateCamera('camera', -Math.PI / 3, Math.PI / 3, 7, new Vector3(0, 0.8, 0), scene);
  camera.attachControl(canvas, true);
  const ambient = new HemisphericLight('ambient', new Vector3(0, 1, 0), scene); ambient.intensity = 0.8;
  const light = new DirectionalLight('key', new Vector3(-1, -2, -1), scene); light.position = new Vector3(4, 8, 4);
  const sculpture = MeshBuilder.CreateTorusKnot('sculpture', {radius: 0.7, tube: 0.22, radialSegments: 96, tubularSegments: 24}, scene);
  sculpture.position.y = 1;
  const material = new PBRMaterial('copper', scene); material.albedoColor = new Color3(0.9, 0.35, 0.17); material.metallic = 0.45; material.roughness = 0.28; sculpture.material = material;
  const floor = MeshBuilder.CreateGround('floor', {width: 20, height: 20}, scene);
  const ground = new PBRMaterial('ground', scene); ground.albedoColor = new Color3(0.2, 0.27, 0.34); ground.metallic = 0; ground.roughness = 0.9; floor.material = ground;
  const shadows = new ShadowGenerator(1024, light); shadows.addShadowCaster(sculpture); floor.receiveShadows = true;
  return {scene, engine, update(time) { sculpture.rotation.y = time * 0.35; }, dispose() {scene.dispose(); engine.dispose();}};
}
`;
}
