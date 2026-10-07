import * as THREE from 'three/webgpu';
import { FXSystem, effect } from 'rollshade';

const help = document.getElementById('help');

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.append(renderer.domElement);
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x07080d);
scene.add(new THREE.HemisphereLight(0x8a98c0, 0x1a1820, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 1.4);
sun.position.set(-4, 10, 6);
scene.add(sun);

const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 7, 11);
camera.lookAt(0, 1, 0);

const floor = new THREE.Mesh(new THREE.CircleGeometry(8, 48).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: 0x23252e, roughness: 0.9 }));
scene.add(floor);

function character(color, x) {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1, 6, 16).translate(0, 0.9, 0), new THREE.MeshStandardMaterial({ color, roughness: 0.6 }));
  root.add(body);
  const hand = new THREE.Object3D();
  hand.position.set(0.45, 1.2, 0.3);
  const chest = new THREE.Object3D();
  chest.position.set(0, 1.1, 0);
  root.add(hand, chest);
  root.position.x = x;
  scene.add(root);
  return { root, hand, chest };
}

const hero = character(0x4aa8ff, -3);
const enemy = { ...character(0xd0584a, 3), hp: 100 };

const fx = new FXSystem({ scene, camera, renderer, post: true, feel: true });
fx.add(effect('projectile', 'fire'), effect('nova', 'ice'), effect('beam', 'thunder'));
fx.loop('torch', new THREE.Vector3(-5, 0, -4));
fx.loop('torch', new THREE.Vector3(5, 0, -4));
await fx.prewarm();
await fx.prewarmStatus(enemy.root);

function hurt(amount) {
  if (enemy.hp <= 0) return;
  enemy.hp -= amount;
  if (enemy.hp > 0) return;
  for (const run of fx.statusesOf(enemy.root)) run.stop();
  fx.status(enemy.root, 'dissolve').on('full', () => {
    enemy.root.visible = false;
    setTimeout(respawn, 800);
  });
}

function respawn() {
  enemy.hp = 100;
  enemy.root.position.set(THREE.MathUtils.randFloat(1, 5), 0, THREE.MathUtils.randFloat(-3, 3));
  enemy.root.visible = true;
  fx.status(enemy.root, 'appear');
}

addEventListener('pointerdown', () => {
  fx.play('fire-projectile', { from: hero.hand, to: enemy.chest }).on('hit', (e) => {
    hurt(15 * e.power);
    fx.status(enemy.root, 'burn', { lasts: 2 });
  });
});

addEventListener('keydown', (e) => {
  if (e.key === '1') {
    fx.play('ice-nova', { from: hero.chest, to: enemy.chest }).on('hit', (e) => {
      hurt(10 * e.power);
      fx.status(enemy.root, 'freeze', { lasts: 2.5 });
    });
  }
  if (e.key === '2') {
    fx.play('thunder-beam', { from: hero.hand, to: enemy.chest }).on('hit', (e) => {
      hurt(4 * e.power);
      fx.status(enemy.root, 'shock', { lasts: 1 });
    });
  }
});

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

help.textContent = 'Click: fire bolt · 1: ice nova · 2: thunder beam';

const timer = new THREE.Timer();
renderer.setAnimationLoop((ms) => {
  timer.update(ms);
  fx.update(Math.min(timer.getDelta(), 0.05));
  fx.render();
});
