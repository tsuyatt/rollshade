import * as THREE from 'three/webgpu';
import { abs, dot, float, mix, normalGeometry, normalView, positionGeometry, positionViewDirection, positionWorld, pow, smoothstep, vec3 } from 'three/tsl';
import { ease, poisson } from './ctx';
import { tnoise } from './noise';
import { claimAnchor, anchors, randomDir, releaseAnchor } from './particles';
import { L, R, tri, type StatusRecipe, type StatusRun } from './status';

type N = any;

const ADDITIVE = { transparent: true, depthWrite: false, blending: THREE.CustomBlending, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor };
const NORMAL = { transparent: true, depthWrite: false };

function shellBase() {
  return {
    p: positionGeometry.mul(L.unit) as N,
    n: normalGeometry as N,
    h: positionWorld.y.sub(L.foot).div(L.height) as N,
    fres: pow(float(1).sub(abs(dot(normalView, positionViewDirection))).max(0), 1.5) as N,
    t: L.time as N,
    core: R.core as N,
    main: R.main as N,
    accent: R.accent as N,
  };
}

function additive(color: N, alpha: N): N {
  const m: N = new THREE.MeshBasicNodeMaterial(ADDITIVE);
  m.colorNode = vec3(0);
  m.emissiveNode = color.mul(alpha);
  m.opacityNode = alpha;
  return m;
}

const up = (a: number, b: number, spread = 0.25) => () => new THREE.Vector3((Math.random() - 0.5) * spread, a + Math.random() * (b - a), (Math.random() - 0.5) * spread);

function point(run: StatusRun, out = new THREE.Vector3(), nrm?: THREE.Vector3): THREE.Vector3 | null {
  return run.layer.surface.sample(out, nrm) ? out : null;
}

function heldLight(run: StatusRun, range: number) {
  if (!run.state.light) run.state.light = run.fx.lights.hold(run.pal.main, range);
  return run.state.light as { set(p: THREE.Vector3, intensity: number): void; release(fade?: number): void };
}

function releaseLight(run: StatusRun): void {
  run.state.light?.release(0.3);
  run.state.light = null;
}

const burn: StatusRecipe = {
  element: 'fire',
  duration: 0.35,
  thickness: 0.025,
  shell() {
    const { p, n, h, fres, t, core, main, accent } = shellBase();
    const a: N = tri(p.mul(vec3(1, 0.55, 1)).sub(vec3(0, t.mul(1.3), 0)), n, 0.8);
    const b: N = tri(p.mul(vec3(1, 0.7, 1)).sub(vec3(0, t.mul(2.1), 0)), n, 2);
    const heat: N = a.r.mul(0.65).add(b.g.mul(0.55)).add(fres.mul(0.25)).sub(h.mul(0.15));
    const fire: N = smoothstep(0.5, 0.82, heat).mul(R.amount);
    const col: N = mix(accent, main, smoothstep(0.55, 0.75, heat)).add(core.mul(pow(fire, 3)));
    return additive(col.mul(1.4), fire);
  },
  apply(run, v) {
    const u = run.layer.u;
    u.char.value = Math.max(u.char.value, v * 0.85);
    (u.ember.value as THREE.Color).copy(run.pal.main);
  },
  tick(run, v, dt) {
    const s = run.ctx.scale;
    const c = run.ctx;
    const B = c.B;
    const at = new THREE.Vector3();
    for (let i = poisson(70 * v * dt); i > 0; i--) {
      if (!point(run, at)) break;
      c.emit('flame', 1, { p: at.clone(), jitter: 0.03 * s, v: up(0.5, 1.1, 0.25), life: [0.25, 0.45], size: [0.06 * s, 0.12 * s], grow: 1.5, gravity: -1.2, drag: 2.5, curl: 1.4, curlScale: 1.8, colors: c.cols('main', 'accent', 'accent'), bright: 0.7 * B, fadeIn: 0.05, fadePow: 1.1 });
    }
    for (let i = poisson(14 * v * dt); i > 0; i--) {
      if (!point(run, at)) break;
      c.emit('spark', 1, { p: at.clone(), v: up(1, 2.4, 1.2), life: [0.5, 1.1], size: [0.008 * s, 0.016 * s], drag: 1.2, curl: 2, curlScale: 2, stretch: 0.03, colors: c.cols('core', 'main'), bright: 2.2 * B, flicker: 0.5 });
    }
    const L = run.layer;
    if (Math.random() < dt * 2.5 * v) c.smoke(new THREE.Vector3(L.center.x, L.foot + L.height * 0.95, L.center.z), 1, { jitter: 0.15 * s, speed: [0.3, 0.6], size: [0.25 * s, 0.4 * s], delay: 0 });
    const flick = 0.75 + 0.25 * Math.sin(L.u.time.value * 23) * Math.sin(L.u.time.value * 7.3);
    heldLight(run, 5).set(L.center, 14 * v * flick);
  },
  end: releaseLight,
};

const freeze: StatusRecipe = {
  element: 'ice',
  duration: 0.9,
  thickness: 0.018,
  shell() {
    const { p, n, h, fres, core, main } = shellBase();
    const nz: N = tri(p, n, 0.35);
    const front: N = R.amount.mul(1.25).sub(0.12);
    const mask: N = float(1).sub(smoothstep(front.sub(0.03), front.add(0.03), h.add(nz.r.sub(0.5).mul(0.18))));
    const facet: N = tri(p, n, 0.9).b;
    const m: N = new THREE.MeshBasicNodeMaterial(NORMAL);
    m.colorNode = mix(main, core, fres.add(facet.mul(0.3)));
    m.opacityNode = mask.mul(fres.mul(0.55).add(0.12)).mul(smoothstep(0, 0.2, L.ice));
    return m;
  },
  apply(run, v) {
    const u = run.layer.u;
    u.ice.value = Math.max(u.ice.value, v);
    (u.iceTint.value as THREE.Color).copy(run.pal.main);
  },
  start(run) {
    run.state.last = 0;
  },
  tick(run, v, dt) {
    const c = run.ctx;
    const s = c.scale;
    const L = run.layer;
    const at = new THREE.Vector3();
    const frontY = L.foot + L.height * (v * 1.25 - 0.12);
    const forming = v < 1 && v > run.state.last;
    run.state.last = v;
    if (forming) {
      for (let i = poisson(80 * dt); i > 0; i--) {
        if (!L.surface.band(at, frontY - 0.12, frontY + 0.05)) break;
        c.emit('shard', 1, { p: at.clone(), v: () => randomDir().multiplyScalar(0.6).add(new THREE.Vector3(0, 0.4, 0)), life: [0.3, 0.6], size: [0.015 * s, 0.035 * s], gravity: 4, drag: 1, spin: [-8, 8], colors: c.cols('core', 'main'), bright: 1.4 * c.B });
        c.emit('mist', 1, { p: at.clone(), jitter: 0.05, v: up(0.05, 0.25, 0.3), life: [0.4, 0.8], size: [0.1 * s, 0.18 * s], grow: 1.6, colors: c.cols('core', 'main'), bright: 0.5 * c.B, fadeIn: 0.1 });
      }
    }
    if (v >= 1 || v < run.state.peak) {
      for (let i = poisson(10 * v * dt); i > 0; i--) {
        if (!point(run, at)) break;
        c.emit('mist', 1, { p: at.clone(), v: up(-0.25, -0.05, 0.1), life: [0.8, 1.4], size: [0.12 * s, 0.22 * s], grow: 1.8, curl: 0.6, colors: c.cols('core', 'main'), bright: 0.35 * c.B, fadeIn: 0.2 });
      }
      if (Math.random() < dt * 5 * v && point(run, at)) c.emit('star', 1, { p: at.clone(), life: [0.2, 0.35], size: [0.04 * s, 0.07 * s], colors: c.cols('core'), bright: 2.2 * c.B, alphaCurve: 'flash' });
    }
    run.state.peak = Math.max(run.state.peak ?? 0, v);
  },
  end(run) {
    const c = run.ctx;
    const at = new THREE.Vector3();
    for (let i = 0; i < 40; i++) {
      if (!point(run, at)) break;
      c.emit('shard', 1, { p: at.clone(), v: () => randomDir().multiplyScalar(1.2).add(new THREE.Vector3(0, 0.8, 0)), life: [0.5, 0.9], size: [0.02, 0.045], gravity: 9, drag: 0.5, spin: [-10, 10], bounce: 0.3, colors: c.cols('core', 'main'), bright: 1.3 * c.B });
    }
  },
};

const shock: StatusRecipe = {
  element: 'thunder',
  duration: 0.15,
  thickness: 0.03,
  shell() {
    const { p, n, fres, t, core, main } = shellBase();
    const jump: N = t.mul(12).floor().mul(0.37);
    const r1: N = tri(p.add(vec3(jump, jump.mul(0.7), 0)), n, 1.1).r;
    const r2: N = tri(p.add(vec3(0, jump.mul(1.3), jump)), n, 2.3).g;
    const line: N = float(1).sub(abs(r1.sub(0.5)).mul(2)).max(float(1).sub(abs(r2.sub(0.5)).mul(2)).mul(0.8));
    const arcs: N = smoothstep(0.9, 0.98, line);
    const flick: N = smoothstep(0.35, 0.6, tnoise(vec3(t.mul(3.1), t.mul(1.7), 0).xy).r);
    const alpha: N = arcs.mul(flick.mul(0.8).add(0.2)).add(fres.mul(0.25).mul(flick)).mul(R.amount);
    return additive(mix(main, core, arcs).mul(2.2), alpha);
  },
  apply(run, v) {
    const u = run.layer.u;
    const f = Math.sin(u.time.value * 37) > 0.2 ? 1 : 0.3;
    (u.rim.value as THREE.Color).add(run.pal.main.clone().multiplyScalar(v * f));
    u.rimAmt.value = Math.max(u.rimAmt.value, 1.6);
  },
  tick(run, v, dt) {
    const c = run.ctx;
    const s = c.scale;
    const L = run.layer;
    const a = new THREE.Vector3();
    const b = new THREE.Vector3();
    if (Math.random() < dt * 7 * v && point(run, a) && point(run, b) && a.distanceTo(b) > 0.25 * L.height) {
      c.bolt(a.clone(), b.clone(), { dur: 0.12, width: 0.035 * s, jag: 0.12, branches: 1, flicker: true });
    }
    if (Math.random() < dt * 2 * v && point(run, a)) {
      const out = a.clone().sub(L.center).setY(0).normalize().multiplyScalar(0.35 + Math.random() * 0.3).add(new THREE.Vector3(0, (Math.random() - 0.3) * 0.3, 0));
      c.bolt(a.clone(), a.clone().add(out), { dur: 0.1, width: 0.025 * s, jag: 0.1, flicker: true });
    }
    for (let i = poisson(30 * v * dt); i > 0; i--) {
      if (!point(run, a)) break;
      c.emit('spark', 1, { p: a.clone(), v: () => randomDir().multiplyScalar(1.5 + Math.random() * 2), life: [0.1, 0.25], size: [0.006 * s, 0.012 * s], gravity: 6, stretch: 0.04, colors: c.cols('core', 'main'), bright: 3 * c.B });
    }
    const on = Math.sin(L.u.time.value * 37) > 0.2 ? 1 : 0.25;
    heldLight(run, 4).set(L.center, 10 * v * on);
  },
  end: releaseLight,
};

const poison: StatusRecipe = {
  element: 'poison',
  duration: 0.6,
  thickness: 0.02,
  shell() {
    const { p, n, h, fres, t, core, main } = shellBase();
    const drift: N = tri(p.add(vec3(0, t.mul(0.25), 0)), n, 0.9);
    const ooze: N = smoothstep(0.55, 0.75, drift.r.add(float(0.4).sub(h).mul(0.25))).mul(0.6).add(fres.mul(0.3));
    return additive(mix(main, core, pow(ooze, 2)).mul(1.3), ooze.mul(R.amount));
  },
  apply(run, v) {
    const u = run.layer.u;
    (u.tint.value as THREE.Color).copy(run.pal.main);
    u.blotch.value = Math.max(u.blotch.value, v);
    u.tintAmt.value = Math.max(u.tintAmt.value, v * (0.22 + 0.08 * Math.sin(u.time.value * 2.4)));
  },
  tick(run, v, dt) {
    const c = run.ctx;
    const s = c.scale;
    const L = run.layer;
    const at = new THREE.Vector3();
    for (let i = poisson(30 * v * dt); i > 0; i--) {
      if (!point(run, at)) break;
      c.emit('bubble', 1, { p: at.clone(), jitter: 0.02, v: up(0.15, 0.45, 0.1), life: [0.35, 0.8], size: [0.025 * s, 0.05 * s], grow: 1.6, colors: c.cols('core', 'main'), bright: 1 * c.B, fadePow: 0.4 });
    }
    for (let i = poisson(5 * v * dt); i > 0; i--) {
      if (!point(run, at)) break;
      c.emit('mote', 1, { p: at.clone(), v: () => new THREE.Vector3(0, -0.2, 0), life: [0.6, 1], size: [0.012 * s, 0.022 * s], gravity: 5, bounce: 0, stretch: 0.03, colors: c.cols('main', 'accent'), bright: 1.2 * c.B });
    }
    if (Math.random() < dt * 6 * v) {
      const g = new THREE.Vector3(L.center.x, L.foot + 0.05, L.center.z);
      c.emit('haze', 1, { p: g, jitter: L.radius * 0.8, v: up(0.05, 0.2, 0.2), life: [1.2, 2], size: [0.4 * s, 0.7 * s], grow: 1.5, colors: c.cols('accent', 'main'), bright: 0.5 * c.B, fadeIn: 0.3 });
    }
    if (Math.random() < dt * 0.7 * v) {
      const head = new THREE.Vector3(L.center.x, L.foot + L.height * 0.9, L.center.z);
      c.emit('glyph', 1, { p: head, jitter: 0.15, v: up(0.3, 0.5, 0.1), life: [1, 1.4], size: [0.12 * s, 0.18 * s], grow: 1.3, colors: c.cols('core', 'main'), bright: 0.9 * c.B, fadeIn: 0.2, variant: 1 });
    }
  },
};

const grey = [new THREE.Color(0.42, 0.39, 0.35), new THREE.Color(0.3, 0.28, 0.25)];

const petrify: StatusRecipe = {
  element: 'earth',
  duration: 1.4,
  apply(run, v) {
    const u = run.layer.u;
    u.stone.value = Math.max(u.stone.value, v);
  },
  start(run) {
    run.state.last = 0;
  },
  tick(run, v, dt) {
    const c = run.ctx;
    const s = c.scale;
    const L = run.layer;
    const at = new THREE.Vector3();
    const frontY = L.foot + L.height * (v * 1.25 - 0.12);
    const moving = Math.abs(v - run.state.last) > 1e-4;
    run.state.last = v;
    if (moving && v < 1) {
      for (let i = poisson(60 * dt); i > 0; i--) {
        if (!L.surface.band(at, frontY - 0.1, frontY + 0.04)) break;
        c.emit('shard', 1, { p: at.clone(), v: () => randomDir().multiplyScalar(0.3).add(new THREE.Vector3(0, 0.2, 0)), life: [0.4, 0.8], size: [0.008 * s, 0.018 * s], gravity: 9, drag: 0.5, spin: [-6, 6], bounce: 0.2, colors: grey, bright: 0.9 });
        if (Math.random() < 0.35) c.emit('smoke', 1, { p: at.clone(), v: up(0.05, 0.2, 0.3), life: [0.6, 1.1], size: [0.08 * s, 0.14 * s], grow: 2, drag: 2, colors: grey, fadeIn: 0.1, fadePow: 1.2 });
      }
    }
    if (v >= 1 && Math.random() < dt * 1.5 && point(run, at)) c.emit('shard', 1, { p: at.clone(), v: () => new THREE.Vector3(0, -0.1, 0), life: [0.6, 1], size: [0.006 * s, 0.012 * s], gravity: 9, bounce: 0.2, colors: grey, bright: 0.8 });
  },
  stopped(run) {
    if (run.value < 0.6) return;
    const c = run.ctx;
    const s = c.scale;
    const L = run.layer;
    const at = new THREE.Vector3();
    for (let i = 0; i < 10; i++) {
      if (!point(run, at)) break;
      c.rocks(at.clone(), 1, 0.6 * s, () => at.clone().sub(L.center).setY(0).normalize().multiplyScalar(0.8 + Math.random()).add(new THREE.Vector3(0, 1 + Math.random() * 1.5, 0)));
    }
    for (let i = 0; i < 50; i++) {
      if (!point(run, at)) break;
      c.emit('shard', 1, { p: at.clone(), v: () => randomDir().multiplyScalar(0.8).add(new THREE.Vector3(0, 0.6, 0)), life: [0.5, 1], size: [0.01 * s, 0.025 * s], gravity: 9, drag: 0.4, spin: [-8, 8], bounce: 0.3, colors: grey, bright: 0.9 });
    }
    c.dust(new THREE.Vector3(L.center.x, L.foot, L.center.z), 0.8 * s);
  },
};

function dissolveTick(run: StatusRun, v: number, dt: number): void {
  const c = run.ctx;
  const s = c.scale;
  const L = run.layer;
  const speed = Math.abs(v - (run.state.last ?? v)) / Math.max(dt, 1e-4);
  run.state.last = v;
  if (speed < 1e-3 || v <= 0.02 || v >= 0.999) return;
  const at = new THREE.Vector3();
  const lo = L.foot + L.height * Math.max(1 - v * 1.35, 0);
  for (let i = poisson(260 * speed * dt); i > 0; i--) {
    if (!L.surface.band(at, lo, lo + L.height * 0.35)) break;
    c.emit('mote', 1, { p: at.clone(), v: up(0.2, 0.7, 0.4), life: [0.5, 1.1], size: [0.012 * s, 0.028 * s], drag: 1.2, curl: 1.4, curlScale: 2, colors: c.cols('core', 'main'), bright: 2.2 * c.B, fadeIn: 0.02 });
    if (Math.random() < 0.3) c.emit('smoke', 1, { p: at.clone(), v: up(0.15, 0.45, 0.3), life: [0.7, 1.2], size: [0.06 * s, 0.12 * s], grow: 2, drag: 1.5, curl: 1, colors: [new THREE.Color(0.08, 0.07, 0.07)], fadeIn: 0.05 });
  }
  heldLight(run, 4).set(L.center, 8 * Math.min(speed, 1.5) * (1 - v));
}

const dissolve: StatusRecipe = {
  element: 'fire',
  duration: 1.6,
  apply(run, v) {
    const u = run.layer.u;
    u.gone.value = Math.max(u.gone.value, v);
    (u.edge.value as THREE.Color).copy(run.pal.main).lerp(run.pal.core, 0.3);
  },
  tick: dissolveTick,
  end: releaseLight,
};

const appear: StatusRecipe = {
  element: 'arcane',
  duration: 1.4,
  initial: 1,
  goal: 0,
  autoEnd: true,
  apply(run, v) {
    const u = run.layer.u;
    u.gone.value = Math.max(u.gone.value, v);
    (u.edge.value as THREE.Color).copy(run.pal.main).lerp(run.pal.core, 0.3);
  },
  tick: dissolveTick,
  end: releaseLight,
};

function anchorFor(run: StatusRun, at: THREE.Vector3): number {
  if (run.state.anchor === undefined) run.state.anchor = claimAnchor(at);
  anchors[run.state.anchor].copy(at);
  return run.state.anchor;
}

function freeAnchor(run: StatusRun): void {
  const id = run.state.anchor;
  if (id === undefined) return;
  run.state.anchor = undefined;
  run.fx.scheduler.after(2.5, () => releaseAnchor(id));
}

const bless: StatusRecipe = {
  element: 'light',
  duration: 0.5,
  thickness: 0.03,
  shell() {
    const { p, n, h, fres, t, core, main } = shellBase();
    const rays: N = tri(p.mul(vec3(1, 0.25, 1)).sub(vec3(0, t.mul(0.7), 0)), n, 1.4);
    const glow: N = smoothstep(0.55, 0.8, rays.r).mul(fres.mul(0.7).add(0.3)).add(fres.mul(0.35)).mul(smoothstep(1.1, 0.4, h));
    return additive(mix(main, core, glow).mul(1.3), glow.mul(R.amount));
  },
  apply(run, v) {
    const u = run.layer.u;
    (u.rim.value as THREE.Color).add(run.pal.main.clone().multiplyScalar(v));
    u.rimAmt.value = Math.max(u.rimAmt.value, 1.3);
  },
  tick(run, v, dt) {
    const c = run.ctx;
    const s = c.scale;
    const L = run.layer;
    const id = anchorFor(run, new THREE.Vector3(L.center.x, L.foot, L.center.z));
    const R = Math.max(L.radius, 0.25);
    c.emit('mote', poisson(30 * v * dt), { p: () => new THREE.Vector3(L.center.x, L.foot + 0.05, L.center.z).add(randomDir().setY(0).normalize().multiplyScalar(R * 1.2)), orbit: { w: 1.4, rise: 0.9, r0: R * 1.2, r1: R * 0.6, h: L.height * 1.1, pull: 2, anchor: id }, life: [1.2, 1.8], size: [0.015 * s, 0.03 * s], colors: c.cols('core', 'main'), bright: 2.2 * c.B, fadeIn: 0.2, alphaCurve: 'bell' });
    if (Math.random() < dt * 1.5 * v && point(run, run.state.at ?? (run.state.at = new THREE.Vector3()))) c.emit('glyph', 1, { p: (run.state.at as THREE.Vector3).clone(), v: up(0.4, 0.7, 0.1), life: [0.9, 1.3], size: [0.1 * s, 0.15 * s], colors: c.cols('core', 'main'), bright: 1.4 * c.B, fadeIn: 0.2, variant: 2 });
    if (Math.random() < dt * 4 * v && point(run, run.state.at ?? (run.state.at = new THREE.Vector3()))) c.emit('star', 1, { p: (run.state.at as THREE.Vector3).clone(), life: [0.2, 0.4], size: [0.05 * s, 0.09 * s], colors: c.cols('core'), bright: 2 * c.B, alphaCurve: 'flash' });
    heldLight(run, 4).set(L.center, 5 * v * (0.85 + 0.15 * Math.sin(L.u.time.value * 3)));
  },
  end(run) {
    releaseLight(run);
    freeAnchor(run);
  },
};

const curse: StatusRecipe = {
  element: 'dark',
  duration: 0.6,
  thickness: 0.035,
  shell() {
    const { p, n, h, fres, t } = shellBase();
    const w: N = tri(p.mul(vec3(1, 0.6, 1)).sub(vec3(0, t.mul(0.45), 0)), n, 1.1);
    const wisps: N = smoothstep(0.42, 0.7, w.r.add(fres.mul(0.35)).add(h.mul(0.12)));
    const m: N = new THREE.MeshBasicNodeMaterial(NORMAL);
    m.colorNode = R.shade;
    m.opacityNode = wisps.mul(0.92).mul(R.amount);
    return m;
  },
  apply(run, v) {
    const u = run.layer.u;
    const pulse = 0.5 + 0.5 * Math.sin(u.time.value * 3.2);
    (u.tint.value as THREE.Color).copy(run.pal.accent);
    u.tintAmt.value = Math.max(u.tintAmt.value, v * (0.6 + 0.15 * pulse));
    (u.rim.value as THREE.Color).add(run.pal.main.clone().multiplyScalar(v * (0.6 + 0.8 * pulse)));
    u.rimAmt.value = Math.max(u.rimAmt.value, 2);
  },
  tick(run, v, dt) {
    const c = run.ctx;
    const s = c.scale;
    const L = run.layer;
    const at = new THREE.Vector3();
    const dark = run.pal.smoke ?? run.pal.accent;
    for (let i = poisson(34 * v * dt); i > 0; i--) {
      if (!point(run, at)) break;
      c.emit('smoke', 1, { p: at.clone(), v: up(0.25, 0.6, 0.2), life: [0.8, 1.4], size: [0.16 * s, 0.3 * s], grow: 1.8, drag: 1.5, curl: 1.2, colors: [dark.clone(), dark.clone().lerp(run.pal.accent, 0.4)], fadeIn: 0.15 });
    }
    const id = anchorFor(run, L.center);
    const R = Math.max(L.radius, 0.25);
    c.emit('mote', poisson(18 * v * dt), { p: () => L.center.clone().add(randomDir().multiplyScalar(R * 2.2)), orbit: { w: -2, rise: -0.3, r0: R * 2, r1: R * 0.3, h: L.height * 0.6, pull: 1.5, anchor: id }, life: [0.9, 1.4], size: [0.015 * s, 0.028 * s], colors: c.cols('core', 'main'), bright: 1.8 * c.B, fadeIn: 0.2, alphaCurve: 'bell' });
    if (Math.random() < dt * 5 * v) c.emit('haze', 1, { p: new THREE.Vector3(L.center.x, L.foot + 0.05, L.center.z), jitter: R, v: up(0.02, 0.12, 0.2), life: [1.2, 2], size: [0.5 * s, 0.8 * s], grow: 1.4, colors: [dark.clone(), dark.clone().lerp(run.pal.accent, 0.5)], bright: 0.8, fadeIn: 0.3 });
    if (Math.random() < dt * 0.8 * v) c.emit('glyph', 1, { p: new THREE.Vector3(L.center.x, L.foot + L.height * 0.8, L.center.z), jitter: R, v: up(0.2, 0.4, 0.1), life: [1, 1.5], size: [0.12 * s, 0.18 * s], colors: c.cols('main', 'accent'), bright: 1.2 * c.B, fadeIn: 0.25, variant: 0 });
  },
  end: freeAnchor,
};

const shield: StatusRecipe = {
  element: 'water',
  duration: 0.3,
  start(run) {
    const prim = run.fx.prims.acquire('shield');
    prim.u.core.value.copy(run.pal.core);
    prim.u.main.value.copy(run.pal.main);
    prim.u.accent.value.copy(run.pal.accent);
    prim.u.bright.value = 1.6 * run.ctx.B;
    (prim.u.hitData as THREE.Vector4[]).forEach((h) => h.set(0, 1, 0, 9));
    run.state.prim = prim;
    run.state.age = 0;
    run.state.slot = 0;
  },
  apply(run, v) {
    const u = run.layer.u;
    (u.rim.value as THREE.Color).add(run.pal.main.clone().multiplyScalar(v * 0.3));
    u.rimAmt.value = Math.max(u.rimAmt.value, 0.8);
  },
  tick(run, v, dt) {
    const prim = run.state.prim;
    if (!prim) return;
    const L = run.layer;
    run.state.age += dt;
    const age = run.state.age;
    const rx = Math.max(L.radius * 1.35, L.height * 0.42) * run.ctx.scale;
    const ry = L.height * 0.62 * run.ctx.scale;
    const pop = ease.outBack(Math.min(age / 0.3, 1));
    prim.mesh.position.copy(L.center);
    prim.mesh.scale.set(rx * (0.85 + 0.15 * pop), ry * (0.85 + 0.15 * pop), rx * (0.85 + 0.15 * pop));
    prim.u.reveal.value = Math.min(age / 0.35, 1);
    prim.u.time.value = age;
    prim.u.fade.value = v;
    for (const h of prim.u.hitData as THREE.Vector4[]) h.w += dt;
  },
  impact(run, point) {
    const prim = run.state.prim;
    if (!prim) return;
    const L = run.layer;
    const c = run.ctx;
    const dir = point.clone().sub(L.center).normalize();
    (prim.u.hitData as THREE.Vector4[])[run.state.slot].set(dir.x, dir.y, dir.z, 0);
    run.state.slot = (run.state.slot + 1) % (prim.u.hitData as THREE.Vector4[]).length;
    const at = L.center.clone().add(dir.clone().multiply(prim.mesh.scale));
    c.emit('spark', 24, { p: at, v: () => dir.clone().add(randomDir().multiplyScalar(0.8)).multiplyScalar(3.5), life: [0.15, 0.3], size: [0.01, 0.02], drag: 3, stretch: 0.03, colors: c.cols('core', 'main'), bright: 3 * c.B, fadeIn: 0 });
    c.star(at, 0.5 * c.scale, 0.12, 2.5);
  },
  stopped(run) {
    const prim = run.state.prim;
    if (!prim) return;
    const c = run.ctx;
    const L = run.layer;
    const r = prim.mesh.scale.x;
    c.emit('shard', 70, { p: () => L.center.clone().add(randomDir().multiply(prim.mesh.scale)), v: () => randomDir().multiplyScalar(2 + Math.random() * 2), life: [0.4, 0.7], size: [0.03, 0.06], gravity: 6, drag: 1.5, stretch: 0.02, colors: c.cols('core', 'main'), bright: 2 * c.B, fadeIn: 0 });
    c.ring(L.center, r * 1.3, { normal: 'camera', dur: 0.35, thick: 0.06 });
  },
  end(run) {
    const prim = run.state.prim;
    if (prim) run.fx.prims.release(prim);
    run.state.prim = null;
  },
};

const stun: StatusRecipe = {
  element: 'light',
  duration: 0.2,
  tick(run, v, dt) {
    const c = run.ctx;
    const s = c.scale;
    const L = run.layer;
    const head = new THREE.Vector3(L.center.x, L.foot + L.height + 0.12 * s, L.center.z);
    const id = anchorFor(run, head);
    const R = 0.3 * s;
    run.state.acc = (run.state.acc ?? 0) + dt * v * 6;
    while (run.state.acc >= 1) {
      run.state.acc -= 1;
      run.state.turn = ((run.state.turn ?? 0) + 2.4) % (Math.PI * 2);
      const a = run.state.turn as number;
      const p = head.clone().add(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R));
      c.emit('star', 1, { p, orbit: { w: 5, rise: 0, r0: R, r1: R, h: 1, pull: 4, anchor: id }, life: [0.9, 1], size: [0.09 * s, 0.12 * s], colors: c.cols('core', 'main'), bright: 2.4 * c.B, fadeIn: 0.1, alphaCurve: 'bell' });
      c.emit('mote', 3, { p, jitter: 0.02, orbit: { w: 5, rise: 0, r0: R, r1: R, h: 1, pull: 4, anchor: id }, life: [0.3, 0.5], size: [0.012 * s, 0.02 * s], colors: c.cols('main'), bright: 1.6 * c.B, delay: [0.02, 0.15] });
    }
  },
  apply() {},
  end: freeAnchor,
};

export const STATUSES: Record<string, StatusRecipe> = { burn, freeze, shock, poison, petrify, dissolve, appear, bless, curse, shield, stun };
