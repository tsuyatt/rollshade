// Rollshade FX runtime 0.1.1 — https://rollshade.tsuyatt.com/
// Copyright (c) 2026 tsuyatt. MIT License (see the LICENSE file or https://www.npmjs.com/package/rollshade).
// psrdnoise3 and permute4 are ported from psrdnoise (https://github.com/stegu/psrdnoise), Copyright (c) 2021 Stefan Gustavson and Ian McEwan, MIT License (see the LICENSE file).
// Needs three r186 (three/webgpu, three/tsl, three/addons). three.js is MIT licensed.
import type * as THREE from 'three/webgpu';

export declare const VERSION: '0.1.1';

/** A fixed point, or an Object3D whose world position is read every frame. */
export type Anchor = THREE.Vector3 | THREE.Object3D;

export type RecipeName = 'projectile' | 'lance' | 'beam' | 'explosion' | 'pillar' | 'meteor' | 'nova' | 'barrier' | 'shockwave' | 'summon' | 'missiles' | 'tornado' | 'storm' | 'drill' | 'finale' | 'heal' | 'buff' | 'warp' | 'slash' | 'thrust' | 'spin' | 'cross' | 'smash' | 'iaido' | 'strike';

export type ElementName = 'fire' | 'ice' | 'thunder' | 'wind' | 'earth' | 'water' | 'light' | 'dark' | 'poison' | 'arcane';

/** A move definition. Make one with `effect()`; `id` is what `fx.play(id)` looks up. */
export interface EffectDef {
  id: string;
  recipe: RecipeName | (string & {});
  element: ElementName | (string & {});
  hue?: number;
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
}

/** `'cast'`: charge starts. `'release'`: fired or swung. `'hit'`: a hit lands (`barrier`, `buff` and `warp` send none). `'vanish'` / `'appear'`: warp only. `'end'`: the move is over. */
export type HitRole = 'first' | 'link' | 'final' | 'tick';

export type FXEvent = 'cast' | 'release' | 'hit' | 'vanish' | 'appear' | 'end';

/** Options for `new FXSystem()`. Everything except `scene`, `camera` and `renderer` is optional. */
export interface FXOptions {
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGPURenderer;
  /** Bloom and screen distortion; then call `fx.render()` instead of `renderer.render()`. Off by default. */
  post?: boolean | { strength?: number; radius?: number; threshold?: number };
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
  /** Melee blade path, updated every frame (not for `strike`). */
  readonly blade: { base: THREE.Vector3; tip: THREE.Vector3; active: boolean };
  /** Position of the projectile head or fist while the move travels. */
  readonly head: THREE.Vector3;
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

/** `progress` (0–1) is how far the status has spread; `duration` is the seconds to reach it, not how long the status lasts. */
export interface StatusOptions {
  element?: ElementName | (string & {});
  hue?: number;
  progress?: number;
  duration?: number;
  scale?: number;
}

/** Returned by `fx.status()`. Lasts until `stop()`, or until the target leaves the scene (`appear` ends by itself). */
export declare class StatusRun {
  readonly name: string;
  readonly alive: boolean;
  readonly value: number;
  progress: number;
  readonly done: Promise<void>;
  to(progress: number, seconds?: number): this;
  /** Shield only: a ripple where it was hit. */
  impact(point: THREE.Vector3): void;
  /** Fades the status out over `fade` seconds, then fires `'end'`. */
  stop(fade?: number): void;
  on(event: 'full' | 'end', fn: () => void): () => void;
}

export type LoopName = 'torch' | 'campfire' | 'candles' | 'portal' | 'sigil' | 'savepoint' | 'barrier' | 'aura' | 'beacon';

/** Options for `fx.loop()`. `floorY` defaults to the height the loop is placed at. */
export interface LoopOptions {
  floorY?: number;
  element?: ElementName | (string & {});
  hue?: number;
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
  /** Compiles the status materials for this kind of model; call once while loading. `onProgress` gets 0–1. */
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

export declare function defineEffect<T extends EffectDef>(def: T): T;

export interface EffectOptions {
  seed?: number | string;
  id?: string;
  hue?: number;
  params?: Record<string, number>;
}

/** Builds a move definition with the id `${element}-${recipe}` (or `${element}-${recipe}-${seed}` with a seed). */
export declare function effect(recipe: RecipeName, element?: ElementName, options?: EffectOptions): EffectDef;

export declare const ELEMENTS: Record<ElementName, { core: number; main: number; accent: number; smoke: number | null }>;
export declare const RECIPES: Record<RecipeName, { defaults: Record<string, number> }>;
export declare const MELEE: Set<string>;
export declare const SUPPORT: Set<string>;
export declare const SELF: Set<string>;
export declare const EVENT: Set<string>;
