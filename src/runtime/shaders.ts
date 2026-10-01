import { abs, atan, clamp, cos, float, floor, fract, hash, length, max, min, mix, pow, sin, smoothstep, step, vec2 } from 'three/tsl';

type N = any;

const TWO_PI = Math.PI * 2;
const oneMinus = (x: N): N => float(1).sub(x);
const wrap = (a: N): N => a.sub(floor(a.div(TWO_PI)).mul(TWO_PI));

function circleLine(x: N, center: number, width: number): N {
  return oneMinus(smoothstep(width * 0.5, width * 0.5 + 0.006, abs(x.sub(center))));
}

function circleRunes(angle: N, r: N, inner: number, outer: number, count: number, seed: number): N {
  const u = angle.div(TWO_PI).mul(count);
  const cell = floor(u);
  const x = fract(u).sub(0.5).mul(2);
  const y = r.sub((inner + outer) / 2).div((outer - inner) / 2);
  const h = hash(cell.add(seed * 131 + 7)).mul(64);
  const bit = (k: number) => step(0.5, fract(h.div(2 ** k)));
  const w = 0.16;
  const stem = oneMinus(smoothstep(w, w + 0.08, abs(x.sub(bit(0).sub(0.5).mul(0.6)))));
  const bar = oneMinus(smoothstep(w, w + 0.08, abs(y.sub(bit(1).sub(0.5).mul(0.8))))).mul(bit(2));
  const slant = oneMinus(smoothstep(w, w + 0.08, abs(x.sub(y.mul(bit(3).mul(2).sub(1)).mul(0.7))))).mul(bit(4));
  const blob = oneMinus(smoothstep(0.18, 0.28, length(vec2(x.sub(bit(5).sub(0.5).mul(0.9)), y.add(0.45))))).mul(bit(1).mul(bit(4)));
  const inside = step(abs(x), 0.62).mul(step(abs(y), 0.8));
  return max(max(stem, bar), max(slant, blob)).mul(inside);
}

function circlePolygon(angle: N, r: N, radius: number, sides: number, turn: number, width: number): N {
  const sector = TWO_PI / sides;
  const a = angle.add(turn).sub(floor(angle.add(turn).div(sector)).mul(sector)).sub(sector / 2);
  return circleLine(r.mul(cos(a)), radius * Math.cos(Math.PI / sides), width);
}

export function magicCircle(uv: N, turn: N, reveal: N, sides: number, seed: number): N {
  const c = uv.mul(2).sub(1);
  const r = length(c);
  const base = atan(c.y, c.x);
  const outer = base.add(turn);
  const inner = base.sub(turn.mul(2));
  let lines: N = circleLine(r, 0.955, 0.03).add(circleLine(r, 0.86, 0.012)).add(circleLine(r, 0.835, 0.008));
  lines = lines.add(circleRunes(wrap(outer), r, 0.865, 0.95, 40, seed).mul(0.9));
  const tickAt = wrap(outer).div(TWO_PI).mul(120);
  const tickLong = step(fract(floor(tickAt).div(5)), 0.1);
  const ticks = oneMinus(smoothstep(0.1, 0.22, abs(fract(tickAt).sub(0.5)))).mul(step(r, 0.83)).mul(step(mix(0.795, 0.765, tickLong), r));
  lines = lines.add(ticks.mul(0.8));
  const star = 0.64;
  lines = lines.add(circleLine(r, star, 0.014));
  lines = lines.add(circlePolygon(inner, r, star, sides, 0, 0.013).mul(step(r, star)));
  lines = lines.add(circlePolygon(inner, r, star, sides, Math.PI / sides, 0.013).mul(step(r, star)));
  let best: N = float(9);
  for (let k = 0; k < sides * 2; k++) {
    const a = (k / (sides * 2)) * TWO_PI;
    const p = vec2(cos(inner.sub(base).negate().add(a)), sin(inner.sub(base).negate().add(a))).mul(star);
    best = min(best, length(c.sub(p)));
  }
  lines = lines.add(circleLine(best, 0.075, 0.012));
  lines = lines.add(circleLine(r, 0.34, 0.012)).add(circleRunes(wrap(inner), r, 0.25, 0.33, 18, seed + 5).mul(0.8)).add(circleLine(r, 0.24, 0.008));
  lines = lines.add(circleLine(r, 0.12, 0.012)).add(circleLine(r, 0.06, 0.01));
  const glow = pow(max(oneMinus(r), 0), 3).mul(0.25).add(oneMinus(smoothstep(0.9, 1, r)).mul(0.06));
  const shape: N = clamp(lines, 0, 1).mul(step(r, 1)).add(glow);
  const at = wrap(base.add(Math.PI / 2)).div(TWO_PI);
  const drawn = step(at, reveal.mul(1.02));
  const pen = oneMinus(smoothstep(0, 0.05, abs(at.sub(reveal)))).mul(step(reveal, 0.999)).mul(step(r, 0.97)).mul(step(0.82, r)).mul(1.5);
  return shape.mul(drawn).add(pen);
}

export interface CirclePattern {
  sidesA: N;
  skipA: N;
  sidesB: N;
  skipB: N;
  rotB: N;
  spokes: N;
  branch: N;
  spiral: N;
  waves: N;
  dots: N;
  petals: N;
  runes: N;
  ticks: N;
}

const MAXV = 9;

function segDist(p: N, a: N, b: N): N {
  const pa = p.sub(a);
  const ba = b.sub(a);
  const h = clamp(pa.dot(ba).div(max(ba.dot(ba), 1e-5)), 0, 1);
  return length(pa.sub(ba.mul(h)));
}

function starPolygon(c: N, turn: N, sides: N, skip: N, radius: number, width: number): N {
  let best: N = float(9);
  const step2 = float(TWO_PI).div(max(sides, 1));
  for (let i = 0; i < MAXV; i++) {
    const a0 = turn.add(step2.mul(i));
    const a1 = turn.add(step2.mul(skip.add(i)));
    const d = segDist(c, vec2(cos(a0), sin(a0)).mul(radius), vec2(cos(a1), sin(a1)).mul(radius));
    best = min(best, d.add(step(sides.sub(0.5), float(i)).mul(9)));
  }
  return oneMinus(smoothstep(width * 0.5, width * 0.5 + 0.006, best)).mul(step(0.5, sides));
}

export function patternCircle(uv: N, turn: N, reveal: N, mode: N, P: CirclePattern): N {
  const c = uv.mul(2).sub(1);
  const r = length(c);
  const base = atan(c.y, c.x);
  const outer = base.add(turn);
  const inner = base.sub(turn.mul(2));
  let lines: N = circleLine(r, 0.955, 0.03).add(circleLine(r, 0.86, 0.012)).add(circleLine(r, 0.835, 0.008));
  const runeOuter = step(0.5, fract(P.runes.div(2)));
  const runeInner = step(1.5, P.runes);
  lines = lines.add(circleRunes(wrap(outer), r, 0.865, 0.95, 40, 3).mul(0.9).mul(runeOuter));
  const tickAt = wrap(outer).div(TWO_PI).mul(120);
  const tickLong = step(fract(floor(tickAt).div(5)), 0.1);
  const ticks = oneMinus(smoothstep(0.1, 0.22, abs(fract(tickAt).sub(0.5)))).mul(step(r, 0.83)).mul(step(mix(0.795, 0.765, tickLong), r));
  lines = lines.add(ticks.mul(0.8).mul(P.ticks));
  const star = 0.64;
  lines = lines.add(circleLine(r, star, 0.014));
  const inside = step(r, star + 0.01);
  lines = lines.add(starPolygon(c, turn.negate().mul(2).add(Math.PI / 2), P.sidesA, P.skipA, star, 0.014).mul(inside));
  lines = lines.add(starPolygon(c, turn.negate().mul(2).add(P.rotB).add(Math.PI / 2), P.sidesB, P.skipB, star, 0.012).mul(inside));
  const sp = max(P.spokes, 1);
  const cell = fract(outer.div(TWO_PI).mul(sp).add(0.5)).sub(0.5);
  const arc = abs(cell).mul(TWO_PI).div(sp).mul(r);
  const spokeBand = step(0.36, r).mul(step(r, 0.62));
  lines = lines.add(oneMinus(smoothstep(0.006, 0.012, arc)).mul(spokeBand).mul(step(0.5, P.spokes)));
  const bar = (rb: number, len: number) => oneMinus(smoothstep(0.005, 0.011, abs(r.sub(rb)))).mul(step(arc, len));
  lines = lines.add(bar(0.47, 0.05).add(bar(0.55, 0.035)).mul(step(0.5, P.spokes)).mul(P.branch));
  const sa = max(P.spiral, 1);
  const spiralCell = fract(inner.sub(r.add(0.02).log().mul(2.4)).div(TWO_PI).mul(sa)).sub(0.5);
  const spiralLine = oneMinus(smoothstep(0.02, 0.045, abs(spiralCell))).mul(step(0.13, r)).mul(step(r, 0.62));
  lines = lines.add(spiralLine.mul(step(0.5, P.spiral)).mul(0.9));
  const wv = max(P.waves, 1);
  const wave = (rad: number, amp: number) => circleLine(r.sub(sin(outer.mul(wv)).mul(amp)), rad, 0.01);
  lines = lines.add(wave(0.74, 0.025).add(wave(0.45, 0.02)).mul(step(0.5, P.waves)));
  const dn = max(P.dots, 1);
  const da = floor(inner.div(TWO_PI).mul(dn).add(0.5)).mul(TWO_PI).div(dn);
  const dp = vec2(cos(da.sub(inner.sub(base))), sin(da.sub(inner.sub(base)))).mul(star);
  const dd = length(c.sub(dp));
  lines = lines.add(circleLine(dd, 0.06, 0.012).add(oneMinus(smoothstep(0.02, 0.028, dd)).mul(0.8)).mul(step(0.5, P.dots)));
  const pet = r.sub(mix(0.2, 0.52, abs(cos(inner.mul(max(P.petals, 1)).mul(0.5)))));
  lines = lines.add(oneMinus(smoothstep(0.006, 0.013, abs(pet))).mul(step(r, 0.53)).mul(step(0.5, P.petals)));
  lines = lines.add(circleLine(r, 0.34, 0.012)).add(circleRunes(wrap(inner), r, 0.25, 0.33, 18, 8).mul(0.8).mul(runeInner)).add(circleLine(r, 0.24, 0.008));
  lines = lines.add(circleLine(r, 0.12, 0.012)).add(circleLine(r, 0.06, 0.01));
  const glow = pow(max(oneMinus(r), 0), 3).mul(0.25).add(oneMinus(smoothstep(0.9, 1, r)).mul(0.06));
  const shape: N = clamp(lines, 0, 1).mul(step(r, 1)).add(glow);
  const at = wrap(base.add(Math.PI / 2)).div(TWO_PI);
  const angular = step(at, reveal.mul(1.02));
  const angularPen = oneMinus(smoothstep(0, 0.05, abs(at.sub(reveal)))).mul(step(reveal, 0.999)).mul(step(r, 0.97)).mul(step(0.82, r)).mul(1.5);
  const front = reveal.mul(1.1);
  const radialOut = step(r, front);
  const radialOutPen = oneMinus(smoothstep(0, 0.03, abs(r.sub(front)))).mul(step(reveal, 0.999)).mul(1.4);
  const radialIn = step(float(1).sub(front), r);
  const radialInPen = oneMinus(smoothstep(0, 0.03, abs(r.sub(float(1).sub(front))))).mul(step(reveal, 0.999)).mul(1.4);
  const m0 = step(mode, 0.5);
  const m1 = step(0.5, mode).mul(step(mode, 1.5));
  const m2 = step(1.5, mode);
  return shape.mul(angular.mul(m0).add(radialOut.mul(m1)).add(radialIn.mul(m2))).add(angularPen.mul(m0)).add(radialOutPen.mul(m1)).add(radialInPen.mul(m2));
}
