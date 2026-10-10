import * as THREE from 'three/webgpu';
import { ease, poisson, span, type Ctx } from '../ctx';
import { randomDir } from '../particles';
import type { Prim } from '../prims';

const UP = new THREE.Vector3(0, 1, 0);

type P = Record<string, number>;

function aimOf(ctx: Ctx): THREE.Vector3 {
  const d = ctx.to().sub(ctx.from());
  return d.lengthSq() > 1e-6 ? d.normalize() : new THREE.Vector3(0, 0, -1);
}

function paint(ctx: Ctx, prim: Prim, bright: number): void {
  prim.u.core.value.copy(ctx.pal.core);
  prim.u.main.value.copy(ctx.pal.main);
  prim.u.accent.value.copy(ctx.pal.accent);
  prim.u.bright.value = bright * ctx.B;
}

const basis = new THREE.Matrix4();

function orient(q: THREE.Quaternion, z: THREE.Vector3, up = UP): THREE.Quaternion {
  const x = up.clone().cross(z);
  if (x.lengthSq() < 1e-6) x.set(1, 0, 0);
  x.normalize();
  const y = z.clone().cross(x).normalize();
  return q.setFromRotationMatrix(basis.makeBasis(x, y, z));
}

function shatter(ctx: Ctx, center: THREE.Vector3, q: THREE.Quaternion, dims: THREE.Vector3, color: THREE.Color, o: { speed?: number; most?: number; glints?: number } = {}): void {
  const [a, b] = [dims.x, dims.y, dims.z].sort((x, y) => y - x);
  const pieces = Math.min(o.most ?? 36, Math.max(2, Math.round(a * b * 40)));
  const piece = Math.sqrt((a * b) / pieces) * 1.25;
  const speed = o.speed ?? 2.5;
  for (let i = 0; i < pieces; i++) {
    const local = new THREE.Vector3((Math.random() - 0.5) * dims.x, (Math.random() - 0.5) * dims.y, (Math.random() - 0.5) * dims.z).applyQuaternion(q);
    const out = (local.lengthSq() > 1e-6 ? local.clone().normalize() : randomDir()).add(randomDir().multiplyScalar(0.7)).normalize();
    const turn = new THREE.Quaternion().setFromAxisAngle(randomDir(), Math.random() * Math.PI);
    ctx.fx.crystals.spawn({
      p: center.clone().add(local),
      v: out.multiplyScalar(speed * (0.5 + Math.random())).add(new THREE.Vector3(0, Math.random() * 1.5, 0)),
      size: new THREE.Vector3(piece * (0.5 + Math.random() * 0.6), piece * (0.7 + Math.random() * 0.8), Math.max(piece * 0.12, 0.012)),
      quat: q.clone().multiply(turn),
      spin: 6 + Math.random() * 12,
      life: 0.55 + Math.random() * 0.5,
      gravity: 9,
      bounce: 0.25,
      shrink: 0.3,
      color: color.clone().offsetHSL(0, 0, (Math.random() - 0.5) * 0.12),
    });
  }
  ctx.emit('shard', pieces * (o.glints ?? 1.5), { p: () => center.clone().add(new THREE.Vector3((Math.random() - 0.5) * dims.x, (Math.random() - 0.5) * dims.y, (Math.random() - 0.5) * dims.z).applyQuaternion(q)), v: () => randomDir().multiplyScalar(speed * (0.6 + Math.random())), life: [0.25, 0.5], size: [0.02, 0.045], gravity: 6, drag: 1.5, stretch: 0.02, colors: ctx.cols('core', 'main'), bright: 2.4 * ctx.B, fadeIn: 0 });
}

export function bind(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  ctx.part('cast');
  ctx.charge(ctx.from(), p.charge, { radius: 0.5, aim: aimOf(ctx), ground: ctx.from() });
  ctx.part('mark');
  ctx.circle(ctx.ground(ctx.to()), 1.4 * s, p.charge + p.fly + p.keep + 0.6, { slot: 'target', spin: 0.6, bright: 1.2 });
  const n = Math.max(1, Math.round(p.count));
  const a0 = Math.random() * Math.PI * 2;
  const len = p.len * s;
  const pierce = 0.22 * s;
  const mid = () => ctx.to().addScaledVector(aimOf(ctx).setY(0).normalize(), p.depth * s);
  ctx.after(p.charge, () => {
    ctx.handle.emit('release');
    ctx.part('main');
    const light = ctx.hold(6);
    let landed = 0;
    const back = aimOf(ctx).negate().setY(0);
    if (back.lengthSq() < 1e-6) back.set(0, 0, 1);
    back.normalize();
    const normal = UP.clone().multiplyScalar(Math.cos(p.tilt)).addScaledVector(back, Math.sin(p.tilt));
    const e1 = UP.clone().cross(back).normalize();
    const e2 = normal.clone().cross(e1).normalize();
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2 + (Math.random() - 0.5) * 0.2;
      const dir = e1.clone().multiplyScalar(-Math.cos(a)).addScaledVector(e2, -Math.sin(a));
      const delay = i * p.stagger;
      const prim = ctx.fx.prims.acquire('plate');
      paint(ctx, prim, 2.2);
      prim.u.size.value.set(p.width * s, p.thick * s, len);
      const rest = () => mid().addScaledVector(dir, -0.05 * s - len / 2);
      const start = () => rest().addScaledVector(dir, -p.reach * s);
      const total = delay + 0.12 + p.fly + (n - 1 - i) * p.stagger + p.keep + 0.35;
      let hit = false;
      ctx.live(prim, total, (_k, age) => {
        const t = age - delay;
        const appear = span(t, 0, 0.12);
        const k = ease.inQuad(span(t, 0.12, 0.12 + p.fly));
        const pos = start().lerp(rest(), k);
        if (hit) pos.addScaledVector(dir, Math.sin(Math.min(t - 0.12 - p.fly, 0.25) * 40) * 0.03 * s * Math.max(0, 1 - (t - 0.12 - p.fly) * 4));
        orient(prim.mesh.quaternion, dir, normal);
        const crack = span(age, total - 0.3, total);
        if (crack > 0) pos.add(randomDir().multiplyScalar(0.012 * s * crack));
        prim.mesh.position.copy(pos);
        prim.mesh.scale.set(p.width * s, p.thick * s * ease.outBack(appear), len * (0.4 + 0.6 * ease.outCubic(appear)));
        prim.mesh.visible = t > 0 && !ctx.hidden && _k < 1;
        prim.u.time.value = age;
        prim.u.heat.value = (hit ? Math.max(0, 0.9 - (t - 0.12 - p.fly) * 3) + 0.1 * Math.sin(age * 9 + i) : 0.2 * (1 - k)) + crack * crack * (Math.sin(age * 70 + i) > 0 ? 1.4 : 0.5);
        prim.u.fade.value = appear;
        if (_k >= 1 && !ctx.hidden) shatter(ctx, pos, prim.mesh.quaternion, new THREE.Vector3(p.width * s, p.thick * s, len), ctx.pal.main.clone().lerp(ctx.pal.core, 0.4), { speed: 2.2 });
        if (!hit && k > 0 && k < 1 && !ctx.hidden) {
          const tail = pos.clone().addScaledVector(dir, -len * 0.5);
          ctx.emit('spark', 2, { p: tail, jitter: 0.04 * s, v: () => dir.clone().multiplyScalar(-2).add(randomDir().multiplyScalar(0.8)), life: [0.08, 0.16], size: [0.012 * s, 0.02 * s], stretch: 0.03, colors: ctx.cols('core', 'main'), bright: 2.5 * ctx.B, fadeIn: 0 });
        }
        if (!hit && k >= 1) {
          hit = true;
          landed++;
          const at = mid().addScaledVector(dir, -pierce);
          ctx.part('hit');
          ctx.star(at, 0.9 * s, 0.12, 3);
          ctx.glow(at, 0.6 * s, 0.18, 2);
          ctx.ring(at, 0.35 * s, { normal: dir, dur: 0.22, thick: 0.12 });
          ctx.emit('spark', 26, { p: at, v: () => dir.clone().multiplyScalar(-1.5).add(randomDir().multiplyScalar(4)), life: [0.15, 0.35], size: [0.012, 0.024], drag: 3, gravity: 3, stretch: 0.03, colors: ctx.cols('core', 'main', 'accent'), bright: 3 * ctx.B, fadeIn: 0 });
          light.set(mid(), 1.2 * 30);
          if (ctx.fx.feel) ctx.fx.shake(0.05);
          const last = landed === n;
          ctx.hit(mid(), last ? p.power * 2 : p.power, last ? 'final' : landed === 1 ? 'first' : 'link');
          if (last) {
            const c = mid();
            ctx.flare(c, 1.6 * s, 0.3);
            ctx.ring(c, 1.1 * s, { normal, dur: 0.45, thick: 0.06 });
            ctx.ring(c, 0.7 * s, { normal, dur: 0.35, thick: 0.1, delay: 0.05 });
            ctx.wave(c, 1.5 * s, 0.4, 0.8);
            ctx.screenFlash(0.08);
          }
          ctx.part('main');
        }
        if (hit && age < total - 0.3 && Math.random() < 0.25) {
          const along = Math.random();
          const q = pos.clone().addScaledVector(dir, (along - 0.5) * len);
          ctx.emit('mote', 1, { p: q, jitter: 0.05 * s, v: () => randomDir().multiplyScalar(0.3).add(new THREE.Vector3(0, 0.4, 0)), life: [0.3, 0.6], size: [0.015, 0.03], colors: ctx.cols('core', 'main'), bright: 2 * ctx.B });
        }
      });
    }
    ctx.after((n - 1) * p.stagger + 0.12 + p.fly + p.keep + 0.35, () => {
      const c = mid();
      light.release(0.3);
      ctx.part('hit');
      ctx.star(c, 1.6 * s, 0.14, 3);
      ctx.ring(c, 1.4 * s, { normal, dur: 0.3, thick: 0.05 });
      ctx.wave(c, 1.6 * s, 0.3, 0.7);
      ctx.light(c, 2.5, 0.2);
    });
  });
}
bind.defaults = { circleFeet: 1, circleHand: 1, circleTarget: 0, charge: 0.4, count: 6, reach: 2.6, fly: 0.13, stagger: 0.06, keep: 1.6, len: 1.3, width: 0.34, thick: 0.05, tilt: 0.45, depth: 0, size: 1, power: 0.3 };

export function prison(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const g = ctx.ground(ctx.to().addScaledVector(aimOf(ctx).setY(0).normalize(), p.depth * ctx.scale * p.size));
  const W = p.width * s;
  const H = p.height * s;
  const T = 0.09 * s;
  ctx.part('cast');
  ctx.charge(ctx.from(), p.charge, { radius: 0.6, aim: aimOf(ctx), ground: ctx.from() });
  ctx.part('mark');
  ctx.circle(g, W * 1.1, p.charge + p.build + p.keep + p.crush + 0.4, { slot: 'target', spin: -0.5, bright: 1.4 });
  ctx.during(0, p.charge, (_k, dt) => {
    ctx.emit('mote', poisson(90 * dt), { p: () => g.clone().add(randomDir().setY(0).normalize().multiplyScalar(W * 1.4)), center: g.clone().setY(g.y + H * 0.5), attract: 8, v: () => new THREE.Vector3(0, 0.6, 0), life: [0.4, 0.7], size: [0.025, 0.045], drag: 2, colors: ctx.cols('main', 'accent'), bright: 1.6 * ctx.B, fadeIn: 0.1 });
  });
  ctx.after(p.charge, () => {
    ctx.handle.emit('release');
    ctx.part('main');
    const turn = Math.random() * Math.PI * 2;
    const c = g.clone().setY(g.y + H / 2);
    const sides = [0, 1, 2, 3].map((i) => new THREE.Vector3(Math.cos(turn + (i * Math.PI) / 2), 0, Math.sin(turn + (i * Math.PI) / 2)));
    const crushAt = p.build + p.keep;
    const end = crushAt + p.crush;
    const closed = p.build;
    const light = ctx.hold(7);
    const crackOf = (age: number) => span(age, crushAt, end);
    const tremble = (age: number) => randomDir().multiplyScalar(0.012 * s * (span(age, closed, crushAt) + crackOf(age) * 1.5));
    const glass = ctx.pal.accent.clone().multiplyScalar(0.35).lerp(ctx.pal.main, 0.15);
    const h = W / 2 + T;
    const top = H + T;
    const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([x, z]) => g.clone().addScaledVector(sides[0], x * h).addScaledVector(sides[1], z * h));
    const edges: [THREE.Vector3, THREE.Vector3, number, number][] = [];
    const phase = [[0, 0.25], [0.25, 0.55], [0.55, 0.75]].map(([a, b]) => [a * p.build, b * p.build]);
    corners.forEach((q, k) => edges.push([q, corners[(k + 1) % 4], phase[0][0], phase[0][1]]));
    corners.forEach((q) => edges.push([q, q.clone().setY(q.y + top), phase[1][0], phase[1][1]]));
    corners.forEach((q, k) => edges.push([q.clone().setY(q.y + top), corners[(k + 1) % 4].clone().setY(q.y + top), phase[2][0], phase[2][1]]));
    const bar = p.bar * s;
    edges.forEach(([a, b, t0, t1], j) => {
      const prim = ctx.fx.prims.acquire('plate');
      paint(ctx, prim, 2.4);
      prim.u.size.value.set(bar, bar, a.distanceTo(b));
      let done = false;
      ctx.live(prim, end, (_k, age) => {
        const k = ease.outCubic(span(age, t0, t1));
        const sq = crackOf(age);
        const shake = age > closed ? tremble(age) : new THREE.Vector3();
        const a2 = a.clone().add(shake);
        const b2 = a.clone().lerp(b, k).add(shake);
        const d = b2.clone().sub(a2);
        const L = Math.max(d.length(), 1e-4);
        prim.mesh.position.copy(a2).addScaledVector(d, 0.5);
        orient(prim.mesh.quaternion, d.divideScalar(L), Math.abs(d.y) > 0.9 ? sides[0] : UP);
        prim.mesh.scale.set(bar, bar, L);
        prim.mesh.visible = age > t0 && !ctx.hidden && _k < 1;
        prim.u.time.value = age;
        prim.u.heat.value = k < 1 ? 1 : Math.max(0.15, 1 - (age - t1) * 2) + sq * sq * (Math.sin(age * 70 + j) > 0 ? 1.6 : 0.6);
        if (_k >= 1 && !ctx.hidden) shatter(ctx, prim.mesh.position.clone(), prim.mesh.quaternion, new THREE.Vector3(bar, bar, L), ctx.pal.main.clone().lerp(ctx.pal.core, 0.3), { speed: 3, most: 2, glints: 0.5 });
        if (k > 0 && k < 1 && !ctx.hidden) ctx.emit('spark', 1, { p: b2, v: () => randomDir().multiplyScalar(1.2), life: [0.12, 0.25], size: [0.014, 0.026], drag: 3, colors: ctx.cols('core', 'main'), bright: 3 * ctx.B, fadeIn: 0 });
        if (!done && k >= 1) {
          done = true;
          ctx.part('hit');
          ctx.star(b2, 0.5 * s, 0.1, 2.5);
          if (j === 3) ctx.ring(g, h * 1.4, { normal: 'up', dur: 0.3, thick: 0.06 });
          ctx.part('main');
        }
      });
    });
    const faces: { prim: Prim; pos: THREE.Vector3; q: THREE.Quaternion; dims: THREE.Vector3; lid: boolean }[] = [];
    sides.forEach((n, i) => faces.push({ prim: ctx.fx.prims.acquire('slab'), pos: c.clone().addScaledVector(n, W / 2 + T / 2), q: orient(new THREE.Quaternion(), n), dims: new THREE.Vector3(W + T * (i % 2 ? 2 : 0), H, T), lid: false }));
    faces.push({ prim: ctx.fx.prims.acquire('slab'), pos: c.clone().setY(c.y + H / 2 + T / 2), q: new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2).premultiply(new THREE.Quaternion().setFromAxisAngle(UP, -turn)), dims: new THREE.Vector3(W + T * 2, W + T * 2, T), lid: true });
    const f0 = 0.75 * p.build;
    faces.forEach((f) => {
      paint(ctx, f.prim, 2);
      f.prim.u.size.value.copy(f.dims);
      f.prim.u.seed.value = Math.random() * 50;
      const r0 = f.lid ? 0.88 * p.build : f0;
      ctx.live(f.prim, end, (_k, age) => {
        const sq = crackOf(age);
        const pos = f.pos.clone();
        if (age > closed) pos.add(tremble(age));
        f.prim.mesh.position.copy(pos);
        f.prim.mesh.quaternion.copy(f.q);
        f.prim.mesh.scale.copy(f.dims);
        f.prim.u.fade.value = 1;
        f.prim.mesh.visible = age > r0 && !ctx.hidden && _k < 1;
        if (_k >= 1 && !ctx.hidden) shatter(ctx, pos, f.q, f.dims, glass, { speed: 3.2, most: 12 });
        f.prim.u.reveal.value = ease.inOutQuad(span(age, r0, p.build));
        f.prim.u.time.value = age;
        const charge = span(age, closed, crushAt);
        f.prim.u.seam.value = 0.35 + charge * 1.2 + sq * 2 + Math.max(0, 1 - (age - closed) * 5) * 1.5 * (age > closed ? 1 : 0);
        f.prim.u.vein.value = charge * charge * 0.8 + sq * 2.5 * (Math.sin(age * 60) > -0.2 ? 1 : 0.4);
      });
    });
    ctx.after(closed, () => {
      ctx.part('hit');
      ctx.dust(g, 0.8 * s);
      ctx.ring(c.clone().setY(g.y + top), W * 0.9, { normal: 'up', dur: 0.3, thick: 0.06 });
      ctx.emit('spark', 60, { p: () => c.clone().add(randomDir().multiply(new THREE.Vector3(W, H, W)).multiplyScalar(0.55)), v: () => randomDir().multiplyScalar(3), life: [0.15, 0.3], size: [0.012, 0.022], drag: 3, stretch: 0.03, colors: ctx.cols('core', 'main'), bright: 2.6 * ctx.B, fadeIn: 0 });
      if (ctx.fx.feel) ctx.fx.shake(0.18);
      ctx.hit(ctx.to(), p.power * 0.5, 'first');
      ctx.wave(c, W * 1.6, 0.4, 0.8);
      light.set(c, 1.5 * 30);
      ctx.part('main');
    });
    ctx.during(closed, p.keep, (k, dt) => {
      ctx.emit('mist', poisson(50 * dt), { p: () => c.clone().add(randomDir().multiply(new THREE.Vector3(W, H * 0.6, W)).multiplyScalar(1.1)), center: c, attract: 3, v: () => randomDir().multiplyScalar(0.3), life: [0.5, 0.9], size: [0.4 * s, 0.7 * s], colors: ctx.cols('accent', 'main'), bright: 0.5 * ctx.B, fadeIn: 0.3 });
      if (ctx.pal.smoke) ctx.smoke(g.clone().setY(g.y + 0.1), poisson(10 * dt), { jitter: W * 0.6, speed: [0.2, 0.5], size: [0.4 * s, 0.6 * s], delay: 0 });
      light.set(c, (1 + k * 2) * 30);
    });
    const spears = Math.max(0, Math.round(p.spears));
    for (let j = 0; j < spears; j++) {
      const when = closed + 0.15 + (j / Math.max(spears, 1)) * (p.keep - 0.25) + Math.random() * 0.05;
      ctx.after(when, () => {
        const n = sides[Math.floor(Math.random() * 4)];
        const side = UP.clone().cross(n).normalize();
        const exit = c.clone().addScaledVector(n, W / 2 + T).addScaledVector(side, (Math.random() - 0.5) * W * 0.8).setY(c.y + (Math.random() - 0.4) * H * 0.7);
        const dir = n.clone().addScaledVector(side, (Math.random() - 0.5) * 0.9).addScaledVector(UP, (Math.random() - 0.3) * 0.8).normalize();
        const base = exit.clone().addScaledVector(dir, -W * 0.45);
        const L = (1.5 + Math.random() * 1.1) * s;
        const r = (0.13 + Math.random() * 0.08) * s;
        const prim = ctx.fx.prims.acquire('spear');
        paint(ctx, prim, 2.4);
        const q = new THREE.Quaternion().setFromUnitVectors(UP, dir);
        const life = end - when;
        ctx.live(prim, life, (_k, age) => {
          const grow = ease.outExpo(span(age, 0, 0.07));
          prim.mesh.position.copy(base).add(tremble(age + when));
          prim.mesh.quaternion.copy(q);
          prim.mesh.scale.set(r, (W * 0.45 + L) * grow, r);
          prim.u.fade.value = 1;
          prim.mesh.visible = !ctx.hidden && _k < 1;
          if (_k >= 1 && !ctx.hidden) shatter(ctx, prim.mesh.position.clone().addScaledVector(dir, (W * 0.45 + L) * 0.6), q, new THREE.Vector3(r * 1.4, (W * 0.45 + L) * 0.7, r * 1.4), glass, { speed: 2.5, most: 2, glints: 0.5 });
        });
        ctx.part('hit');
        ctx.star(exit, 0.7 * s, 0.1, 3);
        ctx.ring(exit, 0.3 * s, { normal: dir, dur: 0.18, thick: 0.12 });
        ctx.emit('shard', 14, { p: exit, v: () => dir.clone().multiplyScalar(3).add(randomDir().multiplyScalar(2)), life: [0.2, 0.4], size: [0.02, 0.05], gravity: 6, drag: 2, stretch: 0.02, colors: ctx.cols('core', 'main'), bright: 2.4 * ctx.B, fadeIn: 0 });
        ctx.rocks(exit, 2, 0.8 * s, () => dir.clone().multiplyScalar(2 + Math.random() * 2).add(randomDir()));
        ctx.hit(ctx.to(), p.power * 0.4, 'tick');
        if (ctx.fx.feel) ctx.fx.shake(0.04);
        ctx.part('main');
      });
    }
    ctx.after(crushAt, () => {
      ctx.during(0, p.crush, (_k, dt) => {
        ctx.emit('spark', poisson(120 * dt), { p: () => c.clone().add(randomDir().multiply(new THREE.Vector3(W, H, W)).multiplyScalar(0.55)), v: () => randomDir().multiplyScalar(1.5), life: [0.08, 0.16], size: [0.012, 0.022], drag: 3, colors: ctx.cols('core', 'main'), bright: 3 * ctx.B, fadeIn: 0 });
        if (ctx.fx.feel) ctx.fx.shake(dt * 1.2);
      });
    });
    ctx.after(end, () => {
      ctx.part('hit');
      ctx.screenFlash(0.18);
      ctx.star(c, 2.6 * s, 0.22, 3);
      ctx.flare(c, 2.4 * s, 0.35);
      ctx.glow(c, 1.8 * s, 0.4, 1.4);
      ctx.light(c, 7 * p.power, 0.6, 12);
      ctx.wave(c, W * 2.6, 0.55, 1.6);
      for (let i = 0; i < 3; i++) ctx.ring(g, (W * 1.2 + i * 0.9 * s), { normal: 'up', dur: 0.5 + i * 0.1, thick: 0.06, delay: i * 0.06 });
      ctx.decal(g, W * 1.4, 5);
      ctx.dust(g, 1.6 * s);
      ctx.burst(c, { count: 30, speed: 6, scale: 1.1 * s });
      ctx.hit(ctx.to(), p.power * 2, 'final');
      light.release(0.3);
      if (ctx.pal.smoke) ctx.during(0.05, 0.8, (_k, dt) => ctx.smoke(g.clone().setY(g.y + 0.4), poisson(45 * dt), { jitter: W * 0.5, speed: [1, 2.2], size: [0.45 * s, 0.8 * s], delay: 0 }));
    });
  });
}
prison.defaults = { circleFeet: 1, circleHand: 1, circleTarget: 0, charge: 0.55, build: 1.1, keep: 1.5, crush: 0.5, width: 1.5, height: 2.3, spears: 12, bar: 0.07, depth: 0, size: 1, power: 1.2 };

function bar(ctx: Ctx, a: () => THREE.Vector3, b: () => THREE.Vector3, o: { width: number; thick: number; t0: number; t1: number; end: number; up?: THREE.Vector3; heat?: (age: number) => number; done?: () => void; bright?: number }): void {
  const prim = ctx.fx.prims.acquire('plate');
  paint(ctx, prim, o.bright ?? 2.4);
  let done = false;
  ctx.live(prim, o.end, (_k, age) => {
    const k = ease.outCubic(span(age, o.t0, o.t1));
    const a2 = a();
    const b2 = a2.clone().lerp(b(), k);
    const d = b2.clone().sub(a2);
    const L = Math.max(d.length(), 1e-4);
    prim.u.size.value.set(o.width, o.thick, L);
    prim.mesh.position.copy(a2).addScaledVector(d, 0.5);
    const z = d.divideScalar(L);
    orient(prim.mesh.quaternion, z, o.up ?? (Math.abs(z.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : UP));
    prim.mesh.scale.set(o.width, o.thick, L);
    prim.mesh.visible = age > o.t0 && !ctx.hidden;
    prim.u.time.value = age;
    prim.u.heat.value = o.heat ? o.heat(age) : k < 1 ? 1 : Math.max(0.15, 1 - (age - o.t1) * 2);
    prim.u.fade.value = 1 - span(age, o.end - 0.08, o.end);
    if (k > 0 && k < 1 && !ctx.hidden) ctx.emit('spark', 1, { p: b2, v: () => randomDir().multiplyScalar(1.2), life: [0.12, 0.25], size: [0.014, 0.026], drag: 3, colors: ctx.cols('core', 'main'), bright: 3 * ctx.B, fadeIn: 0 });
    if (!done && k >= 1) {
      done = true;
      o.done?.();
    }
  });
}

export function pillars(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const g = ctx.ground(ctx.to().addScaledVector(aimOf(ctx).setY(0).normalize(), p.depth * ctx.scale * p.size));
  const n = Math.max(1, Math.round(p.count));
  const R = p.ring * s;
  const Wp = p.thick * s;
  const Hp = p.height * s;
  const total = 0.35 + (n - 1) * p.stagger + p.fall + p.stay + 0.6;
  ctx.part('cast');
  ctx.charge(ctx.from(), 0.35, { radius: 0.5, aim: aimOf(ctx), ground: ctx.from() });
  ctx.part('mark');
  ctx.circle(g, (R + Wp) * 1.5, total, { slot: 'target', spin: 0.4, bright: 1.4 });
  ctx.after(0.35, () => {
    ctx.handle.emit('release');
    ctx.part('main');
    const a0 = Math.random() * Math.PI * 2;
    const bases: THREE.Vector3[] = [];
    const lockAt = (n - 1) * p.stagger + p.fall + 0.15;
    const end = total - 0.35;
    let landed = 0;
    for (let i = 0; i < n; i++) {
      const a = a0 + (i / n) * Math.PI * 2;
      const out = new THREE.Vector3(Math.cos(a), 0, Math.sin(a));
      const base = g.clone().addScaledVector(out, R);
      bases.push(base);
      const delay = i * p.stagger;
      const prim = ctx.fx.prims.acquire('slab');
      paint(ctx, prim, 2);
      prim.u.size.value.set(Wp, Hp, Wp);
      prim.u.seed.value = Math.random() * 50;
      prim.u.reveal.value = 1;
      const lean = new THREE.Quaternion().setFromAxisAngle(UP.clone().cross(out).normalize(), -0.06).multiply(new THREE.Quaternion().setFromAxisAngle(UP, -a));
      const drop = Hp + 7 * s;
      let hit = false;
      ctx.during(0, delay + p.fall, (_k, dt) => ctx.emit('glow', poisson(30 * dt), { p: base.clone().setY(base.y + 0.03), speed: 0, life: 0.08, size: Wp * 2.2, colors: ctx.cols('main', 'accent'), bright: 0.6 * ctx.B, fadeIn: 0.02 }));
      ctx.live(prim, end, (_k, age) => {
        const t = age - delay;
        const k = ease.inQuad(span(t, 0, p.fall));
        const sink = ease.inCubic(span(age, end - 0.6, end));
        prim.mesh.position.set(base.x, base.y + Hp / 2 - 0.15 * Hp + drop * (1 - k) - Hp * 0.9 * sink, base.z);
        prim.mesh.quaternion.copy(lean);
        prim.mesh.scale.set(Wp, Hp, Wp);
        prim.mesh.visible = t > 0 && !ctx.hidden;
        prim.u.fade.value = span(t, 0, 0.05) * (1 - span(age, end - 0.15, end));
        prim.u.time.value = age;
        const lock = span(age, lockAt, lockAt + 0.3) * (1 - sink);
        prim.u.seam.value = 0.5 + (hit ? Math.max(0, 1 - (t - p.fall) * 3) * 2 : 0) + lock * 1.2;
        prim.u.vein.value = lock * 0.9;
        if (!hit && k >= 1) {
          hit = true;
          landed++;
          ctx.part('hit');
          ctx.dust(base, 0.8 * s);
          ctx.rocks(base.clone().setY(base.y + 0.1), 6, 0.9 * s, () => randomDir().setY(0.5 + Math.random()).multiplyScalar(3));
          ctx.ring(base, 1.1 * s, { normal: 'up', dur: 0.35, thick: 0.08 });
          ctx.decal(base, 0.9 * s, 5);
          ctx.star(base.clone().setY(base.y + 0.3), 0.9 * s, 0.12, 2.5);
          ctx.light(base.clone().setY(base.y + 0.6), 2, 0.2);
          if (ctx.fx.feel) ctx.fx.shake(0.16);
          ctx.hit(ctx.to(), p.power, landed === 1 ? 'first' : 'link');
          ctx.part('main');
        }
        if (sink > 0 && sink < 1 && Math.random() < 0.3) ctx.dust(base, 0.2 * s);
      });
    }
    ctx.after(lockAt, () => {
      for (let i = 0; i < n; i++) {
        const from = bases[i].clone().setY(bases[i].y + 0.03);
        const to = bases[(i + 2) % n].clone().setY(bases[i].y + 0.03);
        bar(ctx, () => from, () => to, { width: 0.09 * s, thick: 0.02 * s, t0: 0, t1: 0.22, end: end - lockAt - 0.3, up: UP, heat: (age) => (age < 0.22 ? 1 : 0.35 + 0.15 * Math.sin(age * 8)) });
      }
      ctx.part('hit');
      const c = ctx.to();
      ctx.flare(c, 1.8 * s, 0.3);
      ctx.ring(g, (R + Wp) * 1.4, { normal: 'up', dur: 0.45, thick: 0.06 });
      ctx.wave(c, 2 * s, 0.4, 0.9);
      ctx.screenFlash(0.1);
      ctx.hit(c, p.power * 1.6, 'final');
    });
  });
}
pillars.defaults = { circleFeet: 1, circleHand: 1, circleTarget: 0, count: 5, ring: 1.05, thick: 0.34, height: 3.2, fall: 0.26, stagger: 0.14, stay: 1.4, depth: 0, size: 1, power: 0.8 };

export function nine(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  ctx.part('cast');
  ctx.charge(ctx.from(), p.charge, { radius: 0.55, aim: aimOf(ctx), ground: ctx.from() });
  ctx.after(p.charge, () => {
    ctx.handle.emit('release');
    ctx.part('main');
    const back = aimOf(ctx).negate().setY(0);
    if (back.lengthSq() < 1e-6) back.set(0, 0, 1);
    back.normalize();
    const side = UP.clone().cross(back).normalize();
    const n = 9;
    const lockAt = (n - 1) * p.stagger + p.fly;
    const end = lockAt + p.stay + p.crush;
    const light = ctx.hold(6);
    let locked = 0;
    const spot = (i: number) => {
      if (i === n - 1) return new THREE.Vector3();
      const a = (i / (n - 1)) * Math.PI * 2;
      return side.clone().multiplyScalar(Math.cos(a) * p.space * s).addScaledVector(UP, Math.sin(a) * p.space * s);
    };
    const order = Array.from({ length: n }, (_, i) => i).sort(() => Math.random() - 0.5);
    order.forEach((i, j) => {
      const prim = ctx.fx.prims.acquire('void');
      prim.u.main.value.copy(ctx.pal.main);
      prim.u.accent.value.copy(ctx.pal.accent);
      prim.u.bright.value = 3 * ctx.B;
      prim.mesh.renderOrder = 3;
      const delay = j * p.stagger;
      const r = (i === n - 1 ? 0.2 : 0.15) * s;
      const a0 = Math.random() * Math.PI * 2;
      const lift = (Math.random() - 0.2) * 1.6 * s;
      const swirl = (Math.random() < 0.5 ? -1 : 1) * (Math.PI * (1 + Math.random()));
      const off = spot(i);
      let hit = false;
      ctx.live(prim, end, (_k, age) => {
        const t = age - delay;
        const c = ctx.to();
        const rest = c.clone().addScaledVector(back, 0.26 * s).add(off);
        const k = ease.inOutCubic(span(t, 0, p.fly));
        const start = c.clone().add(new THREE.Vector3(Math.cos(a0), 0, Math.sin(a0)).multiplyScalar(2.6 * s)).setY(c.y + lift);
        const rel = start.lerp(rest, k).sub(c).applyAxisAngle(UP, swirl * (1 - k));
        const crush = ease.inCubic(span(age, end - p.crush, end));
        const pos = c.clone().add(rel).lerp(c.clone().addScaledVector(back, 0.2 * s), crush);
        prim.mesh.position.copy(pos);
        const pulse = hit ? 1 + 0.12 * Math.sin(age * 10 + i) : 1;
        prim.mesh.scale.setScalar(Math.max(r * ease.outBack(span(t, 0, 0.18)) * pulse * (1 - crush * 0.6), 0.001));
        prim.mesh.visible = t > 0 && !ctx.hidden;
        prim.u.k.value = 0.15 + 0.85 * span(age, end - 0.08, end);
        prim.u.time.value = age;
        if (!hit && t > 0 && !ctx.hidden && Math.random() < 0.6) ctx.emit('mist', 1, { p: pos, speed: 0, life: 0.18, size: r * 3, colors: ctx.cols('accent', 'main'), bright: 0.8 * ctx.B, fadeIn: 0.02 });
        if (!hit && k >= 1) {
          hit = true;
          locked++;
          ctx.part('hit');
          ctx.ring(pos, 0.2 * s, { normal: back, dur: 0.2, thick: 0.14 });
          ctx.star(pos, 0.5 * s, 0.1, 2.5);
          ctx.emit('spark', 12, { p: pos, v: () => randomDir().multiplyScalar(2.5), life: [0.12, 0.25], size: [0.01, 0.02], drag: 3, colors: ctx.cols('core', 'main'), bright: 3 * ctx.B, fadeIn: 0 });
          light.set(c, (0.6 + locked * 0.15) * 30);
          if (ctx.fx.feel) ctx.fx.shake(0.04);
          ctx.hit(c, p.power, locked === 1 ? 'first' : 'link');
          ctx.part('main');
        }
      });
    });
    ctx.after(lockAt + 0.05, () => {
      const c = ctx.to().addScaledVector(back, 0.26 * s);
      ctx.ring(c, p.space * 1.5 * s, { normal: back, dur: 0.4, thick: 0.06 });
      ctx.ring(c, p.space * 1.1 * s, { normal: back, dur: 0.3, thick: 0.1, delay: 0.05 });
      ctx.wave(c, 1.4 * s, 0.35, 0.8);
      ctx.during(0, p.stay, (_k, dt) => ctx.emit('mist', poisson(25 * dt), { p: () => ctx.to().add(randomDir().multiplyScalar(0.6 * s)), center: ctx.to(), attract: 2, life: [0.4, 0.8], size: [0.3 * s, 0.5 * s], colors: ctx.cols('accent', 'main'), bright: 0.4 * ctx.B, fadeIn: 0.2 }));
    });
    ctx.after(end, () => {
      const c = ctx.to().addScaledVector(back, 0.2 * s);
      ctx.part('hit');
      light.release(0.2);
      ctx.screenFlash(0.14);
      ctx.star(c, 2 * s, 0.2, 3);
      ctx.flare(c, 2 * s, 0.3);
      ctx.glow(c, 1.4 * s, 0.35, 1.4);
      ctx.light(c, 5, 0.4, 10);
      ctx.wave(c, 2.4 * s, 0.5, 1.4);
      ctx.ring(c, 1.6 * s, { normal: 'camera', dur: 0.4, thick: 0.07 });
      ctx.burst(c, { count: 110, speed: 6, scale: 1.1 * s });
      ctx.hit(c, p.power * 2.5, 'final');
    });
  });
}
nine.defaults = { circleFeet: 1, circleHand: 1, circleTarget: 0, charge: 0.45, fly: 0.55, stagger: 0.07, stay: 1.2, crush: 0.25, space: 0.72, size: 1, power: 0.3 };

const linkM = new THREE.Matrix4();
const linkQ = new THREE.Quaternion();
const linkS = new THREE.Vector3();

export function chain(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  ctx.part('cast');
  ctx.charge(ctx.from(), p.charge, { radius: 0.5, aim: aimOf(ctx), ground: ctx.from() });
  ctx.after(p.charge, () => {
    ctx.handle.emit('release');
    ctx.part('main');
    const prim = ctx.fx.prims.acquire('chain');
    const mesh = prim.mesh as THREE.InstancedMesh;
    paint(ctx, prim, 1.6);
    const step = 0.24 * s;
    const lo = -0.6 * s;
    const hi = 0.35 * s;
    const turns = p.turns;
    const squeeze0 = p.fly * 0.8;
    const tighten = squeeze0 + p.squeeze;
    const end = tighten + p.keep + 0.3;
    const a0 = Math.random() * Math.PI * 2;
    let state = 0;
    const light = ctx.hold(5);
    const path = (age: number) => {
      const c = ctx.to().addScaledVector(aimOf(ctx).setY(0).normalize(), p.depth * s);
      const hand = ctx.from();
      const k = ease.inCubic(span(age, squeeze0, tighten));
      const coil: THREE.Vector3[] = [];
      const m = 64;
      for (let i = 0; i <= m; i++) {
        const u = i / m;
        const a = a0 + u * turns * Math.PI * 2 + k * 0.6;
        const R = (p.radius * (1 + p.bulge * Math.sin(u * Math.PI)) * (1 - k) + 0.36 * k) * s;
        coil.push(new THREE.Vector3(c.x + Math.cos(a) * R, c.y + hi + (lo - hi) * u, c.z + Math.sin(a) * R));
      }
      const lead: THREE.Vector3[] = [];
      const entry = coil[0];
      const dist = hand.distanceTo(entry);
      for (let i = 0; i < 16; i++) {
        const u = i / 16;
        lead.push(hand.clone().lerp(entry, u).setY(hand.y + (entry.y - hand.y) * u + Math.sin(u * Math.PI) * dist * 0.08));
      }
      return { pts: [...lead, ...coil], leadEnd: lead.length };
    };
    ctx.live(prim, end, (_k, age) => {
      const { pts, leadEnd } = path(age);
      const cum = [0];
      for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + pts[i].distanceTo(pts[i - 1]));
      const total = cum[cum.length - 1];
      const leadLen = cum[leadEnd];
      const headAt = total * span(age, 0, p.fly);
      const tailAt = leadLen * ease.inQuad(span(age, p.fly * 0.6, tighten));
      const brk = span(age, end - 0.3, end);
      let j = 0;
      let seg = 1;
      for (let d = headAt; d > tailAt && j < mesh.instanceMatrix.count; d -= step, j++) {
        while (seg > 1 && cum[seg - 1] > d) seg--;
        while (seg < pts.length - 1 && cum[seg] < d) seg++;
        const k = (d - cum[seg - 1]) / Math.max(cum[seg] - cum[seg - 1], 1e-5);
        const q = pts[seg - 1].clone().lerp(pts[seg], k);
        const tan = pts[seg].clone().sub(pts[seg - 1]).normalize();
        orient(linkQ, tan);
        if (j % 2) linkQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), Math.PI / 2));
        linkQ.multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 2));
        if (brk > 0) q.addScaledVector(randomDir(), brk * 0.6 * s);
        const sz = step * 0.62 * (1 - brk);
        linkS.set(sz, sz * 0.62, sz * 0.62);
        mesh.setMatrixAt(j, linkM.compose(q, linkQ, linkS));
      }
      mesh.count = j;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.visible = !ctx.hidden;
      prim.u.heat.value = state === 2 ? Math.max(0.1, 1 - (age - tighten) * 2) + 0.08 * Math.sin(age * 12) : 0.15 + 0.5 * span(age, squeeze0, tighten);
      const head = pts[Math.min(seg, pts.length - 1)];
      if (state === 0 && age < p.fly && !ctx.hidden) {
        ctx.emit('spark', 2, { p: head, v: () => randomDir().multiplyScalar(1.5), life: [0.1, 0.2], size: [0.012, 0.022], drag: 3, colors: ctx.cols('core', 'main'), bright: 3 * ctx.B, fadeIn: 0 });
      }
      if (state === 0 && headAt >= leadLen) {
        state = 1;
        ctx.part('hit');
        ctx.star(pts[leadEnd], 0.7 * s, 0.1, 2.5);
        ctx.hit(ctx.to(), p.power, 'first');
        ctx.part('main');
      }
      if (state === 1 && age >= tighten) {
        state = 2;
        const c = ctx.to().addScaledVector(aimOf(ctx).setY(0).normalize(), p.depth * s);
        ctx.part('hit');
        ctx.ring(c.clone().setY(c.y + hi), 0.7 * s, { normal: 'up', dur: 0.3, thick: 0.08 });
        ctx.ring(c.clone().setY(c.y + lo), 0.7 * s, { normal: 'up', dur: 0.3, thick: 0.08, delay: 0.04 });
        ctx.flare(c, 1.4 * s, 0.25);
        ctx.wave(c, 1.4 * s, 0.35, 0.8);
        ctx.emit('spark', 50, { p: () => c.clone().add(randomDir().multiplyScalar(0.4 * s)), v: () => randomDir().multiplyScalar(4), life: [0.15, 0.35], size: [0.012, 0.024], drag: 3, stretch: 0.03, colors: ctx.cols('core', 'main', 'accent'), bright: 3 * ctx.B, fadeIn: 0 });
        light.set(c, 1.5 * 30);
        if (ctx.fx.feel) ctx.fx.shake(0.12);
        ctx.hit(c, p.power * 2.2, 'final');
        ctx.part('main');
      }
      if (age >= end - 0.3 && state === 2) {
        state = 3;
        light.release(0.3);
        const c = ctx.to().addScaledVector(aimOf(ctx).setY(0).normalize(), p.depth * s);
        ctx.emit('shard', 40 * s, { p: () => c.clone().add(randomDir().multiplyScalar(0.45 * s)), v: () => randomDir().multiplyScalar(2 + Math.random() * 2), life: [0.3, 0.6], size: [0.03, 0.06], gravity: 6, drag: 1.5, stretch: 0.02, colors: ctx.cols('core', 'main'), bright: 2 * ctx.B, fadeIn: 0 });
        ctx.star(c, 1.2 * s, 0.14, 2.5);
      }
    });
  });
}
chain.defaults = { circleFeet: 1, circleHand: 1, circleTarget: 0, charge: 0.3, fly: 0.7, radius: 0.75, bulge: 0.35, turns: 2.6, squeeze: 0.45, keep: 1.2, depth: 0, size: 1, power: 0.6 };

export function pyramid(ctx: Ctx, p: P): void {
  const s = ctx.scale * p.size;
  const g = ctx.ground(ctx.from());
  const R = p.radius * s;
  const H = p.height * s;
  const build = p.build;
  const end = build + p.keep + 0.3;
  ctx.handle.emit('cast');
  ctx.part('main');
  ctx.circle(g, R * 1.2, end, { slot: 'feet', spin: 0.6, bright: 1.6 });
  const turn = Math.random() * Math.PI * 2;
  const corners = [0, 1, 2, 3].map((k) => g.clone().add(new THREE.Vector3(Math.sin(turn + (k * Math.PI) / 2) * R, 0.02, Math.cos(turn + (k * Math.PI) / 2) * R)));
  const apex = g.clone().setY(g.y + H);
  const w = p.bar * s;
  corners.forEach((q, k) => bar(ctx, () => q, () => corners[(k + 1) % 4], { width: w, thick: w, t0: 0, t1: build * 0.3, end }));
  corners.forEach((q, k) => bar(ctx, () => q, () => apex, { width: w, thick: w, t0: build * 0.3, t1: build * 0.6, end, done: k === 0 ? () => { ctx.star(apex, 1 * s, 0.14, 3); ctx.light(apex, 2, 0.2); } : undefined }));
  const prim = ctx.fx.prims.acquire('shell');
  paint(ctx, prim, 1.6);
  let next = build + p.poke;
  ctx.after(0.1, () => ctx.handle.emit('release'));
  ctx.live(prim, end, (_k, age) => {
    prim.mesh.position.copy(g);
    prim.mesh.rotation.set(0, turn, 0);
    prim.mesh.scale.set(R, H, R);
    prim.mesh.visible = age > build * 0.6 && !ctx.hidden;
    prim.u.reveal.value = ease.inOutQuad(span(age, build * 0.6, build));
    prim.u.time.value = age;
    prim.u.fade.value = 1 - span(age, end - 0.1, end);
    prim.u.flash.value = Math.max(0, prim.u.flash.value - 1 / 60 * 4);
    if (p.poke > 0 && age > next && age < end - 0.4) {
      next += p.poke * (0.6 + Math.random() * 0.8);
      const k = Math.floor(Math.random() * 4);
      const a = corners[k];
      const b = corners[(k + 1) % 4];
      const u = Math.random() * 0.6;
      const at = a.clone().lerp(b, 0.5 + (Math.random() - 0.5) * (1 - u)).lerp(apex, u);
      prim.u.flash.value = 0.6;
      ctx.part('hit');
      ctx.emit('spark', 30, { p: at, v: () => randomDir().multiplyScalar(3), life: [0.15, 0.35], size: [0.012, 0.022], drag: 3, stretch: 0.03, colors: ctx.cols('core', 'main'), bright: 3 * ctx.B, fadeIn: 0 });
      ctx.star(at, 0.6 * s, 0.12, 2.5);
      ctx.light(at, 1.5, 0.2);
      ctx.part('main');
    }
  });
  ctx.after(build, () => {
    ctx.ring(g, R * 1.5, { normal: 'up', dur: 0.4, thick: 0.06 });
    ctx.wave(g.clone().setY(g.y + H * 0.4), R * 1.6, 0.4, 0.7);
  });
  ctx.after(end - 0.1, () => {
    const c = g.clone().setY(g.y + H * 0.4);
    ctx.star(c, 2 * s, 0.2, 2.5);
    ctx.wave(c, R * 2, 0.5, 1);
    ctx.emit('shard', 140 * s, { p: () => { const k = Math.floor(Math.random() * 4); return corners[k].clone().lerp(corners[(k + 1) % 4], Math.random()).lerp(apex, Math.random() * 0.9); }, v: () => randomDir().multiplyScalar(2.5 + Math.random() * 3), life: [0.4, 0.8], size: [0.04, 0.09], gravity: 6, drag: 1.5, stretch: 0.02, colors: ctx.cols('core', 'main'), bright: 2 * ctx.B, fadeIn: 0 });
  });
}
pyramid.defaults = { circleFeet: 1, circleHand: 0, circleTarget: 0, build: 0.8, keep: 2.4, radius: 1.5, height: 2.6, bar: 0.06, size: 1, poke: 0.45 };
