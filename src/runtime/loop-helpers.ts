// psrdnoise3 and permute4 are ported from psrdnoise (https://github.com/stegu/psrdnoise), Copyright (c) 2021 Stefan Gustavson and Ian McEwan, MIT License. Full text: https://rollshade.tsuyatt.com/third-party-licenses.txt
import * as THREE from 'three/webgpu';
import { Fn, PI, TWO_PI, abs, atan, cameraPosition, clamp, cos, dot, float, floor, fract, hash, length, max, min, mix, mod, mul, mx_cell_noise_float, mx_noise_float, mx_worley_noise_float, mx_worley_noise_vec2, normalWorld, normalize, oneMinus, positionLocal, positionWorld, pow, rotate, select, sin, smoothstep, sqrt, step, sub, vec2, vec3, vec4 } from 'three/tsl';
import { MeshSurfaceSampler } from 'three/addons/math/MeshSurfaceSampler.js';

type N = any;

const permute4: N = Fn(([i]: N[]) => {
  const im: N = mod(i, vec4(289));
  return mod(im.mul(34).add(10).mul(im), vec4(289));
}).setLayout({ name: 'permute4', type: 'vec4', inputs: [{ name: 'i', type: 'vec4' }] });

const toSimplex: N = (x: N): N => vec3(x.y.add(x.z), x.x.add(x.z), x.x.add(x.y));
const fromSimplex: N = (i: N): N => vec3(i.y.add(i.z).sub(i.x), i.x.add(i.z).sub(i.y), i.x.add(i.y).sub(i.z)).mul(0.5);
const wrapPeriod: N = (v: N, period: N): N => select(period.greaterThan(0), mod(v, vec4(period)), v);

const psrdnoise3: N = Fn(([x, period, alpha]: N[]) => {
  const uvw: N = toSimplex(x);
  const i0: N = floor(uvw).toVar();
  const f0: N = fract(uvw);
  const gs: N = step(f0.xyx, f0.yzz);
  const ls: N = float(1).sub(gs);
  const g: N = vec3(ls.z, gs.x, gs.y);
  const l: N = vec3(ls.x, ls.y, gs.z);
  const i1: N = i0.add(min(g, l)).toVar();
  const i2: N = i0.add(max(g, l)).toVar();
  const i3: N = i0.add(1).toVar();
  const v0: N = fromSimplex(i0).toVar();
  const v1: N = fromSimplex(i1).toVar();
  const v2: N = fromSimplex(i2).toVar();
  const v3: N = fromSimplex(i3).toVar();
  const x0: N = x.sub(v0).toVar();
  const x1: N = x.sub(v1).toVar();
  const x2: N = x.sub(v2).toVar();
  const x3: N = x.sub(v3).toVar();
  const vx: N = wrapPeriod(vec4(v0.x, v1.x, v2.x, v3.x), period.x).toVar();
  const vy: N = wrapPeriod(vec4(v0.y, v1.y, v2.y, v3.y), period.y).toVar();
  const vz: N = wrapPeriod(vec4(v0.z, v1.z, v2.z, v3.z), period.z).toVar();
  const w0: N = floor(toSimplex(vec3(vx.x, vy.x, vz.x)).add(0.5));
  const w1: N = floor(toSimplex(vec3(vx.y, vy.y, vz.y)).add(0.5));
  const w2: N = floor(toSimplex(vec3(vx.z, vy.z, vz.z)).add(0.5));
  const w3: N = floor(toSimplex(vec3(vx.w, vy.w, vz.w)).add(0.5));
  const h4: N = permute4(permute4(permute4(vec4(w0.z, w1.z, w2.z, w3.z)).add(vec4(w0.y, w1.y, w2.y, w3.y))).add(vec4(w0.x, w1.x, w2.x, w3.x))).toVar();
  const theta: N = h4.mul(3.883222077);
  const sz: N = h4.mul(-0.006920415).add(0.996539792).toVar();
  const psi: N = h4.mul(0.108705628).add(alpha);
  const ct: N = cos(theta).toVar();
  const st: N = sin(theta).toVar();
  const szPrime: N = sqrt(float(1).sub(sz.mul(sz)));
  const sa: N = sin(psi).toVar();
  const ca: N = cos(psi).toVar();
  const gx: N = ca.mul(sz.mul(ct).negate()).add(sa.mul(st)).toVar();
  const gy: N = ca.mul(sz.mul(st).negate()).sub(sa.mul(ct)).toVar();
  const gz: N = ca.mul(szPrime).toVar();
  const w: N = max(vec4(0.5).sub(vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3))), vec4(0)).toVar();
  const gdotx: N = vec4(dot(vec3(gx.x, gy.x, gz.x), x0), dot(vec3(gx.y, gy.y, gz.y), x1), dot(vec3(gx.z, gy.z, gz.z), x2), dot(vec3(gx.w, gy.w, gz.w), x3));
  return dot(w.mul(w).mul(w), gdotx).mul(39.5);
}).setLayout({
  name: 'psrdnoise3',
  type: 'float',
  inputs: [
    { name: 'x', type: 'vec3' },
    { name: 'period', type: 'vec3' },
    { name: 'alpha', type: 'float' },
  ],
});

function loopFbm(p: N, phase: N, octaves: number, cycles: number): N {
  let sum: N = float(0);
  let amplitude: N = 0.5;
  let total: N = 0;
  for (let o: N = 0; o < octaves; o++) {
    const q: N = p.mul(2 ** o);
    sum = sum.add(psrdnoise3(q, vec3(0), phase.mul(TWO_PI).mul(cycles * (o + 1))).mul(amplitude));
    total += amplitude;
    amplitude *= 0.5;
  }
  return sum.div(total).mul(0.5).add(0.5);
}

function flowFbm(p: N, phase: N, direction: N, speed: number, octaves: number): N {
  let sum: N = float(0);
  let amplitude: N = 0.5;
  let total: N = 0;
  for (let o: N = 0; o < octaves; o++) {
    const period: N = 8 * 2 ** o;
    const q: N = p.mul(2 ** o).add(direction.mul(phase.mul(period * speed)));
    sum = sum.add(psrdnoise3(q, abs(direction).mul(period), phase.mul(TWO_PI).mul(o + 1)).mul(amplitude));
    total += amplitude;
    amplitude *= 0.5;
  }
  return sum.div(total).mul(0.5).add(0.5);
}

function loopCells(p: N, phase: N, drift: N): N {
  const offset: N = vec3(0.61, 0.37, 0.23).mul(drift);
  const a: N = mx_worley_noise_float(p.add(offset.mul(phase))).sub(0.5);
  const b: N = mx_worley_noise_float(p.add(offset.mul(phase.sub(1)))).sub(0.5);
  const wa: N = oneMinus(phase);
  return a.mul(wa).add(b.mul(phase)).div(wa.mul(wa).add(phase.mul(phase)).sqrt()).add(0.5);
}

function glint(p: N, phase: N, density: N, size: N, sharpness: N, cycles: number): N {
  const q: N = p.mul(density);
  const cell: N = floor(q);
  const local: N = fract(q).sub(0.5);
  const seed: N = mx_cell_noise_float(cell);
  const facet: N = normalize(vec3(mx_cell_noise_float(cell.add(17)), mx_cell_noise_float(cell.add(31)), mx_cell_noise_float(cell.add(47))).sub(0.5));
  const view: N = normalize(cameraPosition.sub(positionWorld));
  const facing: N = pow(max(dot(normalize(normalWorld.add(facet.mul(0.9))), view), 0), sharpness);
  const spot: N = oneMinus(smoothstep(0, size, length(local)));
  const twinkle: N = pow(sin(phase.mul(cycles).add(seed).mul(TWO_PI)).mul(0.5).add(0.5), 3);
  return spot.mul(facing).mul(twinkle);
}

function flameShape(q: N, noise: N, width: N, tip: N, sway: N, top: N): N {
  const y: N = q.y;
  const x: N = q.x.sub(0.5).add(noise.sub(0.5).mul(sway).mul(y));
  const halfWidth: N = mix(width, mul(width, tip), y.pow(0.8)).mul(0.5);
  const body: N = oneMinus(smoothstep(0.1, 1, abs(x).div(halfWidth)));
  const fuel: N = body.mul(1.3).sub(y.div(top)).add(noise.sub(0.5).mul(1.1));
  return smoothstep(0, 0.55, fuel).mul(smoothstep(0, 0.08, y));
}

function expandingRing(x: N, phase: N, cycles: number, offset: N, width: N): N {
  const t: N = fract(phase.mul(cycles).add(offset));
  return oneMinus(smoothstep(0, width, abs(x.sub(t)))).mul(oneMinus(t)).mul(smoothstep(0, 0.1, t));
}

function twistCylinder(radius: N, top: N, height: N, flare: N, twist: N, spin: number, phase: N, offset: N, base: N): N {
  const y: N = positionLocal.y.add(0.5);
  const angle: N = atan(positionLocal.z, positionLocal.x).add(y.mul(twist)).add(phase.mul(TWO_PI).mul(spin));
  const bend: N = y.sub(0.5);
  const r: N = max(mix(radius, mul(radius, top), y).add(mul(flare, bend).mul(bend)).add(offset), 0);
  const x: N = cos(angle).mul(r);
  const z: N = sin(angle).mul(r);
  return vec3(x, y.mul(height).add(base), z);
}

function puffShape(corner: N, seed: N, age: N) {
  const drift: N = seed.mul(37.1).add(age.mul(1.3));
  const coarse: N = mx_noise_float(vec3(corner.mul(1.5), drift));
  const fine: N = mx_noise_float(vec3(corner.mul(3.7), drift.add(11.3)));
  const body: N = oneMinus(length(corner)).add(coarse.mul(0.45)).add(fine.mul(0.18));
  const lifted: N = corner.add(vec2(0.12, 0.22));
  const above: N = oneMinus(length(lifted)).add(mx_noise_float(vec3(lifted.mul(1.5), drift)).mul(0.45));
  return {
    density: smoothstep(0.04, 0.42, body),
    light: clamp(body.sub(above).mul(1.8).add(corner.y.mul(0.2)).add(0.62), 0.12, 1.3),
  };
}

function boltWalk(x: N, seed: N): N {
  const cell: N = floor(x.add(64));
  return mix(hash(cell.add(seed)), hash(cell.add(1).add(seed)), fract(x)).sub(0.5);
}

function boltLine(along: N, across: N, seed: N, width: N, jag: N): N {
  const offset: N = boltWalk(along.mul(5), seed).mul(0.6).add(boltWalk(along.mul(13), seed.add(101)).mul(0.3)).add(boltWalk(along.mul(31), seed.add(211)).mul(0.14)).mul(jag);
  const gap: N = abs(across.sub(offset));
  return oneMinus(smoothstep(0, width, gap)).add(pow(max(oneMinus(gap.div(width.mul(9))), 0), 3).mul(0.5));
}

function boltField(uv: N, phase: N, count: number, width: N, jag: N, steps: number, mode: string, seed: number): N {
  const c: N = uv.mul(2).sub(1);
  const tick: N = floor(fract(phase).mul(steps));
  let glow: N = float(0);
  for (let i: N = 0; i < count; i++) {
    const s: N = tick.mul(977).add(i * 131 + seed * 7919 + 17);
    if (mode === 'burst') {
      const r: N = length(c.xy);
      const angle: N = atan(c.y, c.x);
      const aim: N = hash(s).add(i).div(count).mul(TWO_PI);
      const turn: N = angle.sub(aim).add(PI);
      const wrapped: N = turn.sub(floor(turn.div(TWO_PI)).mul(TWO_PI)).sub(PI);
      const fade: N = oneMinus(smoothstep(0.55, 1, r)).mul(smoothstep(0, 0.06, r));
      const main: N = boltLine(r, wrapped.mul(r), s, width, jag.mul(r));
      const fork: N = boltLine(r, wrapped.mul(r).sub(r.sub(0.35).mul(hash(s.add(7)).sub(0.5).mul(0.9))), s.add(53), width.mul(0.6), jag.mul(r)).mul(smoothstep(0.3, 0.4, r));
      glow = max(glow, max(main, fork.mul(0.8)).mul(fade));
    } else if (mode === 'beam') {
      const along: N = uv.x;
      const fade: N = smoothstep(0, 0.03, along).mul(oneMinus(smoothstep(0.97, 1, along)));
      glow = max(glow, boltLine(along, c.y, s, width, jag).mul(fade));
    } else {
      const x: N = c.x.add(hash(s.add(3)).sub(0.5).mul(0.6));
      const along: N = c.y.mul(0.5).add(0.5);
      const fade: N = smoothstep(0, 0.05, along).mul(oneMinus(smoothstep(0.92, 1, along)));
      const main: N = boltLine(along, x, s, width, jag);
      const start: N = hash(s.add(9)).mul(0.4).add(0.25);
      const slope: N = hash(s.add(11)).sub(0.5).mul(1.6);
      const branch: N = boltWalk(start.mul(5), s).mul(0.6).mul(jag);
      const fork: N = boltLine(along, x.sub(branch).sub(along.sub(start).mul(slope)), s.add(29), width.mul(0.6), jag.mul(0.6)).mul(smoothstep(start, start.add(0.03), along)).mul(oneMinus(smoothstep(start.add(0.2), start.add(0.4), along)));
      glow = max(glow, max(main, fork).mul(fade));
    }
  }
  return glow;
}

function burstClock(phase: N, index: N, cycles: number, sync: N) {
  const t: N = phase.mul(cycles);
  const k: N = floor(t);
  const a0: N = t.sub(k).add(hash(index).mul(oneMinus(sync))).add(mul(sync, 0.03));
  const carry: N = step(1, a0);
  const c: N = k.add(carry);
  return { age: a0.sub(carry), cycle: c.sub(step(cycles - 0.5, c).mul(cycles)) };
}

function lifeClock(clock: N, life: N) {
  return { age: min(clock.age.div(max(life, 0.01)), 1), cycle: clock.cycle };
}

function circleLine(x: N, center: number, width: number): N {
  return oneMinus(smoothstep(width * 0.5, width * 0.5 + 0.006, abs(x.sub(center))));
}

function circleRunes(angle: N, r: N, inner: number, outer: number, count: number, seed: number): N {
  const u: N = angle.div(TWO_PI).mul(count);
  const cell: N = floor(u);
  const x: N = fract(u).sub(0.5).mul(2);
  const y: N = r.sub((inner + outer) / 2).div((outer - inner) / 2);
  const h: N = hash(cell.add(seed * 131 + 7)).mul(64);
  const bit: N = (k: number) => step(0.5, fract(h.div(2 ** k)));
  const w: N = 0.16;
  const stem: N = oneMinus(smoothstep(w, w + 0.08, abs(x.sub(bit(0).sub(0.5).mul(0.6)))));
  const bar: N = oneMinus(smoothstep(w, w + 0.08, abs(y.sub(bit(1).sub(0.5).mul(0.8))))).mul(bit(2));
  const slash: N = oneMinus(smoothstep(w, w + 0.08, abs(x.sub(y.mul(bit(3).mul(2).sub(1)).mul(0.7))))).mul(bit(4));
  const blob: N = oneMinus(smoothstep(0.18, 0.28, length(vec2(x.sub(bit(5).sub(0.5).mul(0.9)), y.add(0.45))))).mul(bit(1).mul(bit(4)));
  const inside: N = step(abs(x), 0.62).mul(step(abs(y), 0.8));
  return max(max(stem, bar), max(slash, blob)).mul(inside);
}

function circlePolygon(angle: N, r: N, radius: number, sides: number, turn: number, width: number): N {
  const sector: N = (Math.PI * 2) / sides;
  const a: N = angle.add(turn).sub(floor(angle.add(turn).div(sector)).mul(sector)).sub(sector / 2);
  return circleLine(r.mul(cos(a)), radius * Math.cos(Math.PI / sides), width);
}

function magicCircle(uv: N, phase: N, spin: number, sides: number, reveal: boolean, seed: number): N {
  const c: N = uv.mul(2).sub(1);
  const r: N = length(c);
  const base: N = atan(c.y, c.x);
  const outerTurn: N = fract(phase).mul(TWO_PI).mul(spin);
  const outer: N = base.add(outerTurn);
  const inner: N = base.sub(outerTurn.mul(2));
  const wrap: N = (a: N) => a.sub(floor(a.div(TWO_PI)).mul(TWO_PI));
  let lines: N = circleLine(r, 0.955, 0.03).add(circleLine(r, 0.86, 0.012)).add(circleLine(r, 0.835, 0.008));
  lines = lines.add(circleRunes(wrap(outer), r, 0.865, 0.95, 40, seed).mul(0.9));
  const tickAt: N = wrap(outer).div(TWO_PI).mul(120);
  const tickCell: N = fract(tickAt);
  const tickLong: N = step(fract(floor(tickAt).div(5)), 0.1);
  const ticks: N = oneMinus(smoothstep(0.1, 0.22, abs(tickCell.sub(0.5)))).mul(step(r, 0.83)).mul(step(mix(0.795, 0.765, tickLong), r));
  lines = lines.add(ticks.mul(0.8));
  const star: N = 0.64;
  lines = lines.add(circleLine(r, star, 0.014));
  const turn: N = Math.PI / sides;
  lines = lines.add(circlePolygon(inner, r, star, sides, 0, 0.013).mul(step(r, star)));
  lines = lines.add(circlePolygon(inner, r, star, sides, turn, 0.013).mul(step(r, star)));
  const nodes: N = (() => {
    let best: N = float(9);
    for (let k: N = 0; k < sides * 2; k++) {
      const a: N = (k / (sides * 2)) * Math.PI * 2;
      const p: N = vec2(cos(inner.sub(base).negate().add(a)), sin(inner.sub(base).negate().add(a))).mul(star);
      best = min(best, length(c.sub(p)));
    }
    return best;
  })();
  lines = lines.add(circleLine(nodes, 0.075, 0.012));
  lines = lines.add(circleLine(r, 0.34, 0.012)).add(circleRunes(wrap(inner), r, 0.25, 0.33, 18, seed + 5).mul(0.8)).add(circleLine(r, 0.24, 0.008));
  lines = lines.add(circleLine(r, 0.12, 0.012)).add(circleLine(r, 0.06, 0.01));
  const glow: N = pow(max(oneMinus(r), 0), 3).mul(0.25).add(oneMinus(smoothstep(0.9, 1, r)).mul(0.06));
  let shape: N = clamp(lines, 0, 1).mul(step(r, 1)).add(glow);
  if (reveal) {
    const sweep: N = clamp(phase.mul(3), 0, 1);
    const drawn: N = step(wrap(base.add(Math.PI / 2)).div(TWO_PI), sweep.mul(1.02));
    shape = shape.mul(drawn).add(oneMinus(smoothstep(0, 0.05, abs(wrap(base.add(Math.PI / 2)).div(TWO_PI).sub(sweep)))).mul(step(sweep, 0.999)).mul(step(r, 0.97)).mul(step(0.82, r)).mul(1.5));
  }
  return shape;
}

function facetShade(angle: N, height: N, sides: number, seed: number): N {
  const u: N = fract(angle).mul(sides);
  const id: N = floor(u);
  const f: N = fract(u);
  const tone: N = hash(id.add(seed * 17 + 3)).mul(0.6).add(0.4);
  const edge: N = oneMinus(smoothstep(0, 0.07, min(f, oneMinus(f))));
  return tone.mul(mix(0.65, 1.1, height)).add(edge.mul(0.75)).add(smoothstep(0.75, 1, height).mul(0.35));
}

function clusterPlace(p: N, index: N, scatter: N): N {
  const lead: N = step(0.5, index);
  const turn: N = hash(index.add(3)).mul(TWO_PI);
  const reach: N = sqrt(hash(index.add(5))).mul(scatter).mul(lead);
  const shrink: N = mix(1, hash(index.add(7)).mul(0.4).add(0.45), lead);
  const dir: N = vec3(cos(turn), 0, sin(turn));
  const q: N = p.mul(shrink);
  return q.add(dir.mul(q.y.mul(reach.div(max(scatter, 0.001)).mul(0.6)))).add(dir.mul(reach));
}

function particleClock(phase: N, index: N, cycles: number) {
  const t: N = phase.mul(cycles);
  const k: N = floor(t);
  const a0: N = t.sub(k).add(hash(index));
  const carry: N = step(1, a0);
  const c: N = k.add(carry);
  return { age: a0.sub(carry), cycle: c.sub(step(cycles - 0.5, c).mul(cycles)) };
}

function hexCell(uv: N, width: N, fill: N, phase: N, cycles: number): N {
  const size: N = vec2(1, 1.7320508);
  const half: N = size.mul(0.5);
  const a: N = mod(uv, size).sub(half);
  const b: N = mod(uv.sub(half), size).sub(half);
  const g: N = select(dot(a, a).lessThan(dot(b, b)), a, b);
  const edge: N = abs(g);
  const d: N = max(dot(edge, vec2(0.5, 0.8660254)), edge.x);
  const line: N = smoothstep(sub(0.5, width), 0.5, d);
  const seed: N = mx_cell_noise_float(vec3(uv.sub(g).mul(2).add(0.25), 0));
  const blink: N = pow(sin(phase.mul(cycles).add(seed).mul(TWO_PI)).mul(0.5).add(0.5), 6);
  return max(line, blink.mul(fill).mul(oneMinus(d)));
}

function hexGrid(p: N, normal: N, planar: boolean, width: N, fill: N, phase: N, cycles: number): N {
  if (planar) return hexCell(p.xy, width, fill, phase, cycles);
  const w0: N = pow(abs(normal), vec3(4));
  const w: N = w0.div(w0.x.add(w0.y).add(w0.z));
  return hexCell(p.yz, width, fill, phase, cycles).mul(w.x).add(hexCell(p.zx, width, fill, phase, cycles).mul(w.y)).add(hexCell(p.xy, width, fill, phase, cycles).mul(w.z));
}

function starfield(p: N, phase: N, density: N, size: N, twinkle: N, cycles: number): N {
  const q: N = p.mul(density);
  const cell: N = floor(q);
  const seed: N = mx_cell_noise_float(cell);
  const jitter: N = vec3(mx_cell_noise_float(cell.add(13)), mx_cell_noise_float(cell.add(29)), mx_cell_noise_float(cell.add(41))).sub(0.5).mul(0.5);
  const dist: N = length(fract(q).sub(0.5).sub(jitter));
  const star: N = pow(oneMinus(smoothstep(0, size, dist)), 3);
  const blink: N = mix(1, sin(phase.mul(cycles).add(seed.mul(7)).mul(TWO_PI)).mul(0.5).add(0.5), twinkle);
  return star.mul(smoothstep(0.25, 1, seed)).mul(blink);
}

function caustics(p: N, phase: N, sharpness: N, cycles: number): N {
  const angle: N = phase.mul(TWO_PI).mul(cycles);
  const warp: N = vec3(psrdnoise3(p.mul(0.5).add(vec3(3.1, 7.7, 1.3)), vec3(0), angle), psrdnoise3(p.mul(0.5).add(vec3(8.2, 2.4, 5.9)), vec3(0), angle), 0).mul(0.6);
  const a: N = oneMinus(abs(psrdnoise3(p.add(warp), vec3(0), angle)));
  const b: N = oneMinus(abs(psrdnoise3(p.mul(1.9).sub(warp), vec3(0), angle.negate())));
  return clamp(pow(a, sharpness).add(pow(b, sharpness).mul(0.7)), 0, 1);
}

function loopCracks(p: N, phase: N, drift: N, width: N): N {
  const offset: N = vec3(0.61, 0.37, 0.23).mul(drift);
  const fa: N = mx_worley_noise_vec2(p.add(offset.mul(phase)));
  const fb: N = mx_worley_noise_vec2(p.add(offset.mul(phase.sub(1))));
  const ea: N = oneMinus(smoothstep(0, width, fa.y.sub(fa.x)));
  const eb: N = oneMinus(smoothstep(0, width, fb.y.sub(fb.x)));
  return mix(ea, eb, phase);
}

function warp3(p: N, scale: N, amount: N, angle: N): N {
  const q: N = p.mul(scale);
  const offset: N = vec3(psrdnoise3(q, vec3(0), angle), psrdnoise3(q.add(vec3(5.2, 1.3, 7.1)), vec3(0), angle), psrdnoise3(q.add(vec3(2.8, 9.4, 3.6)), vec3(0), angle));
  return p.add(offset.mul(amount));
}

function swirl(p: N, twist: N, angle: N): N {
  const turned: N = rotate(p.xz, length(p.xz).mul(twist).add(angle));
  return vec3(turned.x, p.y, turned.y);
}

function toonShade(steps: number, softness: N, wrap: N): N {
  const light: N = dot(normalWorld, normalize(vec3(0.45, 0.7, 0.55))).mul(oneMinus(wrap)).add(wrap);
  const x: N = clamp(light, 0, 1).mul(steps);
  return floor(x).add(smoothstep(oneMinus(softness), 1, fract(x))).div(steps);
}

function convertMaterial(source: N): N {
  const base: N = source ?? {};
  const material: N = base.isMeshBasicMaterial ? new THREE.MeshBasicNodeMaterial() : new THREE.MeshStandardNodeMaterial();
  material.name = base.name ?? '';
  if (base.color) material.color.copy(base.color);
  material.map = base.map ?? null;
  material.alphaMap = base.alphaMap ?? null;
  material.alphaTest = base.alphaTest ?? 0;
  material.transparent = !!base.transparent;
  material.opacity = base.opacity ?? 1;
  material.vertexColors = !!base.vertexColors;
  material.side = base.side ?? THREE.FrontSide;
  if (material.isMeshStandardNodeMaterial) {
    material.normalMap = base.normalMap ?? null;
    if (base.normalScale) material.normalScale.copy(base.normalScale);
    material.roughness = base.roughness ?? (base.shininess !== undefined ? Math.sqrt(2 / (base.shininess + 2)) : 0.8);
    material.metalness = base.metalness ?? 0;
    material.roughnessMap = base.roughnessMap ?? null;
    material.metalnessMap = base.metalnessMap ?? null;
    material.aoMap = base.aoMap ?? null;
  }
  return material;
}

function overlay(mesh: N, material: N): N {
  const copy: N = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, material) : new THREE.Mesh(mesh.geometry, material);
  if (mesh.isSkinnedMesh) {
    copy.bindMode = mesh.bindMode;
    copy.bind(mesh.skeleton, mesh.bindMatrix);
  }
  if (mesh.morphTargetInfluences) {
    copy.morphTargetInfluences = mesh.morphTargetInfluences;
    copy.morphTargetDictionary = mesh.morphTargetDictionary;
  }
  copy.frustumCulled = false;
  mesh.add(copy);
  return copy;
}

function surfacePoints(meshes: N[], count: number, origin: N, scale: number): N {
  const data: N = new Float32Array(count * 8);
  let state: N = 0x9e3779b9;
  const random: N = () => (state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296;
  const usable: N = meshes.filter((mesh: N) => mesh.geometry.getAttribute('position'));
  const samplers: N = usable.map((mesh: N) => (new MeshSurfaceSampler(mesh) as N).setRandomGenerator(random).build());
  const areas: N = samplers.map((sampler: N, i: number) => sampler.distribution[sampler.distribution.length - 1] * usable[i].matrixWorld.getMaxScaleOnAxis() ** 2);
  const total: N = areas.reduce((sum: number, area: number) => sum + area, 0);
  const position: N = new THREE.Vector3();
  const normal: N = new THREE.Vector3();
  const normalMatrix: N = new THREE.Matrix3();
  for (let i: N = 0; i < count && total > 0; i++) {
    let pick: N = random() * total;
    let k: N = 0;
    while (k < areas.length - 1 && pick > areas[k]) pick -= areas[k++];
    samplers[k].sample(position, normal);
    position.applyMatrix4(usable[k].matrixWorld).sub(origin).divideScalar(scale);
    normal.applyMatrix3(normalMatrix.getNormalMatrix(usable[k].matrixWorld)).normalize();
    data.set([position.x, position.y, position.z, 1], i * 4);
    data.set([normal.x, normal.y, normal.z, 0], (count + i) * 4);
  }
  const texture: N = new THREE.DataTexture(data, count, 2, THREE.RGBAFormat, THREE.FloatType);
  texture.needsUpdate = true;
  return texture;
}

export const helpers = { permute4, toSimplex, fromSimplex, wrapPeriod, psrdnoise3, loopFbm, flowFbm, loopCells, glint, flameShape, expandingRing, twistCylinder, puffShape, boltWalk, boltLine, boltField, burstClock, lifeClock, circleLine, circleRunes, circlePolygon, magicCircle, facetShade, clusterPlace, particleClock, hexCell, hexGrid, starfield, caustics, loopCracks, warp3, swirl, toonShade, convertMaterial, overlay, surfacePoints };
