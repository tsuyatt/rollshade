import * as THREE from 'three/webgpu';
import { texture, vec2 } from 'three/tsl';

const SIZE = 256;
const PERIOD = 4;

function lattice(seed: number): (x: number, y: number) => [number, number] {
  return (x: number, y: number) => {
    let h = Math.imul(x * 374761393 + y * 668265263 + seed * 2246822519, 3266489917) >>> 0;
    h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
    const a = ((h ^ (h >>> 16)) / 4294967296) * Math.PI * 2;
    return [Math.cos(a), Math.sin(a)];
  };
}

function periodicNoise(seed: number) {
  const grad = lattice(seed);
  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x: number, y: number, period: number) => {
    const x0 = Math.floor(x);
    const y0 = Math.floor(y);
    const fx = x - x0;
    const fy = y - y0;
    const wrap = (i: number) => ((i % period) + period) % period;
    const dot = (ix: number, iy: number, dx: number, dy: number) => {
      const g = grad(wrap(ix), wrap(iy));
      return g[0] * dx + g[1] * dy;
    };
    const n00 = dot(x0, y0, fx, fy);
    const n10 = dot(x0 + 1, y0, fx - 1, fy);
    const n01 = dot(x0, y0 + 1, fx, fy - 1);
    const n11 = dot(x0 + 1, y0 + 1, fx - 1, fy - 1);
    const u = fade(fx);
    const v = fade(fy);
    return (n00 + (n10 - n00) * u + (n01 - n00) * v + (n00 - n10 - n01 + n11) * u * v) * 1.4;
  };
}

function fbm(seed: number, octaves: number) {
  const noise = periodicNoise(seed);
  return (u: number, v: number) => {
    let sum = 0;
    let amp = 1;
    let period = PERIOD;
    for (let o = 0; o < octaves; o++) {
      sum += noise(u * period, v * period, period) * amp;
      amp *= 0.5;
      period *= 2;
    }
    return sum * 0.5 + 0.5;
  };
}

let shared: THREE.DataTexture | null = null;

export function noiseTexture(): THREE.DataTexture {
  if (shared) return shared;
  const a = fbm(11, 4);
  const b = fbm(29, 4);
  const c = fbm(47, 2);
  const data = new Uint8Array(SIZE * SIZE * 4);
  const R = new Float32Array(SIZE * SIZE);
  for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) R[y * SIZE + x] = a(x / SIZE, y / SIZE);
  const dx = Math.round((0.12 / PERIOD) * SIZE);
  const dy = Math.round((0.18 / PERIOD) * SIZE);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * 255)));
  for (let y = 0; y < SIZE; y++)
    for (let x = 0; x < SIZE; x++) {
      const i = y * SIZE + x;
      const r = R[i];
      const shifted = R[((y + dy) % SIZE) * SIZE + ((x + dx) % SIZE)];
      const light = Math.max(0.25, Math.min(1.3, (r - shifted) * 3 + 0.65)) / 1.3;
      data[i * 4] = clamp(r);
      data[i * 4 + 1] = clamp(b(x / SIZE, y / SIZE));
      data[i * 4 + 2] = clamp(light);
      data[i * 4 + 3] = clamp(c(x / SIZE, y / SIZE));
    }
  const tex = new THREE.DataTexture(data, SIZE, SIZE, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.NoColorSpace;
  tex.needsUpdate = true;
  shared = tex;
  return tex;
}

export const NOISE_PERIOD = PERIOD;

export const tnoise = (uv: any): any => texture(noiseTexture(), uv);

export const seedShift = (seed: any): any => vec2(seed.mul(0.1373), seed.mul(0.2917));
