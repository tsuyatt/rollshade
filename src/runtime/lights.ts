import * as THREE from 'three/webgpu';

interface Slot {
  light: THREE.PointLight;
  until: number;
  start: number;
  peak: number;
  held: boolean;
}

export interface HeldLight {
  set(pos: THREE.Vector3, intensity?: number, color?: THREE.Color): void;
  release(fade?: number): void;
}

export class LightPool {
  private slots: Slot[] = [];
  private time = 0;
  mute: () => boolean = () => false;

  constructor(root: THREE.Object3D, size = 6, public scale = 1) {
    for (let i = 0; i < size; i++) {
      const light = new THREE.PointLight(0xffffff, 0, 8, 2);
      root.add(light);
      this.slots.push({ light, until: 0, start: 0, peak: 0, held: false });
    }
  }

  private take(): Slot | undefined {
    const free = this.slots.find((s) => !s.held && s.until <= this.time);
    if (free) return free;
    return this.slots.filter((s) => !s.held).sort((a, b) => a.until - b.until)[0];
  }

  flash(pos: THREE.Vector3, color: THREE.Color, intensity: number, dur: number, range = 8): void {
    if (this.mute()) return;
    const s = this.take();
    if (!s) return;
    s.light.position.copy(pos);
    s.light.color.copy(color);
    s.light.distance = range;
    s.start = this.time;
    s.until = this.time + dur;
    s.peak = intensity * this.scale;
  }

  tryHold(color: THREE.Color, range = 6): HeldLight | null {
    return this.slots.some((s) => !s.held) ? this.hold(color, range) : null;
  }

  hold(color: THREE.Color, range = 6): HeldLight {
    const s = this.take();
    if (!s) return { set: () => {}, release: () => {} };
    s.held = true;
    s.light.color.copy(color);
    s.light.distance = range;
    s.light.intensity = 0;
    const gain = this.mute() ? 0 : this.scale;
    return {
      set: (pos, intensity, col) => {
        s.light.position.copy(pos);
        if (intensity !== undefined) s.light.intensity = intensity * gain * (0.9 + Math.random() * 0.2);
        if (col) s.light.color.copy(col);
      },
      release: (fade = 0.2) => {
        if (!s.held) return;
        s.held = false;
        s.start = this.time;
        s.until = this.time + fade;
        s.peak = s.light.intensity;
      },
    };
  }

  update(dt: number): void {
    this.time += dt;
    for (const s of this.slots) {
      if (s.held) continue;
      if (s.until <= this.time) {
        s.light.intensity = 0;
        continue;
      }
      const k = (this.time - s.start) / (s.until - s.start);
      s.light.intensity = s.peak * (1 - k) * (1 - k) * (0.85 + Math.random() * 0.3);
    }
  }

  clear(): void {
    for (const s of this.slots) {
      s.held = false;
      s.until = 0;
      s.light.intensity = 0;
    }
  }
}
