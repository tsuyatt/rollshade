import * as THREE from 'three/webgpu';
import { color, float, fract, mix, positionWorld, smoothstep, vec2 } from 'three/tsl';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';
import { FXSystem, effect, type FXHandle, type HitEvent, type StatusRun } from 'rollshade';

const params = new URLSearchParams(location.search);
const ARENA = 8.5;
const UP = new THREE.Vector3(0, 1, 0);

type Job = 'mage' | 'blade' | 'fist';
const JOBS: Job[] = ['mage', 'blade', 'fist'];
const JOB_NAMES: Record<Job, string> = { mage: 'Mage', blade: 'Swordsman', fist: 'Brawler' };
let job: Job = JOBS.includes(params.get('class') as Job) ? (params.get('class') as Job) : 'mage';

const view = document.getElementById('view')!;
const loading = document.getElementById('loading')!;
const loadingBar = loading.querySelector('i') as HTMLElement;
const loadingText = loading.querySelector('span') as HTMLElement;

function progress(k: number, text: string): void {
  loadingBar.style.width = `${Math.round(Math.min(k, 1) * 100)}%`;
  loadingText.textContent = text;
}

progress(0.02, 'Starting the renderer');
const renderer = new THREE.WebGPURenderer({ antialias: devicePixelRatio < 1.5, forceWebGL: params.get('renderer') === 'webgl' });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
view.appendChild(renderer.domElement);
await renderer.init();

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x06070b);
scene.fog = new THREE.Fog(0x06070b, 18, 36);
scene.add(new THREE.HemisphereLight(0x8a98c0, 0x1a1820, 1.1));
const moon = new THREE.DirectionalLight(0xc8d4ff, 1.4);
moon.position.set(-6, 12, 4);
scene.add(moon);

const tile = vec2(positionWorld.x, positionWorld.z).mul(0.5);
const edge = smoothstep(0.02, 0.06, fract(tile.x)).mul(smoothstep(0.02, 0.06, fract(tile.y)));
const floorMat = new THREE.MeshStandardNodeMaterial({ roughness: 0.9 });
floorMat.colorNode = mix(color(0x16171c), color(0x3a3c46), edge).mul(mix(float(0.7), float(1), fract(tile.x.floor().mul(0.37).add(tile.y.floor().mul(0.61))).mul(0.5).add(0.5)));
const floor = new THREE.Mesh(new THREE.CircleGeometry(ARENA + 2, 64).rotateX(-Math.PI / 2), floorMat);
scene.add(floor);
const pillarMat = new THREE.MeshStandardMaterial({ color: 0x5a5866, roughness: 0.85 });
const pillars: THREE.Vector3[] = [];
for (let i = 0; i < 8; i++) {
  const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
  const p = new THREE.Vector3(Math.cos(a) * (ARENA + 0.6), 0, Math.sin(a) * (ARENA + 0.6));
  const pillar = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.55, 3.2, 8).translate(0, 1.6, 0), pillarMat);
  pillar.position.copy(p);
  scene.add(pillar);
  pillars.push(p);
}

const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
const fx = new FXSystem({ scene, camera, renderer, post: true, feel: true, quality: 'auto', loopLights: 4, hitStopScale: 0 });
progress(0.08, 'Loading models');

const loader = new GLTFLoader();
const MODELS = ['/models/chibi.glb', '/models/slime.glb', '/models/beast.glb', '/models/quadruped_24zytc.glb', '/models/flying_1k3iayw.glb', '/models/chibi_cni4y5.glb'];
const loaded = MODELS.map(() => 0);
const totals = MODELS.map(() => 1);
const [heroGltf, slimeGltf, beastGltf, stalkerGltf, flyerGltf, mageGltf] = await Promise.all(
  MODELS.map((url, i) =>
    loader.loadAsync(url, (e) => {
      loaded[i] = e.loaded;
      totals[i] = e.total || e.loaded || 1;
      progress(0.08 + 0.3 * (loaded.reduce((a, b) => a + b, 0) / totals.reduce((a, b) => a + b, 0)), 'Loading models');
    }),
  ),
);
progress(0.4, 'Compiling effects');

function fit(object: THREE.Object3D, height: number): void {
  const box = new THREE.Box3().setFromObject(object);
  const k = height / Math.max(box.getSize(new THREE.Vector3()).y, 1e-3);
  object.scale.setScalar(k);
  object.position.y = -box.min.y * k;
}

interface Body {
  root: THREE.Group;
  model: THREE.Object3D;
  mixer: THREE.AnimationMixer;
  chest: THREE.Object3D;
  radius: number;
  height: number;
  baseY: number;
  bones: Record<string, THREE.Bone>;
  stride: number;
  bar: HTMLElement;
  fly?: number;
}

const labels = document.getElementById('labels')!;

function makeBar(kind: string): HTMLElement {
  const el = document.createElement('div');
  el.className = `unit-hp ${kind}`;
  el.innerHTML = '<i></i>';
  labels.append(el);
  return el;
}

const tintedMaterials = new Map<string, THREE.MeshStandardMaterial>();

function body(gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] }, height: number, radius: number, tint?: number, bar: 'hero' | 'enemy' = 'enemy'): Body {
  const model = SkeletonUtils.clone(gltf.scene);
  fit(model, height);
  if (tint !== undefined) {
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const source = m.material as THREE.MeshStandardMaterial;
      const key = `${source.uuid}:${tint}`;
      let tinted = tintedMaterials.get(key);
      if (!tinted) {
        tinted = source.clone();
        tinted.color.multiply(new THREE.Color(tint));
        tintedMaterials.set(key, tinted);
      }
      m.material = tinted;
    });
  }
  const root = new THREE.Group();
  root.add(model);
  const chest = new THREE.Object3D();
  chest.position.y = height * 0.6;
  root.add(chest);
  const mixer = new THREE.AnimationMixer(model);
  if (gltf.animations[0]) mixer.clipAction(gltf.animations[0]).play();
  const bones: Record<string, THREE.Bone> = {};
  const animated = new Set((gltf.animations[0]?.tracks ?? []).map((t) => t.name.split('.')[0]));
  model.updateMatrixWorld(true);
  const inv = model.getWorldQuaternion(new THREE.Quaternion()).invert();
  model.traverse((o) => {
    if (!(o as THREE.Bone).isBone) return;
    bones[o.name] = o as THREE.Bone;
    if (!animated.has(o.name)) o.userData.rest = o.quaternion.clone();
    const parent = o.parent!.getWorldQuaternion(new THREE.Quaternion());
    o.userData.axes = inv.clone().multiply(parent).invert();
  });
  scene.add(root);
  return { root, model, mixer, chest, radius, height, baseY: model.position.y, bones, stride: Math.random() * 6, bar: makeBar(bar) };
}

const X = new THREE.Vector3(1, 0, 0);
const Z = new THREE.Vector3(0, 0, 1);
const tq = new THREE.Quaternion();

const ta = new THREE.Vector3();

function turn(bone: THREE.Bone | undefined, axis: THREE.Vector3, angle: number): void {
  if (!bone || !angle) return;
  ta.copy(axis).applyQuaternion(bone.userData.axes);
  bone.quaternion.premultiply(tq.setFromAxisAngle(ta, angle));
}

type Gait = 'hero' | 'slime' | 'beast' | 'flyer';

function walk(b: Body, kind: Gait, moving: number, dt: number): void {
  b.stride += dt * (kind === 'beast' ? 11 : kind === 'slime' ? 7 : kind === 'flyer' ? 9 : 10) * (kind === 'flyer' ? 1 : Math.max(moving, 0.001));
  const s = Math.sin(b.stride);
  const c = Math.cos(b.stride);
  const w = moving;
  const bn = b.bones;
  for (const bone of Object.values(bn)) if (bone.userData.rest) bone.quaternion.copy(bone.userData.rest);
  if (kind === 'hero') {
    turn(bn.LeftUpperArm, Z, -1.2);
    turn(bn.RightUpperArm, Z, 1.2);
    turn(bn.LeftUpperArm, X, -s * 0.28 * w);
    turn(bn.RightUpperArm, X, s * 0.28 * w);
    turn(bn.LeftUpperLeg, X, s * 0.2 * w);
    turn(bn.RightUpperLeg, X, -s * 0.2 * w);
    turn(bn.LeftLowerLeg, X, Math.max(c, 0) * 0.28 * w);
    turn(bn.RightLowerLeg, X, Math.max(-c, 0) * 0.28 * w);
    turn(bn.Spine, X, 0.06 * w);
    b.model.position.y = b.baseY + Math.abs(c) * 0.025 * w;
  } else if (kind === 'beast') {
    turn(bn.LeftUpperArm, X, s * 0.28 * w);
    turn(bn.RightUpperLeg, X, s * 0.28 * w);
    turn(bn.RightUpperArm, X, -s * 0.28 * w);
    turn(bn.LeftUpperLeg, X, -s * 0.28 * w);
    turn(bn.LeftLowerArm, X, Math.max(c, 0) * 0.25 * w);
    turn(bn.RightLowerArm, X, Math.max(-c, 0) * 0.25 * w);
    turn(bn.Tail1, Z, s * 0.3 * w);
    turn(bn.Head, X, c * 0.08 * w);
    b.model.position.y = b.baseY + Math.abs(c) * 0.02 * w;
  } else if (kind === 'flyer') {
    turn(bn.LeftUpperWing, Z, s * 0.55);
    turn(bn.RightUpperWing, Z, -s * 0.55);
    turn(bn.LeftLowerWing, Z, s * 0.3);
    turn(bn.RightLowerWing, Z, -s * 0.3);
    turn(bn.Tail1, X, c * 0.1);
    turn(bn.Hips, X, 0.25 * w);
    b.model.position.y = b.baseY + (b.fly ?? 0) + Math.sin(b.stride * 0.5) * 0.12;
  } else {
    const hop = Math.abs(Math.sin(b.stride));
    const squash = 1 - 0.18 * (1 - hop) * w;
    b.model.scale.setScalar(b.model.userData.k ?? (b.model.userData.k = b.model.scale.x));
    b.model.scale.y *= squash;
    b.model.scale.x *= 1 + (1 - squash) * 0.6;
    b.model.scale.z *= 1 + (1 - squash) * 0.6;
    b.model.position.y = b.baseY + hop * 0.28 * w;
  }
}

const hero = body(heroGltf, 1.5, 0.45, undefined, 'hero');
const heroLight = new THREE.PointLight(0xffe2c0, 5, 7, 2);
heroLight.position.set(0, 2.6, 0.6);
hero.root.add(heroLight);
const hand = new THREE.Object3D();
hand.position.set(0.35, 1, 0.3);
hero.root.add(hand);
const heroPoseGroup = new THREE.Group();
hero.root.add(heroPoseGroup);
heroPoseGroup.add(hero.model);
const sword = new THREE.Mesh(new THREE.BoxGeometry(1, 0.045, 0.012), new THREE.MeshStandardMaterial({ color: 0xc8d2e0, metalness: 0.9, roughness: 0.25 }));
sword.visible = false;
scene.add(sword);

type Kind = 'slime' | 'beast' | 'stalker' | 'flyer' | 'mage';

interface KindDef {
  gltf: { scene: THREE.Object3D; animations: THREE.AnimationClip[] };
  height: number;
  radius: number;
  tint?: number;
  hp: number;
  dps: number;
  speed: number;
  score: number;
  wave: number;
  gait: Gait;
  fly?: number;
}

const KINDS: Record<Kind, KindDef> = {
  slime: { gltf: slimeGltf, height: 0.9, radius: 0.5, tint: 0x9cff8a, hp: 28, dps: 8, speed: 1.7, score: 1, wave: 1, gait: 'slime' },
  beast: { gltf: beastGltf, height: 1.3, radius: 0.7, tint: 0xffb08a, hp: 50, dps: 14, speed: 2.3, score: 3, wave: 2, gait: 'beast' },
  stalker: { gltf: stalkerGltf, height: 1.25, radius: 0.65, hp: 70, dps: 20, speed: 2.5, score: 5, wave: 3, gait: 'beast' },
  flyer: { gltf: flyerGltf, height: 1.2, radius: 0.6, hp: 90, dps: 26, speed: 2.7, score: 7, wave: 4, gait: 'flyer', fly: 1 },
  mage: { gltf: mageGltf, height: 1.5, radius: 0.45, hp: 100, dps: 32, speed: 1.9, score: 10, wave: 5, gait: 'hero' },
};

type Spell = 'bolt' | 'nova' | 'beam' | 'meteor' | 'heal' | 'warp';

interface Enemy extends Body {
  kind: Kind;
  dps: number;
  cd: Record<Spell, number> | null;
  think: number;
  hand: THREE.Object3D;
  regen: number;
  dot: number;
  moving: number;
  hp: number;
  max: number;
  speed: number;
  alive: boolean;
  frozen: number;
  stunned: number;
  burning: number;
  burnRun: StatusRun | null;
  hop: number;
  spawning: boolean;
  knock: THREE.Vector3;
  lift: number;
  rise: number;
  stagger: number;
}

const enemies: Enemy[] = [];

await fx.prewarm({}, (p) => progress(0.4 + 0.35 * p, 'Compiling effects'));
progress(0.75, 'Compiling status effects');
await fx.prewarmStatus(hero.root, undefined, (p) => progress(0.75 + 0.08 * p, 'Compiling status effects'));
progress(0.83, 'Compiling status effects');
const kindNames = Object.keys(KINDS) as Kind[];
for (const [i, k] of kindNames.entries()) {
  const def = KINDS[k];
  const probe = body(def.gltf, def.height, def.radius, def.tint);
  await fx.prewarmStatus(probe.root);
  scene.remove(probe.root);
  probe.bar.remove();
  progress(0.83 + (0.15 * (i + 1)) / kindNames.length, 'Compiling status effects');
}
progress(1, 'Ready');
loading.remove();

const moves = {
  bolt: effect('projectile', 'fire', { seed: 3, id: 'bolt', params: { count: 1, circleHand: 0, circleFeet: 0, circleTarget: 0 } }),
  nova: effect('nova', 'ice', { seed: 5, id: 'nova' }),
  beam: effect('beam', 'thunder', { seed: 2, id: 'beam' }),
  meteor: effect('meteor', 'fire', { seed: 7, id: 'meteor' }),
  heal: effect('heal', 'light', { seed: 1, id: 'heal' }),
  warp: effect('warp', 'arcane', { seed: 4, id: 'warp' }),
};
fx.add(...Object.values(moves));
const FIST = { color: 0xffa040 };
const melee = {
  'slash-a': effect('slash', 'plain', { seed: 11, id: 'slash-a', params: { mirror: 0, roll: 50 } }),
  'slash-b': effect('slash', 'plain', { seed: 12, id: 'slash-b', params: { mirror: 1, roll: 60 } }),
  rising: effect('rising', 'plain', { seed: 13, id: 'rising' }),
  wave: effect('wave', 'plain', { seed: 14, id: 'wave' }),
  spin: effect('spin', 'plain', { seed: 15, id: 'spin' }),
  flurry: effect('flurry', 'plain', { seed: 16, id: 'flurry', params: { count: 7 } }),
  cleave: effect('cleave', 'plain', { seed: 17, id: 'cleave' }),
  dash: effect('dash', 'plain', { seed: 18, id: 'dash', params: { over: 1.6 } }),
  strike: effect('strike', 'plain', { seed: 21, id: 'strike', ...FIST }),
  palm: effect('palm', 'plain', { seed: 22, id: 'palm', ...FIST }),
  kick: effect('kick', 'plain', { seed: 23, id: 'kick', params: { height: 0.85 }, ...FIST }),
  uppercut: effect('uppercut', 'plain', { seed: 24, id: 'uppercut', ...FIST }),
  rush: effect('rush', 'plain', { seed: 25, id: 'rush', params: { count: 8 }, ...FIST }),
  pound: effect('pound', 'plain', { seed: 26, id: 'pound', ...FIST }),
  tackle: effect('tackle', 'plain', { seed: 27, id: 'tackle', ...FIST }),
};
fx.add(...Object.values(melee));
type Melee = keyof typeof melee;
const FIREWORKS = ['light', 'arcane', 'water', 'fire', 'thunder', 'wind'].map((el, i) => effect('explosion', el, { seed: 20 + i, id: `firework-${el}` }));
fx.add(...FIREWORKS);

for (const i of [0, 3, 4, 7]) fx.loop('torch', pillars[i].clone().multiplyScalar(0.93).setY(0), { scale: 1.3 });
const gates = [new THREE.Vector3(0, 0, -ARENA + 1.2), new THREE.Vector3(0, 0, ARENA - 1.2)];
fx.loop('portal', gates[0], { rotation: 0 });
fx.loop('portal', gates[1], { rotation: Math.PI, element: 'dark' });

const LAST_WAVE = 10;
const ENEMY_SPELL = 0.6;
const fresh = () => ({ hp: 100, wave: 0, score: 0, over: false, cleared: false, time: 0, next: 1.5, spawnLeft: 0, regen: 0, hurt: 0, hurtT: 0, frozen: 0, stunned: 0, burning: 0, introduced: 0, clock: 0 });
const state = fresh();
let heroBurnRun: StatusRun | null = null;
const party: { stop(fade?: number): void }[] = [];
const after5 = () => Math.max(0, state.wave - 5);
const speedMul = () => 1 + 0.04 * after5();
const atkMul = () => 1 + 0.08 * after5();
const waveCount = (w: number) => 3 + 2 * w + Math.max(0, w - 5);
let paused = false;
const menu = document.getElementById('menu')!;

function setPaused(on: boolean): void {
  paused = on;
  menu.hidden = !on;
  keys.clear();
}

menu.querySelector('[data-act="resume"]')!.addEventListener('click', () => setPaused(false));
menu.querySelector('[data-act="restart"]')!.addEventListener('click', () => restart());
const qualitySelect = menu.querySelector('select[data-act="quality"]') as HTMLSelectElement;
qualitySelect.value = fx.qualityPreset;
qualitySelect.addEventListener('change', () => fx.setQuality(qualitySelect.value as 'auto' | 'high' | 'medium' | 'low'));
const COOLDOWN: Record<string, number> = { bolt: 0.35, nova: 5, beam: 3, meteor: 6, heal: 9, warp: 4, combo: 0.3, wave: 1.6, spin: 4, flurry: 7, cleave: 5, dash: 3, kick: 2.5, uppercut: 4, rush: 7, pound: 6, tackle: 3 };
const cooldown: Record<string, number> = Object.fromEntries(Object.keys(COOLDOWN).map((k) => [k, 0]));
const KEYS = ['Click', '1', '2', '3', '4', 'Space'];
const SKILLS: Record<Job, [string, string][]> = {
  mage: [['bolt', 'Fire bolt'], ['nova', 'Ice nova'], ['beam', 'Thunder'], ['meteor', 'Meteor'], ['heal', 'Heal'], ['warp', 'Warp']],
  blade: [['combo', 'Slash'], ['wave', 'Flying slash'], ['spin', 'Spin'], ['flurry', 'Flurry'], ['cleave', 'Cleave'], ['dash', 'Dash'] ],
  fist: [['combo', 'Punch'], ['kick', 'Round kick'], ['uppercut', 'Uppercut'], ['rush', 'Rush'], ['pound', 'Ground pound'], ['tackle', 'Tackle']],
};
const skillBar = document.getElementById('skills')!;
const skillEls = new Map<string, HTMLElement>();
const help = menu.querySelector('p')!;
const jobSelect = menu.querySelector('select[data-act="class"]') as HTMLSelectElement;

function skillsHtml(): string {
  return SKILLS[job].map(([, name], i) => `${KEYS[i] === 'Click' ? 'click' : KEYS[i]} ${name.toLowerCase()}`).join(' · ');
}

function buildSkills(): void {
  skillBar.innerHTML = '';
  skillEls.clear();
  for (const [i, [id, name]] of SKILLS[job].entries()) {
    const el = document.createElement('div');
    el.className = 'skill';
    el.innerHTML = `<b>${KEYS[i]}</b>${name}<i></i>`;
    skillBar.append(el);
    skillEls.set(id, el.querySelector('i')!);
  }
  help.textContent = `WASD move · mouse aim · ${skillsHtml()}`;
  jobSelect.value = job;
}
buildSkills();
jobSelect.addEventListener('change', () => setJob(jobSelect.value as Job));
const hpBar = document.querySelector('#hp > div') as HTMLElement;
const info = document.getElementById('info')!;
const center = document.getElementById('center')!;

function title(): void {
  const jobs = JOBS.map((j) => `<button data-job="${j}"${j === job ? ' class="on"' : ''}>${JOB_NAMES[j]}</button>`).join('');
  center.innerHTML = `<h1>Rollshade Arena</h1><div class="jobs">${jobs}</div><div>WASD to move · mouse to aim · click, 1–4 and Space to ${job === 'mage' ? 'cast' : 'attack'} · Esc for the menu</div>`;
  for (const b of center.querySelectorAll<HTMLButtonElement>('button[data-job]')) b.addEventListener('pointerdown', (e) => (e.stopPropagation(), setJob(b.dataset.job as Job)));
}
title();

function setJob(next: Job): void {
  if (next !== job) {
    job = next;
    const url = new URL(location.href);
    if (job === 'mage') url.searchParams.delete('class');
    else url.searchParams.set('class', job);
    history.replaceState(null, '', url);
    buildSkills();
  }
  if (started) restart();
  else title();
}

const keys = new Set<string>();
const aim = new THREE.Vector3(0, 0, 3);
const mouse = new THREE.Vector2();
const ray = new THREE.Raycaster();
const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    setPaused(!paused);
    return;
  }
  if (paused) return;
  keys.add(e.code);
  const slot = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Space'].indexOf(e.code);
  if (slot >= 0) {
    e.preventDefault();
    use(slot + 1);
  }
  if (e.code === 'KeyR' && state.over) restart();
  if (e.code === 'KeyC') {
    codeShown = !codeShown;
    codeBox.hidden = !codeShown || !codeBody.textContent;
  }
});
addEventListener('keyup', (e) => keys.delete(e.code));
view.addEventListener('pointermove', (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
});
view.addEventListener('pointerdown', () => !paused && use(0));
addEventListener('blur', () => started && !state.over && setPaused(true));

function updateAim(): void {
  ray.setFromCamera(mouse, camera);
  ray.ray.intersectPlane(ground, aim);
  const r = Math.hypot(aim.x, aim.z);
  if (r > ARENA) aim.multiplyScalar(ARENA / r);
}

const flat = (a: THREE.Vector3, b: THREE.Vector3) => Math.hypot(a.x - b.x, a.z - b.z);

function nearest(p: THREE.Vector3, max: number): Enemy | null {
  let best: Enemy | null = null;
  let d = max;
  for (const e of enemies) {
    if (!e.alive || e.spawning) continue;
    const k = flat(e.root.position, p);
    if (k < d) {
      d = k;
      best = e;
    }
  }
  return best;
}

const popPos = new THREE.Vector3();

function pop(at: THREE.Vector3, text: string, kind: string): void {
  popPos.copy(at).project(camera);
  if (popPos.z > 1) return;
  const el = document.createElement('div');
  el.className = `pop ${kind}`;
  el.textContent = text;
  el.style.left = `${(popPos.x * 0.5 + 0.5) * innerWidth + (Math.random() - 0.5) * 24}px`;
  el.style.top = `${(-popPos.y * 0.5 + 0.5) * innerHeight}px`;
  labels.append(el);
  setTimeout(() => el.remove(), 900);
}

const head = (b: Body) => b.root.position.clone().setY(b.height + (b.fly ?? 0) + 0.35);

function damage(e: Enemy, amount: number, show = true): void {
  if (!e.alive) return;
  e.hp -= amount;
  if (show) pop(head(e), String(Math.max(1, Math.round(amount))), 'hit');
  else {
    e.dot += amount;
    if (e.dot >= 3) {
      pop(head(e), String(Math.round(e.dot)), 'dot');
      e.dot = 0;
    }
  }
  if (e.hp > 0) return;
  e.alive = false;
  state.score += e.kind === 'beast' ? 3 : 1;
  if (job !== 'mage' && !state.over) {
    state.hp = Math.min(state.hp + 3, 100);
    pop(head(hero), '+3', 'heal');
  }
  for (const r of fx.statusesOf(e.root)) if (r.name !== 'dissolve') r.stop(0.2);
  fx.status(e.root, 'dissolve', { duration: 1.1 }).on('full', () => {
    for (const r of fx.statusesOf(e.root)) r.finish();
    scene.remove(e.root);
    e.root.traverse((o) => o.dispose());
    e.bar.remove();
    enemies.splice(enemies.indexOf(e), 1);
  });
}

function around(h: { point: THREE.Vector3; hitStop: number }, p: THREE.Vector3, r: number, fn: (e: Enemy) => void): void {
  let n = 0;
  for (const e of [...enemies])
    if (e.alive && !e.spawning && flat(e.root.position, p) < r + e.radius) {
      fn(e);
      n++;
    }
  if (n > 0 && h.hitStop > 0) fx.hitStop(h.hitStop * 0.5);
}

function burn(e: Enemy, seconds: number): void {
  if (!e.alive) return;
  e.burning = Math.max(e.burning, seconds);
  if (!e.burnRun?.alive) e.burnRun = fx.status(e.root, 'burn');
}

function cast(id: string, name: string): void {
  if (state.over || cooldown[id] > 0 || state.frozen > 0 || state.stunned > 0) return;
  cooldown[id] = COOLDOWN[id as Spell];
  showCode(id, name);
  const from = hand;
  if (id === 'bolt') {
    const target = nearest(aim, 2.5);
    fx.play('bolt', { from, to: target ? target.chest : aim.clone().setY(0.6) }).on('hit', (h) =>
      around(h, h.point, 0.9, (e) => {
        damage(e, 14 * h.power);
        burn(e, 2);
      }),
    );
  } else if (id === 'nova') {
    fx.play('nova', { from: hero.chest, to: aim, scale: 0.55 }).on('hit', (h) =>
      around(h, hero.root.position, 4.2, (e) => {
        damage(e, 10 * h.power);
        if (!e.alive) return;
        e.frozen = 2.6;
        const run = fx.status(e.root, 'freeze', { duration: 0.35 });
        setTimeout(() => run.stop(0.2), 2600);
      }),
    );
  } else if (id === 'beam') {
    const target = nearest(aim, 3.5);
    fx.play('beam', { from, to: target ? target.chest : aim.clone().setY(0.6) }).on('hit', (h) =>
      around(h, h.point, 1, (e) => {
        damage(e, 5 * h.power);
        if (!e.alive || e.stunned > 0) return;
        e.stunned = 1.6;
        const s = fx.status(e.root, 'shock');
        const t = fx.status(e.root, 'stun');
        setTimeout(() => (s.stop(0.2), t.stop(0.2)), 1600);
      }),
    );
  } else if (id === 'meteor') {
    fx.play('meteor', { from, to: aim.clone(), scale: 0.75 }).on('hit', (h) =>
      around(h, h.point, 2.2, (e) => {
        damage(e, 16 * h.power);
        burn(e, 3);
      }),
    );
  } else if (id === 'heal') {
    fx.play('heal', { from, to: hero.chest }).on('hit', () => {
      state.regen = 4;
      const b = fx.status(hero.root, 'bless');
      setTimeout(() => b.stop(0.4), 4000);
    });
  } else if (id === 'warp') {
    const to = aim.clone();
    fx.play('warp', { from: hero.chest, to }).on('appear', (h) => hero.root.position.set(h.point.x, 0, h.point.z));
  }
}

const play = (name: string, def: string, to: string, hit: string[]) => [`fx.add(effect(${def}));`, `fx.play('${name}', { from: hero.hand, to: ${to} })`, `  .on('hit', (e) => {`, ...hit.map((l) => `    ${l}`), `  });`];
const strike = (name: string, color = '') => play(name, `'${name}', 'plain', { id: '${name}'${color} }`, 'enemy', ['enemy.hp -= 13 * e.power;', 'knockBack(enemy, e.dir, e.power);']);
const CODE: Record<string, string[]> = {
  bolt: play('bolt', `'projectile', 'fire', { id: 'bolt' }`, 'enemy', ['enemy.hp -= 14 * e.power;', "fx.status(enemy, 'burn');"]),
  nova: play('nova', `'nova', 'ice', { id: 'nova' }`, 'aim', ['for (const foe of near(hero, 4))', "  fx.status(foe, 'freeze', { lasts: 2.6 });"]),
  beam: play('beam', `'beam', 'thunder', { id: 'beam' }`, 'enemy', ["fx.status(enemy, 'shock', { lasts: 1.6 });", "fx.status(enemy, 'stun', { lasts: 1.6 });"]),
  meteor: play('meteor', `'meteor', 'fire', { id: 'meteor' }`, 'aim', ['for (const foe of near(e.point, 2.2))', '  foe.hp -= 16 * e.power;']),
  heal: play('heal', `'heal', 'light', { id: 'heal' }`, 'hero', ['hero.hp += 56;', "fx.status(hero, 'bless', { lasts: 4 });"]),
  warp: [`fx.add(effect('warp', 'arcane', { id: 'warp' }));`, `fx.play('warp', { from: hero, to: aim })`, `  .on('appear', (e) => hero.position.copy(e.point));`],
  'slash-a': strike('slash'),
  'slash-b': strike('slash'),
  rising: strike('rising'),
  wave: strike('wave'),
  spin: strike('spin'),
  flurry: strike('flurry'),
  cleave: strike('cleave'),
  dash: strike('dash'),
  strike: strike('strike', ', color: 0xffa040'),
  palm: strike('palm', ', color: 0xffa040'),
  kick: strike('kick', ', color: 0xffa040'),
  uppercut: strike('uppercut', ', color: 0xffa040'),
  rush: strike('rush', ', color: 0xffa040'),
  pound: strike('pound', ', color: 0xffa040'),
  tackle: strike('tackle', ', color: 0xffa040'),
};
const MADE = `<div style="pointer-events:auto">Every effect here is one <code>fx.play()</code> call · <a href="https://rollshade.tsuyatt.com/guide/#npm" target="_blank" rel="noopener">use them in your game</a></div>`;
const codeBox = document.getElementById('code')!;
const codeBody = codeBox.querySelector('pre')!;
const codeName = codeBox.querySelector('b')!;
const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const paint = (t: string) => esc(t).replace(/('[^']*'|`[^`]*`)|\b(\d+(?:\.\d+)?|0x[0-9a-f]+)\b|\b(fx|effect)\b(?=[.(])/g, (m, str, num) => (str ? `<em>${m}</em>` : num ? `<u>${m}</u>` : `<s>${m}</s>`));
let codeShown = !matchMedia('(max-width: 700px)').matches;

function showCode(id: string, name: string): void {
  const lines = CODE[id];
  if (!lines) return;
  codeName.textContent = name;
  codeBody.innerHTML = lines.map(paint).join('\n');
  codeBox.hidden = !codeShown;
}

const RANGE: Partial<Record<Melee, number>> = { wave: 9, dash: 7, tackle: 6, pound: 4.5, spin: 2.4 };
const LOCK: Record<Melee, number> = { 'slash-a': 0.3, 'slash-b': 0.3, rising: 0.36, wave: 0.3, spin: 0.5, flurry: 0.95, cleave: 0.5, dash: 0.5, strike: 0.42, palm: 0.38, kick: 0.4, uppercut: 0.42, rush: 0.95, pound: 0.6, tackle: 0.5 };
const AREA: Partial<Record<Melee, number>> = { spin: 2.5, kick: 1.5, wave: 1.3, pound: 3.6, cleave: 1.3, uppercut: 1.2 };
const CHAINS: Record<Exclude<Job, 'mage'>, Melee[]> = { blade: ['slash-a', 'slash-b', 'rising'], fist: ['strike', 'strike', 'palm'] };

interface Action {
  handle: FXHandle;
  move: Melee;
  dir: THREE.Vector3;
  lock: number;
  carry: boolean;
  went: number;
}

let action: Action | null = null;
let queued: number | null = null;
const chain = { n: 0, t: -10 };
const heroPose = { off: new THREE.Vector3(), lean: 0, turn: 0 };

function use(slot: number): void {
  if (!started) {
    started = true;
    center.innerHTML = '';
  }
  const [id, name] = SKILLS[job][slot];
  if (job === 'mage') cast(id, name);
  else if (action && action.lock > 0) queued = slot;
  else attack(id);
}

function targetFor(range: number): Enemy | null {
  let best: Enemy | null = null;
  let score = Infinity;
  for (const e of enemies) {
    if (!e.alive || e.spawning) continue;
    const d = flat(e.root.position, hero.root.position);
    if (d > range + e.radius) continue;
    const k = flat(e.root.position, aim) + d * 0.5;
    if (k < score) {
      score = k;
      best = e;
    }
  }
  return best;
}

function attack(id: string): void {
  if (state.over || cooldown[id] > 0 || state.frozen > 0 || state.stunned > 0) return;
  let move = id as Melee;
  if (id === 'combo') {
    const list = CHAINS[job as Exclude<Job, 'mage'>];
    if (state.time - chain.t > 0.8) chain.n = 0;
    move = list[chain.n];
    chain.n = (chain.n + 1) % list.length;
    cooldown.combo = chain.n === 0 ? 0.5 : COOLDOWN.combo;
  } else cooldown[id] = COOLDOWN[id];
  const target = targetFor(RANGE[move] ?? 2.6);
  const from = hero.chest.getWorldPosition(new THREE.Vector3());
  const dir = (target ? target.root.position : aim).clone().sub(hero.root.position).setY(0);
  if (dir.lengthSq() < 1e-4) dir.set(Math.sin(hero.root.rotation.y), 0, Math.cos(hero.root.rotation.y));
  dir.normalize();
  const to = target ? target.chest : from.clone().addScaledVector(dir, move === 'wave' ? 5 : move === 'dash' || move === 'tackle' ? 3 : 1.8);
  const handle = fx.play(move, { from, to, scale: 0.8 });
  showCode(move, SKILLS[job].find(([k]) => k === id)![1]);
  action = { handle, move, dir, lock: LOCK[move], carry: move === 'dash' || move === 'tackle', went: 0 };
  handle.on('hit', (h) => meleeHit(move, h));
  chain.t = state.time + LOCK[move];
}

function knock(e: Enemy, dir: THREE.Vector3, power: number): void {
  const k = Math.min(power, 2.2) / (0.4 + e.radius);
  e.stagger = Math.max(e.stagger, 0.2 + 0.1 * power);
  e.knock.x += dir.x * 3 * k;
  e.knock.z += dir.z * 3 * k;
  if (dir.y > 0.5) {
    e.rise = Math.max(e.rise, 3 + 2 * k);
    e.stagger = Math.max(e.stagger, 0.8);
  } else if (dir.y < -0.5) e.stagger = Math.max(e.stagger, 0.7);
}

function meleeHit(move: Melee, h: HitEvent): void {
  const at = move === 'spin' || move === 'pound' ? hero.root.position : h.point;
  around(h, at, AREA[move] ?? 1, (e) => {
    damage(e, (job === 'fist' ? 12 : 13) * h.power);
    if (!e.alive) return;
    const dir = move === 'spin' || move === 'pound' ? e.root.position.clone().sub(hero.root.position).setY(0).normalize().setY(h.dir.y) : h.dir;
    knock(e, dir, h.power);
  });
}

function pickKind(): Kind {
  const avail = kindNames.filter((k) => KINDS[k].wave <= state.wave);
  const newest = avail[avail.length - 1];
  if (KINDS[newest].wave === state.wave && state.introduced < 2) {
    state.introduced++;
    return newest;
  }
  const mages = enemies.filter((e) => e.alive && e.kind === 'mage').length;
  const pool = avail.filter((k) => k !== 'mage' || mages < 1 + Math.floor(after5() / 4));
  const weights = pool.map((k) => 1 / (1 + (KINDS[k].wave - 1) * 0.6));
  let pick = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) if ((pick -= weights[i]) <= 0) return pool[i];
  return pool[0];
}

function spawn(): void {
  const gate = gates[Math.floor(Math.random() * gates.length)];
  const kind = pickKind();
  const def = KINDS[kind];
  const b = body(def.gltf, def.height, def.radius, def.tint);
  b.fly = def.fly;
  b.chest.position.y += def.fly ?? 0;
  b.root.position.copy(gate).add(new THREE.Vector3((Math.random() - 0.5) * 2, 0, gate.z > 0 ? -1 : 1));
  const hand = new THREE.Object3D();
  hand.position.set(0.35, 1, 0.3);
  b.root.add(hand);
  const caster = kind === 'mage';
  const cd = caster ? { bolt: 1.5, nova: 3, beam: 2, meteor: 4, heal: 6, warp: 3 } : null;
  const e: Enemy = { ...b, kind, hp: def.hp, max: def.hp, speed: def.speed * speedMul(), dps: def.dps * atkMul(), cd, think: 1.5 + Math.random(), hand, regen: 0, alive: true, frozen: 0, stunned: 0, burning: 0, burnRun: null, hop: Math.random() * 6, spawning: true, dot: 0, moving: 0, knock: new THREE.Vector3(), lift: 0, rise: 0, stagger: 0 };
  enemies.push(e);
  fx.status(b.root, 'appear', { element: gate.z > 0 ? 'dark' : 'arcane' }).on('end', () => (e.spawning = false));
}

function heroDamage(amount: number): void {
  if (state.over) return;
  state.hp -= amount;
  pop(head(hero), String(Math.max(1, Math.round(amount))), 'hurt');
}

function heroBurn(seconds: number): void {
  if (state.over) return;
  state.burning = Math.max(state.burning, seconds);
  if (!heroBurnRun?.alive) heroBurnRun = fx.status(hero.root, 'burn');
}

function heroFreeze(seconds: number): void {
  if (state.over) return;
  if (state.frozen <= 0) {
    const run = fx.status(hero.root, 'freeze', { duration: 0.35 });
    setTimeout(() => run.stop(0.2), seconds * 1000);
  }
  state.frozen = Math.max(state.frozen, seconds);
}

function heroStun(seconds: number): void {
  if (state.over || state.stunned > 0) return;
  state.stunned = seconds;
  const a = fx.status(hero.root, 'shock');
  const b = fx.status(hero.root, 'stun');
  setTimeout(() => (a.stop(0.2), b.stop(0.2)), seconds * 1000);
}

function heroHit(h: { point: THREE.Vector3; hitStop: number }, at: THREE.Vector3, r: number, amount: number, extra: () => void): void {
  if (state.over) return;
  const d = Math.hypot(hero.root.position.x - at.x, hero.root.position.z - at.z);
  if (d > r + hero.radius) return;
  heroDamage(amount);
  extra();
  if (h.hitStop > 0) fx.hitStop(h.hitStop * 0.5);
}

function enemyCast(e: Enemy, spell: Spell): void {
  e.cd![spell] = COOLDOWN[spell];
  const k = ENEMY_SPELL * atkMul();
  if (spell === 'bolt') fx.play('bolt', { from: e.hand, to: hero.chest }).on('hit', (h) => heroHit(h, h.point, 0.9, 14 * h.power * k, () => heroBurn(2)));
  else if (spell === 'nova') fx.play('nova', { from: e.chest, to: hero.chest, scale: 0.55 }).on('hit', (h) => heroHit(h, e.root.position, 4.2, 10 * h.power * k, () => heroFreeze(1.3)));
  else if (spell === 'beam') fx.play('beam', { from: e.hand, to: hero.chest }).on('hit', (h) => heroHit(h, h.point, 1, 5 * h.power * k, () => heroStun(0.8)));
  else if (spell === 'meteor') fx.play('meteor', { from: e.hand, to: hero.root.position.clone(), scale: 0.75 }).on('hit', (h) => heroHit(h, h.point, 2.2, 16 * h.power * k, () => heroBurn(3)));
  else if (spell === 'heal')
    fx.play('heal', { from: e.hand, to: e.chest }).on('hit', () => {
      if (!e.alive) return;
      e.regen = 4;
      const b = fx.status(e.root, 'bless');
      setTimeout(() => b.stop(0.4), 4000);
    });
  else if (spell === 'warp') {
    const away = e.root.position.clone().sub(hero.root.position).setY(0).normalize();
    const to = e.root.position.clone().addScaledVector(away.applyAxisAngle(new THREE.Vector3(0, 1, 0), (Math.random() - 0.5) * 1.5), 4);
    const r = Math.hypot(to.x, to.z);
    if (r > ARENA - 1) to.multiplyScalar((ARENA - 1) / r);
    fx.play('warp', { from: e.chest, to }).on('appear', (h) => e.alive && e.root.position.set(h.point.x, 0, h.point.z));
  }
}

function think(e: Enemy, d: number): void {
  const cd = e.cd!;
  e.think = (0.9 + Math.random() * 0.8) / Math.sqrt(atkMul());
  const ready = (s: Spell) => cd[s] <= 0;
  let pick: Spell | null = null;
  if (d < 3.5 && ready('nova')) pick = 'nova';
  else if (e.hp < e.max * 0.5 && ready('heal')) pick = 'heal';
  else if (d < 2.6 && ready('warp')) pick = 'warp';
  else if (ready('meteor') && Math.random() < 0.35) pick = 'meteor';
  else if (ready('beam') && d < 8 && Math.random() < 0.5) pick = 'beam';
  else if (ready('bolt')) pick = 'bolt';
  if (pick) enemyCast(e, pick);
}

function victory(): void {
  state.over = true;
  state.cleared = true;
  for (const r of fx.statusesOf(hero.root)) r.stop(0.3);
  party.push(fx.loop('aura', hero.root, { element: 'light' }));
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
    party.push(fx.loop('beacon', new THREE.Vector3(Math.cos(a) * 5, 0, Math.sin(a) * 5), { element: (['light', 'arcane', 'water', 'fire'] as const)[i] }));
  }
  let n = 0;
  const burst = () => {
    if (!state.cleared) return;
    const a = Math.random() * Math.PI * 2;
    const r = 2.5 + Math.random() * 4;
    fx.play(FIREWORKS[n++ % FIREWORKS.length].id, { from: hero.chest, to: new THREE.Vector3(Math.cos(a) * r, 0.5, Math.sin(a) * r), scale: 0.8 });
    if (n < 24) setTimeout(burst, 350 + Math.random() * 300);
  };
  burst();
  const m = Math.floor(state.clock / 60);
  const sec = String(Math.floor(state.clock % 60)).padStart(2, '0');
  center.innerHTML = `<div class="box"><h1>Clear!</h1><div>All ${LAST_WAVE} waves · score ${state.score} · ${m}:${sec}</div><div class="thanks">Thank you for playing Rollshade Arena!</div><div>R to play again · Esc for the menu</div>${MADE}</div>`;
}

function restart(): void {
  for (const e of enemies) {
    for (const r of fx.statusesOf(e.root)) r.finish();
    scene.remove(e.root);
    e.root.traverse((o) => o.dispose());
    e.bar.remove();
  }
  setPaused(false);
  enemies.length = 0;
  for (const r of fx.statusesOf(hero.root)) r.stop(0);
  for (const p of party.splice(0)) p.stop(0.4);
  Object.assign(state, fresh());
  heroBurnRun = null;
  action = null;
  queued = null;
  chain.n = 0;
  for (const k in cooldown) cooldown[k] = 0;
  hero.root.position.set(0, 0, 0);
  hero.mixer.timeScale = 1;
  center.innerHTML = '';
}

function gameOver(): void {
  state.over = true;
  hero.mixer.timeScale = 0;
  for (const r of fx.statusesOf(hero.root)) r.finish();
  fx.status(hero.root, 'petrify', { duration: 1.2 });
  center.innerHTML = `<div class="box"><h1>Petrified</h1><div>Wave ${state.wave}/${LAST_WAVE} · score ${state.score} · press R to try again or Esc for the menu</div>${MADE}</div>`;
}

function resize(): void {
  renderer.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);
resize();

const move = new THREE.Vector3();
const ZERO = new THREE.Vector3();
const local = new THREE.Vector3();
const fps = { frames: 0, time: 0, value: 0, worst: 0, lastWorst: 0, cpu: 0 };
let heroMoving = 0;
let closeUp = false;
let facing: number | null = null;
const timer = new THREE.Timer();
let started = false;
const screen = new THREE.Vector3();

function placeBar(b: Body, hp: number, max: number, show: boolean): void {
  screen.copy(head(b)).project(camera);
  const visible = show && screen.z < 1;
  b.bar.style.display = visible ? '' : 'none';
  if (!visible) return;
  b.bar.style.transform = `translate(${(screen.x * 0.5 + 0.5) * innerWidth}px, ${(-screen.y * 0.5 + 0.5) * innerHeight}px)`;
  (b.bar.firstElementChild as HTMLElement).style.width = `${Math.max(hp / max, 0) * 100}%`;
}

renderer.setAnimationLoop((ms) => {
  timer.update(ms);
  if (paused) {
    fx.render();
    return;
  }
  const raw = timer.getDelta();
  const real = Math.min(raw, 0.05);
  fps.frames++;
  fps.time += raw;
  fps.worst = Math.max(fps.worst, raw);
  if (fps.time >= 0.5) {
    fps.value = fps.frames / fps.time;
    fps.lastWorst = fps.worst;
    fps.worst = 0;
    fps.frames = 0;
    fps.time = 0;
  }
  const dt = fx.hitStopping ? real * 0.04 : real;
  state.time += dt;
  if (started && !state.over) state.clock += dt;
  if (!started && keys.size) {
    started = true;
    center.innerHTML = '';
  }
  for (const k in cooldown) cooldown[k] = Math.max(cooldown[k] - dt, 0);

  state.frozen = Math.max(state.frozen - dt, 0);
  state.stunned = Math.max(state.stunned - dt, 0);
  if (state.burning > 0 && !state.over) {
    state.burning -= dt;
    const burnt = 6 * ENEMY_SPELL * atkMul() * dt;
    state.hp -= burnt;
    state.hurt += burnt;
    if (state.burning <= 0) heroBurnRun?.stop(0.3);
  }
  const held = state.frozen > 0 || state.stunned > 0;
  if (!state.over) {
    move.set((keys.has('KeyD') ? 1 : 0) - (keys.has('KeyA') ? 1 : 0), 0, (keys.has('KeyS') ? 1 : 0) - (keys.has('KeyW') ? 1 : 0));
    const busy = action !== null && action.lock > 0;
    if (held || busy) move.set(0, 0, 0);
    if (move.lengthSq() > 0) hero.root.position.addScaledVector(move.normalize(), 5 * dt);
    if (action?.carry && action.handle.playing) {
      const along = action.handle.body.offset.dot(action.dir);
      if (along > action.went) {
        hero.root.position.addScaledVector(action.dir, along - action.went);
        action.went = along;
      }
    }
    const r = Math.hypot(hero.root.position.x, hero.root.position.z);
    if (r > ARENA - 0.5) hero.root.position.multiplyScalar((ARENA - 0.5) / r);
    updateAim();
    hero.root.rotation.y = facing ?? (busy ? Math.atan2(action!.dir.x, action!.dir.z) : Math.atan2(aim.x - hero.root.position.x, aim.z - hero.root.position.z));
    if (action && (action.lock -= dt) <= 0 && queued !== null) {
      const id = SKILLS[job][queued][0];
      if (cooldown[id] > 0.25) queued = null;
      else if (cooldown[id] <= 0) {
        queued = null;
        attack(id);
      }
    }

    if (state.regen > 0) {
      state.regen -= dt;
      state.hp = Math.min(state.hp + 14 * dt, 100);
    }
  }

  if (started && !state.over) {
    state.next -= dt;
    if (state.spawnLeft === 0 && enemies.length === 0 && state.next <= 0) {
      if (state.wave >= LAST_WAVE) victory();
      else {
        state.wave++;
        state.spawnLeft = waveCount(state.wave);
        state.introduced = 0;
        state.next = 0.3;
      }
    }
    if (!state.over && state.spawnLeft > 0 && state.next <= 0) {
      spawn();
      state.spawnLeft--;
      state.next = Math.max(1.4 - state.wave * 0.08, 0.5);
    }
  }

  for (const e of enemies) {
    e.mixer.update(e.frozen > 0 ? 0 : dt);
    if (e.knock.lengthSq() > 1e-4 || e.lift > 0 || e.rise > 0) {
      e.root.position.addScaledVector(e.knock, dt);
      e.knock.multiplyScalar(Math.exp(-dt * 7));
      e.lift += e.rise * dt;
      e.rise -= 24 * dt;
      if (e.lift <= 0) e.lift = e.rise = 0;
      e.root.position.y = e.lift;
      const r = Math.hypot(e.root.position.x, e.root.position.z);
      if (r > ARENA - 0.6) e.root.position.multiplyScalar((ARENA - 0.6) / r);
      if (e.knock.lengthSq() <= 1e-4) e.knock.set(0, 0, 0);
    }
    e.stagger = Math.max(e.stagger - dt, 0);
    if (!e.alive) continue;
    if (e.burning > 0) {
      e.burning -= dt;
      damage(e, 6 * dt, false);
      if (e.burning <= 0) e.burnRun?.stop(0.3);
    }
    e.frozen = Math.max(e.frozen - dt, 0);
    e.stunned = Math.max(e.stunned - dt, 0);
    if (e.regen > 0) {
      e.regen -= dt;
      e.hp = Math.min(e.hp + 9 * dt, e.max);
    }
    if (e.cd) for (const k in e.cd) e.cd[k as Spell] = Math.max(e.cd[k as Spell] - dt, 0);
    if (e.spawning || e.frozen > 0 || e.stunned > 0 || e.stagger > 0 || e.lift > 0 || state.over) continue;
    const to = hero.root.position.clone().sub(e.root.position).setY(0);
    const d = to.length();
    e.root.rotation.y = Math.atan2(to.x, to.z);
    const touching = d <= e.radius + hero.radius;
    let step = 0;
    if (e.cd) {
      if ((e.think -= dt) <= 0) think(e, d);
      const dir = to.clone().normalize();
      if (d > 6.5) step = 1;
      else if (d < 4) step = -1;
      else {
        dir.set(-dir.z, 0, dir.x);
        step = Math.sin(state.time * 0.7 + e.stride) > 0 ? 0.5 : -0.5;
      }
      if (!touching || step < 0) e.root.position.addScaledVector(dir, step * e.speed * dt);
      const r = Math.hypot(e.root.position.x, e.root.position.z);
      if (r > ARENA - 0.6) e.root.position.multiplyScalar((ARENA - 0.6) / r);
    } else if (!touching) {
      step = 1;
      e.root.position.addScaledVector(to.normalize(), e.speed * dt);
    }
    e.moving = step !== 0 ? Math.min(e.moving + dt * 6, 1) : Math.max(e.moving - dt * 6, 0);
    if (touching) {
      const hurt = e.dps * dt;
      state.hp -= hurt;
      state.hurt += hurt;
    }
    for (const o of enemies) {
      if (o === e || !o.alive) continue;
      const push = e.root.position.clone().sub(o.root.position).setY(0);
      const gap = e.radius + o.radius - push.length();
      if (gap > 0) e.root.position.addScaledVector(push.normalize(), gap * 0.5);
    }
  }
  for (const e of enemies) {
    const still = !e.alive || e.spawning || e.frozen > 0 || e.stunned > 0 || e.stagger > 0 || e.lift > 0 || state.over;
    walk(e, KINDS[e.kind].gait, still ? 0 : e.moving, e.frozen > 0 ? 0 : dt);
  }
  state.hurtT -= dt;
  if (state.hurt >= 1 && state.hurtT <= 0) {
    pop(head(hero), String(Math.round(state.hurt)), 'hurt');
    state.hurt = 0;
    state.hurtT = 0.45;
  }
  if (!state.over && !state.cleared && state.hp <= 0) {
    state.hp = 0;
    gameOver();
  }

  hero.mixer.update(state.over || state.frozen > 0 ? 0 : dt);
  heroMoving = Math.min(Math.max(heroMoving + (move.lengthSq() > 0 && !state.over && !held ? dt : -dt) * 7, 0), 1);
  walk(hero, 'hero', heroMoving, state.over || state.frozen > 0 ? 0 : dt);
  const live = action?.handle.playing ? action.handle.body : null;
  const follow = 1 - Math.exp(-real * 22);
  heroPose.off.lerp(live && !action!.carry ? live.offset : ZERO, follow);
  heroPose.lean += ((live?.lean ?? 0) - heroPose.lean) * follow;
  heroPose.turn += ((live?.turn ?? 0) - heroPose.turn) * follow;
  local.copy(heroPose.off).applyAxisAngle(UP, -hero.root.rotation.y);
  heroPoseGroup.position.copy(local);
  heroPoseGroup.rotation.set(heroPose.lean, heroPose.turn, 0);
  const blade = action?.handle.playing ? action.handle.blade : null;
  sword.visible = !!blade?.active;
  if (blade?.active) {
    sword.position.copy(blade.base).lerp(blade.tip, 0.5);
    sword.scale.set(blade.base.distanceTo(blade.tip), 1, 1);
    sword.quaternion.setFromUnitVectors(X, local.copy(blade.tip).sub(blade.base).normalize());
  }
  const focus = hero.root.position;
  if (closeUp) {
    camera.position.set(focus.x + 2.6, 0.8, focus.z);
    camera.lookAt(focus.x, 0.7, focus.z);
  } else {
    camera.position.set(focus.x * 0.7, 10.5, focus.z * 0.7 + 8.5);
    camera.lookAt(focus.x * 0.7, 0.4, focus.z * 0.7 - 0.2);
  }

  const cpu0 = performance.now();
  fx.update(real);
  fx.render();
  fps.cpu = Math.max(fps.cpu, performance.now() - cpu0);

  hpBar.style.width = `${state.hp}%`;
  placeBar(hero, state.hp, 100, !state.over);
  for (const e of enemies) placeBar(e, e.hp, e.max, e.alive && !e.spawning);
  const scale = fx.renderScale < 0.999 ? ` · resolution ${Math.round(fx.renderScale * 100)}%` : '';
  info.textContent = `Wave ${state.wave}/${LAST_WAVE} · score ${state.score} · enemies ${enemies.filter((e) => e.alive).length} · ${Math.round(fps.value)} fps${scale}`;
  for (const [id, el] of skillEls) el.style.height = held ? '100%' : `${Math.min(cooldown[id] / COOLDOWN[id], 1) * 100}%`;
});

if (params.has('test')) {
  Object.assign(window, {
    demo: {
      worst: () => Math.max(fps.worst, fps.lastWorst),
      cpu: () => {
        const v = fps.cpu;
        fps.cpu = 0;
        return v;
      },
      fx,
      enemyRoots: () => enemies.filter((e) => e.alive && !e.spawning).map((e) => e.root),
      enemyAt: (kind: string) => enemies.filter((e) => e.kind === kind && e.alive && !e.spawning).map((e) => ({ x: e.root.position.x, z: e.root.position.z, hp: Math.round(e.hp), max: e.max }))[0] ?? null,
      state: () => ({ ...state, enemies: enemies.map((e) => ({ kind: e.kind, max: e.max, speed: +e.speed.toFixed(2), dps: +e.dps.toFixed(1), hp: Math.round(e.hp), alive: e.alive, statuses: fx.statusesOf(e.root).map((r) => r.name) })), stats: fx.stats() }),
      aimAt: (x: number, z: number) => {
        aim.set(x, 0, z);
        mouse.copy(new THREE.Vector3(x, 0, z).project(camera) as unknown as THREE.Vector2);
      },
      cast,
      use,
      setJob,
      job: () => job,
      pause: setPaused,
      closeUp: (on: boolean) => (closeUp = on),
      face: (angle: number | null) => (facing = angle),
      paused: () => paused,
      hitStopping: () => fx.hitStopping,
      press: (code: string, on: boolean) => (on ? keys.add(code) : keys.delete(code)),
      setWave: (n: number) => {
        for (const e of enemies) {
          for (const r of fx.statusesOf(e.root)) r.finish();
          scene.remove(e.root);
          e.bar.remove();
        }
        enemies.length = 0;
        state.wave = n - 1;
        state.spawnLeft = 0;
        state.next = 0;
      },
      heal: () => (state.hp = 100),
      restart,
      win: () => victory(),
      start: () => {
        started = true;
        center.innerHTML = '';
      },
    },
  });
}
(window as unknown as { ready: boolean }).ready = true;
