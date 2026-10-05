import * as THREE from 'three/webgpu';
import { Fn, If, clamp, dot, emissive, exp, float, length, max, mix, mrt, normalize, output, pass, select, smoothstep, uniform, uniformArray, uv, vec2, vec3, vec4 } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

type N = any;

const WAVES = 8;

export type BloomScope = 'fx' | 'scene';

export interface PostOptions {
  strength?: number;
  radius?: number;
  threshold?: number;
  bloom?: BloomScope;
}

export const glowing = new WeakSet<THREE.Object3D>();

const glowFlag: N = uniform(0).onObjectUpdate(({ object }) => {
  if (!object) return 0;
  for (let o: THREE.Object3D | null = object; o; o = o.parent) if (glowing.has(o)) return 1;
  return object.userData.rollshadeStatus ? 2 : 0;
});

const glow: N = vec4(select(glowFlag.equal(1), output.rgb, select(glowFlag.equal(2), emissive, vec3(0))), output.a);

function scenePassOf(scene: THREE.Scene, camera: THREE.Camera, outputs: Record<string, N>): N {
  const p: N = pass(scene, camera);
  if (Object.keys(outputs).length === 1) return p;
  const targets: N = mrt(outputs);
  if (outputs.glow) targets.setBlendMode('glow', new THREE.BlendMode(THREE.MaterialBlending));
  p.setMRT(targets);
  return p;
}

interface Wave {
  pos: THREE.Vector3;
  radius: number;
  dur: number;
  age: number;
  strength: number;
}

export class FXPost {
  private readonly pipeline: THREE.RenderPipeline;
  private readonly loopPipeline: THREE.RenderPipeline;
  readonly bloom: N;
  private readonly loopSceneBloom: N;
  private readonly loopBloom: N;
  private waves: Wave[] = [];
  private waveData = Array.from({ length: WAVES }, () => new THREE.Vector4());
  private waveU: N;
  private aspect = uniform(1);
  private zoomCenter = uniform(new THREE.Vector2(0.5, 0.5));
  private zoomAmount = uniform(0);
  private chroma = uniform(0);
  private frameMode = uniform(0);
  private flashAmount = uniform(0);
  private flashColor = uniform(new THREE.Color(1, 1, 1));
  private time = uniform(0);
  private vignette = uniform(0.55);
  readonly scope: BloomScope;
  loopBloomUsed = false;
  clean = false;
  zoom = 0;
  aberration = 0;
  flash = 0;
  blinkT = 0;
  blinkAmount = 0;
  impactFrames = 0;
  private scenePass: N;
  private loopScenePass: N;

  constructor(
    private renderer: THREE.WebGPURenderer,
    scene: THREE.Scene,
    private camera: THREE.Camera,
    opts: PostOptions = {},
  ) {
    this.waveU = uniformArray(this.waveData, 'vec4');
    this.scope = opts.bloom ?? 'fx';
    const fx = this.scope === 'fx' ? { glow } : {};
    this.scenePass = scenePassOf(scene, camera, { output, ...fx });
    this.loopScenePass = scenePassOf(scene, camera, { output, emissive, ...fx });
    const plain = this.chain(this.scenePass, opts);
    const looped = this.chain(this.loopScenePass, opts);
    this.bloom = plain.bloom;
    this.loopSceneBloom = looped.bloom;
    for (const k of ['strength', 'radius', 'threshold', 'smoothWidth']) looped.bloom[k] = plain.bloom[k];
    this.loopBloom = bloom(this.loopScenePass.getTextureNode('emissive'), 0, 0.5, 0);
    this.pipeline = new THREE.RenderPipeline(renderer);
    this.pipeline.outputNode = this.finish(plain.compressed.rgb.add(plain.bloom.rgb));
    this.loopPipeline = new THREE.RenderPipeline(renderer);
    this.loopPipeline.outputNode = this.finish(looped.compressed.rgb.add(looped.bloom.rgb).add(this.loopBloom.rgb));
  }

  private chain(scenePass: N, opts: PostOptions): { compressed: N; bloom: N } {
    const warped = Fn(() => {
      const p: N = uv().toVar();
      const offset: N = vec2(0).toVar();
      for (let i = 0; i < WAVES; i++) {
        const w: N = this.waveU.element(i);
        const dv: N = p.sub(w.xy).mul(vec2(this.aspect, 1));
        const d: N = length(dv);
        const x: N = d.sub(w.z).div(max(w.z.mul(0.35), 0.01));
        offset.addAssign(normalize(dv.add(1e-5)).mul(exp(x.mul(x).negate())).mul(w.w).div(vec2(this.aspect, 1)));
      }
      return p.sub(offset);
    })();
    const look = (tex: N, chroma: N) =>
      Fn(() => {
        const acc: N = vec3(0).toVar();
        If(this.zoomAmount.greaterThan(0), () => {
          const dir: N = warped.sub(this.zoomCenter);
          for (let i = 0; i < 8; i++) {
            const s: N = warped.sub(dir.mul(this.zoomAmount.mul(i / 7)));
            const ca: N = s.sub(0.5).mul(chroma);
            acc.addAssign(vec3(tex.sample(s.add(ca)).r, tex.sample(s).g, tex.sample(s.sub(ca)).b));
          }
          acc.divAssign(8);
        }).Else(() => {
          const ca: N = warped.sub(0.5).mul(chroma);
          acc.assign(vec3(tex.sample(warped.add(ca)).r, tex.sample(warped).g, tex.sample(warped.sub(ca)).b));
        });
        return acc;
      })();
    const compress = (zoomed: N) =>
      Fn(() => {
        const c: N = zoomed.toVar();
        const l: N = max(max(c.r, c.g), c.b);
        const knee = 1.6;
        const e: N = max(l.sub(knee), 0);
        const target: N = float(knee).add(e.div(e.div(knee).add(1)));
        return vec4(c.mul(select(l.greaterThan(knee), target.div(max(l, 1e-4)), float(1))), 1);
      })();
    const compressed = compress(look(scenePass.getTextureNode('output'), this.chroma));
    const source = this.scope === 'fx' ? compress(look(scenePass.getTextureNode('glow'), this.chroma)) : compressed;
    return { compressed, bloom: bloom(source, opts.strength ?? 0.8, opts.radius ?? 0.25, opts.threshold ?? 0.45) };
  }

  private finish(sum: N): N {
    return Fn(() => {
      const c: N = sum.toVar();
      c.addAssign(this.flashColor.mul(this.flashAmount));
      const lum: N = dot(c, vec3(0.299, 0.587, 0.114));
      const neg: N = vec3(1).sub(clamp(c, 0, 1)).mul(1.4);
      const mono: N = vec3(smoothstep(0.25, 0.4, lum)).mul(2.2);
      c.assign(mix(c, neg, this.frameMode.equal(1).select(1, 0)));
      c.assign(mix(c, mono, this.frameMode.equal(2).select(1, 0)));
      const q: N = uv().sub(0.5);
      c.mulAssign(float(1).sub(dot(q, q).mul(this.vignette)));
      return vec4(c, 1);
    })();
  }

  setLoopBloom(b: { strength: number; radius: number; threshold: number } | null): void {
    this.loopBloom.strength.value = b ? b.strength : 0;
    if (b) {
      this.loopBloom.radius.value = b.radius;
      this.loopBloom.threshold.value = b.threshold;
    }
  }

  setSamples(samples: number): void {
    for (const p of [this.scenePass, this.loopScenePass]) {
      if (p.options.samples === samples) continue;
      p.options.samples = samples;
      p.renderTarget.samples = samples;
      p.renderTarget.dispose();
    }
  }

  setScale(scale: number): void {
    this.scenePass.setResolutionScale(scale);
    this.loopScenePass.setResolutionScale(scale);
  }

  flashTint(c: THREE.Color): void {
    this.flashColor.value.copy(c);
  }

  wave(pos: THREE.Vector3, radius: number, dur: number, strength: number): void {
    if (this.waves.length >= WAVES) this.waves.shift();
    this.waves.push({ pos: pos.clone(), radius, dur, age: 0, strength });
  }

  zoomAt(pos: THREE.Vector3, amount: number): void {
    const s = pos.clone().project(this.camera);
    this.zoomCenter.value.set(s.x * 0.5 + 0.5, 0.5 - s.y * 0.5);
    this.zoom = Math.max(this.zoom, amount);
  }

  update(dt: number, realDt: number): void {
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    this.aspect.value = size.x / Math.max(size.y, 1);
    this.time.value = (this.time.value + realDt) % 100;
    const cam = this.camera as THREE.PerspectiveCamera;
    const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
    for (const w of this.waves) w.age += dt;
    this.waves = this.waves.filter((w) => w.age < w.dur);
    for (let i = 0; i < WAVES; i++) {
      const w = this.waves[i];
      const v = this.waveData[i];
      if (!w) {
        v.set(0, 0, 0.5, 0);
        continue;
      }
      const k = w.age / w.dur;
      const r = w.radius * (1 - Math.pow(1 - k, 3));
      const c = w.pos.clone().project(cam);
      const edge = w.pos.clone().addScaledVector(right, Math.max(r, 1e-3)).project(cam);
      const rs = Math.abs(edge.x - c.x) * 0.5 * this.aspect.value;
      v.set(c.x * 0.5 + 0.5, 0.5 - c.y * 0.5, Math.max(rs, 1e-3), c.z < 1 ? w.strength * 0.02 * Math.pow(1 - k, 2) : 0);
    }
    this.zoomAmount.value = this.clean ? 0 : this.zoom * 0.18;
    this.chroma.value = this.clean ? 0 : 0.002 + this.aberration * 0.012;
    this.flashAmount.value = this.clean ? 0 : Math.max(Math.min(this.flash, 0.35), this.blinkT > 0 ? this.blinkAmount : 0);
    this.frameMode.value = this.clean ? 0 : this.impactFrames > 0.06 ? 1 : this.impactFrames > 0 ? 2 : 0;
    this.vignette.value = this.clean ? 0 : 0.55;
    if (this.clean) for (const v of this.waveData) v.w = 0;
    const decay = Math.exp(-realDt * 10);
    this.zoom *= decay;
    this.aberration *= decay;
    this.flash *= Math.exp(-realDt * 14);
    this.impactFrames = Math.max(this.impactFrames - realDt, 0);
    this.blinkT = Math.max(this.blinkT - realDt, 0);
  }

  render(): void {
    (this.loopBloomUsed ? this.loopPipeline : this.pipeline).render();
  }

  warm(): void {
    const r = this.renderer;
    const { toneMapping, outputColorSpace } = r;
    r.toneMapping = THREE.NoToneMapping;
    r.outputColorSpace = THREE.ColorManagement.workingColorSpace;
    try {
      (this.loopBloomUsed ? this.loopScenePass : this.scenePass).updateBefore({ renderer: r });
    } finally {
      r.toneMapping = toneMapping;
      r.outputColorSpace = outputColorSpace;
    }
  }

  setCamera(camera: THREE.Camera): void {
    this.camera = camera;
    this.scenePass.camera = camera;
    this.loopScenePass.camera = camera;
  }

  dispose(): void {
    this.bloom.dispose?.();
    this.loopSceneBloom.dispose?.();
    this.loopBloom.dispose?.();
    this.scenePass.dispose();
    this.loopScenePass.dispose();
    this.pipeline.dispose();
    this.loopPipeline.dispose();
  }
}
