import * as THREE from 'three/webgpu';
import { poisson, type Ctx } from './ctx';
import { coneDir, randomDir, type Orbit } from './particles';

const UP = new THREE.Vector3(0, 1, 0);

export interface BurstArgs {
  n: number;
  sp: number;
  s: number;
  vel: (min: number, max: number) => () => THREE.Vector3;
}

export interface TrailArgs {
  head: THREE.Vector3;
  prev: THREE.Vector3;
  vel: THREE.Vector3;
  dt: number;
  s: number;
  density: number;
}

export interface DecalStyle {
  tint: (c: Ctx) => THREE.Color;
  ember: 'core' | 'main' | 'accent';
  glow: number;
  decay: number;
  crackScale: number;
  crackWidth: number;
  alpha: number;
  core: number;
}

export interface CircleLook {
  sidesA: number;
  skipA: number;
  sidesB?: number;
  skipB?: number;
  rotB?: number;
  spokes?: number;
  branch?: number;
  spiral?: number;
  waves?: number;
  dots?: number;
  petals?: number;
  runes?: number;
  ticks?: number;
}

export const CIRCLES: Record<string, CircleLook> = {
  plain: { sidesA: 0, skipA: 1, dots: 4, runes: 0, ticks: 1 },
  fire: { sidesA: 3, skipA: 1, sidesB: 3, skipB: 1, rotB: Math.PI / 3, petals: 6, dots: 6, runes: 1, ticks: 0 },
  ice: { sidesA: 6, skipA: 1, spokes: 6, branch: 1, dots: 6, runes: 2, ticks: 1 },
  thunder: { sidesA: 8, skipA: 3, spokes: 8, waves: 24, runes: 1, ticks: 1 },
  wind: { sidesA: 0, skipA: 1, spiral: 3, dots: 3, runes: 2, ticks: 0 },
  earth: { sidesA: 4, skipA: 1, sidesB: 4, skipB: 1, rotB: Math.PI / 4, dots: 8, runes: 3, ticks: 1 },
  water: { sidesA: 0, skipA: 1, waves: 12, dots: 12, petals: 0, runes: 2, ticks: 0 },
  light: { sidesA: 12, skipA: 5, spokes: 24, petals: 12, runes: 1, ticks: 1 },
  dark: { sidesA: 5, skipA: 2, sidesB: 5, skipB: 1, rotB: Math.PI / 5, spokes: 10, dots: 5, runes: 3, ticks: 0 },
  poison: { sidesA: 7, skipA: 3, waves: 7, dots: 7, runes: 1, ticks: 0 },
  arcane: { sidesA: 6, skipA: 1, sidesB: 6, skipB: 1, rotB: Math.PI / 6, dots: 12, runes: 3, ticks: 1 },
};

export interface ElementFX {
  burst(c: Ctx, p: THREE.Vector3, a: BurstArgs): void;
  trail(c: Ctx, a: TrailArgs): void;
  decal: DecalStyle | null;
  extra(c: Ctx, p: THREE.Vector3, pw: number, s: number): void;
  sparks: number;
  glare?: number;
  physical?: boolean;
  swirl?(c: Ctx, around: (r: number, y?: number) => () => THREE.Vector3, orbit: (w: number, rise: number, r0: number, r1: number, h: number, pull?: number) => Orbit, rate: number): void;
}

const along = (a: TrailArgs) => () => a.prev.clone().lerp(a.head, Math.random());
const back = (a: TrailArgs, k: number) => a.vel.clone().multiplyScalar(-k);
const rate = (a: TrailArgs, r: number) => poisson(r * a.dt * a.density);

function ringPoints(p: THREE.Vector3, n: number, r: number, jitter = 0.3): THREE.Vector3[] {
  const out: THREE.Vector3[] = [];
  const off = Math.random() * Math.PI * 2;
  for (let i = 0; i < n; i++) {
    const a = off + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * jitter;
    const rr = r * (0.8 + Math.random() * 0.4);
    out.push(new THREE.Vector3(p.x + Math.cos(a) * rr, p.y, p.z + Math.sin(a) * rr));
  }
  return out;
}

function splash(c: Ctx, chance: number) {
  return c.hook({
    floorKill: true,
    onFloor: (p) => {
      if (Math.random() > chance) return;
      c.emit('spark', 4, { p, v: () => new THREE.Vector3((Math.random() - 0.5) * 1.6, 1.2 + Math.random() * 1.4, (Math.random() - 0.5) * 1.6), life: [0.2, 0.35], size: [0.012, 0.02], gravity: 9, colors: c.cols('core', 'main'), bright: 1.4 * c.B, fadeIn: 0 });
      c.band(p.clone().setY(p.y + 0.01), { radius: 0.18 + Math.random() * 0.12, inner: 0.72, dur: 0.4, noise: 0, bright: 1.2 });
    },
  });
}

function acid(c: Ctx, chance: number) {
  return c.hook({
    floorKill: true,
    onFloor: (p) => {
      if (Math.random() > chance) return;
      c.emit('bubble', 2, { p: p.clone().setY(p.y + 0.03), jitter: 0.06, v: () => new THREE.Vector3(0, 0.15, 0), life: [0.3, 0.6], size: [0.03, 0.06], grow: 1.8, colors: c.cols('main', 'accent'), bright: 0.9 * c.B, fadePow: 0.4 });
      c.emit('smoke', 1, { p: p.clone().setY(p.y + 0.05), v: () => new THREE.Vector3(0, 0.25, 0), life: [0.6, 1], size: [0.1, 0.16], grow: 2, colors: [c.pal.smoke!.clone().lerp(c.pal.main, 0.35), c.pal.smoke!], fadeIn: 0.1 });
    },
  });
}

export const ELEMENT_FX: Record<string, ElementFX> = {
  plain: {
    sparks: 1.3,
    glare: 0.75,
    physical: true,
    swirl(c, around, orbit, rate) {
      c.emit('spark', poisson(40 * rate), { p: around(0.8, 0.3), orbit: orbit(10, 2, 0.4, 1, 1), life: [0.15, 0.3], size: [0.01, 0.018], stretch: 0.04, colors: c.cols('core', 'main'), bright: 2.4 * c.B, fadeIn: 0 });
      c.emit('mote', poisson(25 * rate), { p: around(1), orbit: orbit(6, 1.5, 0.5, 1.1, 1), life: [0.5, 0.9], size: [0.015, 0.025], colors: c.cols('core', 'main'), bright: 1.6 * c.B });
    },
    burst(c, p, { n, s, sp, vel }) {
      const B = c.B;
      c.emit('spark', n * 0.7, { p, jitter: 0.05 * s, v: vel(sp * 0.6, sp * 1.6), life: [0.15, 0.45], size: [0.01, 0.022], gravity: 9, drag: 1.4, stretch: 0.04, bounce: 0.25, colors: c.cols('core', 'main'), bright: 2.8 * B, fadeIn: 0 });
      c.emit('shard', n * 0.12, { p, jitter: 0.08 * s, v: vel(sp * 0.3, sp * 0.9), life: [0.4, 0.8], size: [0.02 * s, 0.045 * s], gravity: 9, drag: 1, spin: [-12, 12], bounce: 0.3, colors: [c.pal.main.clone().multiplyScalar(0.8), c.pal.accent, c.pal.accent], bright: 1.1 * B, fadeIn: 0 });
      c.smoke(p, n * 0.06 * s, { size: [0.22 * s, 0.4 * s], speed: [0.6, 1.6], gravity: -0.2, delay: [0, 0.05] });
    },
    trail(c, a) {
      c.emit('spark', rate(a, 60), { p: along(a), jitter: 0.03 * a.s, v: () => back(a, 0.05).add(randomDir().multiplyScalar(0.8)), life: [0.08, 0.2], size: [0.008, 0.014], gravity: 6, stretch: 0.03, colors: c.cols('core', 'main'), bright: 2.2 * c.B, fadeIn: 0 });
    },
    decal: { tint: (c) => (c.pal.smoke ?? c.pal.accent).clone().multiplyScalar(0.5), ember: 'accent', glow: 0, decay: 2, crackScale: 5, crackWidth: 0.05, alpha: 0.7, core: 0 },
    extra(c, p, pw, s) {
      const g = c.ground(p);
      c.dust(g, 1.4 * s);
      c.emitShape('spark', 40 * pw, { type: 'circle', at: g.clone().setY(g.y + 0.05), r: 0.3 * s }, { outward: [3, 7], v: () => new THREE.Vector3(0, 1.5 + Math.random() * 2, 0), life: [0.2, 0.45], size: [0.01, 0.02], gravity: 9, stretch: 0.04, colors: c.cols('core', 'main'), bright: 2.6 * c.B, fadeIn: 0 });
    },
  },
  fire: {
    sparks: 1,
    swirl(c, around, orbit, rate) {
      c.emit('flame', poisson(55 * rate), { p: around(0.8, 0.4), orbit: orbit(8, 2.4, 0.5, 1.1, 0.9), life: [0.35, 0.6], size: [0.18, 0.3], grow: 1.5, colors: c.cols('core', 'main', 'accent'), bright: 0.9 * c.B, fadeIn: 0.03 });
      c.emit('mote', poisson(40 * rate), { p: around(1), orbit: orbit(7, 2, 0.5, 1.2, 1.1), life: [0.8, 1.4], size: [0.02, 0.035], flicker: 0.6, colors: c.cols('core', 'main'), bright: 2.4 * c.B });
    },
    burst(c, p, { n, s, sp, vel }) {
      const B = c.B;
      c.emit('flame', n * 0.3, { p, jitter: 0.12 * s, v: vel(sp * 0.2, sp * 0.55), life: [0.4, 0.8], size: [0.28 * s, 0.5 * s], grow: 1.8, gravity: -2.2, drag: 3.6, turb: 1, curl: 1.6, curlScale: 1.5, colors: c.cols('core', 'main', 'accent'), bright: 1.7 * B, fadeIn: 0.03, fadePow: 1.1 });
      c.emit('flame', n * 0.12, { p, jitter: 0.2 * s, v: vel(sp * 0.05, sp * 0.2), life: [0.5, 0.9], size: [0.45 * s, 0.7 * s], grow: 1.5, gravity: -1.6, drag: 3, curl: 1.2, curlScale: 1.1, colors: c.cols('core', 'main', 'accent'), bright: 1.3 * B, fadeIn: 0.04, fadePow: 1.2, delay: [0, 0.06] });
      c.emit('mist', n * 0.12, { p, jitter: 0.25 * s, v: vel(sp * 0.1, sp * 0.3), life: [0.5, 0.9], size: [0.12 * s, 0.2 * s], gravity: -1.5, drag: 2, curl: 2.4, curlScale: 1.8, stretch: 0.14, colors: c.cols('main', 'accent'), bright: 1.4 * B, fadeIn: 0.05 });
      c.emit('mote', n * 0.15, { p, jitter: 0.2 * s, v: vel(sp * 0.1, sp * 0.4), life: [0.8, 1.6], size: [0.02, 0.035], gravity: -0.8, drag: 1.5, curl: 2.2, curlScale: 2, flicker: 0.6, colors: c.cols('core', 'main'), bright: 2.4 * B });
      c.smoke(p, n * 0.12 * s, { size: [0.35 * s, 0.6 * s], delay: [0.08, 0.25], curl: 0.9, curlScale: 1.2, dissolve: 0.6 });
    },
    trail(c, a) {
      const B = c.B;
      c.emit('flame', rate(a, 110), { p: along(a), jitter: 0.07 * a.s, v: () => back(a, 0.06).add(randomDir().multiplyScalar(0.6)), life: [0.3, 0.55], size: [0.18 * a.s, 0.32 * a.s], grow: 1.6, gravity: -2.4, drag: 2.5, curl: 1.4, curlScale: 1.8, colors: c.cols('core', 'main', 'accent'), bright: 1.5 * B, fadeIn: 0.02, fadePow: 1.1 });
      c.emit('mist', rate(a, 35), { p: along(a), jitter: 0.08 * a.s, v: () => back(a, 0.08), life: [0.3, 0.6], size: [0.08 * a.s, 0.14 * a.s], gravity: -1.2, curl: 2.4, curlScale: 2, stretch: 0.14, colors: c.cols('main', 'accent'), bright: 1.3 * B });
      c.smoke(along(a)(), rate(a, 26), { jitter: 0.08, speed: [0.2, 0.5], life: [0.8, 1.4], size: [0.18 * a.s, 0.3 * a.s], delay: [0.05, 0.12], curl: 0.8 });
    },
    decal: { tint: (c) => c.pal.smoke!.clone().multiplyScalar(0.4), ember: 'main', glow: 2.5, decay: 1.6, crackScale: 4.5, crackWidth: 0.08, alpha: 0.9, core: 0.6 },
    extra(c, p, pw, s) {
      const g = c.ground(p);
      c.during(0, 0.35, (_k, dt) => {
        c.emit('flame', poisson(160 * dt * pw), { p: () => g.clone().add(randomDir().multiply(new THREE.Vector3(0.5 * s, 0, 0.5 * s))), v: () => new THREE.Vector3((Math.random() - 0.5) * 0.6, 2.5 + Math.random() * 2.5, (Math.random() - 0.5) * 0.6).multiplyScalar(Math.sqrt(s)), life: [0.35, 0.6], size: [0.25 * s, 0.4 * s], grow: 1.5, drag: 2, curl: 2, curlScale: 1.4, colors: c.cols('core', 'main', 'accent'), bright: 1.6 * c.B, fadeIn: 0.03 });
      });
    },
  },
  ice: {
    sparks: 0.6,
    swirl(c, around, orbit, rate) {
      c.emit('shard', poisson(40 * rate), { p: around(1.2), orbit: orbit(7, 1.6, 0.5, 1.1, 1), life: [0.8, 1.3], size: [0.04, 0.09], spin: [-9, 9], colors: c.cols('core', 'main'), bright: 2 * c.B });
      c.emit('mist', poisson(30 * rate), { p: around(0.8), orbit: orbit(6, 1.4, 0.6, 1.2, 1), life: [0.6, 1], size: [0.3, 0.5], grow: 1.5, colors: c.cols('main', 'accent'), bright: 0.6 * c.B, fadeIn: 0.1 });
    },
    burst(c, p, { n, s, sp, vel }) {
      const B = c.B;
      c.emit('shard', n * 0.45, { p, jitter: 0.1 * s, v: vel(sp * 0.4, sp * 1.2), life: [0.5, 0.9], size: [0.05 * s, 0.1 * s], gravity: 8, drag: 1.2, stretch: 0.025, bounce: 0.3, colors: c.cols('core', 'main', 'accent'), bright: 2.2 * B, fadeIn: 0, fadePow: 1.3 });
      c.emit('mist', n * 0.15, { p, jitter: 0.2 * s, v: vel(sp * 0.05, sp * 0.25), life: [0.7, 1.2], size: [0.4 * s, 0.7 * s], grow: 1.8, drag: 2.5, colors: c.cols('main', 'accent'), bright: 0.8 * B, fadeIn: 0.05 });
      c.emit('star', n * 0.08, { p, jitter: 0.5 * s, v: vel(0, sp * 0.2), life: [0.3, 0.7], size: [0.12 * s, 0.22 * s], grow: 0.3, drag: 3, colors: c.cols('core', 'main'), bright: 2 * B, fadeIn: 0.05, flicker: 0.4 });
    },
    trail(c, a) {
      const B = c.B;
      c.emit('mist', rate(a, 50), { p: along(a), jitter: 0.06 * a.s, v: () => back(a, 0.05).add(randomDir().multiplyScalar(0.3)), life: [0.4, 0.7], size: [0.2 * a.s, 0.35 * a.s], grow: 1.8, drag: 2, colors: c.cols('main', 'accent'), bright: 0.9 * B, fadeIn: 0.03 });
      c.emit('shard', rate(a, 40), { p: along(a), jitter: 0.1 * a.s, v: () => back(a, 0.1).add(randomDir().multiplyScalar(1)), life: [0.3, 0.6], size: [0.03 * a.s, 0.06 * a.s], gravity: 3, spin: [-8, 8], colors: c.cols('core', 'main'), bright: 2 * B, fadeIn: 0 });
      c.emit('mote', rate(a, 30), { p: along(a), jitter: 0.15 * a.s, v: () => randomDir().multiplyScalar(0.3), life: [0.6, 1.1], size: [0.02, 0.035], gravity: 0.6, turb: 1.5, flicker: 0.5, colors: c.cols('core', 'main'), bright: 2 * B });
    },
    decal: { tint: (c) => c.pal.main.clone().multiplyScalar(0.28), ember: 'core', glow: 1.1, decay: 0.25, crackScale: 7, crackWidth: 0.06, alpha: 0.8, core: 0.25 },
    extra(c, p, pw, s) {
      const g = c.ground(p);
      const pts = ringPoints(g, Math.round(7 + 3 * pw), 0.9 * s);
      pts.forEach((q, i) => c.after(i * 0.025, () => c.spike(q, g, (0.7 + Math.random() * 0.6) * s, 'crystal', 1.1)));
      c.spike(g, g, 1.3 * s, 'crystal', 1.2);
    },
  },
  thunder: {
    sparks: 1.5,
    swirl(c, around, orbit, rate) {
      c.emit('spark', poisson(60 * rate), { p: around(0.7, 0.3), orbit: orbit(12, 3, 0.4, 1, 1), life: [0.15, 0.35], size: [0.01, 0.02], stretch: 0.05, colors: c.cols('core', 'main'), bright: 3.5 * c.B, fadeIn: 0 });
      if (Math.random() < rate * 5) {
        const a = around(0.4, 1.5 + Math.random() * 1.5)();
        c.bolt(a, a.clone().add(randomDir().multiplyScalar(0.9)), { dur: 0.12, width: 0.08, jag: 0.3 });
      }
    },
    burst(c, p, { n, s, sp, vel }) {
      const B = c.B;
      c.emit('spark', n * 0.5, { p, jitter: 0.05 * s, v: vel(sp, sp * 2.2), life: [0.12, 0.3], size: [0.012 * s, 0.022 * s], drag: 3, stretch: 0.03, colors: c.cols('core', 'main'), bright: 3.5 * B, fadeIn: 0, fadePow: 0.8 });
      for (let i = 0; i < 3 + Math.round(n / 40); i++) c.bolt(p, p.clone().add(randomDir().multiplyScalar((0.8 + Math.random() * 0.8) * s)), { dur: 0.18, width: 0.12 * s, jag: 0.25, branches: 1 });
      c.emit('glow', n * 0.06, { p, jitter: 0.4 * s, speed: 0, life: [0.05, 0.12], size: [0.3 * s, 0.6 * s], colors: c.cols('core', 'main'), bright: 1.4 * B, fadeIn: 0, delay: [0, 0.2] });
    },
    trail(c, a) {
      const B = c.B;
      if (Math.random() < a.dt * 18) c.bolt(a.head, a.head.clone().add(randomDir().multiplyScalar(0.5 * a.s)), { dur: 0.08, width: 0.06 * a.s, jag: 0.3 });
      c.emit('spark', rate(a, 120), { p: along(a), jitter: 0.08 * a.s, v: () => randomDir().multiplyScalar(2 + Math.random() * 3), life: [0.08, 0.2], size: [0.01, 0.018], drag: 4, stretch: 0.03, colors: c.cols('core', 'main'), bright: 3 * B, fadeIn: 0 });
      c.emit('glow', rate(a, 40), { p: along(a), jitter: 0.1 * a.s, speed: 0, life: [0.05, 0.1], size: [0.15 * a.s, 0.3 * a.s], colors: c.cols('main', 'accent'), bright: 1.2 * B, fadeIn: 0 });
    },
    decal: { tint: (c) => c.pal.accent.clone().multiplyScalar(0.06), ember: 'main', glow: 3, decay: 3, crackScale: 6, crackWidth: 0.06, alpha: 0.9, core: 0.3 },
    extra(c, p, pw, s) {
      const top = p.clone().add(new THREE.Vector3((Math.random() - 0.5) * 2, 7, (Math.random() - 0.5) * 2));
      const g = c.ground(p);
      c.bolt(top, g, { dur: 0.3, width: 0.35 * s, jag: 0.12, branches: 3, flicker: true });
      c.after(0.07, () => c.bolt(top, g, { dur: 0.2, width: 0.25 * s, jag: 0.14, branches: 2 }));
      c.screenFlash(0.15 * pw);
      c.light(g.clone().setY(g.y + 1.5), 5 * pw, 0.3, 12);
    },
  },
  wind: {
    sparks: 0.5,
    swirl(c, around, orbit, rate) {
      c.emit('mist', poisson(50 * rate), { p: around(0.9), orbit: orbit(9, 2, 0.5, 1.1, 1), life: [0.5, 0.9], size: [0.14, 0.24], stretch: 0.16, colors: c.cols('core', 'main', 'accent'), bright: 0.7 * c.B, fadeIn: 0.05 });
      c.emit('shard', poisson(20 * rate), { p: around(1.4), orbit: orbit(6, 1.2, 0.6, 1.3, 1.1), life: [1.2, 1.8], size: [0.05, 0.09], spin: [-12, 12], colors: [new THREE.Color(0.35, 0.55, 0.2), new THREE.Color(0.25, 0.4, 0.12), new THREE.Color(0.4, 0.33, 0.15)], bright: 0.9, fadeIn: 0.1 });
    },
    burst(c, p, { n, s, sp }) {
      const B = c.B;
      c.emit('spark', n * 0.6, {
        p: () => p.clone().add(randomDir().multiplyScalar(0.3 * s)),
        v: () => {
          const r = randomDir().setY(0).normalize();
          return new THREE.Vector3(-r.z, 0.2 + Math.random() * 0.4, r.x).multiplyScalar(sp * (0.6 + Math.random() * 0.6)).addScaledVector(r, sp * 0.3);
        },
        life: [0.35, 0.7],
        size: [0.012 * s, 0.02 * s],
        drag: 1.5,
        swirl: 6,
        center: p,
        curl: 3,
        curlScale: 1.2,
        stretch: 0.07,
        colors: c.cols('core', 'main', 'accent'),
        bright: 1.8 * B,
        fadeIn: 0.05,
      });
      c.emit('mist', n * 0.25, { p, jitter: 0.3 * s, v: () => randomDir().setY(0.2).multiplyScalar(sp * 0.35), life: [0.5, 0.9], size: [0.18 * s, 0.3 * s], grow: 1.6, drag: 2.5, swirl: 4, center: p, curl: 3, curlScale: 1.3, stretch: 0.16, colors: c.cols('core', 'main', 'accent'), bright: 0.7 * B, fadeIn: 0.05 });
    },
    trail(c, a) {
      const B = c.B;
      const dir = a.vel.clone().normalize();
      const side = dir.clone().cross(UP).normalize();
      const up = side.clone().cross(dir).normalize();
      const n = rate(a, 140);
      for (let i = 0; i < n; i++) {
        const ang = Math.random() * Math.PI * 2;
        const r = (0.12 + Math.random() * 0.2) * a.s;
        const off = side.clone().multiplyScalar(Math.cos(ang) * r).addScaledVector(up, Math.sin(ang) * r);
        const tan = side.clone().multiplyScalar(-Math.sin(ang)).addScaledVector(up, Math.cos(ang)).multiplyScalar(4 * a.s);
        c.emit('spark', 1, { p: along(a)().add(off), v: () => tan.clone().addScaledVector(dir, -2), life: [0.15, 0.3], size: [0.01, 0.016], drag: 2, stretch: 0.06, curl: 2, colors: c.cols('core', 'main'), bright: 1.6 * B, fadeIn: 0.02 });
      }
      c.emit('mist', rate(a, 40), { p: along(a), jitter: 0.12, v: () => back(a, 0.05), life: [0.35, 0.6], size: [0.1 * a.s, 0.18 * a.s], grow: 1.8, curl: 3, curlScale: 1.6, stretch: 0.16, colors: c.cols('core', 'main', 'accent'), bright: 0.7 * B });
    },
    decal: null,
    extra(c, p, pw, s) {
      const g = c.ground(p);
      c.tornado(g, { radius: 0.85 * s, height: 3 * s * Math.sqrt(pw), dur: 1.6, power: pw });
      c.ring(g, 1.6 * s, { dur: 0.45, thick: 0.05, delay: 0 });
      c.ring(g.clone().setY(g.y + 0.6), 1.2 * s, { dur: 0.4, thick: 0.05, delay: 0.06 });
      c.during(0, 0.6, (k, dt) => {
        const around = () => {
          const a = Math.random() * Math.PI * 2;
          const r = (0.3 + k * 0.6) * s;
          return g.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.random() * 0.3, Math.sin(a) * r));
        };
        c.emit('spark', poisson(200 * dt * pw), { p: around, v: () => new THREE.Vector3(0, 3 + Math.random() * 2, 0), life: [0.3, 0.6], size: [0.01, 0.018], swirl: 9, center: g, drag: 0.5, curl: 1.5, stretch: 0.07, colors: c.cols('core', 'main'), bright: 1.6 * c.B });
        c.emit('mist', poisson(60 * dt * pw), { p: around, v: () => new THREE.Vector3(0, 2 + Math.random() * 2, 0), life: [0.4, 0.8], size: [0.15 * s, 0.25 * s], swirl: 7, center: g, curl: 2.5, stretch: 0.15, colors: c.cols('core', 'main', 'accent'), bright: 0.6 * c.B });
      });
    },
  },
  earth: {
    sparks: 0.5,
    swirl(c, around, orbit, rate) {
      c.emit('shard', poisson(35 * rate), { p: around(1.3), orbit: orbit(6, 1.3, 0.6, 1.2, 0.9), life: [1, 1.6], size: [0.05, 0.1], spin: [-10, 10], colors: [c.pal.smoke!.clone().multiplyScalar(1.8), c.pal.smoke!, c.pal.accent.clone().multiplyScalar(0.5)], bright: 0.9, fadeIn: 0.1 });
    },
    burst(c, p, { n, s, sp, vel }) {
      c.rocks(p, Math.round(n * 0.12), s, vel(sp * 0.4, sp * 0.9));
      c.dust(p, s * 1.2);
      c.smoke(p, n * 0.1, { size: [0.3 * s, 0.5 * s], speed: [0.8, 2], gravity: -0.3, delay: [0, 0.1] });
      c.emit('glow', n * 0.05, { p, jitter: 0.1 * s, v: vel(sp * 0.05, sp * 0.2), life: [0.2, 0.4], size: [0.25 * s, 0.4 * s], grow: 1.6, drag: 3, colors: c.cols('main', 'accent'), bright: 1 * c.B });
    },
    trail(c, a) {
      if (Math.random() < a.dt * 12) c.rocks(a.head, 1, a.s * 0.5, () => back(a, 0.1).add(randomDir().multiplyScalar(1)));
      c.smoke(along(a)(), rate(a, 30), { jitter: 0.08, speed: [0.1, 0.4], life: [0.6, 1], size: [0.15 * a.s, 0.25 * a.s], delay: 0 });
      c.emit('mote', rate(a, 20), { p: along(a), jitter: 0.1, v: () => randomDir().multiplyScalar(0.3), life: [0.4, 0.8], size: [0.02, 0.03], gravity: 2, colors: c.cols('main', 'accent'), bright: 1.4 * c.B });
    },
    decal: { tint: (c) => c.pal.smoke!.clone().multiplyScalar(0.55), ember: 'accent', glow: 0.8, decay: 0.8, crackScale: 3.4, crackWidth: 0.11, alpha: 0.95, core: 0.1 },
    extra(c, p, pw, s) {
      const g = c.ground(p);
      const pts = ringPoints(g, Math.round(9 + 4 * pw), 0.85 * s, 0.25);
      pts.forEach((q, i) => c.after(i * 0.025, () => c.spike(q, g, (0.6 + Math.random() * 0.6) * s, 'rock', 1)));
      c.spike(g, g, 1.1 * s, 'rock', 1.1);
      c.dust(g, 1.6 * s);
    },
  },
  water: {
    sparks: 0.3,
    swirl(c, around, orbit, rate) {
      c.emit('spark', poisson(60 * rate), { p: around(0.9), orbit: orbit(9, 2.2, 0.45, 1.05, 1), life: [0.5, 0.9], size: [0.02, 0.035], stretch: 0.04, colors: c.cols('core', 'main'), bright: 1.6 * c.B });
      c.emit('mist', poisson(45 * rate), { p: around(0.8), orbit: orbit(8, 1.8, 0.5, 1.1, 1), life: [0.5, 0.9], size: [0.14, 0.24], stretch: 0.14, colors: c.cols('core', 'main', 'accent'), bright: 0.9 * c.B });
      c.emit('bubble', poisson(15 * rate), { p: around(0.8), orbit: orbit(6, 1.5, 0.5, 1, 1), life: [0.6, 1], size: [0.04, 0.08], colors: c.cols('core', 'main'), bright: 1.3 * c.B });
    },
    burst(c, p, { n, s, sp, vel }) {
      const B = c.B;
      c.emit('spark', n * 0.6, { p, jitter: 0.1 * s, v: vel(sp * 0.4, sp * 1.1), life: [0.7, 1.2], size: [0.02 * s, 0.035 * s], gravity: 9, drag: 0.8, stretch: 0.03, colors: c.cols('core', 'main'), bright: 1.6 * B, fadeIn: 0, hook: splash(c, 0.35) });
      c.emit('bubble', n * 0.15, { p, jitter: 0.25 * s, v: vel(sp * 0.05, sp * 0.3), life: [0.6, 1.2], size: [0.05 * s, 0.1 * s], gravity: -0.8, drag: 2, curl: 0.8, colors: c.cols('core', 'main'), bright: 1.4 * B, fadeIn: 0.05 });
      c.emit('mist', n * 0.3, { p, jitter: 0.2 * s, v: vel(sp * 0.15, sp * 0.45), life: [0.5, 0.9], size: [0.12 * s, 0.22 * s], grow: 1.5, drag: 2.5, curl: 2.6, curlScale: 1.6, stretch: 0.14, colors: c.cols('core', 'main', 'accent'), bright: 0.9 * B, fadeIn: 0.03 });
      c.emit('mist', n * 0.1, { p, jitter: 0.2 * s, v: vel(sp * 0.1, sp * 0.3), life: [0.5, 0.9], size: [0.35 * s, 0.6 * s], grow: 1.8, drag: 3, curl: 1, colors: c.cols('main', 'accent'), bright: 0.6 * B, fadeIn: 0.03 });
    },
    trail(c, a) {
      const B = c.B;
      c.emit('spark', rate(a, 80), { p: along(a), jitter: 0.08 * a.s, v: () => back(a, 0.1).add(randomDir().multiplyScalar(1.2)), life: [0.3, 0.5], size: [0.015, 0.025], gravity: 7, stretch: 0.03, colors: c.cols('core', 'main'), bright: 1.5 * B, fadeIn: 0 });
      c.emit('bubble', rate(a, 30), { p: along(a), jitter: 0.12 * a.s, v: () => randomDir().multiplyScalar(0.3), life: [0.4, 0.8], size: [0.03 * a.s, 0.06 * a.s], gravity: -0.5, curl: 1, colors: c.cols('core', 'main'), bright: 1.3 * B });
      c.emit('mist', rate(a, 70), { p: along(a), jitter: 0.06 * a.s, v: () => back(a, 0.06), life: [0.35, 0.6], size: [0.1 * a.s, 0.18 * a.s], grow: 1.5, curl: 2.8, curlScale: 2, stretch: 0.14, colors: c.cols('core', 'main', 'accent'), bright: 1 * B });
    },
    decal: { tint: (c) => c.pal.accent.clone().multiplyScalar(0.3), ember: 'main', glow: 0.6, decay: 0.5, crackScale: 3, crackWidth: 0.0, alpha: 0.6, core: 0.5 },
    extra(c, p, pw, s) {
      const g = c.ground(p);
      c.emit('spark', 120 * pw * s, { p: () => g.clone().add(randomDir().setY(0).multiplyScalar(0.4 * s)), v: () => coneDir(UP, 0.35).multiplyScalar((4 + Math.random() * 4) * Math.sqrt(s)), life: [0.6, 1.1], size: [0.025 * s, 0.04 * s], gravity: 10, stretch: 0.03, colors: c.cols('core', 'main'), bright: 1.6 * c.B, fadeIn: 0 });
      c.during(0, 0.5, (_k, dt) => {
        c.emit('mist', poisson(90 * dt * pw), { p: () => g.clone().add(randomDir().setY(0).multiplyScalar(0.5 * s)), v: () => new THREE.Vector3(0, 2.5 + Math.random() * 2, 0), life: [0.5, 0.8], size: [0.12 * s, 0.22 * s], swirl: 6, center: g, curl: 2.5, stretch: 0.15, gravity: 3, colors: c.cols('core', 'main', 'accent'), bright: 0.9 * c.B });
      });
      c.ring(g, 1.5 * s, { dur: 0.7, thick: 0.04 });
      c.ring(g, 1.0 * s, { dur: 0.7, thick: 0.04, delay: 0.15 });
      c.ring(g, 0.6 * s, { dur: 0.7, thick: 0.04, delay: 0.3 });
    },
  },
  light: {
    sparks: 0.8,
    swirl(c, around, orbit, rate) {
      c.emit('star', poisson(14 * rate), { p: around(0.9), orbit: orbit(7, 2, 0.5, 1.1, 1), life: [0.4, 0.8], size: [0.1, 0.18], grow: 0.4, colors: c.cols('core', 'main'), bright: 2 * c.B });
      c.emit('mote', poisson(50 * rate), { p: around(1), orbit: orbit(8, 2.2, 0.5, 1.1, 1.1), life: [0.8, 1.3], size: [0.02, 0.04], flicker: 0.5, colors: c.cols('core', 'main'), bright: 2.4 * c.B });
    },
    burst(c, p, { n, s, sp, vel }) {
      const B = c.B;
      c.emit('star', n * 0.12, { p, jitter: 0.1 * s, v: vel(sp * 0.2, sp * 0.7), life: [0.4, 0.8], size: [0.12 * s, 0.25 * s], grow: 0.4, drag: 3, spin: [-2, 2], colors: c.cols('core', 'main'), bright: 2 * B, fadeIn: 0.02 });
      c.emit('mote', n * 0.3, { p, jitter: 0.3 * s, v: () => vel(sp * 0.05, sp * 0.3)().add(new THREE.Vector3(0, 1, 0)), life: [0.8, 1.6], size: [0.025, 0.045], drag: 1.5, turb: 1, flicker: 0.5, colors: c.cols('core', 'main'), bright: 2.4 * B });
    },
    trail(c, a) {
      const B = c.B;
      c.emit('mote', rate(a, 70), { p: along(a), jitter: 0.1 * a.s, v: () => randomDir().multiplyScalar(0.3).add(new THREE.Vector3(0, 0.4, 0)), life: [0.5, 1], size: [0.02, 0.04], drag: 1, flicker: 0.5, colors: c.cols('core', 'main'), bright: 2.2 * B });
      c.emit('star', rate(a, 10), { p: along(a), jitter: 0.12 * a.s, speed: 0, life: [0.2, 0.35], size: [0.1 * a.s, 0.18 * a.s], grow: 0.2, colors: c.cols('core', 'main'), bright: 2 * B });
      c.emit('glow', rate(a, 30), { p: along(a), jitter: 0.04, speed: 0, life: [0.15, 0.3], size: [0.2 * a.s, 0.3 * a.s], colors: c.cols('main', 'accent'), bright: 0.9 * B });
    },
    decal: { tint: (c) => c.pal.accent.clone().multiplyScalar(0.12), ember: 'core', glow: 1.4, decay: 0.8, crackScale: 5, crackWidth: 0.035, alpha: 0.6, core: 1 },
    extra(c, p, pw, s) {
      const g = c.ground(p);
      c.beam(() => g.clone().setY(g.y + 9), () => g, { radius: 0.45 * s * Math.sqrt(pw), dur: 0.55, fadeIn: 0.04, flow: -10 });
      c.star(g.clone().setY(g.y + 0.2), 2.2 * s, 0.3, 2.2);
      c.circle(g, 1.4 * s, 0.7, { spin: 1.5, bright: 1.6, slot: 'target' });
    },
  },
  dark: {
    sparks: 0.7,
    swirl(c, around, orbit, rate) {
      c.emit('smoke', poisson(35 * rate), { p: around(0.9), orbit: orbit(6, 1.5, 0.6, 1.2, 1), life: [0.8, 1.3], size: [0.3, 0.5], grow: 1.8, colors: [c.pal.smoke!.clone().multiplyScalar(1.6), c.pal.smoke!], fadeIn: 0.15 });
      c.emit('mote', poisson(40 * rate), { p: around(1.2), orbit: orbit(8, 1.8, 0.5, 1, 1), life: [0.6, 1.1], size: [0.02, 0.04], colors: c.cols('core', 'main'), bright: 2.2 * c.B });
    },
    glare: 0.7,
    burst(c, p, { n, s, sp, vel }) {
      const B = c.B;
      c.smoke(p, n * 0.2, { jitter: 0.2 * s, speed: [0.8, 2.5], v: undefined, dir: undefined, spread: 1, life: [0.8, 1.4], size: [0.3 * s, 0.55 * s], gravity: -0.2, delay: [0, 0.1] });
      c.emit('mote', n * 0.3, { p: () => p.clone().add(randomDir().multiplyScalar(1.2 * s)), center: p, attract: 9, v: () => new THREE.Vector3(), life: [0.35, 0.6], size: [0.025, 0.045], drag: 3, colors: c.cols('core', 'main'), bright: 2.2 * B, fadeIn: 0.1 });
      c.emit('glyph', n * 0.05, { p, jitter: 0.3 * s, v: vel(sp * 0.1, sp * 0.3), life: [0.5, 0.9], size: [0.1 * s, 0.16 * s], drag: 2, spin: [-3, 3], colors: c.cols('core', 'main'), bright: 1.6 * B, fadeIn: 0.05 });
    },
    trail(c, a) {
      const B = c.B;
      c.smoke(along(a)(), rate(a, 45), { jitter: 0.1, speed: [0.1, 0.4], life: [0.6, 1.1], size: [0.2 * a.s, 0.35 * a.s], delay: 0 });
      c.emit('mote', rate(a, 50), { p: along(a), jitter: 0.15 * a.s, v: () => randomDir().multiplyScalar(0.4), life: [0.4, 0.8], size: [0.02, 0.04], drag: 1, turb: 2, flicker: 0.4, colors: c.cols('core', 'main'), bright: 2.2 * B });
    },
    decal: { tint: (c) => c.pal.accent.clone().multiplyScalar(0.04), ember: 'main', glow: 2.2, decay: 1.2, crackScale: 5, crackWidth: 0.07, alpha: 0.95, core: 0.4 },
    extra(c, p, pw, s) {
      c.voidSphere(p, 1.1 * s * Math.sqrt(pw), 0.7);
      c.after(0.55, () => {
        c.ring(p, 1.8 * s, { normal: 'camera', dur: 0.35, thick: 0.06 });
        c.emit('spark', 60 * pw, { p, v: () => randomDir().multiplyScalar(5 + Math.random() * 4), life: [0.2, 0.45], size: [0.012, 0.022], drag: 2.5, stretch: 0.035, colors: c.cols('core', 'main'), bright: 3 * c.B, fadeIn: 0 });
      });
    },
  },
  poison: {
    sparks: 0.2,
    swirl(c, around, orbit, rate) {
      const sludge = c.pal.smoke!;
      c.emit('smoke', poisson(35 * rate), { p: around(1), orbit: orbit(5, 1.2, 0.7, 1.3, 0.9), life: [1, 1.5], size: [0.35, 0.55], grow: 1.8, colors: [sludge.clone().lerp(c.pal.main, 0.3), sludge], fadeIn: 0.15 });
      c.emit('bubble', poisson(25 * rate), { p: around(0.9), orbit: orbit(7, 1.6, 0.5, 1.1, 1), life: [0.5, 0.9], size: [0.05, 0.09], colors: c.cols('main', 'accent'), bright: 0.9 * c.B });
    },
    glare: 0.4,
    burst(c, p, { n, s, sp, vel }) {
      const B = c.B;
      const sludge = c.pal.smoke!;
      c.emit('smoke', n * 0.3, { p, jitter: 0.25 * s, v: vel(sp * 0.15, sp * 0.45), life: [1.1, 1.8], size: [0.35 * s, 0.6 * s], grow: 2, drag: 2.5, gravity: 0.25, curl: 1, curlScale: 1.2, colors: [sludge.clone().lerp(c.pal.main, 0.35), sludge.clone().lerp(c.pal.accent, 0.45)], fadeIn: 0.08, fadePow: 1.1 });
      c.emit('spark', n * 0.4, { p, v: vel(sp * 0.3, sp * 0.9), life: [0.8, 1.2], size: [0.022 * s, 0.035 * s], gravity: 9, stretch: 0.05, colors: c.cols('core', 'main', 'accent'), bright: 1.1 * B, fadeIn: 0, hook: acid(c, 0.4) });
      c.emit('mist', n * 0.2, { p, jitter: 0.25 * s, v: vel(sp * 0.05, sp * 0.25), life: [0.9, 1.6], size: [0.4 * s, 0.7 * s], grow: 1.8, drag: 2, curl: 1.4, colors: c.cols('main', 'accent'), bright: 0.4 * B, fadeIn: 0.1 });
      c.emit('bubble', n * 0.15, { p, jitter: 0.3 * s, v: vel(sp * 0.05, sp * 0.3), life: [0.3, 0.7], size: [0.04 * s, 0.09 * s], grow: 1.8, gravity: -0.6, drag: 2, curl: 1, colors: c.cols('main', 'accent'), bright: 0.9 * B, fadeIn: 0.05, fadePow: 0.4 });
      c.emit('glyph', 2 + n * 0.02, { p, jitter: 0.35 * s, v: () => new THREE.Vector3((Math.random() - 0.5) * 0.4, 0.5 + Math.random() * 0.6, (Math.random() - 0.5) * 0.4), life: [0.9, 1.5], size: [0.14 * s, 0.24 * s], grow: 1.3, drag: 1, curl: 0.8, colors: c.cols('main', 'accent'), bright: 1 * B, fadeIn: 0.15, variant: 1 });
    },
    trail(c, a) {
      const B = c.B;
      const sludge = c.pal.smoke!;
      c.emit('smoke', rate(a, 50), { p: along(a), jitter: 0.08 * a.s, v: () => back(a, 0.05), life: [0.7, 1.2], size: [0.2 * a.s, 0.35 * a.s], grow: 1.8, drag: 2, gravity: 0.3, curl: 1, colors: [sludge.clone().lerp(c.pal.main, 0.25), sludge], fadeIn: 0.05 });
      c.emit('spark', rate(a, 45), { p: along(a), jitter: 0.06 * a.s, v: () => new THREE.Vector3(0, -0.3, 0), life: [0.6, 1.1], size: [0.018, 0.03], gravity: 7, stretch: 0.06, colors: c.cols('core', 'main'), bright: 1.1 * B, hook: acid(c, 0.25) });
      c.emit('mist', rate(a, 30), { p: along(a), jitter: 0.06, v: () => back(a, 0.05), life: [0.5, 0.8], size: [0.22 * a.s, 0.35 * a.s], grow: 1.8, curl: 1.5, colors: c.cols('main', 'accent'), bright: 0.45 * B });
      if (Math.random() < a.dt * 4) c.emit('glyph', 1, { p: along(a)(), speed: 0.4, life: 1, size: 0.14 * a.s, curl: 0.8, colors: c.cols('main', 'accent'), bright: 0.9 * B, fadeIn: 0.15, variant: 1 });
    },
    decal: { tint: (c) => c.pal.smoke!.clone().lerp(c.pal.accent, 0.25).multiplyScalar(1.2), ember: 'main', glow: 1.1, decay: 0.25, crackScale: 3.2, crackWidth: 0.03, alpha: 0.92, core: 0.25 },
    extra(c, p, pw, s) {
      const g = c.ground(p);
      const sludge = c.pal.smoke!;
      c.during(0.1, 1.4, (_k, dt) => {
        const at = () => g.clone().add(randomDir().multiply(new THREE.Vector3(1 * s, 0, 1 * s))).setY(g.y + 0.1);
        c.emit('smoke', poisson(28 * dt * pw), { p: at, v: () => randomDir().setY(0.05).multiplyScalar(0.4), life: [1.2, 2], size: [0.4 * s, 0.7 * s], grow: 1.6, gravity: 0.1, curl: 1.2, colors: [sludge.clone().lerp(c.pal.main, 0.2), sludge], fadeIn: 0.3 });
        c.emit('mist', poisson(18 * dt * pw), { p: at, v: () => new THREE.Vector3(0, 0.2, 0), life: [1, 1.6], size: [0.5 * s, 0.8 * s], grow: 1.5, curl: 1.4, colors: c.cols('main', 'accent'), bright: 0.35 * c.B, fadeIn: 0.3 });
        c.emit('bubble', poisson(40 * dt * pw), { p: at, v: () => new THREE.Vector3(0, 0.15, 0), life: [0.25, 0.6], size: [0.04, 0.1], grow: 2, colors: c.cols('main', 'accent'), bright: 0.9 * c.B, fadePow: 0.3 });
        if (Math.random() < dt * 3 * pw) c.emit('glyph', 1, { p: at(), v: () => new THREE.Vector3(0, 0.6, 0), life: 1.4, size: 0.3 * s, grow: 1.4, curl: 0.6, colors: c.cols('main', 'accent'), bright: 0.8 * c.B, fadeIn: 0.25, variant: 1 });
      });
    },
  },
  arcane: {
    sparks: 0.7,
    swirl(c, around, orbit, rate) {
      c.emit('glyph', poisson(14 * rate), { p: around(1), orbit: orbit(6, 1.6, 0.5, 1.1, 1), life: [0.7, 1.2], size: [0.1, 0.16], spin: [-2, 2], colors: c.cols('core', 'main'), bright: 2 * c.B, fadeIn: 0.1 });
      c.emit('mote', poisson(40 * rate), { p: around(1), orbit: orbit(8, 2, 0.5, 1.1, 1), life: [0.6, 1.1], size: [0.02, 0.035], colors: c.cols('core', 'main'), bright: 2 * c.B });
    },
    burst(c, p, { n, s, sp, vel }) {
      const B = c.B;
      c.emit('glyph', n * 0.15, { p, jitter: 0.15 * s, v: vel(sp * 0.15, sp * 0.4), life: [0.6, 1.1], size: [0.1 * s, 0.18 * s], drag: 2.5, swirl: 3, center: p, spin: [-2, 2], colors: c.cols('core', 'main'), bright: 2 * B, fadeIn: 0.05 });
      c.emit('star', n * 0.06, { p, jitter: 0.4 * s, speed: 0, life: [0.25, 0.5], size: [0.12 * s, 0.2 * s], grow: 0.3, colors: c.cols('core', 'main'), bright: 2 * B, delay: [0, 0.2] });
      c.emit('glow', n * 0.1, { p, jitter: 0.1 * s, v: vel(sp * 0.1, sp * 0.3), life: [0.3, 0.5], size: [0.25 * s, 0.4 * s], grow: 1.6, drag: 3, colors: c.cols('main', 'accent'), bright: 1.2 * B });
    },
    trail(c, a) {
      const B = c.B;
      c.emit('glyph', rate(a, 22), { p: along(a), jitter: 0.12 * a.s, v: () => randomDir().multiplyScalar(0.3), life: [0.4, 0.8], size: [0.07 * a.s, 0.12 * a.s], spin: [-2, 2], colors: c.cols('core', 'main'), bright: 1.8 * B, fadeIn: 0.05 });
      c.emit('mote', rate(a, 50), { p: along(a), jitter: 0.1 * a.s, v: () => randomDir().multiplyScalar(0.3), life: [0.4, 0.8], size: [0.02, 0.035], turb: 2, flicker: 0.4, colors: c.cols('core', 'main'), bright: 2 * B });
      c.emit('glow', rate(a, 30), { p: along(a), jitter: 0.05, speed: 0, life: [0.15, 0.3], size: [0.2 * a.s, 0.3 * a.s], colors: c.cols('main', 'accent'), bright: 0.9 * B });
    },
    decal: null,
    extra(c, p, pw, s) {
      const g = c.ground(p);
      c.circle(g, 1.6 * s * Math.sqrt(pw), 0.9, { spin: 2, bright: 2, slot: 'target' });
      c.ring(p, 1.2 * s, { normal: UP, dur: 0.5, thick: 0.05, delay: 0.05 });
    },
  },
};

export function elementFX(name: string): ElementFX {
  return ELEMENT_FX[name] ?? ELEMENT_FX.fire;
}
