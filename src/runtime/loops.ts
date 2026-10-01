import * as THREE from 'three/webgpu';

type N = any;

export interface LoopContext {
  object?: THREE.Object3D;
  scene: THREE.Scene;
  camera: THREE.Camera;
  renderer: THREE.WebGPURenderer;
  period?: number;
}

export interface LoopInstance {
  object?: THREE.Object3D;
  uniforms: Record<string, N>;
  update(seconds: number): void;
  dispose(): void;
}

export interface LoopDef {
  kind: 'loop';
  id: string;
  period: number;
  object?: boolean;
  bloom?: { strength: number; radius: number; threshold: number };
  create(ctx: LoopContext): LoopInstance;
}

export function defineLoop(def: Omit<LoopDef, 'kind'>): LoopDef {
  return { kind: 'loop', ...def };
}

export interface SpawnOptions {
  at?: THREE.Vector3 | THREE.Object3D;
  object?: THREE.Object3D;
  period?: number;
  scale?: number;
}

export class LoopHandle {
  time = 0;
  playing = true;
  alive = true;

  constructor(
    readonly id: string,
    readonly def: LoopDef,
    readonly instance: LoopInstance,
    private at: THREE.Vector3 | THREE.Object3D | undefined,
    private onStop: (h: LoopHandle) => void,
  ) {
    this.follow();
  }

  get uniforms(): Record<string, N> {
    return this.instance.uniforms;
  }

  get object(): THREE.Object3D | undefined {
    return this.instance.object;
  }

  pause(): void {
    this.playing = false;
  }

  resume(): void {
    this.playing = true;
  }

  moveTo(at: THREE.Vector3 | THREE.Object3D): void {
    this.at = at;
    this.follow();
  }

  follow(): void {
    const o = this.instance.object;
    if (!o || !this.at) return;
    if (this.at instanceof THREE.Object3D) this.at.getWorldPosition(o.position);
    else o.position.copy(this.at);
  }

  step(dt: number): void {
    if (!this.alive) return;
    if (this.playing) this.time += dt;
    if (this.at instanceof THREE.Object3D) this.follow();
    this.instance.update(this.time);
  }

  stop(): void {
    if (!this.alive) return;
    this.alive = false;
    this.instance.dispose();
    this.onStop(this);
  }
}
