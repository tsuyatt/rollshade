import { RECIPES } from '../../runtime/recipes';
import { STATUSES } from '../../runtime/statuses';
import { FIXTURES } from '../../runtime/fixtures';
import type { EffectDef } from '../../runtime/system';
import { Rng } from '../rng/rng';
import { seedToString } from '../rng/hash';

type Span = [number, number, 'int'?];

export const RANGES: Record<string, Record<string, Span>> = {
  projectile: { circleFeet: [-4, 8, 'int'], circleHand: [-4, 8, 'int'], circleTarget: [-8, 8, 'int'], charge: [0.25, 0.5], speed: [9, 16], curve: [0, 1.4], size: [0.8, 1.25], after: [1, 5, 'int'], power: [0.9, 1.3], count: [1, 3, 'int'], anime: [0, 0, 'int'] },
  lance: { circleFeet: [-4, 8, 'int'], circleHand: [-4, 8, 'int'], circleTarget: [-8, 8, 'int'], charge: [0.18, 0.35], speed: [26, 40], size: [0.8, 1.2], power: [1.1, 1.6], anime: [0, 0, 'int'] },
  beam: { circleFeet: [-4, 8, 'int'], circleHand: [-4, 8, 'int'], circleTarget: [-8, 8, 'int'], charge: [0.35, 0.65], dur: [0.9, 1.6], radius: [0.25, 0.45], tick: [0.12, 0.2], anime: [0, 0, 'int'] },
  explosion: { circleFeet: [-4, 8, 'int'], circleHand: [-4, 8, 'int'], circleTarget: [-8, 8, 'int'], gather: [0.4, 0.75], size: [1, 1.5], power: [1.6, 2], secondary: [3, 8, 'int'], anime: [0, 0, 'int'] },
  pillar: { circleFeet: [-4, 8, 'int'], circleHand: [-4, 8, 'int'], circleTarget: [-8, 8, 'int'], delay: [0.25, 0.5], dur: [0.8, 1.4], radius: [0.55, 0.95], height: [4, 8], power: [1.2, 1.7], anime: [0, 0, 'int'] },
  meteor: { circleFeet: [-4, 8, 'int'], circleHand: [-4, 8, 'int'], circleTarget: [-8, 8, 'int'], count: [5, 12, 'int'], dur: [0.9, 1.6], fall: [0.4, 0.65], radius: [1.6, 2.8], size: [0.85, 1.25], anime: [0, 0, 'int'] },
  nova: { circleFeet: [-4, 8, 'int'], circleHand: [-4, 8, 'int'], circleTarget: [-8, 8, 'int'], charge: [0.45, 0.7], size: [0.9, 1.25], power: [1.5, 1.9], anime: [0, 0, 'int'] },
  barrier: { circleFeet: [-4, 8, 'int'], dur: [1.8, 3], radius: [1.15, 1.6], poke: [0.3, 0.7], anime: [0, 0, 'int'] },
  summon: { circleFeet: [-4, 8, 'int'], circleHand: [-4, 8, 'int'], gate: [0, 2, 'int'], radius: [0.75, 1.1], charge: [0.3, 0.55], speed: [12, 20], size: [0.85, 1.2], power: [1.6, 2], anime: [0, 0, 'int'] },
  missiles: { circleFeet: [-4, 8, 'int'], circleHand: [-4, 8, 'int'], circleTarget: [-8, 8, 'int'], charge: [0.25, 0.45], count: [8, 18, 'int'], launch: [-55, 10], fan: [140, 240], smoke: [0.6, 1.4], stagger: [0.03, 0.06], hang: [0.1, 0.25], speed: [24, 36], size: [0.85, 1.15], power: [1.2, 1.6], anime: [0, 0, 'int'] },
  warp: { circleFeet: [-4, 8, 'int'], charge: [0.15, 0.35], offset: [0.9, 1.8], travel: [0.08, 0.2], size: [0.9, 1.1] },
  tornado: { circleFeet: [-4, 8, 'int'], circleHand: [-4, 8, 'int'], circleTarget: [-8, 8, 'int'], charge: [0.25, 0.45], dur: [2.2, 3.4], radius: [0.9, 1.3], height: [3, 4.2], drift: [0, 1], size: [0.9, 1.15], power: [1.3, 1.8], debris: [0.7, 1.4], anime: [0, 0, 'int'] },
  storm: { circleFeet: [-4, 8, 'int'], circleTarget: [-4, 8, 'int'], charge: [0.45, 0.8], dur: [2.4, 3.6], radius: [2.6, 3.8], slant: [0.1, 0.5], density: [0.8, 1.3], power: [1.3, 1.8], anime: [0, 0, 'int'] },
  drill: { circleFeet: [-4, 8, 'int'], circleHand: [-4, 8, 'int'], form: [0.35, 0.6], speed: [11, 17], grind: [0.4, 0.9], size: [0.85, 1.2], power: [1.5, 2], anime: [0, 0, 'int'] },
  finale: { crack: [0.8, 1.4], rays: [6, 12, 'int'], pops: [4, 8, 'int'], implode: [0.25, 0.45], size: [0.9, 1.2], power: [1.8, 2.2] },
  heal: { circleHand: [-4, 8, 'int'], circleTarget: [1, 8, 'int'], charge: [0.22, 0.4], dur: [1.3, 1.9], radius: [0.55, 0.8], turns: [1, 1.7], ribbons: [2, 4, 'int'], symbols: [0.7, 1.4] },
  buff: { circleFeet: [-4, 8, 'int'], charge: [0.22, 0.4], hold: [2, 3.5], radius: [0.48, 0.65], height: [1.8, 2.4], rate: [0.8, 1.3], pulse: [1.4, 2.2] },
  strike: { windup: [0.12, 0.25], hits: [1, 3, 'int'], power: [1.2, 1.8], size: [0.85, 1.2], cone: [0.6, 1.2], anime: [0, 0, 'int'] },
  shockwave: { circleFeet: [-4, 8, 'int'], charge: [0.18, 0.35], count: [1, 3, 'int'], speed: [10, 16], span: [100, 160], size: [0.85, 1.25], power: [1.1, 1.6], anime: [0, 0, 'int'] },
  slash: { windup: [0.08, 0.18], dur: [0.14, 0.24], sweep: [150, 230], roll: [-60, 60], lag: [0.45, 0.8], power: [0.9, 1.6], sparks: [0.6, 1.4], anime: [0, 0, 'int'] },
  thrust: { windup: [0.12, 0.22], dur: [0.09, 0.15], power: [1.1, 1.6], anime: [0, 0, 'int'] },
  spin: { windup: [0.06, 0.14], dur: [0.3, 0.45], sweep: [380, 460], roll: [-10, 15], power: [0.9, 1.3], anime: [0, 0, 'int'] },
  cross: { windup: [0.1, 0.16], dur: [0.12, 0.18], gap: [0.15, 0.3], power: [1.4, 1.9], anime: [0, 0, 'int'] },
  smash: { windup: [0.22, 0.34], dur: [0.11, 0.17], power: [1.5, 2], fissure: [3, 7, 'int'], anime: [0, 0, 'int'] },
  iaido: { charge: [0.45, 0.8], dur: [0.05, 0.09], delay: [0.3, 0.55], power: [1.7, 2.1], anime: [0, 0, 'int'] },
};

export function variant(recipe: string, element: string, seed: number): EffectDef {
  const rng = new Rng(seed).fork(`${recipe}:${element}`);
  const defaults = RECIPES[recipe]?.defaults ?? {};
  const params: Record<string, number> = { ...defaults };
  const side = new Rng(seed).fork(`${recipe}:${element}:extra`);
  for (const [key, [min, max, kind]] of Object.entries(RANGES[recipe] ?? {})) {
    const r = key === 'anime' ? side : rng;
    let v = kind === 'int' ? r.int(min, max) : r.float(min, max);
    if (key.startsWith('circle') || key === 'anime') v = Math.max(v, 0);
    params[key] = kind === 'int' ? v : Math.round(v * 1000) / 1000;
  }
  return { id: `${element}-${recipe}-${seedToString(seed)}`, recipe, element, hue: Math.round(rng.float(-0.018, 0.018) * 1000) / 1000, params };
}

export function clampParams(recipe: string, params: Record<string, number>): Record<string, number> {
  const ranges = Object.hasOwn(RANGES, recipe) ? RANGES[recipe] : {};
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value !== 'number' || !Number.isFinite(value)) continue;
    const span = Object.hasOwn(ranges, key) ? ranges[key] : undefined;
    if (!span) {
      out[key] = value;
      continue;
    }
    const [min, max] = span;
    out[key] = Math.min(Math.max(value, min > 0 ? min / 4 : min), max > 0 ? max * 4 : max);
  }
  return out;
}

export const FX_DEFAULT = { fxRecipe: 'projectile', fxElement: 'fire' };

export function effectFor(recipe: string, element: string, seed: number, overrides: Record<string, number>): EffectDef {
  const base = variant(recipe, element, seed);
  return { ...base, params: { ...base.params, ...overrides } };
}

export type FxKind = 'move' | 'status' | 'loop';

export function fxKind(recipe: string): FxKind {
  return recipe.startsWith('status:') ? 'status' : recipe.startsWith('loop:') ? 'loop' : 'move';
}

export function fxName(recipe: string): string {
  return recipe.slice(recipe.indexOf(':') + 1);
}

export function defaultElement(recipe: string): string | null {
  const kind = fxKind(recipe);
  if (kind === 'status') return STATUSES[fxName(recipe)]?.element ?? null;
  if (kind === 'loop') return FIXTURES[fxName(recipe)]?.element ?? null;
  return null;
}

export function isRecipe(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  if (name.startsWith('status:')) return Object.hasOwn(STATUSES, name.slice(7));
  if (name.startsWith('loop:')) return Object.hasOwn(FIXTURES, name.slice(5));
  return Object.hasOwn(RECIPES, name);
}
