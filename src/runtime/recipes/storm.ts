import * as THREE from 'three/webgpu';
import { clamp01, ease, poisson, span, type Ctx } from '../ctx';
import { randomDir, type Hook } from '../particles';

const UP = new THREE.Vector3(0, 1, 0);

type P = Record<string, number>;

function aimOf(ctx: Ctx): THREE.Vector3 {
  const d = ctx.to().sub(ctx.from()).setY(0);
  return d.lengthSq() > 1e-6 ? d.normalize() : new THREE.Vector3(1, 0, 0);
}

export function tornado(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const aim = aimOf(ctx);
  ctx.part('cast');
  ctx.charge(ctx.from(), p.charge, { radius: 0.6, aim, ground: ctx.from() });
  const tg = ctx.ground(ctx.to());
  const start = p.drift > 0.05 ? ctx.ground(ctx.from()).addScaledVector(aim, 1.4).lerp(tg, 1 - p.drift) : tg.clone();
  ctx.after(p.charge, () => {
    ctx.handle.emit('release');
    ctx.part('main');
    ctx.circle(start, 1.6 * ctx.scale, 0.8, { spin: 2, bright: 1.4, slot: 'target' });
    const center = ctx.tornado(start, { radius: p.radius * s, height: p.height * s, dur: p.dur, power: p.power, goal: tg, reach: p.dur * 0.45, debris: p.debris });
    let next = 0.4;
    ctx.part('hit');
    ctx.during(0, p.dur, (_k, _dt, age) => {
      if (age < next) return;
      const d = Math.hypot(center.x - tg.x, center.z - tg.z);
      if (d > p.radius * s * 1.2) return;
      next = age + 0.3;
      const at = ctx.to();
      ctx.hit(at, 0.5 * p.power, 'tick');
      ctx.emit('spark', 12, { p: at, v: () => randomDir().setY(Math.random() * 1.5).multiplyScalar(3), life: [0.15, 0.3], size: [0.012, 0.02], stretch: 0.04, colors: ctx.cols('core', 'main'), bright: 2.4 * ctx.B, fadeIn: 0 });
    }, () => {
      const at = ctx.to();
      ctx.impact(at.clone().setY(at.y + 0.6), { power: p.power, scale: 1.1 * p.size, extra: false, role: 'final', dir: UP });
      ctx.band(tg.clone().setY(tg.y + 0.03), { radius: 2.8 * s, inner: 0.7, dur: 0.6, noise: 1 });
      ctx.dust(tg, 1.6 * s);
    });
  });
}
tornado.defaults = { circleFeet: 1, circleHand: 1, circleTarget: 1, charge: 0.35, dur: 2.8, radius: 1.1, height: 3.6, drift: 0.6, size: 1, power: 1.5, debris: 1 };

interface Env {
  hook(h: Hook): Hook;
  curl: number;
  gust: number;
  center: THREE.Vector3;
  R: number;
}

interface Weather {
  cloud: 'smoke' | 'mist' | 'none';
  fall(ctx: Ctx, at: () => THREE.Vector3, slant: THREE.Vector3, dt: number, s: number, env: Env): void;
  strike?(ctx: Ctx, at: THREE.Vector3, top: THREE.Vector3, s: number): void;
  ground?(ctx: Ctx, at: () => THREE.Vector3, dt: number, s: number): void;
}

const dropHook = (ctx: Ctx): Hook => ({
    floorKill: true,
    onFloor: (q) => {
      if (Math.random() > 0.45) return;
      ctx.emit('spark', 3, { p: q, v: () => new THREE.Vector3((Math.random() - 0.5) * 1.4, 1 + Math.random() * 1.2, (Math.random() - 0.5) * 1.4), life: [0.18, 0.3], size: [0.01, 0.018], gravity: 9, colors: ctx.cols('core', 'main'), bright: 1.4 * ctx.B, fadeIn: 0 });
      if (Math.random() < 0.4) ctx.band(q.clone().setY(q.y + 0.01), { radius: 0.15 + Math.random() * 0.15, inner: 0.7, dur: 0.35, noise: 0, bright: 1 });
    },
  });

const WEATHER: Record<string, Weather> = {
  fire: {
    cloud: 'smoke',
    fall(ctx, at, slant, dt, s, env) {
      const hook = env.hook({ floorKill: true, onFloor: (q) => {
        if (Math.random() > 0.35) return;
        ctx.emit('flame', 3, { p: q.clone().setY(q.y + 0.1), jitter: 0.1, v: () => new THREE.Vector3(0, 1.5 + Math.random(), 0), life: [0.25, 0.45], size: [0.14, 0.24], grow: 1.4, colors: ctx.cols('core', 'main', 'accent'), bright: 1.3 * ctx.B, fadeIn: 0.02 });
        ctx.emit('mote', 3, { p: q, v: () => randomDir().setY(1).multiplyScalar(1.5), life: [0.4, 0.8], size: [0.02, 0.03], gravity: 2, colors: ctx.cols('core', 'main'), bright: 2.4 * ctx.B });
      } });
      ctx.emit('flame', poisson(26 * dt * s), { p: at, v: () => slant.clone().multiplyScalar(9 + Math.random() * 3), life: 2, size: [0.12, 0.2], stretch: 0.02, colors: ctx.cols('core', 'main', 'accent'), bright: 1.4 * ctx.B, fadeIn: 0.02, alphaCurve: 'hold', curl: env.curl, curlScale: 0.7, hook });
      ctx.emit('spark', poisson(40 * dt * s), { p: at, v: () => slant.clone().multiplyScalar(10 + Math.random() * 4), life: 2, size: [0.012, 0.02], stretch: 0.05, colors: ctx.cols('core', 'main'), bright: 2.4 * ctx.B, fadeIn: 0, alphaCurve: 'hold', curl: env.curl, curlScale: 0.7, hook: env.hook({ floorKill: true }) });
    },
    strike(ctx, at) {
      ctx.decal(at, 0.7, 3);
    },
  },
  ice: {
    cloud: 'mist',
    fall(ctx, at, slant, dt, s, env) {
      const wind = slant.clone().setY(0).normalize();
      ctx.emit('mote', poisson(160 * dt * s), { p: at, v: () => slant.clone().multiplyScalar(3 + Math.random() * 2).addScaledVector(wind, 2.5), life: 2.2, size: [0.02, 0.04], curl: 1.4, curlScale: 1.2, colors: ctx.cols('core', 'main'), bright: 2 * ctx.B, fadeIn: 0.1, alphaCurve: 'hold', hook: env.hook({ floorKill: true }) });
      ctx.emit('shard', poisson(30 * dt * s), { p: at, v: () => slant.clone().multiplyScalar(5 + Math.random() * 2).addScaledVector(wind, 3), life: 2, size: [0.03, 0.06], spin: [-8, 8], colors: ctx.cols('core', 'main'), bright: 1.8 * ctx.B, fadeIn: 0.05, alphaCurve: 'hold', curl: env.curl, curlScale: 0.7, hook: env.hook({ floorKill: true }) });
    },
    strike(ctx, at, _top, s) {
      ctx.spike(at, at.clone().add(new THREE.Vector3(0.01, 0, 0)), (0.5 + Math.random() * 0.5) * s, 'crystal', 0.6);
    },
    ground(ctx, at, dt, s) {
      ctx.emit('mist', poisson(20 * dt * s), { p: at, v: () => randomDir().setY(0.1).multiplyScalar(0.6), life: [1.2, 1.8], size: [0.5, 0.8], grow: 1.5, colors: ctx.cols('main', 'accent'), bright: 0.45 * ctx.B, fadeIn: 0.3 });
    },
  },
  thunder: {
    cloud: 'smoke',
    fall(ctx, at, slant, dt, s, env) {
      ctx.emit('spark', poisson(560 * dt * s), { p: at, v: () => slant.clone().multiplyScalar(14 + Math.random() * 4), life: 1.5, size: [0.011, 0.016], stretch: 0.14, colors: [new THREE.Color(0.65, 0.7, 0.85), ctx.pal.core], bright: 2.2, fadeIn: 0, alphaCurve: 'hold', curl: env.curl, curlScale: 0.7, hook: env.hook(dropHook(ctx)) });
    },
    strike(ctx, at, top, s) {
      ctx.bolt(top, at, { dur: 0.22, width: 0.22 * s, jag: 0.14, branches: 2, flicker: true });
      ctx.glow(at.clone().setY(at.y + 0.3), 0.8 * s, 0.2, 2);
      ctx.burst(at, { count: 25, speed: 4, dir: UP, spread: 0.6, scale: 0.5 * s });
      ctx.light(at.clone().setY(at.y + 1), 3, 0.25, 10);
      ctx.decal(at, 0.6, 2);
    },
  },
  wind: {
    cloud: 'none',
    fall(ctx, at, slant, dt, s, env) {
      const wind = slant.clone().setY(0).normalize();
      const lift = () => at().setY(ctx.floor + 0.2 + Math.random() * 2.8);
      const gust = env.gust;
      ctx.emit('spark', poisson(260 * dt * s * gust), { p: lift, v: () => wind.clone().multiplyScalar((9 + Math.random() * 7) * gust), life: [0.35, 0.7], size: [0.01, 0.016], stretch: 0.14, curl: 4, curlScale: 0.8, colors: ctx.cols('core', 'main'), bright: 2.2 * ctx.B, fadeIn: 0.05, hook: env.hook({}) });
      ctx.emit('mist', poisson(30 * dt * s * gust), { p: lift, v: () => wind.clone().multiplyScalar((5 + Math.random() * 4) * gust), life: [0.6, 1.1], size: [0.5, 0.8], stretch: 0.1, curl: 3.2, curlScale: 0.7, colors: ctx.cols('main', 'accent'), bright: 0.22 * ctx.B, fadeIn: 0.1, hook: env.hook({}) });
      ctx.emit('shard', poisson(34 * dt * s), { p: lift, v: () => wind.clone().multiplyScalar(4 + Math.random() * 3).add(new THREE.Vector3(0, 1 + Math.random(), 0)), life: [1.2, 2], size: [0.03, 0.05], spin: [-14, 14], curl: 3.5, curlScale: 0.9, colors: [new THREE.Color(0.35, 0.55, 0.2), new THREE.Color(0.25, 0.4, 0.12), new THREE.Color(0.4, 0.33, 0.15)], bright: 0.9, fadeIn: 0.1, hook: env.hook({}) });
      ctx.emit('smoke', poisson(22 * dt * s), { p: () => at().setY(ctx.floor + 0.15), v: () => wind.clone().multiplyScalar(3 + Math.random() * 2), life: [0.9, 1.4], size: [0.3, 0.5], grow: 2, curl: 2, curlScale: 0.8, colors: [new THREE.Color(0.36, 0.34, 0.3), new THREE.Color(0.22, 0.21, 0.2)], fadeIn: 0.2, hook: env.hook({}) });
      if (Math.random() < dt * 5 * gust) {
        const c = env.center.clone().add(new THREE.Vector3((Math.random() - 0.5) * env.R * 1.6, 0.4 + Math.random() * 2, (Math.random() - 0.5) * env.R * 1.6));
        const ang = Math.atan2(wind.z, wind.x) + (Math.random() - 0.5) * 1.2;
        const tilt = (Math.random() - 0.5) * 0.9;
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + tilt, 0, 0)).premultiply(new THREE.Quaternion().setFromAxisAngle(UP, -ang));
        const r = (0.8 + Math.random() * 0.9) * s;
        ctx.band(c, { radius: r, inner: 0.9, a0: Math.random() * Math.PI * 2, span: 1.4 + Math.random(), fadeS: 0.5, fadeE: 0.2, spin: (Math.random() < 0.5 ? -1 : 1) * (5 + Math.random() * 4), quat: q, dur: 0.45, noise: 1, hard: 0.2, grow: (k) => 0.7 + 0.5 * ease.outCubic(k), colors: ['core', 'main', 'accent'], bright: 1.8 });
      }
    },
    strike(ctx, at, _top, s) {
      if (Math.random() < 0.3) ctx.tornado(at, { radius: 0.32 * s, height: 1.6 * s, dur: 1.3, debris: 0.4 });
      else ctx.emitShape('spark', 30, { type: 'circle', at: at.clone().setY(at.y + 0.2), r: 0.5 * s }, { tangent: 7, v: () => new THREE.Vector3(0, 3, 0), life: [0.3, 0.55], size: [0.01, 0.016], stretch: 0.08, curl: 2, colors: ctx.cols('core', 'main'), bright: 1.8 * ctx.B });
    },
  },
  earth: {
    cloud: 'none',
    fall(ctx, at, slant, dt, s, _env) {
      const wind = slant.clone().setY(0).normalize();
      const sand = ctx.pal.smoke!.clone().lerp(new THREE.Color(0.55, 0.42, 0.28), 0.7);
      ctx.emit('smoke', poisson(85 * dt * s), { p: () => at().setY(0.2 + Math.random() * 2.2), v: () => wind.clone().multiplyScalar(4 + Math.random() * 3), life: [0.9, 1.4], size: [0.5, 0.9], grow: 1.6, curl: 2.2, curlScale: 0.7, hook: _env.hook({}), colors: [sand, sand.clone().multiplyScalar(0.6)], fadeIn: 0.2 });
      ctx.emit('mote', poisson(160 * dt * s), { p: () => at().setY(0.2 + Math.random() * 2.4), v: () => wind.clone().multiplyScalar(7 + Math.random() * 5), life: [0.5, 0.9], size: [0.015, 0.025], stretch: 0.07, curl: 3, curlScale: 0.8, hook: _env.hook({}), colors: ctx.cols('main', 'accent'), bright: 1.4 * ctx.B });
    },
    strike(ctx, at, top, s) {
      ctx.rocks(top.clone().lerp(at, 0.7), 2, 0.9 * s, () => new THREE.Vector3((Math.random() - 0.5) * 2, -6, (Math.random() - 0.5) * 2));
    },
  },
  water: {
    cloud: 'smoke',
    fall(ctx, at, slant, dt, s, env) {
      ctx.emit('spark', poisson(700 * dt * s), { p: at, v: () => slant.clone().multiplyScalar(13 + Math.random() * 4), life: 1.5, size: [0.012, 0.018], stretch: 0.14, colors: ctx.cols('core', 'main'), bright: 2.2 * ctx.B, fadeIn: 0, alphaCurve: 'hold', curl: env.curl, curlScale: 0.7, hook: env.hook(dropHook(ctx)) });
    },
    ground(ctx, at, dt, s) {
      ctx.emit('mist', poisson(14 * dt * s), { p: at, v: () => randomDir().setY(0.1).multiplyScalar(0.5), life: [1, 1.5], size: [0.4, 0.7], grow: 1.4, colors: ctx.cols('main', 'accent'), bright: 0.35 * ctx.B, fadeIn: 0.3 });
    },
  },
  light: {
    cloud: 'mist',
    fall(ctx, at, slant, dt, s, env) {
      ctx.emit('mote', poisson(60 * dt * s), { p: at, v: () => slant.clone().multiplyScalar(4 + Math.random() * 2), life: 2, size: [0.025, 0.045], colors: ctx.cols('core', 'main'), bright: 2.4 * ctx.B, fadeIn: 0.1, alphaCurve: 'hold', curl: env.curl, curlScale: 0.7, hook: env.hook({ floorKill: true, onFloor: (q) => { if (Math.random() < 0.3) ctx.star(q.clone().setY(q.y + 0.05), 0.25, 0.2, 2); } }) });
    },
    strike(ctx, at, top, s) {
      ctx.beam(() => top.clone().setX(at.x).setZ(at.z), () => at, { radius: 0.18 * s, dur: 0.35, fadeIn: 0.04, flow: -10 });
      ctx.star(at.clone().setY(at.y + 0.1), 0.9 * s, 0.2, 2.2);
    },
  },
  dark: {
    cloud: 'smoke',
    fall(ctx, at, slant, dt, s, env) {
      ctx.emit('spark', poisson(90 * dt * s), { p: at, v: () => slant.clone().multiplyScalar(11 + Math.random() * 3), life: 1.5, size: [0.012, 0.02], stretch: 0.05, colors: ctx.cols('main', 'accent'), bright: 1.4 * ctx.B, fadeIn: 0, alphaCurve: 'hold', curl: env.curl, curlScale: 0.7, hook: env.hook({ floorKill: true, onFloor: (q) => { if (Math.random() < 0.2) ctx.smoke(q.clone().setY(q.y + 0.1), 1, { jitter: 0.05, speed: [0.2, 0.4], size: [0.15, 0.25], delay: 0 }); } }) });
    },
    strike(ctx, at, _top, s) {
      ctx.voidSphere(at.clone().setY(at.y + 0.4), 0.45 * s, 0.6);
    },
  },
  poison: {
    cloud: 'smoke',
    fall(ctx, at, slant, dt, s, env) {
      ctx.emit('spark', poisson(80 * dt * s), { p: at, v: () => slant.clone().multiplyScalar(9 + Math.random() * 3), life: 1.8, size: [0.018, 0.028], stretch: 0.06, colors: ctx.cols('core', 'main'), bright: 1.1 * ctx.B, fadeIn: 0, alphaCurve: 'hold', curl: env.curl, curlScale: 0.7, hook: env.hook({ floorKill: true, onFloor: (q) => {
        if (Math.random() > 0.25) return;
        ctx.emit('bubble', 2, { p: q.clone().setY(q.y + 0.03), jitter: 0.06, v: () => new THREE.Vector3(0, 0.15, 0), life: [0.3, 0.6], size: [0.03, 0.06], grow: 1.8, colors: ctx.cols('main', 'accent'), bright: 0.9 * ctx.B, fadePow: 0.4 });
      } }) });
    },
    ground(ctx, at, dt, s) {
      const sludge = ctx.pal.smoke!;
      ctx.emit('smoke', poisson(14 * dt * s), { p: at, v: () => randomDir().setY(0.05).multiplyScalar(0.4), life: [1.4, 2], size: [0.5, 0.8], grow: 1.5, colors: [sludge.clone().lerp(ctx.pal.main, 0.25), sludge], fadeIn: 0.3 });
    },
  },
  arcane: {
    cloud: 'mist',
    fall(ctx, at, slant, dt, s, env) {
      ctx.emit('star', poisson(10 * dt * s), { p: at, v: () => slant.clone().multiplyScalar(6 + Math.random() * 3), life: 2, size: [0.1, 0.16], colors: ctx.cols('core', 'main'), bright: 2 * ctx.B, fadeIn: 0.05, alphaCurve: 'hold', curl: env.curl, curlScale: 0.7, hook: env.hook({ floorKill: true, onFloor: (q) => { if (Math.random() < 0.35) ctx.band(q.clone().setY(q.y + 0.02), { radius: 0.35, inner: 0.75, dur: 0.4, noise: 0.5 }); } }) });
      ctx.emit('glyph', poisson(8 * dt * s), { p: at, v: () => slant.clone().multiplyScalar(3 + Math.random() * 2), life: 2, size: [0.1, 0.15], spin: [-2, 2], colors: ctx.cols('core', 'main'), bright: 1.8 * ctx.B, fadeIn: 0.1, alphaCurve: 'hold', curl: env.curl, curlScale: 0.7, hook: env.hook({ floorKill: true }) });
    },
  },
};

export function storm(ctx: Ctx, p: P): void {
  const s = ctx.scale;
  const B = ctx.B * ctx.glare;
  const R = p.radius * s;
  const H = 4.4 * s;
  const w = WEATHER[ctx.element] ?? WEATHER.water;
  ctx.part('cast');
  ctx.charge(ctx.from(), p.charge, { radius: 0.5, aim: UP.clone(), ground: ctx.from() });
  const ph = Math.random() * Math.PI * 2;
  const center = () => ctx.ground(ctx.to());
  const c0 = center();
  const wind = new THREE.Vector3();
  const slant = new THREE.Vector3();
  const vortex = { kind: 'vortex' as const, power: 0, at: c0.clone(), shape: 'tube' as const, max: R * 1.8, falloff: 0.4 };
  const push = { kind: 'wind' as const, power: 0, axis: new THREE.Vector3(1, 0, 0) };
  const fields = [vortex, push];
  const env: Env = { hook: (h) => ctx.hook({ ...h, fields }), curl: 1.3, gust: 1, center: c0.clone(), R };
  const weather = (age: number) => {
    const g = 0.75 + 0.25 * Math.sin(age * 1.9) + 0.2 * Math.sin(age * 4.7 + 1.3);
    env.gust = Math.min(Math.max(g, 0.4), 1.3);
    const a = ph + 0.45 * Math.sin(age * 0.7);
    wind.set(Math.cos(a), 0, Math.sin(a));
    const k = p.slant * (0.6 + 0.8 * env.gust);
    slant.set(wind.x * k, -1, wind.z * k).normalize();
    vortex.power = 5 * env.gust;
    vortex.at.copy(center());
    push.axis.copy(wind);
    push.power = 3.5 * env.gust;
    env.center.copy(center());
  };
  weather(0);
  ctx.after(p.charge, () => ctx.handle.emit('release'));
  ctx.part('main');
  const total = p.dur + 1;
  if (ctx.element === 'wind' || ctx.element === 'earth')
    ctx.after(p.charge, () => {
      const life = total - 0.4;
      const cyc = { at: center, dur: life, grow: (k: number): [number, number] => [0.4 + 0.6 * ease.outExpo(clamp01((k * life) / 0.6)), ease.outCubic(clamp01((k * life) / 0.8))], fade: (k: number) => Math.min((k * life) / 0.2, 1) * (1 - ease.inQuad(span(k, 0.8, 1))), erodeTilt: () => 0.6, sway: 0.1 * R, swayF: 1.2 };
      const earth = ctx.element === 'earth';
      ctx.lathe(center(), { ...cyc, profile: 'funnel', radius: 1.05 * R, height: 3 * s, twist: 4, tiles: [6, 1.4], streak: 0.85, rim: 0.7, bright: earth ? 0.45 : 0.55, colors: earth ? ['main', 'accent', 'smoke'] : undefined, turnRate: () => 3.2 * env.gust, erode: () => 0.15 });
      ctx.lathe(center(), { ...cyc, profile: 'cone', radius: 1.15 * R, top: 0.6 * R, height: 0.5 * s, twist: 3, tiles: [7, 1], streak: 0.7, rim: 0.3, fadeLo: 0.2, fadeHi: 0.5, bright: 0.5, turnRate: () => 4 * env.gust });
    });
  ctx.part('mark');
  ctx.after(p.charge * 0.6, () => {
    const c = center();
    ctx.circle(c, 1.15 * R, total, { slot: 'target', spin: 0.3, bright: 0.55 });
    ctx.band(c.clone().setY(c.y + 0.03), { radius: R * 1.05, inner: 0.9, dur: total, noise: 1, spin: 0.4, kFn: (k) => span(k, 0.85, 1), grow: (k) => ease.outCubic(clamp01((k * total) / 0.5)), bright: 1.2 });
  });
  ctx.part('main');
  const smoke = ctx.pal.smoke ?? ctx.pal.accent.clone().multiplyScalar(0.25);
  const cloudCol = w.cloud === 'smoke' ? [smoke.clone().lerp(new THREE.Color(0.3, 0.3, 0.33), 0.5).multiplyScalar(1.3), smoke.clone().multiplyScalar(0.8)] : null;
  const belly = cloudCol ? [cloudCol[1].clone().multiplyScalar(0.7), cloudCol[1].clone().multiplyScalar(0.45)] : null;
  const top = () => center().setY(ctx.floor + H);
  const cloudHook = ctx.hook({ fields: [{ kind: 'vortex', power: 2.2, at: top(), shape: 'tube', max: R * 2.2, falloff: 0.3 }] });
  ctx.during(0, p.charge + total - 0.4, (_k, dt, age) => {
    weather(age);
    const build = clamp01(age / (p.charge + 0.6));
    const fade = 1 - span(age, p.charge + total - 1.2, p.charge + total - 0.4);
    const on = build * fade;
    const t = top();
    const cloudAt = (dy = 0) => () => t.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2 * R * 1.3, dy + (Math.random() - 0.5) * 0.5, (Math.random() - 0.5) * 2 * R * 1.3));
    if (cloudCol && belly) {
      ctx.emit('haze', poisson(28 * dt * on), { p: cloudAt(), v: () => wind.clone().multiplyScalar(0.8), life: [1.6, 2.4], size: [1.2 * s, 1.8 * s], grow: 1.4, curl: 0.9, curlScale: 0.5, colors: cloudCol, fadeIn: 0.35, fadePow: 1.3, hook: cloudHook });
      ctx.emit('haze', poisson(18 * dt * on), { p: cloudAt(-0.7), v: () => wind.clone().multiplyScalar(1.2), life: [1.2, 1.8], size: [0.8 * s, 1.2 * s], grow: 1.5, curl: 1.4, curlScale: 0.6, colors: belly, fadeIn: 0.3, fadePow: 1.3, hook: cloudHook });
    } else if (w.cloud === 'mist') ctx.emit('mist', poisson(24 * dt * on), { p: cloudAt(), v: () => wind.clone().multiplyScalar(0.8), life: [1.4, 2.2], size: [1.2 * s, 1.8 * s], grow: 1.3, curl: 1, curlScale: 0.5, colors: ctx.cols('main', 'accent'), bright: 0.3 * B, fadeIn: 0.35, hook: cloudHook });
    if (ctx.element === 'thunder' && Math.random() < dt * 5 * on) ctx.glow(cloudAt()(), 1.8 * s, 0.1, 0.9, ['core', 'main']);
    if (age < p.charge) return;
    const inArea = (y: number) => () => {
      const a = Math.random() * Math.PI * 2;
      const r = R * Math.sqrt(Math.random());
      return center().add(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    };
    const rainAt = () => inArea(0)().addScaledVector(slant, -H * 0.85).addScaledVector(wind, -R * 0.3);
    w.fall(ctx, rainAt, slant, dt * on * p.density * env.gust, 1, env);
    if (ctx.element !== 'wind' && ctx.element !== 'light' && ctx.element !== 'arcane') {
      const sheetCol = ctx.pal.smoke ? [ctx.pal.smoke.clone().multiplyScalar(3), ctx.pal.smoke.clone().multiplyScalar(1.6)] : ctx.cols('main', 'accent');
      ctx.emit('mist', poisson(9 * dt * on * env.gust), { p: () => inArea(0.3 + Math.random() * 2.2)().addScaledVector(wind, -R), v: () => wind.clone().multiplyScalar((4 + Math.random() * 3) * env.gust), life: [0.9, 1.4], size: [0.7 * s, 1.1 * s], stretch: 0.3, curl: 1.6, curlScale: 0.6, colors: sheetCol, bright: 0.28 * B, fadeIn: 0.25, hook: env.hook({}) });
    }
    if (w.ground) w.ground(ctx, inArea(0.15), dt * on, 1);
    const gusts = (ctx.element === 'wind' ? 26 : ctx.element === 'light' || ctx.element === 'arcane' ? 3 : 8) * env.gust * on;
    if (Math.random() < dt * gusts) {
      const c = center().setY(ctx.floor + 0.2 + Math.random() * 2.6);
      const r = R * (0.35 + 0.75 * Math.random());
      ctx.helix({ center: c, r0: r, r1: r * (0.8 + 0.3 * Math.random()), height: (Math.random() - 0.3) * 0.8, turns: 0.3 + Math.random() * 0.35, phase: Math.random() * Math.PI * 2, width: (0.04 + Math.random() * 0.08) * s, dur: 0.35 + Math.random() * 0.25, lag: 0.85, hold: 0.05, ease: ease.inOutCubic, bright: ctx.element === 'wind' ? 2.2 : 1.1 });
    }
  });
  ctx.part('hit');
  let next = p.charge + 0.3;
  let first = true;
  ctx.during(p.charge, total - 0.6, (_k, _dt, age) => {
    const t = age + p.charge;
    if (t < next) return;
    next = t + (0.18 + (Math.random() * 0.35) / p.density) / env.gust;
    const onTarget = first || Math.random() < 0.3;
    first = false;
    const a = Math.random() * Math.PI * 2;
    const r = onTarget ? 0 : R * Math.sqrt(Math.random());
    const at = center().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
    w.strike?.(ctx, at, top(), s);
    if (ctx.element === 'thunder') ctx.glow(top().setX(at.x).setZ(at.z), 2.2 * s, 0.07, 1.4, ['core', 'main']);
    if (onTarget || r < 0.6) ctx.hit(ctx.to(), 0.5 * p.power, 'tick');
  }, () => {
    const at = ctx.to();
    const g = center();
    w.strike?.(ctx, g, top(), 1.6 * s);
    ctx.impact(at, { power: p.power, scale: 1.2, extra: true, role: 'final', dir: slant });
  });
}
storm.defaults = { circleFeet: 1, circleTarget: 3, charge: 0.6, dur: 3, radius: 3.2, slant: 0.35, density: 1, power: 1.5 };

export function drill(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const B = ctx.B * ctx.glare;
  const aim = aimOf(ctx);
  const len = 1.5 * s;
  const rad = 0.36 * s;
  ctx.part('cast');
  ctx.handle.emit('cast');
  const hand = () => ctx.from().addScaledVector(aim, 0.2);
  ctx.circle(hand(), 0.8 * ctx.scale, p.form + 0.2, { normal: aim, spin: -3, bright: 1.8, slot: 'hand' });
  ctx.circle(ctx.ground(ctx.from()), 1.3 * ctx.scale, p.form + 0.5, { spin: 1.4, bright: 1.4, slot: 'feet' });
  const head = new THREE.Vector3();
  let base = hand();
  let spinRate = 6;
  let jitter = 0;
  const drillAt = () => base.clone().add(randomDir().multiplyScalar(jitter));
  const flightDur = Math.max(ctx.from().distanceTo(ctx.to()) / p.speed, 0.12);
  const total = p.form + flightDur + p.grind + 0.35;
  const grow = (k: number): [number, number] => {
    const t = k * total;
    const g = ease.outBackStrong(clamp01(t / p.form));
    const out = 1 - ease.inCubic(span(t, total - 0.2, total));
    return [Math.max(g * out, 0.01), Math.max(g, 0.01)];
  };
  ctx.lathe(hand(), { profile: 'cone', axis: aim, at: drillAt, radius: rad * 0.95, top: 0.01, height: len * 0.98, twist: 22, tiles: [3, 5], streak: 0.2, rim: -0.6, fadeLo: 0.001, fadeHi: 0.001, dur: total, bright: 1, smoke: true, colors: ['core', 'accent', 'accent'], grow, turnRate: () => spinRate * 2.2 });
  ctx.lathe(hand(), { profile: 'cone', axis: aim, at: drillAt, radius: rad, top: 0.01, height: len, twist: 22, tiles: [3, 5], streak: 0.3, rim: 0.6, fadeLo: 0.08, fadeHi: 0.02, dur: total, bright: 1.6, grow, turnRate: () => spinRate * 2.2 });
  ctx.lathe(hand(), { profile: 'cone', axis: aim, at: drillAt, radius: rad * 1.25, top: 0.02, height: len * 1.1, twist: -10, flow: -3, tiles: [6, 2], streak: 0.9, rim: 0.9, fadeLo: 0.1, fadeHi: 0.1, dur: total, bright: 0.9, grow, turnRate: () => -spinRate * 1.4 });
  ctx.during(0, p.form, (k, dt) => {
    spinRate = 6 + 20 * ease.inQuad(k);
    ctx.emitShape('spark', poisson(120 * dt), { type: 'sphere', at: base.clone().addScaledVector(aim, len * 0.5), r: 0.9 * s }, { hook: ctx.hook({ seek: { target: base.clone().addScaledVector(aim, len * 0.5), speed: 5, steer: 8, arrive: 0.1 } }), v: () => new THREE.Vector3(), life: 0.5, size: [0.012, 0.02], stretch: 0.05, colors: ctx.cols('core', 'main'), bright: 2.4 * B, alphaCurve: 'hold' });
  });
  ctx.after(p.form, () => {
    ctx.handle.emit('release');
    ctx.part('fly');
    const a = hand();
    const contact = ctx.to().addScaledVector(aim, -len - 0.25);
    const ang = ctx.screenAngle(a, aim);
    ctx.wave(a, 0.9, 0.3, 0.7);
    ctx.band(a.clone().addScaledVector(aim, len * 0.6), { radius: 0.8 * s, inner: 0.8, normal: aim, dur: 0.25, hard: 0.6, noise: 1 });
    ctx.during(0, flightDur, (k, dt) => {
      base = a.clone().lerp(contact, ease.inQuad(k));
      head.copy(base).addScaledVector(aim, len);
      ctx.handle.head.copy(head);
      ctx.emitShape('spark', poisson(160 * dt), { type: 'circle', at: base.clone().addScaledVector(aim, len * 0.3), r: rad * 1.1, axis: aim }, { tangent: 5, v: () => aim.clone().multiplyScalar(-4), life: [0.12, 0.25], size: [0.01, 0.018], stretch: 0.05, colors: ctx.cols('core', 'main'), bright: 2.4 * B, fadeIn: 0 });
      if (Math.random() < dt * 12) ctx.band(base.clone().addScaledVector(aim, len * 0.5), { radius: 0.9 * s, inner: 0.85, normal: aim, dur: 0.22, hard: 0.5, noise: 1 });
      if (Math.random() < dt * 8) ctx.lines(base, { size: 2 * s, parallel: ang, dur: 0.2, count: 16, width: 0.3, bright: 1 });
    }, () => {
      ctx.part('hit');
      const tip = contact.clone().addScaledVector(aim, len);
      ctx.hit(ctx.to(), 0.8 * p.power, 'first');
      ctx.wave(tip, 1.2, 0.3, 1);
      const light = ctx.hold(5);
      let next = 0;
      ctx.during(0, p.grind, (k, dt, age) => {
        jitter = 0.035 * s;
        spinRate = 26 + 10 * k;
        base = contact.clone().addScaledVector(aim, 0.35 * ease.inQuad(k));
        const t = base.clone().addScaledVector(aim, len);
        ctx.emitShape('spark', poisson(420 * dt), { type: 'circle', at: t, r: 0.25 * s, axis: aim }, { tangent: [6, 10], outward: [1, 3], v: () => aim.clone().multiplyScalar(-2), life: [0.15, 0.35], size: [0.012, 0.022], gravity: 6, drag: 1.5, stretch: 0.05, colors: ctx.cols('core', 'main', 'accent'), bright: 3 * B, fadeIn: 0, bounce: 0.3 });
        ctx.emitShape('shard', poisson(40 * dt), { type: 'circle', at: t, r: 0.25 * s, axis: aim }, { tangent: [3, 6], outward: [1, 2], life: [0.4, 0.7], size: [0.03, 0.06], gravity: 8, spin: [-12, 12], colors: ctx.cols('main', 'accent'), bright: 1.6 * B, fadeIn: 0 });
        if (Math.random() < dt * 20) ctx.glow(t, (0.4 + 0.3 * Math.random()) * s, 0.06, 2);
        light.set(t, 30 * (1.2 + 0.6 * Math.random()));
        if (age >= next) {
          next = age + 0.09;
          ctx.hit(ctx.to(), 0.4 * p.power, 'tick');
        }
        ctx.efx.trail(ctx, { head: t, prev: t.clone().addScaledVector(aim, -0.3), vel: aim.clone().multiplyScalar(3), dt, s: 0.5 * s, density: 0.6 });
      }, () => {
        light.release(0.2);
        jitter = 0;
        const through = ctx.to().addScaledVector(aim, 0.3);
        ctx.during(0, 0.12, (k) => {
          base = contact.clone().addScaledVector(aim, 0.35 + 1.4 * ease.outExpo(k));
        });
        ctx.impact(through, { power: p.power, dir: aim, ringNormal: aim, scale: 1.1 * p.size, extra: true, role: 'final' });
        ctx.lathe(through, { profile: 'cone', axis: aim, radius: 0.2 * s, top: 1.1 * s, height: 2.6 * s, flow: -6, tiles: [7, 1.5], streak: 1, rim: 0.7, fadeLo: 0.05, fadeHi: 0.5, dur: 0.35, bright: 1.3, grow: (k) => [1, 0.3 + 0.7 * ease.outExpo(clamp01(k * 3))], erode: (k) => ease.inQuad(span(k, 0.3, 1)), edge: 0.1 });
        for (let j = 1; j <= 3; j++) ctx.band(through.clone().addScaledVector(aim, 0.5 * j), { radius: (0.5 + 0.35 * j) * s, inner: 0.82, normal: aim, hard: 0.6, noise: 1, dur: 0.3, delay: 0.03 * j });
      });
    });
  });
}
drill.defaults = { circleFeet: 1, circleHand: 1, form: 0.45, speed: 14, grind: 0.6, size: 1, power: 1.7 };

export function finale(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const B = ctx.B * ctx.glare;
  const body = () => ctx.to();
  ctx.part('main');
  ctx.handle.emit('cast');
  const rays = Math.round(p.rays);
  const light = ctx.hold(6);
  const crack = p.crack;
  ctx.during(0, crack, (k, dt, age) => {
    const c = body();
    light.set(c, 30 * (0.5 + 2.5 * ease.inQuad(k)) * (0.8 + 0.4 * Math.sin(age * 40)));
    if (Math.random() < dt * 25) ctx.glow(c.clone().add(randomDir().multiplyScalar(0.25 * s)), (0.25 + 0.5 * k) * s, 0.08, 1 + 1.5 * k);
    ctx.emitShape('spark', poisson(60 * dt * (0.3 + k)), { type: 'sphere', at: c, r: 0.35 * s }, { outward: [2, 5], life: [0.15, 0.3], size: [0.01, 0.018], stretch: 0.05, drag: 2, colors: ctx.cols('core', 'main'), bright: 2.6 * B, fadeIn: 0 });
    if (ctx.fx.feel) ctx.fx.shake(dt * 0.5 * (0.3 + k));
  });
  for (let i = 0; i < rays; i++) {
    const t = (i / rays) * crack * 0.9 + Math.random() * 0.05;
    ctx.after(t, () => {
      const dir = randomDir();
      dir.y = Math.abs(dir.y) * 0.8 + 0.1;
      dir.normalize();
      const L = (2.5 + Math.random() * 2) * s;
      const from = () => body();
      const dur = crack - t + 0.5;
      ctx.beam(from, () => body().addScaledVector(dir, L * ease.outExpo(clamp01(0.3 + (Math.random() * 0.01)))), { radius: (0.05 + Math.random() * 0.05) * s, dur, fadeIn: 0.05, fadeOut: 0.3, flow: 14 });
      ctx.star(body().addScaledVector(dir, 0.25 * s), 0.4 * s, 0.12, 2.5);
    });
  }
  const pops = Math.round(p.pops);
  for (let i = 0; i < pops; i++) {
    const t = crack * (0.2 + 0.75 * (i / Math.max(pops - 1, 1))) + Math.random() * 0.05;
    ctx.after(t, () => {
      const q = body().add(randomDir().multiply(new THREE.Vector3(0.5, 0.8, 0.5)).multiplyScalar(s));
      ctx.glow(q, 0.8 * s, 0.2, 1.8);
      ctx.burst(q, { count: 25, speed: 4, scale: 0.45 * s });
      ctx.light(q, 1.2, 0.2);
      ctx.smoke(q, 4, { size: [0.25 * s, 0.4 * s], delay: 0.05 });
      ctx.hit(ctx.to(), 0.5, i === 0 ? 'first' : 'tick');
    });
  }
  ctx.after(crack, () => {
    ctx.during(0, p.implode, (k, dt) => {
      const c = body();
      ctx.emitShape('mote', poisson(220 * dt), { type: 'sphere', at: c, r: 2.2 * s }, { hook: ctx.hook({ seek: { target: c, speed: 8, steer: 10, arrive: 0.12 } }), v: () => new THREE.Vector3(), life: 0.6, size: [0.02, 0.035], stretch: 0.06, colors: ctx.cols('core', 'main'), bright: 2.4 * B, alphaCurve: 'hold' });
      if (Math.random() < dt * 30) ctx.glow(c, (0.6 + 1.2 * ease.inQuad(k)) * s, 0.06, 1.5 + 2 * k);
    });
  });
  ctx.after(crack + p.implode, () => {
    ctx.handle.emit('release');
    light.release(0.6);
    const c = body();
    const g = ctx.ground(c);
    ctx.screenFlash(0.18);
    ctx.lathe(g, { profile: 'dome', radius: 3.2 * s, height: 2.4 * s, tiles: [7, 1.5], streak: 0.4, rim: 1, flow: 1.2, dur: 0.8, bright: 0.8, grow: (k) => 0.1 + 0.9 * ease.outExpo(clamp01(k * 1.4)), erode: (k) => Math.max(k - 0.25, 0) / 0.75, edge: 0.08, fade: (k) => 1 - k * k });
    for (let i = 0; i < 3; i++) ctx.band(g.clone().setY(g.y + 0.03), { radius: (3 + i * 1.2) * s, inner: 0.82, dur: 0.6 + i * 0.12, delay: i * 0.08, noise: 1 });
    ctx.band(c, { radius: 2.4 * s, inner: 0.78, normal: 'camera', hard: 0.7, noise: 1, dur: 0.4 });
    ctx.impact(c, { power: p.power, scale: 1.25 * s, extra: true, role: 'final' });
    ctx.emit('mote', 60 * s, { p: c, jitter: 0.6 * s, v: () => randomDir().multiplyScalar(1.5).add(new THREE.Vector3(0, 1, 0)), life: [1.5, 2.8], size: [0.02, 0.04], drag: 1.2, gravity: -0.3, flicker: 0.4, curl: 0.6, colors: ctx.cols('core', 'main'), bright: 2.4 * B, alphaCurve: 'bell' });
    ctx.during(0.1, 1.4, (_k, dt) => ctx.smoke(g.clone().setY(g.y + 0.4), poisson(26 * dt), { jitter: 0.6 * s, speed: [0.6, 1.4], size: [0.45 * s, 0.75 * s], life: [1.6, 2.4], delay: 0 }));
  });
}
finale.defaults = { crack: 1.1, rays: 9, pops: 6, implode: 0.35, size: 1, power: 2 };
