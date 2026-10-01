import * as THREE from 'three/webgpu';
import { float, instanceColor, instanceIndex, mix, positionLocal } from 'three/tsl';

type N = any;

export interface SolidOptions {
  p: THREE.Vector3;
  v?: THREE.Vector3;
  size: THREE.Vector3 | number;
  quat?: THREE.Quaternion;
  spin?: number;
  life: number;
  grow?: number;
  shrink?: number;
  gravity?: number;
  bounce?: number;
  color?: THREE.Color;
  onLand?: (p: THREE.Vector3, speed: number) => void;
  drive?: (p: THREE.Vector3, v: THREE.Vector3, age: number, dt: number) => boolean;
}

interface Solid {
  p: THREE.Vector3;
  v: THREE.Vector3;
  size: THREE.Vector3;
  q: THREE.Quaternion;
  axis: THREE.Vector3;
  spin: number;
  age: number;
  life: number;
  grow: number;
  shrink: number;
  gravity: number;
  bounce: number;
  onLand?: (p: THREE.Vector3, speed: number) => void;
  drive?: (p: THREE.Vector3, v: THREE.Vector3, age: number, dt: number) => boolean;
}

const m4 = new THREE.Matrix4();
const s3 = new THREE.Vector3();
const dq = new THREE.Quaternion();
const outBack = (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);

export class Solids {
  readonly mesh: THREE.InstancedMesh;
  private list: Solid[] = [];
  floorY = 0;

  constructor(
    geometry: THREE.BufferGeometry,
    material: THREE.Material,
    readonly max: number,
  ) {
    this.mesh = new THREE.InstancedMesh(geometry, material, max);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
    this.mesh.instanceColor!.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
  }

  spawn(o: SolidOptions): void {
    if (this.list.length >= this.max) this.list.shift();
    const size = typeof o.size === 'number' ? new THREE.Vector3(o.size, o.size, o.size) : o.size.clone();
    const solid: Solid = {
      p: o.p.clone(),
      v: o.v?.clone() ?? new THREE.Vector3(),
      size,
      q: o.quat?.clone() ?? new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)),
      axis: new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize(),
      spin: o.spin ?? 0,
      age: 0,
      life: o.life,
      grow: o.grow ?? 0,
      shrink: o.shrink ?? 0.25,
      gravity: o.gravity ?? 0,
      bounce: o.bounce ?? 0.3,
      onLand: o.onLand,
      drive: o.drive,
    };
    this.list.push(solid);
    (solid as N).color = o.color?.clone() ?? new THREE.Color(1, 1, 1);
  }

  update(dt: number): void {
    let n = 0;
    this.list = this.list.filter((s) => (s.age += dt) < s.life);
    for (const s of this.list) {
      if (s.drive && !s.drive(s.p, s.v, s.age, dt)) s.drive = undefined;
      if (!s.drive && (s.gravity || s.v.lengthSq() > 0)) {
        s.v.y -= s.gravity * dt;
        s.p.addScaledVector(s.v, dt);
        const bottom = this.floorY + s.size.y * 0.3;
        if (s.gravity && s.p.y < bottom && s.v.y < 0) {
          const speed = -s.v.y;
          s.p.y = bottom;
          s.v.y = speed * s.bounce;
          s.v.x *= 0.6;
          s.v.z *= 0.6;
          s.spin *= 0.6;
          if (speed > 2.5) s.onLand?.(s.p, speed);
          if (speed < 0.8) s.v.set(0, 0, 0);
        }
      }
      if (s.spin) s.q.multiply(dq.setFromAxisAngle(s.axis, s.spin * dt));
      const k = s.age / s.life;
      let scale = 1;
      if (s.grow > 0 && s.age < s.grow) scale = Math.max(outBack(s.age / s.grow), 0.001);
      if (k > 1 - s.shrink) scale *= Math.max((1 - k) / s.shrink, 0.001);
      m4.compose(s.p, s.q, s3.copy(s.size).multiplyScalar(scale));
      this.mesh.setMatrixAt(n, m4);
      this.mesh.setColorAt(n, (s as N).color);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  primeForCompile(on: boolean): void {
    this.mesh.count = on ? 1 : 0;
    if (on) {
      this.mesh.setMatrixAt(0, m4.makeTranslation(0, -1000, 0));
      this.mesh.instanceMatrix.needsUpdate = true;
    }
  }

  clear(): void {
    this.list = [];
    this.mesh.count = 0;
  }

  get size(): number {
    return this.list.length;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function finish(g: THREE.BufferGeometry): THREE.BufferGeometry {
  const flat = g.index ? g.toNonIndexed() : g;
  flat.computeVertexNormals();
  return flat;
}

function column(rings: { y: number; r: number }[], sides: number, tip: THREE.Vector3, r: () => number, jag: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const ringPts = rings.map(({ y, r: rad }, j) => {
    const twist = r() * Math.PI * 2;
    return Array.from({ length: sides }, (_, i) => {
      const a = twist * (j ? 0.15 : 0) + (i / sides) * Math.PI * 2 + (r() - 0.5) * 0.5;
      const rr = rad * (1 - jag * 0.5 + r() * jag);
      return new THREE.Vector3(Math.cos(a) * rr, y + (r() - 0.5) * jag * 0.15, Math.sin(a) * rr);
    });
  });
  const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
  for (let j = 0; j < ringPts.length - 1; j++) {
    const lo = ringPts[j];
    const hi = ringPts[j + 1];
    for (let i = 0; i < sides; i++) {
      const i2 = (i + 1) % sides;
      tri(lo[i], hi[i], lo[i2]);
      tri(lo[i2], hi[i], hi[i2]);
    }
  }
  const top = ringPts[ringPts.length - 1];
  for (let i = 0; i < sides; i++) tri(top[i], tip, top[(i + 1) % sides]);
  const bottom = ringPts[0];
  const c = new THREE.Vector3(0, rings[0].y, 0);
  for (let i = 0; i < sides; i++) tri(bottom[(i + 1) % sides], c, bottom[i]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  return finish(g);
}

export function crystalGeometries(count = 6): THREE.BufferGeometry[] {
  return Array.from({ length: count }, (_, k) => {
    const r = rand(1000 + k * 77);
    const sides = 4 + Math.floor(r() * 4);
    const body = 0.45 + r() * 0.35;
    const w = 0.42 + r() * 0.16;
    const rings = [
      { y: 0, r: w * (0.85 + r() * 0.2) },
      { y: body * (0.5 + r() * 0.2), r: w * (0.95 + r() * 0.15) },
      { y: body, r: w * (0.8 + r() * 0.15) },
    ];
    const tip = new THREE.Vector3((r() - 0.5) * 0.25, 1, (r() - 0.5) * 0.25);
    return column(rings, sides, tip, r, 0.25);
  });
}

export function rockSpikeGeometries(count = 6): THREE.BufferGeometry[] {
  return Array.from({ length: count }, (_, k) => {
    const r = rand(2000 + k * 131);
    const sides = 5 + Math.floor(r() * 3);
    const rings = [
      { y: -0.1, r: 0.62 + r() * 0.1 },
      { y: 0.25 + r() * 0.1, r: 0.46 + r() * 0.1 },
      { y: 0.55 + r() * 0.1, r: 0.3 + r() * 0.08 },
      { y: 0.8 + r() * 0.05, r: 0.14 + r() * 0.06 },
    ];
    const tip = new THREE.Vector3((r() - 0.5) * 0.3, 1, (r() - 0.5) * 0.3);
    return column(rings, sides, tip, r, 0.4);
  });
}

export function rockGeometries(count = 6): THREE.BufferGeometry[] {
  return Array.from({ length: count }, (_, k) => {
    const r = rand(3000 + k * 53);
    const g = k % 2 ? new THREE.IcosahedronGeometry(1, 0) : new THREE.DodecahedronGeometry(1, 0);
    const pos = g.getAttribute('position');
    const sx = 0.75 + r() * 0.5;
    const sy = 0.5 + r() * 0.45;
    const sz = 0.75 + r() * 0.5;
    const seen = new Map<string, number>();
    for (let i = 0; i < pos.count; i++) {
      const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
      if (!seen.has(key)) seen.set(key, 0.7 + r() * 0.55);
      const f = seen.get(key)!;
      pos.setXYZ(i, pos.getX(i) * f * sx, pos.getY(i) * f * sy, pos.getZ(i) * f * sz);
    }
    return finish(g);
  });
}

export class SolidSet {
  readonly sets: Solids[];
  mask: () => boolean = () => false;

  constructor(geometries: THREE.BufferGeometry[], material: () => THREE.Material, max: number) {
    const per = Math.ceil(max / geometries.length);
    this.sets = geometries.map((g) => new Solids(g, material(), per));
  }

  set floorY(y: number) {
    for (const s of this.sets) s.floorY = y;
  }

  spawn(o: SolidOptions, variant?: number): void {
    if (this.mask()) return;
    const i = variant ?? Math.floor(Math.random() * this.sets.length);
    this.sets[i % this.sets.length].spawn(o);
  }

  update(dt: number): void {
    for (const s of this.sets) s.update(dt);
  }

  clear(): void {
    for (const s of this.sets) s.clear();
  }

  primeForCompile(on: boolean): void {
    for (const s of this.sets) s.primeForCompile(on);
  }

  get size(): number {
    return this.sets.reduce((n, s) => n + s.size, 0);
  }

  get meshes(): THREE.InstancedMesh[] {
    return this.sets.map((s) => s.mesh);
  }

  dispose(): void {
    for (const s of this.sets) s.dispose();
  }
}

export function rockMaterial(): THREE.Material {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.9, metalness: 0, flatShading: true });
  const shade: N = float(instanceIndex).mul(0.137).fract().mul(0.3).add(0.85);
  m.colorNode = mix(float(0.7), float(1), positionLocal.y.mul(0.5).add(0.5)).mul(shade);
  return m;
}

export function crystalMaterial(): THREE.Material {
  const m = new THREE.MeshStandardNodeMaterial({ roughness: 0.15, metalness: 0.1, flatShading: true, transparent: true, opacity: 0.92 });
  m.colorNode = float(0.55);
  m.emissiveNode = positionLocal.y.mul(0.9).add(0.15).mul(0.9).mul(instanceColor);
  return m;
}
