import { Color } from 'three/webgpu';
import { variant } from '../core/fx/variation';
import { seedFromString } from '../core/rng/hash';
import { ELEMENTS } from './palette';
import { RECIPES } from './recipes';
import { FIXTURES } from './fixtures';
import { STATUSES } from './statuses';
import type { EffectDef } from './system';

export interface EffectOptions {
  seed?: number | string;
  id?: string;
  hue?: number;
  color?: number | string;
  params?: Record<string, number>;
}

export function effect(recipe: string, element = 'fire', options: EffectOptions = {}): EffectDef {
  if (!Object.hasOwn(RECIPES, recipe) && Object.hasOwn(STATUSES, recipe)) throw new Error(`rollshade: "${recipe}" is a status effect, not a move. Use fx.status(target, '${recipe}') instead of effect()`);
  if (!Object.hasOwn(RECIPES, recipe) && Object.hasOwn(FIXTURES, recipe)) throw new Error(`rollshade: "${recipe}" is a placed loop, not a move. Use fx.loop('${recipe}', position) instead of effect()`);
  if (!Object.hasOwn(RECIPES, recipe)) throw new Error(`rollshade: unknown recipe "${recipe}". Use one of: ${Object.keys(RECIPES).join(', ')}`);
  if (!Object.hasOwn(ELEMENTS, element)) throw new Error(`rollshade: unknown element "${element}". Use one of: ${Object.keys(ELEMENTS).join(', ')}`);
  const seed = options.seed === undefined ? 0 : typeof options.seed === 'string' ? seedFromString(options.seed) : options.seed >>> 0;
  const base = variant(recipe, element, seed);
  return {
    ...base,
    id: options.id ?? (options.seed === undefined ? `${element}-${recipe}` : base.id),
    hue: options.hue ?? (options.color != null ? 0 : base.hue),
    ...(options.color != null ? { color: new Color(options.color).getHex() } : {}),
    params: { ...base.params, ...options.params },
  };
}
