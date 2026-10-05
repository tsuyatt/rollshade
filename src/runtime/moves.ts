import type { HitRole } from './system';

export interface MoveTiming {
  distance: number;
  hits: number;
  hitRange: [number, number];
  power: number;
  first: number | null;
  last: number | null;
  end: number;
  perMetre: number;
  lastPerMetre: number;
  timeline: [number, number, HitRole][];
}

export const MOVES: Record<string, MoveTiming> = {
  projectile: { distance: 6, hits: 1, hitRange: [1, 1], power: 1.14, first: 0.86, last: 0.86, end: 1.54, perMetre: 0.07, lastPerMetre: 0.07, timeline: [[0.86, 1.14, 'first']] },
  lance: { distance: 6, hits: 1, hitRange: [1, 1], power: 1.01, first: 0.47, last: 0.47, end: 0.98, perMetre: 0.04, lastPerMetre: 0.04, timeline: [[0.47, 1.01, 'first']] },
  beam: { distance: 6, hits: 7, hitRange: [7, 7], power: 3.88, first: 0.4, last: 1.3, end: 1.8, perMetre: 0, lastPerMetre: 0, timeline: [[0.4, 0.5, 'tick'], [0.56, 0.5, 'tick'], [0.72, 0.5, 'tick'], [0.89, 0.5, 'tick'], [1.06, 0.5, 'tick'], [1.22, 0.5, 'tick'], [1.3, 0.88, 'final']] },
  explosion: { distance: 6, hits: 1, hitRange: [1, 1], power: 1.98, first: 0.45, last: 0.45, end: 1.45, perMetre: 0, lastPerMetre: 0, timeline: [[0.45, 1.98, 'first']] },
  pillar: { distance: 6, hits: 1, hitRange: [1, 1], power: 1.58, first: 0.33, last: 0.33, end: 1.82, perMetre: 0, lastPerMetre: 0, timeline: [[0.33, 1.58, 'first']] },
  meteor: { distance: 6, hits: 4, hitRange: [2, 5], power: 7.69, first: 1.24, last: 2.17, end: 3.17, perMetre: 0, lastPerMetre: 0, timeline: [[1.24, 2.11, 'first'], [1.74, 1.66, 'link'], [1.82, 2.02, 'link'], [2.17, 1.9, 'final']] },
  nova: { distance: 6, hits: 1, hitRange: [1, 1], power: 1.37, first: 0.81, last: 0.81, end: 1.54, perMetre: 0.02, lastPerMetre: 0.02, timeline: [[0.81, 1.37, 'first']] },
  barrier: { distance: 6, hits: 0, hitRange: [0, 0], power: 0, first: null, last: null, end: 2.91, perMetre: 0, lastPerMetre: 0, timeline: [] },
  shockwave: { distance: 6, hits: 1, hitRange: [1, 1], power: 1.09, first: 0.85, last: 0.85, end: 1.35, perMetre: 0.1, lastPerMetre: 0.1, timeline: [[0.85, 1.09, 'first']] },
  summon: { distance: 6, hits: 1, hitRange: [1, 1], power: 2.22, first: 1.36, last: 1.36, end: 1.97, perMetre: 0, lastPerMetre: 0, timeline: [[1.36, 2.22, 'first']] },
  missiles: { distance: 6, hits: 16, hitRange: [16, 16], power: 4.3, first: 1.75, last: 2.66, end: 3.17, perMetre: 0.03, lastPerMetre: 0.05, timeline: [[1.75, 0.2, 'first'], [1.85, 0.2, 'link'], [1.86, 0.2, 'link'], [1.86, 0.2, 'link'], [2.04, 0.2, 'link'], [2.06, 0.2, 'link'], [2.09, 0.2, 'link'], [2.14, 0.2, 'link'], [2.24, 0.2, 'link'], [2.25, 0.2, 'link'], [2.26, 0.2, 'link'], [2.38, 0.2, 'link'], [2.57, 0.2, 'link'], [2.58, 0.2, 'link'], [2.64, 0.2, 'link'], [2.66, 1.23, 'final']] },
  tornado: { distance: 6, hits: 8, hitRange: [8, 8], power: 6.08, first: 1.11, last: 3.03, end: 3.63, perMetre: 0.04, lastPerMetre: 0, timeline: [[1.11, 0.67, 'tick'], [1.42, 0.67, 'tick'], [1.72, 0.67, 'tick'], [2.02, 0.67, 'tick'], [2.33, 0.67, 'tick'], [2.63, 0.67, 'tick'], [2.93, 0.67, 'tick'], [3.03, 1.39, 'final']] },
  storm: { distance: 6, hits: 4, hitRange: [2, 5], power: 4.63, first: 0.93, last: 3.93, end: 5.05, perMetre: 0, lastPerMetre: 0, timeline: [[0.93, 0.86, 'tick'], [1.16, 0.86, 'tick'], [2.97, 0.86, 'tick'], [3.93, 2.06, 'final']] },
  drill: { distance: 6, hits: 12, hitRange: [12, 12], power: 9.27, first: 0.92, last: 1.76, end: 2.27, perMetre: 0.09, lastPerMetre: 0.09, timeline: [[0.92, 1.23, 'first'], [0.92, 0.61, 'tick'], [1.01, 0.61, 'tick'], [1.1, 0.61, 'tick'], [1.2, 0.61, 'tick'], [1.29, 0.61, 'tick'], [1.38, 0.61, 'tick'], [1.47, 0.61, 'tick'], [1.56, 0.61, 'tick'], [1.65, 0.61, 'tick'], [1.75, 0.61, 'tick'], [1.76, 1.9, 'final']] },
  finale: { distance: 6, hits: 6, hitRange: [6, 6], power: 4.95, first: 0.25, last: 1.52, end: 3.03, perMetre: 0, lastPerMetre: 0, timeline: [[0.25, 0.5, 'first'], [0.48, 0.5, 'tick'], [0.68, 0.5, 'tick'], [0.92, 0.5, 'tick'], [1.13, 0.5, 'tick'], [1.52, 2.45, 'final']] },
  heal: { distance: 6, hits: 1, hitRange: [1, 1], power: 0, first: 0.62, last: 0.62, end: 2.93, perMetre: 0, lastPerMetre: 0, timeline: [[0.62, 0, 'final']] },
  buff: { distance: 6, hits: 0, hitRange: [0, 0], power: 0, first: null, last: null, end: 3.74, perMetre: 0, lastPerMetre: 0, timeline: [] },
  warp: { distance: 6, hits: 0, hitRange: [0, 0], power: 0, first: null, last: null, end: 0.89, perMetre: 0, lastPerMetre: 0, timeline: [] },
  slash: { distance: 2, hits: 1, hitRange: [1, 1], power: 1.08, first: 0.15, last: 0.15, end: 0.75, perMetre: 0, lastPerMetre: 0, timeline: [[0.15, 1.08, 'first']] },
  swipe: { distance: 2, hits: 1, hitRange: [1, 1], power: 1.25, first: 0.16, last: 0.16, end: 0.75, perMetre: 0, lastPerMetre: 0, timeline: [[0.16, 1.25, 'first']] },
  rising: { distance: 2, hits: 1, hitRange: [1, 1], power: 1.18, first: 0.18, last: 0.18, end: 0.73, perMetre: 0, lastPerMetre: 0, timeline: [[0.18, 1.18, 'first']] },
  cleave: { distance: 2, hits: 2, hitRange: [2, 2], power: 3.24, first: 0.4, last: 0.57, end: 1.07, perMetre: 0, lastPerMetre: 0, timeline: [[0.4, 1.22, 'first'], [0.57, 2.03, 'final']] },
  combo: { distance: 2, hits: 3, hitRange: [3, 3], power: 2.22, first: 0.17, last: 0.81, end: 1.32, perMetre: 0, lastPerMetre: 0, timeline: [[0.17, 0.5, 'first'], [0.41, 0.5, 'link'], [0.81, 1.22, 'final']] },
  wave: { distance: 2, hits: 1, hitRange: [1, 1], power: 1.28, first: 0.25, last: 0.25, end: 0.75, perMetre: 0.06, lastPerMetre: 0.06, timeline: [[0.25, 1.28, 'first']] },
  dash: { distance: 2, hits: 2, hitRange: [2, 2], power: 2.25, first: 0.23, last: 0.54, end: 1.04, perMetre: 0.01, lastPerMetre: 0, timeline: [[0.23, 0.5, 'first'], [0.54, 1.75, 'final']] },
  flurry: { distance: 2, hits: 11, hitRange: [11, 11], power: 4.83, first: 0.12, last: 1.45, end: 1.95, perMetre: 0, lastPerMetre: 0, timeline: [[0.12, 0.35, 'first'], [0.22, 0.35, 'tick'], [0.33, 0.35, 'tick'], [0.43, 0.35, 'tick'], [0.54, 0.35, 'tick'], [0.65, 0.35, 'tick'], [0.75, 0.35, 'tick'], [0.86, 0.35, 'tick'], [0.96, 0.35, 'tick'], [1.07, 0.35, 'tick'], [1.45, 1.33, 'final']] },
  thrust: { distance: 2, hits: 1, hitRange: [1, 1], power: 1.07, first: 0.21, last: 0.21, end: 0.72, perMetre: 0, lastPerMetre: 0, timeline: [[0.21, 1.07, 'first']] },
  spin: { distance: 2, hits: 1, hitRange: [1, 1], power: 0.89, first: 0.27, last: 0.27, end: 0.91, perMetre: 0, lastPerMetre: 0, timeline: [[0.27, 0.89, 'first']] },
  cross: { distance: 2, hits: 3, hitRange: [3, 3], power: 2.81, first: 0.14, last: 0.63, end: 1.13, perMetre: 0, lastPerMetre: 0, timeline: [[0.14, 0.5, 'first'], [0.31, 0.5, 'link'], [0.63, 1.81, 'final']] },
  smash: { distance: 2, hits: 3, hitRange: [3, 3], power: 3.11, first: 0.48, last: 0.57, end: 0.98, perMetre: 0, lastPerMetre: 0.07, timeline: [[0.48, 1.91, 'first'], [0.53, 0.6, 'tick'], [0.57, 0.6, 'tick']] },
  iaido: { distance: 2, hits: 2, hitRange: [2, 2], power: 2.88, first: 0.52, last: 0.9, end: 1.4, perMetre: 0, lastPerMetre: 0, timeline: [[0.52, 0.4, 'first'], [0.9, 2.48, 'final']] },
  strike: { distance: 2, hits: 2, hitRange: [2, 2], power: 1.89, first: 0.22, last: 0.39, end: 0.94, perMetre: 0, lastPerMetre: 0, timeline: [[0.22, 0.48, 'first'], [0.39, 1.4, 'final']] },
  rush: { distance: 2, hits: 7, hitRange: [7, 7], power: 3.09, first: 0.2, last: 0.74, end: 1.32, perMetre: 0, lastPerMetre: 0, timeline: [[0.2, 0.3, 'first'], [0.26, 0.3, 'tick'], [0.32, 0.3, 'tick'], [0.38, 0.3, 'tick'], [0.44, 0.3, 'tick'], [0.5, 0.3, 'tick'], [0.74, 1.29, 'final']] },
  uppercut: { distance: 2, hits: 1, hitRange: [1, 1], power: 1.59, first: 0.25, last: 0.25, end: 0.96, perMetre: 0, lastPerMetre: 0, timeline: [[0.25, 1.59, 'final']] },
  kick: { distance: 2, hits: 1, hitRange: [1, 1], power: 1.41, first: 0.26, last: 0.26, end: 0.9, perMetre: 0, lastPerMetre: 0, timeline: [[0.26, 1.41, 'final']] },
  heel: { distance: 2, hits: 1, hitRange: [1, 1], power: 2.24, first: 0.48, last: 0.48, end: 1.13, perMetre: 0, lastPerMetre: 0, timeline: [[0.48, 2.24, 'final']] },
  palm: { distance: 2, hits: 2, hitRange: [2, 2], power: 2.98, first: 0.22, last: 0.32, end: 0.99, perMetre: 0, lastPerMetre: 0, timeline: [[0.22, 0.99, 'first'], [0.32, 1.99, 'final']] },
  tackle: { distance: 2, hits: 1, hitRange: [1, 1], power: 1.92, first: 0.37, last: 0.37, end: 1.02, perMetre: 0, lastPerMetre: 0, timeline: [[0.37, 1.92, 'final']] },
  pound: { distance: 2, hits: 1, hitRange: [1, 1], power: 1.5, first: 0.62, last: 0.62, end: 1.22, perMetre: 0.12, lastPerMetre: 0.12, timeline: [[0.62, 1.5, 'final']] },
};
