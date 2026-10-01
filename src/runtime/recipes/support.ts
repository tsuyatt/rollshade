import * as THREE from 'three/webgpu';
import { clamp01, ease, poisson, span, type Ctx } from '../ctx';
import { randomDir } from '../particles';

const UP = new THREE.Vector3(0, 1, 0);

type P = Record<string, number>;

const SYMBOL: Record<string, number> = { light: 2, water: 2, ice: 2, fire: 2, thunder: 2, arcane: 0, wind: 3, earth: 3, poison: 3, dark: 0 };

function bodyHeight(ctx: Ctx, p: THREE.Vector3): number {
  return Math.min(Math.max(ctx.heightAboveFloor(p) * 1.5, 1.2), 2.4);
}

function healFlavor(ctx: Ctx, g: () => THREE.Vector3, h: number, r: number, dt: number, k: number): void {
  const B = ctx.B * ctx.glare;
  const at = g();
  const body = { type: 'body' as const, at, r: r * 0.8, h: h * 0.8 };
  switch (ctx.element) {
    case 'water':
      ctx.emitShape('bubble', poisson(18 * dt), body, { v: () => new THREE.Vector3(0, 0.6 + Math.random() * 0.4, 0), life: [1, 1.6], size: [0.04, 0.08], sizeCurve: 'bell', colors: ctx.cols('core', 'main'), bright: 1.3 * B, fadeIn: 0.1 });
      if (Math.random() < dt * 2.5) ctx.band(at.clone().setY(at.y + 0.02), { radius: r * 1.6, inner: 0.85, dur: 0.9, noise: 0, bright: 1 });
      break;
    case 'wind':
      ctx.emitShape('mist', poisson(20 * dt), body, { v: () => new THREE.Vector3(0, 1, 0), tangent: 1.5, life: [0.6, 1], size: [0.12, 0.2], stretch: 0.15, colors: ctx.cols('core', 'main'), bright: 0.6 * B, fadeIn: 0.1 });
      break;
    case 'earth':
      ctx.emitShape('shard', poisson(14 * dt), { type: 'disc', at, r: r * 1.3 }, { v: () => new THREE.Vector3(0, 0.7 + Math.random() * 0.5, 0), life: [1, 1.5], size: [0.05, 0.09], spin: [-2, 2], colors: ctx.cols('core', 'main', 'accent'), bright: 1.4 * B, fadeIn: 0.1, alphaCurve: 'hold', dissolve: 0.8 });
      break;
    case 'ice':
      ctx.emitShape('shard', poisson(16 * dt), body, { v: () => new THREE.Vector3(0, 0.5 + Math.random() * 0.4, 0), life: [0.9, 1.4], size: [0.04, 0.07], spin: [-3, 3], colors: ctx.cols('core', 'main'), bright: 2 * B, fadeIn: 0.1, sizeCurve: 'bell' });
      ctx.emitShape('mist', poisson(10 * dt), { type: 'disc', at, r: r * 1.2 }, { v: () => new THREE.Vector3(0, 0.3, 0), life: [1, 1.5], size: [0.3, 0.5], grow: 1.4, colors: ctx.cols('main', 'accent'), bright: 0.5 * B, fadeIn: 0.2 });
      break;
    case 'fire':
      ctx.emitShape('mote', poisson(40 * dt), body, { v: () => new THREE.Vector3(0, 0.8 + Math.random() * 0.6, 0), life: [0.8, 1.4], size: [0.02, 0.035], flicker: 0.5, curl: 1.2, colors: [ctx.pal.core, ctx.pal.core.clone().lerp(ctx.pal.main, 0.4)], bright: 2.4 * B });
      break;
    case 'thunder': {
      const beat = (k * 3.2) % 1;
      if (beat < dt * 3.2) {
        ctx.band(at.clone().setY(at.y + h * 0.5), { radius: r * 1.4, inner: 0.8, normal: 'up', dur: 0.3, noise: 1, bright: 1.6 });
        ctx.emitShape('spark', 20, body, { outward: 2.5, life: [0.12, 0.25], size: [0.01, 0.018], stretch: 0.04, colors: ctx.cols('core', 'main'), bright: 3 * B, fadeIn: 0 });
      }
      break;
    }
    case 'arcane':
      ctx.emitShape('glyph', poisson(10 * dt), { type: 'circle', at: at.clone().setY(at.y + h * (0.2 + 0.6 * Math.random())), r: r * 1.2 }, { tangent: 1.2, v: () => new THREE.Vector3(0, 0.25, 0), life: [0.9, 1.3], size: [0.1, 0.14], sizeCurve: 'bell', colors: ctx.cols('core', 'main'), bright: 1.8 * B, fadeIn: 0.1, hook: ctx.hook({ fields: [{ kind: 'vortex', power: 4, at, shape: 'tube', max: 3 }] }) });
      break;
    case 'dark': {
      const center = at.clone().setY(at.y + h * 0.5);
      ctx.emitShape('mote', poisson(70 * dt), { type: 'sphere', at: center, r: 2.4 }, { hook: ctx.hook({ seek: { target: center, speed: 3.5, steer: 3, arrive: 0.25 } }), v: () => randomDir().multiplyScalar(1.2), life: 2, size: [0.02, 0.04], stretch: 0.04, colors: [ctx.pal.core, new THREE.Color(0.9, 0.15, 0.2)], bright: 2.2 * B, fadeIn: 0.15, alphaCurve: 'hold' });
      ctx.smoke(at.clone().setY(at.y + 0.2), poisson(8 * dt), { jitter: r, speed: [0.2, 0.5], size: [0.3, 0.5], delay: 0 });
      break;
    }
    case 'poison':
      ctx.emitShape('bubble', poisson(22 * dt), body, { v: () => new THREE.Vector3(0, 0.5 + Math.random() * 0.4, 0), life: [0.8, 1.3], size: [0.04, 0.08], sizeCurve: 'bell', colors: ctx.cols('core', 'main'), bright: 1.1 * B, fadeIn: 0.1 });
      break;
    default:
      ctx.emitShape('star', poisson(6 * dt), body, { v: () => new THREE.Vector3(0, 0.6, 0), life: [0.6, 1], size: [0.08, 0.14], sizeCurve: 'bell', colors: ctx.cols('core', 'main'), bright: 2 * B });
  }
}

export function heal(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const B = ctx.B * ctx.glare;
  const r = p.radius * s;
  const aimFrom = ctx.from();
  ctx.part('cast');
  ctx.handle.emit('cast');
  const hand = ctx.to().sub(aimFrom).normalize();
  ctx.circle(aimFrom.clone().addScaledVector(hand, 0.15), 0.45 * ctx.scale, p.charge + 0.3, { normal: hand, spin: -1, bright: 1.6, slot: 'hand' });
  ctx.during(0, p.charge, (k, dt) => {
    ctx.emitShape('mote', poisson(70 * dt), { type: 'sphere', at: aimFrom, r: 0.6 * ctx.scale }, { hook: ctx.hook({ seek: { target: aimFrom, speed: 2.5, steer: 4, arrive: 0.08 } }), v: () => randomDir().multiplyScalar(0.8), life: 0.8, size: [0.02, 0.035], colors: ctx.cols('core', 'main'), bright: 2.2 * B, alphaCurve: 'hold', fadeIn: 0.1 });
    if (Math.random() < dt * 15) ctx.glow(aimFrom, (0.3 + 0.4 * k) * ctx.scale, 0.12, 1 + k);
  });
  ctx.after(p.charge, () => {
    ctx.handle.emit('release');
    const a = ctx.from();
    const n = Math.round(10 + 6 * p.symbols);
    for (let i = 0; i < n; i++)
      ctx.after(i * 0.02, () => {
        const target = () => ctx.to();
        ctx.emit('glow', 1, { p: a.clone(), v: () => randomDir().setY(Math.random() * 1.5).multiplyScalar(3), hook: ctx.hook({ seek: { target: target(), speed: 14, steer: 7, arrive: 0.35 } }), life: 1.2, size: [0.05, 0.08], colors: ctx.cols('core', 'main'), bright: 1.6 * B, alphaCurve: 'hold', fadeIn: 0.05, stretch: 0.05 });
      });
  });
  const land = p.charge + 0.35;
  ctx.part('main');
  const g = () => ctx.ground(ctx.to());
  const h = bodyHeight(ctx, ctx.to());
  const total = land + p.dur;
  ctx.circle(g(), 1.5 * r, total + 0.3 - p.charge * 0.5, { slot: 'target', spin: 0.5, bright: 1.3 });
  ctx.during(p.charge * 0.5, land - p.charge * 0.5, (_k, dt) => {
    ctx.emitShape('mote', poisson(40 * dt), { type: 'circle', at: g(), r: 1.6 * r }, { hook: ctx.hook({ fields: [{ kind: 'attract', power: 3, at: g(), max: 3 }] }), v: () => new THREE.Vector3(0, 0.3, 0), life: [0.5, 0.8], size: [0.02, 0.035], colors: ctx.cols('core', 'main'), bright: 2 * B, fadeIn: 0.1 });
  });
  ctx.after(land, () => {
    const at = g();
    const chest = at.clone().setY(at.y + h * 0.55);
    ctx.handle.emit('hit', { point: chest.clone(), power: 0, index: 0, shake: 0, hitStop: 0, role: 'final' });
    ctx.emit('glow', 1, { p: chest, speed: 0, life: 0.35, size: 1.3 * r, grow: 1.4, sizeCurve: 'burst', colors: ctx.cols('core', 'main'), bright: 1.4 * B, fadeIn: 0.1, alphaCurve: 'bell' });
    ctx.band(at.clone().setY(at.y + 0.03), { radius: 1.6 * r, inner: 0.7, dur: 0.7, noise: 0.6, grow: (k) => 0.3 + 0.7 * ease.outQuad(k) });
    ctx.light(chest, 2.2, 0.5);
    const dur = p.dur;
    const fadeCol = (k: number) => Math.min(k * dur / 0.25, 1) * (1 - ease.inQuad(span(k, 0.75, 1)));
    ctx.lathe(at, { profile: 'cone', radius: 1.05 * r, top: 0.75 * r, height: h * 1.35, flow: 0.8, twist: 1.2, tiles: [7, 1.2], streak: 1, rim: 0.85, fadeLo: 0.05, fadeHi: 0.65, dur, bright: 0.9, fade: fadeCol, erode: (k) => ease.inQuad(span(k, 0.7, 1)), grow: (k) => [1, ease.outCubic(clamp01((k * dur) / 0.45))], at: g });
    const ribbons = Math.round(p.ribbons);
    for (let i = 0; i < ribbons; i++) ctx.helix({ center: at, r0: 1.25 * r, r1: 0.65 * r, height: h * 1.1, turns: p.turns, phase: (i / ribbons) * Math.PI * 2, width: 0.16, dur: 0.9, lag: 0.8, hold: dur * 0.35, delay: 0.1 + i * 0.07, ease: ease.inOutCubic, bright: 1.6, at: g });
    const glyph = SYMBOL[ctx.element] ?? 2;
    const hook = ctx.hook({ fields: [{ kind: 'wind', power: 0.6, axis: UP }] });
    ctx.during(0, dur * 0.8, (k, dt) => {
      const at2 = g();
      ctx.emitShape('glyph', poisson(9 * p.symbols * dt), { type: 'body', at: at2, r: 0.7 * r, h: h * 0.9 }, { hook, v: () => new THREE.Vector3(0, 0.45 + Math.random() * 0.3, 0), life: [1.2, 1.9], size: [0.13, 0.2], sizeCurve: 'bell', alphaCurve: 'bell', colors: ctx.cols('core', 'main'), bright: 1.9 * B, fadeIn: 0, variant: glyph });
      ctx.emitShape('mote', poisson(35 * dt), { type: 'body', at: at2, r: 0.9 * r, h: h * 0.4 }, { hook, v: () => new THREE.Vector3(0, 0.6 + Math.random() * 0.6, 0), life: [0.9, 1.5], size: [0.018, 0.03], alphaCurve: 'bell', colors: ctx.cols('core', 'main'), bright: 2.4 * B, fadeIn: 0 });
      healFlavor(ctx, g, h, r, dt, k);
    });
    ctx.after(dur * 0.78, () => {
      const top = g();
      top.y += h * 0.6;
      ctx.emit('mote', 30, { p: top, jitter: 0.3 * r, v: () => randomDir().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.6, 0)), life: [0.6, 1], size: [0.02, 0.035], drag: 1.5, alphaCurve: 'bell', colors: ctx.cols('core', 'main'), bright: 2.4 * B });
      ctx.emit('glow', 1, { p: top, speed: 0, life: 0.5, size: 0.9 * r, colors: ctx.cols('core', 'main'), bright: 0.8 * B, alphaCurve: 'bell', fadeIn: 0 });
    });
    const light = ctx.hold(5);
    ctx.during(0, dur, (k) => light.set(g().setY(g().y + h * 0.5), 1.1 * 30 * fadeCol(k)), () => light.release(0.3));
  });
}
heal.defaults = { circleHand: 1, circleTarget: 1, charge: 0.3, dur: 1.6, radius: 0.65, size: 1, turns: 1.3, ribbons: 3, symbols: 1 };

function buffFlavor(ctx: Ctx, g: THREE.Vector3, h: number, r: number, dt: number, age: number, state: { rocks?: boolean; life?: number }): void {
  const B = ctx.B * ctx.glare;
  const body = { type: 'body' as const, at: g, r: r * 0.9, h: h * 0.7 };
  switch (ctx.element) {
    case 'fire':
      ctx.emitShape('flame', poisson(45 * dt), body, { v: () => new THREE.Vector3(0, 1.6 + Math.random(), 0), life: [0.3, 0.5], size: [0.14, 0.22], grow: 1.3, curl: 1.4, colors: ctx.cols('core', 'main', 'accent'), bright: 0.75 * B, fadeIn: 0.03 });
      break;
    case 'thunder':
      if (Math.random() < dt * 9) {
        const a = g.clone().add(new THREE.Vector3((Math.random() - 0.5) * r * 2, h * Math.random(), (Math.random() - 0.5) * r * 2));
        ctx.bolt(a, a.clone().add(randomDir().multiplyScalar(0.5 + Math.random() * 0.4)), { dur: 0.1, width: 0.05, jag: 0.35 });
      }
      if (Math.random() < dt * 12) ctx.glow(g.clone().setY(g.y + h * 0.55), 0.7 * r, 0.1, 0.8, ['core', 'main']);
      break;
    case 'ice':
      ctx.emitShape('shard', poisson(14 * dt), { type: 'circle', at: g.clone().setY(g.y + h * Math.random() * 0.8), r: r * 1.3 }, { tangent: 2, v: () => new THREE.Vector3(0, 0.4, 0), life: [0.8, 1.2], size: [0.04, 0.08], spin: [-4, 4], colors: ctx.cols('core', 'main'), bright: 2 * B, sizeCurve: 'bell', hook: ctx.hook({ fields: [{ kind: 'vortex', power: 3, at: g, shape: 'tube', max: 3 }] }) });
      ctx.emitShape('mist', poisson(12 * dt), { type: 'disc', at: g, r: r * 1.3 }, { v: () => new THREE.Vector3(0, 0.3, 0), life: [0.8, 1.2], size: [0.3, 0.45], grow: 1.4, colors: ctx.cols('main', 'accent'), bright: 0.5 * B, fadeIn: 0.2 });
      break;
    case 'earth':
      if (!state.rocks) {
        state.rocks = true;
        const center = g.clone();
        for (let i = 0; i < 6; i++) {
          const a0 = (i / 6) * Math.PI * 2;
          const y = h * (0.25 + 0.5 * Math.random());
          const rr = r * (1.35 + Math.random() * 0.3);
          const size = 0.07 + Math.random() * 0.06;
          ctx.fx.rocks.spawn({ p: center.clone(), size: new THREE.Vector3(size, size * 0.8, size), spin: 2 + Math.random() * 2, life: state.life ?? 4, grow: 0.25, shrink: 0.02, gravity: 12, bounce: 0.3, color: ctx.pal.main.clone().lerp(new THREE.Color(0.35, 0.3, 0.26), 0.6).multiplyScalar(0.32), drive: (pp, v, a2, d2) => {
            const th = a0 + a2 * 1.3;
            const bob = Math.sin(a2 * 2 + i) * 0.08;
            const prev = pp.clone();
            pp.set(center.x + Math.cos(th) * rr, center.y + y + bob, center.z + Math.sin(th) * rr);
            if (d2 > 0) v.subVectors(pp, prev).divideScalar(d2);
            return !!state.rocks && ctx.handle.playing;
          } });
        }
      }
      if (Math.random() < dt * 3) ctx.dust(g, 0.3);
      break;
    case 'wind':
      ctx.emitShape('spark', poisson(50 * dt), { type: 'circle', at: g.clone().setY(g.y + Math.random() * h), r: r * 1.2 }, { tangent: 7, v: () => new THREE.Vector3(0, 2.5, 0), life: [0.25, 0.45], size: [0.01, 0.016], stretch: 0.08, colors: ctx.cols('core', 'main'), bright: 1.8 * B, hook: ctx.hook({ fields: [{ kind: 'vortex', power: 12, at: g, shape: 'tube', max: 3 }, { kind: 'attract', power: 6, at: g, shape: 'tube', max: 3 }] }) });
      break;
    case 'water':
      ctx.emitShape('spark', poisson(30 * dt), body, { v: () => new THREE.Vector3((Math.random() - 0.5), 2 + Math.random() * 1.5, (Math.random() - 0.5)), gravity: 7, life: [0.5, 0.8], size: [0.018, 0.03], stretch: 0.03, colors: ctx.cols('core', 'main'), bright: 1.5 * B, hook: ctx.hook({ floorKill: true }) });
      ctx.emitShape('mist', poisson(25 * dt), body, { tangent: 2, v: () => new THREE.Vector3(0, 1.2, 0), life: [0.4, 0.7], size: [0.12, 0.2], stretch: 0.14, colors: ctx.cols('core', 'main', 'accent'), bright: 0.8 * B });
      break;
    case 'light':
      if (Math.random() < dt * 6) ctx.star(g.clone().add(new THREE.Vector3((Math.random() - 0.5) * r * 2, h * (0.2 + 0.8 * Math.random()), (Math.random() - 0.5) * r * 2)), 0.25, 0.25, 2);
      ctx.emitShape('mote', poisson(40 * dt), body, { v: () => new THREE.Vector3(0, 1.5, 0), life: [0.6, 1], size: [0.02, 0.04], colors: ctx.cols('core', 'main'), bright: 2.4 * B });
      break;
    case 'dark':
      ctx.emitShape('smoke', poisson(14 * dt), { type: 'body', at: g.clone().setY(g.y + h * 0.9), r: r, h: 0.3 }, { v: () => new THREE.Vector3(0, -0.6, 0), life: [0.8, 1.3], size: [0.25, 0.4], grow: 1.8, colors: [ctx.pal.smoke!.clone().multiplyScalar(1.4), ctx.pal.smoke!], fadeIn: 0.15 });
      ctx.emitShape('mote', poisson(25 * dt), body, { v: () => new THREE.Vector3(0, 1, 0), life: [0.5, 0.9], size: [0.02, 0.035], colors: ctx.cols('core', 'main'), bright: 2.2 * B });
      break;
    case 'poison':
      ctx.emitShape('bubble', poisson(24 * dt), body, { v: () => new THREE.Vector3(0, 0.8, 0), life: [0.5, 0.9], size: [0.04, 0.08], sizeCurve: 'bell', colors: ctx.cols('main', 'accent'), bright: 0.9 * B });
      ctx.emitShape('spark', poisson(10 * dt), body, { v: () => new THREE.Vector3(0, -0.2, 0), gravity: 6, life: [0.6, 1], size: [0.018, 0.03], stretch: 0.06, colors: ctx.cols('core', 'main'), bright: 1.1 * B, hook: ctx.hook({ floorKill: true }) });
      break;
    default:
      if (Math.floor(age * 1.2) !== Math.floor((age - dt) * 1.2)) for (const y of [0.3, 0.75]) ctx.circle(g.clone().setY(g.y + h * y), r * 2.2, 0.8, { spin: y > 0.5 ? -2 : 2, bright: 1.2, style: 3 });
      ctx.emitShape('glyph', poisson(6 * dt), body, { v: () => new THREE.Vector3(0, 0.8, 0), life: [0.6, 1], size: [0.08, 0.12], sizeCurve: 'bell', colors: ctx.cols('core', 'main'), bright: 1.8 * B });
  }
}

export function buff(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const B = ctx.B * ctx.glare;
  const r = p.radius * s;
  const g = () => ctx.ground(ctx.from());
  const h = p.height * s;
  const f = 1 / 60;
  ctx.part('cast');
  ctx.handle.emit('cast');
  ctx.circle(g(), 1.3 * ctx.scale, p.charge + 0.6, { slot: 'feet', spin: 1.2, bright: 1.6 });
  ctx.during(0, p.charge, (k, dt) => {
    const c = g().setY(g().y + h * 0.5);
    ctx.emitShape('mote', poisson(120 * dt), { type: 'sphere', at: c, r: 1.6 * s }, { hook: ctx.hook({ fields: [{ kind: 'attract', power: 14, at: c, max: 3 }] }), v: () => new THREE.Vector3(), life: [0.25, 0.4], size: [0.02, 0.04], stretch: 0.05, drag: 1.5, colors: ctx.cols('core', 'main'), bright: 2.4 * B, fadeIn: 0.05 });
    if (Math.random() < dt * 20) ctx.glow(c, (0.4 + 0.5 * k) * s, 0.1, 1 + k);
  });
  ctx.after(p.charge, () => {
    ctx.handle.emit('release');
    const at = g();
    const c = at.clone().setY(at.y + h * 0.5);
    const post = ctx.fx.post;
    if (post) {
      post.flashTint(ctx.pal.core);
      post.blinkAmount = (ctx.fx.photosensitive ? 0.05 : 0.1) * ctx.glare;
      post.blinkT = 2 * f;
    }
    ctx.band(at.clone().setY(at.y + 0.03), { radius: 3 * s, inner: 0.6, dur: 0.45, noise: 1, grow: (k) => 0.12 + 0.88 * ease.outExpo(k) });
    ctx.band(c, { radius: 1.6 * s, inner: 0.82, normal: 'camera', dur: 0.3, hard: 0.6, noise: 1 });
    ctx.lines(c, { size: 3 * s, dur: 0.3, count: 40, density: 0.5, inner: 0.5, width: 0.14, bright: 1.1 });
    ctx.dust(at, 1.3 * s);
    ctx.emitShape('spark', 50, { type: 'circle', at: at.clone().setY(at.y + 0.1), r: 0.4 * s }, { outward: [5, 9], v: () => new THREE.Vector3(0, 1 + Math.random() * 2, 0), life: [0.3, 0.55], size: [0.012, 0.022], drag: 3, stretch: 0.05, colors: ctx.cols('core', 'main'), bright: 3 * B, fadeIn: 0 });
    ctx.fx.lights.flash(c, ctx.pal.main, 3 * 18 * ctx.glare, 0.35, 7);
    if (ctx.fx.feel) ctx.fx.shake(0.25);
  });
  ctx.part('main');
  const hold = p.hold;
  const start = p.charge + 0.02;
  const warn = Math.min(1, hold * 0.3);
  const life = (k: number) => {
    const age = k * hold;
    const blink = age > hold - warn ? 0.55 + 0.45 * Math.cos((age - (hold - warn)) * Math.PI * 2 * 4) : 1;
    const pulse = 1 + 0.2 * Math.sin(age * Math.PI * 2 * p.pulse);
    return clamp01(age / 0.2) * blink * pulse * (1 - ease.inQuad(span(age, hold - 0.4, hold)));
  };
  const size = (k: number): [number, number] => {
    const age = k * hold;
    const pop = age < 0.25 ? ease.outBackStrong(age / 0.25) : 1;
    const pulse = 1 + 0.06 * Math.sin(age * Math.PI * 2 * p.pulse);
    return [pop * pulse, pop * (1 + 0.04 * Math.sin(age * Math.PI * 2 * p.pulse + 1))];
  };
  const erodeEnd = (base: number) => (k: number) => base + (1 - base) * ease.inQuad(span(k * hold, hold - 0.4, hold));
  const dark = ctx.element === 'dark';
  ctx.after(start, () => {
    const opts = { at: g, dur: hold, fade: life, grow: size, fadeLo: 0.02 };
    ctx.lathe(g(), { ...opts, profile: 'cylinder', radius: 1.15 * r, top: 0.8 * r, height: h * 1.3, flow: 2.6 * p.rate, twist: 1.9, tiles: [6, 1.6], streak: 0.5, rim: 0.4, fadeHi: 0.6, wobble: 0.1, bright: dark ? 0.9 : 1.1, erode: erodeEnd(0.42), edge: 0.12, smoke: dark, colors: dark ? ['core', 'smoke', 'smoke'] : undefined });
    ctx.lathe(g(), { ...opts, profile: 'cylinder', radius: 0.9 * r, top: 0.5 * r, height: h * 1.5, flow: 3.3 * p.rate, twist: -1.2, tiles: [8, 2], streak: 0.7, rim: 0.2, fadeHi: 0.55, bright: 1.1, erode: erodeEnd(0.55), edge: 0.12, wobble: 0.12 });
    ctx.lathe(g(), { ...opts, profile: 'vase', radius: 0.8 * r, height: h * 0.95, bulge: 0.2, flow: 1.6 * p.rate, twist: 0.8, tiles: [5, 1], streak: 0.6, rim: 0.9, fadeHi: 0.35, bright: 0.7 });
    ctx.lathe(g(), { ...opts, profile: 'dome', radius: 1.3 * r, height: 0.35 * s, flow: 1.5, tiles: [6, 1], streak: 0.7, rim: 0.5, bright: 0.8, erode: erodeEnd(0.3) });
    const state: { rocks?: boolean; life?: number } = { life: hold + 1.2 };
    const light = ctx.hold(6);
    ctx.during(0, hold, (k, dt, age) => {
      const at = g();
      const on = life(k);
      ctx.emitShape('spark', poisson(45 * p.rate * dt * Math.min(on, 1)), { type: 'body', at, r: 0.9 * r, h: h * 0.6 }, { v: () => new THREE.Vector3(0, 2 + Math.random() * 2, 0), life: [0.4, 0.8], size: [0.012, 0.02], stretch: 0.06, drag: 0.5, colors: ctx.cols('core', 'main'), bright: 2.6 * B, fadeIn: 0 });
      if (age < hold - 0.3) buffFlavor(ctx, at, h, r, dt, age, state);
      light.set(at.setY(at.y + h * 0.5), 1.2 * 30 * on);
    }, () => {
      state.rocks = false;
      light.release(0.3);
      const at = g();
      ctx.smoke(at.clone().setY(at.y + 0.2), 8, { jitter: 0.3, speed: [0.3, 0.8], size: [0.3, 0.5], delay: 0 });
      ctx.emit('mote', 25, { p: at.clone().setY(at.y + h * 0.5), jitter: 0.4, v: () => randomDir().multiplyScalar(1).add(new THREE.Vector3(0, 0.8, 0)), life: [0.5, 0.9], size: [0.02, 0.035], drag: 1.5, colors: ctx.cols('core', 'main'), bright: 2 * B, alphaCurve: 'bell' });
    });
  });
}
buff.defaults = { circleFeet: 1, charge: 0.3, hold: 2.6, radius: 0.55, height: 2, size: 1, rate: 1, pulse: 1.8 };
