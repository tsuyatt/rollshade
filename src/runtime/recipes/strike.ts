import * as THREE from 'three/webgpu';
import { clamp01, ease, poisson, span, type Ctx } from '../ctx';
import { randomDir } from '../particles';

const UP = new THREE.Vector3(0, 1, 0);

type P = Record<string, number>;

function frame(ctx: Ctx) {
  const from = ctx.from();
  const to = ctx.to();
  const aim = to.clone().sub(from).setY(0);
  if (aim.lengthSq() < 1e-6) aim.set(1, 0, 0);
  aim.normalize();
  const side = aim.clone().cross(UP).normalize();
  return { from, to, aim, side };
}

export function strike(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const B = ctx.B * ctx.glare;
  const hits = Math.max(1, Math.round(p.hits));
  const gap = 0.16;
  ctx.part('swing');
  ctx.handle.emit('cast');
  const { aim, side } = frame(ctx);
  const fistAt = (k: number) => {
    const c = ctx.from();
    const back = c.clone().addScaledVector(aim, -0.2).addScaledVector(side, 0.28).add(new THREE.Vector3(0, 0.05, 0));
    const hit = ctx.to().addScaledVector(aim, -0.3);
    return back.lerp(hit, k);
  };
  const charge = ctx.hold(4);
  const body = ctx.handle.body;
  body.limb = 'fist';
  ctx.during(0, p.windup, (k, dt) => {
    const f = fistAt(0);
    ctx.handle.head.copy(f);
    body.lean = -0.15 * k;
    body.turn = 0.35 * k;
    if (Math.random() < dt * 30) ctx.glow(f, (0.15 + 0.3 * ease.inQuad(k)) * s, 0.08, 1 + 1.5 * k);
    ctx.emitShape('spark', poisson(60 * dt * k), { type: 'sphere', at: f, r: 0.5 * s }, { hook: ctx.hook({ seek: { target: f, speed: 4, steer: 8, arrive: 0.05 } }), v: () => new THREE.Vector3(), life: 0.4, size: [0.01, 0.018], stretch: 0.05, colors: ctx.cols('core', 'main'), bright: 2.4 * B, alphaCurve: 'hold' });
    charge.set(f, 30 * k);
  }, () => charge.release(0.1));
  ctx.dust(ctx.ground(ctx.from()), 0.35 * s);
  for (let i = 0; i < hits; i++) {
    const last = i === hits - 1;
    const t0 = p.windup + i * gap;
    const travel = last ? 0.07 : 0.05;
    const pw = last ? p.power : p.power * 0.55;
    ctx.after(t0, () => {
      ctx.part('swing');
      if (i === 0) ctx.handle.emit('release');
      const start = fistAt(0.35);
      const end = fistAt(1);
      const ang = ctx.screenAngle(start, aim);
      ctx.lines(start.clone().lerp(end, 0.5), { size: 1.4 * s, parallel: ang, dur: 0.2, count: 16, width: 0.3, bright: 1.2 });
      ctx.during(0, travel, (k, dt) => {
        const f = start.clone().lerp(end, ease.outExpo(k));
        ctx.handle.head.copy(f);
        body.lean = 0.3 * ease.outExpo(k);
        body.turn = (i % 2 ? 0.3 : -0.3) * ease.outExpo(k);
        body.offset.copy(aim).multiplyScalar(0.3 * ease.outExpo(k));
        ctx.emit('glow', 1, { p: f, speed: 0, life: 0.06, size: (last ? 0.45 : 0.3) * s, colors: ctx.cols('core', 'main'), bright: 1.4 * B, fadeIn: 0 });
        ctx.emit('spark', poisson(300 * dt), { p: f, jitter: 0.08 * s, v: () => aim.clone().multiplyScalar(-2).add(randomDir().multiplyScalar(1.5)), life: [0.08, 0.16], size: [0.012, 0.02], stretch: 0.05, colors: ctx.cols('core', 'main'), bright: 2.6 * B, fadeIn: 0 });
      }, () => {
        ctx.part('hit');
        if (last)
          ctx.during(0.2, 0.35, (k) => {
            body.lean = 0.3 * (1 - k);
            body.turn = (i % 2 ? 0.3 : -0.3) * (1 - k);
            body.offset.copy(aim).multiplyScalar(0.3 * (1 - k));
            if (k >= 1) body.limb = null;
          });
        const at = ctx.to().addScaledVector(aim, -0.25);
        ctx.impact(at, { power: pw, dir: aim, ringNormal: aim, scale: (last ? 0.8 : 0.5) * p.size, extra: last && p.power >= 1.4, role: last && hits > 1 ? 'final' : undefined });
        ctx.band(at.clone().addScaledVector(aim, 0.2), { radius: (last ? 1.4 : 0.8) * s, inner: 0.78, normal: aim, hard: 0.8, noise: 1, dur: 0.3, grow: (k) => 0.2 + 0.8 * ease.outExpo(k) });
        if (!last) return;
        ctx.lathe(at, { profile: 'cone', axis: aim, radius: 0.18 * p.size, top: p.cone * 1.1 * p.size, height: 2.6 * p.cone * p.size, flow: -6, tiles: [7, 1.5], streak: 1, rim: 0.7, fadeLo: 0.05, fadeHi: 0.5, dur: 0.32, bright: 1.3, grow: (k) => [1, 0.3 + 0.7 * ease.outExpo(clamp01(k * 3))], erode: (k) => ease.inQuad(span(k, 0.3, 1)), edge: 0.1 });
        for (let j = 1; j <= 2; j++) ctx.band(at.clone().addScaledVector(aim, 0.6 * j * p.cone), { radius: (0.6 + 0.4 * j) * p.cone * s, inner: 0.82, normal: aim, hard: 0.6, noise: 1, dur: 0.28, delay: 0.03 * j });
        ctx.wave(at, 1.4 * p.cone, 0.35, 1.2);
        const g = ctx.ground(at);
        ctx.emitShape('smoke', 14 * s, { type: 'circle', at: g.clone().setY(g.y + 0.05), r: 0.3 * s }, { outward: [2, 4], v: () => aim.clone().multiplyScalar(2.5), life: [0.5, 0.9], size: [0.2 * s, 0.35 * s], grow: 2.4, drag: 3.5, sizeCurve: 'burst', colors: [ctx.pal.smoke ?? new THREE.Color(0.3, 0.28, 0.25), new THREE.Color(0.3, 0.28, 0.25)], fadeIn: 0.03 });
      });
    });
  }
}
strike.defaults = { windup: 0.18, hits: 2, power: 1.5, size: 1, cone: 0.9, anime: 0 };

export function shockwave(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const B = ctx.B * ctx.glare;
  const count = Math.max(1, Math.round(p.count));
  ctx.part('cast');
  ctx.handle.emit('cast');
  ctx.circle(ctx.ground(ctx.from()), 1.2 * ctx.scale, p.charge + 0.3, { slot: 'feet', spin: 1.4, bright: 1.4 });
  ctx.charge(ctx.from(), p.charge, { radius: 0.5 });
  const span0 = (p.span * Math.PI) / 180;
  for (let i = 0; i < count; i++) {
    const t0 = p.charge + i * 0.22;
    ctx.after(t0, () => {
      ctx.part('cast');
      if (i === 0) ctx.handle.emit('release');
      const { from, aim, side } = frame(ctx);
      const tilt = count > 1 ? (i - (count - 1) / 2) * 0.35 : 0;
      const up = UP.clone().applyAxisAngle(aim, tilt);
      const normal = aim.clone().cross(up).normalize();
      const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(aim, normal.clone().cross(aim).normalize(), normal));
      const R = 1.35 * s;
      const pivot = from.clone().addScaledVector(side, 0.25);
      const sweepSide = i % 2 === 0 ? 1 : -1;
      ctx.arc({ pivot, e1: aim.clone(), e2: up.clone().multiplyScalar(sweepSide), a0: -1.2, a1: 1.2, r0: 0.35 * s, r1: 1.05 * s, dur: 0.1, ease: ease.slash, lag: 0.6, hold: 0.06 });
      ctx.ring(from, 0.5 * s, { normal: aim, dur: 0.2, thick: 0.1 });
      ctx.wave(from, 0.8, 0.3, 0.6);
      ctx.part('fly');
      const dist = Math.max(from.distanceTo(ctx.to()), 0.5);
      const dur = dist / p.speed;
      const head = new THREE.Vector3();
      const at = () => head.clone().addScaledVector(aim, -R * 0.8);
      const k01 = (k: number) => span(k, 0.9, 1);
      const hold = (k: number) => 0.55 + 0.45 * ease.outExpo(clamp01(k * 6));
      ctx.band(from, { radius: R, inner: 0.72, a0: -span0 / 2, span: span0, fadeS: 0.3, fadeE: 0.3, hard: 0.75, noise: 1, dur, quat, at, kFn: k01, grow: hold, bright: 2 });
      ctx.band(from, { radius: R * 0.98, inner: 0.9, a0: -span0 * 0.4, span: span0 * 0.8, fadeS: 0.35, fadeE: 0.35, hard: 1, noise: 0.5, dur, quat, at, kFn: k01, grow: hold, colors: ['core', 'core', 'main'], bright: 2.4 });
      ctx.band(from, { radius: R * 1.25, inner: 0.85, a0: -span0 * 0.35, span: span0 * 0.7, fadeS: 0.4, fadeE: 0.4, hard: 0, noise: 1, dur, quat, at: () => at().addScaledVector(aim, -0.25 * s), kFn: k01, grow: hold, colors: ['main', 'accent', 'accent'], bright: 1.2 });
      const ang = ctx.screenAngle(from, aim);
      ctx.fly({
        from,
        to: () => from.clone().addScaledVector(aim, dist),
        dur,
        step: (h, prev, vel, dt) => {
          head.copy(h);
          const back = aim.clone().multiplyScalar(-1);
          ctx.emitShape('spark', poisson(160 * dt), { type: 'circle', at: h.clone().addScaledVector(aim, -R * 0.15), r: R * 0.85, axis: normal, arc: [Math.PI - span0 * 0.4, Math.PI + span0 * 0.4] }, { v: () => back.clone().multiplyScalar(3 + Math.random() * 3), life: [0.12, 0.25], size: [0.012 * s, 0.02 * s], stretch: 0.05, drag: 3, colors: ctx.cols('core', 'main'), bright: 2.6 * B, fadeIn: 0 });
          ctx.trail(h, prev, vel, dt, 0.8 * s, 0.6);
          const g = ctx.ground(h);
          if (ctx.heightAboveFloor(h) < 1.8) ctx.emit('smoke', poisson(40 * dt), { p: g.clone().setY(g.y + 0.05), jitter: 0.25, v: () => aim.clone().multiplyScalar(1.5).add(side.clone().multiplyScalar((Math.random() - 0.5) * 3)).setY(0.4), life: [0.5, 0.8], size: [0.18 * s, 0.3 * s], grow: 2.2, drag: 3, colors: [ctx.pal.smoke ?? new THREE.Color(0.3, 0.28, 0.25), new THREE.Color(0.3, 0.28, 0.25)], fadeIn: 0.03 });
          if (Math.random() < dt * 10) ctx.lines(h.clone().addScaledVector(aim, -0.6 * s), { size: 1.6 * s, parallel: ang, dur: 0.18, count: 14, width: 0.25, bright: 0.9 });
        },
        arrive: (b) => {
          ctx.part('hit');
          ctx.impact(ctx.to(), { power: p.power / Math.sqrt(count), dir: aim, ringNormal: aim, scale: 0.9 * p.size, extra: i === count - 1 && p.power >= 1.4, role: count > 1 && i === count - 1 ? 'final' : undefined });
          ctx.band(b, { radius: 1.6 * s, inner: 0.8, normal: aim, hard: 0.7, noise: 1, dur: 0.35 });
        },
      });
    });
  }
}
shockwave.defaults = { circleFeet: 1, charge: 0.25, count: 1, speed: 13, span: 130, size: 1, power: 1.3, anime: 0 };
