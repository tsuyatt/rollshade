import * as THREE from 'three/webgpu';
import type { Palette } from './palette';
import { anchors, claimAnchor, coneDir, randomDir, releaseAnchor, type EmitOptions, type Hook, type ParticleKind, type Range } from './particles';
import { RIBBON_LENGTH, RibbonTrail, arcGeometry, stripGeometry, type Prim } from './prims';
import { helixGeometry, type HelixOptions } from './shapes';
import { CIRCLES, elementFX, type ElementFX } from './elements';
import type { HeldLight } from './lights';
import type { Anchor, EffectDef, FXHandle, FXSystem, HitEvent, HitRole, PlayOptions } from './system';

export const ease = {
  outCubic: (t: number) => 1 - Math.pow(1 - t, 3),
  inOutQuad: (t: number) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  outBack: (t: number) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2),
  slash: (t: number) => 1 - Math.pow(1 - t, 2.2),
  inQuad: (t: number) => t * t,
  outQuad: (t: number) => 1 - (1 - t) * (1 - t),
  outQuint: (t: number) => 1 - Math.pow(1 - t, 5),
  outExpo: (t: number) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: (t: number) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  inCubic: (t: number) => t * t * t,
  inOutCubic: (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  outBackStrong: (t: number) => 1 + 3.2 * Math.pow(t - 1, 3) + 2.2 * Math.pow(t - 1, 2),
  outElastic: (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1),
};

export const clamp01 = (t: number) => Math.min(Math.max(t, 0), 1);
export const span = (k: number, a: number, b: number) => clamp01((k - a) / (b - a));

const UP = new THREE.Vector3(0, 1, 0);
const v3 = () => new THREE.Vector3();

export function resolve(a: Anchor, out = v3()): THREE.Vector3 {
  return a instanceof THREE.Object3D ? a.getWorldPosition(out) : out.copy(a);
}

export type RingNormal = 'camera' | 'up' | THREE.Vector3;
export type CircleSlot = 'feet' | 'hand' | 'target';
export type ColorKey = 'core' | 'main' | 'accent' | 'smoke';
export type LatheProfile = 'cylinder' | 'cone' | 'funnel' | 'vase' | 'dome' | 'sphere';

export interface LatheOptions {
  profile?: LatheProfile;
  radius: number;
  top?: number;
  height: number;
  curve?: number;
  bulge?: number;
  a0?: number;
  span?: number;
  axis?: THREE.Vector3;
  twist?: number;
  spin?: number;
  flow?: number;
  tiles?: [number, number];
  streak?: number;
  rim?: number;
  wobble?: number;
  bend?: [number, number];
  sway?: number;
  swayF?: number;
  fadeLo?: number;
  fadeHi?: number;
  edge?: number;
  erode?: (k: number) => number;
  erodeTilt?: (k: number) => number;
  turnRate?: (k: number) => number;
  grow?: (k: number) => number | [number, number];
  fade?: (k: number) => number;
  at?: () => THREE.Vector3;
  dur: number;
  delay?: number;
  bright?: number;
  smoke?: boolean;
  colors?: [ColorKey, ColorKey, ColorKey];
  seed?: number;
}

export interface BandOptions {
  radius: number;
  inner?: number;
  a0?: number;
  span?: number;
  spin?: number;
  normal?: RingNormal;
  dur?: number;
  delay?: number;
  grow?: (k: number) => number;
  thick?: (k: number) => number;
  hard?: number;
  noise?: number;
  fadeS?: number;
  fadeE?: number;
  colors?: [ColorKey, ColorKey, ColorKey];
  bright?: number;
  at?: () => THREE.Vector3;
  quat?: THREE.Quaternion;
  kFn?: (k: number) => number;
}

export class Ctx {
  readonly power: number;
  readonly scale: number;
  readonly B = 0.55;
  private hits = 0;

  constructor(
    readonly fx: FXSystem,
    readonly handle: FXHandle,
    readonly def: EffectDef,
    readonly pal: Palette,
    readonly opts: PlayOptions,
  ) {
    this.power = opts.power ?? 1;
    this.scale = opts.scale ?? 1;
  }

  get element(): string {
    return this.def.element;
  }

  get efx(): ElementFX {
    return elementFX(this.def.element);
  }

  from(out = v3()): THREE.Vector3 {
    return resolve(this.opts.from, out);
  }

  to(out = v3()): THREE.Vector3 {
    return resolve(this.opts.to, out);
  }

  floorOf: (() => number) | null = null;

  get floor(): number {
    return this.floorOf ? this.floorOf() : (this.opts.floorY ?? this.fx.floorY);
  }

  ground(p: THREE.Vector3): THREE.Vector3 {
    return new THREE.Vector3(p.x, this.floor + 0.02, p.z);
  }

  heightAboveFloor(p: THREE.Vector3): number {
    return p.y - this.floor;
  }

  after(delay: number, fn: () => void): void {
    this.fx.scheduler.after(delay, fn, this.handle);
  }

  during(delay: number, dur: number, fn: (k: number, dt: number, age: number) => void, end?: () => void): void {
    this.fx.scheduler.during(delay, dur, fn, end, this.handle);
  }

  hold(range: number): HeldLight {
    const held = this.fx.lights.hold(this.pal.main, range);
    let open = true;
    const release = (fade?: number) => {
      if (!open) return;
      open = false;
      held.release(fade);
    };
    this.fx.scheduler.add({ update: () => open, dispose: () => release(0.15) }, this.handle);
    return { set: held.set, release };
  }

  finish(): void {
    const sched = this.fx.scheduler;
    sched.add({
      update: () => {
        if (!this.handle.playing) return false;
        if (sched.busy(this.handle)) return true;
        this.handle.emit('end');
        return false;
      },
    });
  }

  part(name: string): void {
    this.fx.scheduler.part = name;
  }

  get hidden(): boolean {
    return this.fx.only !== null && this.fx.scheduler.part !== this.fx.only;
  }

  emit(kind: ParticleKind, n: number, o: EmitOptions): void {
    if (this.hidden) return;
    this.fx.particles[kind].emit(n, { floor: this.floor, ...o });
  }

  hook(h: Hook): Hook {
    const part = this.fx.scheduler.part;
    const wrap = (fn?: (p: THREE.Vector3, v: THREE.Vector3) => void) =>
      fn &&
      ((p: THREE.Vector3, v: THREE.Vector3) => {
        if (!this.handle.playing) return;
        const outer = this.fx.scheduler.part;
        this.fx.scheduler.part = part;
        fn(p, v);
        this.fx.scheduler.part = outer;
      });
    return { ...h, onDie: wrap(h.onDie), onFloor: wrap(h.onFloor) };
  }

  emitShape(kind: ParticleKind, n: number, shape: Shape, o: EmitOptions & { outward?: Range; tangent?: Range }): void {
    const total = Math.round(n);
    const pt = new THREE.Vector3();
    const nrm = new THREE.Vector3();
    const tan = new THREE.Vector3();
    for (let i = 0; i < total; i++) {
      sampleShape(shape, i, total, pt, nrm, tan);
      const base = o.v ? o.v() : o.dir ? coneDir(o.dir, o.spread ?? 0.3).multiplyScalar(pickRange(o.speed, 0)) : new THREE.Vector3();
      base.addScaledVector(nrm, pickRange(o.outward, 0)).addScaledVector(tan, pickRange(o.tangent, 0));
      const p = pt.clone();
      this.emit(kind, 1, { ...o, p, v: () => base.clone() });
    }
  }

  homing(o: { from: THREE.Vector3; v0: THREE.Vector3; to: () => THREE.Vector3; speed: number; steer: number; accel?: number; maxTime?: number; arrive: (at: THREE.Vector3) => void; step?: (head: THREE.Vector3, prev: THREE.Vector3, vel: THREE.Vector3, dt: number, k: number) => void }): void {
    const head = o.from.clone();
    const prev = o.from.clone();
    const vel = o.v0.clone();
    const want = new THREE.Vector3();
    const maxTime = o.maxTime ?? 4;
    let done = false;
    let elapsed = 0;
    this.fx.scheduler.add(
      {
        update: (dt) => {
          if (done) return false;
          const tgt = o.to();
          want.subVectors(tgt, head);
          const dist = want.length();
          const t = vel.length();
          const sp = Math.min(o.speed, t + (o.accel ?? o.speed * 2) * dt);
          want.multiplyScalar(sp / Math.max(dist, 1e-5));
          vel.lerp(want, Math.min(o.steer * dt, 1));
          prev.copy(head);
          head.addScaledVector(vel, dt);
          this.handle.head.copy(head);
          o.step?.(head, prev, vel, dt, Math.min(elapsed / maxTime, 1));
          elapsed += dt;
          if (dist < Math.max(vel.length() * dt * 1.5, 0.12) || elapsed > maxTime) {
            done = true;
            o.arrive(tgt.clone());
            return false;
          }
          return true;
        },
      },
      this.handle,
    );
  }

  cols(...keys: ('core' | 'main' | 'accent' | 'smoke')[]): THREE.Color[] {
    return keys.map((k) => (k === 'smoke' ? this.pal.smoke ?? this.pal.accent : this.pal[k]));
  }

  get glare(): number {
    return this.efx.glare ?? 1;
  }

  glow(p: THREE.Vector3, size: number, life: number, bright = 1, keys: ('core' | 'main' | 'accent')[] = ['core', 'main', 'accent']): void {
    this.emit('glow', 1, { p, speed: 0, life, size, grow: 1.1, colors: this.cols(...keys), bright: bright * this.B * this.glare, fadeIn: 0.01, fadePow: 1.6 });
  }

  star(p: THREE.Vector3, size: number, life = 0.16, bright = 3): void {
    this.emit('star', 1, { p, speed: 0, life, size, grow: 0.6, colors: this.cols('core', 'main'), bright: bright * this.B * this.glare, fadeIn: 0.005, fadePow: 1.4, spin: 0 });
  }

  flare(p: THREE.Vector3, size: number, life = 0.22): void {
    this.emit('flare', 1, { p, speed: 0, life, size: size * 1.6, grow: 1.3, colors: this.cols('core', 'main'), bright: 2 * this.B * this.glare, fadeIn: 0.005, fadePow: 1.3, spin: 0 });
  }

  light(p: THREE.Vector3, intensity: number, dur: number, range = 8): void {
    this.fx.lights.flash(p, this.pal.main, intensity * 18 * this.glare, dur, range);
  }

  ring(p: THREE.Vector3, radius: number, o: { normal?: RingNormal; dur?: number; thick?: number; delay?: number; bright?: number } = {}): void {
    const dur = o.dur ?? 0.4;
    this.after(o.delay ?? 0, () => {
      const prim = this.fx.prims.acquire('ring');
      const m = prim.mesh;
      m.position.copy(p);
      m.scale.setScalar(radius);
      prim.u.thick.value = o.thick ?? 0.08;
      prim.u.core.value.copy(this.pal.core);
      prim.u.main.value.copy(this.pal.main);
      prim.u.bright.value = (o.bright ?? 2.2) * this.B * this.glare;
      prim.u.seed.value = Math.random() * 50;
      prim.u.k.value = 0;
      const normal = o.normal ?? 'up';
      const orient = () => {
        if (normal === 'camera') m.quaternion.copy(this.fx.camera.quaternion);
        else if (normal === 'up') m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), UP);
        else m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
      };
      orient();
      this.live(prim, dur, (k) => {
        prim.u.k.value = k;
        if (normal === 'camera') orient();
      });
    });
  }

  params: Record<string, number> = {};

  circleStyle(slot: CircleSlot): number {
    const key = `circle${slot[0].toUpperCase()}${slot.slice(1)}`;
    return Math.round(this.params[key] ?? 0);
  }

  circle(p: THREE.Vector3, size: number, dur: number, o: { normal?: RingNormal; spin?: number; bright?: number; slot?: CircleSlot; style?: number } = {}): void {
    const style = o.style ?? (o.slot ? this.circleStyle(o.slot) : 1);
    if (style <= 0) return;
    const prim = this.fx.prims.acquire('circle');
    const m = prim.mesh;
    m.position.copy(p);
    prim.u.core.value.copy(this.pal.core);
    prim.u.main.value.copy(this.pal.main);
    prim.u.accent.value.copy(this.pal.accent);
    prim.u.bright.value = (o.bright ?? 1.6) * this.B * (0.5 + 0.5 * this.glare);
    const look = CIRCLES[this.element] ?? CIRCLES.arcane;
    for (const [k, v] of Object.entries({ sidesB: 0, skipB: 1, rotB: 0, spokes: 0, branch: 0, spiral: 0, waves: 0, dots: 0, petals: 0, runes: 3, ticks: 1, ...look })) prim.u[k].value = v;
    prim.u.mode.value = style === 5 ? 1 : style === 6 ? 2 : 0;
    const normal = o.normal ?? 'up';
    if (normal === 'up') m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), UP);
    else if (normal !== 'camera') m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
    const spin = o.spin ?? 1;
    const flat = normal === 'up';
    const seed = Math.random() * 100;
    let landed = false;
    this.live(prim, dur, (k, age) => {
      if (normal === 'camera') m.quaternion.copy(this.fx.camera.quaternion);
      const out = k > 0.8 ? 1 - (k - 0.8) / 0.2 : 1;
      let scale = 1;
      let fade = 1;
      let reveal = 1;
      let turn = age * spin * 1.6;
      m.position.copy(p);
      if (style === 1) {
        scale = 0.6 + 0.4 * ease.outBack(Math.min(age / 0.18, 1));
        reveal = Math.min(age / 0.3, 1);
      } else if (style === 2) {
        const t = ease.outCubic(Math.min(age / 0.28, 1));
        scale = 2.6 - 1.6 * t;
        fade = t;
      } else if (style === 3) {
        fade = ease.inOutQuad(Math.min(age / 0.4, 1));
      } else if (style === 4) {
        const t = Math.min(age / 0.45, 1);
        scale = 0.3 + 0.7 * ease.outBack(t);
        turn = spin * (age * 1.6 + 9 * (1 - Math.pow(1 - t, 3)));
        fade = Math.min(age / 0.1, 1);
      } else if (style === 5 || style === 6) {
        reveal = ease.outCubic(Math.min(age / 0.35, 1));
        scale = style === 6 ? 1.25 - 0.25 * reveal : 1;
      } else if (style === 7) {
        const t = Math.min(age / 0.3, 1);
        fade = t < 1 ? (Math.sin(age * 90 + seed) > 0.1 - t * 0.9 ? 0.4 + t * 0.6 : 0.05) : 1;
      } else if (style === 8) {
        const t = Math.min(age / 0.3, 1);
        if (flat) m.position.y = p.y + (1 - ease.inQuad(t)) * 2.2;
        scale = 0.85 + 0.15 * ease.outBack(t);
        fade = Math.min(age / 0.08, 1);
        if (t >= 1 && !landed) {
          landed = true;
          this.ring(p, size * 1.2, { dur: 0.3, thick: 0.05 });
        }
      }
      m.scale.setScalar(size * scale);
      prim.u.reveal.value = reveal;
      prim.u.turn.value = turn;
      prim.u.fade.value = fade * out * Math.min(age / 0.03, 1);
    });
  }

  sphere(p: THREE.Vector3, size: number, dur: number, bright = 2): void {
    const prim = this.fx.prims.acquire('sphere');
    const m = prim.mesh;
    m.position.copy(p);
    prim.u.core.value.copy(this.pal.core);
    prim.u.main.value.copy(this.pal.main);
    prim.u.accent.value.copy(this.pal.accent);
    prim.u.bright.value = bright * this.B * this.glare;
    prim.u.seed.value = Math.random() * 50;
    m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
    this.live(prim, dur, (k) => {
      prim.u.k.value = k;
      m.scale.setScalar(size * (0.35 + 0.65 * ease.outCubic(Math.min(k * 1.6, 1))));
    });
  }

  decal(p: THREE.Vector3, size: number, life = 4): void {
    const style = this.efx.decal;
    if (!style) return;
    const prim = this.fx.prims.acquire('decal');
    const m = prim.mesh;
    m.position.copy(this.ground(p));
    m.position.y += Math.random() * 0.004;
    m.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
    m.scale.setScalar(size);
    m.renderOrder = 0;
    prim.u.ember.value.copy(this.pal[style.ember]);
    prim.u.glow.value = style.glow * this.B;
    prim.u.seed.value = Math.random() * 50;
    prim.u.tint.value.copy(style.tint(this));
    prim.u.crackScale.value = style.crackScale;
    prim.u.crackWidth.value = style.crackWidth;
    prim.u.alpha.value = style.alpha;
    prim.u.core.value = style.core;
    this.live(prim, life, (k, age) => {
      prim.u.heat.value = Math.exp(-age * style.decay);
      prim.u.k.value = Math.max(k - 0.5, 0) * 2;
    }, false);
  }

  wave(p: THREE.Vector3, radius: number, dur = 0.45, strength = 1): void {
    this.fx.post?.wave(p, radius, dur, strength);
  }

  screenFlash(amount: number): void {
    if (!this.fx.post) return;
    this.fx.post.flashTint(this.pal.core);
    this.fx.post.flash = Math.max(this.fx.post.flash, (this.fx.photosensitive ? 0.25 : 0.6) * amount * this.glare);
  }

  live(prim: Prim, dur: number, fn: (k: number, age: number) => void, owned = true): void {
    let age = 0;
    fn(0, 0);
    this.fx.scheduler.add(
      {
        update: (dt) => {
          age += dt;
          const k = Math.min(age / dur, 1);
          fn(k, age);
          return k < 1;
        },
        dispose: () => this.fx.prims.release(prim),
      },
      owned ? this.handle : null,
    );
  }

  dust(p: THREE.Vector3, s = 1): void {
    const g = this.ground(p);
    const c = this.efx.glare !== undefined && this.pal.smoke ? this.pal.smoke.clone().lerp(new THREE.Color(0.32, 0.29, 0.26), 0.35) : new THREE.Color(0.32, 0.29, 0.26);
    this.emit('smoke', 18 * s, {
      p: () => g.clone().add(new THREE.Vector3((Math.random() - 0.5) * 0.3, 0.05, (Math.random() - 0.5) * 0.3)),
      v: () => {
        const a = Math.random() * Math.PI * 2;
        const sp = (2 + Math.random() * 2.5) * s;
        return new THREE.Vector3(Math.cos(a) * sp, 0.25 + Math.random() * 0.5, Math.sin(a) * sp);
      },
      life: [0.7, 1.3],
      size: [0.18 * s, 0.3 * s],
      grow: 2.8,
      drag: 3.2,
      colors: [c, c.clone().multiplyScalar(0.7)],
      bright: 1,
      fadeIn: 0.05,
      fadePow: 1.2,
    });
  }

  smoke(p: THREE.Vector3, n: number, o: Partial<EmitOptions> = {}): void {
    const c = this.pal.smoke ?? new THREE.Color(0.1, 0.1, 0.12);
    this.emit('smoke', n, {
      p,
      jitter: 0.2,
      dir: UP,
      spread: 0.6,
      speed: [0.5, 1.5],
      life: [1.1, 2],
      size: [0.3, 0.5],
      grow: 2.4,
      drag: 1.5,
      gravity: -0.6,
      turb: 1.2,
      colors: [c.clone().multiplyScalar(1.6), c],
      fadeIn: 0.15,
      fadePow: 1.3,
      delay: [0.05, 0.2],
      ...o,
    });
  }

  burst(p: THREE.Vector3, o: { count?: number; speed?: number; dir?: THREE.Vector3; spread?: number; scale?: number } = {}): void {
    const s = (o.scale ?? 1) * this.scale;
    const n = (o.count ?? 60) * s;
    const sp = (o.speed ?? 6) * Math.sqrt(s);
    const dir = o.dir;
    const spread = dir ? o.spread ?? 0.8 : 1;
    const B = this.B * this.glare;
    const vel = (min: number, max: number) => () => {
      const d = dir ? coneDir(dir, spread) : randomDir();
      return d.multiplyScalar(min + Math.random() * (max - min));
    };
    this.emit('spark', n * 0.7 * this.efx.sparks, { p, jitter: 0.08 * s, v: vel(sp * 0.5, sp * 1.6), life: [0.3, 0.75], size: [0.018 * s, 0.035 * s], gravity: 6, drag: 1.8, stretch: 0.035, colors: this.cols('core', 'main', 'accent'), bright: 3 * B, bounce: 0.35, fadeIn: 0, fadePow: 1.2 });
    this.emit('mote', n * 0.25, { p, jitter: 0.15 * s, v: vel(sp * 0.1, sp * 0.5), life: [0.6, 1.4], size: [0.025 * s, 0.05 * s], gravity: -0.4, drag: 2.2, turb: 2, flicker: 0.6, colors: this.cols('core', 'main', 'accent'), bright: 2.5 * B, fadeIn: 0.05 });
    this.efx.burst(this, p, { n, sp, s, vel });
  }

  extra(p: THREE.Vector3, pw = 1, s = 1): void {
    this.efx.extra(this, p, pw * this.power, s * this.scale);
  }

  trail(head: THREE.Vector3, prev: THREE.Vector3, vel: THREE.Vector3, dt: number, s = 1, density = 1): void {
    if (dt <= 0) return;
    this.efx.trail(this, { head, prev, vel, dt, s: s * this.scale, density });
  }

  impact(p: THREE.Vector3, o: { power?: number; dir?: THREE.Vector3; ringNormal?: RingNormal; scale?: number; hit?: boolean; extra?: boolean; role?: HitRole } = {}): void {
    const pw = (o.power ?? 1) * this.power;
    const s = (o.scale ?? 1) * this.scale;
    this.light(p, 3 * pw * s, 0.4);
    this.star(p, 1.5 * s * Math.sqrt(pw), 0.16);
    this.flare(p, s * pw);
    this.glow(p, 1.1 * s * Math.sqrt(pw), 0.3, 1.6);
    this.sphere(p, 0.9 * s * Math.sqrt(pw), 0.45, 1.6);
    this.ring(p, 1.3 * s, { normal: o.ringNormal ?? 'camera', dur: 0.35, thick: 0.1 });
    this.wave(p, 1.8 * s * pw, 0.45, pw);
    const h = this.heightAboveFloor(p);
    if (h < 1.7) {
      this.ring(this.ground(p), 1.8 * s, { dur: 0.5, thick: 0.07 });
      this.decal(p, (0.8 + 0.4 * pw) * s);
      if (h < 0.6) this.dust(p, s);
    }
    this.burst(p, { count: 70 * pw, dir: o.dir, spread: o.dir ? 0.8 : 1, scale: o.scale });
    if (o.extra) this.efx.extra(this, p, pw, s);
    if (o.hit !== false) this.hit(p, pw * s, o.role);
  }

  private lastAnime = -1;
  private stopUsed = 0;
  private stopEnd = -1;

  hit(p: THREE.Vector3, pw: number, role?: HitRole): void {
    const now = this.fx.scheduler.time;
    const r: HitRole = role ?? (this.hits === 0 ? 'first' : 'link');
    if ((this.params.anime ?? 0) > 0 && pw >= 0.75 && r !== 'tick' && this.fx.scheduler.time - this.lastAnime > 0.12) {
      this.lastAnime = this.fx.scheduler.time;
      const dir = p.clone().sub(this.from());
      const near = Math.min(Math.max(dir.length() / 5, 0.5), 1);
      this.animeHit(p, { dir: dir.lengthSq() > 1e-4 ? dir : undefined, power: Math.min(Math.max(pw, 0.6), 1.6), scale: (pw < 0.8 ? 0.7 : 1) * near });
    }
    const full = Math.min(pw >= 1.2 ? 0.07 + 0.03 * pw : 0.04, 0.12);
    let stop = 0;
    if (r === 'final') stop = Math.min(full * 1.2, 0.14);
    else if (r === 'first') stop = full;
    else if (r === 'link' && now - this.stopEnd > 0.25) stop = full * 0.3;
    if (r !== 'final') stop = Math.min(stop, Math.max(0.2 - this.stopUsed, 0));
    if (stop > 0) {
      this.stopUsed += stop;
      this.stopEnd = now + stop;
    }
    const big = r === 'first' || r === 'final';
    const shake = (big ? 0.3 : r === 'link' ? 0.12 : 0.06) * pw;
    const e: HitEvent = { point: p.clone(), power: pw, index: this.hits++, shake, hitStop: stop, role: r };
    this.handle.emit('hit', e);
    if (!this.fx.feel) return;
    this.fx.shake(e.shake);
    if (stop > 0 && this.fx.hitStopScale > 0) this.fx.hitStop(stop * this.fx.hitStopScale);
    const post = this.fx.post;
    if (!post || !big) return;
    post.aberration = Math.max(post.aberration, 0.5 * pw);
    if (pw >= 1.4) post.zoomAt(p, 0.3 * pw);
    if (pw >= 1.8 && this.fx.impactFrames && !this.fx.photosensitive) post.impactFrames = 0.1;
  }

  charge(p: THREE.Vector3, dur: number, o: { radius?: number; aim?: THREE.Vector3; ground?: THREE.Vector3 } = {}): void {
    const r = (o.radius ?? 0.9) * this.scale;
    const B = this.B;
    this.handle.emit('cast');
    if (o.ground) this.circle(this.ground(o.ground), 1.3 * this.scale, dur + 0.45, { spin: 0.6, slot: 'feet' });
    if (o.aim) this.circle(p.clone().addScaledVector(o.aim, 0.15), 0.5 * this.scale, dur + 0.12, { normal: o.aim, spin: -1.4, bright: 2, slot: 'hand' });
    this.ring(p, r * 1.2, { normal: 'camera', dur, thick: 0.05, bright: 1.2 });
    const held = this.hold(5);
    this.during(0, dur, (k, dt) => {
      const rate = 90 * (0.4 + k) * this.scale;
      const n = poisson(rate * dt);
      this.emitConverge(p, n, r);
      if (Math.random() < dt * 30) this.emit('glow', 1, { p, speed: 0, life: 0.12, size: 0.25 * this.scale * (0.5 + k), colors: this.cols('core', 'main'), bright: (0.8 + 1.4 * k) * B, fadeIn: 0.02 });
      held.set(p, k * 1.5 * 30);
    }, () => {
      held.release(0.15);
      this.star(p, 0.9 * this.scale, 0.14, 3);
      this.wave(p, 0.9, 0.3, 0.5);
    });
  }

  private emitConverge(p: THREE.Vector3, n: number, r: number): void {
    if (n <= 0) return;
    const hook = this.hook({ seek: { target: p, speed: 5.5 * Math.sqrt(r), steer: 5, arrive: 0.08 } });
    for (let i = 0; i < n; i++) {
      const out = randomDir();
      const start = p.clone().addScaledVector(out, r * (0.8 + Math.random() * 0.6));
      const swirl = out.clone().cross(UP).normalize().multiplyScalar((2.5 + Math.random() * 1.5) * Math.sqrt(r));
      this.emit('spark', 1, { p: start, v: () => swirl.clone(), hook, life: 0.9, size: [0.012, 0.022], stretch: 0.06, colors: this.cols('core', 'main'), bright: 2.2 * this.B, fadeIn: 0.08, alphaCurve: 'hold' });
    }
  }

  bolt(a: THREE.Vector3, b: THREE.Vector3, o: { dur?: number; width?: number; jag?: number; branches?: number; flicker?: boolean } = {}): void {
    const dur = o.dur ?? 0.2;
    const width = o.width ?? 0.15;
    const jag = o.jag ?? 0.18;
    const make = (from: THREE.Vector3, to: THREE.Vector3, w: number, depth: number) => {
      let pts = zigzag(from, to, jag);
      if (this.fx.prims.inUse('bolt') >= 64) return pts;
      const prim = this.fx.prims.acquire('bolt');
      prim.u.core.value.copy(this.pal.core);
      prim.u.main.value.copy(this.pal.main);
      prim.u.bright.value = (depth ? 2.2 : 3) * this.B;
      let t = 0;
      const build = () => stripGeometry(prim.mesh.geometry, pts, (i) => w * (1 - (i / pts.length) * 0.4), this.fx.camera);
      build();
      this.live(prim, dur, (k, age) => {
        if (age - t > 0.05) {
          t = age;
          pts = zigzag(from, to, jag);
        }
        build();
        const flick = o.flicker ? (Math.sin(age * 90) > -0.3 ? 1 : 0.25) : 1;
        prim.u.fade.value = (k < 0.6 ? 1 : 1 - (k - 0.6) / 0.4) * flick;
      });
      return pts;
    };
    const main = make(a, b, width, 0);
    for (let i = 0; i < (o.branches ?? 0); i++) {
      const at = main[Math.floor(main.length * (0.2 + Math.random() * 0.5))].clone();
      const len = a.distanceTo(b) * (0.2 + Math.random() * 0.25);
      const dir = b.clone().sub(a).normalize().add(randomDir().multiplyScalar(0.9)).normalize();
      make(at, at.clone().addScaledVector(dir, len), width * 0.55, 1);
    }
  }

  beam(from: () => THREE.Vector3, to: () => THREE.Vector3, o: { radius?: number; dur: number; fadeIn?: number; fadeOut?: number; flow?: number }): void {
    const r = (o.radius ?? 0.3) * this.scale;
    const layers = [this.fx.prims.acquire('beam'), this.fx.prims.acquire('beam')];
    layers.forEach((prim, i) => {
      prim.u.core.value.copy(i ? this.pal.core : this.pal.core);
      prim.u.main.value.copy(this.pal.main);
      prim.u.accent.value.copy(this.pal.accent);
      prim.u.bright.value = (i ? 2.6 : 1.6) * this.B;
      prim.u.inner.value = i;
      prim.u.flow.value = o.flow ?? 8;
    });
    const fi = o.fadeIn ?? 0.1;
    const fo = o.fadeOut ?? 0.25;
    const up = new THREE.Vector3(0, 1, 0);
    layers.forEach((prim, i) =>
      this.live(prim, o.dur, (_k, age) => {
        const a = from();
        const b = to();
        const d = b.clone().sub(a);
        const len = Math.max(d.length(), 0.01);
        prim.mesh.position.copy(a);
        prim.mesh.quaternion.setFromUnitVectors(up, d.divideScalar(len));
        const open = Math.min(age / fi, 1);
        const close = Math.min(Math.max((o.dur - age) / fo, 0), 1);
        const pulse = 1 + 0.08 * Math.sin(age * 50);
        const w = r * (i ? 0.42 : 1) * ease.outCubic(open) * (0.3 + 0.7 * close) * pulse;
        prim.mesh.scale.set(w, len, w);
        prim.u.len.value = len;
        prim.u.time.value = age;
        prim.u.fade.value = close;
      }),
    );
  }

  voidSphere(p: THREE.Vector3, size: number, dur: number): void {
    const prim = this.fx.prims.acquire('void');
    prim.u.main.value.copy(this.pal.main);
    prim.u.accent.value.copy(this.pal.accent);
    prim.u.bright.value = 3 * this.B;
    prim.mesh.position.copy(p);
    prim.mesh.renderOrder = 3;
    this.live(prim, dur, (k, age) => {
      prim.u.k.value = k;
      prim.u.time.value = age;
      const grow = ease.outBack(Math.min(k / 0.25, 1));
      const collapse = k > 0.75 ? 1 - ease.inQuad((k - 0.75) / 0.25) : 1;
      prim.mesh.scale.setScalar(Math.max(size * grow * collapse, 0.001));
    });
  }

  rocks(p: THREE.Vector3, n: number, s: number, vel: () => THREE.Vector3): void {
    const base = this.element === 'earth' ? this.pal.main.clone().lerp(new THREE.Color(0.35, 0.3, 0.26), 0.6).multiplyScalar(0.32) : new THREE.Color(0.16, 0.15, 0.14);
    for (let i = 0; i < n; i++) {
      const size = (0.06 + Math.random() * 0.12) * s;
      this.fx.rocks.spawn({
        p: p.clone().add(randomDir().multiplyScalar(0.15 * s)),
        v: vel(),
        size: new THREE.Vector3(size, size * (0.7 + Math.random() * 0.5), size),
        spin: 6 + Math.random() * 10,
        life: 1.6 + Math.random() * 1.2,
        gravity: 12,
        bounce: 0.35,
        color: base.clone().multiplyScalar(0.8 + Math.random() * 0.4),
        onLand: (q, speed) => {
          if (speed > 4) this.emit('smoke', 2, { p: q.clone(), v: () => randomDir().setY(0.3).multiplyScalar(0.6), life: [0.4, 0.7], size: [0.08, 0.14], grow: 2.2, drag: 3, colors: [new THREE.Color(0.3, 0.27, 0.24)], fadeIn: 0.03 });
        },
      });
    }
  }

  spike(p: THREE.Vector3, center: THREE.Vector3, h: number, kind: 'crystal' | 'rock', hold = 1): void {
    const out = p.clone().sub(center).setY(0);
    const outward = out.lengthSq() > 1e-4 ? out.normalize() : randomDir().setY(0).normalize();
    const g = this.ground(p).setY(this.floor - 0.04);
    const life = 0.12 + hold + 0.25;
    const rockCol = this.pal.main.clone().lerp(new THREE.Color(0.35, 0.3, 0.26), 0.6).multiplyScalar(0.32);
    const iceCol = this.pal.main.clone().lerp(this.pal.core, 0.3);
    const pieces = kind === 'crystal' ? 2 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 2);
    const tops: THREE.Vector3[] = [];
    for (let i = 0; i < pieces; i++) {
      const main = i === 0;
      const hh = h * (main ? 1 : 0.35 + Math.random() * 0.35);
      const lean = (main ? 0.35 : 0.6 + Math.random() * 0.5) * (kind === 'rock' ? 0.7 : 1);
      const side = randomDir().setY(0).normalize();
      const axis = outward.clone().multiplyScalar(lean).addScaledVector(side, main ? (Math.random() - 0.5) * 0.3 : 0.5).add(new THREE.Vector3(0, 1, 0)).normalize();
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2));
      const base = g.clone().addScaledVector(side, main ? 0 : h * (0.15 + Math.random() * 0.2));
      const w = hh * (kind === 'rock' ? 0.55 + Math.random() * 0.2 : 0.3 + Math.random() * 0.15);
      const delay = main ? 0 : 0.02 + Math.random() * 0.05;
      this.after(delay, () => {
        if (kind === 'crystal') this.fx.crystals.spawn({ p: base, size: new THREE.Vector3(w, hh, w * (0.8 + Math.random() * 0.4)), quat: q, life: life - delay, grow: 0.1 + Math.random() * 0.05, shrink: 0.15, color: iceCol.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.12) });
        else this.fx.spikes.spawn({ p: base, size: new THREE.Vector3(w, hh, w * (0.8 + Math.random() * 0.4)), quat: q, life: life - delay, grow: 0.1 + Math.random() * 0.04, shrink: 0.15, color: rockCol.clone().multiplyScalar(0.8 + Math.random() * 0.4) });
      });
      tops.push(base.clone().addScaledVector(axis, hh * 0.6));
    }
    if (kind === 'rock') {
      const n = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = h * (0.25 + Math.random() * 0.25);
        const sz = h * (0.14 + Math.random() * 0.14);
        this.fx.rocks.spawn({ p: g.clone().add(new THREE.Vector3(Math.cos(a) * r, sz * 0.25, Math.sin(a) * r)), size: new THREE.Vector3(sz, sz * 0.7, sz), life, grow: 0.08, shrink: 0.15, color: rockCol.clone().multiplyScalar(0.7 + Math.random() * 0.5) });
      }
    }
    if (Math.random() < 0.35) this.dust(g, 0.3 * h);
    this.after(0.12 + hold, () => {
      for (const top of tops) {
        if (kind === 'crystal') {
          this.emit('shard', 10 * h, { p: top, jitter: 0.2 * h, v: () => randomDir().multiplyScalar(2 + Math.random() * 2), life: [0.35, 0.6], size: [0.03, 0.08], gravity: 8, stretch: 0.02, bounce: 0.3, colors: this.cols('core', 'main'), bright: 2 * this.B });
          for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
            const sz = 0.05 + Math.random() * 0.1;
            this.fx.crystals.spawn({ p: top.clone().add(randomDir().multiplyScalar(0.15 * h)), v: randomDir().setY(Math.random() * 1.5).multiplyScalar(2 + Math.random() * 2), size: new THREE.Vector3(sz, sz * (1.5 + Math.random()), sz), spin: 8 + Math.random() * 10, life: 0.7 + Math.random() * 0.6, gravity: 11, bounce: 0.3, shrink: 0.3, color: iceCol });
          }
        } else this.rocks(top, Math.round(3 * h + 2), h * 0.7, () => randomDir().setY(Math.random() * 2).multiplyScalar(2));
      }
    });
  }

  fly(o: { from: THREE.Vector3; to: () => THREE.Vector3; dur: number; curve?: THREE.Vector3; step?: (head: THREE.Vector3, prev: THREE.Vector3, vel: THREE.Vector3, dt: number, k: number) => void; arrive: (at: THREE.Vector3) => void; ease?: (t: number) => number }): void {
    const head = o.from.clone();
    const prev = o.from.clone();
    const vel = new THREE.Vector3();
    const ctrl = new THREE.Vector3();
    const e = o.ease ?? ((t: number) => t);
    this.during(0, o.dur, (k, dt) => {
      const b = o.to();
      ctrl.copy(o.from).lerp(b, 0.5);
      if (o.curve) ctrl.add(o.curve);
      const t = e(k);
      const u = 1 - t;
      head.set(0, 0, 0).addScaledVector(o.from, u * u).addScaledVector(ctrl, 2 * u * t).addScaledVector(b, t * t);
      if (dt > 0) vel.subVectors(head, prev).divideScalar(dt);
      this.handle.head.copy(head);
      o.step?.(head, prev, vel, dt, k);
      prev.copy(head);
    }, () => o.arrive(head.clone()));
  }

  ribbon(width: number): { trail: RibbonTrail; release: (fade?: number) => void } {
    const prim = this.fx.prims.acquire('ribbon');
    prim.u.core.value.copy(this.pal.core);
    prim.u.main.value.copy(this.pal.main);
    prim.u.accent.value.copy(this.pal.accent);
    prim.u.bright.value = 1.2 * this.B;
    prim.u.seed.value = Math.random() * 50;
    prim.u.fade.value = 1;
    const trail = new RibbonTrail(prim, RIBBON_LENGTH, width);
    let released = false;
    let fadeAge = -1;
    let fadeDur = 0.25;
    this.fx.scheduler.add(
      {
        update: (dt) => {
          prim.u.time.value += dt;
          if (released) {
            fadeAge += dt;
            prim.u.fade.value = Math.max(1 - fadeAge / fadeDur, 0);
            if (trail.points.length > 1) trail.points.pop();
          }
          trail.update(this.fx.camera);
          return !released || fadeAge < fadeDur;
        },
        dispose: () => this.fx.prims.release(prim),
      },
      this.handle,
    );
    return {
      trail,
      release: (fade = 0.25) => {
        released = true;
        fadeAge = 0;
        fadeDur = fade;
      },
    };
  }

  arc(o: { pivot: THREE.Vector3; e1: THREE.Vector3; e2: THREE.Vector3; a0: number; a1: number; r0: number; r1: number; dur: number; ease: (t: number) => number; lag: number; hold?: number }): void {
    const prim = this.fx.prims.acquire('arc');
    arcGeometry(prim.mesh.geometry, o.pivot, o.e1, o.e2, o.a0, o.a1, o.r0, o.r1);
    prim.u.core.value.copy(this.pal.core);
    prim.u.main.value.copy(this.pal.main);
    prim.u.accent.value.copy(this.pal.accent);
    prim.u.bright.value = 3.2 * this.B;
    prim.u.seed.value = Math.random() * 50;
    prim.u.lag.value = o.lag;
    prim.u.fade.value = 1;
    prim.u.time.value = 0;
    const hold = o.hold ?? 0.12;
    const total = o.dur + hold + o.lag * o.dur;
    this.live(prim, total, (_k, age) => {
      prim.u.time.value = age;
      const k = Math.min(age / o.dur, 1);
      const over = Math.max(age - o.dur, 0);
      prim.u.head.value = o.ease(k) + over / o.dur;
      prim.u.fade.value = 1 - Math.max(over - hold * 0.5, 0) / (total - o.dur);
    });
  }

  crescent(p: THREE.Vector3, size: number, screenAngle: number, o: { hold?: number; bend?: number } = {}): void {
    const prim = this.fx.prims.acquire('crescent');
    const m = prim.mesh;
    prim.u.core.value.copy(this.pal.core);
    prim.u.main.value.copy(this.pal.main);
    prim.u.bright.value = 3 * this.B;
    prim.u.bend.value = o.bend ?? 0.3;
    m.renderOrder = 5;
    const cam = this.fx.camera;
    const dir = cam.getWorldPosition(v3()).sub(p).normalize();
    const hold = o.hold ?? 0.3;
    this.live(prim, hold, (k) => {
      prim.u.k.value = k;
      m.position.copy(p).addScaledVector(dir, 0.4);
      m.quaternion.copy(cam.quaternion);
      m.rotateZ(screenAngle);
      const pop = k < 0.08 ? ease.outBack(k / 0.08) : 1;
      m.scale.set(size * (0.6 + 0.4 * pop) * (1 + k * 0.15), size * 0.5 * pop, 1);
    });
  }
  private color(k: ColorKey): THREE.Color {
    return k === 'smoke' ? this.pal.smoke ?? this.pal.accent : this.pal[k];
  }

  lathe(p: THREE.Vector3, o: LatheOptions): void {
    this.after(o.delay ?? 0, () => {
      const prim = this.fx.prims.acquire(o.smoke ? 'latheSmoke' : 'lathe');
      const u = prim.u;
      const m = prim.mesh;
      const profile = o.profile ?? 'cylinder';
      const r = o.radius * this.scale;
      const h = o.height * this.scale;
      const set: Record<string, number> = {
        mode: profile === 'dome' || profile === 'sphere' ? 1 : 0,
        r0: profile === 'funnel' ? r * 0.18 : r,
        r1: o.top !== undefined ? o.top * this.scale : profile === 'cone' ? r * 0.04 : profile === 'funnel' ? r : r,
        curve: o.curve ?? (profile === 'funnel' ? 1.8 : 1),
        bulge: (o.bulge ?? (profile === 'vase' ? 0.35 : 0)) * r,
        height: profile === 'sphere' || profile === 'dome' ? (o.height ? h : r) : h,
        a0: o.a0 ?? 0,
        span: o.span ?? Math.PI * 2,
        t0: profile === 'dome' ? 0 : -Math.PI / 2,
        t1: Math.PI / 2,
        twist: o.twist ?? 0,
        spin: o.spin ?? 0,
        flow: o.flow ?? 0,
        tilesA: o.tiles?.[0] ?? 3,
        tilesV: o.tiles?.[1] ?? 2,
        streak: o.streak ?? 0.5,
        rim: o.rim ?? 0,
        wobble: o.wobble ?? 0,
        fadeLo: o.fadeLo ?? (profile === 'dome' ? 0.001 : 0.15),
        fadeHi: o.fadeHi ?? (profile === 'dome' || profile === 'sphere' ? 0.001 : 0.3),
        edge: o.edge ?? 0.08,
        bendX: (o.bend?.[0] ?? 0) * this.scale,
        bendZ: (o.bend?.[1] ?? 0) * this.scale,
        sway: (o.sway ?? 0) * this.scale,
        swayF: o.swayF ?? 2,
        seed: o.seed ?? Math.random() * 50,
        time: 0,
        erode: 0,
        turn: Math.random() * Math.PI * 2,
        erodeTilt: 0,
      };
      for (const [k, v] of Object.entries(set)) u[k].value = v;
      const [c0, c1, c2] = o.colors ?? ['core', 'main', 'accent'];
      u.core.value.copy(this.color(c0));
      u.main.value.copy(this.color(c1));
      u.accent.value.copy(this.color(c2));
      const bright = (o.bright ?? 1.4) * (o.smoke ? 1 : this.B * this.glare);
      u.bright.value = bright;
      if (o.axis) m.quaternion.setFromUnitVectors(UP, o.axis.clone().normalize());
      else m.quaternion.identity();
      m.renderOrder = o.smoke ? 1 : 3;
      let last = 0;
      this.live(prim, o.dur, (k, age) => {
        m.position.copy(o.at ? o.at() : p);
        u.time.value = age;
        if (o.turnRate) u.turn.value += o.turnRate(k) * (age - last);
        last = age;
        u.erodeTilt.value = o.erodeTilt ? o.erodeTilt(k) : 0;
        u.erode.value = o.erode ? o.erode(k) : Math.max(k - 0.55, 0) / 0.45;
        u.fade.value = o.fade ? o.fade(k) : Math.min(age / 0.06, 1);
        const g = o.grow ? o.grow(k) : 1;
        if (Array.isArray(g)) m.scale.set(Math.max(g[0], 1e-3), Math.max(g[1], 1e-3), Math.max(g[0], 1e-3));
        else m.scale.setScalar(Math.max(g, 1e-3));
      });
    });
  }

  helix(o: HelixOptions & { dur: number; lag?: number; hold?: number; delay?: number; ease?: (t: number) => number; bright?: number; at?: () => THREE.Vector3 }): void {
    this.after(o.delay ?? 0, () => {
      const prim = this.fx.prims.acquire('helix');
      const s = this.scale;
      const opts: HelixOptions = { ...o, r0: o.r0 * s, r1: o.r1 * s, height: o.height * s, width: o.width * s };
      helixGeometry(prim.mesh.geometry, opts);
      prim.u.core.value.copy(this.pal.core);
      prim.u.main.value.copy(this.pal.main);
      prim.u.accent.value.copy(this.pal.accent);
      prim.u.bright.value = (o.bright ?? 2.4) * this.B * this.glare;
      prim.u.seed.value = Math.random() * 50;
      prim.u.lag.value = o.lag ?? 0.5;
      prim.u.fade.value = 1;
      const e = o.ease ?? ease.outCubic;
      const hold = o.hold ?? 0.15;
      const lag = o.lag ?? 0.5;
      const total = o.dur + hold + lag * o.dur;
      const center = o.center.clone();
      this.live(prim, total, (_k, age) => {
        if (o.at) {
          const c = o.at();
          if (!c.equals(center)) {
            center.copy(c);
            helixGeometry(prim.mesh.geometry, { ...opts, center });
          }
        }
        prim.u.time.value = age;
        const k = Math.min(age / o.dur, 1);
        const over = Math.max(age - o.dur, 0);
        prim.u.head.value = e(k) + over / o.dur;
        prim.u.fade.value = 1 - Math.max(over - hold * 0.5, 0) / (total - o.dur);
      });
    });
  }

  band(p: THREE.Vector3, o: BandOptions): void {
    const dur = o.dur ?? 0.45;
    this.after(o.delay ?? 0, () => {
      const prim = this.fx.prims.acquire('band');
      const u = prim.u;
      const m = prim.mesh;
      m.position.copy(p);
      const [c0, c1, c2] = o.colors ?? ['core', 'main', 'accent'];
      u.cIn.value.copy(this.color(c0));
      u.cMid.value.copy(this.color(c1));
      u.cOut.value.copy(this.color(c2));
      u.inner.value = o.inner ?? 0.6;
      u.span.value = o.span ?? Math.PI * 2;
      u.fadeS.value = o.fadeS ?? 0.2;
      u.fadeE.value = o.fadeE ?? 0.2;
      u.hard.value = o.hard ?? 0;
      u.noise.value = o.noise ?? 1;
      u.seed.value = Math.random() * 50;
      u.bright.value = (o.bright ?? 1.8) * this.B * this.glare;
      const normal = o.normal ?? 'up';
      const orient = () => {
        if (o.quat) m.quaternion.copy(o.quat);
        else if (normal === 'camera') m.quaternion.copy(this.fx.camera.quaternion);
        else if (normal === 'up') m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), UP);
        else m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
      };
      orient();
      const grow = o.grow ?? ((k: number) => 0.2 + 0.8 * ease.outExpo(k));
      this.live(prim, dur, (k, age) => {
        if (normal === 'camera' && !o.quat) orient();
        if (o.at) m.position.copy(o.at());
        u.k.value = o.kFn ? o.kFn(k) : k;
        if (o.thick) u.inner.value = 1 - o.thick(k);
        u.a0.value = (o.a0 ?? 0) + (o.spin ?? 0) * age;
        m.scale.setScalar(Math.max(o.radius * this.scale * grow(k), 1e-3));
      });
    });
  }

  screenAngle(p: THREE.Vector3, dir: THREE.Vector3): number {
    const cam = this.fx.camera;
    const a = p.clone().project(cam);
    const b = p.clone().add(dir).project(cam);
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  lines(p: THREE.Vector3, o: { size: number; count?: number; inner?: number; width?: number; density?: number; parallel?: number; dur?: number; delay?: number; bright?: number; burst?: number; hold?: number }): void {
    const dur = o.dur ?? 0.34;
    const burst = o.burst ?? 0.07;
    const hold = o.hold ?? 0.08;
    this.after(o.delay ?? 0, () => {
      const prim = this.fx.prims.acquire('lines');
      const u = prim.u;
      const m = prim.mesh;
      u.count.value = o.count ?? (o.parallel !== undefined ? 22 : 64);
      u.inner.value = o.inner ?? 0.28;
      u.width.value = o.width ?? 0.2;
      u.density.value = o.density ?? 0.7;
      u.mode.value = o.parallel !== undefined ? 1 : 0;
      u.core.value.copy(this.pal.core).lerp(new THREE.Color(1, 1, 1), 0.5);
      u.main.value.copy(this.pal.main);
      u.seed.value = Math.floor(Math.random() * 500);
      u.bright.value = (o.bright ?? 1.6) * this.B * this.glare;
      const cam = this.fx.camera;
      this.live(prim, dur, (_k, age) => {
        u.reach.value = ease.outExpo(clamp01(age / burst));
        u.k.value = o.parallel !== undefined ? ease.outCubic(clamp01(age / dur)) : ease.inCubic(span(age, burst + hold * 0.3, dur));
        m.position.copy(p);
        m.quaternion.copy(cam.quaternion);
        if (o.parallel !== undefined) m.rotateZ(o.parallel);
        m.scale.setScalar(o.size * this.scale * (1 + 0.08 * ease.outCubic(clamp01(age / dur))));
      });
    });
  }

  hitmark(p: THREE.Vector3, o: { size: number; spikes?: number; inner?: number; sharp?: number; hard?: number; dur?: number; delay?: number; angle?: number; bright?: number; boost?: number; stretch?: [number, number]; line?: boolean; boil?: number; colors?: [THREE.Color, THREE.Color, THREE.Color] }): void {
    const dur = o.dur ?? 0.3;
    this.after(o.delay ?? 0, () => {
      const prim = this.fx.prims.acquire('hitmark');
      const u = prim.u;
      const m = prim.mesh;
      u.spikes.value = o.spikes ?? 7 + Math.floor(Math.random() * 4);
      u.inner.value = o.inner ?? 0.36;
      u.sharp.value = o.sharp ?? 1;
      u.hard.value = o.hard ?? 1;
      u.boost.value = o.boost ?? 0;
      const [c0, c1, c2] = o.colors ?? [new THREE.Color(1, 1, 1).lerp(this.pal.core, 0.2), this.pal.core.clone().lerp(this.pal.main, 0.55), this.pal.main.clone().lerp(this.pal.accent, 0.5)];
      u.core.value.copy(c0);
      u.main.value.copy(c1);
      u.accent.value.copy(c2);
      const seed0 = Math.floor(Math.random() * 500);
      u.seed.value = seed0;
      u.bright.value = o.bright ?? 1.25;
      u.alpha.value = 1;
      u.hole.value = 0;
      const cam = this.fx.camera;
      const dir = cam.getWorldPosition(v3()).sub(p).normalize();
      const angle = o.angle ?? Math.random() * Math.PI * 2;
      const [sx, sy] = o.stretch ?? [1, 1];
      const size = o.size * this.scale;
      const boil = o.boil ?? 12;
      const holdEnd = Math.min(0.13, dur * 0.45);
      this.live(prim, dur, (k, age) => {
        m.position.copy(p).addScaledVector(dir, 0.3);
        m.quaternion.copy(cam.quaternion);
        m.rotateZ(angle);
        if (o.line) {
          const len = 0.25 + 0.75 * ease.outExpo(clamp01(age / 0.1)) + 0.2 * k;
          const wid = 1 - 0.8 * ease.outCubic(k);
          m.scale.set(Math.max(size * sx * len, 1e-3), Math.max(size * sy * wid, 1e-3), 1);
          u.alpha.value = 1 - ease.inCubic(span(k, 0.55, 1));
          u.k.value = k;
          return;
        }
        let pop: number;
        if (age < 0.05) pop = 1.15 * ease.outExpo(age / 0.05);
        else if (age < 0.09) pop = 1.15 - 0.15 * ease.outCubic((age - 0.05) / 0.04);
        else pop = 1 + 0.15 * ease.outCubic(span(age, holdEnd, dur));
        m.scale.set(Math.max(size * sx * pop, 1e-3), Math.max(size * sy * pop, 1e-3), 1);
        u.hole.value = 1.05 * ease.inCubic(span(age, holdEnd, dur));
        if (boil > 0) u.seed.value = seed0 + Math.floor(age * boil);
        u.k.value = k;
      });
    });
  }

  animeHit(p: THREE.Vector3, o: { dir?: THREE.Vector3; power?: number; scale?: number } = {}): void {
    const pw = (o.power ?? 1) * this.power;
    const s = (o.scale ?? 1) * Math.sqrt(pw);
    const f = 1 / 60;
    const ang = o.dir && o.dir.lengthSq() > 1e-6 ? this.screenAngle(p, o.dir) : (Math.random() - 0.5) * 0.8;
    const white = new THREE.Color(1, 1, 1);
    const post = this.fx.post;
    if (post && pw >= 1 && (this.fx.scheduler.time - lastBlink > 0.4 || this.fx.scheduler.time < lastBlink)) {
      lastBlink = this.fx.scheduler.time;
      post.flashTint(white.clone().lerp(this.pal.core, 0.3));
      post.blinkAmount = (this.fx.photosensitive ? 0.04 : 0.09) * Math.min(pw, 1.4) * this.glare;
      post.blinkT = 2.2 * f;
    }
    this.emit('glow', 1, { p, speed: 0, life: 0.06, size: 0.8 * s, grow: 1.3, colors: [white, this.pal.core], bright: 3.2 * this.B, fadeIn: 0, fadePow: 2 });
    this.hitmark(p, { size: 1.5 * s, spikes: 7 + Math.floor(Math.random() * 3), sharp: 1.9, inner: 0.3, boost: 1, stretch: [1.45, 0.8], angle: ang, dur: 0.34, bright: 0.85 });
    this.hitmark(p, { size: 1.0 * s, spikes: 5 + Math.floor(Math.random() * 3), sharp: 2.4, inner: 0.22, angle: ang + Math.PI / 7, dur: 0.26, bright: 0.9, delay: f, boil: 0, colors: [white, white.clone().lerp(this.pal.core, 0.5), this.pal.main.clone()] });
    this.hitmark(p, { size: 2.6 * s, spikes: 2, inner: 0.03, sharp: 1, line: true, stretch: [1.6, 0.12], angle: ang + (Math.random() - 0.5) * 0.5, dur: 0.3, delay: f, boil: 0, bright: 0.9 });
    this.band(p, {
      radius: 1.9 * s,
      normal: 'camera',
      hard: 1,
      noise: 1,
      dur: 0.36,
      delay: f,
      colors: ['core', 'main', 'accent'],
      grow: (k) => 0.18 + 0.64 * ease.outExpo(clamp01(k * 2.5)) + 0.18 * k,
      thick: (k) => (k < 0.3 ? 0.06 + 0.26 * ease.outCubic(k / 0.3) : 0.32 * Math.pow(1 - (k - 0.3) / 0.7, 1.5) + 0.015),
    });
    this.lines(p, { size: 3.4 * s, dur: 0.4, delay: f * 2, count: 36, density: 0.6, inner: 0.45, width: 0.2 });
    const dir = o.dir && o.dir.lengthSq() > 1e-6 ? o.dir.clone().normalize() : undefined;
    this.emit('spark', 26 * pw, { p, v: () => (dir ? coneDir(dir, 0.45) : randomDir()).multiplyScalar(7 + Math.random() * 9), life: [0.12, 0.26], size: [0.02 * s, 0.035 * s], drag: 5, stretch: 0.05, colors: [white, this.pal.core, this.pal.main], bright: 3 * this.B, fadeIn: 0, fadePow: 0.7 });
    this.emit('shard', 10 * pw, { p, v: () => (dir ? coneDir(dir, 0.7) : randomDir()).multiplyScalar(4 + Math.random() * 5), life: [0.25, 0.45], size: [0.05 * s, 0.1 * s], gravity: 9, drag: 2.5, spin: [-14, 14], colors: [white, this.pal.core, this.pal.main], bright: 2 * this.B, fadeIn: 0, fadePow: 0.6 });
    this.after(f * 4, () => this.smoke(p, 5 * s, { jitter: 0.15 * s, speed: [0.6, 1.4], size: [0.22 * s, 0.35 * s], life: [0.5, 0.8], delay: 0 }));
  }

  tornado(g: THREE.Vector3, o: { radius: number; height: number; dur: number; power?: number; travel?: THREE.Vector3; goal?: THREE.Vector3; reach?: number; debris?: number }): THREE.Vector3 {
    const s = this.scale;
    const R = o.radius;
    const H = o.height;
    const pw = o.power ?? 1;
    const life = o.dur;
    const spinUp = Math.min(0.5, life * 0.3);
    const fall = Math.min(0.7, life * 0.35);
    const pos = g.clone();
    const id = claimAnchor(g);
    const center = anchors[id];
    const ph = Math.random() * Math.PI * 2;
    const travel = o.travel?.clone() ?? new THREE.Vector3();
    this.during(0, life + 0.3, (_k, dt, age) => {
      if (o.goal) pos.copy(g).lerp(o.goal, ease.inOutCubic(clamp01(age / (o.reach ?? life * 0.5))));
      else pos.addScaledVector(travel, dt * Math.min(age / spinUp, 1));
      center.set(pos.x + Math.cos(ph + age * 2.2) * 0.12 * R * s, pos.y, pos.z + Math.sin(ph + age * 2.2) * 0.12 * R * s);
    });
    this.fx.scheduler.after(life + 3, () => releaseAnchor(id), null);
    const at = () => center;
    const rise = (age: number) => ease.outExpo(clamp01(age / spinUp));
    const gone = (age: number) => ease.inOutQuad(span(age, life - fall, life));
    const grow = (k: number): [number, number] => {
      const age = k * life;
      const r = rise(age);
      return [(0.3 + 0.7 * r) * (1 + 0.35 * gone(age)), ease.outCubic(clamp01(age / (spinUp * 1.3)))];
    };
    const turn = (speed: number) => (k: number) => speed * (0.35 + 0.65 * ease.inQuad(clamp01((k * life) / spinUp)));
    const bend: [number, number] = [(Math.random() - 0.5) * R * 0.9, (Math.random() - 0.5) * R * 0.9];
    const erode = (k: number) => 0.9 * gone(k * life);
    const fade = (k: number) => Math.min((k * life) / 0.08, 1) * (1 - Math.pow(gone(k * life), 2));
    const tilt = (t: number) => (k: number) => t - 1.2 * gone(k * life);
    const base = { profile: 'funnel' as const, at, dur: life, grow, bend, sway: 0.14 * R, swayF: 2.6, erode, fade, erodeTilt: tilt(0) };
    this.lathe(g, { ...base, radius: 0.75 * R, height: 0.95 * H, twist: 6, flow: 1.8, tiles: [6, 2], streak: 0.9, rim: -0.3, bright: 1.25, turnRate: turn(9) });
    this.lathe(g, { ...base, radius: 1.1 * R, height: H, twist: 5, flow: 1.2, tiles: [5, 1.6], streak: 0.85, rim: 0.5, bright: 1.1, turnRate: turn(6.5), erodeTilt: tilt(0.5), wobble: 0.08 });
    const dusty = !!this.pal.smoke && ['earth', 'fire', 'poison', 'dark'].includes(this.element);
    this.lathe(g, { ...base, radius: 1.45 * R, height: 1.05 * H, twist: 3.5, flow: 0.8, tiles: [4, 1.3], streak: 0.75, rim: 0.7, bright: dusty ? 0.9 : 0.55, smoke: dusty, colors: dusty ? ['main', 'smoke', 'smoke'] : ['main', 'main', 'accent'], turnRate: turn(-4), erodeTilt: tilt(0.8), wobble: 0.12 });
    this.lathe(g, { profile: 'cone', at, radius: 1.8 * R, top: 0.35 * R, height: 0.14, dur: life, twist: 3, flow: 1.6, tiles: [5, 1], streak: 0.6, rim: 0, fadeLo: 0.35, fadeHi: 0.35, bright: 0.8, grow: (k) => grow(k)[0], erode, turnRate: turn(5) });
    const light = this.hold(7);
    const B = this.B * this.glare;
    const debris = (o.debris ?? 1) * pw;
    const orbit = (w: number, rise: number, r0: number, r1: number, h: number, pull = 3) => ({ w, rise, r0: r0 * R * s, r1: r1 * R * s, h: h * H * s, pull, anchor: id });
    const wisp = orbit(10, 2.6 * s, 0.4, 1.25, 1);
    const leaf = orbit(7, 1.5 * s, 0.55, 1.45, 1.05);
    const dust = orbit(4.5, 0.5 * s, 0.9, 1.6, 0.35, 2);
    const around = (rr: number, y = 0.05) => () => {
      const a = Math.random() * Math.PI * 2;
      const r = rr * R * s * (0.7 + Math.random() * 0.6);
      return center.clone().add(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
    };
    const smokeCol = this.pal.smoke ?? this.pal.accent.clone().multiplyScalar(0.4);
    const dustCol = smokeCol.clone().lerp(new THREE.Color(0.32, 0.29, 0.26), 0.5);
    this.during(0, life - fall * 0.5, (_k, dt, age) => {
      const on = rise(age);
      this.emit('spark', poisson(70 * dt * on * debris), { p: around(0.6, 0.1), orbit: wisp, life: [0.6, 1.1], size: [0.012 * s, 0.022 * s], stretch: 0.06, colors: this.cols('core', 'main'), bright: 2 * B, fadeIn: 0.1 });
      this.emit('shard', poisson(22 * dt * on * debris), { p: around(1.3), orbit: leaf, life: [1, 1.6], size: [0.04 * s, 0.09 * s], spin: [-10, 10], colors: [this.pal.main.clone().lerp(this.pal.accent, 0.5), this.pal.accent, smokeCol], bright: 1.3 * B, fadeIn: 0.1 });
      this.emit('mote', poisson(30 * dt * on * debris), { p: around(1), orbit: leaf, life: [0.8, 1.4], size: [0.02, 0.035], flicker: 0.4, colors: this.cols('core', 'main'), bright: 2 * B, fadeIn: 0.1 });
      this.emit('smoke', poisson(26 * dt * on * debris), { p: around(1.2, 0.1), orbit: dust, v: () => new THREE.Vector3(0, 0.2, 0), life: [0.9, 1.5], size: [0.3 * s * R, 0.5 * s * R], grow: 2, colors: [dustCol, dustCol.clone().multiplyScalar(0.7)], fadeIn: 0.15, fadePow: 1.2 });
      this.efx.swirl?.(this, around, orbit, dt * on * debris);
      if (Math.random() < dt * 9 * debris && age < life - fall) this.debrisRock(center, R * s, H * s, () => age >= life - fall * 0.7 || !this.handle.playing);
      light.set(center.clone().setY(center.y + H * s * 0.4), 1.4 * 30 * on * (1 - gone(age)));
      if (this.fx.feel) this.fx.shake(dt * 0.25 * on);
    }, () => light.release(0.4));
    return center;
  }

  private debrisRock(center: THREE.Vector3, R: number, H: number, stop: () => boolean): void {
    const size = (0.05 + Math.random() * 0.1) * Math.sqrt(R);
    const low = 1 - size / (0.15 * Math.sqrt(R));
    let th = Math.random() * Math.PI * 2;
    let h = 0.05;
    let r = R * (1.4 + Math.random() * 0.5);
    const top = H * (0.35 + 0.5 * Math.max(low, 0.2));
    const w = 5 + Math.random() * 3;
    const prev = new THREE.Vector3();
    const col = this.element === 'earth' ? this.pal.main.clone().lerp(new THREE.Color(0.35, 0.3, 0.26), 0.6).multiplyScalar(0.32) : new THREE.Color(0.16, 0.15, 0.14);
    this.fx.rocks.spawn({
      p: center.clone(),
      size: new THREE.Vector3(size, size * (0.7 + Math.random() * 0.5), size),
      spin: 8 + Math.random() * 8,
      life: 4,
      gravity: 12,
      bounce: 0.3,
      shrink: 0.1,
      color: col.multiplyScalar(0.8 + Math.random() * 0.4),
      drive: (p, v, _age, dt) => {
        if (dt <= 0) return true;
        prev.copy(p);
        const target = R * (0.45 + 0.5 * Math.min(h / top, 1));
        r += (target - r) * Math.min(2 * dt, 1);
        h += (top - h) * Math.min(1.2 * dt, 1);
        th += w * dt * Math.sqrt(R / Math.max(r, 0.2));
        p.set(center.x + Math.cos(th) * r, center.y + h, center.z + Math.sin(th) * r);
        v.subVectors(p, prev).divideScalar(dt);
        if (!stop()) return true;
        v.add(new THREE.Vector3(Math.cos(th), 0.6, Math.sin(th)).multiplyScalar(3));
        return false;
      },
    });
  }
}

function zigzag(a: THREE.Vector3, b: THREE.Vector3, jag: number): THREE.Vector3[] {
  let pts = [a.clone(), b.clone()];
  const len = a.distanceTo(b);
  let amp = len * jag;
  for (let level = 0; level < 5; level++) {
    const next: THREE.Vector3[] = [];
    for (let i = 0; i < pts.length - 1; i++) {
      next.push(pts[i]);
      next.push(pts[i].clone().lerp(pts[i + 1], 0.5).add(randomDir().multiplyScalar(amp * (Math.random() * 0.8 + 0.2))));
    }
    next.push(pts[pts.length - 1]);
    pts = next;
    amp *= 0.5;
  }
  return pts;
}

let lastBlink = -1;

export function poisson(lambda: number): number {
  if (lambda < 30) {
    const L = Math.exp(-lambda);
    let k = 0;
    let p = 1;
    do {
      k++;
      p *= Math.random();
    } while (p > L);
    return k - 1;
  }
  return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (Math.random() * 2 - 1)));
}

export type Shape =
  | { type: 'circle'; at: THREE.Vector3; r: number; axis?: THREE.Vector3; ordered?: boolean; arc?: [number, number]; jitter?: number }
  | { type: 'line'; a: THREE.Vector3; b: THREE.Vector3; ordered?: boolean; jitter?: number }
  | { type: 'body'; at: THREE.Vector3; r: number; h: number }
  | { type: 'sphere'; at: THREE.Vector3; r: number; shell?: boolean }
  | { type: 'disc'; at: THREE.Vector3; r: number; axis?: THREE.Vector3 };

function pickRange(r: Range | undefined, fallback: number): number {
  if (r === undefined) return fallback;
  if (typeof r === 'number') return r;
  if (typeof r === 'function') return r();
  return r[0] + Math.random() * (r[1] - r[0]);
}

function basis(axis: THREE.Vector3 | undefined, e1: THREE.Vector3, e2: THREE.Vector3): THREE.Vector3 {
  const ax = (axis ?? UP).clone().normalize();
  e1.set(1, 0, 0);
  if (Math.abs(ax.dot(e1)) > 0.9) e1.set(0, 0, 1);
  e1.sub(ax.clone().multiplyScalar(ax.dot(e1))).normalize();
  e2.crossVectors(ax, e1).normalize();
  return ax;
}

const sb1 = new THREE.Vector3();
const sb2 = new THREE.Vector3();

export function sampleShape(s: Shape, i: number, n: number, p: THREE.Vector3, nrm: THREE.Vector3, tan: THREE.Vector3): void {
  if (s.type === 'circle' || s.type === 'disc') {
    const ax = basis(s.axis, sb1, sb2);
    const arc = s.type === 'circle' && s.arc ? s.arc : [0, Math.PI * 2];
    const ordered = s.type === 'circle' && s.ordered;
    const full = arc[1] - arc[0] >= Math.PI * 2 - 1e-3;
    const u = ordered ? (full ? i / n : n > 1 ? i / (n - 1) : 0.5) : Math.random();
    const a = arc[0] + (arc[1] - arc[0]) * u + (s.type === 'circle' ? (Math.random() - 0.5) * (s.jitter ?? 0) : 0);
    const r = s.type === 'disc' ? s.r * Math.sqrt(Math.random()) : s.r;
    nrm.copy(sb1).multiplyScalar(Math.cos(a)).addScaledVector(sb2, Math.sin(a));
    tan.crossVectors(ax, nrm).normalize();
    p.copy(s.at).addScaledVector(nrm, r);
  } else if (s.type === 'line') {
    const u = s.ordered ? (n > 1 ? i / (n - 1) : 0.5) : Math.random();
    p.copy(s.a).lerp(s.b, u);
    tan.subVectors(s.b, s.a).normalize();
    nrm.copy(randomDir()).addScaledVector(tan, -nrm.dot(tan)).normalize();
    if (s.jitter) p.addScaledVector(nrm, (Math.random() - 0.5) * s.jitter);
  } else if (s.type === 'body') {
    const a = Math.random() * Math.PI * 2;
    nrm.set(Math.cos(a), 0, Math.sin(a));
    tan.set(-Math.sin(a), 0, Math.cos(a));
    p.copy(s.at).addScaledVector(nrm, s.r).setY(s.at.y + Math.random() * s.h);
  } else {
    randomDir(nrm);
    tan.crossVectors(UP, nrm).normalize();
    p.copy(s.at).addScaledVector(nrm, s.shell === false ? s.r * Math.cbrt(Math.random()) : s.r);
  }
}
