import * as THREE from 'three/webgpu';
import { NOISE_PERIOD, noiseTexture } from './noise';
import { hotWhite, particleAmount } from './look';
import {
  Fn,
  abs,
  cameraProjectionMatrix,
  cameraViewMatrix,
  clamp,
  cos,
  exp,
  float,
  fract,
  instancedDynamicBufferAttribute,
  length,
  max,
  mix,
  floor,
  texture,
  positionGeometry,
  select,
  sin,
  smoothstep,
  uniform,
  step,
  uv,
  varying,
  vec2,
  vec3,
  vec4,
  min,
} from 'three/tsl';

type N = any;

export type ParticleKind = 'glow' | 'spark' | 'star' | 'flare' | 'flame' | 'smoke' | 'mote' | 'shard' | 'bubble' | 'glyph' | 'mist' | 'haze';

export type Range = number | [number, number] | (() => number);

export interface EmitOptions {
  p?: THREE.Vector3 | (() => THREE.Vector3);
  jitter?: number;
  dir?: THREE.Vector3;
  spread?: number;
  speed?: Range;
  v?: () => THREE.Vector3;
  life?: Range;
  size?: Range;
  grow?: Range;
  gravity?: number;
  drag?: Range;
  colors?: THREE.Color[];
  bright?: Range;
  fadeIn?: number;
  fadePow?: number;
  stretch?: number;
  flicker?: number;
  bounce?: number;
  turb?: number;
  swirl?: number;
  attract?: number;
  center?: THREE.Vector3;
  spin?: Range;
  delay?: Range;
  floor?: number;
  curl?: number;
  curlScale?: number;
  variant?: number;
  orbit?: Orbit;
  hook?: Hook;
  dissolve?: number;
  sizeCurve?: Curve;
  alphaCurve?: Curve;
}

export type Curve = 'linear' | 'burst' | 'pop' | 'late' | 'bell' | 'hold' | 'flash';
const CURVES: Curve[] = ['linear', 'burst', 'pop', 'late', 'bell', 'hold', 'flash'];

function curve(id: number, t: number): number {
  switch (id) {
    case 1:
      return 1 - Math.pow(2, -10 * t);
    case 2:
      return t < 0.15 ? 1.25 * (1 - Math.pow(1 - t / 0.15, 3)) : 1.25 - 0.25 * Math.min((t - 0.15) / 0.2, 1);
    case 3:
      return t * t * t;
    case 4:
      return Math.sin(Math.PI * Math.min(t, 1));
    case 5:
      return t < 0.7 ? 1 : 1 - Math.pow((t - 0.7) / 0.3, 2);
    case 6:
      return Math.exp(-t * 7);
    default:
      return t;
  }
}

export type FieldKind = 'vortex' | 'attract' | 'wind' | 'drag';

export interface Field {
  kind: FieldKind;
  power: number;
  at?: THREE.Vector3 | number;
  axis?: THREE.Vector3;
  shape?: 'sphere' | 'tube';
  min?: number;
  max?: number;
  falloff?: number;
}

export interface Hook {
  fields?: Field[];
  seek?: { target: THREE.Vector3 | number | (() => THREE.Vector3); speed: number; steer: number; arrive?: number };
  onDie?: (p: THREE.Vector3, v: THREE.Vector3) => void;
  onFloor?: (p: THREE.Vector3, v: THREE.Vector3) => void;
  floorKill?: boolean;
}

const HOOKS: (Hook | null)[] = [];
const hookRefs = new Map<Hook, number>();

function hookSlot(h: Hook): number {
  let slot = HOOKS.indexOf(h);
  if (slot < 0) {
    slot = HOOKS.indexOf(null);
    if (slot < 0) slot = HOOKS.push(null) - 1;
    HOOKS[slot] = h;
  }
  hookRefs.set(h, (hookRefs.get(h) ?? 0) + 1);
  return slot + 1;
}

function dropHook(slot: number): void {
  const h = HOOKS[slot];
  if (!h) return;
  const n = (hookRefs.get(h) ?? 1) - 1;
  if (n > 0) hookRefs.set(h, n);
  else {
    hookRefs.delete(h);
    HOOKS[slot] = null;
  }
}

const events: { fn: (p: THREE.Vector3, v: THREE.Vector3) => void; p: THREE.Vector3; v: THREE.Vector3 }[] = [];

export function flushParticleEvents(): void {
  const list = events.splice(0);
  for (const e of list) e.fn(e.p, e.v);
}

const fieldAt = new THREE.Vector3();
const fieldAxis = new THREE.Vector3();
const UPV = new THREE.Vector3(0, 1, 0);

function applyFields(fields: Field[], x: number, y: number, z: number, vx: number, vy: number, vz: number, dt: number, out: number[]): void {
  out[0] = vx;
  out[1] = vy;
  out[2] = vz;
  for (const fl of fields) {
    const c = typeof fl.at === 'number' ? anchors[fl.at] : fl.at ?? fieldAt.set(0, 0, 0);
    const ax = fl.axis ?? UPV;
    let dx = x - c.x;
    let dy = y - c.y;
    let dz = z - c.z;
    if (fl.shape === 'tube') {
      const along = dx * ax.x + dy * ax.y + dz * ax.z;
      dx -= ax.x * along;
      dy -= ax.y * along;
      dz -= ax.z * along;
    }
    const d = Math.hypot(dx, dy, dz) + 1e-5;
    const min = fl.min ?? 0;
    const max = fl.max ?? Infinity;
    if (d < min || d > max) continue;
    const att = (fl.power * dt) / Math.pow(d - min + 1, fl.falloff ?? 1);
    if (fl.kind === 'vortex') {
      fieldAxis.set(ax.y * dz - ax.z * dy, ax.z * dx - ax.x * dz, ax.x * dy - ax.y * dx).divideScalar(d);
      out[0] += fieldAxis.x * att;
      out[1] += fieldAxis.y * att;
      out[2] += fieldAxis.z * att;
    } else if (fl.kind === 'attract') {
      out[0] -= (dx / d) * att;
      out[1] -= (dy / d) * att;
      out[2] -= (dz / d) * att;
    } else if (fl.kind === 'wind') {
      out[0] += ax.x * att;
      out[1] += ax.y * att;
      out[2] += ax.z * att;
    } else {
      const k = Math.max(1 - att, 0);
      out[0] *= k;
      out[1] *= k;
      out[2] *= k;
    }
  }
}

const fieldOut = [0, 0, 0];
const seekTmp = new THREE.Vector3();

export interface Orbit {
  w: number;
  rise: number;
  r0: number;
  r1: number;
  h: number;
  pull?: number;
  anchor?: number;
}

export const anchors: THREE.Vector3[] = [];
const freeAnchors: number[] = [];

export function claimAnchor(p: THREE.Vector3): number {
  const i = freeAnchors.pop() ?? anchors.length;
  anchors[i] = p.clone();
  return i;
}

export function releaseAnchor(i: number): void {
  freeAnchors.push(i);
}

const ORBITS: (Orbit | null)[] = [];
const orbitRefs = new Map<Orbit, number>();

function dropOrbit(slot: number): void {
  const orb = ORBITS[slot];
  if (!orb) return;
  const n = (orbitRefs.get(orb) ?? 1) - 1;
  if (n > 0) orbitRefs.set(orb, n);
  else {
    orbitRefs.delete(orb);
    ORBITS[slot] = null;
  }
}

export function curlAt(x: number, y: number, z: number, t: number, k: number, out: number[]): void {
  let cx = 0;
  let cy = 0;
  let cz = 0;
  let amp = 1;
  let f = k;
  for (let o = 0; o < 2; o++) {
    const ax = f * x;
    const ay = f * y;
    const az = f * z;
    const s1 = Math.sin(ay + t * 0.7 + 1.3 + o * 5.1);
    const c1 = Math.cos(ay + t * 0.7 + 1.3 + o * 5.1);
    const s2 = Math.sin(0.9 * az + 2.1 + o * 1.7);
    const c2 = Math.cos(0.9 * az + 2.1 + o * 1.7);
    const s3 = Math.sin(az + t * 0.6 + 4.1 + o * 3.3);
    const c3 = Math.cos(az + t * 0.6 + 4.1 + o * 3.3);
    const s4 = Math.sin(1.1 * ax + 0.5 + o * 2.9);
    const c4 = Math.cos(1.1 * ax + 0.5 + o * 2.9);
    const s5 = Math.sin(ax + t * 0.8 + 2.7 + o * 4.4);
    const c5 = Math.cos(ax + t * 0.8 + 2.7 + o * 4.4);
    const s6 = Math.sin(0.8 * ay + 3.3 + o * 0.9);
    const c6 = Math.cos(0.8 * ay + 3.3 + o * 0.9);
    const dzdy = s5 * -s6 * 0.8;
    const dydz = c3 * c4;
    const dxdz = s1 * -s2 * 0.9;
    const dzdx = c5 * c6;
    const dydx = s3 * -s4 * 1.1;
    const dxdy = c1 * c2;
    cx += (dzdy - dydz) * amp;
    cy += (dxdz - dzdx) * amp;
    cz += (dydx - dxdy) * amp;
    amp *= 0.5;
    f *= 2.3;
  }
  out[0] = cx;
  out[1] = cy;
  out[2] = cz;
}

const curlOut = [0, 0, 0];

const FIELDS = 48;

const pick = (r: Range | undefined, fallback: number): number => {
  if (r === undefined) return fallback;
  if (typeof r === 'number') return r;
  if (typeof r === 'function') return r();
  return r[0] + Math.random() * (r[1] - r[0]);
};

const tmp = new THREE.Vector3();
const tmpDir = new THREE.Vector3();

export function randomDir(out = new THREE.Vector3()): THREE.Vector3 {
  const z = Math.random() * 2 - 1;
  const a = Math.random() * Math.PI * 2;
  const r = Math.sqrt(1 - z * z);
  return out.set(r * Math.cos(a), z, r * Math.sin(a));
}

export function coneDir(dir: THREE.Vector3, spread: number, out = new THREE.Vector3()): THREE.Vector3 {
  if (spread >= 1) return randomDir(out);
  randomDir(tmpDir);
  return out.copy(dir).normalize().lerp(tmpDir, spread).normalize();
}

export class ParticleSystem {
  readonly mesh: THREE.Mesh;
  private data: Float32Array;
  private count = 0;
  private a: THREE.InstancedBufferAttribute;
  private b: THREE.InstancedBufferAttribute;
  private c: THREE.InstancedBufferAttribute;
  private d: THREE.InstancedBufferAttribute;
  private geometry: THREE.InstancedBufferGeometry;
  private material: THREE.MeshBasicNodeMaterial;
  private soft: boolean;

  constructor(
    readonly kind: ParticleKind,
    readonly max: number,
  ) {
    this.data = new Float32Array(max * FIELDS);
    this.soft = kind === 'smoke' || kind === 'mist' || kind === 'flame' || kind === 'haze';
    const make = () => {
      const attr = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
      attr.setUsage(THREE.DynamicDrawUsage);
      return attr;
    };
    this.a = make();
    this.b = make();
    this.c = make();
    this.d = make();
    const quad = new THREE.PlaneGeometry(2, 2);
    this.geometry = new THREE.InstancedBufferGeometry();
    this.geometry.index = quad.index;
    this.geometry.setAttribute('position', quad.getAttribute('position'));
    this.geometry.setAttribute('uv', quad.getAttribute('uv'));
    this.geometry.instanceCount = 0;
    this.material = particleMaterial(kind, this.a, this.b, this.c, this.d);
    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = kind === 'smoke' || kind === 'haze' ? 1 : 2;
  }

  emit(n: number, o: EmitOptions): void {
    const scaled = this.kind === 'star' || this.kind === 'flare' || (n === 1 && (this.kind === 'glow' || this.kind === 'mist')) ? n : n * emission.scale * particleAmount.value;
    const total = Math.floor(scaled) + (Math.random() < scaled - Math.floor(scaled) ? 1 : 0);
    for (let k = 0; k < total; k++) {
      let i: number;
      if (this.count < this.max) i = this.count++;
      else {
        i = Math.floor(Math.random() * this.max);
        const old = this.data[i * FIELDS + 43];
        if (old) dropOrbit(old - 1);
        const oldHook = this.data[i * FIELDS + 47];
        if (oldHook) dropHook(oldHook - 1);
      }
      const f = i * FIELDS;
      const d = this.data;
      const p = typeof o.p === 'function' ? o.p() : o.p ?? tmp.set(0, 0, 0);
      const j = o.jitter ?? 0;
      d[f] = p.x + (Math.random() * 2 - 1) * j;
      d[f + 1] = p.y + (Math.random() * 2 - 1) * j;
      d[f + 2] = p.z + (Math.random() * 2 - 1) * j;
      let v: THREE.Vector3;
      if (o.v) v = o.v();
      else {
        v = o.dir ? coneDir(o.dir, o.spread ?? 0.3, tmpDir) : randomDir(tmpDir);
        v.multiplyScalar(pick(o.speed, 1));
      }
      d[f + 3] = v.x;
      d[f + 4] = v.y;
      d[f + 5] = v.z;
      d[f + 6] = -pick(o.delay, 0);
      d[f + 7] = Math.max(pick(o.life, 0.6), 0.01);
      d[f + 8] = pick(o.size, 0.1);
      d[f + 9] = pick(o.grow, 1);
      d[f + 10] = Math.random() * Math.PI * 2;
      d[f + 11] = pick(o.spin, 0);
      d[f + 12] = o.gravity ?? 0;
      d[f + 13] = pick(o.drag, 0);
      const cols = o.colors ?? [new THREE.Color(1, 1, 1)];
      const c0 = cols[0];
      const c1 = cols[Math.min(1, cols.length - 1)];
      const c2 = cols[cols.length - 1];
      d[f + 14] = c0.r;
      d[f + 15] = c0.g;
      d[f + 16] = c0.b;
      d[f + 17] = c1.r;
      d[f + 18] = c1.g;
      d[f + 19] = c1.b;
      d[f + 20] = c2.r;
      d[f + 21] = c2.g;
      d[f + 22] = c2.b;
      d[f + 23] = pick(o.bright, 1);
      d[f + 24] = o.fadeIn ?? 0.05;
      d[f + 25] = o.fadePow ?? 1.5;
      d[f + 26] = o.stretch ?? 0;
      d[f + 27] = o.flicker ?? 0;
      d[f + 28] = o.bounce ?? -1;
      d[f + 29] = o.turb ?? 0;
      d[f + 30] = o.swirl ?? 0;
      d[f + 31] = o.attract ?? 0;
      const c = o.center ?? p;
      d[f + 32] = c.x;
      d[f + 33] = c.y;
      d[f + 34] = c.z;
      d[f + 35] = Math.random();
      d[f + 36] = 0;
      d[f + 37] = 0;
      d[f + 38] = 0;
      d[f + 43] = 0;
      d[f + 44] = Math.min(Math.max(o.dissolve ?? 0, 0), 0.95);
      d[f + 45] = o.sizeCurve ? CURVES.indexOf(o.sizeCurve) : 0;
      d[f + 46] = o.alphaCurve ? CURVES.indexOf(o.alphaCurve) : 0;
      d[f + 47] = o.hook ? hookSlot(o.hook) : 0;
      if (o.orbit) {
        const orb = o.orbit;
        const cx = orb.anchor !== undefined ? anchors[orb.anchor] : c;
        const dx = d[f] - cx.x;
        const dz = d[f + 2] - cx.z;
        d[f + 36] = Math.atan2(dz, dx);
        d[f + 37] = d[f + 1] - cx.y;
        d[f + 38] = Math.hypot(dx, dz);
        let slot = ORBITS.indexOf(orb);
        if (slot < 0) {
          slot = ORBITS.indexOf(null);
          if (slot < 0) slot = ORBITS.push(null) - 1;
          ORBITS[slot] = orb;
          orbitRefs.set(orb, 0);
        }
        orbitRefs.set(orb, (orbitRefs.get(orb) ?? 0) + 1);
        d[f + 43] = slot + 1;
      }
      d[f + 39] = o.floor ?? -1e9;
      d[f + 40] = o.curl ?? 0;
      d[f + 41] = o.curlScale ?? 1.4;
      d[f + 42] = o.variant ?? 0;
    }
  }

  update(dt: number, time: number): void {
    const d = this.data;
    const A = this.a.array as Float32Array;
    const B = this.b.array as Float32Array;
    const C = this.c.array as Float32Array;
    const D = this.d.array as Float32Array;
    let n = this.count;
    let out = 0;
    for (let i = 0; i < n; i++) {
      const f = i * FIELDS;
      d[f + 6] += dt;
      const age = d[f + 6];
      const life = d[f + 7];
      if (age >= life) {
        if (d[f + 43]) dropOrbit(d[f + 43] - 1);
        const hs = d[f + 47];
        if (hs) {
          const h = HOOKS[hs - 1];
          if (h?.onDie) events.push({ fn: h.onDie, p: new THREE.Vector3(d[f], d[f + 1], d[f + 2]), v: new THREE.Vector3(d[f + 3], d[f + 4], d[f + 5]) });
          dropHook(hs - 1);
        }
        n--;
        if (i !== n) d.copyWithin(f, n * FIELDS, n * FIELDS + FIELDS);
        i--;
        continue;
      }
      if (age < 0) continue;
      const x0 = d[f];
      const y0 = d[f + 1];
      const z0 = d[f + 2];
      let vx = d[f + 3];
      let vy = d[f + 4];
      let vz = d[f + 5];
      const drag = Math.exp(-d[f + 13] * dt);
      vx *= drag;
      vy = vy * drag - d[f + 12] * dt;
      vz *= drag;
      const tb = d[f + 29];
      if (tb) {
        const s = d[f + 35] * 17.3;
        vx += Math.sin(time * 3.1 + y0 * 2.3 + s) * tb * dt;
        vy += Math.sin(time * 2.7 + z0 * 2.1 + s * 1.3) * tb * 0.5 * dt;
        vz += Math.cos(time * 2.9 + x0 * 2.2 + s * 0.7) * tb * dt;
      }
      const sw = d[f + 30];
      const at = d[f + 31];
      if (sw || at) {
        const dx = x0 - d[f + 32];
        const dz = z0 - d[f + 34];
        const dy = y0 - d[f + 33];
        const r = Math.hypot(dx, dy, dz) + 1e-4;
        if (sw) {
          vx += -dz * sw * dt;
          vz += dx * sw * dt;
        }
        if (at) {
          vx -= (dx / r) * at * dt;
          vy -= (dy / r) * at * dt;
          vz -= (dz / r) * at * dt;
        }
      }
      const hs = d[f + 47];
      const hook = hs ? HOOKS[hs - 1] : null;
      if (hook) {
        if (hook.fields) {
          applyFields(hook.fields, x0, y0, z0, vx, vy, vz, dt, fieldOut);
          vx = fieldOut[0];
          vy = fieldOut[1];
          vz = fieldOut[2];
        }
        if (hook.seek) {
          const sk = hook.seek;
          const tg = typeof sk.target === 'number' ? anchors[sk.target] : typeof sk.target === 'function' ? sk.target() : sk.target;
          seekTmp.set(tg.x - x0, tg.y - y0, tg.z - z0);
          const dist = seekTmp.length();
          if (dist < (sk.arrive ?? 0.15)) {
            d[f + 6] = life;
            d[f + 3] = vx;
            d[f + 4] = vy;
            d[f + 5] = vz;
            continue;
          }
          seekTmp.multiplyScalar(sk.speed / Math.max(dist, 1e-5));
          const k = Math.min(sk.steer * dt, 1);
          vx += (seekTmp.x - vx) * k;
          vy += (seekTmp.y - vy) * k;
          vz += (seekTmp.z - vz) * k;
        }
      }
      let x = x0 + vx * dt;
      let y = y0 + vy * dt;
      let z = z0 + vz * dt;
      const os = d[f + 43];
      if (os) {
        const orb = ORBITS[os - 1];
        if (orb) {
          const cx = orb.anchor !== undefined ? anchors[orb.anchor] : null;
          const ox = cx ? cx.x : d[f + 32];
          const oy = cx ? cx.y : d[f + 33];
          const oz = cx ? cx.z : d[f + 34];
          let r = d[f + 38];
          const hh = d[f + 37] + (orb.rise * (0.7 + 0.6 * d[f + 35]) + vy) * dt;
          const k = Math.min(Math.max(hh / orb.h, 0), 1);
          const target = (orb.r0 + (orb.r1 - orb.r0) * Math.pow(k, 1.5)) * (0.75 + 0.5 * d[f + 35]) + Math.max(hh - orb.h, 0) * 2.5;
          r += (target - r) * Math.min((orb.pull ?? 3) * dt, 1);
          const th = d[f + 36] + (orb.w * dt * Math.sqrt(Math.max(orb.r1, 0.2) / Math.max(r, 0.2))) / (0.8 + 0.4 * d[f + 35]);
          d[f + 36] = th;
          d[f + 37] = hh;
          d[f + 38] = r;
          x = ox + Math.cos(th) * r;
          y = oy + hh;
          z = oz + Math.sin(th) * r;
        }
      }
      const cu = d[f + 40];
      if (cu) {
        curlAt(x0, y0, z0, time, d[f + 41], curlOut);
        const ramp = Math.min(age * 4, 1) * cu * dt;
        x += curlOut[0] * ramp;
        y += curlOut[1] * ramp;
        z += curlOut[2] * ramp;
      }
      const floor = d[f + 39];
      if (this.soft && floor > -1e8) {
        const lift = floor + d[f + 8] * (1 + (d[f + 9] - 1) * Math.min(age / life, 1)) * 0.8;
        if (y < lift) y = lift;
      }
      if (hook && (hook.onFloor || hook.floorKill) && y < floor && y0 >= floor) {
        if (hook.onFloor) events.push({ fn: hook.onFloor, p: new THREE.Vector3(x, floor, z), v: new THREE.Vector3(vx, vy, vz) });
        if (hook.floorKill) {
          d[f + 6] = life;
          y = floor;
        }
      }
      if (d[f + 28] >= 0 && y < floor) {
        y = floor + (floor - y);
        vy = -vy * d[f + 28];
        vx *= 0.7;
        vz *= 0.7;
      }
      d[f] = x;
      d[f + 1] = y;
      d[f + 2] = z;
      d[f + 3] = vx;
      d[f + 4] = vy;
      d[f + 5] = vz;
      d[f + 10] += d[f + 11] * dt;
      const t = age / life;
      const fin = d[f + 24];
      const ac = d[f + 46];
      let alpha = (fin > 0 ? Math.min(age / fin, 1) : 1) * (ac ? curve(ac, t) : Math.pow(1 - t, d[f + 25]));
      const fl = d[f + 27];
      if (fl) alpha *= 1 - fl + fl * (0.5 + 0.5 * Math.sin(time * 40 + d[f + 35] * 60));
      const sc = d[f + 45];
      const size = d[f + 8] * (sc === 4 ? curve(4, t) * d[f + 9] : 1 + (d[f + 9] - 1) * (sc ? curve(sc, t) : t));
      if (floor > -1e8) alpha *= Math.min(Math.max((y - floor) / (size * 0.6) + 0.35, 0), 1);
      const u = t < 0.5 ? t * 2 : (t - 0.5) * 2;
      const o0 = t < 0.5 ? 14 : 17;
      const o1 = t < 0.5 ? 17 : 20;
      const bright = d[f + 23];
      const st = d[f + 26];
      const mv = st && dt > 0 ? st / dt : 0;
      const q = out * 4;
      A[q] = x;
      A[q + 1] = y;
      A[q + 2] = z;
      A[q + 3] = size;
      B[q] = (x - x0) * mv;
      B[q + 1] = (y - y0) * mv;
      B[q + 2] = (z - z0) * mv;
      B[q + 3] = d[f + 10];
      C[q] = (d[f + o0] + (d[f + o1] - d[f + o0]) * u) * bright;
      C[q + 1] = (d[f + o0 + 1] + (d[f + o1 + 1] - d[f + o0 + 1]) * u) * bright;
      C[q + 2] = (d[f + o0 + 2] + (d[f + o1 + 2] - d[f + o0 + 2]) * u) * bright;
      C[q + 3] = alpha;
      D[q] = t;
      D[q + 1] = d[f + 35];
      D[q + 2] = age;
      D[q + 3] = d[f + 42] + d[f + 44];
      out++;
    }
    this.count = n;
    this.geometry.instanceCount = out;
    for (const attr of [this.a, this.b, this.c, this.d]) {
      attr.clearUpdateRanges();
      attr.addUpdateRange(0, Math.max(out, 1) * 4);
      attr.needsUpdate = true;
    }
  }

  primeForCompile(on: boolean): void {
    this.geometry.instanceCount = on ? 1 : 0;
    if (on) {
      const A = this.a.array as Float32Array;
      A.set([0, -1000, 0, 0.001], 0);
      this.a.needsUpdate = true;
    }
  }

  get alive(): number {
    return this.count;
  }

  clear(): void {
    for (let i = 0; i < this.count; i++) {
      if (this.data[i * FIELDS + 43]) dropOrbit(this.data[i * FIELDS + 43] - 1);
      if (this.data[i * FIELDS + 47]) dropHook(this.data[i * FIELDS + 47] - 1);
    }
    this.count = 0;
    this.geometry.instanceCount = 0;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}

export const sizeFloor = uniform(0);
export const emission = { scale: 1 };
export const screenCap = uniform(0.5);
export const tanHalfFov = uniform(Math.tan((45 * Math.PI) / 360));
export const nearFade = uniform(new THREE.Vector2(0.4, 1.4));
export const orthoHalf = uniform(0);

const noiseTex = noiseTexture();

function particleMaterial(kind: ParticleKind, a: THREE.InstancedBufferAttribute, b: THREE.InstancedBufferAttribute, c: THREE.InstancedBufferAttribute, d: THREE.InstancedBufferAttribute) {
  const A: N = instancedDynamicBufferAttribute(a);
  const B: N = instancedDynamicBufferAttribute(b);
  const C: N = instancedDynamicBufferAttribute(c);
  const D: N = instancedDynamicBufferAttribute(d);
  const additive = kind !== 'smoke' && kind !== 'haze';
  const material = new THREE.MeshBasicNodeMaterial({
    transparent: true,
    depthWrite: false,
    blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: THREE.DoubleSide,
  });
  material.vertexNode = Fn(() => {
    const center: N = cameraViewMatrix.mul(vec4(A.xyz, 1));
    const sv: N = cameraViewMatrix.mul(vec4(B.xyz, 0)).xy;
    const len: N = length(sv);
    const axis: N = select(len.greaterThan(1e-5), sv.div(max(len, 1e-5)), vec2(cos(B.w), sin(B.w)));
    const perp: N = vec2(axis.y.negate(), axis.x);
    const corner: N = positionGeometry.xy;
    const depth: N = center.z.negate();
    const cap: N = screenCap.mul(select(orthoHalf.greaterThan(0), orthoHalf, depth.mul(tanHalfFov)));
    const near: N = smoothstep(nearFade.x, nearFade.y, depth);
    const size: N = min(max(A.w, sizeFloor), cap).mul(step(0.001, near));
    const stretch: N = min(len.mul(0.5), cap.mul(2));
    const offset: N = axis.mul(corner.x.mul(size.add(stretch))).add(perp.mul(corner.y.mul(size)));
    return cameraProjectionMatrix.mul(vec4(center.xy.add(offset), center.z, 1));
  })();
  const col: N = varying(C);
  const viewDepth: N = varying(cameraViewMatrix.mul(vec4(A.xyz, 1)).z.negate());
  const info: N = varying(D);
  const q: N = uv().mul(2).sub(1);
  const d2: N = q.dot(q);
  const dist: N = d2.sqrt();
  const peak = (rgb: N): N => mix(rgb, vec3(max(max(rgb.x, rgb.y), rgb.z)), hotWhite);
  const offs: N = vec2(fract(info.y.mul(7.13)), fract(info.y.mul(3.71)));
  const noise = (scale: number, drift: number): N => texture(noiseTex, q.mul(scale / NOISE_PERIOD).add(offs).add(vec2(0.7, 0.45).mul(info.z.mul(drift / NOISE_PERIOD))));
  const evolving = (scale: number, drift: number): N => {
    const a: N = noise(scale, drift);
    const b: N = texture(noiseTex, q.mul((scale * 1.07) / NOISE_PERIOD).add(offs.yx).add(vec2(-0.5, 0.8).mul(info.z.mul(drift / NOISE_PERIOD))).add(0.37));
    return a.r.add(b.g).mul(0.5).sub(0.5).mul(1.4).add(0.5);
  };
  let rgb: N;
  let alpha: N;
  if (kind === 'glow') {
    const g = exp(d2.mul(-4.5)).mul(smoothstep(1, 0.75, dist));
    rgb = mix(col.rgb, peak(col.rgb), exp(d2.mul(-30)).mul(0.6)).mul(g);
    alpha = col.a;
  } else if (kind === 'mote') {
    const g = exp(d2.mul(-9)).add(exp(d2.mul(-60)).mul(1.5)).mul(smoothstep(1, 0.6, dist));
    rgb = mix(col.rgb, peak(col.rgb), exp(d2.mul(-40))).mul(g);
    alpha = col.a;
  } else if (kind === 'spark') {
    const g = smoothstep(1, 0, dist).pow(2.2);
    rgb = mix(col.rgb, peak(col.rgb).mul(1.2), smoothstep(0.55, 0, dist)).mul(g);
    alpha = col.a;
  } else if (kind === 'flare') {
    const ay = abs(q.y);
    const g = exp(ay.mul(-38)).mul(exp(q.x.mul(q.x).mul(-2.5))).add(exp(d2.mul(-25)).mul(0.5)).mul(smoothstep(1, 0.8, abs(q.x)));
    rgb = mix(col.rgb, peak(col.rgb), exp(d2.mul(-80))).mul(g);
    alpha = col.a;
  } else if (kind === 'shard') {
    const h1: N = fract(sin(info.y.mul(91.3)).mul(43758.5453));
    const h2: N = fract(sin(info.y.mul(47.1).add(3.1)).mul(24634.6345));
    const qs: N = vec2(q.x.add(q.y.mul(h2.sub(0.5).mul(0.9))), q.y.mul(mix(0.7, 1.6, h1)));
    const m = max(abs(qs.x).add(abs(qs.y)), abs(qs.x.mul(0.6).add(qs.y.mul(h1.sub(0.5)))).mul(1.6));
    const body = smoothstep(1, 0.86, m);
    const facet = select(qs.x.mul(qs.y.add(h2.sub(0.5))).greaterThan(0), float(1), float(0.4));
    const edge = smoothstep(0.78, 0.97, m).mul(body);
    rgb = mix(col.rgb.mul(facet), peak(col.rgb).mul(1.3), edge.add(exp(d2.mul(-20)).mul(0.5))).mul(body);
    alpha = col.a;
  } else if (kind === 'bubble') {
    const x = dist.sub(0.78).div(0.09);
    const ring = exp(x.mul(x).negate());
    const hl = exp(q.sub(vec2(-0.35, 0.38)).dot(q.sub(vec2(-0.35, 0.38))).mul(-40));
    const g = ring.add(hl.mul(1.5)).add(smoothstep(0.85, 0, dist).mul(0.08));
    rgb = mix(col.rgb, peak(col.rgb), hl).mul(g);
    alpha = col.a;
  } else if (kind === 'glyph') {
    const h = fract(sin(info.y.mul(78.233).add(1.7)).mul(43758.5453)).mul(64);
    const bit = (k: number): N => step(0.5, fract(h.div(2 ** k)));
    const line = (dd: N) => smoothstep(0.1, 0.03, abs(dd));
    const ring = line(dist.sub(0.72)).mul(bit(0).mul(0.8).add(0.2));
    const v = line(q.x.sub(bit(1).sub(0.5).mul(0.5))).mul(step(abs(q.y), 0.55));
    const hbar = line(q.y.sub(bit(2).sub(0.5).mul(0.6))).mul(step(abs(q.x), 0.5)).mul(bit(3));
    const diag = line(q.x.sub(q.y.mul(bit(4).mul(2).sub(1)))).mul(step(dist, 0.55)).mul(bit(5));
    const dot = smoothstep(0.16, 0.08, q.sub(vec2(0, 0.3)).length()).mul(bit(2).mul(bit(5)));
    const rune = max(max(ring, v), max(max(hbar, diag), dot)).add(exp(d2.mul(-5)).mul(0.25));
    const sq = vec2(q.x.mul(1.05), q.y.negate());
    const cran = smoothstep(0.6, 0.55, sq.sub(vec2(0, -0.15)).length());
    const jaw = smoothstep(0.03, 0, max(abs(sq.x).sub(0.3), abs(sq.y.sub(0.38)).sub(0.2)));
    const eyeL = smoothstep(0.19, 0.14, sq.sub(vec2(-0.22, -0.08)).length());
    const eyeR = smoothstep(0.19, 0.14, sq.sub(vec2(0.22, -0.08)).length());
    const nose = smoothstep(0.09, 0.05, sq.sub(vec2(0, 0.17)).length());
    const teeth = step(0.3, sq.y).mul(smoothstep(0.03, 0.0, abs(fract(sq.x.mul(5).add(0.5)).sub(0.5)).sub(0.06)));
    const skullFill = max(cran, jaw).mul(float(1).sub(max(max(eyeL, eyeR), max(nose, teeth))));
    const skull = skullFill.mul(0.55).add(max(eyeL, eyeR).mul(max(cran, jaw)).mul(1.4)).add(exp(d2.mul(-3)).mul(0.15));
    const arm = (a: N, b: N) => smoothstep(0.2, 0.12, abs(a)).mul(smoothstep(0.72, 0.6, abs(b)));
    const plus = max(arm(q.x, q.y), arm(q.y, q.x)).add(exp(d2.mul(-4)).mul(0.25));
    const lq = vec2(q.x.mul(0.7071).sub(q.y.mul(0.7071)), q.x.mul(0.7071).add(q.y.mul(0.7071)));
    const lens = smoothstep(0.05, 0, abs(lq.x).mul(2.2).sub(float(0.62).sub(lq.y.mul(lq.y).mul(0.62))));
    const rib = smoothstep(0.05, 0.015, abs(lq.x)).mul(step(abs(lq.y), 0.7));
    const leaf = lens.mul(0.75).add(rib.mul(0.6)).add(exp(d2.mul(-4)).mul(0.15));
    const vt: N = floor(info.w);
    const g: N = select(vt.greaterThan(2.5), leaf, select(vt.greaterThan(1.5), plus, select(vt.greaterThan(0.5), skull, rune)));
    rgb = mix(col.rgb, peak(col.rgb), 0.35).mul(g);
    alpha = col.a;
  } else if (kind === 'haze') {
    const n: N = noise(1.2, 0.4).a;
    const shape = exp(d2.mul(-2.2)).mul(n.mul(1.1).add(0.15)).mul(smoothstep(1, 0.55, dist));
    rgb = col.rgb.mul(float(0.75).add(q.y.mul(-0.25)));
    alpha = clamp(shape.mul(col.a), 0, 1);
  } else if (kind === 'mist') {
    const n: N = evolving(1.4, 0.6);
    const g = exp(d2.mul(-2.6)).mul(n.mul(1.3).add(0.1)).mul(smoothstep(1, 0.6, dist));
    rgb = col.rgb.mul(g);
    alpha = col.a;
  } else if (kind === 'star') {
    const ax = abs(q.x);
    const ay = abs(q.y);
    const rays = max(exp(ax.mul(-22)).mul(exp(ay.mul(-2.2))), exp(ay.mul(-22)).mul(exp(ax.mul(-2.2))));
    const diag = exp(abs(q.x.add(q.y)).mul(-26)).mul(exp(abs(q.x.sub(q.y)).mul(-3))).add(exp(abs(q.x.sub(q.y)).mul(-26)).mul(exp(abs(q.x.add(q.y)).mul(-3)))).mul(0.35);
    const g = rays.add(diag).add(exp(d2.mul(-18)).mul(0.8)).mul(smoothstep(1, 0.7, dist));
    rgb = mix(col.rgb, peak(col.rgb), exp(d2.mul(-60))).mul(g);
    alpha = col.a;
  } else {
    const t: N = info.x;
    const flame = kind === 'flame';
    const n: N = evolving(flame ? 1.3 : 1.1, flame ? 1.6 : 0.5);
    const body: N = float(1).sub(dist);
    if (kind === 'flame') {
      const dens = clamp(body.mul(1.25).add(n.sub(0.5).mul(1.1)).sub(t.mul(0.75)), 0, 1);
      const shape = smoothstep(0.02, 0.3, dens).mul(smoothstep(1, 0.72, dist));
      const hot = smoothstep(0.25, 0.75, dens).mul(float(1).sub(t));
      rgb = mix(col.rgb.mul(0.55), mix(col.rgb, peak(col.rgb), 0.55).mul(1.6), hot).mul(shape);
      alpha = col.a;
    } else {
      const dens = clamp(body.mul(1.1).add(n.sub(0.5).mul(1.2)).sub(t.mul(0.45)), 0, 1);
      const shape = smoothstep(0.02, 0.45, dens).mul(smoothstep(1, 0.7, dist));
      const light = noise(1.1, 0.5).b.mul(1.3);
      rgb = col.rgb.mul(light);
      alpha = shape.mul(col.a).mul(0.85);
    }
  }
  if (kind !== 'spark' && kind !== 'mote' && kind !== 'star' && kind !== 'flare') {
    const amount: N = fract(info.w);
    const nd: N = texture(noiseTex, q.mul(0.575).add(offs.mul(1.7))).a.mul(0.8).add(dist.mul(0.25));
    const thr: N = amount.mul(smoothstep(0.1, 1, info.x)).mul(1.25);
    const on: N = amount.greaterThan(0.001);
    const alive: N = select(on, smoothstep(thr, thr.add(0.03), nd), float(1));
    const rim: N = select(on, alive.mul(float(1).sub(smoothstep(thr.add(0.02), thr.add(0.1), nd))).mul(step(0.02, thr)), float(0));
    rgb = rgb.mul(alive).add(peak(col.rgb).mul(rim).mul(additive ? 1.6 : 0.8));
    alpha = alpha.mul(max(alive, rim));
  }
  alpha = alpha.mul(smoothstep(nearFade.x, nearFade.y, viewDepth));
  if (additive) {
    material.colorNode = rgb.mul(alpha);
    material.opacityNode = float(1);
  } else {
    material.colorNode = rgb;
    material.opacityNode = alpha;
  }
  (material as N).fog = false;
  return material;
}
