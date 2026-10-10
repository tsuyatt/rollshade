import * as THREE from 'three/webgpu';
import { ease, poisson, type Ctx } from '../ctx';
import { randomDir } from '../particles';

type P = Record<string, number>;

function aimOf(ctx: Ctx): THREE.Vector3 {
  const d = ctx.to().sub(ctx.from());
  return d.lengthSq() > 1e-6 ? d.normalize() : new THREE.Vector3(0, 0, -1);
}

export function torrent(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  ctx.part('cast');
  ctx.charge(ctx.from(), p.charge, { radius: 0.55, aim: aimOf(ctx), ground: ctx.from() });
  ctx.after(p.charge, () => {
    ctx.handle.emit('release');
    const a = ctx.from();
    const b = ctx.to();
    const aim = b.clone().sub(a).normalize();
    const dist = Math.max(a.distanceTo(b), 0.5);
    const len = dist + 1.2 * s;
    const open = p.spread * len;
    const reach = (k: number): [number, number] => [1, ease.outCubic(Math.min(k * 3.5, 1))];
    ctx.part('beam');
    ctx.lathe(a, { profile: 'cone', axis: aim, radius: 0.18 * p.size, top: open / ctx.scale, height: len / ctx.scale, twist: 2, flow: -6, tiles: [5, 3], streak: 0.8, rim: 0.7, fadeLo: 0.05, fadeHi: 0.3, dur: p.dur, bright: 1.5, grow: reach });
    ctx.lathe(a, { profile: 'cone', axis: aim, radius: 0.1 * p.size, top: (open * 0.45) / ctx.scale, height: len * 0.9 / ctx.scale, twist: -3, flow: -9, tiles: [3, 4], streak: 0.5, rim: 0.4, fadeLo: 0.05, fadeHi: 0.3, dur: p.dur * 0.9, bright: 2.2, grow: reach });
    ctx.star(a, 1.1 * s, 0.14, 3);
    ctx.ring(a, 0.6 * s, { normal: aim, dur: 0.25, thick: 0.1 });
    ctx.wave(a, 1.2, 0.35, 0.9);
    const light = ctx.hold(7);
    let tick = dist / p.speed;
    ctx.during(0, p.dur, (k, dt, age) => {
      ctx.part('beam');
      ctx.emit('flame', poisson(260 * dt * (1 - k * 0.6)), { p: () => a.clone().add(randomDir().multiplyScalar(0.1 * s)), v: () => aim.clone().multiplyScalar(p.speed * (0.7 + Math.random() * 0.5)).add(randomDir().multiplyScalar(p.speed * p.spread * 0.8)), life: [0.18, 0.32], size: [0.1 * s, 0.18 * s], grow: 2.4, drag: 1.2, turb: 2, stretch: 0.03, colors: ctx.cols('main', 'accent'), bright: 1.1 * ctx.B, fadeIn: 0.02, fadePow: 0.8 });
      ctx.emit('spark', poisson(120 * dt), { p: a, v: () => aim.clone().multiplyScalar(p.speed * 1.2).add(randomDir().multiplyScalar(4)), life: [0.2, 0.45], size: [0.012, 0.022], drag: 1, stretch: 0.04, colors: ctx.cols('core', 'main'), bright: 3 * ctx.B, fadeIn: 0 });
      light.set(a.clone().lerp(b, 0.6), 2.5 * 30 * (1 - k * 0.5));
      if (ctx.fx.feel) ctx.fx.shake(dt * 0.7);
      if (age >= tick) {
        tick += p.tick;
        ctx.part('hit');
        ctx.ring(b, 0.9 * s, { normal: aim, dur: 0.3, thick: 0.07 });
        ctx.burst(b, { count: 18, speed: 4, dir: aim, spread: 0.7, scale: 0.7 * p.size });
        ctx.hit(b, p.power, 'tick');
      }
    }, () => {
      light.release(0.3);
      ctx.part('hit');
      ctx.impact(b, { power: p.power * 3, dir: aim, scale: 1.3 * p.size, extra: true, role: 'final' });
      const g = ctx.ground(b);
      ctx.decal(g, 1.6 * s, 5);
      ctx.during(0, 0.7, (k, dt) => ctx.emit('flame', poisson(160 * dt * (1 - k)), { p: () => g.clone().add(randomDir().setY(0).multiplyScalar(0.7 * s)), v: () => new THREE.Vector3(0, 2 + Math.random() * 2, 0), life: [0.3, 0.5], size: [0.14 * s, 0.24 * s], grow: 1.8, turb: 2, colors: ctx.cols('main', 'accent'), bright: 1.1 * ctx.B, fadeIn: 0.02, fadePow: 0.8 }));
      if (ctx.pal.smoke) ctx.during(0.1, 0.8, (_k, dt) => ctx.smoke(g.clone().setY(g.y + 0.3), poisson(35 * dt), { jitter: 0.5 * s, speed: [0.8, 1.8], size: [0.35 * s, 0.6 * s], delay: 0 }));
    });
  });
}
torrent.defaults = { circleFeet: 1, circleHand: 1, circleTarget: 0, charge: 0.4, dur: 0.75, spread: 0.24, speed: 14, tick: 0.14, size: 1, power: 0.45 };
