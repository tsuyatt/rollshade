import * as THREE from 'three/webgpu';
import { abs, atan, billboarding, float, length, mix, normalView, positionLocal, positionViewDirection, dot, pow, sin, smoothstep, uniform, uv, vec2, vec3 } from 'three/tsl';
import { Ctx, ease, poisson } from './ctx';
import { CIRCLES } from './elements';
import type { Prim } from './prims';
import { tnoise } from './noise';
import type { HeldLight } from './lights';
import { palette, type Palette } from './palette';
import { randomDir } from './particles';
import { keep, release } from './status';
import type { FXHandle, FXSystem } from './system';

type N = any;

export interface FixtureOptions {
  floorY?: number;
  element?: string;
  hue?: number;
  scale?: number;
  prop?: boolean;
  light?: boolean;
  intensity?: number;
  rotation?: number;
}

export interface FixtureRecipe {
  element: string;
  build(run: FixtureRun): void;
  tick(run: FixtureRun, v: number, dt: number): void;
  impact?(run: FixtureRun, point: THREE.Vector3): void;
  end?(run: FixtureRun): void;
}

const ADDITIVE = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };

const cardGeometry = new THREE.PlaneGeometry(1, 1).translate(0, 0.5, 0);
const discGeometry = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);

export class FixtureRun {
  readonly group = new THREE.Group();
  readonly ctx: Ctx;
  readonly pal: Palette;
  readonly scale: number;
  readonly amount = uniform(0);
  readonly time = uniform(0);
  readonly state: Record<string, any> = {};
  readonly prop: boolean;
  readonly lit: boolean;
  value = 0;
  target = 1;
  alive = true;
  readonly done: Promise<void>;
  private resolve!: () => void;
  private rate = 2;
  private stopping = false;
  private listeners = new Set<() => void>();
  private disposables: { dispose(): void }[] = [];
  private kept = 0;
  private circles: { prim: Prim; y: number; size: number; spin: number; turn: number; forward: boolean; age: number }[] = [];
  private tmpQ = new THREE.Quaternion();
  private held: HeldLight | null = null;
  private lightY = 0;
  private lightPos = new THREE.Vector3();

  constructor(
    readonly fx: FXSystem,
    readonly name: string,
    readonly recipe: FixtureRecipe,
    readonly handle: FXHandle,
    private at: THREE.Vector3 | THREE.Object3D,
    opts: FixtureOptions,
  ) {
    this.done = new Promise((r) => (this.resolve = r));
    const element = opts.element ?? recipe.element;
    this.pal = palette(element, opts.hue ?? 0);
    this.scale = opts.scale ?? 1;
    this.prop = opts.prop ?? true;
    this.lit = opts.light ?? true;
    this.target = opts.intensity ?? 1;
    this.ctx = new Ctx(fx, handle, { id: `loop-${name}`, recipe: 'loop', element, hue: opts.hue ?? 0 }, this.pal, { from: this.group, to: this.group, scale: this.scale });
    this.ctx.params = {};
    this.ctx.floorOf = () => (opts.floorY ?? this.group.position.y);
    this.group.scale.setScalar(this.scale);
    this.group.rotation.y = opts.rotation ?? 0;
    fx.root.add(this.group);
    this.follow();
    recipe.build(this);
  }

  get intensity(): number {
    return this.target;
  }

  set intensity(v: number) {
    this.target = Math.max(v, 0);
  }

  get anchor(): THREE.Vector3 | THREE.Object3D {
    return this.at;
  }

  impact(point: THREE.Vector3): void {
    if (this.alive && !this.stopping) this.recipe.impact?.(this, point);
  }

  moveTo(at: THREE.Vector3 | THREE.Object3D): void {
    this.at = at;
    this.follow();
  }

  on(event: 'end', fn: () => void): () => void {
    if (event === 'end') this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  stop(fade = 0.5): void {
    if (this.stopping || !this.alive) return;
    this.stopping = true;
    this.target = 0;
    this.rate = fade > 0 ? 1 / fade : Infinity;
  }

  own<T extends { dispose(): void }>(d: T): T {
    if ((d as unknown as THREE.Material).isMaterial) keep(`loop:${this.name}:${this.kept++}`, d as unknown as THREE.Material);
    this.disposables.push(d);
    return d;
  }

  world(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(x, y, z).applyMatrix4(this.group.matrixWorld);
  }

  follow(): void {
    if (this.at instanceof THREE.Object3D) this.at.getWorldPosition(this.group.position);
    else this.group.position.copy(this.at);
    this.group.updateMatrixWorld(true);
  }

  step(dt: number, time: number): void {
    if (!this.alive) return;
    this.follow();
    const d = this.target - this.value;
    const move = this.rate === Infinity ? Math.abs(d) : this.rate * dt;
    this.value = Math.abs(d) <= move ? this.target : this.value + Math.sign(d) * move;
    this.amount.value = this.value;
    this.time.value = time;
    for (const c of this.circles) {
      c.age += dt;
      c.turn += c.spin * dt;
      const m = c.prim.mesh;
      this.world(0, c.y, 0, m.position);
      if (c.forward) m.quaternion.copy(this.group.getWorldQuaternion(this.tmpQ));
      else m.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2).premultiply(this.group.getWorldQuaternion(this.tmpQ));
      m.scale.setScalar(c.size * this.scale * (0.6 + 0.4 * ease.outBack(Math.min(c.age / 0.4, 1))));
      c.prim.u.turn.value = c.turn;
      c.prim.u.reveal.value = Math.min(c.age / 0.6, 1);
      c.prim.u.fade.value = this.value;
    }
    this.recipe.tick(this, this.value, dt);
    if (this.stopping && this.value <= 0) this.finish();
  }

  finish(): void {
    if (!this.alive) return;
    this.alive = false;
    this.recipe.end?.(this);
    this.handle.stop();
    this.held?.release(0.2);
    this.held = null;
    for (const c of this.circles) this.fx.prims.release(c.prim);
    this.circles.length = 0;
    this.group.removeFromParent();
    for (const d of this.disposables) {
      if ((d as unknown as THREE.Material).isMaterial) release(d as unknown as THREE.Material);
      else d.dispose();
    }
    for (const fn of this.listeners) fn();
    this.resolve();
  }

  flame(o: { x?: number; y?: number; z?: number; w: number; h: number; seed: number; speed?: number; lean?: number }): THREE.Mesh {
    const q: N = uv();
    const seed = uniform(o.seed) as N;
    const t: N = this.time.mul(uniform(o.speed ?? 1));
    const n1: N = tnoise(vec2(q.x.mul(0.35).add(seed), q.y.mul(0.45).sub(t.mul(0.55)))).r;
    const n2: N = tnoise(vec2(q.x.mul(0.8).add(seed.mul(1.7)), q.y.mul(0.9).sub(t.mul(1.1)))).g;
    const noise: N = n1.mul(0.65).add(n2.mul(0.35));
    const y: N = q.y;
    const sway: N = noise.sub(0.5).mul(0.32).mul(y).add(tnoise(vec2(t.mul(0.08), seed)).r.sub(0.5).mul(0.18).mul(y.mul(y)));
    const x: N = q.x.sub(0.5).add(sway);
    const half: N = mix(float(0.62), float(0.1), pow(y, 0.85)).mul(0.5).mul(smoothstep(0, 0.22, y).mul(0.55).add(0.45));
    const body: N = float(1).sub(smoothstep(0.15, 1, abs(x).div(half)));
    const fuel: N = body.mul(1.5).sub(y.mul(1.05)).add(noise.sub(0.5).mul(0.75));
    const f: N = smoothstep(0.05, 0.55, fuel).mul(smoothstep(0, 0.06, y)).mul(this.amount);
    const core: N = smoothstep(0.35, 0.75, fuel).mul(float(1).sub(smoothstep(0.2, 0.6, y)));
    const main = uniform(this.pal.main.clone()) as N;
    const accent = uniform(this.pal.accent.clone()) as N;
    const white = uniform(this.pal.core.clone()) as N;
    const m: N = this.own(new THREE.MeshBasicNodeMaterial(ADDITIVE));
    m.vertexNode = billboarding({ horizontalRotation: true });
    m.colorNode = vec3(0);
    m.emissiveNode = mix(accent, main, smoothstep(0.1, 0.5, fuel)).add(white.mul(core.mul(0.9))).mul(f).mul(1.15);
    m.opacityNode = f;
    const mesh = new THREE.Mesh(cardGeometry, m);
    mesh.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
    mesh.scale.set(o.w, o.h, 1);
    mesh.renderOrder = 3;
    mesh.frustumCulled = false;
    this.group.add(mesh);
    return mesh;
  }

  glowDisc(y: number, radius: number, strength: number): THREE.Mesh {
    const r: N = length(uv().sub(0.5)).mul(2);
    const main = uniform(this.pal.main.clone()) as N;
    const flick: N = tnoise(vec2(this.time.mul(0.9), 0.3)).r.mul(0.5).add(0.75);
    const a: N = pow(float(1).sub(smoothstep(0, 1, r)), 2).mul(uniform(strength)).mul(flick).mul(this.amount);
    const m: N = this.own(new THREE.MeshBasicNodeMaterial(ADDITIVE));
    m.colorNode = vec3(0);
    m.emissiveNode = main.mul(a);
    m.opacityNode = a;
    const mesh = new THREE.Mesh(discGeometry, m);
    mesh.position.y = y;
    mesh.scale.setScalar(radius);
    mesh.renderOrder = 1;
    this.group.add(mesh);
    return mesh;
  }

  circle(y: number, size: number, o: { spin?: number; forward?: boolean; bright?: number; style?: number } = {}): void {
    const prim = this.fx.prims.acquire('circle');
    this.fx.prims.pin(prim);
    prim.u.core.value.copy(this.pal.core);
    prim.u.main.value.copy(this.pal.main);
    prim.u.accent.value.copy(this.pal.accent);
    prim.u.bright.value = (o.bright ?? 1.4) * this.ctx.B;
    const look = CIRCLES[this.ctx.element] ?? CIRCLES.arcane;
    for (const [k, v] of Object.entries({ sidesB: 0, skipB: 1, rotB: 0, spokes: 0, branch: 0, spiral: 0, waves: 0, dots: 0, petals: 0, runes: 3, ticks: 1, ...look })) prim.u[k].value = v;
    prim.u.mode.value = o.style ?? 0;
    this.circles.push({ prim, y, size, spin: o.spin ?? 0.3, turn: Math.random() * 6, forward: o.forward ?? false, age: 0 });
  }

  column(y: number, radius: number, height: number, strength: number): THREE.Mesh {
    const q: N = uv();
    const main = uniform(this.pal.main.clone()) as N;
    const core = uniform(this.pal.core.clone()) as N;
    const flow: N = tnoise(vec2(q.x.mul(2), q.y.mul(0.6).sub(this.time.mul(0.25)))).r;
    const fade: N = smoothstep(0, 0.15, q.y).mul(pow(float(1).sub(q.y).max(0), 1.6));
    const rim: N = pow(float(1).sub(abs(dot(normalView, positionViewDirection))).max(0), 1.2);
    const a: N = fade.mul(flow.mul(0.6).add(0.4)).mul(rim.mul(0.7).add(0.3)).mul(uniform(strength)).mul(this.amount);
    const m: N = this.own(new THREE.MeshBasicNodeMaterial({ ...ADDITIVE, side: THREE.DoubleSide }));
    m.colorNode = vec3(0);
    m.emissiveNode = mix(main, core, fade.mul(0.3)).mul(a);
    m.opacityNode = a;
    const g = this.own(new THREE.CylinderGeometry(radius, radius * 0.85, height, 32, 1, true).translate(0, height / 2, 0));
    const mesh = new THREE.Mesh(g, m);
    mesh.position.y = y;
    mesh.renderOrder = 2;
    this.group.add(mesh);
    return mesh;
  }

  pointLight(y: number, range: number): void {
    if (!this.lit) return;
    this.held = this.fx.loopLights.tryHold(this.pal.main, range * this.scale);
    this.lightY = y;
  }

  shine(intensity: number): void {
    if (!this.held) return;
    this.held.set(this.world(0, this.lightY, 0, this.lightPos), intensity);
  }

  lightAt(p: THREE.Vector3, intensity: number): void {
    this.held?.set(p, intensity);
  }

  solid(geometry: THREE.BufferGeometry, color: number, o: { roughness?: number; metalness?: number; emissive?: number } = {}): THREE.Mesh {
    const m = this.own(new THREE.MeshStandardMaterial({ color, roughness: o.roughness ?? 0.85, metalness: o.metalness ?? 0, emissive: o.emissive ?? 0x000000 }));
    this.own(geometry);
    const mesh = new THREE.Mesh(geometry, m);
    this.group.add(mesh);
    return mesh;
  }
}

function flicker(run: FixtureRun, speed = 1): number {
  const t = run.time.value * speed;
  return 0.82 + 0.1 * Math.sin(t * 13.1) * Math.sin(t * 7.7 + 1.3) + 0.08 * Math.sin(t * 29.3 + run.state.phase);
}

function embers(run: FixtureRun, at: THREE.Vector3, rate: number, spread: number, dt: number, rise = 1): void {
  const c = run.ctx;
  const s = run.scale;
  c.emit('spark', poisson(rate * dt), { p: at, jitter: spread * s, v: () => new THREE.Vector3((Math.random() - 0.5) * 0.4, (0.8 + Math.random() * 1.2) * rise, (Math.random() - 0.5) * 0.4).multiplyScalar(s), life: [0.8, 1.8], size: [0.006 * s, 0.013 * s], drag: 0.8, curl: 2.4, curlScale: 2.2, stretch: 0.02, colors: c.cols('core', 'main'), bright: 2.2 * c.B, flicker: 0.6 });
}

function flames(run: FixtureRun, at: THREE.Vector3, rate: number, spread: number, size: number, dt: number): void {
  const c = run.ctx;
  const s = run.scale;
  c.emit('flame', poisson(rate * dt), { p: at, jitter: spread * s, v: () => new THREE.Vector3((Math.random() - 0.5) * 0.15, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.15).multiplyScalar(s), life: [0.25, 0.5], size: [size * 0.6 * s, size * s], grow: 1.3, gravity: -1.5, drag: 2, curl: 1.2, curlScale: 2, colors: c.cols('main', 'accent', 'accent'), bright: 0.8 * c.B, fadeIn: 0.05, fadePow: 1.2 });
}

function smoke(run: FixtureRun, at: THREE.Vector3, rate: number, size: number, dt: number): void {
  const c = run.ctx;
  const s = run.scale;
  const col = run.pal.smoke ?? new THREE.Color(0.12, 0.11, 0.11);
  c.emit('smoke', poisson(rate * dt), { p: at, jitter: 0.03 * s, v: () => new THREE.Vector3((Math.random() - 0.5) * 0.1, 0.5 + Math.random() * 0.3, (Math.random() - 0.5) * 0.1).multiplyScalar(s), life: [1.4, 2.4], size: [size * 0.5 * s, size * s], grow: 2.6, drag: 0.6, curl: 0.9, curlScale: 1.2, colors: [col.clone(), col.clone().multiplyScalar(1.6)], fadeIn: 0.25, fadePow: 1.3 });
}

const torch: FixtureRecipe = {
  element: 'fire',
  build(run) {
    run.state.phase = Math.random() * 10;
    if (run.prop) {
      const stick = run.solid(new THREE.CylinderGeometry(0.022, 0.017, 0.52, 7).translate(0, 0.26, 0), 0x4a3423);
      stick.castShadow = true;
      run.solid(new THREE.CylinderGeometry(0.04, 0.03, 0.11, 8).translate(0, 0.54, 0), 0x2a1d14, { emissive: 0x3a1204 });
    }
    run.state.top = run.prop ? 0.58 : 0;
    run.flame({ y: run.state.top - 0.03, w: 0.24, h: 0.4, seed: Math.random() * 10, speed: 1.1 });
    run.flame({ y: run.state.top - 0.02, w: 0.13, h: 0.3, seed: Math.random() * 10, speed: 1.5 });
    run.pointLight(run.state.top + 0.15, 7);
  },
  tick(run, v, dt) {
    const at = run.world(0, run.state.top + 0.04, 0);
    flames(run, at, 26 * v, 0.03, 0.09, dt);
    embers(run, at, 5 * v, 0.03, dt);
    smoke(run, run.world(0, run.state.top + 0.4, 0), 2.5 * v, 0.12, dt);
    run.shine(5 * v * flicker(run));
  },
};

const campfire: FixtureRecipe = {
  element: 'fire',
  build(run) {
    run.state.phase = Math.random() * 10;
    if (run.prop) {
      const log = new THREE.CylinderGeometry(0.045, 0.05, 0.5, 7);
      for (let i = 0; i < 5; i++) {
        const a = (i / 5) * Math.PI * 2 + 0.3;
        const mesh = run.solid(log.clone(), i % 2 ? 0x3d2a1c : 0x4a3423);
        mesh.position.set(Math.cos(a) * 0.2, 0.11, Math.sin(a) * 0.2);
        mesh.lookAt(run.world(0, 0.34, 0));
        mesh.rotateX(Math.PI / 2);
        mesh.castShadow = true;
      }
      log.dispose();
      const stone = new THREE.DodecahedronGeometry(0.07, 0);
      for (let i = 0; i < 10; i++) {
        const a = (i / 10) * Math.PI * 2;
        const mesh = run.solid(stone.clone(), 0x55524c, { roughness: 0.95 });
        mesh.position.set(Math.cos(a) * 0.42, 0.03, Math.sin(a) * 0.42);
        mesh.scale.set(1 + Math.random() * 0.4, 0.6 + Math.random() * 0.3, 1 + Math.random() * 0.3);
        mesh.rotation.set(Math.random(), Math.random() * 3, Math.random());
      }
      stone.dispose();
      const coals = run.solid(new THREE.CircleGeometry(0.2, 12).rotateX(-Math.PI / 2).translate(0, 0.015, 0), 0x140a06, { emissive: 0x5a1a04 });
      coals.renderOrder = 0;
    }
    run.glowDisc(0.02, 1.4, 0.35);
    run.flame({ y: 0.06, w: 0.66, h: 1.05, seed: Math.random() * 10, speed: 0.9 });
    run.flame({ x: 0.09, y: 0.02, z: 0.05, w: 0.42, h: 0.6, seed: Math.random() * 10, speed: 1.2 });
    run.flame({ x: -0.09, y: 0.02, z: -0.04, w: 0.4, h: 0.55, seed: Math.random() * 10, speed: 1.3 });
    run.pointLight(0.5, 10);
  },
  tick(run, v, dt) {
    const c = run.ctx;
    const base = run.world(0, 0.08, 0);
    flames(run, base, 55 * v, 0.1, 0.16, dt);
    embers(run, base, 14 * v, 0.1, dt, 1.4);
    if (Math.random() < dt * 0.6 * v) c.emit('spark', 10, { p: run.world(0, 0.15, 0), v: () => randomDir().setY(Math.random() * 1.5 + 0.8).multiplyScalar(1.6 * run.scale), life: [0.4, 0.9], size: [0.006 * run.scale, 0.012 * run.scale], gravity: 3, drag: 1, stretch: 0.03, colors: c.cols('core', 'main'), bright: 2.8 * c.B });
    smoke(run, run.world(0, 0.9, 0), 5 * v, 0.28, dt);
    run.shine(11 * v * flicker(run, 0.8));
  },
};

const candles: FixtureRecipe = {
  element: 'fire',
  build(run) {
    run.state.phase = Math.random() * 10;
    const tops: THREE.Vector3[] = [];
    const spots: [number, number, number][] = [
      [0, 0.52, 0],
      [-0.16, 0.42, 0],
      [0.16, 0.42, 0],
    ];
    if (run.prop) {
      const metal = { roughness: 0.35, metalness: 0.8 };
      run.solid(new THREE.CylinderGeometry(0.1, 0.12, 0.03, 16).translate(0, 0.015, 0), 0x6b5a3a, metal);
      run.solid(new THREE.CylinderGeometry(0.014, 0.018, 0.4, 8).translate(0, 0.22, 0), 0x6b5a3a, metal);
      run.solid(new THREE.TorusGeometry(0.16, 0.008, 6, 24, Math.PI).rotateX(Math.PI).translate(0, 0.42, 0), 0x6b5a3a, metal);
      for (const [x, y, z] of spots) {
        run.solid(new THREE.CylinderGeometry(0.03, 0.025, 0.012, 10).translate(x, y - 0.1, z), 0x6b5a3a, metal);
        run.solid(new THREE.CylinderGeometry(0.018, 0.018, 0.1, 10).translate(x, y - 0.045, z), 0xe8dcc0, { roughness: 0.6 });
      }
    }
    for (const [x, y, z] of spots) {
      const top = new THREE.Vector3(x, run.prop ? y + 0.01 : 0, z);
      tops.push(top);
      run.flame({ x: top.x, y: top.y, z: top.z, w: 0.045, h: 0.11, seed: Math.random() * 10, speed: 0.8 });
    }
    run.state.tops = tops;
    run.pointLight(0.6, 5);
  },
  tick(run, v, dt) {
    const c = run.ctx;
    for (const top of run.state.tops as THREE.Vector3[]) {
      const at = run.world(top.x, top.y + 0.03, top.z);
      c.emit('glow', poisson(6 * v * dt), { p: at, life: [0.2, 0.3], size: [0.06 * run.scale, 0.09 * run.scale], colors: c.cols('main', 'accent'), bright: 0.6 * c.B, fadeIn: 0.1 });
      if (Math.random() < dt * 0.4 * v) smoke(run, run.world(top.x, top.y + 0.14, top.z), 1 / dt, 0.03, dt);
    }
    run.shine(2.2 * v * flicker(run, 0.6));
  },
};

const portal: FixtureRecipe = {
  element: 'arcane',
  build(run) {
    const H = 1.05;
    const W = 0.78;
    run.state.center = new THREE.Vector3(0, H + 0.05, 0);
    if (run.prop) {
      const stone = { roughness: 0.9 };
      const frame = run.solid(new THREE.TorusGeometry(1, 0.07, 8, 48), 0x4b4852, stone);
      frame.scale.set(W + 0.08, H + 0.08, 1);
      frame.position.copy(run.state.center);
      run.solid(new THREE.BoxGeometry(0.5, 0.08, 0.34).translate(0, 0.04, 0), 0x3d3a42, stone);
    }
    const q: N = uv().sub(0.5).mul(2);
    const r: N = length(q);
    const ang: N = atan(q.y, q.x);
    const t: N = run.time;
    const spiral: N = tnoise(vec2(ang.div(Math.PI * 2).mul(2).add(r.mul(0.9)).sub(t.mul(0.12)), r.mul(0.5).sub(t.mul(0.3)))).r;
    const arms: N = smoothstep(0.55, 0.8, spiral.add(r.mul(0.25)));
    const main = uniform(run.pal.main.clone()) as N;
    const core = uniform(run.pal.core.clone()) as N;
    const accent = uniform(run.pal.accent.clone()) as N;
    const edge: N = smoothstep(0.7, 0.98, r);
    const inside: N = float(1).sub(smoothstep(0.97, 1, r));
    const m: N = run.own(new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide }));
    m.colorNode = mix(accent.mul(0.08), accent.mul(0.35), spiral.mul(r));
    m.emissiveNode = mix(main, core, pow(edge, 3)).mul(arms.mul(r).mul(0.9).add(edge.mul(0.7))).mul(run.amount);
    m.opacityNode = inside.mul(run.amount).mul(0.95);
    const disc = new THREE.Mesh(run.own(new THREE.PlaneGeometry(2, 2)), m);
    disc.scale.set(W, H, 1);
    disc.position.copy(run.state.center);
    disc.renderOrder = 2;
    run.group.add(disc);
    const rq: N = positionLocal;
    const rimFlow: N = tnoise(vec2(atan(rq.y, rq.x).div(Math.PI * 2).mul(3).sub(t.mul(0.4)), 0.3)).r;
    const rm: N = run.own(new THREE.MeshBasicNodeMaterial(ADDITIVE));
    rm.colorNode = vec3(0);
    rm.emissiveNode = mix(main, core, rimFlow).mul(rimFlow.mul(1.2).add(0.4)).mul(run.amount).mul(0.8);
    rm.opacityNode = run.amount;
    const rim = new THREE.Mesh(run.own(new THREE.TorusGeometry(1, 0.025, 6, 64)), rm);
    rim.scale.set(W, H, 1);
    rim.position.copy(run.state.center);
    run.group.add(rim);
    run.state.W = W;
    run.state.H = H;
    run.glowDisc(0.02, 1.3, 0.2);
    run.pointLight(run.state.center.y, 6);
  },
  tick(run, v, dt) {
    const c = run.ctx;
    const s = run.scale;
    const center = run.world(run.state.center.x, run.state.center.y, run.state.center.z);
    const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(run.group.quaternion);
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(run.group.quaternion);
    const W = run.state.W * s;
    const H = run.state.H * s;
    c.emit('mote', poisson(40 * v * dt), {
      p: () => {
        const a = Math.random() * Math.PI * 2;
        const k = 1.3 + Math.random() * 0.8;
        return center.clone().addScaledVector(right, Math.cos(a) * W * k).add(new THREE.Vector3(0, Math.sin(a) * H * k, 0)).addScaledVector(fwd, (Math.random() - 0.5) * 0.6);
      },
      hook: c.hook({ fields: [{ kind: 'attract', power: 5, at: center, max: 3 }] }),
      v: () => new THREE.Vector3(),
      life: [0.8, 1.2],
      size: [0.012 * s, 0.025 * s],
      drag: 1.2,
      stretch: 0.03,
      colors: c.cols('core', 'main'),
      bright: 2 * c.B,
      fadeIn: 0.2,
    });
    c.emit('spark', poisson(18 * v * dt), {
      p: () => {
        const a = Math.random() * Math.PI * 2;
        return center.clone().addScaledVector(right, Math.cos(a) * W).add(new THREE.Vector3(0, Math.sin(a) * H, 0));
      },
      v: () => randomDir().multiplyScalar(0.3),
      life: [0.3, 0.6],
      size: [0.006 * s, 0.012 * s],
      colors: c.cols('core', 'main'),
      bright: 2.4 * c.B,
    });
    if (Math.random() < dt * 3 * v) c.emit('mist', 1, { p: run.world(0, 0.05, 0), jitter: 0.4 * s, v: () => fwd.clone().multiplyScalar(0.15 * (Math.random() > 0.5 ? 1 : -1)), life: [1.2, 2], size: [0.3 * s, 0.5 * s], grow: 1.5, colors: c.cols('main', 'accent'), bright: 0.35 * c.B, fadeIn: 0.3 });
    run.shine(4 * v * (0.85 + 0.15 * Math.sin(run.time.value * 2.3)));
  },
};

const sigil: FixtureRecipe = {
  element: 'arcane',
  build(run) {
    run.circle(0.02, 1.25, { spin: 0.25, bright: 1.5 });
    run.circle(0.03, 0.62, { spin: -0.5, bright: 1.2, style: 1 });
    run.column(0.02, 1.0, 1.6, 0.35);
    run.glowDisc(0.015, 1.6, 0.25);
    run.pointLight(0.4, 5);
  },
  tick(run, v, dt) {
    const c = run.ctx;
    const s = run.scale;
    const g = run.world(0, 0.05, 0);
    c.emit('mote', poisson(26 * v * dt), { p: () => g.clone().add(randomDir().setY(0).normalize().multiplyScalar(Math.sqrt(Math.random()) * 1.1 * s)), v: () => new THREE.Vector3(0, 0.5 + Math.random() * 0.7, 0), life: [0.9, 1.6], size: [0.012 * s, 0.024 * s], drag: 0.3, curl: 0.5, colors: c.cols('core', 'main'), bright: 2 * c.B, fadeIn: 0.2, alphaCurve: 'bell' });
    if (Math.random() < dt * 1.2 * v) c.emit('glyph', 1, { p: g.clone().add(randomDir().setY(0).normalize().multiplyScalar(0.8 * s)), v: () => new THREE.Vector3(0, 0.35, 0), life: [1.2, 1.8], size: [0.1 * s, 0.14 * s], colors: c.cols('core', 'main'), bright: 1.4 * c.B, fadeIn: 0.3, variant: 0 });
    run.shine(3 * v * (0.8 + 0.2 * Math.sin(run.time.value * 1.7)));
  },
};

const savepoint: FixtureRecipe = {
  element: 'light',
  build(run) {
    if (run.prop) {
      const stone = { roughness: 0.85 };
      run.solid(new THREE.CylinderGeometry(0.34, 0.4, 0.14, 8).translate(0, 0.07, 0), 0x4a4750, stone);
      run.solid(new THREE.CylinderGeometry(0.26, 0.3, 0.06, 8).translate(0, 0.17, 0), 0x57535e, stone);
    }
    const base = run.prop ? 0.2 : 0.02;
    run.state.base = base;
    run.circle(base + 0.01, 0.55, { spin: 0.4, bright: 1.3 });
    run.column(base, 0.28, 1.9, 0.45);
    const pulse: N = sin(run.time.mul(2.2)).mul(0.25).add(0.75);
    const main = uniform(run.pal.main.clone()) as N;
    const core = uniform(run.pal.core.clone()) as N;
    const fres: N = pow(float(1).sub(abs(dot(normalView, positionViewDirection))).max(0), 2);
    const m: N = run.own(new THREE.MeshStandardNodeMaterial({ roughness: 0.12, metalness: 0.1, transparent: true }));
    m.colorNode = main.mul(0.35);
    m.emissiveNode = mix(main, core, fres).mul(fres.mul(1.2).add(0.45)).mul(pulse).mul(run.amount).mul(1.3);
    m.opacityNode = run.amount.mul(0.9);
    const crystal = new THREE.Mesh(run.own(new THREE.OctahedronGeometry(0.14, 0)), m);
    crystal.scale.set(1, 1.7, 1);
    run.group.add(crystal);
    run.state.crystal = crystal;
    run.state.y = base + 0.95;
    run.pointLight(base + 0.9, 6);
  },
  tick(run, v, dt) {
    const c = run.ctx;
    const s = run.scale;
    const t = run.time.value;
    const crystal = run.state.crystal as THREE.Mesh;
    crystal.position.y = run.state.y + Math.sin(t * 1.3) * 0.06;
    crystal.rotation.y = t * 0.8;
    const at = run.world(0, crystal.position.y, 0);
    const g = run.world(0, run.state.base, 0);
    c.emit('mote', poisson(20 * v * dt), { p: () => g.clone().add(randomDir().setY(0).normalize().multiplyScalar(0.45 * s)), v: () => new THREE.Vector3(0, 0.45 + Math.random() * 0.3, 0), swirl: 2, center: g, life: [1.4, 2.2], size: [0.012 * s, 0.022 * s], colors: c.cols('core', 'main'), bright: 2 * c.B, fadeIn: 0.2, alphaCurve: 'bell' });
    if (Math.random() < dt * 3 * v) c.emit('star', 1, { p: at.clone().add(randomDir().multiplyScalar(0.25 * s)), life: [0.25, 0.4], size: [0.05 * s, 0.08 * s], colors: c.cols('core'), bright: 2.2 * c.B, alphaCurve: 'flash' });
    run.shine(3.5 * v * (0.8 + 0.2 * Math.sin(t * 2.2)));
  },
};

const barrier: FixtureRecipe = {
  element: 'light',
  build(run) {
    const prim = run.fx.prims.acquire('shield');
    prim.u.core.value.copy(run.pal.core);
    prim.u.main.value.copy(run.pal.main);
    prim.u.accent.value.copy(run.pal.accent);
    prim.u.bright.value = 1.3 * run.ctx.B;
    (prim.u.hitData as THREE.Vector4[]).forEach((h) => h.set(0, 1, 0, 9));
    run.state.prim = prim;
    run.state.slot = 0;
    run.state.age = 0;
    run.state.R = 2.4;
    run.circle(0.02, run.state.R * 1.04, { spin: 0.12, bright: 1.2 });
    run.pointLight(0.6, 7);
  },
  tick(run, v, dt) {
    const prim = run.state.prim;
    const c = run.ctx;
    const s = run.scale;
    const R = run.state.R * s;
    run.state.age += dt;
    const pop = ease.outBack(Math.min(run.state.age / 0.5, 1));
    run.world(0, 0, 0, prim.mesh.position);
    prim.mesh.scale.setScalar(R * (0.8 + 0.2 * pop));
    prim.u.reveal.value = Math.min(run.state.age / 0.6, 1);
    prim.u.time.value = run.state.age;
    prim.u.fade.value = v;
    for (const h of prim.u.hitData as THREE.Vector4[]) h.w += dt;
    const g = run.world(0, 0.05, 0);
    c.emit('mote', poisson(40 * v * dt), { p: () => g.clone().add(randomDir().setY(0).normalize().multiplyScalar(R)), v: () => new THREE.Vector3(0, 0.6 + Math.random() * 0.6, 0), life: [0.8, 1.4], size: [0.012 * s, 0.024 * s], colors: c.cols('core', 'main'), bright: 2 * c.B, fadeIn: 0.15, alphaCurve: 'bell' });
    run.shine(3 * v);
  },
  impact(run, point) {
    const prim = run.state.prim;
    const c = run.ctx;
    const center = run.world(0, 0, 0);
    const dir = point.clone().sub(center).normalize();
    (prim.u.hitData as THREE.Vector4[])[run.state.slot].set(dir.x, dir.y, dir.z, 0);
    run.state.slot = (run.state.slot + 1) % (prim.u.hitData as THREE.Vector4[]).length;
    const at = center.addScaledVector(dir, prim.mesh.scale.x);
    c.emit('spark', 30, { p: at, v: () => dir.clone().add(randomDir().multiplyScalar(0.8)).multiplyScalar(4), life: [0.15, 0.35], size: [0.012, 0.022], drag: 3, stretch: 0.03, colors: c.cols('core', 'main'), bright: 3 * c.B, fadeIn: 0 });
    c.star(at, 0.7 * run.scale, 0.12, 2.5);
  },
  end(run) {
    const prim = run.state.prim;
    if (!prim) return;
    const c = run.ctx;
    const center = run.world(0, 0, 0);
    const r = prim.mesh.scale.x;
    c.emit('shard', 90, { p: () => center.clone().add(randomDir().setY(Math.abs(Math.random())).normalize().multiplyScalar(r)), v: () => randomDir().multiplyScalar(2), life: [0.4, 0.8], size: [0.04, 0.07], gravity: 5, drag: 1.5, colors: c.cols('core', 'main'), bright: 1.8 * c.B, fadeIn: 0 });
    run.fx.prims.release(prim);
    run.state.prim = null;
  },
};

const aura: FixtureRecipe = {
  element: 'fire',
  build(run) {
    const at = run.anchor;
    let height = 1.8;
    let radius = 0.4;
    let foot = 0;
    if (at instanceof THREE.Object3D) {
      const box = new THREE.Box3().setFromObject(at);
      if (!box.isEmpty()) {
        const size = box.getSize(new THREE.Vector3());
        height = Math.max(size.y, 0.3);
        radius = Math.max(Math.max(size.x, size.z) * 0.5, 0.2);
        foot = box.min.y - at.getWorldPosition(new THREE.Vector3()).y;
      }
    }
    run.state.h = height;
    run.state.r = Math.min(radius, height * 0.3);
    run.state.foot = foot;
    const c = run.ctx;
    const g = () => run.world(0, run.state.foot / run.scale, 0);
    const r = run.state.r * 1.2;
    const h = height;
    const dark = c.element === 'dark';
    const hold = 1e6;
    const pulse = () => 1 + 0.15 * Math.sin(run.time.value * 2 * Math.PI * 0.9);
    const fade = () => run.value * pulse();
    const opts = { at: g, dur: hold, fade, erode: () => 0, fadeLo: 0.02 };
    c.lathe(g(), { ...opts, profile: 'cylinder', radius: 1.15 * r, top: 0.8 * r, height: h * 1.25, flow: 2.6, twist: 1.9, tiles: [6, 1.6], streak: 0.5, rim: 0.4, fadeHi: 0.6, wobble: 0.1, bright: dark ? 0.9 : 1, edge: 0.12, smoke: dark, colors: dark ? ['core', 'smoke', 'smoke'] : undefined });
    c.lathe(g(), { ...opts, profile: 'cylinder', radius: 0.9 * r, top: 0.5 * r, height: h * 1.4, flow: 3.3, twist: -1.2, tiles: [8, 2], streak: 0.7, rim: 0.2, fadeHi: 0.55, bright: 1, edge: 0.12, wobble: 0.12 });
    c.lathe(g(), { ...opts, profile: 'dome', radius: 1.3 * r, height: 0.3, flow: 1.5, tiles: [6, 1], streak: 0.7, rim: 0.5, bright: 0.7 });
    run.pointLight(h * 0.5, 5);
  },
  tick(run, v, dt) {
    const c = run.ctx;
    const s = run.scale;
    const g = run.world(0, run.state.foot / s, 0);
    const r = run.state.r * s;
    const h = run.state.h;
    c.emitShape('spark', poisson(40 * v * dt), { type: 'body', at: g, r: r * 1.1, h: h * 0.6 }, { v: () => new THREE.Vector3(0, 2 + Math.random() * 2, 0), life: [0.4, 0.8], size: [0.012 * s, 0.02 * s], stretch: 0.06, drag: 0.5, colors: c.cols('core', 'main'), bright: 2.4 * c.B, fadeIn: 0 });
    c.emit('mote', poisson(12 * v * dt), { p: () => g.clone().add(randomDir().setY(0).normalize().multiplyScalar(r * 1.3)), v: () => new THREE.Vector3(0, 0.8 + Math.random() * 0.6, 0), life: [0.6, 1], size: [0.015 * s, 0.03 * s], colors: c.cols('core', 'main'), bright: 2 * c.B, fadeIn: 0.1, alphaCurve: 'bell' });
    run.lightAt(g.clone().setY(g.y + h * 0.5), 4 * v);
  },
};

const beacon: FixtureRecipe = {
  element: 'light',
  build(run) {
    run.column(0, 0.35, 14, 0.5);
    run.column(0, 0.12, 14, 1.1);
    run.circle(0.02, 0.7, { spin: 0.6, bright: 1.4 });
    run.glowDisc(0.015, 1.2, 0.3);
    run.pointLight(0.8, 6);
  },
  tick(run, v, dt) {
    const c = run.ctx;
    const s = run.scale;
    const g = run.world(0, 0.05, 0);
    c.emit('mote', poisson(30 * v * dt), { p: () => g.clone().add(randomDir().setY(0).normalize().multiplyScalar(Math.random() * 0.35 * s)), v: () => new THREE.Vector3(0, 1.2 + Math.random() * 1.6, 0), life: [1.5, 2.5], size: [0.015 * s, 0.03 * s], drag: 0.1, colors: c.cols('core', 'main'), bright: 2.2 * c.B, fadeIn: 0.2, alphaCurve: 'bell' });
    if (Math.random() < dt * 0.8 * v) c.ring(g, 0.9 * s, { dur: 1.2, thick: 0.04, bright: 1.2 });
    run.shine(3 * v * (0.85 + 0.15 * Math.sin(run.time.value * 2)));
  },
};

export const FIXTURES: Record<string, FixtureRecipe> = { torch, campfire, candles, portal, sigil, savepoint, barrier, aura, beacon };
