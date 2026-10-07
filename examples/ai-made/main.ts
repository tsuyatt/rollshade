import * as THREE from 'three/webgpu';
import { FXSystem, effect } from 'rollshade';
import type { StatusRun } from 'rollshade';

const FLOOR = 12;
const LIMIT = FLOOR - 0.6;
const MAX_ENEMIES = 8;

class Actor extends THREE.Group {
  chest = new THREE.Object3D();
  body: THREE.Mesh;
  hp: number;
  vel = new THREE.Vector3();
  constructor(material: THREE.Material, hp: number) {
    super();
    this.hp = hp;
    this.body = new THREE.Mesh(new THREE.CapsuleGeometry(0.4, 1.0, 4, 12), material);
    this.body.position.y = 0.9;
    this.chest.position.y = 1.2;
    this.add(this.body, this.chest);
  }
}

class Enemy extends Actor {
  frozen = 0;
  spawnT = 1.5;
  dead = false;
  hitT = 0;
  burn: StatusRun | null = null;
  freezeRun: StatusRun | null = null;
}

async function main() {
  const hud = document.getElementById('hud')!;
  const renderer = new THREE.WebGPURenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setSize(innerWidth, innerHeight);
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  document.body.append(renderer.domElement);
  await renderer.init();

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x07070d);
  const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
  camera.position.set(0, 24, 11);
  camera.lookAt(0, 0, 0);

  scene.add(new THREE.AmbientLight(0x6670a0, 0.7));
  const sun = new THREE.DirectionalLight(0x99aacc, 0.8);
  sun.position.set(-4, 10, 6);
  scene.add(sun);

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(FLOOR * 2, FLOOR * 2),
    new THREE.MeshStandardMaterial({ color: 0x3a3d4a, roughness: 0.9 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(FLOOR * 2, FLOOR, 0x555a70, 0x2a2d3a);
  grid.position.y = 0.01;
  scene.add(grid);

  const fx = new FXSystem({ scene, camera, renderer, post: true, feel: true });

  const playerMat = new THREE.MeshStandardMaterial({ color: 0x4488ff, roughness: 0.5 });
  const enemyMat = new THREE.MeshStandardMaterial({ color: 0xcc4444, roughness: 0.6 });
  const player = new Actor(playerMat, 10);
  scene.add(player);

  const enemies: Enemy[] = [];

  fx.add(
    effect('projectile', 'fire'),
    effect('nova', 'ice', { params: { radius: 5 } }),
    effect('slash', 'plain', { color: 0xddeeff }),
  );
  const template = new Enemy(enemyMat, 3);
  await fx.prewarmStatus(template, ['appear', 'dissolve', 'freeze', 'burn', 'shock']);
  await fx.prewarmStatus(player, ['shock']);
  await fx.prewarm();

  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      fx.loop('torch', new THREE.Vector3(sx * (FLOOR - 0.8), 0, sz * (FLOOR - 0.8)));
    }
  }

  const keys = new Set<string>();
  addEventListener('keydown', (e) => {
    if (e.repeat) return;
    keys.add(e.code);
    if (e.code === 'Digit1') castNova();
    if (e.code === 'Digit2') castSlash();
  });
  addEventListener('keyup', (e) => keys.delete(e.code));
  addEventListener('blur', () => keys.clear());

  const ndc = new THREE.Vector2();
  const ray = new THREE.Raycaster();
  const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const mouse = new THREE.Vector3();
  addEventListener('pointermove', (e) => {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  });
  renderer.domElement.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
    updateMouse();
    castFire();
  });
  renderer.domElement.addEventListener('contextmenu', (e) => e.preventDefault());
  addEventListener('resize', () => {
    renderer.setSize(innerWidth, innerHeight);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
  });

  function updateMouse() {
    ray.setFromCamera(ndc, camera);
    ray.ray.intersectPlane(plane, mouse);
  }

  const cd = { fire: 0, nova: 0, slash: 0 };
  const tmp = new THREE.Vector3();
  let clock = 0;

  function hurt(en: Enemy, dmg: number, push?: THREE.Vector3) {
    if (en.dead) return;
    en.hp -= dmg;
    en.hitT = 0.15;
    if (push) en.vel.addScaledVector(push, 9);
    fx.status(en, 'shock', { lasts: 0.25 });
    if (en.hp <= 0) kill(en);
  }

  function kill(en: Enemy) {
    en.dead = true;
    const i = enemies.indexOf(en);
    if (i >= 0) enemies.splice(i, 1);
    en.burn?.stop(0.1);
    fx.status(en, 'dissolve').on('full', () => {
      scene.remove(en);
      en.body.geometry.dispose();
    });
    fx.shake(0.2);
  }

  function castFire() {
    if (cd.fire > 0) return;
    cd.fire = 0.35;
    const to = new THREE.Vector3(mouse.x, 1, mouse.z);
    const h = fx.play('fire-projectile', { from: player.chest, to });
    h.on('hit', (e) => {
      if (e.index !== 0) return;
      for (const en of enemies.slice()) {
        if (en.spawnT > 0) continue;
        if (Math.hypot(en.position.x - e.point.x, en.position.z - e.point.z) < 1.6) {
          hurt(en, 1);
          if (!en.dead) {
            if (en.burn?.alive) en.burn.lasts = 2;
            else en.burn = fx.status(en, 'burn', { lasts: 2 });
          }
        }
      }
    });
  }

  function castNova() {
    if (cd.nova > 0) return;
    cd.nova = 3;
    tmp.copy(player.position).add(new THREE.Vector3(3.8, 0, 0));
    const h = fx.play('ice-nova', { from: player.chest, to: tmp.clone() });
    h.on('hit', () => {
      for (const en of enemies) {
        if (en.dead || en.position.distanceTo(player.position) > 5) continue;
        en.frozen = 3;
        en.vel.set(0, 0, 0);
        en.freezeRun = fx.status(en, 'freeze', { duration: 0.5, lasts: 3 });
      }
    });
  }

  const blade = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 1, 0.03),
    new THREE.MeshBasicMaterial({ color: 0xcfe6ff }),
  );
  blade.visible = false;
  scene.add(blade);
  const up = new THREE.Vector3(0, 1, 0);
  const bd = new THREE.Vector3();
  let slashHandle: ReturnType<typeof fx.play> | null = null;

  function castSlash() {
    if (cd.slash > 0) return;
    let best: Enemy | null = null;
    let bestD = 9;
    for (const en of enemies) {
      if (en.dead) continue;
      const d = en.position.distanceTo(player.position);
      if (d < bestD) {
        bestD = d;
        best = en;
      }
    }
    if (!best) return;
    cd.slash = 0.6;
    const target = best;
    bd.copy(target.position).sub(player.position).setY(0);
    if (bd.lengthSq() > 1e-6) {
      bd.normalize();
      if (bestD > 2) player.position.copy(target.position).addScaledVector(bd, -2);
      player.rotation.y = Math.atan2(bd.x, bd.z);
    }
    slashHandle?.stop();
    const h = fx.play('plain-slash', { from: player.chest, to: target.chest });
    slashHandle = h;
    h.on('hit', (e) => {
      if (e.index !== 0 || target.dead) return;
      tmp.copy(e.dir).setY(0).normalize();
      hurt(target, 1, tmp);
    });
    h.on('end', () => {
      if (slashHandle === h) slashHandle = null;
      blade.visible = false;
    });
  }

  let spawnTimer = 0.5;
  function spawn() {
    if (enemies.length >= MAX_ENEMIES) return;
    const en = new Enemy(enemyMat, 3);
    for (let tries = 0; tries < 10; tries++) {
      en.position.set((Math.random() * 2 - 1) * LIMIT, 0, (Math.random() * 2 - 1) * LIMIT);
      if (en.position.distanceTo(player.position) > 8) break;
    }
    scene.add(en);
    enemies.push(en);
    fx.status(en, 'appear');
  }

  let playerHit = 0;
  const timer = new THREE.Timer();
  renderer.setAnimationLoop((ms: number) => {
    timer.update(ms);
    const dt = Math.min(timer.getDelta(), 0.05);
    clock += dt;
    cd.fire -= dt;
    cd.nova -= dt;
    cd.slash -= dt;
    playerHit -= dt;

    updateMouse();
    let mx = 0;
    let mz = 0;
    if (keys.has('KeyW')) mz -= 1;
    if (keys.has('KeyS')) mz += 1;
    if (keys.has('KeyA')) mx -= 1;
    if (keys.has('KeyD')) mx += 1;
    if (mx || mz) {
      const l = Math.hypot(mx, mz);
      player.position.x += (mx / l) * 6 * dt;
      player.position.z += (mz / l) * 6 * dt;
    }
    player.position.x = Math.max(-LIMIT, Math.min(LIMIT, player.position.x));
    player.position.z = Math.max(-LIMIT, Math.min(LIMIT, player.position.z));
    if (!slashHandle) {
      const ax = mouse.x - player.position.x;
      const az = mouse.z - player.position.z;
      if (ax * ax + az * az > 0.01) player.rotation.y = Math.atan2(ax, az);
    }

    spawnTimer -= dt;
    if (spawnTimer <= 0) {
      spawnTimer = 1.8;
      spawn();
    }

    for (const en of enemies) {
      en.spawnT -= dt;
      en.frozen -= dt;
      en.hitT -= dt;
      en.body.scale.setScalar(en.hitT > 0 ? 1.2 : 1);
      en.position.addScaledVector(en.vel, dt);
      en.vel.multiplyScalar(Math.exp(-7 * dt));
      if (en.spawnT > 0 || en.frozen > 0) continue;
      tmp.copy(player.position).sub(en.position).setY(0);
      const d = tmp.length();
      if (d > 1e-4) {
        tmp.divideScalar(d);
        if (d > 0.9) en.position.addScaledVector(tmp, 2.2 * dt);
        en.rotation.y = Math.atan2(tmp.x, tmp.z);
      }
      if (d < 1.0 && playerHit <= 0) {
        playerHit = 0.8;
        player.hp -= 1;
        fx.status(player, 'shock', { lasts: 0.25 });
        fx.shake(0.3);
        if (player.hp <= 0) player.hp = 10;
      }
      en.position.x = Math.max(-LIMIT, Math.min(LIMIT, en.position.x));
      en.position.z = Math.max(-LIMIT, Math.min(LIMIT, en.position.z));
    }
    for (let i = 0; i < enemies.length; i++) {
      for (let j = i + 1; j < enemies.length; j++) {
        const a = enemies[i];
        const b = enemies[j];
        tmp.copy(a.position).sub(b.position).setY(0);
        const d = tmp.length();
        if (d < 0.9 && d > 1e-4) {
          tmp.multiplyScalar((0.9 - d) / d / 2);
          a.position.add(tmp);
          b.position.sub(tmp);
        }
      }
    }

    if (slashHandle?.blade.active) {
      const { base, tip } = slashHandle.blade;
      bd.copy(tip).sub(base);
      const len = bd.length();
      if (len > 1e-4) {
        blade.visible = true;
        blade.scale.set(1, len, 1);
        blade.position.copy(base).addScaledVector(bd, 0.5);
        blade.quaternion.setFromUnitVectors(up, bd.divideScalar(len));
      }
    } else {
      blade.visible = false;
    }

    hud.textContent =
      `WASD move  |  click: fire  |  1: ice nova  |  2: sword slash\n` +
      `HP ${player.hp}   enemies ${enemies.length}   t ${clock.toFixed(0)}s`;

    fx.update(dt);
    fx.render();
  });

  (window as unknown as { game: unknown }).game = { enemies, player };
}

main();
