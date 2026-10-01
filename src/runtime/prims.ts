import * as THREE from 'three/webgpu';
import { Fn, abs, instancedDynamicBufferAttribute, varying, atan, clamp, dot, exp, float, max, mix, mod, mx_noise_float, normalView, positionLocal, positionView, pow, select, smoothstep, uniform, uniformArray, uv, vec2, vec3 } from 'three/tsl';
import { patternCircle, type CirclePattern } from './shaders';
import { seedShift, tnoise } from './noise';
import { bandMaterial, hitmarkMaterial, lathePrim, linesMaterial } from './shapes';

type N = any;

export interface Prim {
  mesh: THREE.Mesh;
  u: Record<string, N>;
}

export const RIBBON_LENGTH = 20;
export const BOLT_POINTS = 33;

type Layout = [string, 1 | 3, number?][];

interface BatchSpec {
  layout: Layout;
  geometry: THREE.BufferGeometry;
  build: (u: Record<string, N>) => THREE.Material;
  cap: number;
  renderOrder?: number;
}

const batchSpecs = (): Record<string, BatchSpec> => ({
  ring: { layout: [['k', 1], ['thick', 1, 0.08], ['core', 3], ['main', 3], ['bright', 1, 1], ['seed', 1]], geometry: quad(), build: (u) => ringMaterial(u), cap: 256 },
  decal: { layout: [['k', 1], ['heat', 1, 1], ['ember', 3], ['tint', 3], ['seed', 1], ['glow', 1, 1], ['crackScale', 1, 4.5], ['crackWidth', 1, 0.08], ['alpha', 1, 0.9], ['core', 1, 0.6]], geometry: quad(), build: (u) => decalMaterial(u), cap: 96, renderOrder: 0 },
  crescent: { layout: [['k', 1], ['core', 3], ['main', 3], ['bright', 1, 1], ['bend', 1, 0.35]], geometry: quad(), build: (u) => crescentMaterial(u), cap: 64, renderOrder: 5 },
  circle: {
    layout: [['turn', 1], ['reveal', 1, 1], ['fade', 1, 1], ['core', 3], ['main', 3], ['accent', 3], ['bright', 1, 1], ['mode', 1], ['sidesA', 1, 6], ['skipA', 1, 1], ['sidesB', 1], ['skipB', 1, 1], ['rotB', 1], ['spokes', 1], ['branch', 1], ['spiral', 1], ['waves', 1], ['dots', 1], ['petals', 1], ['runes', 1, 3], ['ticks', 1, 1]],
    geometry: quad(),
    build: (u) => circleMaterial(u),
    cap: 96,
  },
  sphere: { layout: [['k', 1], ['core', 3], ['main', 3], ['accent', 3], ['bright', 1, 1], ['seed', 1]], geometry: sphereGeometry(), build: (u) => sphereMaterial(u), cap: 64 },
  band: { layout: [['k', 1], ['a0', 1], ['span', 1, Math.PI * 2], ['inner', 1, 0.6], ['fadeS', 1, 0.2], ['fadeE', 1, 0.2], ['hard', 1], ['noise', 1, 1], ['cIn', 3], ['cMid', 3], ['cOut', 3], ['bright', 1, 1], ['seed', 1]], geometry: quad(), build: (u) => bandMaterial(u), cap: 128 },
  lines: { layout: [['k', 1], ['count', 1, 48], ['inner', 1, 0.35], ['width', 1, 0.18], ['density', 1, 0.7], ['mode', 1], ['reach', 1, 1], ['core', 3], ['main', 3], ['bright', 1, 1], ['seed', 1]], geometry: quad(), build: (u) => linesMaterial(u), cap: 32, renderOrder: 6 },
  hitmark: { layout: [['k', 1], ['spikes', 1, 12], ['inner', 1, 0.35], ['sharp', 1, 1], ['hard', 1, 1], ['core', 3], ['main', 3], ['accent', 3], ['bright', 1, 1], ['seed', 1], ['alpha', 1, 1], ['boost', 1], ['hole', 1]], geometry: quad(), build: (u) => hitmarkMaterial(u), cap: 32, renderOrder: 7 },
});

const tmpM = new THREE.Matrix4();
const zero = new THREE.Matrix4().makeScale(0, 0, 0);

class Batch {
  readonly mesh: THREE.InstancedMesh;
  private buffer: THREE.InstancedInterleavedBuffer;
  private stride: number;
  private slots: (Prim | null)[] = [];
  private order: Prim[] = [];
  private pinned: Prim[] = [];
  private free: number[] = [];
  private offsets: { name: string; size: number; at: number; def: number }[] = [];

  constructor(
    readonly type: string,
    private spec: BatchSpec,
  ) {
    let at = 0;
    for (const [name, size, def] of spec.layout) {
      this.offsets.push({ name, size, at, def: def ?? 0 });
      at += size;
    }
    const vecs = Math.ceil(at / 4);
    this.stride = vecs * 4;
    const nodes: Record<string, N> = {};
    this.buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(spec.cap * this.stride), this.stride);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    const reads: N[] = Array.from({ length: vecs }, (_, i) => varying(instancedDynamicBufferAttribute(this.buffer as N, 'vec4', this.stride, i * 4)));
    const comp = (i: number) => reads[Math.floor(i / 4)][['x', 'y', 'z', 'w'][i % 4]];
    for (const o of this.offsets) nodes[o.name] = o.size === 1 ? comp(o.at) : vec3(comp(o.at), comp(o.at + 1), comp(o.at + 2));
    this.mesh = new THREE.InstancedMesh(spec.geometry, spec.build(nodes), spec.cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    if (spec.renderOrder !== undefined) this.mesh.renderOrder = spec.renderOrder;
  }

  acquire(): Prim {
    let i = this.free.pop();
    if (i === undefined) {
      if (this.slots.length < this.spec.cap) i = this.slots.length;
      else {
        this.release(this.order[0] ?? this.pinned[0]);
        i = this.free.pop()!;
      }
    }
    const u: Record<string, N> = {};
    for (const o of this.offsets) u[o.name] = { value: o.size === 1 ? o.def : new THREE.Color(o.def, o.def, o.def) };
    const prim: Prim = { mesh: new THREE.Object3D() as unknown as THREE.Mesh, u };
    prim.mesh.userData.type = this.type;
    prim.mesh.userData.slot = i;
    this.slots[i] = prim;
    this.order.push(prim);
    return prim;
  }

  pin(prim: Prim): void {
    const k = this.order.indexOf(prim);
    if (k < 0) return;
    this.order.splice(k, 1);
    this.pinned.push(prim);
  }

  release(prim: Prim): void {
    const i = prim.mesh.userData.slot as number;
    if (this.slots[i] !== prim) return;
    this.slots[i] = null;
    this.free.push(i);
    const k = this.order.indexOf(prim);
    if (k >= 0) this.order.splice(k, 1);
    const p = this.pinned.indexOf(prim);
    if (p >= 0) this.pinned.splice(p, 1);
  }

  sync(): void {
    let hi = 0;
    for (let i = 0; i < this.slots.length; i++) {
      const prim = this.slots[i];
      if (!prim) {
        this.mesh.setMatrixAt(i, zero);
        continue;
      }
      hi = i + 1;
      const m = prim.mesh;
      if (m.userData.hidden) {
        this.mesh.setMatrixAt(i, zero);
        continue;
      }
      m.updateMatrix();
      this.mesh.setMatrixAt(i, tmpM.copy(m.matrix));
      for (const o of this.offsets) {
        const v = prim.u[o.name].value;
        const base = i * this.stride;
        if (o.size === 1) this.write(base, o.at, v);
        else {
          this.write(base, o.at, v.r);
          this.write(base, o.at + 1, v.g);
          this.write(base, o.at + 2, v.b);
        }
      }
    }
    this.mesh.count = hi;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.buffer.needsUpdate = true;
  }

  private write(base: number, at: number, v: number): void {
    (this.buffer.array as Float32Array)[base + at] = v;
  }

  prime(on: boolean): void {
    if (on) {
      this.mesh.setMatrixAt(0, tmpM.makeTranslation(0, -1000, 0).scale(new THREE.Vector3(0.001, 0.001, 0.001)));
      this.mesh.count = Math.max(this.mesh.count, 1);
      this.mesh.instanceMatrix.needsUpdate = true;
    } else this.sync();
  }

  get live(): number {
    return this.order.length;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

export class PrimPool {
  private free = new Map<string, Prim[]>();
  created = 0;
  mask: () => boolean = () => false;
  createdBy: Record<string, number> = {};
  private using = new Map<string, Set<Prim>>();

  readonly batches: Record<string, Batch> = {};

  constructor(
    private root: THREE.Object3D,
    private factories: Record<string, () => Prim>,
  ) {
    for (const [type, spec] of Object.entries(batchSpecs())) {
      const b = new Batch(type, spec);
      this.batches[type] = b;
      root.add(b.mesh);
    }
  }

  sync(): void {
    for (const b of Object.values(this.batches)) b.sync();
  }

  prime(on: boolean): void {
    for (const b of Object.values(this.batches)) b.prime(on);
  }

  acquire(type: string): Prim {
    const hidden = this.mask();
    const batch = this.batches[type];
    if (batch) {
      const prim = batch.acquire();
      prim.mesh.userData.hidden = hidden;
      return prim;
    }
    const list = this.free.get(type);
    let prim = list?.pop();
    if (!prim) {
      prim = this.factories[type]();
      this.created++;
      this.createdBy[type] = (this.createdBy[type] ?? 0) + 1;
    }
    prim.mesh.visible = !hidden;
    prim.mesh.userData.type = type;
    this.root.add(prim.mesh);
    if (!this.using.has(type)) this.using.set(type, new Set());
    this.using.get(type)!.add(prim);
    return prim;
  }

  inUse(type: string): number {
    return this.using.get(type)?.size ?? 0;
  }

  pin(prim: Prim): void {
    this.batches[prim.mesh.userData.type as string]?.pin(prim);
  }

  release(prim: Prim): void {
    const batch = this.batches[prim.mesh.userData.type as string];
    if (batch) {
      batch.release(prim);
      return;
    }
    prim.mesh.removeFromParent();
    const type = prim.mesh.userData.type as string;
    if (!this.free.has(type)) this.free.set(type, []);
    const list = this.free.get(type)!;
    if (list.includes(prim)) return;
    list.push(prim);
    this.using.get(type)?.delete(prim);
  }

  fill(type: string, n: number): Prim[] {
    if (!this.free.has(type)) this.free.set(type, []);
    const list = this.free.get(type)!;
    const made: Prim[] = [];
    while (list.length + made.length < n) {
      const prim = this.factories[type]();
      prim.mesh.userData.type = type;
      made.push(prim);
    }
    return made;
  }

  dispose(): void {
    for (const list of this.free.values()) for (const p of list) disposePrim(p);
    this.free.clear();
    for (const b of Object.values(this.batches)) b.dispose();
  }
}

export function disposePrim(p: Prim): void {
  if (!p.mesh.userData.sharedGeometry) p.mesh.geometry.dispose();
  (p.mesh.material as THREE.Material).dispose();
}

const quad = () => new THREE.PlaneGeometry(2, 2);
const sphereGeometry = () => new THREE.SphereGeometry(1, 40, 24);
const sphereGeo = sphereGeometry();

const additive = () =>
  new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });

const shared = (mesh: THREE.Mesh) => {
  mesh.userData.sharedGeometry = true;
  mesh.frustumCulled = false;
  return mesh;
};

function ringMaterial(u: Record<string, N>): THREE.Material {
  const m = additive();
  const q: N = uv().mul(2).sub(1);
  const d: N = q.length();
  const r: N = float(1).sub(pow(float(1).sub(u.k), 3));
  const w: N = u.thick.mul(float(1).sub(u.k.mul(0.6)));
  const x: N = d.sub(r).div(w);
  const band: N = exp(x.mul(x).negate()).add(exp(x.mul(x).mul(-0.08)).mul(0.12).mul(smoothstep(r, r.mul(0.3), d)));
  const ang: N = atan(q.y, q.x);
  const n: N = tnoise(vec2(ang.div(Math.PI * 2).mul(4), d.mul(0.75)).add(seedShift(u.seed))).r;
  const fade: N = pow(float(1).sub(u.k), 1.5);
  const b: N = band.mul(n.mul(0.9).add(0.45)).mul(fade).mul(smoothstep(1, 0.96, d));
  m.colorNode = mix(u.main, u.core, clamp(b.mul(b).mul(0.8), 0, 1)).mul(b).mul(u.bright);
  return m;
}

function decalMaterial(u: Record<string, N>): THREE.Material {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  const q: N = uv().mul(2).sub(1);
  const d: N = q.length();
  const tn: N = tnoise(q.mul(0.55).add(seedShift(u.seed)));
  const n: N = tn.r.mul(2).sub(1);
  const mask: N = smoothstep(1, 0.35, d.add(n.mul(0.35)));
  const erode: N = tnoise(q.mul(0.775).add(seedShift(u.seed.add(7)))).g;
  const alive: N = smoothstep(u.k.mul(1.6).sub(0.35), u.k.mul(1.6).sub(0.2), erode);
  const crack: N = smoothstep(u.crackWidth, 0, abs(tnoise(q.mul(u.crackScale.mul(0.25)).add(seedShift(u.seed.add(3)))).a.mul(2).sub(1))).mul(smoothstep(0.95, 0.1, d));
  const hot: N = crack.mul(u.heat).add(smoothstep(0.55, 0, d).mul(u.heat).mul(u.heat).mul(u.core));
  m.colorNode = mix(u.tint, u.ember.mul(u.glow), clamp(hot, 0, 1)).add(u.ember.mul(hot).mul(u.glow));
  m.opacityNode = mask.mul(alive).mul(u.alpha);
  return m;
}

function arcPrim(): Prim {
  const u = {
    head: uniform(0),
    lag: uniform(0.35),
    fade: uniform(1),
    core: uniform(new THREE.Color()),
    main: uniform(new THREE.Color()),
    accent: uniform(new THREE.Color()),
    bright: uniform(1),
    seed: uniform(0),
    time: uniform(0),
  };
  const m = additive();
  const s: N = uv().x;
  const v: N = uv().y;
  const rel: N = u.head.sub(s).div(u.lag);
  const inside: N = smoothstep(-0.02, 0.01, rel).mul(smoothstep(1, 0.75, rel));
  const trail: N = pow(clamp(float(1).sub(rel), 0, 1), 1.6);
  const n: N = tnoise(vec2(s.mul(2.25).sub(u.time.mul(0.5)), v.mul(0.625)).add(seedShift(u.seed))).r;
  const edgeX: N = v.sub(0.93).div(0.035);
  const edge: N = exp(edgeX.mul(edgeX).negate());
  const body: N = smoothstep(0.05, 0.92, v).pow(2.2).mul(smoothstep(1, 0.95, v));
  const streak: N = smoothstep(0.35, 0.8, n).mul(body);
  const dissolve: N = smoothstep(rel.sub(0.25), rel.add(0.05), n.add(0.25));
  const glow: N = body.mul(0.7).add(streak.mul(1.1)).mul(dissolve);
  const col: N = mix(u.accent, u.main, clamp(glow.mul(1.5), 0, 1)).mul(glow).add(mix(u.main, u.core, trail).mul(edge).mul(1.6).mul(trail.add(0.2)));
  m.colorNode = col.mul(inside).mul(trail.mul(0.8).add(0.2)).mul(u.fade).mul(u.bright);
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
  mesh.frustumCulled = false;
  return { mesh, u };
}

function crescentMaterial(u: Record<string, N>): THREE.Material {
  const m = additive();
  m.depthTest = false;
  const q: N = uv().mul(2).sub(1);
  const x2: N = q.x.mul(q.x);
  const yc: N = u.bend.mul(float(1).sub(x2)).sub(u.bend.mul(0.5));
  const th: N = float(0.1).mul(pow(clamp(float(1).sub(x2), 0, 1), 1.3)).add(0.004);
  const y: N = q.y.sub(yc).div(th);
  const line: N = exp(y.mul(y).negate());
  const halo: N = exp(y.mul(y).mul(-0.06)).mul(0.18).mul(clamp(float(1).sub(x2), 0, 1));
  const fade: N = smoothstep(1, 0.55, u.k);
  m.colorNode = mix(u.main, u.core, line).mul(line.mul(1.4).add(halo)).mul(fade).mul(u.bright);
  return m;
}

function ribbonPrim(): Prim {
  const u = { core: uniform(new THREE.Color()), main: uniform(new THREE.Color()), accent: uniform(new THREE.Color()), bright: uniform(1), time: uniform(0), seed: uniform(0), fade: uniform(1) };
  const m = additive();
  const s: N = uv().x;
  const v: N = uv().y.mul(2).sub(1);
  const n: N = tnoise(vec2(s.mul(1.5).sub(u.time.mul(1.25)), v.mul(0.375)).add(seedShift(u.seed))).r;
  const w: N = float(1).sub(s.mul(0.6));
  const prof: N = exp(v.mul(v).div(w.mul(w).mul(0.25)).negate());
  const core: N = exp(v.mul(v).div(w.mul(w).mul(0.02)).negate()).mul(float(1).sub(s).pow(2));
  const along: N = pow(float(1).sub(s), 1.4).mul(smoothstep(0, 0.04, s).mul(0.5).add(0.5));
  const dens: N = prof.mul(n.mul(1.2).add(0.2)).mul(along);
  m.colorNode = mix(u.accent, u.main, clamp(dens.mul(2), 0, 1)).mul(dens).add(u.core.mul(core).mul(1.2)).mul(u.bright).mul(u.fade);
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
  mesh.frustumCulled = false;
  return { mesh, u };
}

function circleMaterial(u: Record<string, N>): THREE.Material {
  const m = additive();
  const shape: N = patternCircle(uv(), u.turn, u.reveal, u.mode, u as unknown as CirclePattern);
  const q: N = uv().mul(2).sub(1);
  const col: N = mix(u.accent, u.main, clamp(shape, 0, 1)).mul(shape).add(u.core.mul(smoothstep(0.6, 1.4, shape)));
  m.colorNode = col.mul(u.fade).mul(u.bright).mul(smoothstep(1, 0.98, q.length()));
  return m;
}


function sphereMaterial(u: Record<string, N>): THREE.Material {
  const m = additive();
  m.side = THREE.FrontSide;
  const fres: N = float(1).sub(abs(normalView.dot(positionView.normalize().negate()))).max(0);
  const n: N = tnoise(vec2(uv().x.mul(2), uv().y.mul(0.75).add(u.k.mul(0.5))).add(seedShift(u.seed))).r;
  const inner: N = float(1).sub(fres).pow(1.5);
  const dens: N = inner.mul(n.mul(0.8).add(0.5)).add(fres.pow(3).mul(0.3));
  const fade: N = pow(float(1).sub(u.k), 2);
  m.colorNode = mix(mix(u.accent, u.main, clamp(dens.mul(1.4), 0, 1)), u.core, smoothstep(0.6, 1.1, dens).mul(float(1).sub(u.k))).mul(dens).mul(fade).mul(u.bright);
  return m;
}

function boltPrim(): Prim {
  const u = { core: uniform(new THREE.Color()), main: uniform(new THREE.Color()), bright: uniform(1), fade: uniform(1) };
  const m = additive();
  const v: N = uv().y.mul(2).sub(1);
  const along: N = uv().x;
  const core: N = exp(v.mul(v).div(0.012).negate());
  const glow: N = exp(v.mul(v).mul(-3.5)).mul(0.35);
  const taper: N = smoothstep(0, 0.04, along).mul(smoothstep(1, 0.9, along).mul(0.6).add(0.4));
  m.colorNode = mix(u.main, u.core, core).mul(core.mul(2.2).add(glow)).mul(taper).mul(u.bright).mul(u.fade);
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
  mesh.frustumCulled = false;
  return { mesh, u };
}

const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, 0.5, 0);

function beamPrim(): Prim {
  const u = { time: uniform(0), len: uniform(1), core: uniform(new THREE.Color()), main: uniform(new THREE.Color()), accent: uniform(new THREE.Color()), bright: uniform(1), fade: uniform(1), flow: uniform(6), inner: uniform(0) };
  const m = additive();
  m.side = THREE.DoubleSide;
  const y: N = uv().y;
  const edge: N = float(1).sub(abs(normalView.dot(positionView.normalize().negate()))).max(0);
  const center: N = float(1).sub(edge);
  const n: N = tnoise(vec2(uv().x.mul(2), y.mul(u.len).mul(1.4).sub(u.time.mul(u.flow)).mul(0.25))).r;
  const n2: N = tnoise(vec2(uv().x.mul(4), y.mul(u.len).mul(3).sub(u.time.mul(u.flow).mul(1.7)).mul(0.25)).add(0.37)).a;
  const ends: N = smoothstep(0, 0.04, y).mul(smoothstep(1, 0.9, y));
  const dens: N = center.pow(1.4).mul(n.mul(0.9).add(n2.mul(0.5)).add(0.1)).add(edge.pow(4).mul(0.15));
  const hot: N = mix(smoothstep(0.55, 1.1, dens), center.pow(6), u.inner);
  const col: N = mix(mix(u.accent, u.main, clamp(dens.mul(1.6), 0, 1)), u.core, hot);
  m.colorNode = col.mul(dens.add(hot)).mul(ends).mul(u.bright).mul(u.fade);
  return { mesh: shared(new THREE.Mesh(beamGeo, m)), u };
}

const shieldGeo = new THREE.SphereGeometry(1, 64, 32);

function shieldPrim(): Prim {
  const hits = Array.from({ length: 4 }, () => new THREE.Vector4(0, 1, 0, 9));
  const u = { reveal: uniform(1), fade: uniform(1), time: uniform(0), core: uniform(new THREE.Color()), main: uniform(new THREE.Color()), accent: uniform(new THREE.Color()), bright: uniform(1), hits: uniformArray(hits, 'vec4'), hitData: hits as unknown as N };
  const m = additive();
  m.side = THREE.DoubleSide;
  const p: N = positionLocal.normalize();
  const edge: N = float(1).sub(abs(normalView.dot(positionView.normalize().negate()))).max(0);
  const hexEdge = Fn(() => {
    const g: N = vec2(atan(p.z, p.x).mul(7 / Math.PI), p.y.mul(6));
    const r: N = vec2(1, 1.732);
    const h: N = r.mul(0.5);
    const a: N = mod(g, r).sub(h);
    const b: N = mod(g.sub(h), r).sub(h);
    const c: N = select(dot(a, a).lessThan(dot(b, b)), a, b);
    const q: N = abs(c);
    const d: N = max(dot(q, vec2(0.866, 0.5)), q.y);
    return smoothstep(0.4, 0.49, d);
  })();
  let ripple: N = float(0);
  for (let i = 0; i < 4; i++) {
    const h: N = u.hits.element(i);
    const ang: N = dot(p, h.xyz).clamp(-1, 1).acos();
    const x: N = ang.sub(h.w.mul(3)).div(0.18);
    ripple = ripple.add(exp(x.mul(x).negate()).mul(max(float(1).sub(h.w.mul(1.4)), 0)));
  }
  const shimmer: N = mx_noise_float(vec3(p.mul(3)).add(vec3(0, u.time.mul(0.5), 0))).mul(0.5).add(0.5);
  const front: N = smoothstep(u.reveal.mul(2.2).sub(1.1), u.reveal.mul(2.2).sub(1.2), p.y);
  const dens: N = edge.pow(2.5).mul(0.9).add(hexEdge.mul(edge.mul(0.7).add(0.15)).mul(shimmer.mul(0.8).add(0.4))).add(ripple.mul(hexEdge.mul(0.8).add(0.4)));
  const col: N = mix(mix(u.accent, u.main, clamp(dens, 0, 1)), u.core, clamp(ripple.add(edge.pow(6)), 0, 1));
  const band: N = exp(p.y.sub(u.reveal.mul(2.2).sub(1.15)).div(0.04).pow(2).negate()).mul(step1(u.reveal));
  m.colorNode = col.mul(dens.mul(front).add(band.mul(1.5))).mul(u.bright).mul(u.fade);
  return { mesh: shared(new THREE.Mesh(shieldGeo, m)), u };
}

const step1 = (x: N): N => float(1).sub(smoothstep(0.98, 1, x));

function voidPrim(): Prim {
  const u = { k: uniform(0), main: uniform(new THREE.Color()), accent: uniform(new THREE.Color()), bright: uniform(1), time: uniform(0) };
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false });
  const edge: N = float(1).sub(abs(normalView.dot(positionView.normalize().negate()))).max(0);
  const n: N = tnoise(vec2(uv().x.mul(3), uv().y.mul(1.2).sub(u.time.mul(0.25)))).r;
  const rim: N = edge.pow(3).mul(n.mul(1.2).add(0.4));
  m.colorNode = mix(u.accent.mul(0.02), u.main.mul(u.bright), clamp(rim, 0, 1)).add(u.main.mul(rim).mul(u.bright));
  m.opacityNode = mix(float(0.97), float(1), rim).mul(float(1).sub(u.k.pow(3)));
  return { mesh: shared(new THREE.Mesh(sphereGeo, m)), u };
}

export const PRIM_FACTORIES: Record<string, () => Prim> = {
  arc: arcPrim,
  ribbon: ribbonPrim,
  bolt: boltPrim,
  beam: beamPrim,
  shield: shieldPrim,
  void: voidPrim,
  lathe: lathePrim(false),
  latheSmoke: lathePrim(true),
  helix: arcPrim,
};

export function stripGeometry(geometry: THREE.BufferGeometry, points: THREE.Vector3[], width: (i: number) => number, camera: THREE.Camera): void {
  const n = points.length;
  let pos = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  if (!pos || pos.count !== n * 2) {
    pos = new THREE.BufferAttribute(new Float32Array(n * 6), 3);
    pos.setUsage(THREE.DynamicDrawUsage);
    const uvs = new Float32Array(n * 4);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      uvs.set([i / (n - 1), 0, i / (n - 1), 1], i * 4);
      if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    geometry.setAttribute('position', pos);
    geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    geometry.setIndex(idx);
  }
  const eye = camera.getWorldPosition(new THREE.Vector3());
  const t = new THREE.Vector3();
  const side = new THREE.Vector3();
  const arr = pos.array as Float32Array;
  for (let i = 0; i < n; i++) {
    const p = points[i];
    t.subVectors(points[Math.min(i + 1, n - 1)], points[Math.max(i - 1, 0)]);
    side.crossVectors(t, eye.clone().sub(p)).normalize().multiplyScalar(width(i) * 0.5);
    arr.set([p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z], i * 6);
  }
  pos.needsUpdate = true;
}

export function arcGeometry(geometry: THREE.BufferGeometry, pivot: THREE.Vector3, e1: THREE.Vector3, e2: THREE.Vector3, a0: number, a1: number, r0: number, r1: number, segments = 64): void {
  const existing = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const reuse = existing && existing.count === (segments + 1) * 2;
  const pos = reuse ? (existing.array as Float32Array) : new Float32Array((segments + 1) * 2 * 3);
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const idx: number[] = [];
  const p = new THREE.Vector3();
  for (let i = 0; i <= segments; i++) {
    const s = i / segments;
    const a = a0 + (a1 - a0) * s;
    const c = Math.cos(a);
    const sn = Math.sin(a);
    for (let j = 0; j < 2; j++) {
      const r = j ? r1 : r0;
      p.copy(pivot).addScaledVector(e1, c * r).addScaledVector(e2, sn * r);
      const k = i * 2 + j;
      pos.set([p.x, p.y, p.z], k * 3);
      uvs.set([s, j], k * 2);
    }
    if (i < segments) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  if (reuse) {
    existing.needsUpdate = true;
    return;
  }
  const attr = new THREE.BufferAttribute(pos, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attr);
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(idx);
}

export class RibbonTrail {
  readonly points: THREE.Vector3[] = [];
  private pos: THREE.BufferAttribute;

  constructor(
    readonly prim: Prim,
    readonly length = 28,
    public width = 0.3,
  ) {
    const g = prim.mesh.geometry;
    const n = length;
    const existing = g.getAttribute('position') as THREE.BufferAttribute | undefined;
    if (existing && existing.count === n * 2) {
      this.pos = existing;
      return;
    }
    this.pos = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
    this.pos.setUsage(THREE.DynamicDrawUsage);
    const uvs = new Float32Array(n * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      uvs.set([i / (n - 1), 0, i / (n - 1), 1], i * 4);
      if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    g.setAttribute('position', this.pos);
    g.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
    g.setIndex(idx);
  }

  push(p: THREE.Vector3): void {
    this.points.unshift(p.clone());
    if (this.points.length > this.length) this.points.pop();
  }

  update(camera: THREE.Camera): void {
    const pts = this.points;
    if (pts.length === 0) return;
    const arr = this.pos.array as Float32Array;
    const eye = camera.getWorldPosition(new THREE.Vector3());
    const t = new THREE.Vector3();
    const side = new THREE.Vector3();
    const view = new THREE.Vector3();
    for (let i = 0; i < this.length; i++) {
      const p = pts[Math.min(i, pts.length - 1)];
      const a = pts[Math.max(Math.min(i - 1, pts.length - 1), 0)];
      const b = pts[Math.min(i + 1, pts.length - 1)];
      t.subVectors(a, b);
      if (t.lengthSq() < 1e-10) t.set(1, 0, 0);
      view.subVectors(eye, p);
      side.crossVectors(t, view).normalize().multiplyScalar(this.width * 0.5);
      arr.set([p.x - side.x, p.y - side.y, p.z - side.z, p.x + side.x, p.y + side.y, p.z + side.z], i * 6);
    }
    this.pos.needsUpdate = true;
  }
}
