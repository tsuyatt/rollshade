export function fnv1a(input: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function hash32(seed: number, label: string): number {
  return fnv1a(`${seed.toString(36)}:${label}`);
}

export function hashCoords(x: number, y: number, z: number, salt: number): number {
  let h = Math.imul(x | 0, 0x9e3779b1) ^ Math.imul(y | 0, 0x85ebca77) ^ Math.imul(z | 0, 0xc2b2ae3d) ^ salt;
  h = Math.imul(h ^ (h >>> 16), 0x7feb352d);
  h = Math.imul(h ^ (h >>> 15), 0x846ca68b);
  return (h ^ (h >>> 16)) >>> 0;
}

const SEED_RE = /^[0-9a-z]{1,7}$/;

export function seedFromString(text: string): number {
  const s = text.trim().toLowerCase();
  if (SEED_RE.test(s)) {
    const n = parseInt(s, 36);
    if (n <= 0xffffffff) return n >>> 0;
  }
  return fnv1a(s);
}

export function seedToString(seed: number): string {
  return (seed >>> 0).toString(36);
}

export function randomSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  return buf[0];
}
