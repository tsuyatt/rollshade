import * as THREE from 'three/webgpu';
import { ease, poisson, type Ctx } from '../ctx';
import { randomDir } from '../particles';

const UP = new THREE.Vector3(0, 1, 0);

type P = Record<string, number>;

function aimOf(ctx: Ctx): THREE.Vector3 {
  const d = ctx.to().sub(ctx.from());
  return d.lengthSq() > 1e-6 ? d.normalize() : new THREE.Vector3(0, 0, -1);
}

function sideOf(aim: THREE.Vector3): THREE.Vector3 {
  const s = aim.clone().cross(UP);
  return s.lengthSq() > 1e-6 ? s.normalize() : new THREE.Vector3(1, 0, 0);
}

function launchFlash(ctx: Ctx, at: THREE.Vector3, aim: THREE.Vector3, s: number): void {
  ctx.glow(at, 0.7 * s, 0.14, 2.2);
  ctx.ring(at, 0.55 * s, { normal: aim, dur: 0.22, thick: 0.1 });
  ctx.burst(at, { count: 18, speed: 4, dir: aim, spread: 0.5, scale: 0.5 * s });
}

function missile(ctx: Ctx, from: THREE.Vector3, to: () => THREE.Vector3, o: { dur: number; curve?: THREE.Vector3; s: number; density: number; ease?: (t: number) => number; arrive: (at: THREE.Vector3) => void; ribbon?: number; head?: number; split?: boolean }): void {
  if (o.split) ctx.part('fly');
  const B = ctx.B * ctx.glare;
  const ribbon = ctx.ribbon((o.ribbon ?? 0.42) * o.s);
  const light = ctx.hold(6);
  const head = o.head ?? 1;
  ctx.fly({
    from,
    to,
    dur: o.dur,
    curve: o.curve,
    ease: o.ease,
    step: (h, prev, vel, dt) => {
      ctx.emit('glow', 1, { p: h, speed: 0, life: 0.04, size: 0.7 * o.s * head, colors: ctx.cols('main', 'accent'), bright: 0.6 * B, fadeIn: 0, fadePow: 1 });
      if (ctx.element !== 'fire') ctx.emit('mist', 1, { p: h, speed: 0, life: 0.05, size: 0.42 * o.s * head, colors: ctx.cols('main'), bright: 1.4 * B, fadeIn: 0, fadePow: 1 });
      ctx.emit('glow', 1, { p: h, speed: 0, life: 0.04, size: 0.14 * o.s * head, colors: ctx.cols('core'), bright: 2 * B, fadeIn: 0, fadePow: 1 });
      if (ctx.element === 'fire') ctx.emit('flame', poisson(70 * dt), { p: h, jitter: 0.04 * o.s, v: () => randomDir().multiplyScalar(0.4).add(vel.clone().multiplyScalar(0.9)), life: [0.07, 0.12], size: [0.2 * o.s, 0.3 * o.s], grow: 1.3, turb: 2, colors: ctx.cols('core', 'main', 'accent'), bright: 2 * B, fadeIn: 0.01, fadePow: 0.8 });
      ctx.trail(h, prev, vel, dt, o.s, o.density);
      ctx.emit('spark', poisson(100 * dt * o.density * ctx.efx.sparks), { p: () => prev.clone().lerp(h, Math.random()), jitter: 0.05 * o.s, v: () => vel.clone().multiplyScalar(-0.18).add(randomDir().multiplyScalar(2.2)), life: [0.2, 0.5], size: [0.012 * o.s, 0.024 * o.s], gravity: 5, drag: 2, stretch: 0.03, colors: ctx.cols('core', 'main', 'accent'), bright: 3 * B, fadeIn: 0 });
      ribbon.trail.push(h);
      light.set(h, 1.3 * 30);
    },
    arrive: (at) => {
      ribbon.release(0.18);
      light.release(0.08);
      if (o.split) ctx.part('hit');
      o.arrive(at);
    },
  });
}

function targetCircle(ctx: Ctx, size: number, dur: number): void {
  ctx.part('mark');
  ctx.circle(ctx.ground(ctx.to()), size, dur, { slot: 'target', spin: -0.8, bright: 1.4 });
  ctx.part('cast');
}

export function projectile(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const aim0 = aimOf(ctx);
  ctx.part('cast');
  ctx.charge(ctx.from(), p.charge, { radius: 0.55 * p.size, aim: aim0, ground: ctx.from() });
  targetCircle(ctx, 1.3 * s, p.charge + ctx.from().distanceTo(ctx.to()) / p.speed + 0.6);
  ctx.after(p.charge, () => {
    ctx.handle.emit('release');
    const count = Math.max(1, Math.round(p.count));
    for (let i = 0; i < count; i++) {
      ctx.after(i * 0.08, () => {
        const a = ctx.from();
        const b0 = ctx.to();
        const dist = Math.max(a.distanceTo(b0), 0.5);
        const aim = b0.clone().sub(a).normalize();
        const side = sideOf(aim);
        const sign = count > 1 ? (i / (count - 1)) * 2 - 1 : Math.random() < 0.5 ? -1 : 1;
        const curve = side.multiplyScalar(dist * 0.16 * p.curve * sign).addScaledVector(UP, dist * 0.1 * p.curve);
        const spreadTo = count > 1 ? sideOf(aim).multiplyScalar(sign * 0.25) : new THREE.Vector3();
        launchFlash(ctx, a, aim, p.size);
        missile(ctx, a, () => ctx.to().add(spreadTo), {
          dur: Math.max(dist / p.speed, 0.15),
          curve,
          s,
          density: p.density / Math.sqrt(count),
          split: true,
          arrive: (b) => {
            ctx.impact(b, { power: p.power, scale: (1.25 * p.size) / Math.sqrt(count), extra: i === count - 1 && p.extra > 0, role: count > 1 && i === count - 1 ? 'final' : undefined });
            for (let k = 0; k < p.after; k++) {
              const q = b.clone().add(randomDir().multiplyScalar(0.25 + Math.random() * 0.45).multiply(new THREE.Vector3(1, 0.6, 1)));
              ctx.after(0.05 + Math.random() * 0.22, () => {
                ctx.glow(q, 0.6 * s, 0.22, 1.6);
                ctx.burst(q, { count: 22, speed: 3.5, scale: 0.55 * p.size });
                ctx.light(q, 1.2, 0.2);
              });
            }
            if (ctx.pal.smoke) ctx.during(0.08, 0.6, (_k, dt) => ctx.smoke(b.clone().add(new THREE.Vector3(0, 0.1, 0)), poisson(35 * dt), { jitter: 0.3, speed: [0.8, 1.8], size: [0.3 * s, 0.5 * s], delay: 0 }));
          },
        });
      });
    }
  });
}
projectile.defaults = { circleFeet: 1, circleHand: 1, circleTarget: 0, charge: 0.35, speed: 12, curve: 0.8, size: 1, after: 3, power: 1, density: 1, count: 1, extra: 1 };

export function lance(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const aim0 = aimOf(ctx);
  ctx.part('cast');
  ctx.charge(ctx.from(), p.charge, { radius: 0.45, aim: aim0, ground: ctx.from() });
  targetCircle(ctx, 1.1 * s, p.charge + 0.6);
  ctx.after(p.charge, () => {
    ctx.handle.emit('release');
    const a = ctx.from();
    const aim = ctx.to().sub(a).normalize();
    ctx.ring(a, 0.5 * s, { normal: aim, dur: 0.2, thick: 0.12 });
    ctx.ring(a.clone().addScaledVector(aim, 0.6), 0.35 * s, { normal: aim, dur: 0.2, thick: 0.12, delay: 0.03 });
    ctx.wave(a, 0.8, 0.3, 0.6);
    ctx.star(a, 0.8 * s, 0.12);
    const dist = a.distanceTo(ctx.to());
    missile(ctx, a, () => ctx.to(), {
      dur: Math.max(dist / p.speed, 0.08),
      s: s * 0.7,
      density: 0.7,
      ribbon: 0.22,
      head: 0.8,
      split: true,
      arrive: (b) => {
        const d = aim.clone();
        ctx.impact(b, { power: p.power, dir: d, ringNormal: d, scale: 0.9 * p.size, extra: p.extra > 0 });
        const exit = b.clone().addScaledVector(d, 0.7);
        ctx.ring(exit, 0.9 * s, { normal: d, dur: 0.3, thick: 0.08, delay: 0.03 });
        ctx.burst(exit, { count: 50, speed: 9, dir: d, spread: 0.35, scale: 0.8 * p.size });
        ctx.flare(b, 1.6 * s, 0.3);
      },
    });
    ctx.part('fly');
    ctx.during(0, Math.max(dist / p.speed, 0.08), (k) => {
      const h = a.clone().lerp(ctx.to(), k);
      ctx.emit('spark', 1, { p: h, v: () => aim.clone().multiplyScalar(p.speed), life: 0.05, size: 0.07 * s, stretch: 0.035, colors: ctx.cols('core', 'main'), bright: 3 * ctx.B, fadeIn: 0, fadePow: 1 });
    });
  });
}
lance.defaults = { circleFeet: 0, circleHand: 1, circleTarget: 0, charge: 0.25, speed: 32, size: 1, power: 1.3, extra: 1 };

export function beam(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const aim0 = aimOf(ctx);
  ctx.part('cast');
  ctx.charge(ctx.from(), p.charge, { radius: 0.6, aim: aim0, ground: ctx.from() });
  targetCircle(ctx, 1.4 * s, p.charge + p.dur + 0.4);
  ctx.after(p.charge, () => {
    ctx.handle.emit('release');
    const from = () => ctx.from();
    const to = () => ctx.to();
    ctx.part('beam');
    ctx.beam(from, to, { radius: p.radius * p.size, dur: p.dur, fadeIn: 0.08, fadeOut: 0.3, flow: 14 });
    ctx.circle(from().addScaledVector(aim0, 0.2), 0.7 * s, p.dur + 0.1, { slot: 'hand', normal: aim0, spin: -2.5, bright: 2.2 });
    ctx.wave(from(), 1.2, 0.35, 0.8);
    ctx.part('hit');
    ctx.decal(to(), 1.2 * s, 3 + p.dur);
    const light = ctx.hold(7);
    let tick = 0;
    ctx.during(0, p.dur, (k, dt, age) => {
      const a = from();
      const b = to();
      const d = b.clone().sub(a).normalize();
      ctx.part('beam');
      ctx.emit('glow', 1, { p: a, speed: 0, life: 0.05, size: 0.8 * s, colors: ctx.cols('core', 'main'), bright: 1.3 * ctx.B, fadeIn: 0 });
      ctx.emit('spark', poisson(60 * dt), { p: () => a.clone().lerp(b, Math.random()), jitter: 0.25 * s * p.radius, v: () => d.clone().multiplyScalar(8), life: [0.15, 0.3], size: [0.01, 0.02], stretch: 0.03, colors: ctx.cols('core', 'main'), bright: 2.5 * ctx.B, fadeIn: 0 });
      ctx.part('hit');
      ctx.emit('glow', 1, { p: b, speed: 0, life: 0.05, size: 1.1 * s, colors: ctx.cols('core', 'main'), bright: 1.3 * ctx.B, fadeIn: 0 });
      ctx.emit('spark', poisson(260 * dt), { p: b, jitter: 0.15 * s, v: () => d.clone().multiplyScalar(-2).add(randomDir().multiplyScalar(6)), life: [0.2, 0.45], size: [0.015, 0.03], gravity: 5, drag: 2, stretch: 0.035, bounce: 0.3, colors: ctx.cols('core', 'main', 'accent'), bright: 3 * ctx.B, fadeIn: 0 });
      ctx.trail(b, b.clone().addScaledVector(d, -0.3), d.clone().multiplyScalar(-4), dt, s * 1.3, 1.5);
      light.set(b, 2 * 30);
      if (ctx.fx.feel) ctx.fx.shake(dt * 0.9);
      if (age >= tick) {
        tick += p.tick;
        ctx.ring(b, 0.9 * s, { normal: d, dur: 0.3, thick: 0.07 });
        ctx.wave(b, 0.9, 0.3, 0.4);
        ctx.hit(b, p.power, 'tick');
      }
      void k;
    }, () => {
      light.release(0.3);
      ctx.part('hit');
      ctx.impact(to(), { power: p.power * 1.6, scale: 1.1 * p.size, extra: true, role: 'final' });
    });
  });
}
beam.defaults = { circleFeet: 1, circleHand: 1, circleTarget: 0, charge: 0.5, dur: 1.2, radius: 0.34, size: 1, power: 0.5, tick: 0.16 };

function blast(ctx: Ctx, t: THREE.Vector3, s: number, pw: number, secondary: number, o: { hit?: boolean; role?: 'final' } = {}): void {
  const g = ctx.ground(t);
  ctx.screenFlash(0.22);
  ctx.star(t, 2.6 * s, 0.22, 3);
  ctx.flare(t, 2.5 * s, 0.35);
  ctx.glow(t, 2 * s, 0.4, 1.3);
  ctx.sphere(t, 2.2 * s, 0.7, 2.2);
  ctx.light(t, 7 * pw, 0.7, 14);
  ctx.ring(t, 2.8 * s, { normal: 'camera', dur: 0.45, thick: 0.08 });
  for (let i = 0; i < 3; i++) ctx.ring(g, (2.6 + i * 1.1) * s, { dur: 0.55 + i * 0.1, thick: 0.06, delay: i * 0.07 });
  ctx.wave(t, 3.5 * s, 0.6, 1.6);
  ctx.decal(t, 2.6 * s, 5);
  ctx.dust(g, 2 * s);
  ctx.burst(t, { count: 170, speed: 8, scale: 1.4 * s });
  ctx.extra(t, pw, 1.4 * s);
  if (o.hit !== false) ctx.hit(t, pw, o.role);
  for (let i = 0; i < secondary; i++) {
    ctx.after(0.05 + Math.random() * 0.3, () => {
      const q = t.clone().add(randomDir().multiply(new THREE.Vector3(1.4, 0.8, 1.4)).multiplyScalar(s));
      q.y = Math.max(q.y, g.y + 0.3);
      ctx.glow(q, 0.9 * s, 0.25, 1.8);
      ctx.burst(q, { count: 30, speed: 4, scale: 0.7 * s });
      ctx.light(q, 1.5, 0.25);
    });
  }
  if (ctx.pal.smoke) ctx.during(0.1, 0.9, (_k, dt) => ctx.smoke(g.clone().setY(g.y + 0.4), poisson(50 * dt), { jitter: 0.6 * s, speed: [1.2, 2.6], size: [0.45 * s, 0.8 * s], delay: 0 }));
}

export function explosion(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const t = ctx.to();
  const g = ctx.ground(t);
  ctx.part('cast');
  ctx.charge(ctx.from(), 0.3, { radius: 0.45, aim: aimOf(ctx), ground: ctx.from() });
  ctx.part('hit');
  ctx.circle(g, 2 * s, p.gather + 0.5, { slot: 'target', spin: 1.2, bright: 1.8 });
  ctx.during(0, p.gather, (k, dt) => {
    ctx.emit('mote', poisson(160 * dt), { p: () => g.clone().add(randomDir().setY(0).normalize().multiplyScalar(2 * s)), center: t, attract: 14, v: () => new THREE.Vector3(0, 1.5, 0), life: [0.3, 0.5], size: [0.025, 0.045], drag: 2.5, colors: ctx.cols('core', 'main'), bright: 2.2 * ctx.B, fadeIn: 0.1 });
    if (Math.random() < dt * 25) ctx.glow(t, (0.3 + k * 0.9) * s, 0.1, 1 + k * 2);
  });
  ctx.after(p.gather, () => {
    ctx.handle.emit('release');
    blast(ctx, t, s, p.power, p.secondary);
  });
}
explosion.defaults = { circleFeet: 0, circleHand: 1, circleTarget: 1, gather: 0.55, size: 1.2, power: 1.9, secondary: 5 };

export function pillar(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const g = ctx.ground(ctx.to());
  ctx.part('cast');
  ctx.charge(ctx.from(), 0.3, { radius: 0.45, aim: aimOf(ctx), ground: ctx.from() });
  ctx.part('hit');
  ctx.circle(g, 1.5 * s, p.delay + p.dur + 0.2, { slot: 'target', spin: 1.6, bright: 1.8 });
  ctx.during(0, p.delay, (_k, dt) => {
    ctx.emit('mote', poisson(80 * dt), { p: () => g.clone().add(randomDir().setY(0).multiplyScalar(1.2 * s)), v: () => new THREE.Vector3(0, 1 + Math.random() * 2, 0), life: [0.3, 0.6], size: [0.02, 0.04], colors: ctx.cols('core', 'main'), bright: 2 * ctx.B });
  });
  ctx.after(p.delay, () => {
    ctx.handle.emit('release');
    const top = g.clone().setY(g.y + p.height);
    ctx.beam(() => g, () => top, { radius: p.radius * s, dur: p.dur, fadeIn: 0.06, fadeOut: 0.3, flow: 10 });
    const sheath = (k: number): [number, number] => [1 + 0.25 * k, ease.outCubic(Math.min(k * 5, 1))];
    ctx.lathe(g, { profile: 'cylinder', radius: p.radius * 1.35 * p.size, top: p.radius * 1.05 * p.size, height: p.height * 0.75 * p.size, flow: 2.2, twist: 1.5, tiles: [6, 1.2], streak: 1, rim: 0.8, fadeHi: 0.55, dur: p.dur + 0.2, bright: 1, grow: sheath, erode: (k) => Math.max(k - 0.7, 0) / 0.3 });
    for (let i = 0; i < 3; i++) ctx.helix({ center: g, r0: p.radius * 1.7 * p.size, r1: p.radius * 0.9 * p.size, height: p.height * 0.6 * p.size, turns: 1.3, phase: (i / 3) * Math.PI * 2, width: 0.22, dur: 0.45, lag: 0.7, hold: p.dur * 0.3, delay: 0.04 * i, bright: 2 });
    ctx.band(g, { radius: 2.2 * s, inner: 0.55, dur: 0.7, noise: 1 });
    ctx.impact(g.clone().setY(g.y + 1), { power: p.power, scale: 1.1 * p.size, extra: true });
    ctx.ring(g, 2.4 * s, { dur: 0.6, thick: 0.06 });
    const light = ctx.hold(8);
    ctx.during(0, p.dur, (k, dt) => {
      const h = g.clone().setY(g.y + Math.random() * p.height * 0.6);
      const vel = new THREE.Vector3(0, 9, 0);
      ctx.trail(h, h.clone().setY(h.y - 0.5), vel, dt, s * 1.5, 2);
      ctx.emit('spark', poisson(160 * dt), { p: () => g.clone().add(randomDir().setY(0).multiplyScalar(p.radius * s)), v: () => new THREE.Vector3(0, 6 + Math.random() * 6, 0), life: [0.3, 0.6], size: [0.012, 0.022], drag: 1, stretch: 0.04, colors: ctx.cols('core', 'main'), bright: 3 * ctx.B, fadeIn: 0 });
      light.set(g.clone().setY(g.y + 1.5), 3 * 30 * (1 - k * 0.5));
      if (ctx.fx.feel) ctx.fx.shake(dt * 0.6);
    }, () => light.release(0.3));
  });
}
pillar.defaults = { circleFeet: 0, circleHand: 1, circleTarget: 1, delay: 0.35, dur: 1.1, radius: 0.75, height: 6, size: 1, power: 1.4 };

export function meteor(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const hand = ctx.from();
  ctx.part('cast');
  ctx.charge(hand, 0.35, { radius: 0.5, aim: UP.clone(), ground: hand });
  ctx.part('main');
  const t = ctx.to();
  const aim = aimOf(ctx);
  const side = sideOf(aim);
  ctx.after(0.35, () => {
    ctx.handle.emit('release');
    ctx.circle(ctx.ground(t), p.radius * 1.2 * s, p.dur + p.fall + 0.8, { slot: 'target', spin: 0.8, bright: 1.2 });
    const count = Math.round(p.count);
    for (let i = 0; i < count; i++) {
      const last = i === count - 1;
      ctx.after(last ? p.dur : Math.random() * p.dur * 0.9, () => {
        const off = last ? new THREE.Vector3() : randomDir().setY(0).multiplyScalar(Math.random() * p.radius * s);
        const land = ctx.ground(t.clone().add(off));
        const start = land.clone().add(new THREE.Vector3(0, 10, 0)).addScaledVector(side, -3.5).addScaledVector(aim, -2);
        const sz = (last ? 2 : 0.8 + Math.random() * 0.5) * p.size;
        missile(ctx, start, () => land, {
          dur: last ? p.fall * 1.3 : p.fall,
          s: sz * ctx.scale,
          density: 1,
          ribbon: 0.6,
          head: 1.6,
          ease: ease.inQuad,
          arrive: (b) => {
            const at = b.clone().setY(b.y + 0.2);
            if (last) {
              blast(ctx, at, 1.5 * s, 1.9, 6, { role: 'final' });
              return;
            }
            const hitTarget = b.distanceTo(ctx.ground(ctx.to())) < 1.2;
            ctx.impact(at, { power: 1.25, scale: sz * 1.25, hit: hitTarget });
            ctx.decal(b, 1.2 * sz, 5);
            ctx.dust(b, sz);
            ctx.rocks(at, 4, sz * 0.8, () => randomDir().setY(0.6 + Math.random()).multiplyScalar(4));
            if (ctx.fx.feel) ctx.fx.shake(0.12);
          },
        });
      });
    }
  });
}
meteor.defaults = { circleFeet: 1, circleHand: 1, circleTarget: 1, count: 8, dur: 1.2, fall: 0.5, radius: 2.2, size: 1 };

export function nova(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const c = ctx.from();
  const g = ctx.ground(c);
  const dist = g.distanceTo(ctx.ground(ctx.to()));
  const R = (p.radius > 0 ? p.radius : Math.max(dist + 1.2, 3.5)) * ctx.scale;
  ctx.part('cast');
  ctx.charge(c, p.charge, { radius: 0.9, ground: c, aim: UP.clone() });
  targetCircle(ctx, 1.2 * s, p.charge + 0.8);
  ctx.during(0, p.charge, (k, dt) => {
    ctx.emit('mote', poisson(120 * dt), { p: () => g.clone().add(randomDir().setY(0).normalize().multiplyScalar(R * 0.6)), center: c, attract: 12, v: () => new THREE.Vector3(0, 1, 0), life: [0.3, 0.5], size: [0.025, 0.045], drag: 2.5, colors: ctx.cols('core', 'main'), bright: 2 * ctx.B, fadeIn: 0.1 });
    if (Math.random() < dt * 20) ctx.glow(c, (0.4 + k) * s, 0.1, 1 + k * 1.5);
  });
  ctx.after(p.charge, () => {
    ctx.handle.emit('release');
    ctx.part('main');
    const pw = p.power;
    ctx.screenFlash(0.22);
    ctx.star(c, 2.8 * s, 0.24, 3);
    ctx.flare(c, 2.6 * s, 0.35);
    ctx.glow(c, 2.2 * s, 0.4, 1.3);
    ctx.light(c, 7 * pw, 0.8, R * 2);
    ctx.wave(c, R, 0.6, 1.4);
    ctx.sphere(c, R * 0.7, 0.6, 1.1);
    ctx.lathe(g, { profile: 'dome', radius: R * 0.8 / ctx.scale, height: R * 0.3 / ctx.scale, tiles: [7, 1.5], streak: 0.4, rim: 1, flow: 1.2, dur: 0.55, bright: 0.55, grow: (k) => 0.15 + 0.85 * ease.outCubic(Math.min(k * 1.4, 1)), erode: (k) => Math.max(k - 0.25, 0) / 0.75, edge: 0.06, fade: (k) => 1 - k * k });
    ctx.band(g, { radius: R * 1.05 / ctx.scale, inner: 0.8, dur: 0.6, noise: 1, grow: (k) => 0.1 + 0.9 * ease.outCubic(k) });
    ctx.burst(c, { count: 90, speed: 7, scale: 1.2 * s });
    ctx.dust(g, 1.5 * s);
    for (let i = 0; i < 4; i++) ctx.ring(g, R * (1.05 - i * 0.2), { dur: 0.6 + i * 0.08, thick: 0.06, delay: i * 0.05 });
    ctx.ring(c, R * 0.8, { normal: 'camera', dur: 0.45, thick: 0.07 });
    const expand = 0.6;
    ctx.during(0, expand, (k, dt) => {
      const r = R * ease.outCubic(k);
      const n = poisson(38 * dt * R);
      for (let i = 0; i < n; i++) {
        const front = Math.random() < 0.45;
        const u = front ? 0.9 + Math.random() * 0.1 : Math.sqrt(Math.random());
        const a = Math.random() * Math.PI * 2;
        const rr = r * u;
        const q = g.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0.15, Math.sin(a) * rr));
        const out = new THREE.Vector3(Math.cos(a), 0.3 + (1 - u) * 0.6, Math.sin(a));
        const grow = 0.3 + 1.1 * (rr / R);
        ctx.burst(q, { count: front ? 5 : 2.5, speed: 3 + 3 * u, dir: out, spread: 0.45, scale: grow * p.size });
      }
      if (k > 0.3) ctx.dust(g.clone().add(randomDir().setY(0).normalize().multiplyScalar(r)), 0.2 * s);
    });
    const solid = ctx.element === 'ice' ? 'crystal' : ctx.element === 'earth' ? 'rock' : null;
    if (solid) {
      const rings = [0.22, 0.4, 0.57, 0.73, 0.88];
      rings.forEach((u, j) => {
        const n = 5 + j * 3;
        const off = Math.random() * Math.PI * 2;
        const at = expand * (1 - Math.cbrt(1 - u)) * 0.95;
        for (let i = 0; i < n; i++) {
          const a = off + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.25;
          const rr = R * u * (0.94 + Math.random() * 0.12);
          const h = (0.35 + 1.55 * Math.pow(u / 0.88, 1.4)) * s * (0.85 + Math.random() * 0.3);
          ctx.after(at + Math.random() * 0.04, () => ctx.spike(g.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr)), g, h, solid, 0.7 + u * 0.5));
        }
      });
    } else {
      const pts = 8;
      for (let i = 0; i < pts; i++) {
        const a = (i / pts) * Math.PI * 2 + Math.random() * 0.3;
        ctx.after(expand * (0.55 + Math.random() * 0.25), () => {
          const q = g.clone().add(new THREE.Vector3(Math.cos(a) * R * 0.85, 0.3, Math.sin(a) * R * 0.85));
          ctx.glow(q, 0.9 * s, 0.3, 1.6);
          ctx.burst(q, { count: 30, speed: 4, dir: UP, spread: 0.6, scale: 0.9 * p.size });
          ctx.light(q, 1.5, 0.3);
        });
      }
    }
    const tHit = Math.min(Math.max(dist / R, 0), 1);
    const kHit = 1 - Math.cbrt(1 - tHit);
    ctx.after(expand * kHit, () => ctx.impact(ctx.to(), { power: pw, scale: 0.9, extra: true }));
    ctx.decal(c, Math.min(R * 0.6, 3), 5);
    if (ctx.pal.smoke) ctx.during(0.2, 0.8, (_k, dt) => ctx.smoke(g.clone().add(randomDir().setY(0).normalize().multiplyScalar(R * 0.7)).setY(g.y + 0.3), poisson(40 * dt), { jitter: 0.4, speed: [0.6, 1.5], size: [0.4 * s, 0.7 * s], delay: 0 }));
  });
}
nova.defaults = { circleFeet: 1, circleHand: 0, circleTarget: 0, charge: 0.55, radius: 0, size: 1, power: 1.7 };

export function barrier(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const center = () => ctx.from();
  const r = p.radius * s;
  const g = ctx.ground(center());
  ctx.handle.emit('cast');
  ctx.circle(g, r * 1.2, p.dur + 0.4, { slot: 'feet', spin: 0.8, bright: 1.6 });
  ctx.ring(g, r * 1.5, { dur: 0.4, thick: 0.06 });
  const prim = ctx.fx.prims.acquire('shield');
  prim.u.core.value.copy(ctx.pal.core);
  prim.u.main.value.copy(ctx.pal.main);
  prim.u.accent.value.copy(ctx.pal.accent);
  prim.u.bright.value = 1.8 * ctx.B;
  const hits = prim.u.hitData as THREE.Vector4[];
  hits.forEach((h) => h.set(0, 1, 0, 9));
  let slot = 0;
  let next = p.poke;
  ctx.after(0.1, () => ctx.handle.emit('release'));
  ctx.live(prim, p.dur, (k, age) => {
    const c = center();
    prim.mesh.position.copy(c);
    const pop = ease.outBack(Math.min(age / 0.3, 1));
    prim.mesh.scale.setScalar(r * (0.85 + 0.15 * pop));
    prim.u.reveal.value = Math.min(age / 0.35, 1);
    prim.u.time.value = age;
    prim.u.fade.value = k > 0.9 ? 1 - (k - 0.9) / 0.1 : 1;
    if (p.poke > 0 && age > next && k < 0.85) {
      next += p.poke * (0.6 + Math.random() * 0.8);
      const toward = ctx.to().sub(c).normalize().add(randomDir().multiplyScalar(0.5)).normalize();
      hits[slot].set(toward.x, toward.y, toward.z, 0);
      slot = (slot + 1) % hits.length;
      const at = c.clone().addScaledVector(toward, r);
      ctx.emit('spark', 30, { p: at, v: () => toward.clone().add(randomDir().multiplyScalar(0.8)).multiplyScalar(4), life: [0.15, 0.35], size: [0.012, 0.022], drag: 3, stretch: 0.03, colors: ctx.cols('core', 'main'), bright: 3 * ctx.B, fadeIn: 0 });
      ctx.star(at, 0.6 * s, 0.12, 2.5);
      ctx.light(at, 1.5, 0.2);
    }
  });
  ctx.fx.scheduler.add({
    update: (dt) => {
      for (const h of hits) h.w += dt;
      return prim.mesh.parent != null;
    },
  });
  ctx.after(p.dur, () => {
    const c = center();
    ctx.star(c, 2 * s, 0.2, 2.5);
    ctx.ring(c, r * 1.6, { normal: 'camera', dur: 0.4, thick: 0.08 });
    ctx.wave(c, r * 2, 0.5, 1);
    ctx.emit('shard', 120 * s, { p: () => c.clone().add(randomDir().multiplyScalar(r)), v: () => randomDir().multiplyScalar(3 + Math.random() * 3), life: [0.4, 0.8], size: [0.04, 0.08], gravity: 6, drag: 1.5, stretch: 0.02, colors: ctx.cols('core', 'main'), bright: 2 * ctx.B, fadeIn: 0 });
    ctx.emit('mote', 80 * s, { p: () => c.clone().add(randomDir().multiplyScalar(r)), v: () => randomDir().multiplyScalar(1), life: [0.6, 1.1], size: [0.02, 0.04], turb: 2, colors: ctx.cols('core', 'main'), bright: 2 * ctx.B });
  });
}
barrier.defaults = { circleFeet: 1, circleHand: 0, circleTarget: 0, dur: 2.4, radius: 1.35, size: 1, poke: 0.45 };
