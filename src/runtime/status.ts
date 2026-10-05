import * as THREE from 'three/webgpu';
import { abs, clamp, cross, dot, faceDirection, float, materialColor, materialEmissive, materialMetalness, materialRoughness, mix, positionView, sign, vec2, normalGeometry, normalLocal, positionGeometry, positionLocal, positionViewDirection, normalView, positionWorld, pow, smoothstep, uniform, vec3 } from 'three/tsl';
import { Ctx, clamp01 } from './ctx';
import { helpers } from './loop-helpers';
import { tnoise } from './noise';
import { palette, type Palette } from './palette';
import { glowing } from './post';
import type { FXHandle, FXSystem } from './system';

type N = any;

export type StatusName = 'burn' | 'freeze' | 'shock' | 'poison';

export interface StatusOptions {
  element?: string;
  hue?: number;
  color?: THREE.ColorRepresentation;
  progress?: number;
  duration?: number;
  lasts?: number;
  fade?: number;
  scale?: number;
}

export type StatusEvent = 'full' | 'end';

const TAG = '__rollshadeStatus';

const keepers = new Map<string, THREE.Material>();

export function keep(key: string, material: THREE.Material): void {
  if (!keepers.has(key)) keepers.set(key, material);
}

export function variantOf(mesh: THREE.Mesh, material?: THREE.Material): string {
  const m = (material ?? {}) as THREE.MeshStandardMaterial;
  const morph = Object.keys(mesh.geometry?.morphAttributes ?? {}).join(',');
  return [(mesh as THREE.SkinnedMesh).isSkinnedMesh ? 'skin' : 'rigid', morph, m.map ? 'map' : '', m.normalMap ? 'normal' : '', m.alphaMap ? 'alpha' : '', m.vertexColors ? 'vc' : '', m.transparent ? 't' : '', m.side ?? 0, m.alphaTest ? 'at' : ''].join('|');
}

interface Binding {
  layer: StatusLayer;
  run?: StatusRun;
  unit: number;
  thick?: number;
}

const bound = (o: THREE.Object3D) => o.userData.rollshadeStatus as Binding | undefined;
const bind = (o: THREE.Object3D, value: Binding) => Object.defineProperty(o.userData, 'rollshadeStatus', { value, enumerable: false, configurable: true, writable: true });
const tag = (o: THREE.Object3D) => Object.defineProperty(o.userData, TAG, { value: true, enumerable: false, configurable: true });

function perObject(get: (b: Binding) => number): N {
  return uniform(0).onObjectUpdate(({ object }) => {
    const b = object ? bound(object) : undefined;
    return b ? get(b) : 0;
  });
}

function perObjectColor(get: (b: Binding) => THREE.Color): N {
  const none = new THREE.Color();
  return uniform(new THREE.Color()).onObjectUpdate(({ object }) => {
    const b = object ? bound(object) : undefined;
    return b ? get(b) : none;
  });
}

const black = new THREE.Color();

export const L = {
  time: perObject((b) => b.layer.u.time.value),
  foot: perObject((b) => b.layer.u.foot.value),
  height: perObject((b) => b.layer.u.height.value),
  char: perObject((b) => b.layer.u.char.value),
  ember: perObjectColor((b) => b.layer.u.ember.value),
  ice: perObject((b) => b.layer.u.ice.value),
  iceTint: perObjectColor((b) => b.layer.u.iceTint.value),
  tint: perObjectColor((b) => b.layer.u.tint.value),
  tintAmt: perObject((b) => b.layer.u.tintAmt.value),
  blotch: perObject((b) => b.layer.u.blotch.value),
  rim: perObjectColor((b) => b.layer.u.rim.value),
  rimAmt: perObject((b) => b.layer.u.rimAmt.value),
  stone: perObject((b) => b.layer.u.stone.value),
  gone: perObject((b) => b.layer.u.gone.value),
  edge: perObjectColor((b) => b.layer.u.edge.value),
  unit: perObject((b) => b.unit),
};

export const R = {
  amount: perObject((b) => b.run?.amount.value ?? 0),
  core: perObjectColor((b) => b.run?.pal.core ?? black),
  main: perObjectColor((b) => b.run?.pal.main ?? black),
  accent: perObjectColor((b) => b.run?.pal.accent ?? black),
  shade: perObjectColor((b) => b.run?.shade ?? black),
  thick: perObject((b) => (b.thick ?? 0.02) / b.unit),
};

const meshKind = (mesh: THREE.Mesh) => `${(mesh as THREE.SkinnedMesh).isSkinnedMesh ? 'skin' : 'rigid'}|${Object.keys(mesh.geometry?.morphAttributes ?? {}).join(',')}`;
const surfaces = new WeakMap<THREE.Material, Map<string, THREE.Material>>();
const shells = new Map<string, THREE.Material>();
const held = new Set<string>();
const shellKey = new WeakMap<THREE.Mesh, string>();

export function release(material: THREE.Material): void {
  for (const m of keepers.values()) if (m === material) return;
  material.dispose();
}

export function tri(p: N, n: N, s: number): N {
  const w: N = abs(n);
  const ws = w.div(w.x.add(w.y).add(w.z).add(1e-4));
  return tnoise(p.yz.mul(s)).mul(ws.x).add(tnoise(p.xz.mul(s)).mul(ws.y)).add(tnoise(p.xy.mul(s)).mul(ws.z));
}

export function dissolveField(p: N, n: N, h: N): N {
  const key: N = tri(p, n, 0.55).r.mul(0.75).add(float(1).sub(h).mul(0.25));
  return key.sub(L.gone.mul(1.12).sub(0.06));
}

function perturb(dH: N): N {
  const sx: N = positionView.dFdx().normalize();
  const sy: N = positionView.dFdy().normalize();
  const r1: N = cross(sy, normalView);
  const r2: N = cross(normalView, sx);
  const det: N = dot(sx, r1).mul(faceDirection);
  const grad: N = sign(det).mul(dH.x.mul(r1).add(dH.y.mul(r2)));
  return abs(det).mul(normalView).sub(grad).normalize();
}

function sweep(amount: N, h: N, jitter: N): N {
  const front: N = amount.mul(1.25).sub(0.12);
  return float(1).sub(smoothstep(front.sub(0.03), front.add(0.03), h.add(jitter.sub(0.5).mul(0.18))));
}

class Surface {
  private items: { mesh: THREE.Mesh; tris: Uint32Array; cdf: Float32Array; area: number }[] = [];
  private total = 0;
  private a = new THREE.Vector3();
  private b = new THREE.Vector3();
  private c = new THREE.Vector3();
  private m3 = new THREE.Matrix3();

  constructor(meshes: THREE.Mesh[]) {
    for (const mesh of meshes) {
      const pos = mesh.geometry.getAttribute('position');
      if (!pos) continue;
      const index = mesh.geometry.getIndex();
      const count = index ? index.count : pos.count;
      const n = Math.floor(count / 3);
      if (n === 0) continue;
      const tris = new Uint32Array(n * 3);
      const cdf = new Float32Array(n);
      let acc = 0;
      for (let t = 0; t < n; t++) {
        for (let k = 0; k < 3; k++) tris[t * 3 + k] = index ? index.getX(t * 3 + k) : t * 3 + k;
        this.a.fromBufferAttribute(pos, tris[t * 3]);
        this.b.fromBufferAttribute(pos, tris[t * 3 + 1]);
        this.c.fromBufferAttribute(pos, tris[t * 3 + 2]);
        acc += this.b.sub(this.a).cross(this.c.sub(this.a)).length() * 0.5;
        cdf[t] = acc;
      }
      const scale = mesh.matrixWorld.getMaxScaleOnAxis() || 1;
      const area = acc * scale * scale;
      this.items.push({ mesh, tris, cdf, area });
      this.total += area;
    }
  }

  sample(out: THREE.Vector3, nrm?: THREE.Vector3): boolean {
    if (this.total <= 0) return false;
    let pick = Math.random() * this.total;
    let k = 0;
    while (k < this.items.length - 1 && pick > this.items[k].area) pick -= this.items[k++].area;
    const { mesh, tris, cdf } = this.items[k];
    const x = Math.random() * cdf[cdf.length - 1];
    let lo = 0;
    let hi = cdf.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < x) lo = mid + 1;
      else hi = mid;
    }
    mesh.getVertexPosition(tris[lo * 3], this.a);
    mesh.getVertexPosition(tris[lo * 3 + 1], this.b);
    mesh.getVertexPosition(tris[lo * 3 + 2], this.c);
    let u = Math.random();
    let v = Math.random();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    out.copy(this.a).addScaledVector(this.b.sub(this.a), u).addScaledVector(this.c.sub(this.a), v);
    if (nrm) nrm.copy(this.b).cross(this.c).normalize().applyMatrix3(this.m3.getNormalMatrix(mesh.matrixWorld)).normalize();
    mesh.localToWorld(out);
    return true;
  }

  band(out: THREE.Vector3, y0: number, y1: number, tries = 8, nrm?: THREE.Vector3): boolean {
    for (let t = 0; t < tries; t++) {
      if (!this.sample(out, nrm)) return false;
      if (out.y >= y0 && out.y <= y1) return true;
    }
    return false;
  }
}

const slot = <T>(value: T) => ({ value });

function buildSurface(source: THREE.Material): THREE.Material {
  const m: N = helpers.convertMaterial(source);
  const from = source as THREE.MeshStandardMaterial;
  const lit = !!m.isMeshStandardNodeMaterial;
  if (lit && from.emissive) {
    m.emissive.copy(from.emissive);
    m.emissiveMap = from.emissiveMap ?? null;
    m.emissiveIntensity = from.emissiveIntensity ?? 1;
  }
  if (lit && from.envMap) {
    m.envMap = from.envMap;
    m.envMapIntensity = from.envMapIntensity ?? 1;
  }
  const p: N = positionGeometry.mul(L.unit);
  const n: N = normalGeometry;
  const h: N = positionWorld.y.sub(L.foot).div(L.height);
  const fres: N = pow(float(1).sub(abs(dot(normalView, positionViewDirection))).max(0), 2);
  const nz: N = tri(p, n, 0.35);
  const fine: N = tri(p, n, 1.6);
  const base: N = materialColor.rgb;
  const lum: N = dot(base, vec3(0.299, 0.587, 0.114));
  const cracks: N = smoothstep(0.035, 0.0, abs(fine.r.sub(0.5))).mul(smoothstep(0.35, 0.65, nz.g));
  const charred: N = mix(base, base.mul(0.18).add(vec3(0.02, 0.015, 0.012)), L.char.mul(smoothstep(0.25, 0.75, nz.r.add(0.25))));
  const blot: N = smoothstep(0.52, 0.68, nz.r.add(fine.g.mul(0.3)).sub(0.15)).mul(L.blotch);
  const tinted: N = mix(charred, mix(charred, L.tint.mul(lum.mul(0.6).add(0.4)), 0.75), clamp(L.tintAmt.add(blot), 0, 1));
  const iceMask: N = sweep(L.ice, h, nz.r);
  const stoneMask: N = sweep(L.stone, h, nz.g);
  const frost: N = smoothstep(0.45, 0.8, fine.g).mul(0.35);
  const iceCol: N = mix(base.mul(0.25).add(L.iceTint.mul(0.45)), vec3(0.92, 0.97, 1), frost.add(fres.mul(0.5)));
  const grain: N = tri(p, n, 4.5);
  const speck: N = tri(p, n, 13);
  const fissure: N = smoothstep(0.018, 0.004, abs(fine.r.sub(0.5))).mul(smoothstep(0.62, 0.75, nz.g));
  const height: N = nz.r.mul(0.3).add(grain.r.mul(0.35)).add(speck.g.mul(0.35)).sub(fissure.mul(0.5));
  const tone: N = mix(vec3(0.22, 0.215, 0.2), vec3(0.4, 0.38, 0.34), smoothstep(0.3, 0.7, nz.g.mul(0.6).add(grain.b.mul(0.4))));
  const dots: N = smoothstep(0.7, 0.76, speck.r).mul(-0.3).add(smoothstep(0.76, 0.82, speck.g).mul(0.2)).add(grain.g.sub(0.5).mul(0.25));
  const stoneCol: N = tone
    .mul(lum.mul(0.2).add(0.9))
    .mul(smoothstep(0.2, 0.7, height).mul(0.35).add(0.7))
    .mul(dots.add(1))
    .mul(float(1).sub(fissure.mul(0.55)));
  const d: N = dissolveField(p, n, h);
  const edge: N = smoothstep(0.07, 0.0, d).mul(smoothstep(0, 0.02, L.gone));
  m.colorNode = mix(mix(tinted, iceCol, iceMask), stoneCol, stoneMask).mul(float(1).sub(edge.mul(0.8)));
  m.maskNode = d.greaterThan(0);
  const glitter: N = smoothstep(0.86, 0.9, tri(p.add(positionViewDirection.mul(0.02)), n, 5).r).mul(iceMask);
  const flick: N = tnoise(p.xz.mul(0.2).add(L.time.mul(0.35))).r.mul(1.4).sub(0.2);
  m.emissiveNode = (lit ? (materialEmissive as N) : vec3(0)).add(L.ember.mul(cracks.mul(L.char).mul(flick).mul(3)))
    .add(L.iceTint.mul(fres.mul(0.35).add(glitter.mul(2))).mul(iceMask))
    .add(L.rim.mul(fres.mul(L.rimAmt)))
    .add(L.tint.mul(blot.mul(0.35)))
    .add(L.edge.mul(pow(edge, 1.5).mul(4)))
    .mul(float(1).sub(stoneMask.mul(0.85)).max(edge));
  if (!m.normalMap) {
    const bump: N = perturb(vec2(height.dFdx(), height.dFdy()).mul(stoneMask).mul(2.2));
    m.normalNode = bump;
  }
  if (lit) {
    m.roughnessNode = mix(mix(materialRoughness as N, float(0.12), iceMask), float(0.95), stoneMask);
    m.metalnessNode = mix(materialMetalness as N, float(0), stoneMask);
  }
  return m;
}


export class StatusLayer {
  readonly u = {
    time: slot(0),
    foot: slot(0),
    height: slot(1.8),
    char: slot(0),
    ember: slot(new THREE.Color()),
    ice: slot(0),
    iceTint: slot(new THREE.Color()),
    tint: slot(new THREE.Color()),
    tintAmt: slot(0),
    blotch: slot(0),
    rim: slot(new THREE.Color()),
    rimAmt: slot(0),
    stone: slot(0),
    gone: slot(0),
    edge: slot(new THREE.Color()),
  };
  readonly meshes: THREE.Mesh[] = [];
  readonly surface: Surface;
  readonly runs = new Set<StatusRun>();
  readonly center = new THREE.Vector3();
  radius = 0.4;
  private originals = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  private footOffset = 0;
  private world = new THREE.Vector3();
  private placed = false;

  constructor(readonly target: THREE.Object3D) {
    target.updateWorldMatrix(true, true);
    target.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh && !(m.userData as Record<string, unknown>)[TAG] && m.geometry?.getAttribute('position')) this.meshes.push(m);
    });
    const box = new THREE.Box3().setFromObject(target);
    const size = box.getSize(new THREE.Vector3());
    target.getWorldPosition(this.world);
    this.footOffset = box.min.y - this.world.y;
    this.u.height.value = Math.max(size.y, 0.2);
    this.radius = Math.max(size.x, size.z) * 0.5;
    this.surface = new Surface(this.meshes);
    for (const mesh of this.meshes) this.convert(mesh);
    this.sync();
  }

  get foot(): number {
    return this.u.foot.value;
  }

  get height(): number {
    return this.u.height.value;
  }

  sync(): void {
    this.target.getWorldPosition(this.world);
    this.u.foot.value = this.world.y + this.footOffset;
    this.center.set(this.world.x, this.u.foot.value + this.u.height.value * 0.5, this.world.z);
  }

  orphaned(scene: THREE.Object3D): boolean {
    let inside = false;
    for (let o: THREE.Object3D | null = this.target; o; o = o.parent) if (o === scene) inside = true;
    if (inside) this.placed = true;
    return this.placed && !inside;
  }

  unitOf(mesh: THREE.Mesh): number {
    return mesh.matrixWorld.getMaxScaleOnAxis() || 1;
  }

  private convert(mesh: THREE.Mesh): void {
    bind(mesh, { layer: this, unit: this.unitOf(mesh) });
    const sources = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const converted = sources.map((source) => {
      let byKind = surfaces.get(source);
      if (!byKind) surfaces.set(source, (byKind = new Map()));
      const kind = meshKind(mesh);
      let m = byKind.get(kind);
      if (!m) {
        const built = (m = buildSurface(source));
        byKind.set(kind, built);
        const drop = () => {
          source.removeEventListener('dispose', drop);
          byKind.delete(kind);
          built.dispose();
        };
        source.addEventListener('dispose', drop);
      }
      return m;
    });
    this.originals.set(mesh, mesh.material);
    mesh.material = Array.isArray(mesh.material) ? converted : converted[0];
  }

  reset(): void {
    const u = this.u;
    u.char.value = 0;
    u.ice.value = 0;
    u.tintAmt.value = 0;
    u.blotch.value = 0;
    u.rimAmt.value = 0;
    u.stone.value = 0;
    u.gone.value = 0;
    (u.rim.value as THREE.Color).setRGB(0, 0, 0);
  }

  dispose(): void {
    for (const [mesh, mat] of this.originals) {
      mesh.material = mat;
      delete mesh.userData.rollshadeStatus;
    }
    this.originals.clear();
  }
}

export interface StatusRecipe {
  element: string;
  duration: number;
  initial?: number;
  goal?: number;
  autoEnd?: boolean;
  stopped?(run: StatusRun): void;
  impact?(run: StatusRun, point: THREE.Vector3): void;
  shell?: () => N;
  thickness?: number;
  apply(run: StatusRun, v: number): void;
  tick?(run: StatusRun, v: number, dt: number): void;
  start?(run: StatusRun): void;
  end?(run: StatusRun): void;
}

export class StatusRun {
  value = 0;
  target = 1;
  private rate = 1;
  readonly amount = { value: 0 };
  readonly shade: THREE.Color;
  readonly ctx: Ctx;
  readonly pal: Palette;
  readonly overlays: THREE.Mesh[] = [];
  private listeners = new Map<StatusEvent, Set<() => void>>();
  private stopping = false;
  private fullSent = false;
  private left = Infinity;
  private fade: number;
  alive = true;
  readonly done: Promise<void>;
  private resolve!: () => void;
  readonly state: Record<string, any> = {};

  constructor(
    readonly fx: FXSystem,
    readonly layer: StatusLayer,
    readonly name: string,
    readonly recipe: StatusRecipe,
    readonly handle: FXHandle,
    opts: StatusOptions,
  ) {
    this.done = new Promise((r) => (this.resolve = r));
    const element = opts.element ?? recipe.element;
    this.pal = palette(element, opts.hue ?? 0, opts.color);
    this.shade = (this.pal.smoke ?? this.pal.accent).clone().lerp(this.pal.accent, 0.45);
    this.ctx = new Ctx(fx, handle, { id: `status-${name}`, recipe: 'status', element, hue: opts.hue ?? 0 }, this.pal, { from: layer.target, to: layer.target, scale: opts.scale ?? 1 });
    this.ctx.params = {};
    this.value = recipe.initial ?? 0;
    this.fade = opts.fade ?? 0.4;
    if (opts.lasts !== undefined && !recipe.autoEnd) this.lasts = opts.lasts;
    this.to(recipe.autoEnd ? recipe.goal ?? 0 : opts.progress ?? recipe.goal ?? 1, opts.duration ?? recipe.duration);
    if (recipe.shell) {
      for (const mesh of layer.meshes) {
        const key = `${name}|${meshKind(mesh)}`;
        let mat = shells.get(key);
        if (!mat) {
          const built: N = recipe.shell();
          built.positionNode = positionLocal.add(normalLocal.mul(R.thick));
          built.maskNode = dissolveField(positionGeometry.mul(L.unit), normalGeometry, positionWorld.y.sub(L.foot).div(L.height)).greaterThan(0);
          shells.set(key, (mat = built as THREE.Material));
        }
        const copy: THREE.Mesh = helpers.overlay(mesh, mat);
        tag(copy);
        glowing.add(copy);
        shellKey.set(copy, key);
        bind(copy, { layer, run: this, unit: layer.unitOf(mesh), thick: recipe.thickness });
        copy.renderOrder = 2;
        this.overlays.push(copy);
      }
    }
    recipe.start?.(this);
  }

  get progress(): number {
    return this.target;
  }

  set progress(v: number) {
    this.to(v, 0);
  }

  get lasts(): number {
    return this.left;
  }

  set lasts(seconds: number) {
    this.left = Math.max(seconds, 0);
  }

  to(progress: number, seconds = 0.5): this {
    this.target = clamp01(progress);
    const gap = Math.abs(this.target - this.value);
    this.rate = seconds > 0 ? gap / seconds : Infinity;
    if (this.target < 1) this.fullSent = false;
    return this;
  }

  on(event: StatusEvent, fn: () => void): () => void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(fn);
    return () => this.listeners.get(event)?.delete(fn);
  }

  private emit(event: StatusEvent): void {
    for (const fn of [...(this.listeners.get(event) ?? [])]) {
      try {
        fn();
      } catch (error) {
        queueMicrotask(() => {
          throw error;
        });
      }
    }
  }

  impact(point: THREE.Vector3): void {
    if (this.alive && !this.stopping) this.recipe.impact?.(this, point);
  }

  stop(fade = this.fade): void {
    if (this.stopping || !this.alive) return;
    this.stopping = true;
    this.recipe.stopped?.(this);
    this.to(this.recipe.initial ?? 0, fade);
  }

  step(dt: number): void {
    if (!this.alive) return;
    if (this.left !== Infinity && !this.stopping && (this.left -= dt) <= 0) this.stop();
    const d = this.target - this.value;
    const move = this.rate === Infinity ? Math.abs(d) : this.rate * dt;
    this.value = Math.abs(d) <= move ? this.target : this.value + Math.sign(d) * move;
    this.amount.value = this.value;
    if (this.value >= 1 && !this.fullSent && !this.recipe.autoEnd) {
      this.fullSent = true;
      this.emit('full');
    }
    this.recipe.apply(this, this.value);
    if (this.value > 0.001) this.recipe.tick?.(this, this.value, dt);
    if (this.stopping && this.value === (this.recipe.initial ?? 0)) this.finish();
    else if (this.recipe.autoEnd && this.value === this.target) this.finish();
  }

  finish(): void {
    if (!this.alive) return;
    this.alive = false;
    this.recipe.end?.(this);
    this.handle.stop();
    for (const o of this.overlays) {
      o.removeFromParent();
      const key = shellKey.get(o)!;
      if (held.has(key)) o.dispose();
      else held.add(key);
    }
    this.layer.runs.delete(this);
    this.emit('end');
    this.resolve();
  }
}

export class StatusManager {
  private layers = new Map<THREE.Object3D, StatusLayer>();

  constructor(private fx: FXSystem) {}

  start(target: THREE.Object3D, name: string, recipe: StatusRecipe, handle: FXHandle, opts: StatusOptions): StatusRun {
    let layer = this.layers.get(target);
    if (!layer) {
      layer = new StatusLayer(target);
      this.layers.set(target, layer);
    }
    for (const r of [...layer.runs]) if (r.name === name || (name === 'appear' && r.name === 'dissolve')) r.finish();
    const run = new StatusRun(this.fx, layer, name, recipe, handle, opts);
    layer.runs.add(run);
    return run;
  }

  of(target: THREE.Object3D): StatusRun[] {
    return [...(this.layers.get(target)?.runs ?? [])];
  }

  update(dt: number, time: number): void {
    for (const [target, layer] of this.layers) {
      if (layer.orphaned(this.fx.scene)) for (const run of [...layer.runs]) run.finish();
      layer.sync();
      layer.u.time.value = time;
      layer.reset();
      for (const run of [...layer.runs]) run.step(dt);
      if (layer.runs.size === 0) {
        layer.dispose();
        this.layers.delete(target);
      }
    }
  }

  clear(): void {
    for (const layer of this.layers.values()) for (const run of [...layer.runs]) run.finish();
  }

  get count(): number {
    let n = 0;
    for (const l of this.layers.values()) n += l.runs.size;
    return n;
  }
}

