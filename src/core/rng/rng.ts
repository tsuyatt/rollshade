import { mulberry32 } from './mulberry32';
import { hash32 } from './hash';

export class Rng {
  private readonly next: () => number;

  constructor(readonly seed: number) {
    this.next = mulberry32(seed);
  }

  float(min = 0, max = 1): number {
    return min + (max - min) * this.next();
  }

  int(min: number, max: number): number {
    return Math.floor(this.float(min, max + 1));
  }

  bool(probability = 0.5): boolean {
    return this.next() < probability;
  }

  pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.next() * items.length)];
  }

  sign(): number {
    return this.next() < 0.5 ? -1 : 1;
  }

  fork(label: string): Rng {
    return new Rng(hash32(this.seed, label));
  }
}
