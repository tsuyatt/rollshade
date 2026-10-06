import { uniform } from 'three/tsl';

export interface LookSettings {
  core: number;
  hot: number;
  limit: number;
  smoke: number;
  particles: number;
}

export const LOOK: Readonly<LookSettings> = { core: 0.1, hot: 0.2, limit: 1.5, smoke: 0.2, particles: 0.25 };

export const coreWhite = { value: LOOK.core };

export const smokeAmount = { value: LOOK.smoke };

export const particleAmount = { value: LOOK.particles };

export const hotWhite = uniform(LOOK.hot);
