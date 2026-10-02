import * as THREE from 'three/webgpu';
import { clamp01, ease, poisson, span, type Ctx } from '../ctx';
import { randomDir } from '../particles';
import { claim, owns } from './own';

const UP = new THREE.Vector3(0, 1, 0);
const DOWN = new THREE.Vector3(0, -1, 0);

type P = Record<string, number>;

interface Frame {
  from: THREE.Vector3;
  to: THREE.Vector3;
  aim: THREE.Vector3;
  side: THREE.Vector3;
  dist: number;
}

function frame(ctx: Ctx): Frame {
  const from = ctx.from();
  const to = ctx.to();
  const aim = to.clone().sub(from).setY(0);
  if (aim.lengthSq() < 1e-6) aim.set(1, 0, 0);
  aim.normalize();
  const side = aim.clone().cross(UP).normalize();
  return { from, to, aim, side, dist: from.clone().setY(0).distanceTo(to.clone().setY(0)) };
}

function limb(ctx: Ctx, kind: 'fist' | 'foot', o: { delay: number; dur: number; path: (k: number) => THREE.Vector3; ease?: (t: number) => number; size?: number; arrive?: (at: THREE.Vector3, vel: THREE.Vector3) => void; after?: number }): void {
  const head = ctx.handle.head;
  const body = ctx.handle.body;
  const e = o.ease ?? ease.outExpo;
  const s = (o.size ?? 1) * ctx.scale;
  ctx.after(o.delay, () => {
    const id = claim(ctx.handle, 'limb');
    const mine = () => owns(ctx.handle, 'limb', id);
    body.limb = kind;
    const prev = o.path(0);
    head.copy(prev);
    ctx.during(0, o.dur, (k, dt) => {
      if (!mine()) return;
      head.copy(o.path(e(k)));
      const vel = dt > 0 ? head.clone().sub(prev).divideScalar(dt) : new THREE.Vector3();
      ctx.emit('glow', 1, { p: head.clone(), speed: 0, life: 0.09, size: 0.32 * s, colors: ctx.cols('core', 'main'), bright: 1.2 * ctx.B * ctx.glare, fadeIn: 0 });
      ctx.emit('spark', poisson(220 * dt), { p: head.clone(), jitter: 0.06 * s, v: () => vel.clone().multiplyScalar(-0.08).add(randomDir().multiplyScalar(1.2)), life: [0.08, 0.18], size: [0.01, 0.018], stretch: 0.04, colors: ctx.cols('core', 'main'), bright: 2.4 * ctx.B, fadeIn: 0 });
      ctx.trail(head, prev, vel, dt * 0.5, 0.55 * s);
      prev.copy(head);
    }, () => {
      const vel = o.path(1).sub(o.path(0.9)).multiplyScalar(10 / Math.max(o.dur, 1e-3));
      o.arrive?.(mine() ? head.clone() : o.path(1), vel);
      ctx.after(o.after ?? 0.12, () => {
        if (mine()) body.limb = null;
      });
    });
  });
}

function settle(ctx: Ctx, delay: number, dur = 0.35): void {
  const body = ctx.handle.body;
  ctx.after(delay, () => {
    const off = body.offset.clone();
    const lean = body.lean;
    const turn = body.turn;
    ctx.during(0, dur, (k) => {
      const q = ease.inOutQuad(k);
      body.offset.copy(off).multiplyScalar(1 - q);
      body.lean = lean * (1 - q);
      body.turn = turn * (1 - q);
    });
  });
}

function pose(ctx: Ctx, delay: number, dur: number, to: { lean?: number; turn?: number; offset?: THREE.Vector3 }, e: (t: number) => number = ease.inOutQuad): void {
  const body = ctx.handle.body;
  ctx.after(delay, () => {
    const lean = body.lean;
    const turn = body.turn;
    const off = body.offset.clone();
    ctx.during(0, dur, (k) => {
      const q = e(k);
      if (to.lean !== undefined) body.lean = lean + (to.lean - lean) * q;
      if (to.turn !== undefined) body.turn = turn + (to.turn - turn) * q;
      if (to.offset) body.offset.copy(off).lerp(to.offset, q);
    });
  });
}

function cone(ctx: Ctx, at: THREE.Vector3, axis: THREE.Vector3, size: number, s: number): void {
  ctx.lathe(at, { profile: 'cone', axis, radius: 0.18 * size, top: size * 1.1, height: 2.6 * size, flow: -6, tiles: [7, 1.5], streak: 1, rim: 0.7, fadeLo: 0.05, fadeHi: 0.5, dur: 0.32, bright: 1.3, grow: (k) => [1, 0.3 + 0.7 * ease.outExpo(clamp01(k * 3))], erode: (k) => ease.inQuad(span(k, 0.3, 1)), edge: 0.1 });
  for (let j = 1; j <= 2; j++) ctx.band(at.clone().addScaledVector(axis, 0.6 * j * size), { radius: (0.6 + 0.4 * j) * size * s, inner: 0.82, normal: axis, hard: 0.6, noise: 1, dur: 0.28, delay: 0.03 * j });
}

function knuckle(f: Frame, sign: number): THREE.Vector3 {
  return f.from.clone().addScaledVector(f.aim, -0.1).addScaledVector(f.side, 0.26 * sign).add(new THREE.Vector3(0, 0.05, 0));
}

function ghost(ctx: Ctx, from: THREE.Vector3, to: THREE.Vector3, delay: number, dur: number, s: number): void {
  ctx.after(delay, () => {
    const prev = from.clone();
    ctx.during(0, dur, (k, dt) => {
      const head = from.clone().lerp(to, ease.outExpo(k));
      const vel = dt > 0 ? head.clone().sub(prev).divideScalar(dt) : new THREE.Vector3();
      ctx.emit('glow', 1, { p: head, speed: 0, life: 0.07, size: 0.26 * s, colors: ctx.cols('core', 'main'), bright: 1.1 * ctx.B * ctx.glare, fadeIn: 0 });
      ctx.trail(head, prev, vel, dt * 0.3, 0.4 * s);
      prev.copy(head);
    }, () => {
      ctx.glow(to, 0.25 * s, 0.07, 1);
      ctx.emit('spark', 5, { p: to, v: () => randomDir().multiplyScalar(2.5), life: [0.08, 0.18], size: [0.01, 0.016], stretch: 0.04, colors: ctx.cols('core', 'main'), bright: 2.2 * ctx.B, fadeIn: 0 });
    });
  });
}

export function rush(ctx: Ctx, p: P): void {
  const f = frame(ctx);
  const s = ctx.scale * p.size;
  const n = Math.max(3, Math.round(p.count));
  const body = ctx.handle.body;
  ctx.handle.emit('cast');
  ctx.part('cast');
  pose(ctx, 0, p.windup, { lean: -0.15, offset: f.aim.clone().multiplyScalar(-0.1) });
  ctx.after(p.windup, () => ctx.handle.emit('release'));
  const reach = f.to.clone().addScaledVector(f.aim, -0.35);
  const back = f.to.clone().addScaledVector(f.aim, 0.25);
  const spot = (w: number) => reach.clone().addScaledVector(f.side, (Math.random() - 0.5) * 0.8 * s * w).add(new THREE.Vector3(0, (Math.random() - 0.4) * 1.1 * s * w, 0));
  const lunge = f.aim.clone().multiplyScalar(0.25);
  ctx.during(p.windup, n * p.gap, (k, dt) => {
    ctx.emit('spark', poisson((60 + 140 * k) * dt), { p: back, jitter: 0.25 * s, v: () => f.aim.clone().multiplyScalar(5 + Math.random() * 8).add(randomDir().multiplyScalar(2.5)), life: [0.12, 0.3], size: [0.01, 0.02], gravity: 5, stretch: 0.05, colors: ctx.cols('core', 'main'), bright: 2.4 * ctx.B, fadeIn: 0 });
    if (Math.random() < dt * 25) ctx.glow(reach, (0.3 + 0.45 * k) * s, 0.08, 0.6 + k);
  });
  for (let i = 0; i < n; i++) {
    const k = i / Math.max(n - 1, 1);
    const sign = i % 2 ? -1 : 1;
    const t0 = p.windup + i * p.gap;
    const at = spot(1);
    const start = knuckle(f, sign).add(new THREE.Vector3(0, (Math.random() - 0.5) * 0.2, 0));
    ctx.after(t0, () => {
      ctx.part('swing');
      body.lean = 0.2 + Math.random() * 0.12;
      body.turn = (0.2 + Math.random() * 0.15) * sign;
      body.offset.copy(lunge).multiplyScalar(0.85 + Math.random() * 0.3);
    });
    for (let g = 0; g < 2; g++) {
      const gs = g ? -sign : sign;
      ghost(ctx, knuckle(f, gs).add(lunge).add(new THREE.Vector3(0, (Math.random() - 0.5) * 0.3, 0)), spot(1.3), t0 + Math.random() * p.gap, p.gap * 0.8, s);
    }
    limb(ctx, 'fist', { delay: t0, dur: p.gap * 0.7, path: (q) => start.clone().add(body.offset).lerp(at, q), after: p.gap * 0.3, arrive: (hit) => {
      ctx.part('hit');
      const big = i % 3 === 2;
      ctx.hitmark(hit, { size: (0.18 + 0.1 * Math.random() + 0.12 * k + (big ? 0.12 : 0)) * s, spikes: 8 + Math.floor(Math.random() * 5), dur: 0.08, angle: Math.random() * Math.PI });
      ctx.burst(hit, { count: 8 + 10 * k, dir: f.aim, speed: 8, spread: 0.45, scale: 0.35 });
      ctx.glow(hit, (0.3 + 0.2 * k) * s, 0.08, 1.2);
      ctx.band(hit.clone().addScaledVector(f.aim, 0.2), { radius: (0.25 + 0.2 * k + (big ? 0.15 : 0)) * s, inner: 0.78, normal: f.aim, hard: 0.7, noise: 1, dur: 0.14 });
      if (big) ctx.wave(hit, 0.6 + 0.5 * k, 0.2, 0.5);
      ctx.hit(hit, 0.3, i === 0 ? 'first' : 'tick', f.aim);
    } });
  }
  const tEnd = p.windup + n * p.gap + 0.05;
  pose(ctx, tEnd, 0.1, { lean: -0.1, turn: -0.4, offset: f.aim.clone().multiplyScalar(0.1) });
  const final = knuckle(f, 1);
  limb(ctx, 'fist', { delay: tEnd + 0.1, dur: 0.07, path: (q) => final.clone().add(body.offset).lerp(reach, q), arrive: (at) => {
    ctx.part('hit');
    body.lean = 0.4;
    body.turn = 0.3;
    body.offset.copy(f.aim).multiplyScalar(0.4);
    ctx.lines(at, { size: 1.6 * s, parallel: ctx.screenAngle(at, f.aim), dur: 0.22, count: 18, width: 0.3, bright: 1.2 });
    ctx.impact(at, { power: p.power, dir: f.aim, ringNormal: f.aim, scale: 0.9 * p.size, extra: p.power >= 1.5, role: 'final' });
    cone(ctx, at, f.aim, 0.9 * p.size, s);
  } });
  settle(ctx, tEnd + 0.4);
}
rush.defaults = { windup: 0.15, count: 10, gap: 0.065, size: 1, power: 1.7 };

export function uppercut(ctx: Ctx, p: P): void {
  const f = frame(ctx);
  const s = ctx.scale * p.size;
  const body = ctx.handle.body;
  ctx.handle.emit('cast');
  ctx.part('cast');
  pose(ctx, 0, p.windup, { lean: 0.3, turn: 0.35, offset: new THREE.Vector3(0, -0.25, 0).addScaledVector(f.aim, 0.15) });
  const low = f.from.clone().addScaledVector(f.aim, 0.3).addScaledVector(f.side, 0.2).add(new THREE.Vector3(0, -0.75, 0));
  ctx.during(0, p.windup, (k, dt) => {
    if (Math.random() < dt * 25) ctx.glow(low.clone().add(body.offset), (0.15 + 0.25 * k) * s, 0.08, 1 + k);
  });
  const hitAt = f.to.clone().addScaledVector(f.aim, -0.3);
  const top = hitAt.clone().add(new THREE.Vector3(0, 0.9 * s, 0));
  ctx.after(p.windup, () => {
    ctx.handle.emit('release');
    ctx.part('swing');
  });
  pose(ctx, p.windup, p.rise, { lean: -0.2, turn: -0.2, offset: new THREE.Vector3(0, 0.25, 0).addScaledVector(f.aim, 0.45) }, ease.outQuad);
  const curve = (k: number) => {
    const a = low.clone().add(new THREE.Vector3(0, 0.25, 0));
    const b = hitAt.clone().add(new THREE.Vector3(0, -0.2, 0));
    return k < 0.6 ? a.lerp(b, k / 0.6) : b.lerp(top, (k - 0.6) / 0.4);
  };
  let landed = false;
  limb(ctx, 'fist', { delay: p.windup, dur: p.rise, ease: (t) => t, path: (k) => {
    if (!landed && k >= 0.6) {
      landed = true;
      ctx.part('hit');
      ctx.impact(hitAt, { power: p.power, dir: UP, push: UP, ringNormal: UP, scale: 0.85 * p.size, extra: p.power >= 1.5, role: 'final' });
      ctx.lines(hitAt.clone().add(new THREE.Vector3(0, 0.8, 0)), { size: 1.8 * s, parallel: Math.PI / 2, dur: 0.3, count: 18, width: 0.3, bright: 1.2 });
      cone(ctx, hitAt, UP, 0.8 * p.size, s);
      ctx.emitShape('spark', 50, { type: 'sphere', at: hitAt, r: 0.25 * s }, { v: () => UP.clone().multiplyScalar(6 + Math.random() * 6).add(randomDir().multiplyScalar(1.5)), life: [0.25, 0.5], size: [0.01, 0.02], gravity: 8, stretch: 0.05, colors: ctx.cols('core', 'main'), bright: 2.6 * ctx.B, fadeIn: 0 });
    }
    return curve(k);
  } });
  settle(ctx, p.windup + p.rise + 0.25, 0.4);
}
uppercut.defaults = { windup: 0.2, rise: 0.14, size: 1, power: 1.7 };

export function kick(ctx: Ctx, p: P): void {
  const f = frame(ctx);
  const s = ctx.scale * p.size;
  const body = ctx.handle.body;
  const hip = ctx.ground(f.from).add(new THREE.Vector3(0, p.height, 0));
  const reach = Math.min(Math.max(f.dist * 0.75, 1.1), 1.7);
  const e1 = f.aim;
  const e2 = f.side;
  const a0 = 2.6;
  const a1 = -0.9;
  const at = (a: number) => hip.clone().add(body.offset).addScaledVector(e1, Math.cos(a) * reach).addScaledVector(e2, Math.sin(a) * reach);
  ctx.handle.emit('cast');
  ctx.part('cast');
  pose(ctx, 0, p.windup, { lean: -0.2, turn: 0.9, offset: f.aim.clone().multiplyScalar(-0.1) });
  ctx.after(p.windup, () => {
    ctx.handle.emit('release');
    ctx.part('swing');
    ctx.arc({ pivot: hip.clone().add(body.offset), e1, e2, a0, a1, r0: reach * 0.55, r1: reach * 1.05, dur: p.dur, ease: ease.slash, lag: 0.55, hold: 0.15 });
  });
  pose(ctx, p.windup, p.dur, { lean: -0.35, turn: -1.1, offset: f.aim.clone().multiplyScalar(0.2) }, ease.slash);
  let landed = false;
  limb(ctx, 'foot', { delay: p.windup, dur: p.dur, ease: ease.slash, size: p.size, path: (k) => {
    const a = a0 + (a1 - a0) * k;
    if (!landed && a <= 0.05) {
      landed = true;
      ctx.part('hit');
      const t = f.to.clone().addScaledVector(f.aim, -0.25);
      const push = f.aim.clone().addScaledVector(f.side, -0.8).normalize();
      ctx.impact(t, { power: p.power, dir: push, ringNormal: 'camera', scale: 0.9 * p.size, extra: p.power >= 1.5, role: 'final' });
      ctx.hitmark(t, { size: 1.1 * s, spikes: 10, dur: 0.18, angle: ctx.screenAngle(t, push) });
      ctx.lines(t, { size: 1.6 * s, parallel: ctx.screenAngle(t, push), dur: 0.22, count: 16, width: 0.3, bright: 1.1 });
      ctx.part('swing');
    }
    return at(a);
  } });
  settle(ctx, p.windup + p.dur + 0.15, 0.4);
}
kick.defaults = { windup: 0.16, dur: 0.16, height: 1.15, size: 1, power: 1.6 };

export function heel(ctx: Ctx, p: P): void {
  const f = frame(ctx);
  const s = ctx.scale * p.size;
  const body = ctx.handle.body;
  const hip = ctx.ground(f.from).add(new THREE.Vector3(0, 1, 0));
  const reach = Math.min(Math.max(f.dist * 0.8, 1.2), 1.8);
  const at = (a: number) => hip.clone().add(body.offset).addScaledVector(f.aim, Math.cos(a) * reach).addScaledVector(UP, Math.sin(a) * reach);
  const hi = 1.75;
  const lo = -0.15;
  ctx.handle.emit('cast');
  ctx.part('cast');
  pose(ctx, 0, p.windup, { lean: -0.35, offset: new THREE.Vector3(0, 0.15, 0).addScaledVector(f.aim, 0.1) });
  limb(ctx, 'foot', { delay: 0, dur: p.windup, ease: ease.outCubic, size: p.size, after: 0, path: (k) => at(-0.6 + (hi + 0.6) * k) });
  ctx.after(p.windup * 0.7, () => ctx.star(at(hi), 0.6 * s, 0.2, 2.5));
  ctx.after(p.windup, () => {
    ctx.handle.emit('release');
    ctx.part('swing');
    ctx.arc({ pivot: hip.clone().add(body.offset), e1: f.aim, e2: UP, a0: hi, a1: lo, r0: reach * 0.55, r1: reach * 1.05, dur: p.dur, ease: ease.inQuad, lag: 0.5, hold: 0.15 });
  });
  pose(ctx, p.windup, p.dur, { lean: 0.35, offset: f.aim.clone().multiplyScalar(0.25) }, ease.inQuad);
  limb(ctx, 'foot', { delay: p.windup + 0.001, dur: p.dur, ease: ease.inQuad, size: p.size, path: (k) => at(hi + (lo - hi) * k), arrive: () => {
    ctx.part('hit');
    const t = f.to.clone().add(new THREE.Vector3(0, 0.3, 0)).addScaledVector(f.aim, -0.2);
    const g = ctx.ground(f.to);
    ctx.screenFlash(0.08);
    ctx.impact(t, { power: p.power, dir: DOWN, push: DOWN, ringNormal: 'up', scale: 1 * p.size, extra: true, role: 'final' });
    ctx.lines(t.clone().add(new THREE.Vector3(0, 0.8, 0)), { size: 1.8 * s, parallel: Math.PI / 2, dur: 0.25, count: 16, width: 0.3, bright: 1.1 });
    ctx.decal(g, 1.8 * s, 5);
    ctx.ring(g, 2.2 * s, { dur: 0.5, thick: 0.06 });
    ctx.dust(g, 1.3 * s);
    ctx.rocks(g, 8, 0.8 * s, () => randomDir().setY(0.6 + Math.random()).multiplyScalar(3 + Math.random() * 2));
  } });
  settle(ctx, p.windup + p.dur + 0.25, 0.4);
}
heel.defaults = { windup: 0.32, dur: 0.12, size: 1, power: 1.9 };

export function palm(ctx: Ctx, p: P): void {
  const f = frame(ctx);
  const s = ctx.scale * p.size;
  const body = ctx.handle.body;
  ctx.handle.emit('cast');
  ctx.part('cast');
  pose(ctx, 0, p.windup, { lean: -0.1, turn: 0.4, offset: f.aim.clone().multiplyScalar(-0.1).add(new THREE.Vector3(0, -0.15, 0)) });
  const start = knuckle(f, 1).add(new THREE.Vector3(0, -0.1, 0));
  const contact = f.to.clone().addScaledVector(f.aim, -0.35);
  ctx.during(0, p.windup, (k, dt) => {
    if (Math.random() < dt * 30) ctx.glow(start.clone().add(body.offset), (0.15 + 0.35 * k) * s, 0.08, 1 + 1.5 * k);
  });
  ctx.after(p.windup, () => {
    ctx.handle.emit('release');
    ctx.part('swing');
  });
  pose(ctx, p.windup, 0.08, { lean: 0.3, turn: -0.3, offset: f.aim.clone().multiplyScalar(0.45).add(new THREE.Vector3(0, -0.1, 0)) }, ease.outExpo);
  limb(ctx, 'fist', { delay: p.windup, dur: 0.08, after: 0.3, path: (k) => start.clone().add(body.offset).lerp(contact, k), arrive: (at) => {
    ctx.part('hit');
    ctx.glow(at, 0.7 * s, 0.15, 1.6);
    ctx.ring(at, 0.6 * s, { normal: f.aim, dur: 0.22, thick: 0.12 });
    ctx.wave(at, 1.2, 0.35, 0.8);
    ctx.hit(at, 0.5 * p.power, 'first', f.aim);
    for (let i = 0; i < 4; i++) ctx.band(at.clone().addScaledVector(f.aim, 0.35 + i * 0.45), { radius: (0.55 + i * 0.22) * s, inner: 0.8, normal: f.aim, hard: 0.7, noise: 0.6, dur: 0.3, delay: p.delay * 0.5 + i * 0.035 });
    ctx.after(p.delay, () => {
      const out = f.to.clone().addScaledVector(f.aim, 0.9 * s);
      ctx.impact(f.to, { power: p.power, dir: f.aim, ringNormal: f.aim, scale: 0.8 * p.size, hit: false });
      ctx.burst(out, { count: 60, speed: 9, dir: f.aim, spread: 0.35, scale: 0.8 });
      ctx.flare(out, 1.4 * s, 0.25);
      ctx.wave(out, 1.6, 0.4, 1);
      ctx.hit(f.to, p.power, 'final', f.aim);
    });
  } });
  settle(ctx, p.windup + p.delay + 0.35, 0.4);
}
palm.defaults = { windup: 0.18, delay: 0.1, size: 1, power: 1.8 };

export function tackle(ctx: Ctx, p: P): void {
  const f = frame(ctx);
  const s = ctx.scale * p.size;
  const body = ctx.handle.body;
  const run = Math.max(f.dist - 0.75, 0.2);
  ctx.handle.emit('cast');
  ctx.part('cast');
  pose(ctx, 0, p.charge, { lean: 0.45, turn: 0.6, offset: f.aim.clone().multiplyScalar(-0.2).add(new THREE.Vector3(0, -0.12, 0)) });
  ctx.after(p.charge, () => {
    ctx.handle.emit('release');
    ctx.part('swing');
    const start = ctx.ground(f.from).add(body.offset);
    ctx.dust(start, 0.8 * s);
    let hit = false;
    ctx.during(0, p.dash, (k, dt) => {
      body.offset.copy(f.aim).multiplyScalar(-0.2 + (run + 0.2) * ease.inQuad(k));
      body.lean = 0.5;
      body.turn = 0.6;
      const at = f.from.clone().add(body.offset);
      ctx.emit('smoke', poisson(50 * dt), { p: ctx.ground(at).setY(ctx.floor + 0.05), jitter: 0.2, v: () => f.aim.clone().multiplyScalar(-1.5).setY(0.5), life: [0.4, 0.7], size: [0.15 * s, 0.25 * s], grow: 2, drag: 3, colors: [ctx.pal.smoke ?? new THREE.Color(0.3, 0.28, 0.25), new THREE.Color(0.3, 0.28, 0.25)], fadeIn: 0.03 });
      if (Math.random() < dt * 30) ctx.lines(at, { size: 1.3 * s, parallel: ctx.screenAngle(at, f.aim), dur: 0.15, count: 12, width: 0.3, bright: 0.9 });
      if (!hit && k >= 0.999) hit = true;
    }, () => {
      ctx.part('hit');
      const at = f.to.clone().addScaledVector(f.aim, -0.4);
      ctx.screenFlash(0.08);
      ctx.impact(at, { power: p.power, dir: f.aim, ringNormal: f.aim, scale: 1 * p.size, extra: p.power >= 1.5, role: 'final' });
      ctx.hitmark(at, { size: 1.3 * s, spikes: 12, dur: 0.2, angle: ctx.screenAngle(at, f.aim) });
      for (let j = 1; j <= 3; j++) ctx.band(at.clone().addScaledVector(f.aim, 0.4 * j), { radius: (0.6 + 0.3 * j) * s, inner: 0.82, normal: f.aim, hard: 0.6, noise: 1, dur: 0.28, delay: 0.03 * j });
      const held = body.offset.clone();
      ctx.during(0, 0.12, (k) => body.offset.copy(held).addScaledVector(f.aim, -0.35 * ease.outCubic(k)));
      settle(ctx, 0.25, 0.4);
    });
  });
}
tackle.defaults = { charge: 0.22, dash: 0.2, size: 1, power: 1.8 };

export function pound(ctx: Ctx, p: P): void {
  const f = frame(ctx);
  const s = ctx.scale * p.size;
  const body = ctx.handle.body;
  ctx.handle.emit('cast');
  ctx.part('cast');
  pose(ctx, 0, p.windup * 0.35, { lean: 0.25, offset: new THREE.Vector3(0, -0.2, 0) });
  pose(ctx, p.windup * 0.35, p.windup * 0.65, { lean: -0.25, offset: new THREE.Vector3(0, 0.6, 0).addScaledVector(f.aim, 0.2) }, ease.outCubic);
  const raised = () => f.from.clone().add(body.offset).add(new THREE.Vector3(0, 0.75, 0)).addScaledVector(f.aim, 0.1);
  const g = ctx.ground(f.from.clone().addScaledVector(f.aim, 0.75));
  limb(ctx, 'fist', { delay: p.windup * 0.35, dur: p.windup * 0.65, ease: ease.outCubic, after: 0, path: () => raised() });
  ctx.after(p.windup, () => {
    ctx.handle.emit('release');
    ctx.part('swing');
  });
  pose(ctx, p.windup, 0.1, { lean: 0.38, offset: new THREE.Vector3(0, -0.15, 0).addScaledVector(f.aim, 0.25) }, ease.inQuad);
  limb(ctx, 'fist', { delay: p.windup + 0.001, dur: 0.1, ease: ease.inQuad, after: 0.25, path: (k) => raised().lerp(g.clone().setY(g.y + 0.1), k), arrive: () => {
    ctx.part('hit');
    ctx.screenFlash(0.1);
    ctx.impact(g.clone().setY(g.y + 0.2), { power: p.power * 0.6, ringNormal: 'up', scale: 0.9 * p.size, hit: false, extra: true });
    ctx.decal(g, 2 * s, 5);
    ctx.rocks(g, 10, 0.9 * s, () => randomDir().setY(0.7 + Math.random()).multiplyScalar(3 + Math.random() * 3));
    const reach = g.clone().setY(0).distanceTo(f.to.clone().setY(0));
    const out = reach + 1.5;
    const dur = out / p.speed;
    ctx.band(g.clone().setY(g.y + 0.02), { radius: out * s, inner: 0.9, normal: 'up', hard: 0.5, noise: 1, dur, grow: (k) => 0.05 + 0.95 * k, bright: 1.6 });
    ctx.band(g.clone().setY(g.y + 0.02), { radius: out * 0.85 * s, inner: 0.8, normal: 'up', hard: 0.3, noise: 1, dur, delay: 0.04, grow: (k) => 0.05 + 0.95 * k, colors: ['main', 'accent', 'accent'], bright: 1 });
    ctx.wave(g, out * 0.8, dur, 1.2);
    ctx.during(0, dur, (k, dt) => {
      const r = out * k;
      ctx.emitShape('smoke', poisson(80 * dt), { type: 'circle', at: g.clone().setY(g.y + 0.05), r }, { outward: [1, 2], v: () => new THREE.Vector3(0, 0.6, 0), life: [0.4, 0.7], size: [0.15 * s, 0.28 * s], grow: 2, drag: 3, colors: [ctx.pal.smoke ?? new THREE.Color(0.3, 0.28, 0.25), new THREE.Color(0.3, 0.28, 0.25)], fadeIn: 0.03 });
      ctx.emitShape('spark', poisson(160 * dt), { type: 'circle', at: g.clone().setY(g.y + 0.05), r }, { outward: [1, 3], v: () => new THREE.Vector3(0, 2 + Math.random() * 3, 0), life: [0.2, 0.4], size: [0.01, 0.018], gravity: 9, stretch: 0.04, colors: ctx.cols('core', 'main'), bright: 2.4 * ctx.B, fadeIn: 0 });
    });
    ctx.after(reach / p.speed, () => {
      ctx.impact(f.to, { power: p.power, dir: UP, push: f.aim.clone().add(UP).normalize(), ringNormal: 'camera', scale: 0.7 * p.size, role: 'final' });
    });
  } });
  settle(ctx, p.windup + 0.45, 0.4);
}
pound.defaults = { windup: 0.38, speed: 9, size: 1, power: 1.8 };
