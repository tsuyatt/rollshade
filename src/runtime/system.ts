import * as THREE from 'three/webgpu';
import { LightPool } from './lights';
import { palette, type Palette } from './palette';
import { ParticleSystem, emission, flushParticleEvents, nearFade, orthoHalf, screenCap, sizeFloor, tanHalfFov, type ParticleKind } from './particles';
import { clampParams } from '../core/fx/variation';
import { FXPost, glowing, type PostOptions } from './post';
import { BOLT_POINTS, PRIM_FACTORIES, PrimPool, disposePrim, RIBBON_LENGTH, RibbonTrail, arcGeometry, stripGeometry } from './prims';
import { Scheduler } from './scheduler';
import { helixGeometry } from './shapes';
import { SolidSet, crystalGeometries, crystalMaterial, rockGeometries, rockMaterial, rockSpikeGeometries } from './solids';
import { Ctx } from './ctx';
import { RECIPES } from './recipes';
import { LoopHandle, type LoopDef, type SpawnOptions } from './loops';
import { StatusManager, type StatusOptions, type StatusRun } from './status';
import { STATUSES } from './statuses';
import { FIXTURES, FixtureRun, type FixtureOptions } from './fixtures';

export type Anchor = THREE.Vector3 | THREE.Object3D;

export interface EffectDef {
  id: string;
  recipe: string;
  element: string;
  hue?: number;
  color?: number;
  params?: Record<string, number>;
}

export interface PlayOptions {
  from: Anchor;
  to: Anchor;
  power?: number;
  scale?: number;
  floorY?: number;
}

export type HitRole = 'first' | 'link' | 'final' | 'tick';

export interface HitEvent {
  point: THREE.Vector3;
  power: number;
  index: number;
  shake: number;
  hitStop: number;
  role: HitRole;
  dir: THREE.Vector3;
}

export type FXEvent = 'cast' | 'release' | 'hit' | 'vanish' | 'appear' | 'end';

export interface FXOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGPURenderer;
  post?: boolean | PostOptions;
  feel?: boolean;
  hitStopScale?: number;
  floorY?: number;
  lights?: number;
  loopLights?: number;
  lightScale?: number;
  photosensitive?: boolean;
  impactFrames?: boolean;
  budget?: Partial<Record<ParticleKind, number>>;
  maxScreenSize?: number;
  nearFade?: [number, number];
  quality?: QualityPreset | number;
  renderScale?: number;
  autoResolution?: boolean | { min?: number; max?: number };
  frameBudget?: number;
}

const BUDGET: Record<ParticleKind, number> = { glow: 3000, mote: 3000, spark: 6000, star: 400, flare: 200, flame: 3000, smoke: 2600, shard: 2000, bubble: 1000, glyph: 600, mist: 1500, haze: 700 };

export type QualityPreset = 'auto' | 'high' | 'medium' | 'low';

const NEAR = nearFade.value.clone();
const FLOOR = sizeFloor.value as number;

const WARM_STEPS = 8;
const SETTLE = 2;
const RAISE_WAIT = 3;
const PRESETS: Record<Exclude<QualityPreset, 'auto'>, [number, number]> = { high: [1, 1], medium: [0.7, 0.75], low: [0.45, 0.55] };

export class FXHandle {
  playing = true;
  readonly blade = { base: new THREE.Vector3(), tip: new THREE.Vector3(), active: false };
  readonly head = new THREE.Vector3();
  readonly body = { offset: new THREE.Vector3(), lean: 0, turn: 0, limb: null as 'fist' | 'foot' | null };
  private listeners = new Map<FXEvent, Set<(e: any) => void>>();
  readonly done: Promise<void>;
  private resolve!: () => void;

  constructor(
    readonly id: string,
    private system: FXSystem,
  ) {
    this.done = new Promise((r) => (this.resolve = r));
  }

  on(event: FXEvent, fn: (e: any) => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  emit(event: FXEvent, data?: unknown): void {
    if (event === 'cast') {
      this.system.scheduler.after(0, () => this.send('cast'), this);
      return;
    }
    if (event !== 'end') {
      this.send(event, data);
      return;
    }
    this.playing = false;
    this.blade.active = false;
    this.body.offset.set(0, 0, 0);
    this.body.lean = this.body.turn = 0;
    this.body.limb = null;
    try {
      this.send('end');
    } finally {
      this.resolve();
    }
  }

  private send(event: FXEvent, data?: unknown): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) {
      try {
        fn(data);
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  stop(): void {
    this.system.scheduler.cancel(this);
    if (this.playing) this.emit('end');
  }
}

export class FXSystem {
  readonly root = new THREE.Group();
  readonly scheduler = new Scheduler();
  readonly particles: Record<ParticleKind, ParticleSystem>;
  readonly prims: PrimPool;
  readonly lights: LightPool;
  readonly loopLights: LightPool;
  readonly rocks: SolidSet;
  readonly crystals: SolidSet;
  readonly spikes: SolidSet;
  readonly post: FXPost | null;
  private view: THREE.Camera;
  readonly scene: THREE.Scene;
  readonly renderer: THREE.WebGPURenderer;
  timeScale = 1;
  floorY: number;
  feel: boolean;
  hitStopScale: number;
  photosensitive: boolean;
  impactFrames: boolean;
  only: string | null = null;
  private defs = new Map<string, EffectDef>();
  private loopDefs = new Map<string, LoopDef>();
  private loops = new Set<LoopHandle>();
  private statuses = new StatusManager(this);
  private fixtures = new Set<FixtureRun>();
  private handles = new Set<FXHandle>();
  private stopT = 0;
  private trauma = 0;
  private shakeTime = 0;
  private shakeSaved: { pos: THREE.Vector3; quat: THREE.Quaternion } | null = null;
  autoQuality = false;
  private level = 1;
  private scale = 1;
  private preset: QualityPreset = 'high';
  private frameEma = 1 / 60;
  private over = 0;
  private under = 0;
  private raiseWait = RAISE_WAIT;
  private sinceRaise = 99;
  private sinceDrop = 99;
  private settle = SETTLE;
  private resolution: { min: number; max: number } | null = null;
  private frameBudget: number;
  private disposed = false;
  private screenSize: number;
  private near: THREE.Vector2;
  private sizeMin = FLOOR;
  private emissionScale = 1;

  constructor(opts: FXOptions) {
    this.scene = opts.scene;
    this.view = opts.camera;
    this.renderer = opts.renderer;
    this.floorY = opts.floorY ?? 0;
    this.feel = opts.feel ?? false;
    this.hitStopScale = opts.hitStopScale ?? 1;
    this.photosensitive = opts.photosensitive ?? false;
    this.impactFrames = opts.impactFrames ?? false;
    this.root.name = 'rollshade-fx';
    glowing.add(this.root);
    this.scene.add(this.root);
    const budget = { ...BUDGET, ...opts.budget };
    this.particles = Object.fromEntries(
      (Object.keys(BUDGET) as ParticleKind[]).map((k) => {
        const sys = new ParticleSystem(k, budget[k]);
        this.root.add(sys.mesh);
        return [k, sys];
      }),
    ) as Record<ParticleKind, ParticleSystem>;
    this.prims = new PrimPool(this.root, PRIM_FACTORIES);
    this.rocks = new SolidSet(rockGeometries(), rockMaterial, 900);
    this.crystals = new SolidSet(crystalGeometries(), crystalMaterial, 900);
    this.spikes = new SolidSet(rockSpikeGeometries(), rockMaterial, 360);
    this.root.add(...this.rocks.meshes, ...this.crystals.meshes, ...this.spikes.meshes);
    this.lights = new LightPool(this.root, opts.lights ?? 6, opts.lightScale ?? 1);
    this.loopLights = new LightPool(this.root, opts.loopLights ?? 4, opts.lightScale ?? 1);
    const hidden = () => this.only !== null && this.scheduler.part !== this.only;
    this.prims.mask = hidden;
    this.rocks.mask = this.crystals.mask = this.spikes.mask = hidden;
    this.lights.mute = hidden;
    this.post = opts.post ? new FXPost(opts.renderer, opts.scene, opts.camera, opts.post === true ? {} : opts.post) : null;
    this.screenSize = opts.maxScreenSize ?? 0.5;
    this.near = opts.nearFade ? new THREE.Vector2(opts.nearFade[0], opts.nearFade[1]) : NEAR.clone();
    this.frameBudget = opts.frameBudget ?? 1 / 58;
    if (typeof opts.quality === 'number') {
      this.autoQuality = false;
      this.quality = opts.quality;
    } else this.setQuality(opts.quality ?? 'high');
    if (opts.renderScale !== undefined) this.renderScale = opts.renderScale;
    if (opts.autoResolution) {
      const max = (typeof opts.autoResolution === 'object' && opts.autoResolution.max) || opts.renderer.getPixelRatio();
      const min = (typeof opts.autoResolution === 'object' && opts.autoResolution.min) || Math.min(1, max);
      this.resolution = { min, max };
    }
  }

  get camera(): THREE.Camera {
    return this.view;
  }

  set camera(camera: THREE.Camera) {
    this.restoreShake();
    this.view = camera;
    this.post?.setCamera(camera);
  }

  get quality(): number {
    return this.level;
  }

  get qualityPreset(): QualityPreset {
    return this.preset;
  }

  get renderScale(): number {
    return this.scale;
  }

  set renderScale(v: number) {
    this.scale = Math.min(Math.max(v, 0.25), 1);
    this.post?.setScale(this.scale);
  }

  setQuality(preset: QualityPreset): void {
    this.preset = preset;
    if (preset === 'auto') {
      this.autoQuality = true;
      this.calm();
      return;
    }
    this.autoQuality = false;
    const [particles, scale] = PRESETS[preset];
    this.quality = particles;
    this.renderScale = scale;
  }

  set quality(v: number) {
    this.level = Math.min(Math.max(v, 0.3), 1);
    this.emissionScale = emission.scale = 0.35 + 0.65 * this.level;
    if (this.autoQuality && this.post) this.renderScale = 0.5 + 0.5 * Math.min(Math.max((this.level - 0.3) / 0.5, 0), 1);
    if (this.resolution) {
      const { min, max } = this.resolution;
      const ratio = Math.round((min + (max - min) * Math.min(Math.max((this.level - 0.3) / 0.7, 0), 1)) * 8) / 8;
      if (Math.abs(this.renderer.getPixelRatio() - ratio) > 1e-3) this.renderer.setPixelRatio(ratio);
    }
  }

  private calm(): void {
    this.settle = SETTLE;
    this.frameEma = this.frameBudget;
    this.over = this.under = 0;
  }

  get maxScreenSize(): number {
    return this.screenSize;
  }

  set maxScreenSize(v: number) {
    this.screenSize = v;
  }

  get minParticleSize(): number {
    return this.sizeMin;
  }

  set minParticleSize(v: number) {
    this.sizeMin = v;
  }

  private activate(): void {
    screenCap.value = this.screenSize;
    nearFade.value.copy(this.near);
    sizeFloor.value = this.sizeMin;
    emission.scale = this.emissionScale;
    const cam = this.view as THREE.PerspectiveCamera & THREE.OrthographicCamera;
    if (cam.isPerspectiveCamera) {
      tanHalfFov.value = Math.tan((cam.fov * Math.PI) / 360);
      orthoHalf.value = 0;
    } else if (cam.isOrthographicCamera) orthoHalf.value = (cam.top - cam.bottom) / (2 * cam.zoom);
  }

  private adapt(frame: number): void {
    if (this.settle > 0) {
      this.settle -= frame;
      return;
    }
    frame = Math.min(frame, this.frameBudget * 2);
    this.frameEma += (frame - this.frameEma) * 0.12;
    this.sinceRaise += frame;
    this.sinceDrop += frame;
    if (this.frameEma > this.frameBudget * 1.2) {
      this.over += frame;
      this.under = 0;
      if (this.over > 1 && this.level > 0.3) {
        if (this.sinceRaise < 5) this.raiseWait = Math.min(this.raiseWait * 2, 12);
        this.quality = this.level - 0.175;
        this.over = 0;
        this.sinceDrop = 0;
      }
    } else if (this.frameEma < this.frameBudget * 1.05) {
      this.under += frame;
      this.over = 0;
      if (this.sinceDrop > 15) this.raiseWait = RAISE_WAIT;
      if (this.under > this.raiseWait && this.level < 1) {
        this.quality = this.level + 0.175;
        this.under = 0;
        this.sinceRaise = 0;
      }
    }
  }

  add(...defs: (EffectDef | LoopDef)[]): this {
    for (const d of defs) {
      if ((d as LoopDef).kind === 'loop') {
        this.loopDefs.set(d.id, d as LoopDef);
        if ((d as LoopDef).bloom && this.post) this.post.loopBloomUsed = true;
      } else this.defs.set(d.id, d as EffectDef);
    }
    return this;
  }

  has(id: string): boolean {
    return this.defs.has(id) || this.loopDefs.has(id);
  }

  remove(...ids: string[]): this {
    for (const id of ids) {
      this.defs.delete(id);
      this.loopDefs.delete(id);
    }
    return this;
  }

  glow(object: THREE.Object3D, on = true): this {
    if (on === glowing.has(object)) return this;
    if (on) glowing.add(object);
    else glowing.delete(object);
    object.traverse((o) => {
      const m = (o as THREE.Mesh).material;
      if (!m) return;
      for (const mat of Array.isArray(m) ? m : [m]) {
        const tagged = mat as THREE.Material & { rollshadeGlow?: number };
        tagged.rollshadeGlow = tagged.rollshadeGlow ? 0 : 1;
        mat.needsUpdate = true;
      }
    });
    return this;
  }

  spawn(effect: string | LoopDef, opts: SpawnOptions = {}): LoopHandle {
    const def = typeof effect === 'string' ? this.loopDefs.get(effect) : effect;
    if (!def) throw new Error(`rollshade: unknown loop "${effect}"`);
    if (def.bloom && this.post) this.post.loopBloomUsed = true;
    if (def.object && !opts.object) throw new Error(`rollshade: "${def.id}" needs { object }`);
    const instance = def.create({ scene: this.scene, camera: this.camera, renderer: this.renderer, object: opts.object, period: opts.period ?? def.period });
    if (instance.object && opts.scale) instance.object.scale.multiplyScalar(opts.scale);
    if (instance.object && !def.object) glowing.add(instance.object);
    const handle = new LoopHandle(def.id, def, instance, def.object ? undefined : opts.at, (h) => {
      this.loops.delete(h);
      this.syncLoopBloom();
    });
    this.loops.add(handle);
    this.syncLoopBloom();
    return handle;
  }

  private syncLoopBloom(): void {
    let best: LoopDef['bloom'] | null = null;
    for (const h of this.loops) if (h.def.bloom && (!best || h.def.bloom.strength > best.strength)) best = h.def.bloom;
    this.post?.setLoopBloom(best);
  }

  play(effect: string | EffectDef, opts: PlayOptions): FXHandle {
    if (this.disposed) throw new Error('rollshade: this FXSystem was disposed. Create a new one');
    const def = typeof effect === 'string' ? this.defs.get(effect) : effect;
    if (!def) throw new Error(`rollshade: unknown effect "${effect}". Added: ${[...this.defs.keys()].join(', ') || 'none'}. Call fx.add(effect('meteor', 'fire')) first, or pass the definition itself to fx.play()`);
    const recipe = Object.hasOwn(RECIPES, def.recipe) ? RECIPES[def.recipe] : undefined;
    if (!recipe) throw new Error(`rollshade: unknown recipe "${def.recipe}". Use one of: ${Object.keys(RECIPES).join(', ')}`);
    if (!opts?.from) throw new Error(`rollshade: fx.play('${def.id}', { from, to }) needs from (a THREE.Vector3 or an Object3D)`);
    if (!opts.to) opts = { ...opts, to: opts.from };
    this.activate();
    const handle = new FXHandle(def.id, this);
    this.handles.add(handle);
    handle.done.then(() => this.handles.delete(handle));
    const pal: Palette = palette(def.element, def.hue ?? 0, def.color);
    const ctx = new Ctx(this, handle, def, pal, opts);
    ctx.params = clampParams(def.recipe, { ...recipeDefaults(def.recipe), ...def.params });
    const outer = this.scheduler.part;
    this.scheduler.part = 'main';
    recipe(ctx, ctx.params);
    ctx.finish();
    this.scheduler.part = outer;
    return handle;
  }

  status(target: THREE.Object3D, name: string, options: StatusOptions = {}): StatusRun {
    const recipe = Object.hasOwn(STATUSES, name) ? STATUSES[name] : undefined;
    if (!recipe && Object.hasOwn(FIXTURES, name)) throw new Error(`rollshade: "${name}" is a placed loop, not a status. Use fx.loop('${name}', position)`);
    if (!recipe && Object.hasOwn(RECIPES, name)) throw new Error(`rollshade: "${name}" is a move, not a status. Use fx.play(effect('${name}', element), { from, to })`);
    if (!recipe) throw new Error(`rollshade: unknown status "${name}". Use one of: ${Object.keys(STATUSES).join(', ')}`);
    if (!target?.isObject3D) throw new Error('rollshade: fx.status() needs a THREE.Object3D (a character or its mesh)');
    let meshed = false;
    target.traverse((o) => {
      if ((o as THREE.Mesh).isMesh && (o as THREE.Mesh).geometry?.getAttribute('position')) meshed = true;
    });
    if (!meshed) throw new Error(`rollshade: fx.status(target, '${name}') needs a target that contains a mesh. Pass the character model, not an empty Object3D`);
    this.activate();
    return this.statuses.start(target, name, recipe, new FXHandle(`status-${name}`, this), options);
  }

  private renderAll(roots: THREE.Object3D[], warm = false): void {
    const culled: THREE.Object3D[] = [];
    for (const root of roots)
      root.traverse((o) => {
        if (o.frustumCulled) {
          o.frustumCulled = false;
          culled.push(o);
        }
      });
    if (warm && this.post) this.post.warm();
    else if (this.post) this.post.render();
    else this.renderer.render(this.scene, this.camera);
    for (const o of culled) o.frustumCulled = true;
  }

  private async compile(roots: THREE.Object3D[], onProgress?: (progress: number) => void): Promise<void> {
    if (!this.post) {
      await this.renderer.compileAsync(this.scene, this.camera, null, onProgress && ((e) => onProgress((0.9 * e.loaded) / Math.max(e.total, 1))));
      if (this.disposed) return;
      this.renderAll(roots);
      this.calm();
      onProgress?.(1);
      return;
    }
    const meshes: THREE.Object3D[] = [];
    const leaf = (o: THREE.Object3D) => {
      let inner = false;
      o.traverse((c) => (inner ||= c !== o && (c as THREE.Mesh).isMesh));
      return !inner;
    };
    for (const root of roots) root.traverse((o) => (o as THREE.Mesh).isMesh && o.visible && leaf(o) && meshes.push(o));
    const steps = Math.max(Math.min(WARM_STEPS, meshes.length), 1);
    for (let step = 0; step < steps && !this.disposed; step++) {
      meshes.forEach((m, i) => (m.visible = i % steps === step));
      this.renderAll(roots, true);
      onProgress?.((step + 1) / steps);
      if (step < steps - 1) await new Promise((r) => setTimeout(r, 0));
    }
    for (const m of meshes) m.visible = true;
    if (!this.disposed) this.post.render();
    this.calm();
  }

  async prewarmStatus(target: THREE.Object3D, names: string[] = Object.keys(STATUSES), onProgress?: (progress: number) => void): Promise<void> {
    const parent = target.parent;
    const index = parent ? parent.children.indexOf(target) : -1;
    const visible = target.visible;
    let borrow = true;
    for (let o = parent; o; o = o.parent) {
      if (!o.visible) break;
      if (o === this.scene) borrow = false;
    }
    if (borrow) {
      this.scene.add(target);
      target.updateWorldMatrix(false, true);
    }
    target.visible = true;
    const runs: StatusRun[] = [];
    try {
      for (const name of names) runs.push(this.status(target, name, { progress: 0, duration: 0 }));
      await this.compile([target], onProgress);
    } catch (error) {
      for (const run of runs) run.finish();
      throw error;
    } finally {
      target.visible = visible;
      if (borrow) {
        if (parent) {
          parent.add(target);
          parent.children.splice(parent.children.indexOf(target), 1);
          parent.children.splice(index, 0, target);
        } else target.removeFromParent();
        target.updateWorldMatrix(true, true);
      }
    }
    if (this.disposed) return;
    for (const run of runs) run.finish();
    this.statuses.update(0, this.scheduler.time);
  }

  loop(name: string, at: THREE.Vector3 | THREE.Object3D, options: FixtureOptions = {}): FixtureRun {
    const recipe = Object.hasOwn(FIXTURES, name) ? FIXTURES[name] : undefined;
    if (!recipe && Object.hasOwn(STATUSES, name)) throw new Error(`rollshade: "${name}" is a status effect, not a loop. Use fx.status(target, '${name}')`);
    if (!recipe && Object.hasOwn(RECIPES, name)) throw new Error(`rollshade: "${name}" is a move, not a loop. Use fx.play(effect('${name}', element), { from, to })`);
    if (!recipe) throw new Error(`rollshade: unknown loop "${name}". Use one of: ${Object.keys(FIXTURES).join(', ')}`);
    if (!at) throw new Error('rollshade: fx.loop() needs a position (THREE.Vector3) or an Object3D to follow');
    this.activate();
    const run = new FixtureRun(this, name, recipe, new FXHandle(`loop-${name}`, this), at, options);
    this.fixtures.add(run);
    run.done.then(() => this.fixtures.delete(run));
    return run;
  }

  statusesOf(target: THREE.Object3D): StatusRun[] {
    return this.statuses.of(target);
  }

  stats(): { effects: number; loops: number; statuses: number; particles: number; solids: number; created: number; quality: number } {
    let particles = 0;
    for (const sys of Object.values(this.particles)) particles += sys.alive;
    return { effects: this.handles.size, loops: this.loops.size + this.fixtures.size, statuses: this.statuses.count, particles, solids: this.rocks.size + this.crystals.size + this.spikes.size, created: this.prims.created, quality: this.level };
  }

  async prewarm(counts: Partial<Record<string, number>> = {}, onProgress?: (progress: number) => void): Promise<void> {
    const want: Record<string, number> = { arc: 8, ribbon: 20, bolt: 48, beam: 12, shield: 3, void: 4, lathe: 8, latheSmoke: 3, helix: 8, ...counts };
    const made: { type: string; prim: ReturnType<PrimPool['fill']>[number] }[] = [];
    for (const [type, n] of Object.entries(want)) for (const prim of this.prims.fill(type, n ?? 0)) made.push({ type, prim });
    const o = new THREE.Vector3();
    const x = new THREE.Vector3(1, 0, 0);
    const z = new THREE.Vector3(0, 0, 1);
    for (const { type, prim } of made) {
      if (type === 'arc') arcGeometry(prim.mesh.geometry, o, x, z, 0, 1, 0.5, 1);
      else if (type === 'ribbon') new RibbonTrail(prim, RIBBON_LENGTH, 0.1);
      else if (type === 'helix') helixGeometry(prim.mesh.geometry, { center: o, r0: 1, r1: 1, height: 1, turns: 1, width: 0.1 });
      else if (type === 'bolt') stripGeometry(prim.mesh.geometry, Array.from({ length: BOLT_POINTS }, (_, i) => new THREE.Vector3(i, 0, 0)), () => 0.1, this.camera);
      prim.mesh.position.set(0, -1000, 0);
      prim.mesh.scale.setScalar(0.001);
      this.root.add(prim.mesh);
    }
    this.activate();
    for (const sys of Object.values(this.particles)) sys.primeForCompile(true);
    this.rocks.primeForCompile(true);
    this.crystals.primeForCompile(true);
    this.spikes.primeForCompile(true);
    this.prims.prime(true);
    const hidden = new THREE.Vector3(0, -1000, 0);
    const fixtures = Object.keys(FIXTURES).map((name) => this.loop(name, hidden));
    await this.compile([this.root, ...fixtures.map((f) => f.group)], onProgress);
    if (this.disposed) {
      for (const { prim } of made) {
        prim.mesh.removeFromParent();
        disposePrim(prim);
      }
      this.release();
      return;
    }
    for (const f of fixtures) f.finish();
    for (const sys of Object.values(this.particles)) sys.primeForCompile(false);
    this.rocks.primeForCompile(false);
    this.crystals.primeForCompile(false);
    this.spikes.primeForCompile(false);
    this.prims.prime(false);
    for (const { prim } of made) {
      prim.mesh.position.set(0, 0, 0);
      prim.mesh.scale.setScalar(1);
      this.prims.release(prim);
    }
  }

  get hitStopping(): boolean {
    return this.stopT > 0;
  }

  shake(amount: number): void {
    this.trauma = Math.min(this.trauma + amount, 1);
  }

  hitStop(seconds: number): void {
    this.stopT = Math.max(this.stopT, seconds);
  }

  update(dt: number): void {
    if (!(dt > 0)) dt = 0;
    this.activate();
    if (this.autoQuality && dt > 0) this.adapt(Math.min(dt, 0.25));
    const real = Math.min(dt, 0.1);
    const sim = real * this.timeScale * (this.stopT > 0 ? 0.04 : 1);
    this.stopT = Math.max(this.stopT - real, 0);
    this.scheduler.step(sim);
    for (const h of this.loops) h.step(sim);
    this.statuses.update(sim, this.scheduler.time);
    for (const f of this.fixtures) f.step(sim, this.scheduler.time);
    this.prims.sync();
    const t = this.scheduler.time;
    for (const sys of Object.values(this.particles)) sys.update(sim, t);
    flushParticleEvents();
    this.rocks.floorY = this.crystals.floorY = this.spikes.floorY = this.floorY;
    this.rocks.update(sim);
    this.crystals.update(sim);
    this.spikes.update(sim);
    this.lights.update(sim);
    this.loopLights.update(sim);
    this.post?.update(sim, real);
    this.trauma = Math.max(this.trauma - real * 1.6, 0);
    this.shakeTime += real;
  }

  render(): void {
    this.activate();
    this.applyShake();
    if (this.post) this.post.render();
    else this.renderer.render(this.scene, this.camera);
    this.restoreShake();
  }

  applyShake(): void {
    if (this.trauma <= 0 || this.shakeSaved) return;
    const s = this.trauma * this.trauma;
    const t = this.shakeTime;
    const cam = this.camera;
    this.shakeSaved = { pos: cam.position.clone(), quat: cam.quaternion.clone() };
    const n = (f: number, o: number) => Math.sin(t * f + o) * 0.5 + Math.sin(t * f * 2.13 + o * 1.7) * 0.3 + Math.sin(t * f * 4.7 + o * 0.3) * 0.2;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
    cam.position.addScaledVector(right, n(47, 1) * 0.12 * s).addScaledVector(up, n(53, 4) * 0.1 * s);
    cam.rotateZ(n(41, 7) * 0.035 * s);
    cam.updateMatrixWorld();
  }

  restoreShake(): void {
    if (!this.shakeSaved) return;
    this.camera.position.copy(this.shakeSaved.pos);
    this.camera.quaternion.copy(this.shakeSaved.quat);
    this.camera.updateMatrixWorld();
    this.shakeSaved = null;
  }

  clear(): void {
    for (const h of [...this.handles]) h.stop();
    for (const h of [...this.loops]) h.stop();
    this.statuses.clear();
    for (const f of [...this.fixtures]) f.finish();
    this.statuses.update(0, this.scheduler.time);
    this.scheduler.cancel();
    for (const sys of Object.values(this.particles)) sys.clear();
    this.rocks.clear();
    this.crystals.clear();
    this.spikes.clear();
    this.lights.clear();
    this.loopLights.clear();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.restoreShake();
    this.clear();
    this.release();
  }

  private release(): void {
    this.prims.dispose();
    for (const sys of Object.values(this.particles)) sys.dispose();
    this.rocks.dispose();
    this.crystals.dispose();
    this.spikes.dispose();
    this.post?.dispose();
    this.root.removeFromParent();
    this.root.clear();
  }
}

export function recipeDefaults(name: string): Record<string, number> {
  return RECIPES[name]?.defaults ?? {};
}
