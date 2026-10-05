// Rollshade FX runtime 0.3.0 — https://rollshade.tsuyatt.com/
// Copyright (c) 2026 tsuyatt. MIT License (see the LICENSE file or https://www.npmjs.com/package/rollshade).
// psrdnoise3 and permute4 are ported from psrdnoise (https://github.com/stegu/psrdnoise), Copyright (c) 2021 Stefan Gustavson and Ian McEwan, MIT License (see the LICENSE file).
// Needs three r186 (three/webgpu, three/tsl, three/addons). three.js is MIT licensed.
import type * as THREE from 'three/webgpu';

export declare const VERSION: '0.3.0';

/** A fixed point, or an Object3D whose world position is read every frame. */
export type Anchor = THREE.Vector3 | THREE.Object3D;

export type RecipeName = 'projectile' | 'lance' | 'beam' | 'explosion' | 'pillar' | 'meteor' | 'nova' | 'barrier' | 'shockwave' | 'summon' | 'missiles' | 'tornado' | 'storm' | 'drill' | 'finale' | 'heal' | 'buff' | 'warp' | 'slash' | 'swipe' | 'rising' | 'cleave' | 'combo' | 'wave' | 'dash' | 'flurry' | 'thrust' | 'spin' | 'cross' | 'smash' | 'iaido' | 'strike' | 'rush' | 'uppercut' | 'kick' | 'heel' | 'palm' | 'tackle' | 'pound';

export type ElementName = 'plain' | 'fire' | 'ice' | 'thunder' | 'wind' | 'earth' | 'water' | 'light' | 'dark' | 'poison' | 'arcane';

/** A move definition. Make one with `effect()`; `id` is what `fx.play(id)` looks up. */
export interface EffectDef {
  id: string;
  recipe: RecipeName | (string & {});
  element: ElementName | (string & {});
  hue?: number;
  /** Base colour (0xrrggbb) that replaces the element's colours. */
  color?: number;
  params?: Record<string, number>;
}

/** Where a move starts and lands. See the Moves table in the README for what `from` and `to` mean per recipe. */
export interface PlayOptions {
  from: Anchor;
  to: Anchor;
  /** Multiplies the power of every hit (default 1). */
  power?: number;
  /** Scales the whole move (default 1). */
  scale?: number;
  /** Ground height under this move; defaults to `fx.floorY`. */
  floorY?: number;
}

/** Sent with every `'hit'`. Apply damage here. */
export interface HitEvent {
  point: THREE.Vector3;
  /** About 1 per hit; ticks less, finishers up to about 2.7; heals 0. */
  power: number;
  /** 0 for the first hit of the move, then 1, 2, … */
  index: number;
  /** Suggested camera shake (applied for you with `feel: true`). */
  shake: number;
  /** Suggested hit-stop in seconds (applied for you with `feel: true`). */
  hitStop: number;
  role: HitRole;
  /** Unit direction to push the target (knockback): away from the attacker, up for uppercuts, down for slams. */
  dir: THREE.Vector3;
}

/** `'cast'`: charge starts. `'release'`: fired or swung. `'hit'`: a hit lands (`barrier`, `buff` and `warp` send none). `'vanish'` / `'appear'`: warp only. `'end'`: the move is over. */
export type HitRole = 'first' | 'link' | 'final' | 'tick';

export type FXEvent = 'cast' | 'release' | 'hit' | 'vanish' | 'appear' | 'end';

/** Options for `new FXSystem()`. Everything except `scene`, `camera` and `renderer` is optional. */
export interface FXOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGPURenderer;
  /** Bloom and screen distortion; then call `fx.render()` instead of `renderer.render()`. Off by default. Bloom applies to rollshade's effects only; `bloom: 'scene'` blooms the whole picture. */
  post?: boolean | { strength?: number; radius?: number; threshold?: number; bloom?: 'fx' | 'scene' };
  /** Camera shake, hit-stop and chromatic aberration on hits. Off by default. */
  feel?: boolean;
  /** Multiplies the automatic hit-stop; 0 turns it off. Default 1. */
  hitStopScale?: number;
  /** Height of the flat ground. Default 0. */
  floorY?: number;
  /** Point lights for moves. Default 6. */
  lights?: number;
  /** Point lights shared by placed loops. Default 4. */
  loopLights?: number;
  lightScale?: number;
  /** Tones down screen flashes. */
  photosensitive?: boolean;
  impactFrames?: boolean;
  budget?: Partial<Record<string, number>>;
  /** Largest share of the screen one particle may cover. Default 0.5. */
  maxScreenSize?: number;
  nearFade?: [number, number];
  /** `'high'` (default), `'medium'`, `'low'` or `'auto'`, or a number from 0.3 to 1. */
  quality?: QualityPreset | number;
  /** Resolution of the scene pass with `post`, 0.25–1. */
  renderScale?: number;
  autoResolution?: boolean | { min?: number; max?: number };
  frameBudget?: number;
}

/** Returned by `fx.play()`. */
export declare class FXHandle {
  readonly id: string;
  readonly playing: boolean;
  readonly done: Promise<void>;
  /** Melee blade path, updated every frame (not for fist and kick moves). */
  readonly blade: { base: THREE.Vector3; tip: THREE.Vector3; active: boolean };
  /** Position of the projectile head, fist or foot while the move travels. */
  readonly head: THREE.Vector3;
  /** Hints for animating the attacker, updated every frame by melee moves: root `offset` from where the move started (steps, dashes, jumps; back to zero as the move settles), forward `lean` and `turn` in radians, and which `limb` `head` follows. */
  readonly body: { offset: THREE.Vector3; lean: number; turn: number; limb: 'fist' | 'foot' | null };
  on(event: 'hit', fn: (e: HitEvent) => void): () => void;
  on(event: 'vanish' | 'appear', fn: (e: { point: THREE.Vector3 }) => void): () => void;
  on(event: 'cast' | 'release' | 'end', fn: () => void): () => void;
  /** Ends the move now and fires `'end'`. Safe inside handlers. */
  stop(): void;
}

export interface LoopContext {
  object?: THREE.Object3D;
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGPURenderer;
  period?: number;
}

export interface LoopInstance {
  object?: THREE.Object3D;
  uniforms: Record<string, any>;
  update(seconds: number): void;
  dispose(): void;
}

export interface LoopDef {
  kind: 'loop';
  id: string;
  period: number;
  object?: boolean;
  bloom?: { strength: number; radius: number; threshold: number };
  create(ctx: LoopContext): LoopInstance;
}

export interface SpawnOptions {
  at?: THREE.Vector3 | THREE.Object3D;
  object?: THREE.Object3D;
  period?: number;
  scale?: number;
}

export declare class LoopHandle {
  readonly id: string;
  readonly uniforms: Record<string, any>;
  readonly object: THREE.Object3D | undefined;
  time: number;
  playing: boolean;
  pause(): void;
  resume(): void;
  moveTo(at: THREE.Vector3 | THREE.Object3D): void;
  stop(): void;
}

export declare function defineLoop(def: Omit<LoopDef, 'kind'>): LoopDef;
export declare const helpers: Record<string, any>;

export type StatusName = 'burn' | 'freeze' | 'shock' | 'poison' | 'petrify' | 'dissolve' | 'appear' | 'bless' | 'curse' | 'shield' | 'stun';

/** `progress` (0–1) is how far the status has spread; `duration` is the seconds to reach it. `lasts` is how long the status stays. */
export interface StatusOptions {
  element?: ElementName | (string & {});
  hue?: number;
  color?: THREE.ColorRepresentation;
  progress?: number;
  duration?: number;
  /** Seconds (game time) from the start until the status fades out by itself. Without it, the status stays until `stop()`. */
  lasts?: number;
  /** Fade-out seconds when `lasts` runs out or `stop()` is called without an argument. Default 0.4. */
  fade?: number;
  scale?: number;
}

/** Returned by `fx.status()`. Lasts until `stop()`, its `lasts` time, or until the target leaves the scene (`appear` ends by itself). */
export declare class StatusRun {
  readonly name: string;
  readonly alive: boolean;
  readonly value: number;
  progress: number;
  /** Seconds left before the status fades out by itself (`Infinity` without a limit). Assign to restart the countdown. */
  lasts: number;
  readonly done: Promise<void>;
  to(progress: number, seconds?: number): this;
  /** Shield only: a ripple where it was hit. */
  impact(point: THREE.Vector3): void;
  /** Fades the status out over `fade` seconds (default: the `fade` option, 0.4), then fires `'end'`. */
  stop(fade?: number): void;
  on(event: 'full' | 'end', fn: () => void): () => void;
}

export type LoopName = 'torch' | 'campfire' | 'candles' | 'portal' | 'sigil' | 'savepoint' | 'barrier' | 'aura' | 'beacon';

/** Options for `fx.loop()`. `floorY` defaults to the height the loop is placed at. */
export interface LoopOptions {
  floorY?: number;
  element?: ElementName | (string & {});
  hue?: number;
  color?: THREE.ColorRepresentation;
  scale?: number;
  prop?: boolean;
  light?: boolean;
  intensity?: number;
  rotation?: number;
}

/** Returned by `fx.loop()`. Runs until `stop()`. */
export declare class FixtureRun {
  readonly name: string;
  readonly alive: boolean;
  readonly group: THREE.Group;
  intensity: number;
  readonly done: Promise<void>;
  moveTo(at: THREE.Vector3 | THREE.Object3D): void;
  impact(point: THREE.Vector3): void;
  stop(fade?: number): void;
  on(event: 'end', fn: () => void): () => void;
}

export declare const STATUSES: Record<StatusName, unknown>;
export declare const FIXTURES: Record<LoopName, unknown>;

export type QualityPreset = 'auto' | 'high' | 'medium' | 'low';

/** Plays moves, statuses and loops. Create one per scene, call `update(seconds)` then `render()` every frame. */
export declare class FXSystem {
  constructor(options: FXOptions);
  readonly root: THREE.Group;
  timeScale: number;
  autoQuality: boolean;
  quality: number;
  renderScale: number;
  readonly qualityPreset: QualityPreset;
  setQuality(preset: QualityPreset): void;
  maxScreenSize: number;
  minParticleSize: number;
  camera: THREE.Camera;
  floorY: number;
  feel: boolean;
  hitStopScale: number;
  photosensitive: boolean;
  impactFrames: boolean;
  readonly hitStopping: boolean;
  add(...defs: (EffectDef | LoopDef)[]): this;
  /** Plays a move by id (after `add()`) or from a definition. */
  play(effect: string | EffectDef, options: PlayOptions): FXHandle;
  spawn(effect: string | LoopDef, options?: SpawnOptions): LoopHandle;
  /** Puts a status on a character or mesh (the target must contain a mesh). */
  status(target: THREE.Object3D, name: StatusName, options?: StatusOptions): StatusRun;
  /** Compiles the status materials for this kind of model; call once while loading. The target may be outside the scene or hidden: it is added for the compile and put back. `onProgress` gets 0–1. */
  prewarmStatus(target: THREE.Object3D, names?: StatusName[], onProgress?: (progress: number) => void): Promise<void>;
  statusesOf(target: THREE.Object3D): StatusRun[];
  /** Places a lasting effect at a ground point, or on an Object3D it follows. */
  loop(name: LoopName, at: THREE.Vector3 | THREE.Object3D, options?: LoopOptions): FixtureRun;
  /** Compiles every move and loop shader; await it once while loading. `onProgress` gets 0–1, for a loading bar. */
  prewarm(counts?: Partial<Record<string, number>>, onProgress?: (progress: number) => void): Promise<void>;
  /** Advances everything; clamp the delta (for example to 0.05 s). */
  update(seconds: number): void;
  /** Renders the scene with bloom and shake (or plainly with `post: false`). */
  render(): void;
  shake(amount: number): void;
  hitStop(seconds: number): void;
  stats(): { effects: number; loops: number; statuses: number; particles: number; solids: number; created: number; quality: number };
  /** Stops every move, status and loop. */
  clear(): void;
  /** Frees GPU resources; the system cannot be used afterwards. */
  dispose(): void;
}

/** Hits of a move's default definition, measured at `distance` metres without hit-stop. Seeds and params change them. */
export interface MoveTiming {
  /** Distance to the target the numbers were measured at (6 m for magic, 2 m for melee). */
  distance: number;
  /** Hits in a typical cast. */
  hits: number;
  /** Fewest and most hits seen (`meteor` and `storm` vary per cast). */
  hitRange: [number, number];
  /** Sum of `e.power` over a typical cast, before `PlayOptions.power`. */
  power: number;
  /** Seconds after `fx.play()` of the first and last hit; null for moves without hits. */
  first: number | null;
  last: number | null;
  /** Seconds after `fx.play()` until `'end'`. */
  end: number;
  /** Seconds the first and the last hit move later per metre of extra distance. */
  perMetre: number;
  lastPerMetre: number;
  /** Every hit of a typical cast: [seconds after `fx.play()`, power, role]. */
  timeline: [number, number, HitRole][];
}

export declare const MOVES: Record<RecipeName, MoveTiming>;

export declare function defineEffect<T extends EffectDef>(def: T): T;

export interface EffectOptions {
  seed?: number | string;
  id?: string;
  hue?: number;
  /** Base colour for the move, e.g. `0xff3355` or `'#ff3355'`; works with every element. */
  color?: number | string;
  params?: Record<string, number>;
}

/** Builds a move definition with the id `${element}-${recipe}` (or `${element}-${recipe}-${seed}` with a seed). */
export declare function effect(recipe: RecipeName, element?: ElementName, options?: EffectOptions): EffectDef;

export declare const ELEMENTS: Record<ElementName, { core: number; main: number; accent: number; smoke: number | null }>;
export declare const RECIPES: Record<RecipeName, { defaults: Record<string, number> }>;
export declare const MELEE: Set<string>;
/** Fist, kick and body moves (a subset of MELEE). */
export declare const BLUNT: Set<string>;
export declare const SUPPORT: Set<string>;
export declare const SELF: Set<string>;
export declare const EVENT: Set<string>;
