import * as THREE from 'three/webgpu';
import { abs, atan, cameraViewMatrix, clamp, cos, float, floor, fract, fwidth, hash, max, mix, modelWorldMatrix, mx_noise_float, positionView, pow, select, sin, smoothstep, step, uniform, uv, varying, vec3, vec4, vec2 } from 'three/tsl';
import type { Prim } from './prims';
import { seedShift, tnoise } from './noise';

type N = any;

const TAU = Math.PI * 2;

export const latheGeometry = new THREE.PlaneGeometry(1, 1, 72, 40);

export function latheUniforms(): Record<string, N> {
  return {
    mode: uniform(0),
    r0: uniform(1),
    r1: uniform(1),
    curve: uniform(1),
    bulge: uniform(0),
    height: uniform(1),
    a0: uniform(0),
    span: uniform(TAU),
    t0: uniform(-Math.PI / 2),
    t1: uniform(Math.PI / 2),
    twist: uniform(0),
    spin: uniform(0),
    flow: uniform(0),
    tilesA: uniform(3),
    tilesV: uniform(2),
    erode: uniform(0),
    edge: uniform(0.08),
    rim: uniform(0),
    wobble: uniform(0),
    fadeLo: uniform(0.15),
    fadeHi: uniform(0.3),
    streak: uniform(0.5),
    bendX: uniform(0),
    turn: uniform(0),
    erodeTilt: uniform(0),
    bendZ: uniform(0),
    sway: uniform(0),
    swayF: uniform(2),
    core: uniform(new THREE.Color()),
    main: uniform(new THREE.Color()),
    accent: uniform(new THREE.Color()),
    bright: uniform(1),
    fade: uniform(1),
    time: uniform(0),
    seed: uniform(0),
  };
}

function latheShape(u: Record<string, N>) {
  const U: N = uv().x;
  const V: N = clamp(uv().y, 0.0005, 1);
  const a: N = u.a0.add(U.mul(u.span));
  const tube: N = u.mode.lessThan(0.5);
  const rT: N = mix(u.r0, u.r1, pow(V, u.curve)).add(u.bulge.mul(sin(V.mul(Math.PI))));
  const yT: N = V.mul(u.height);
  const th: N = mix(u.t0, u.t1, V);
  const rS: N = cos(th).mul(u.r0);
  const yS: N = sin(th).mul(u.height);
  const r: N = select(tube, rT, rS);
  const y: N = select(tube, yT, yS);
  const wob: N = mx_noise_float(vec3(cos(a).mul(1.7), sin(a).mul(1.7), V.mul(3).sub(u.time.mul(1.4)).add(u.seed))).mul(u.wobble);
  const rr: N = max(r.mul(float(1).add(wob)), 0);
  const drdV: N = u.r1.sub(u.r0).mul(u.curve).mul(pow(V, u.curve.sub(1))).add(u.bulge.mul(Math.PI).mul(cos(V.mul(Math.PI))));
  const nT: N = vec3(cos(a), drdV.div(max(u.height, 0.001)).negate(), sin(a));
  const nS: N = vec3(cos(th).mul(cos(a)), sin(th), cos(th).mul(sin(a)));
  const nLocal: N = (select(tube, nT, nS) as N).normalize();
  const nView: N = varying(cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(nLocal, 0))).xyz.normalize());
  const bend: N = V.mul(V);
  const sw: N = u.sway.mul(V);
  const ph: N = V.mul(2.4).sub(u.time.mul(u.swayF)).add(u.seed);
  const ox: N = u.bendX.mul(bend).add(sw.mul(sin(ph)));
  const oz: N = u.bendZ.mul(bend).add(sw.mul(cos(ph.mul(0.8))));
  return { position: (vec3 as N)(cos(a).mul(rr).add(ox), y, sin(a).mul(rr).add(oz)), nView };
}

function latheFields(u: Record<string, N>, nView: N) {
  const U: N = uv().x;
  const V: N = uv().y;
  const aF: N = u.a0.add(U.mul(u.span)).add(u.twist.mul(V)).add(u.time.mul(u.spin)).add(u.turn);
  const along: N = V.mul(u.tilesV).sub(u.time.mul(u.flow));
  const sa: N = mix(float(1), float(0.1), u.streak);
  const k1: N = max(floor(u.tilesA.mul(0.5).add(0.5)), 1);
  const k2: N = max(floor(u.tilesA.mul(0.3).add(0.5)), 1);
  const a01: N = aF.div(TAU);
  const n1: N = tnoise(vec2(a01.mul(k1), along.mul(sa).mul(0.25)).add(seedShift(u.seed))).r;
  const n2: N = tnoise(vec2(a01.mul(k2), along.mul(0.15)).add(seedShift(u.seed.add(11)))).g;
  const lo: N = mix(float(0.2), float(0.42), u.streak);
  const dens: N = smoothstep(lo, 0.95, n1.mul(0.75).add(n2.mul(0.4)));
  const facing: N = abs(nView.dot(positionView.normalize().negate()));
  const rimF: N = float(1).sub(facing).max(0);
  const rimTerm: N = select(u.rim.greaterThanEqual(0), mix(float(1), rimF.pow(1.5).mul(1.8).add(0.05), u.rim), mix(float(1), facing.pow(1.5), u.rim.negate()));
  const ends: N = smoothstep(0, max(u.fadeLo, 0.001), V).mul(smoothstep(1, float(1).sub(max(u.fadeHi, 0.001)), V));
  const ang: N = select(u.span.lessThan(TAU - 0.01), smoothstep(0, 0.12, U).mul(smoothstep(1, 0.88, U)), float(1));
  const cut: N = n2.add(n1.mul(0.35)).sub(u.erode.mul(1.4)).sub(u.erodeTilt.mul(V.sub(0.5)));
  const eroding: N = u.erode.greaterThan(0.001).or(u.erodeTilt.greaterThan(0.001));
  const alive: N = select(eroding, smoothstep(0, 0.04, cut), float(1));
  const band: N = select(eroding, alive.mul(float(1).sub(smoothstep(0, max(u.edge, 0.001), cut))), float(0));
  return { dens, rimTerm, mask: ends.mul(ang).mul(alive), band };
}

export function lathePrim(smoke = false): () => Prim {
  return () => {
    const u = latheUniforms();
    const m = smoke
      ? new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })
      : new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
    const { position, nView } = latheShape(u);
    m.positionNode = position;
    const { dens, rimTerm, mask, band } = latheFields(u, nView);
    if (smoke) {
      m.colorNode = mix(u.accent, u.main, clamp(dens.mul(1.3), 0, 1)).mul(u.bright).add(u.core.mul(band));
      m.opacityNode = clamp(dens.mul(rimTerm).mul(mask).mul(u.fade).add(band.mul(u.fade)), 0, 1);
    } else {
      const col: N = mix(mix(u.accent, u.main, clamp(dens.mul(1.4), 0, 1)), u.core, smoothstep(0.7, 1.1, dens.mul(rimTerm)));
      m.colorNode = col.mul(dens).mul(rimTerm).mul(mask).add(mix(u.main, u.core, 0.5).mul(band).mul(1.3)).mul(u.bright).mul(u.fade);
    }
    const mesh = new THREE.Mesh(latheGeometry, m);
    mesh.userData.sharedGeometry = true;
    mesh.frustumCulled = false;
    return { mesh, u };
  };
}

export function bandMaterial(u: Record<string, N>): THREE.Material {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  const q: N = uv().mul(2).sub(1);
  const d: N = q.length();
  const ang: N = atan(q.y, q.x).div(TAU);
  const spanN: N = clamp(u.span.div(TAU), 0.001, 1);
  const t: N = fract(ang.sub(u.a0.div(TAU)));
  const tt: N = t.div(spanN);
  const within: N = step(tt, 1);
  const angFade: N = select(spanN.greaterThan(0.999), float(1), smoothstep(0, max(u.fadeS, 0.001), tt).mul(smoothstep(1, float(1).sub(max(u.fadeE, 0.001)), tt)).mul(within));
  const n: N = tnoise(vec2(ang.mul(5), d.add(u.k.mul(0.5))).add(seedShift(u.seed))).r;
  const x: N = d.sub(u.inner).div(max(float(1).sub(u.inner), 0.001)).add(n.sub(0.5).mul(0.35).mul(u.noise).mul(u.hard));
  const soft: N = mix(float(0.45), float(0.03), u.hard);
  const radial: N = smoothstep(0, soft, x).mul(smoothstep(1, float(1).sub(soft), x));
  const xs: N = mix(x, floor(x.mul(3)).div(2), u.hard);
  const col: N = select(xs.lessThan(0.5), mix(u.cIn, u.cMid, clamp(xs.mul(2), 0, 1)), mix(u.cMid, u.cOut, clamp(xs.mul(2).sub(1), 0, 1)));
  const streak: N = mix(float(1), n.mul(1.1).add(0.3), u.noise.mul(float(1).sub(u.hard)));
  const fade: N = pow(float(1).sub(u.k), mix(float(1.5), float(0.6), u.hard));
  const hardCut: N = mix(float(1), step(0.35, radial.mul(fade).mul(angFade)), u.hard);
  m.colorNode = col.mul(radial).mul(streak).mul(angFade).mul(fade).mul(hardCut).mul(u.bright).mul(smoothstep(1, 0.98, d));
  return m;
}

export function linesMaterial(u: Record<string, N>): THREE.Material {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide });
  m.depthTest = false;
  const q: N = uv().mul(2).sub(1);
  const d: N = q.length();
  const ang: N = atan(q.y, q.x).div(TAU).add(0.5);
  const radialMode: N = u.mode.lessThan(0.5);
  const coord: N = select(radialMode, ang.mul(u.count), q.y.mul(0.5).add(0.5).mul(u.count));
  const ci: N = floor(coord);
  const f: N = fract(coord);
  const h1: N = hash(ci.add(u.seed));
  const h2: N = hash(ci.mul(1.71).add(u.seed).add(3.1));
  const h3: N = hash(ci.mul(2.37).add(u.seed).add(7.7));
  const present: N = step(h3, u.density);
  const start: N = mix(u.inner, float(0.92), h1.mul(h1));
  const startK: N = start.add(float(1).sub(start).mul(u.k));
  const wR: N = u.width.mul(h2.mul(0.8).add(0.4)).mul(smoothstep(startK, float(1), d));
  const offset: N = h2.sub(0.5).mul(0.5);
  const dxR: N = abs(f.sub(0.5).sub(offset));
  const reachR: N = mix(start, float(1), u.reach);
  const insideR: N = step(startK, d).mul(step(d, reachR));
  const lineR: N = float(1).sub(smoothstep(wR.mul(0.7), wR, dxR)).mul(insideR).mul(smoothstep(1, 0.93, d));
  const len: N = h2.mul(0.8).add(0.35);
  const x0: N = h1.mul(2.6).sub(1.3).sub(u.k.mul(1.2).mul(h3.add(0.6)));
  const along: N = abs(q.x.sub(x0)).div(len.mul(0.5));
  const taper: N = clamp(float(1).sub(along), 0, 1);
  const wP: N = u.width.mul(0.9).mul(taper).mul(h2.mul(0.8).add(0.4));
  const lineP: N = float(1).sub(smoothstep(wP.mul(0.6), wP, abs(f.sub(0.5)))).mul(step(along, 1)).mul(smoothstep(1, 0.8, abs(q.x)));
  const line: N = select(radialMode, lineR, lineP).mul(present);
  const fade: N = smoothstep(1, 0.8, u.k);
  const col: N = mix(u.main, u.core, select(radialMode, smoothstep(start, float(1), d), taper));
  m.colorNode = col.mul(line).mul(fade).mul(u.bright);
  return m;
}

export function hitmarkMaterial(u: Record<string, N>): THREE.Material {
  const m = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
  m.depthTest = false;
  const q: N = uv().mul(2).sub(1);
  const d: N = q.length();
  const ang: N = atan(q.y, q.x).div(TAU).add(0.5).add(u.seed.mul(0.013));
  const cf: N = ang.mul(u.spikes);
  const ci: N = floor(cf);
  const f: N = fract(cf);
  const dirA: N = ci.add(0.5).div(u.spikes).sub(0.5).sub(u.seed.mul(0.013)).mul(TAU);
  const len: N = mix(float(0.45), float(1), hash(ci.add(u.seed))).mul(float(1).add(u.boost.mul(pow(abs(cos(dirA)), 6))));
  const tri: N = float(1).sub(abs(f.mul(2).sub(1)));
  const R: N = u.inner.mul(len).add(len.mul(float(1).sub(u.inner)).mul(pow(tri, u.sharp)));
  const shape: N = d.div(max(R, 0.001));
  const hole: N = u.hole;
  const aa: N = max(fwidth(shape).mul(1.5), 0.004);
  const inside: N = smoothstep(1, float(1).sub(aa), shape).mul(smoothstep(hole, hole.add(aa), shape));
  const soft: N = float(1).sub(u.hard);
  const zCore: N = mix(step(shape, 0.52), smoothstep(0.7, 0.35, shape), soft);
  const zMid: N = mix(step(shape, 0.8), smoothstep(0.95, 0.6, shape), soft);
  const col: N = mix(u.accent, mix(u.main, u.core, zCore), zMid);
  const fade: N = step(u.k, 0.999);
  m.colorNode = col.mul(u.bright);
  m.opacityNode = inside.mul(fade).mul(u.alpha);
  return m;
}

export interface HelixOptions {
  center: THREE.Vector3;
  axis?: THREE.Vector3;
  r0: number;
  r1: number;
  height: number;
  turns: number;
  phase?: number;
  width: number;
  segments?: number;
}

export function helixGeometry(geometry: THREE.BufferGeometry, o: HelixOptions): void {
  const segments = o.segments ?? 96;
  const existing = geometry.getAttribute('position') as THREE.BufferAttribute | undefined;
  const reuse = existing && existing.count === (segments + 1) * 2;
  const pos = reuse ? (existing.array as Float32Array) : new Float32Array((segments + 1) * 2 * 3);
  const axis = (o.axis ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
  const e1 = new THREE.Vector3(1, 0, 0);
  if (Math.abs(axis.dot(e1)) > 0.9) e1.set(0, 0, 1);
  e1.sub(axis.clone().multiplyScalar(axis.dot(e1))).normalize();
  const e2 = axis.clone().cross(e1).normalize();
  const p = new THREE.Vector3();
  const phase = o.phase ?? 0;
  for (let i = 0; i <= segments; i++) {
    const s = i / segments;
    const a = phase + s * o.turns * TAU;
    const r = o.r0 + (o.r1 - o.r0) * s;
    for (let j = 0; j < 2; j++) {
      const h = s * o.height + (j - 0.5) * o.width;
      p.copy(o.center).addScaledVector(e1, Math.cos(a) * r).addScaledVector(e2, Math.sin(a) * r).addScaledVector(axis, h);
      pos.set([p.x, p.y, p.z], (i * 2 + j) * 3);
    }
  }
  if (reuse) {
    existing.needsUpdate = true;
    return;
  }
  const uvs = new Float32Array((segments + 1) * 2 * 2);
  const idx: number[] = [];
  for (let i = 0; i <= segments; i++) {
    uvs.set([i / segments, 0, i / segments, 1], i * 4);
    if (i < segments) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
  }
  const attr = new THREE.BufferAttribute(pos, 3);
  attr.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('position', attr);
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  geometry.setIndex(idx);
}
