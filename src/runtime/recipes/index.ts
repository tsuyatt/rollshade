import type { Ctx } from '../ctx';
import { barrier, beam, explosion, lance, meteor, nova, pillar, projectile } from './magic';
import { cleave, combo, cross, dash, flurry, iaido, rising, slash, smash, spin, swipe, thrust, wave } from './melee';
import { heel, kick, palm, pound, rush, tackle, uppercut } from './blunt';
import { buff, heal } from './support';
import { shockwave, strike } from './strike';
import { missiles, summon, warp } from './summon';
import { drill, finale, storm, tornado } from './storm';

export type Recipe = ((ctx: Ctx, p: Record<string, number>) => void) & { defaults: Record<string, number> };

export const RECIPES: Record<string, Recipe> = { projectile, lance, beam, explosion, pillar, meteor, nova, barrier, shockwave, summon, missiles, tornado, storm, drill, finale, heal, buff, warp, slash, swipe, rising, cleave, combo, wave, dash, flurry, thrust, spin, cross, smash, iaido, strike, rush, uppercut, kick, heel, palm, tackle, pound };

export const MELEE = new Set(['slash', 'swipe', 'rising', 'cleave', 'combo', 'wave', 'dash', 'flurry', 'thrust', 'spin', 'cross', 'smash', 'iaido', 'strike', 'rush', 'uppercut', 'kick', 'heel', 'palm', 'tackle', 'pound']);

export const BLUNT = new Set(['strike', 'rush', 'uppercut', 'kick', 'heel', 'palm', 'tackle', 'pound']);

export const SUPPORT = new Set(['heal', 'buff', 'warp']);

export const EVENT = new Set(['finale']);

export const SELF = new Set(['barrier', 'nova', 'buff', 'warp']);
