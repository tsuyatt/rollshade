import * as THREE from 'three/webgpu';
import { ease, poisson, type Ctx } from '../ctx';
import { randomDir } from '../particles';
import { arcGeometry } from '../prims';
import { claim, owns } from './own';

const UP = new THREE.Vector3(0, 1, 0);
const DEG = Math.PI / 180;

type P = Record<string, number>;

interface Frame {
  pivot: THREE.Vector3;
  fwd: THREE.Vector3;
  right: THREE.Vector3;
  dist: number;
  reach: number;
}

function frame(ctx: Ctx, reach = 0): Frame {
  const pivot = ctx.from();
  const target = ctx.to();
  const fwd = target.clone().sub(pivot).setY(0);
  if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
  fwd.normalize();
  const right = fwd.clone().cross(UP).normalize();
  const dist = pivot.distanceTo(target);
  return { pivot, fwd, right, dist, reach: reach > 0 ? reach : THREE.MathUtils.clamp(dist * 0.9, 1.1, 2.4) };
}

interface Swing {
  roll: number;
  mirror?: boolean;
  step?: number;
  lean?: [number, number];
  push?: THREE.Vector3;
  a0: number;
  a1: number;
  windup: number;
  dur: number;
  lag: number;
  delay?: number;
  sparks?: number;
  glint?: boolean;
  trail?: boolean;
  onHit?: (i: number, tangent: THREE.Vector3) => void;
  ease?: (t: number) => number;
}

function swing(ctx: Ctx, f: Frame, o: Swing): number {
  ctx.part('swing');
  const roll = o.roll * DEG;
  const e1 = f.fwd;
  const e2 = f.right.clone().multiplyScalar(Math.cos(roll) * (o.mirror ? -1 : 1)).addScaledVector(UP, Math.sin(roll));
  const body = ctx.handle.body;
  const side = Math.cos(roll) * (o.mirror ? -1 : 1);
  const step = o.step ?? 0.35;
  const [lean0, lean1] = o.lean ?? [-0.15, 0.3];
  const r1 = f.reach;
  const r0 = r1 * 0.28;
  const a0 = o.a0 * DEG;
  const a1 = o.a1 * DEG;
  const e = o.ease ?? ease.slash;
  const blade = ctx.handle.blade;
  const pose = (a: number) => {
    const d = e1.clone().multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a));
    blade.base.copy(f.pivot).add(body.offset).addScaledVector(d, r0);
    blade.tip.copy(f.pivot).add(body.offset).addScaledVector(d, r1);
  };
  const angle = (k: number) => a0 + (a1 - a0) * e(k);
  const hits: number[] = [];
  const steps = 240;
  for (let i = 1; i <= steps; i++) {
    const x0 = Math.floor(angle((i - 1) / steps) / (Math.PI * 2));
    const x1 = Math.floor(angle(i / steps) / (Math.PI * 2));
    if (x0 !== x1) hits.push(i / steps);
  }
  const t0 = o.delay ?? 0;
  const W = o.windup;
  let id = 0;
  const mine = () => owns(ctx.handle, 'swing', id);
  ctx.after(t0, () => {
    id = claim(ctx.handle, 'swing');
    blade.active = true;
    const start = angle(0) * 0.35;
    if (W > 0)
      ctx.during(0, W, (k) => {
        if (!mine()) return;
        const a = start + (angle(0) + Math.sign(a0 - a1) * 0.2 - start) * ease.inOutQuad(k);
        pose(a);
        body.lean = lean0 * ease.inOutQuad(k);
        body.turn = -Math.sin(a) * side * 0.6;
      });
    if (o.glint !== false && W > 0.05) ctx.after(W * 0.6, () => ctx.star(blade.tip.clone(), 0.5 * ctx.scale, 0.18, 2.5));
  });
  ctx.after(t0 + W, () => {
    const lead = Math.sign(a0 - a1) * 0.2;
    const from = body.offset.clone();
    const shift = from.clone();
    if (o.trail !== false) ctx.arc({ pivot: f.pivot, e1, e2, a0: a0 + lead, a1, r0, r1, dur: o.dur, ease: e, lag: o.lag, hold: 0.2, offset: shift });
    const prevTip = blade.tip.clone();
    let hi = 0;
    ctx.during(0, o.dur, (k, dt) => {
      const a = a0 + lead + (a1 - a0 - lead) * e(k);
      const own = mine();
      if (own) {
        body.lean = lean0 + (lean1 - lean0) * e(k);
        body.turn = -Math.sin(a) * side * 0.6;
        body.offset.copy(from).addScaledVector(f.fwd, step * e(k));
        shift.copy(body.offset);
        pose(a);
        const tipVel = dt > 0 ? blade.tip.clone().sub(prevTip).divideScalar(dt) : new THREE.Vector3();
        const sp = o.sparks ?? 1;
        ctx.emit('spark', poisson(sp * 260 * dt * ctx.efx.sparks), { p: () => blade.base.clone().lerp(blade.tip, 0.55 + Math.random() * 0.45), v: () => tipVel.clone().multiplyScalar(0.15).add(randomDir().multiplyScalar(1.2)), life: [0.15, 0.4], size: [0.01, 0.02], gravity: 4, drag: 3, stretch: 0.03, colors: ctx.cols('core', 'main'), bright: 2.5 * ctx.B, fadeIn: 0 });
        ctx.trail(blade.tip, prevTip, tipVel, dt * 0.35 * sp, 0.55, 1);
        prevTip.copy(blade.tip);
      }
      while (hi < hits.length && k >= hits[hi]) {
        const tangent = e2.clone().multiplyScalar(Math.sign(a1 - a0));
        ctx.part('hit');
        if (o.onHit) o.onHit(hi, tangent);
        else strike(ctx, f, tangent, 1, { push: o.push });
        ctx.part('swing');
        hi++;
      }
    }, () => {
      ctx.after(0.12, () => {
        if (mine()) blade.active = false;
      });
      const lean = body.lean;
      const turn = body.turn;
      const held = body.offset.clone();
      ctx.during(0.1, 0.35, (k) => {
        if (!mine()) return;
        const q = ease.inOutQuad(k);
        body.lean = lean * (1 - q);
        body.turn = turn * (1 - q);
        body.offset.copy(held).multiplyScalar(1 - q);
      });
    });
  });
  return t0 + W + o.dur;
}

function screenAngle(ctx: Ctx, at: THREE.Vector3, dir: THREE.Vector3): number {
  const cam = ctx.fx.camera as THREE.PerspectiveCamera;
  const s0 = at.clone().project(cam);
  const s1 = at.clone().add(dir).project(cam);
  return Math.atan2(s1.y - s0.y, (s1.x - s0.x) * (cam.aspect ?? 1));
}

function strike(ctx: Ctx, f: Frame, tangent: THREE.Vector3, pw: number, o: { mark?: number; extra?: boolean; scale?: number; push?: THREE.Vector3; role?: 'first' | 'link' | 'final' | 'tick'; at?: THREE.Vector3 } = {}): void {
  const target = o.at ?? ctx.to();
  const ang = screenAngle(ctx, target, tangent);
  const power = pw * ctx.power;
  if (o.mark !== 0) ctx.crescent(target, (o.mark ?? 1.9) * ctx.scale * (power > 1.1 ? 1.1 : 1), ang, { hold: 0.28, from: f.pivot, tangent });
  const out = f.fwd.clone().add(tangent.clone().multiplyScalar(0.8)).normalize();
  ctx.impact(target, { power: pw, dir: out, push: o.push, ringNormal: 'camera', scale: o.scale ?? 0.8, extra: o.extra, role: o.role });
}

export function slash(ctx: Ctx, p: P): void {
  const f = frame(ctx, p.reach);
  ctx.handle.emit('cast');
  ctx.after(p.windup, () => ctx.handle.emit('release'));
  swing(ctx, f, { roll: p.roll, mirror: p.mirror >= 0.5, a0: p.sweep / 2, a1: -p.sweep / 2, windup: p.windup, dur: p.dur, lag: p.lag, sparks: p.sparks, onHit: (_i, t) => strike(ctx, f, t, p.power, { extra: p.power >= 1.5 }) });
}
slash.defaults = { windup: 0.12, dur: 0.18, sweep: 190, roll: 55, mirror: 0, reach: 0, lag: 0.6, power: 1, sparks: 1 };

export function swipe(ctx: Ctx, p: P): void {
  const f = frame(ctx, p.reach);
  ctx.handle.emit('cast');
  ctx.after(p.windup, () => ctx.handle.emit('release'));
  swing(ctx, f, { roll: p.roll, mirror: p.mirror >= 0.5, a0: p.sweep / 2, a1: -p.sweep / 2, windup: p.windup, dur: p.dur, lag: p.lag, sparks: p.sparks, glint: false, onHit: (_i, t) => {
    const at = ctx.to();
    if (p.sparks > 0) ctx.emitShape('spark', Math.round(24 * p.sparks), { type: 'sphere', at, r: 0.1 }, { v: () => t.clone().multiplyScalar(3 + Math.random() * 3).add(randomDir().multiplyScalar(1.5)), life: [0.1, 0.25], size: [0.01, 0.018], gravity: 4, stretch: 0.04, colors: ctx.cols('core', 'main'), bright: 2.4 * ctx.B, fadeIn: 0 });
    ctx.hit(at, p.power);
  } });
}
swipe.defaults = { windup: 0.1, dur: 0.16, sweep: 190, roll: 55, mirror: 0, reach: 0, lag: 0.6, power: 1, sparks: 0.3 };

export function spin(ctx: Ctx, p: P): void {
  const f = frame(ctx, p.reach);
  ctx.handle.emit('cast');
  ctx.after(p.windup, () => ctx.handle.emit('release'));
  const end = swing(ctx, f, { roll: p.roll, a0: p.sweep / 2, a1: -p.sweep / 2, windup: p.windup, dur: p.dur, lag: 0.45, ease: ease.inOutQuad, sparks: 1.4, onHit: (_i, t) => strike(ctx, f, t, p.power, { scale: 0.7 }) });
  ctx.after(end - p.dur * 0.3, () => {
    const g = ctx.ground(f.pivot);
    ctx.ring(g, f.reach * 1.5, { dur: 0.45, thick: 0.06 });
    ctx.dust(g, 1.2);
    ctx.wave(f.pivot, f.reach * 1.4, 0.4, 0.8);
  });
}
spin.defaults = { windup: 0.1, dur: 0.36, sweep: 420, roll: 6, reach: 0, power: 1.1 };

export function cross(ctx: Ctx, p: P): void {
  const f = frame(ctx, p.reach);
  ctx.handle.emit('cast');
  ctx.after(p.windup, () => ctx.handle.emit('release'));
  const marks: number[] = [];
  const first = swing(ctx, f, { roll: 50, a0: 95, a1: -95, windup: p.windup, dur: p.dur, lag: 0.5, onHit: (_i, t) => {
    const ang = screenAngle(ctx, ctx.to(), t);
    marks.push(ang);
    ctx.crescent(ctx.to(), 2 * ctx.scale, ang, { hold: p.gap + 0.3, from: f.pivot, tangent: t });
    ctx.burst(ctx.to(), { count: 30, dir: f.fwd, scale: 0.6 });
    ctx.hit(ctx.to(), 0.5);
  } });
  const second = swing(ctx, f, { roll: -50, a0: 95, a1: -95, windup: 0.05, dur: p.dur, lag: 0.5, delay: first - 0.02, glint: false, onHit: (_i, t) => {
    const ang = screenAngle(ctx, ctx.to(), t);
    ctx.crescent(ctx.to(), 2 * ctx.scale, ang, { hold: p.gap + 0.1, from: f.pivot, tangent: t });
    ctx.burst(ctx.to(), { count: 30, dir: f.fwd, scale: 0.6 });
    ctx.hit(ctx.to(), 0.5);
  } });
  ctx.after(second + p.gap, () => {
    ctx.part('hit');
    const t = ctx.to();
    for (const a of marks) ctx.crescent(t, 2.4 * ctx.scale, a, { hold: 0.2, from: f.pivot });
    ctx.screenFlash(0.25);
    ctx.impact(t, { power: p.power, scale: 1.1, extra: true, ringNormal: 'camera', role: 'final' });
  });
}
cross.defaults = { windup: 0.12, dur: 0.15, gap: 0.22, reach: 0, power: 1.6 };

export function thrust(ctx: Ctx, p: P): void {
  const f = frame(ctx, p.reach);
  const blade = ctx.handle.blade;
  const target = ctx.to();
  const aim = target.clone().sub(f.pivot).normalize();
  const len = f.reach * 0.75;
  const body = ctx.handle.body;
  const pose = (x: number) => {
    body.offset.copy(f.fwd).multiplyScalar(Math.max(x, 0) * 0.45);
    body.lean = x < 0 ? x * 0.4 : Math.min(x / Math.max(f.dist, 1), 1) * 0.3;
    blade.base.copy(f.pivot).add(body.offset).addScaledVector(aim, x);
    blade.tip.copy(f.pivot).add(body.offset).addScaledVector(aim, x + len);
  };
  ctx.handle.emit('cast');
  ctx.part('swing');
  blade.active = true;
  ctx.during(0, p.windup, (k) => pose(-0.35 * ease.inOutQuad(k)));
  ctx.after(p.windup * 0.6, () => ctx.star(blade.tip.clone(), 0.5 * ctx.scale, 0.18, 2.5));
  ctx.after(p.windup, () => {
    ctx.handle.emit('release');
    const far = Math.max(f.dist - len + 0.25, 0.3);
    let hit = false;
    const prev = blade.tip.clone();
    ctx.during(0, p.dur, (k, dt) => {
      pose(-0.35 + (far + 0.35) * ease.slash(k));
      const v = dt > 0 ? blade.tip.clone().sub(prev).divideScalar(dt) : new THREE.Vector3();
      ctx.emit('spark', poisson(300 * dt), { p: () => blade.base.clone().lerp(blade.tip, Math.random()), v: () => aim.clone().multiplyScalar(6).add(randomDir()), life: [0.1, 0.25], size: [0.01, 0.018], stretch: 0.04, colors: ctx.cols('core', 'main'), bright: 2.5 * ctx.B, fadeIn: 0 });
      ctx.emit('spark', 1, { p: blade.tip.clone(), v: () => v.clone(), life: 0.08, size: 0.06, stretch: 0.03, colors: ctx.cols('core', 'main'), bright: 2.5 * ctx.B, fadeIn: 0 });
      ctx.trail(blade.tip, prev, v, dt * 0.4, 0.5);
      prev.copy(blade.tip);
      if (!hit && k > 0.55) {
        hit = true;
        ctx.part('hit');
        const t = ctx.to();
        ctx.ring(t.clone().addScaledVector(aim, -0.5), 0.6 * ctx.scale, { normal: aim, dur: 0.25, thick: 0.12 });
        ctx.ring(t, 1 * ctx.scale, { normal: aim, dur: 0.3, thick: 0.1, delay: 0.03 });
        ctx.ring(t.clone().addScaledVector(aim, 0.6), 1.3 * ctx.scale, { normal: aim, dur: 0.35, thick: 0.08, delay: 0.06 });
        ctx.impact(t, { power: p.power, dir: aim, ringNormal: aim, scale: 0.8, extra: p.power >= 1.5 });
        ctx.burst(t.clone().addScaledVector(aim, 0.5), { count: 50, speed: 10, dir: aim, spread: 0.3, scale: 0.8 });
        ctx.flare(t, 1.8 * ctx.scale, 0.3);
        ctx.part('swing');
      }
    }, () => ctx.during(0.05, 0.2, (k) => pose(far * (1 - ease.inOutQuad(k))), () => (blade.active = false)));
  });
}
thrust.defaults = { windup: 0.16, dur: 0.12, reach: 0, power: 1.3 };

export function smash(ctx: Ctx, p: P): void {
  const f = frame(ctx, p.reach);
  ctx.handle.emit('cast');
  ctx.after(p.windup, () => ctx.handle.emit('release'));
  const a1 = -40;
  const end = swing(ctx, f, { roll: 90, a0: 120, a1, windup: p.windup, dur: p.dur, lag: 0.55, ease: ease.inQuad, onHit: () => {} });
  const tip = f.pivot.clone().addScaledVector(f.fwd, f.reach * Math.cos(a1 * DEG)).addScaledVector(UP, f.reach * Math.sin(a1 * DEG));
  const g = ctx.ground(tip);
  ctx.after(end, () => {
    ctx.part('hit');
    const pw = p.power;
    ctx.screenFlash(0.1);
    ctx.impact(g.clone().setY(g.y + 0.25), { power: pw, scale: 1.2, ringNormal: 'up', extra: true });
    ctx.decal(g, 2.2, 5);
    ctx.dust(g, 1.2);
    ctx.rocks(g, 14, 1, () => randomDir().setY(0.5 + Math.random()).multiplyScalar(4 + Math.random() * 3));
    for (let i = 1; i <= p.fissure; i++) {
      const q = g.clone().addScaledVector(f.fwd, i * 0.55).addScaledVector(f.right, (Math.random() - 0.5) * 0.3);
      ctx.after(i * 0.045, () => {
        ctx.decal(q, 0.9, 4);
        ctx.burst(q.clone().setY(q.y + 0.1), { count: 18, speed: 4, dir: UP, spread: 0.5, scale: 0.6 });
        if (i % 2) ctx.dust(q, 0.5);
        if (ctx.element === 'ice') ctx.spike(q, g, 0.7, 'crystal', 0.8);
        else if (ctx.element === 'earth') ctx.spike(q, g, 0.7, 'rock', 0.8);
        if (q.distanceTo(ctx.ground(ctx.to())) < 0.6) ctx.hit(ctx.to(), 0.6, 'tick');
      });
    }
  });
}
smash.defaults = { windup: 0.28, dur: 0.14, reach: 0, power: 1.8, fissure: 5 };

export function iaido(ctx: Ctx, p: P): void {
  const f = frame(ctx, p.reach);
  const blade = ctx.handle.blade;
  const roll = 8 * DEG;
  const e2 = f.right.clone().multiplyScalar(Math.cos(roll)).addScaledVector(UP, Math.sin(roll));
  const sheath = 150 * DEG;
  const d = f.fwd.clone().multiplyScalar(Math.cos(sheath)).addScaledVector(e2, Math.sin(sheath));
  blade.base.copy(f.pivot).addScaledVector(d, f.reach * 0.28);
  blade.tip.copy(f.pivot).addScaledVector(d, f.reach);
  blade.active = true;
  ctx.handle.emit('cast');
  ctx.part('cast');
  const mid = blade.base.clone().lerp(blade.tip, 0.5);
  ctx.during(0, p.charge, (k, dt) => {
    const n = poisson(140 * (0.3 + k) * dt);
    for (let i = 0; i < n; i++) {
      const target = blade.base.clone().lerp(blade.tip, Math.random());
      const start = target.clone().add(randomDir().multiplyScalar(0.8));
      const life = 0.25 + Math.random() * 0.1;
      const v = target.clone().sub(start).divideScalar(life);
      ctx.emit('spark', 1, { p: start, v: () => v.clone(), life, size: [0.01, 0.018], stretch: 0.05, colors: ctx.cols('core', 'main'), bright: 2.2 * ctx.B, fadeIn: 0.1, fadePow: 0.5 });
    }
    if (Math.random() < dt * 20) ctx.emit('glow', 1, { p: mid, jitter: f.reach * 0.3, speed: 0, life: 0.12, size: 0.3 + k * 0.4, colors: ctx.cols('main', 'accent'), bright: (0.5 + k) * ctx.B });
  });
  ctx.after(p.charge * 0.85, () => ctx.star(blade.tip.clone(), 0.9, 0.2, 3));
  const end = swing(ctx, f, { roll: 8, a0: 150, a1: -110, windup: 0, dur: p.dur, lag: 1.1, delay: p.charge, glint: false, sparks: 0.6, onHit: (_i, t) => {
    ctx.screenFlash(0.35);
    const ang = screenAngle(ctx, ctx.to(), t);
    ctx.crescent(ctx.to(), 3 * ctx.scale, ang, { hold: p.delay + 0.2, bend: 0.15, from: f.pivot, tangent: t });
    ctx.hit(ctx.to(), 0.4);
  } });
  ctx.after(p.charge, () => ctx.handle.emit('release'));
  ctx.after(end + p.delay, () => {
    ctx.part('hit');
    const t = ctx.to();
    for (let i = 0; i < 3; i++) ctx.after(i * 0.03, () => ctx.crescent(t.clone().add(randomDir().multiplyScalar(0.25)), 2.2 * ctx.scale, Math.random() * Math.PI, { hold: 0.25, bend: 0.2, from: f.pivot }));
    ctx.impact(t, { power: p.power, scale: 1.2, extra: true, role: 'final' });
  });
}
iaido.defaults = { charge: 0.6, dur: 0.07, delay: 0.4, reach: 0, power: 2 };

const DOWN = new THREE.Vector3(0, -1, 0);

export function rising(ctx: Ctx, p: P): void {
  const f = frame(ctx, p.reach);
  ctx.handle.emit('cast');
  ctx.after(p.windup, () => ctx.handle.emit('release'));
  const lift = f.fwd.clone().multiplyScalar(0.3).add(UP).normalize();
  swing(ctx, f, { roll: p.roll, mirror: p.mirror >= 0.5, a0: -p.sweep / 2, a1: p.sweep / 2, windup: p.windup, dur: p.dur, lag: p.lag, sparks: p.sparks, lean: [0.3, -0.2], push: lift, onHit: (_i, t) => {
    strike(ctx, f, t, p.power, { push: lift, extra: p.power >= 1.5 });
    const at = ctx.to();
    ctx.emitShape('spark', 40, { type: 'sphere', at, r: 0.2 }, { v: () => UP.clone().multiplyScalar(5 + Math.random() * 5).add(randomDir().multiplyScalar(1.5)), life: [0.2, 0.45], size: [0.01, 0.02], gravity: 6, stretch: 0.05, colors: ctx.cols('core', 'main'), bright: 2.6 * ctx.B, fadeIn: 0 });
    ctx.lines(at.clone().add(new THREE.Vector3(0, 0.6, 0)), { size: 1.6 * ctx.scale, parallel: Math.PI / 2, dur: 0.25, count: 14, width: 0.25, bright: 1.1 });
  } });
}
rising.defaults = { windup: 0.14, dur: 0.17, sweep: 190, roll: 65, mirror: 0, reach: 0, lag: 0.6, power: 1.3, sparks: 1 };

export function cleave(ctx: Ctx, p: P): void {
  const f = frame(ctx, p.reach);
  ctx.handle.emit('cast');
  ctx.after(p.windup, () => ctx.handle.emit('release'));
  const end = swing(ctx, f, { roll: 90, a0: 165, a1: -25, windup: p.windup, dur: p.dur, lag: 0.5, ease: ease.inQuad, step: 0.5, lean: [-0.3, 0.45], sparks: 1.3, onHit: () => {} });
  ctx.after(end - p.dur * 0.15, () => {
    ctx.part('hit');
    const t = ctx.to();
    ctx.crescent(t, 1.6 * ctx.scale, Math.PI / 2, { hold: p.split + 0.25, bend: 0.04, from: f.pivot });
    ctx.hit(t, 0.6 * p.power, 'first', DOWN);
    ctx.burst(t, { count: 40, dir: f.fwd, scale: 0.6 });
    const g = ctx.ground(t.clone().addScaledVector(f.fwd, -0.4));
    ctx.decal(g, 1.2, 4);
    ctx.dust(g, 0.9);
    ctx.after(p.split, () => {
      ctx.crescent(t, 1.9 * ctx.scale, Math.PI / 2, { hold: 0.22, bend: 0, from: f.pivot });
      ctx.impact(t, { power: p.power, dir: f.fwd, push: DOWN, ringNormal: 'camera', scale: 1, extra: true, role: 'final' });
    });
  });
}
cleave.defaults = { windup: 0.3, dur: 0.12, split: 0.18, reach: 0, power: 1.8 };

export function combo(ctx: Ctx, p: P): void {
  const f = frame(ctx, p.reach);
  ctx.handle.emit('cast');
  ctx.after(p.windup, () => ctx.handle.emit('release'));
  const light = (i: number) => (_n: number, t: THREE.Vector3) => strike(ctx, f, t, p.power * 0.55, { scale: 0.6, mark: 1.5, role: i === 0 ? 'first' : 'link' });
  const one = swing(ctx, f, { roll: 10, a0: 85, a1: -85, windup: p.windup, dur: p.dur, lag: 0.5, step: 0.2, onHit: light(0) });
  const two = swing(ctx, f, { roll: 25, mirror: true, a0: -85, a1: 85, windup: 0.04, dur: p.dur, lag: 0.5, delay: one + p.gap, step: 0.2, glint: false, lean: [0.2, -0.05], onHit: light(1) });
  swing(ctx, f, { roll: 80, a0: 160, a1: -35, windup: 0.12, dur: p.dur * 0.9, lag: 0.55, delay: two + p.gap, step: 0.4, glint: false, ease: ease.inQuad, lean: [-0.3, 0.45], sparks: 1.4, onHit: (_n, t) => strike(ctx, f, t, p.power, { extra: true, push: f.fwd.clone().add(DOWN).normalize(), role: 'final' }) });
}
combo.defaults = { windup: 0.1, dur: 0.13, gap: 0.06, reach: 0, power: 1.6 };

function flyingArc(ctx: Ctx, o: { pivot: THREE.Vector3; e1: THREE.Vector3; e2: THREE.Vector3; radius: number; span: number; dir: THREE.Vector3; dist: number; speed: number; arrive: () => void }): void {
  const prim = ctx.fx.prims.acquire('arc');
  const half = (o.span / 2) * DEG;
  arcGeometry(prim.mesh.geometry, o.pivot, o.e1, o.e2, half, -half, o.radius * 0.72, o.radius);
  prim.u.core.value.copy(ctx.pal.core);
  prim.u.main.value.copy(ctx.pal.main);
  prim.u.accent.value.copy(ctx.pal.accent);
  prim.u.bright.value = 3.4 * ctx.B;
  prim.u.seed.value = Math.random() * 50;
  prim.u.lag.value = 1.05;
  prim.u.head.value = 1;
  prim.mesh.position.set(0, 0, 0);
  const travel = o.dist / o.speed;
  const total = travel + 0.25;
  let arrived = false;
  const tipAt = (a: number) => o.pivot.clone().add(prim.mesh.position).addScaledVector(o.e1, Math.cos(a) * o.radius).addScaledVector(o.e2, Math.sin(a) * o.radius);
  let prev = tipAt(0);
  ctx.live(prim, total, (_k, age) => {
    prim.u.time.value = age;
    const d = Math.min(age * o.speed, o.dist + 1.5);
    prim.mesh.position.copy(o.dir).multiplyScalar(d);
    prim.u.fade.value = age < travel ? 1 : Math.max(1 - (age - travel) / 0.25, 0);
    const head = tipAt(0);
    ctx.handle.head.copy(head);
    const dt = 1 / 60;
    ctx.emit('spark', 3, { p: () => tipAt((Math.random() - 0.5) * 2 * half), v: () => o.dir.clone().multiplyScalar(-2).add(randomDir()), life: [0.1, 0.25], size: [0.01, 0.018], stretch: 0.03, colors: ctx.cols('core', 'main'), bright: 2.4 * ctx.B, fadeIn: 0 });
    ctx.trail(head, prev, o.dir.clone().multiplyScalar(o.speed), dt, 0.7);
    prev = head;
    if (!arrived && age >= travel) {
      arrived = true;
      o.arrive();
    }
  });
}

export function wave(ctx: Ctx, p: P): void {
  const f = frame(ctx, 1.6);
  ctx.handle.emit('cast');
  ctx.after(p.windup, () => ctx.handle.emit('release'));
  const end = swing(ctx, f, { roll: p.roll, a0: 90, a1: -90, windup: p.windup, dur: p.dur, lag: 0.5, step: 0.3, onHit: () => {} });
  ctx.after(end - p.dur * 0.4, () => {
    ctx.part('fly');
    const roll = p.roll * DEG;
    const e2 = f.right.clone().multiplyScalar(Math.cos(roll)).addScaledVector(UP, Math.sin(roll));
    const pivot = f.pivot.clone().add(ctx.handle.body.offset).addScaledVector(f.fwd, -0.4 * p.size);
    const target = ctx.to();
    const dir = target.clone().sub(pivot).setY(0).normalize();
    const dist = Math.max(target.clone().sub(pivot).setY(0).length() - 1.2 * p.size, 0.3);
    flyingArc(ctx, { pivot, e1: dir, e2, radius: 1.5 * p.size * ctx.scale, span: 120, dir, dist, speed: p.speed, arrive: () => {
      ctx.part('hit');
      strike(ctx, f, e2.clone().negate(), p.power, { mark: 0, extra: p.power >= 1.5 });
    } });
  });
}
wave.defaults = { windup: 0.1, dur: 0.12, roll: 20, speed: 14, size: 1, power: 1.3 };

export function dash(ctx: Ctx, p: P): void {
  const f = frame(ctx, 1.4);
  const blade = ctx.handle.blade;
  const body = ctx.handle.body;
  const target = ctx.to();
  const travel = f.dist + p.over;
  const low = f.fwd.clone().multiplyScalar(-0.5).add(f.right.clone().multiplyScalar(0.6)).add(DOWN.clone().multiplyScalar(0.35)).normalize();
  const hold = () => {
    blade.base.copy(f.pivot).add(body.offset).addScaledVector(low, 0.35);
    blade.tip.copy(f.pivot).add(body.offset).addScaledVector(low, 1.4);
  };
  ctx.handle.emit('cast');
  ctx.part('cast');
  blade.active = true;
  ctx.during(0, p.charge, (k) => {
    body.lean = 0.35 * ease.inOutQuad(k);
    body.offset.copy(f.fwd).multiplyScalar(-0.15 * k);
    hold();
  });
  ctx.after(p.charge * 0.7, () => ctx.star(f.pivot.clone().addScaledVector(low, 1.4), 0.6 * ctx.scale, 0.18, 2.5));
  ctx.after(p.charge, () => {
    ctx.handle.emit('release');
    ctx.part('swing');
    const start = ctx.from().add(body.offset).setY(ctx.floor + 0.05);
    ctx.dust(start, 0.8);
    let hit = false;
    const prev = blade.tip.clone();
    ctx.during(0, p.dash, (k, dt) => {
      body.offset.copy(f.fwd).multiplyScalar(-0.15 + (travel + 0.15) * ease.outQuint(k));
      body.lean = 0.45;
      hold();
      const v = dt > 0 ? blade.tip.clone().sub(prev).divideScalar(dt) : new THREE.Vector3();
      ctx.trail(blade.tip, prev, v, dt * 0.6, 0.6);
      ctx.emit('spark', poisson(400 * dt), { p: () => blade.base.clone().lerp(blade.tip, Math.random()), v: () => f.fwd.clone().multiplyScalar(-3).add(randomDir()), life: [0.1, 0.25], size: [0.01, 0.018], stretch: 0.04, colors: ctx.cols('core', 'main'), bright: 2.4 * ctx.B, fadeIn: 0 });
      prev.copy(blade.tip);
      if (!hit && body.offset.length() >= f.dist - 0.3) {
        hit = true;
        ctx.part('hit');
        ctx.crescent(target, 2 * ctx.scale, screenAngle(ctx, target, f.fwd), { hold: p.delay + 0.2, bend: 0.05, from: f.pivot });
        ctx.hit(target, 0.5, 'first');
        ctx.part('swing');
      }
    }, () => {
      const end = ctx.from().add(body.offset).setY(ctx.floor + 0.05);
      ctx.dust(end, 1);
      ctx.lines(start.clone().lerp(end, 0.5).setY(target.y), { size: travel * 0.5, parallel: screenAngle(ctx, target, f.fwd), dur: 0.25, count: 20, width: 0.35, bright: 1.2 });
      ctx.after(p.delay, () => {
        ctx.part('hit');
        ctx.screenFlash(0.3);
        ctx.impact(target, { power: p.power, dir: f.fwd, ringNormal: 'camera', scale: 1.1, extra: true, role: 'final' });
        blade.active = false;
        const held = body.offset.clone();
        ctx.during(0.15, 0.3, (k) => {
          body.offset.copy(held).multiplyScalar(1 - ease.inOutQuad(k));
          body.lean = 0.45 * (1 - k);
        });
      });
    });
  });
}
dash.defaults = { charge: 0.18, dash: 0.14, over: 1.4, delay: 0.25, power: 1.7 };

export function flurry(ctx: Ctx, p: P): void {
  const f = frame(ctx, p.reach);
  const n = Math.max(3, Math.round(p.count));
  ctx.handle.emit('cast');
  ctx.after(p.windup, () => ctx.handle.emit('release'));
  let t = 0;
  for (let i = 0; i < n; i++) {
    const roll = 20 + Math.random() * 70;
    const mirror = Math.random() < 0.5;
    const up = Math.random() < 0.3;
    t = swing(ctx, f, { roll, mirror, a0: up ? -70 : 70, a1: up ? 70 : -70, windup: i === 0 ? p.windup : 0.01, dur: p.dur, lag: 0.45, delay: t + (i === 0 ? 0 : p.gap), step: 0.15, glint: i === 0, sparks: 0.7, onHit: (_n, tg) => {
      const at = ctx.to().add(randomDir().multiplyScalar(0.25));
      ctx.crescent(at, (1.4 + Math.random() * 0.6) * ctx.scale, screenAngle(ctx, at, tg), { hold: 0.2, bend: 0.25, from: f.pivot, tangent: tg });
      ctx.burst(at, { count: 14, dir: f.fwd, scale: 0.4 });
      ctx.hit(at, 0.35, i === 0 ? 'first' : 'tick');
    } });
  }
  swing(ctx, f, { roll: 85, a0: 165, a1: -30, windup: 0.14, dur: p.dur * 2, lag: 0.55, delay: t + 0.05, step: 0.45, glint: true, ease: ease.inQuad, lean: [-0.3, 0.45], sparks: 1.4, onHit: (_n, tg) => strike(ctx, f, tg, p.power, { extra: true, role: 'final', push: f.fwd.clone().add(DOWN).normalize() }) });
}
flurry.defaults = { windup: 0.12, count: 8, dur: 0.06, gap: 0.015, reach: 0, power: 1.6 };
