export { FXSystem, FXHandle } from './system';
export type { EffectDef, FXOptions, PlayOptions, HitEvent, FXEvent, Anchor } from './system';
export { ELEMENTS } from './palette';
export { RECIPES, MELEE, SUPPORT, SELF, EVENT } from './recipes';
export { defineLoop, LoopHandle } from './loops';
export type { LoopDef, LoopContext, LoopInstance, SpawnOptions } from './loops';
export { helpers } from './loop-helpers';
export { effect } from './effect';
export { STATUSES } from './statuses';
export { FIXTURES, FixtureRun } from './fixtures';
export type { FixtureOptions } from './fixtures';
export { StatusRun } from './status';
export type { StatusOptions, StatusEvent } from './status';
export type { EffectOptions } from './effect';
export const VERSION = '0.1.0';

import type { EffectDef } from './system';

export function defineEffect(def: EffectDef): EffectDef {
  return def;
}
