import * as THREE from 'three/webgpu';
import { clamp01, ease, poisson, span, type Ctx } from '../ctx';
import { randomDir } from '../particles';

const UP = new THREE.Vector3(0, 1, 0);

type P = Record<string, number>;

function aimOf(ctx: Ctx): THREE.Vector3 {
  const d = ctx.to().sub(ctx.from()).setY(0);
  return d.lengthSq() > 1e-6 ? d.normalize() : new THREE.Vector3(1, 0, 0);
}

const payloadKind: Record<string, 'spear' | 'core' | 'boulder' | 'void'> = { fire: 'core', earth: 'boulder', dark: 'void', poison: 'core' };

export function summon(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const B = ctx.B * ctx.glare;
  const R = p.radius * s;
  const aim = aimOf(ctx);
  const side = aim.clone().cross(UP).normalize();
  ctx.part('cast');
  ctx.charge(ctx.from(), 0.3, { radius: 0.45, aim, ground: ctx.from() });
  const gate = Math.round(p.gate) % 3;
  const target = ctx.to();
  const tg = ctx.ground(target);
  let center: THREE.Vector3;
  let axis: THREE.Vector3;
  if (gate === 0) {
    center = ctx.from().addScaledVector(aim, -1.2).addScaledVector(side, 0.6).setY(target.y + 1.6 * s);
    axis = target.clone().sub(center).normalize();
  } else if (gate === 1) {
    center = target.clone().addScaledVector(aim, -1.3).setY(target.y + 2.6 * s);
    axis = target.clone().sub(center).normalize();
  } else {
    center = tg.clone().addScaledVector(aim, -0.2).setY(tg.y + 0.03);
    axis = UP.clone();
  }
  const open = 0.3;
  const openDur = 0.45;
  const charge = p.charge;
  const fire = open + openDur + charge;
  const flight = Math.max(center.distanceTo(target) / p.speed, 0.12);
  const close = fire + flight + 0.25;
  const life = close + 0.3 - open;
  ctx.part('main');
  const scaleAt = (age: number) => {
    const t = age;
    let k = ease.outBackStrong(clamp01(t / openDur));
    if (t > fire - open - 0.07 && t < fire - open) k *= 0.9;
    if (t > close - open) k *= 1 - ease.inCubic(clamp01((t - (close - open)) / 0.3));
    return Math.max(k, 0.001);
  };
  const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
  ctx.after(open, () => {
    ctx.circle(center, 2.2 * R, life, { normal: axis, spin: 1.2, bright: 1.6, style: 1 });
    ctx.band(center, { radius: 1.15 * R, inner: 0.82, quat, dur: life, noise: 1, hard: 0.4, spin: 3, grow: (k) => scaleAt(k * life), kFn: (k) => span(k, 0.85, 1), bright: 2.2 });
    const lathe = { at: () => center, axis, dur: life, grow: (k: number) => scaleAt(k * life), fade: (k: number) => 1 - span(k, 0.9, 1) };
    ctx.lathe(center, { ...lathe, profile: 'cone', radius: R, top: 0.05 * R, height: 0.06, smoke: true, colors: ['main', 'smoke', 'smoke'], twist: 4, flow: -1.5, tiles: [5, 1], streak: 0.6, rim: 0, fadeLo: 0.001, fadeHi: 0.001, bright: 0.5, turnRate: () => 3 });
    ctx.lathe(center, { ...lathe, profile: 'cone', radius: R, top: 0.1 * R, height: 0.08, twist: 5, flow: -2.2, tiles: [6, 1.2], streak: 0.8, rim: 0, fadeLo: 0.02, fadeHi: 0.3, bright: 1.4, turnRate: (k) => 4 + 10 * span(k * life, close - open - 0.1, close - open + 0.3) });
    ctx.wave(center, 1.8 * R, 0.4, 1);
    ctx.light(center, 2, 0.4);
  });
  ctx.during(open + openDur * 0.5, charge + openDur * 0.5, (k, dt) => {
    ctx.emitShape('spark', poisson(160 * dt), { type: 'circle', at: center, r: 1.9 * R, axis }, { hook: ctx.hook({ seek: { target: center, speed: 5 * R + 2, steer: 7, arrive: 0.12 } }), tangent: 2, life: 0.8, size: [0.012, 0.022], stretch: 0.06, colors: ctx.cols('core', 'main'), bright: 2.4 * B, alphaCurve: 'hold' });
    if (Math.random() < dt * 25) ctx.glow(center, (0.3 + 0.9 * ease.inQuad(k)) * R, 0.1, 1 + 2 * k);
  });
  ctx.after(fire, () => {
    ctx.part('main');
    ctx.handle.emit('release');
    ctx.star(center, 1.8 * R, 0.14, 3);
    ctx.wave(center, 2.2 * R, 0.35, 1.3);
    const back = axis.clone().negate();
    ctx.emit('shard', 24, { p: center, jitter: 0.2 * R, v: () => back.clone().add(randomDir().multiplyScalar(0.8)).multiplyScalar(3 + Math.random() * 3), life: [0.3, 0.6], size: [0.04, 0.08], drag: 2, spin: [-10, 10], colors: ctx.cols('core', 'main'), bright: 2 * B, fadeIn: 0 });
    ctx.emit('spark', 50, { p: center, jitter: 0.2 * R, v: () => back.clone().add(randomDir().multiplyScalar(0.9)).multiplyScalar(4 + Math.random() * 5), life: [0.2, 0.4], size: [0.012, 0.022], drag: 3, stretch: 0.05, colors: ctx.cols('core', 'main'), bright: 3 * B, fadeIn: 0 });
    ctx.part('hit');
    const head = center.clone();
    const dir = target.clone().sub(center).normalize();
    const kind = payloadKind[ctx.element] ?? 'spear';
    const len = 2.6 * s;
    const tail = (k: number) => {
      const age = k * (flight + 0.4);
      return age < flight ? 1 : 1 - ease.inQuad(clamp01((age - flight) / 0.4));
    };
    if (kind === 'spear' || kind === 'void')
      ctx.lathe(center, { profile: 'cone', axis: dir, at: () => head.clone().addScaledVector(dir, -len), radius: 0.32 * s, top: 0.02, height: len, flow: -5, tiles: [6, 1.4], streak: 0.9, rim: kind === 'void' ? 0.9 : 0.5, fadeLo: 0.35, fadeHi: 0.02, dur: flight + 0.4, bright: 1.8, smoke: kind === 'void', colors: kind === 'void' ? ['core', 'smoke', 'smoke'] : undefined, fade: tail, erode: (k) => ease.inQuad(span(k * (flight + 0.4), flight, flight + 0.4)), edge: 0.12, grow: (k) => [1, 0.2 + 0.8 * ease.outExpo(clamp01((k * (flight + 0.4)) / 0.08))] });
    if (kind === 'boulder') {
      const size = 0.55 * s;
      ctx.fx.rocks.spawn({ p: center.clone(), size: new THREE.Vector3(size, size * 0.85, size), spin: 5, life: flight + 2, grow: 0.08, shrink: 0.2, gravity: 12, bounce: 0.2, color: ctx.pal.main.clone().lerp(new THREE.Color(0.35, 0.3, 0.26), 0.6).multiplyScalar(0.32), drive: (pp, v, age, dt) => {
        if (age >= flight) return false;
        const prev = pp.clone();
        pp.copy(head);
        if (dt > 0) v.subVectors(pp, prev).divideScalar(dt);
        return true;
      } });
    }
    const ribbon = ctx.ribbon(0.5 * s);
    const prev = center.clone();
    ctx.during(0, flight, (k, dt) => {
      head.copy(center).lerp(target, ease.outQuad(k));
      ctx.handle.head.copy(head);
      const vel = head.clone().sub(prev).divideScalar(Math.max(dt, 1e-4));
      ctx.emit('glow', 1, { p: head, speed: 0, life: 0.06, size: (kind === 'core' ? 1.3 : 0.7) * s, colors: ctx.cols('core', 'main'), bright: 1.4 * B, fadeIn: 0 });
      if (kind === 'core') ctx.emit(ctx.element === 'fire' ? 'flame' : 'smoke', poisson(140 * dt), { p: head, jitter: 0.25 * s, v: () => vel.clone().multiplyScalar(-0.1).add(randomDir()), life: [0.25, 0.45], size: [0.35 * s, 0.55 * s], grow: 1.4, colors: ctx.element === 'fire' ? ctx.cols('core', 'main', 'accent') : [ctx.pal.smoke!.clone().lerp(ctx.pal.main, 0.4), ctx.pal.smoke!], bright: 1.4 * B, fadeIn: 0.02 });
      ctx.trail(head, prev, vel, dt, 1.4 * s, 1.5);
      ribbon.trail.push(head);
      prev.copy(head);
    }, () => {
      ribbon.release(0.2);
      ctx.impact(target, { power: p.power, dir, ringNormal: dir, scale: 1.3 * p.size, extra: true });
      ctx.band(tg.clone().setY(tg.y + 0.03), { radius: 2.4 * s, inner: 0.7, dur: 0.6, noise: 1 });
      if (kind === 'boulder') ctx.rocks(target, 14, 1.2 * s, () => randomDir().setY(Math.random() * 1.5).multiplyScalar(5));
    });
  });
  ctx.after(close, () => {
    ctx.part('main');
    ctx.during(0, 0.3, (_k, dt) => ctx.emitShape('mote', poisson(120 * dt), { type: 'circle', at: center, r: 1.3 * R, axis }, { hook: ctx.hook({ seek: { target: center, speed: 5, steer: 9, arrive: 0.1 } }), life: 0.4, size: [0.02, 0.035], colors: ctx.cols('core', 'main'), bright: 2.2 * B, alphaCurve: 'hold' }), () => {
      ctx.star(center, 0.7 * s, 0.12, 2.5);
      ctx.glow(center, 0.5 * s, 0.15, 2);
    });
  });
}
summon.defaults = { circleFeet: 1, circleHand: 1, gate: 0, radius: 0.9, charge: 0.4, speed: 16, size: 1, power: 1.8 };

export function warp(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const B = ctx.B * ctx.glare;
  const aim = aimOf(ctx);
  const A = ctx.ground(ctx.from());
  const Bp = ctx.ground(ctx.to()).addScaledVector(aim, -p.offset);
  Bp.y = A.y;
  const h = 2.1 * s;
  const r = 0.5 * s;
  ctx.part('cast');
  ctx.handle.emit('cast');
  ctx.band(A.clone().setY(A.y + 0.03), { radius: 1.1 * s, inner: 0.75, dur: p.charge + 0.5, noise: 1, grow: (k) => ease.outExpo(clamp01(k * 4)), kFn: (k) => span(k, 0.6, 1) });
  ctx.circle(A, 1.2 * ctx.scale, p.charge + 0.35, { slot: 'feet', spin: 2, bright: 1.4 });
  ctx.during(0, p.charge, (_k, dt) => {
    ctx.emitShape('mote', poisson(90 * dt), { type: 'body', at: A, r: 0.9 * s, h }, { hook: ctx.hook({ fields: [{ kind: 'attract', power: 6, at: A.clone().setY(A.y + h * 0.5), shape: 'tube', max: 3 }] }), v: () => new THREE.Vector3(0, 0.8, 0), life: [0.3, 0.5], size: [0.02, 0.035], colors: ctx.cols('core', 'main'), bright: 2.2 * B });
  });
  const column = (at: THREE.Vector3, appear: boolean) => {
    const dur = appear ? 0.4 : 0.3;
    ctx.lathe(at, {
      profile: 'cylinder',
      radius: r,
      top: r * 0.9,
      height: h * 1.2,
      flow: appear ? -3 : 3,
      tiles: [8, 1],
      streak: 1,
      rim: 0.7,
      fadeLo: 0.05,
      fadeHi: 0.4,
      dur,
      bright: 1.8,
      grow: (k) => {
        const t = k * dur;
        if (appear) {
          const w = t < 0.12 ? 0.05 : ease.outBackStrong(clamp01((t - 0.12) / 0.14)) * (1 - ease.inCubic(span(t, 0.26, dur)));
          return [Math.max(w, 0.02), ease.outExpo(clamp01(t / 0.1))];
        }
        const w = 1 - ease.inCubic(clamp01(t / 0.12));
        return [Math.max(w, 0.02), t < 0.12 ? 1 : 1 - ease.inCubic(clamp01((t - 0.12) / 0.12))];
      },
    });
  };
  ctx.after(p.charge, () => {
    ctx.handle.emit('release');
    ctx.handle.emit('vanish', { point: A.clone() });
    const c = A.clone().setY(A.y + h * 0.5);
    ctx.glow(c, 1.2 * s, 0.12, 2);
    column(A, false);
    ctx.wave(c, 1.2, 0.3, 0.8);
    ctx.emitShape('mote', 40, { type: 'body', at: A, r: 0.5 * s, h }, { v: () => new THREE.Vector3(0, 1.5 + Math.random() * 2, 0), life: [0.4, 0.8], size: [0.02, 0.04], alphaCurve: 'hold', drag: 1, colors: ctx.cols('core', 'main'), bright: 2.4 * B });
    ctx.emit('spark', 30, { p: c, v: () => randomDir().multiplyScalar(3 + Math.random() * 3), life: [0.15, 0.3], size: [0.012, 0.02], drag: 3, stretch: 0.04, colors: ctx.cols('core', 'main'), bright: 3 * B, fadeIn: 0 });
    ctx.band(A.clone().setY(A.y + 0.03), { radius: 1.3 * s, inner: 0.8, dur: 0.45, delay: 0.1, noise: 1, grow: (k) => 1 - 0.3 * k });
    const c2 = Bp.clone().setY(Bp.y + h * 0.5);
    const travel = p.travel;
    ctx.part('main');
    if (ctx.element === 'thunder') ctx.bolt(c, c2, { dur: travel + 0.15, width: 0.12 * s, jag: 0.08, branches: 2 });
    else {
      const ribbon = ctx.ribbon(0.25 * s);
      const hd = c.clone();
      ctx.during(0, travel, (k) => {
        hd.copy(c).lerp(c2, ease.inOutCubic(k));
        ribbon.trail.push(hd);
        ctx.emit('glow', 1, { p: hd, speed: 0, life: 0.08, size: 0.4 * s, colors: ctx.cols('core', 'main'), bright: 1.6 * B, fadeIn: 0 });
      }, () => ribbon.release(0.2));
    }
    const conv = Math.max(travel - 0.02, 0.05);
    ctx.after(Math.max(travel - 0.12, 0), () => {
      ctx.emitShape('spark', 50, { type: 'sphere', at: c2, r: 1.1 * s }, { hook: ctx.hook({ seek: { target: c2, speed: 9, steer: 12, arrive: 0.1 } }), v: () => new THREE.Vector3(), life: 0.5, size: [0.012, 0.022], stretch: 0.05, colors: ctx.cols('core', 'main'), bright: 2.6 * B, alphaCurve: 'hold' });
    });
    ctx.after(conv, () => column(Bp, true));
    ctx.after(conv + 0.12, () => {
      ctx.handle.emit('appear', { point: Bp.clone() });
      ctx.glow(c2, 1.6 * s, 0.16, 2.2);
      ctx.star(c2, 1.4 * s, 0.14, 2.5);
      ctx.band(Bp.clone().setY(Bp.y + 0.03), { radius: 1.8 * s, inner: 0.7, dur: 0.4, noise: 1, grow: (k) => 0.2 + 0.8 * ease.outCubic(k) });
      ctx.burst(c2, { count: 40, speed: 5, scale: 0.6 * p.size });
      ctx.dust(Bp, 0.6 * s);
      ctx.light(c2, 2.5, 0.35);
      ctx.wave(c2, 1.6, 0.35, 1);
      ctx.emitShape('mote', 30, { type: 'body', at: Bp, r: 0.5 * s, h }, { v: () => new THREE.Vector3(0, 0.6 + Math.random(), 0), life: [0.5, 0.9], size: [0.02, 0.035], alphaCurve: 'bell', colors: ctx.cols('core', 'main'), bright: 2.2 * B });
    });
  });
}
warp.defaults = { circleFeet: 1, charge: 0.25, offset: 1.4, travel: 0.14, size: 1 };

export function missiles(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const B = ctx.B * ctx.glare;
  const count = Math.max(2, Math.round(p.count));
  const aim = aimOf(ctx);
  const side = aim.clone().cross(UP).normalize();
  ctx.part('cast');
  ctx.charge(ctx.from(), p.charge, { radius: 0.5, aim, ground: ctx.from() });
  const fan = (p.fan * Math.PI) / 180;
  const pitch = (p.launch * Math.PI) / 180;
  const base = UP.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(aim, Math.sin(pitch));
  const smokeCol = ctx.pal.smoke ? [ctx.pal.smoke.clone().lerp(ctx.pal.main, 0.12).multiplyScalar(2.6), ctx.pal.smoke.clone().multiplyScalar(1.4)] : null;
  let arrived = 0;
  for (let i = 0; i < count; i++) {
    const order = i % 2 === 0 ? i / 2 : count - 1 - (i - 1) / 2;
    const u = count > 1 ? order / (count - 1) : 0.5;
    const t0 = p.charge + i * p.stagger;
    ctx.after(t0, () => {
      ctx.part('main');
      if (i === 0) ctx.handle.emit('release');
      const from = ctx.from().add(new THREE.Vector3(0, 0.25, 0)).addScaledVector(side, (u - 0.5) * 0.5);
      const a = (u - 0.5) * fan;
      const eject = base.clone().multiplyScalar(Math.cos(a) * 0.8 + 0.5).addScaledVector(side, Math.sin(a) * 1.3).add(randomDir().multiplyScalar(0.15)).normalize();
      const vel = eject.multiplyScalar(11 + Math.random() * 5);
      const head = from.clone();
      const prev = from.clone();
      const dest = ctx.to().add(randomDir().multiplyScalar(0.35));
      const wobble = Math.random() < 0.35 ? 2.5 + Math.random() * 2 : 0;
      const phase = Math.random() * Math.PI * 2;
      const hang = p.hang * (0.7 + Math.random() * 0.6);
      const steerMax = 3 + Math.random() * 2.5;
      const ribbon = ctx.ribbon(0.1 * s);
      const want = new THREE.Vector3();
      const lat = new THREE.Vector3();
      let age = 0;
      let lit = false;
      let speed = vel.length();
      let dist = 0;
      ctx.emit('flare', 1, { p: from, speed: 0, life: 0.12, size: 0.4 * s, colors: ctx.cols('core', 'main'), bright: 1.6 * B, fadeIn: 0 });
      ctx.fx.scheduler.add(
        {
          update: (dt) => {
            if (dt <= 0) return true;
            age += dt;
            const tgt = dest;
            want.subVectors(tgt, head);
            const d = want.length();
            if (age < hang) {
              vel.multiplyScalar(Math.exp(-3.5 * dt));
            } else {
              if (!lit) {
                lit = true;
                ctx.emit('flare', 1, { p: head, speed: 0, life: 0.1, size: 0.35 * s, colors: ctx.cols('core', 'main'), bright: 2 * B, fadeIn: 0 });
              }
              const tt = age - hang;
              speed = Math.min(p.speed, Math.max(speed, 6) + 32 * dt);
              const steer = 0.8 + steerMax * ease.inQuad(clamp01(tt / 1.1));
              want.normalize();
              if (wobble) {
                lat.crossVectors(want, UP).normalize();
                want.addScaledVector(lat, Math.sin(tt * wobble * 6 + phase) * 0.6 * Math.max(0, 1 - tt / 1.2)).normalize();
              }
              want.multiplyScalar(speed);
              vel.lerp(want, Math.min(steer * dt, 1));
            }
            prev.copy(head);
            head.addScaledVector(vel, dt);
            const step = head.distanceTo(prev);
            dist += step;
            const amt = p.smoke;
            if (amt > 0) {
              const spacing = Math.max(0.14 / amt, 0.06);
              const sz = Math.sqrt(amt);
              while (dist > spacing) {
                dist -= spacing;
                const q = prev.clone().lerp(head, 1 - dist / Math.max(step, 1e-5));
                if (smokeCol) ctx.emit('smoke', 1, { p: q, v: () => randomDir().multiplyScalar(0.12).add(new THREE.Vector3(0, 0.15, 0)), life: [0.9, 1.3], size: [0.045 * s * sz, 0.06 * s * sz], grow: 3.2, sizeCurve: 'burst', curl: 0.35, colors: smokeCol, fadeIn: 0.02, fadePow: 2, delay: 0 });
                else ctx.emit('mist', 1, { p: q, v: () => randomDir().multiplyScalar(0.12), life: [0.7, 1.1], size: [0.06 * s * sz, 0.09 * s * sz], grow: 2.6, sizeCurve: 'burst', curl: 0.5, colors: ctx.cols('main', 'accent'), bright: 0.55 * B, fadeIn: 0.02, fadePow: 1.6 });
              }
              if (lit) ctx.trail(head, prev, vel, dt, 0.45 * s, 0.3 * amt);
            } else dist = 0;
            ribbon.trail.push(head);
            ctx.emit('glow', 1, { p: head, speed: 0, life: 0.04, size: 0.22 * s, colors: ctx.cols('core', 'main'), bright: 1.8 * B, fadeIn: 0 });
            if (lit) ctx.emit('spark', poisson(60 * dt), { p: head, v: () => vel.clone().multiplyScalar(-0.15).add(randomDir()), life: [0.08, 0.16], size: [0.01, 0.016], stretch: 0.03, colors: ctx.cols('core', 'main'), bright: 2.4 * B, fadeIn: 0 });
            if (d < Math.max(speed * dt * 1.5, 0.2) || age > 4) {
              ribbon.release(0.15);
              ctx.part('hit');
              arrived++;
              const last = arrived === count;
              ctx.impact(head.clone(), { power: last ? p.power : 0.55, dir: vel.clone().normalize(), scale: last ? 0.9 * p.size : 0.4 * p.size, extra: last, hit: true, role: last ? 'final' : undefined });
              ctx.part('main');
              return false;
            }
            return true;
          },
        },
        ctx.handle,
      );
    });
  }
}
missiles.defaults = { circleFeet: 1, circleHand: 1, circleTarget: 0, charge: 0.35, count: 12, launch: -45, fan: 200, smoke: 1, stagger: 0.045, hang: 0.16, speed: 30, size: 1, power: 1.4 };
