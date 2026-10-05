// Rollshade FX runtime 0.3.0 — https://rollshade.tsuyatt.com/
// Copyright (c) 2026 tsuyatt. MIT License (see the LICENSE file or https://www.npmjs.com/package/rollshade).
// psrdnoise3 and permute4 are ported from psrdnoise (https://github.com/stegu/psrdnoise), Copyright (c) 2021 Stefan Gustavson and Ian McEwan, MIT License (see the LICENSE file).
// Needs three r186 (three/webgpu, three/tsl, three/addons). three.js is MIT licensed.
import * as THREE from "three/webgpu";
import { Color } from "three/webgpu";
import { Fn, If, PI, TWO_PI, abs, atan, billboarding, cameraPosition, cameraProjectionMatrix, cameraViewMatrix, clamp, cos, cross, dot, emissive, exp, faceDirection, float, floor, fract, fwidth, hash, instanceColor, instanceIndex, instancedDynamicBufferAttribute, length, materialColor, materialEmissive, materialMetalness, materialRoughness, max, min, mix, mod, modelWorldMatrix, mrt, mul, mx_cell_noise_float, mx_noise_float, mx_worley_noise_float, mx_worley_noise_vec2, normalGeometry, normalLocal, normalView, normalWorld, normalize, oneMinus, output, pass, positionGeometry, positionLocal, positionView, positionViewDirection, positionWorld, pow, rotate, select, sign, sin, smoothstep, sqrt, step, sub, texture, uniform, uniformArray, uv, varying, vec2, vec3, vec4 } from "three/tsl";
import { MeshSurfaceSampler } from "three/addons/math/MeshSurfaceSampler.js";
import { bloom } from "three/addons/tsl/display/BloomNode.js";
//#region src/runtime/lights.ts
var LightPool = class {
	scale;
	slots = [];
	time = 0;
	mute = () => false;
	constructor(root, size = 6, scale = 1) {
		this.scale = scale;
		for (let i = 0; i < size; i++) {
			const light = new THREE.PointLight(16777215, 0, 8, 2);
			root.add(light);
			this.slots.push({
				light,
				until: 0,
				start: 0,
				peak: 0,
				held: false
			});
		}
	}
	take() {
		const free = this.slots.find((s) => !s.held && s.until <= this.time);
		if (free) return free;
		return this.slots.filter((s) => !s.held).sort((a, b) => a.until - b.until)[0];
	}
	flash(pos, color, intensity, dur, range = 8) {
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
	tryHold(color, range = 6) {
		return this.slots.some((s) => !s.held) ? this.hold(color, range) : null;
	}
	hold(color, range = 6) {
		const s = this.take();
		if (!s) return {
			set: () => {},
			release: () => {}
		};
		s.held = true;
		s.light.color.copy(color);
		s.light.distance = range;
		s.light.intensity = 0;
		const gain = this.mute() ? 0 : this.scale;
		return {
			set: (pos, intensity, col) => {
				s.light.position.copy(pos);
				if (intensity !== void 0) s.light.intensity = intensity * gain * (.9 + Math.random() * .2);
				if (col) s.light.color.copy(col);
			},
			release: (fade = .2) => {
				if (!s.held) return;
				s.held = false;
				s.start = this.time;
				s.until = this.time + fade;
				s.peak = s.light.intensity;
			}
		};
	}
	update(dt) {
		this.time += dt;
		for (const s of this.slots) {
			if (s.held) continue;
			if (s.until <= this.time) {
				s.light.intensity = 0;
				continue;
			}
			const k = (this.time - s.start) / (s.until - s.start);
			s.light.intensity = s.peak * (1 - k) * (1 - k) * (.85 + Math.random() * .3);
		}
	}
	clear() {
		for (const s of this.slots) {
			s.held = false;
			s.until = 0;
			s.light.intensity = 0;
		}
	}
};
//#endregion
//#region src/runtime/palette.ts
var ELEMENTS = {
	plain: {
		core: 15922943,
		main: 11122892,
		accent: 4871526,
		smoke: 2894896
	},
	fire: {
		core: 16774358,
		main: 16742938,
		accent: 11739146,
		smoke: 2365974
	},
	ice: {
		core: 15924223,
		main: 6080767,
		accent: 1724369,
		smoke: null
	},
	thunder: {
		core: 16184575,
		main: 9403391,
		accent: 3812312,
		smoke: null
	},
	wind: {
		core: 16056312,
		main: 8257476,
		accent: 1351802,
		smoke: null
	},
	earth: {
		core: 16773328,
		main: 14260814,
		accent: 7027991,
		smoke: 3812642
	},
	water: {
		core: 15400191,
		main: 4176127,
		accent: 741280,
		smoke: null
	},
	light: {
		core: 16777215,
		main: 16769402,
		accent: 13732383,
		smoke: null
	},
	dark: {
		core: 15784191,
		main: 10173951,
		accent: 2754640,
		smoke: 853522
	},
	poison: {
		core: 14086746,
		main: 7319058,
		accent: 3803978,
		smoke: 1119754
	},
	arcane: {
		core: 16773375,
		main: 16735457,
		accent: 5971926,
		smoke: null
	}
};
var WHITE = new Color(1, 1, 1);
function palette(element, hueShift = 0, color) {
	const e = ELEMENTS[element] ?? ELEMENTS.fire;
	const shift = (c) => hueShift ? c.offsetHSL(hueShift, 0, 0) : c;
	if (color != null) {
		const main = new Color(color);
		return {
			core: shift(main.clone().lerp(WHITE, .82)),
			main: shift(main.clone()),
			accent: shift(main.clone().multiplyScalar(.3)),
			smoke: e.smoke == null ? null : shift(new Color(e.smoke))
		};
	}
	return {
		core: shift(new Color(e.core)),
		main: shift(new Color(e.main)),
		accent: shift(new Color(e.accent)),
		smoke: e.smoke == null ? null : shift(new Color(e.smoke))
	};
}
//#endregion
//#region src/runtime/noise.ts
var SIZE = 256;
var PERIOD = 4;
function lattice(seed) {
	return (x, y) => {
		let h = Math.imul(x * 374761393 + y * 668265263 + seed * 2246822519, 3266489917) >>> 0;
		h = Math.imul(h ^ h >>> 13, 1274126177) >>> 0;
		const a = (h ^ h >>> 16) / 4294967296 * Math.PI * 2;
		return [Math.cos(a), Math.sin(a)];
	};
}
function periodicNoise(seed) {
	const grad = lattice(seed);
	const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
	return (x, y, period) => {
		const x0 = Math.floor(x);
		const y0 = Math.floor(y);
		const fx = x - x0;
		const fy = y - y0;
		const wrap = (i) => (i % period + period) % period;
		const dot = (ix, iy, dx, dy) => {
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
function fbm(seed, octaves) {
	const noise = periodicNoise(seed);
	return (u, v) => {
		let sum = 0;
		let amp = 1;
		let period = PERIOD;
		for (let o = 0; o < octaves; o++) {
			sum += noise(u * period, v * period, period) * amp;
			amp *= .5;
			period *= 2;
		}
		return sum * .5 + .5;
	};
}
var shared$1 = null;
function noiseTexture() {
	if (shared$1) return shared$1;
	const a = fbm(11, 4);
	const b = fbm(29, 4);
	const c = fbm(47, 2);
	const data = new Uint8Array(SIZE * SIZE * 4);
	const R = new Float32Array(SIZE * SIZE);
	for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) R[y * SIZE + x] = a(x / SIZE, y / SIZE);
	const dx = Math.round(.12 / PERIOD * SIZE);
	const dy = Math.round(.18 / PERIOD * SIZE);
	const clamp = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
	for (let y = 0; y < SIZE; y++) for (let x = 0; x < SIZE; x++) {
		const i = y * SIZE + x;
		const r = R[i];
		const shifted = R[(y + dy) % SIZE * SIZE + (x + dx) % SIZE];
		const light = Math.max(.25, Math.min(1.3, (r - shifted) * 3 + .65)) / 1.3;
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
	shared$1 = tex;
	return tex;
}
var tnoise = (uv) => texture(noiseTexture(), uv);
var seedShift = (seed) => vec2(seed.mul(.1373), seed.mul(.2917));
//#endregion
//#region src/runtime/particles.ts
var CURVES = [
	"linear",
	"burst",
	"pop",
	"late",
	"bell",
	"hold",
	"flash"
];
function curve(id, t) {
	switch (id) {
		case 1: return 1 - Math.pow(2, -10 * t);
		case 2: return t < .15 ? 1.25 * (1 - Math.pow(1 - t / .15, 3)) : 1.25 - .25 * Math.min((t - .15) / .2, 1);
		case 3: return t * t * t;
		case 4: return Math.sin(Math.PI * Math.min(t, 1));
		case 5: return t < .7 ? 1 : 1 - Math.pow((t - .7) / .3, 2);
		case 6: return Math.exp(-t * 7);
		default: return t;
	}
}
var HOOKS = [];
var hookRefs = /* @__PURE__ */ new Map();
function hookSlot(h) {
	let slot = HOOKS.indexOf(h);
	if (slot < 0) {
		slot = HOOKS.indexOf(null);
		if (slot < 0) slot = HOOKS.push(null) - 1;
		HOOKS[slot] = h;
	}
	hookRefs.set(h, (hookRefs.get(h) ?? 0) + 1);
	return slot + 1;
}
function dropHook$1(slot) {
	const h = HOOKS[slot];
	if (!h) return;
	const n = (hookRefs.get(h) ?? 1) - 1;
	if (n > 0) hookRefs.set(h, n);
	else {
		hookRefs.delete(h);
		HOOKS[slot] = null;
	}
}
var events = [];
function flushParticleEvents() {
	const list = events.splice(0);
	for (const e of list) e.fn(e.p, e.v);
}
var fieldAt = new THREE.Vector3();
var fieldAxis = new THREE.Vector3();
var UPV = new THREE.Vector3(0, 1, 0);
function applyFields(fields, x, y, z, vx, vy, vz, dt, out) {
	out[0] = vx;
	out[1] = vy;
	out[2] = vz;
	for (const fl of fields) {
		const c = typeof fl.at === "number" ? anchors[fl.at] : fl.at ?? fieldAt.set(0, 0, 0);
		const ax = fl.axis ?? UPV;
		let dx = x - c.x;
		let dy = y - c.y;
		let dz = z - c.z;
		if (fl.shape === "tube") {
			const along = dx * ax.x + dy * ax.y + dz * ax.z;
			dx -= ax.x * along;
			dy -= ax.y * along;
			dz -= ax.z * along;
		}
		const d = Math.hypot(dx, dy, dz) + 1e-5;
		const min = fl.min ?? 0;
		const max = fl.max ?? Infinity;
		if (d < min || d > max) continue;
		const att = fl.power * dt / Math.pow(d - min + 1, fl.falloff ?? 1);
		if (fl.kind === "vortex") {
			fieldAxis.set(ax.y * dz - ax.z * dy, ax.z * dx - ax.x * dz, ax.x * dy - ax.y * dx).divideScalar(d);
			out[0] += fieldAxis.x * att;
			out[1] += fieldAxis.y * att;
			out[2] += fieldAxis.z * att;
		} else if (fl.kind === "attract") {
			out[0] -= dx / d * att;
			out[1] -= dy / d * att;
			out[2] -= dz / d * att;
		} else if (fl.kind === "wind") {
			out[0] += ax.x * att;
			out[1] += ax.y * att;
			out[2] += ax.z * att;
		} else {
			const k = Math.max(1 - att, 0);
			out[0] *= k;
			out[1] *= k;
			out[2] *= k;
		}
	}
}
var fieldOut = [
	0,
	0,
	0
];
var seekTmp = new THREE.Vector3();
var anchors = [];
var freeAnchors = [];
function claimAnchor(p) {
	const i = freeAnchors.pop() ?? anchors.length;
	anchors[i] = p.clone();
	return i;
}
function releaseAnchor(i) {
	freeAnchors.push(i);
}
var ORBITS = [];
var orbitRefs = /* @__PURE__ */ new Map();
function dropOrbit(slot) {
	const orb = ORBITS[slot];
	if (!orb) return;
	const n = (orbitRefs.get(orb) ?? 1) - 1;
	if (n > 0) orbitRefs.set(orb, n);
	else {
		orbitRefs.delete(orb);
		ORBITS[slot] = null;
	}
}
function curlAt(x, y, z, t, k, out) {
	let cx = 0;
	let cy = 0;
	let cz = 0;
	let amp = 1;
	let f = k;
	for (let o = 0; o < 2; o++) {
		const ax = f * x;
		const ay = f * y;
		const az = f * z;
		const s1 = Math.sin(ay + t * .7 + 1.3 + o * 5.1);
		const c1 = Math.cos(ay + t * .7 + 1.3 + o * 5.1);
		const s2 = Math.sin(.9 * az + 2.1 + o * 1.7);
		const c2 = Math.cos(.9 * az + 2.1 + o * 1.7);
		const s3 = Math.sin(az + t * .6 + 4.1 + o * 3.3);
		const c3 = Math.cos(az + t * .6 + 4.1 + o * 3.3);
		const s4 = Math.sin(1.1 * ax + .5 + o * 2.9);
		const c4 = Math.cos(1.1 * ax + .5 + o * 2.9);
		const s5 = Math.sin(ax + t * .8 + 2.7 + o * 4.4);
		const c5 = Math.cos(ax + t * .8 + 2.7 + o * 4.4);
		const s6 = Math.sin(.8 * ay + 3.3 + o * .9);
		const c6 = Math.cos(.8 * ay + 3.3 + o * .9);
		const dzdy = s5 * -s6 * .8;
		const dydz = c3 * c4;
		const dxdz = s1 * -s2 * .9;
		const dzdx = c5 * c6;
		const dydx = s3 * -s4 * 1.1;
		const dxdy = c1 * c2;
		cx += (dzdy - dydz) * amp;
		cy += (dxdz - dzdx) * amp;
		cz += (dydx - dxdy) * amp;
		amp *= .5;
		f *= 2.3;
	}
	out[0] = cx;
	out[1] = cy;
	out[2] = cz;
}
var curlOut = [
	0,
	0,
	0
];
var FIELDS = 48;
var pick = (r, fallback) => {
	if (r === void 0) return fallback;
	if (typeof r === "number") return r;
	if (typeof r === "function") return r();
	return r[0] + Math.random() * (r[1] - r[0]);
};
var tmp = new THREE.Vector3();
var tmpDir = new THREE.Vector3();
function randomDir(out = new THREE.Vector3()) {
	const z = Math.random() * 2 - 1;
	const a = Math.random() * Math.PI * 2;
	const r = Math.sqrt(1 - z * z);
	return out.set(r * Math.cos(a), z, r * Math.sin(a));
}
function coneDir(dir, spread, out = new THREE.Vector3()) {
	if (spread >= 1) return randomDir(out);
	randomDir(tmpDir);
	return out.copy(dir).normalize().lerp(tmpDir, spread).normalize();
}
var ParticleSystem = class {
	kind;
	max;
	mesh;
	data;
	count = 0;
	a;
	b;
	c;
	d;
	geometry;
	material;
	soft;
	constructor(kind, max) {
		this.kind = kind;
		this.max = max;
		this.data = new Float32Array(max * FIELDS);
		this.soft = kind === "smoke" || kind === "mist" || kind === "flame" || kind === "haze";
		const make = () => {
			const attr = new THREE.InstancedBufferAttribute(new Float32Array(max * 4), 4);
			attr.setUsage(THREE.DynamicDrawUsage);
			return attr;
		};
		this.a = make();
		this.b = make();
		this.c = make();
		this.d = make();
		const quad = new THREE.PlaneGeometry(2, 2);
		this.geometry = new THREE.InstancedBufferGeometry();
		this.geometry.index = quad.index;
		this.geometry.setAttribute("position", quad.getAttribute("position"));
		this.geometry.setAttribute("uv", quad.getAttribute("uv"));
		this.geometry.instanceCount = 0;
		this.material = particleMaterial(kind, this.a, this.b, this.c, this.d);
		this.mesh = new THREE.Mesh(this.geometry, this.material);
		this.mesh.frustumCulled = false;
		this.mesh.renderOrder = kind === "smoke" || kind === "haze" ? 1 : 2;
	}
	emit(n, o) {
		const scaled = this.kind === "star" || this.kind === "flare" || n === 1 && (this.kind === "glow" || this.kind === "mist") ? n : n * emission.scale;
		const total = Math.floor(scaled) + (Math.random() < scaled - Math.floor(scaled) ? 1 : 0);
		for (let k = 0; k < total; k++) {
			let i;
			if (this.count < this.max) i = this.count++;
			else {
				i = Math.floor(Math.random() * this.max);
				const old = this.data[i * FIELDS + 43];
				if (old) dropOrbit(old - 1);
				const oldHook = this.data[i * FIELDS + 47];
				if (oldHook) dropHook$1(oldHook - 1);
			}
			const f = i * FIELDS;
			const d = this.data;
			const p = typeof o.p === "function" ? o.p() : o.p ?? tmp.set(0, 0, 0);
			const j = o.jitter ?? 0;
			d[f] = p.x + (Math.random() * 2 - 1) * j;
			d[f + 1] = p.y + (Math.random() * 2 - 1) * j;
			d[f + 2] = p.z + (Math.random() * 2 - 1) * j;
			let v;
			if (o.v) v = o.v();
			else {
				v = o.dir ? coneDir(o.dir, o.spread ?? .3, tmpDir) : randomDir(tmpDir);
				v.multiplyScalar(pick(o.speed, 1));
			}
			d[f + 3] = v.x;
			d[f + 4] = v.y;
			d[f + 5] = v.z;
			d[f + 6] = -pick(o.delay, 0);
			d[f + 7] = Math.max(pick(o.life, .6), .01);
			d[f + 8] = pick(o.size, .1);
			d[f + 9] = pick(o.grow, 1);
			d[f + 10] = Math.random() * Math.PI * 2;
			d[f + 11] = pick(o.spin, 0);
			d[f + 12] = o.gravity ?? 0;
			d[f + 13] = pick(o.drag, 0);
			const cols = o.colors ?? [new THREE.Color(1, 1, 1)];
			const c0 = cols[0];
			const c1 = cols[Math.min(1, cols.length - 1)];
			const c2 = cols[cols.length - 1];
			d[f + 14] = c0.r;
			d[f + 15] = c0.g;
			d[f + 16] = c0.b;
			d[f + 17] = c1.r;
			d[f + 18] = c1.g;
			d[f + 19] = c1.b;
			d[f + 20] = c2.r;
			d[f + 21] = c2.g;
			d[f + 22] = c2.b;
			d[f + 23] = pick(o.bright, 1);
			d[f + 24] = o.fadeIn ?? .05;
			d[f + 25] = o.fadePow ?? 1.5;
			d[f + 26] = o.stretch ?? 0;
			d[f + 27] = o.flicker ?? 0;
			d[f + 28] = o.bounce ?? -1;
			d[f + 29] = o.turb ?? 0;
			d[f + 30] = o.swirl ?? 0;
			d[f + 31] = o.attract ?? 0;
			const c = o.center ?? p;
			d[f + 32] = c.x;
			d[f + 33] = c.y;
			d[f + 34] = c.z;
			d[f + 35] = Math.random();
			d[f + 36] = 0;
			d[f + 37] = 0;
			d[f + 38] = 0;
			d[f + 43] = 0;
			d[f + 44] = Math.min(Math.max(o.dissolve ?? 0, 0), .95);
			d[f + 45] = o.sizeCurve ? CURVES.indexOf(o.sizeCurve) : 0;
			d[f + 46] = o.alphaCurve ? CURVES.indexOf(o.alphaCurve) : 0;
			d[f + 47] = o.hook ? hookSlot(o.hook) : 0;
			if (o.orbit) {
				const orb = o.orbit;
				const cx = orb.anchor !== void 0 ? anchors[orb.anchor] : c;
				const dx = d[f] - cx.x;
				const dz = d[f + 2] - cx.z;
				d[f + 36] = Math.atan2(dz, dx);
				d[f + 37] = d[f + 1] - cx.y;
				d[f + 38] = Math.hypot(dx, dz);
				let slot = ORBITS.indexOf(orb);
				if (slot < 0) {
					slot = ORBITS.indexOf(null);
					if (slot < 0) slot = ORBITS.push(null) - 1;
					ORBITS[slot] = orb;
					orbitRefs.set(orb, 0);
				}
				orbitRefs.set(orb, (orbitRefs.get(orb) ?? 0) + 1);
				d[f + 43] = slot + 1;
			}
			d[f + 39] = o.floor ?? -1e9;
			d[f + 40] = o.curl ?? 0;
			d[f + 41] = o.curlScale ?? 1.4;
			d[f + 42] = o.variant ?? 0;
		}
	}
	update(dt, time) {
		const d = this.data;
		const A = this.a.array;
		const B = this.b.array;
		const C = this.c.array;
		const D = this.d.array;
		let n = this.count;
		let out = 0;
		for (let i = 0; i < n; i++) {
			const f = i * FIELDS;
			d[f + 6] += dt;
			const age = d[f + 6];
			const life = d[f + 7];
			if (age >= life) {
				if (d[f + 43]) dropOrbit(d[f + 43] - 1);
				const hs = d[f + 47];
				if (hs) {
					const h = HOOKS[hs - 1];
					if (h?.onDie) events.push({
						fn: h.onDie,
						p: new THREE.Vector3(d[f], d[f + 1], d[f + 2]),
						v: new THREE.Vector3(d[f + 3], d[f + 4], d[f + 5])
					});
					dropHook$1(hs - 1);
				}
				n--;
				if (i !== n) d.copyWithin(f, n * FIELDS, n * FIELDS + FIELDS);
				i--;
				continue;
			}
			if (age < 0) continue;
			const x0 = d[f];
			const y0 = d[f + 1];
			const z0 = d[f + 2];
			let vx = d[f + 3];
			let vy = d[f + 4];
			let vz = d[f + 5];
			const drag = Math.exp(-d[f + 13] * dt);
			vx *= drag;
			vy = vy * drag - d[f + 12] * dt;
			vz *= drag;
			const tb = d[f + 29];
			if (tb) {
				const s = d[f + 35] * 17.3;
				vx += Math.sin(time * 3.1 + y0 * 2.3 + s) * tb * dt;
				vy += Math.sin(time * 2.7 + z0 * 2.1 + s * 1.3) * tb * .5 * dt;
				vz += Math.cos(time * 2.9 + x0 * 2.2 + s * .7) * tb * dt;
			}
			const sw = d[f + 30];
			const at = d[f + 31];
			if (sw || at) {
				const dx = x0 - d[f + 32];
				const dz = z0 - d[f + 34];
				const dy = y0 - d[f + 33];
				const r = Math.hypot(dx, dy, dz) + 1e-4;
				if (sw) {
					vx += -dz * sw * dt;
					vz += dx * sw * dt;
				}
				if (at) {
					vx -= dx / r * at * dt;
					vy -= dy / r * at * dt;
					vz -= dz / r * at * dt;
				}
			}
			const hs = d[f + 47];
			const hook = hs ? HOOKS[hs - 1] : null;
			if (hook) {
				if (hook.fields) {
					applyFields(hook.fields, x0, y0, z0, vx, vy, vz, dt, fieldOut);
					vx = fieldOut[0];
					vy = fieldOut[1];
					vz = fieldOut[2];
				}
				if (hook.seek) {
					const sk = hook.seek;
					const tg = typeof sk.target === "number" ? anchors[sk.target] : typeof sk.target === "function" ? sk.target() : sk.target;
					seekTmp.set(tg.x - x0, tg.y - y0, tg.z - z0);
					const dist = seekTmp.length();
					if (dist < (sk.arrive ?? .15)) {
						d[f + 6] = life;
						d[f + 3] = vx;
						d[f + 4] = vy;
						d[f + 5] = vz;
						continue;
					}
					seekTmp.multiplyScalar(sk.speed / Math.max(dist, 1e-5));
					const k = Math.min(sk.steer * dt, 1);
					vx += (seekTmp.x - vx) * k;
					vy += (seekTmp.y - vy) * k;
					vz += (seekTmp.z - vz) * k;
				}
			}
			let x = x0 + vx * dt;
			let y = y0 + vy * dt;
			let z = z0 + vz * dt;
			const os = d[f + 43];
			if (os) {
				const orb = ORBITS[os - 1];
				if (orb) {
					const cx = orb.anchor !== void 0 ? anchors[orb.anchor] : null;
					const ox = cx ? cx.x : d[f + 32];
					const oy = cx ? cx.y : d[f + 33];
					const oz = cx ? cx.z : d[f + 34];
					let r = d[f + 38];
					const hh = d[f + 37] + (orb.rise * (.7 + .6 * d[f + 35]) + vy) * dt;
					const k = Math.min(Math.max(hh / orb.h, 0), 1);
					const target = (orb.r0 + (orb.r1 - orb.r0) * Math.pow(k, 1.5)) * (.75 + .5 * d[f + 35]) + Math.max(hh - orb.h, 0) * 2.5;
					r += (target - r) * Math.min((orb.pull ?? 3) * dt, 1);
					const th = d[f + 36] + orb.w * dt * Math.sqrt(Math.max(orb.r1, .2) / Math.max(r, .2)) / (.8 + .4 * d[f + 35]);
					d[f + 36] = th;
					d[f + 37] = hh;
					d[f + 38] = r;
					x = ox + Math.cos(th) * r;
					y = oy + hh;
					z = oz + Math.sin(th) * r;
				}
			}
			const cu = d[f + 40];
			if (cu) {
				curlAt(x0, y0, z0, time, d[f + 41], curlOut);
				const ramp = Math.min(age * 4, 1) * cu * dt;
				x += curlOut[0] * ramp;
				y += curlOut[1] * ramp;
				z += curlOut[2] * ramp;
			}
			const floor = d[f + 39];
			if (this.soft && floor > -1e8) {
				const lift = floor + d[f + 8] * (1 + (d[f + 9] - 1) * Math.min(age / life, 1)) * .8;
				if (y < lift) y = lift;
			}
			if (hook && (hook.onFloor || hook.floorKill) && y < floor && y0 >= floor) {
				if (hook.onFloor) events.push({
					fn: hook.onFloor,
					p: new THREE.Vector3(x, floor, z),
					v: new THREE.Vector3(vx, vy, vz)
				});
				if (hook.floorKill) {
					d[f + 6] = life;
					y = floor;
				}
			}
			if (d[f + 28] >= 0 && y < floor) {
				y = floor + (floor - y);
				vy = -vy * d[f + 28];
				vx *= .7;
				vz *= .7;
			}
			d[f] = x;
			d[f + 1] = y;
			d[f + 2] = z;
			d[f + 3] = vx;
			d[f + 4] = vy;
			d[f + 5] = vz;
			d[f + 10] += d[f + 11] * dt;
			const t = age / life;
			const fin = d[f + 24];
			const ac = d[f + 46];
			let alpha = (fin > 0 ? Math.min(age / fin, 1) : 1) * (ac ? curve(ac, t) : Math.pow(1 - t, d[f + 25]));
			const fl = d[f + 27];
			if (fl) alpha *= 1 - fl + fl * (.5 + .5 * Math.sin(time * 40 + d[f + 35] * 60));
			const sc = d[f + 45];
			const size = d[f + 8] * (sc === 4 ? curve(4, t) * d[f + 9] : 1 + (d[f + 9] - 1) * (sc ? curve(sc, t) : t));
			if (floor > -1e8) alpha *= Math.min(Math.max((y - floor) / (size * .6) + .35, 0), 1);
			const u = t < .5 ? t * 2 : (t - .5) * 2;
			const o0 = t < .5 ? 14 : 17;
			const o1 = t < .5 ? 17 : 20;
			const bright = d[f + 23];
			const st = d[f + 26];
			const mv = st && dt > 0 ? st / dt : 0;
			const q = out * 4;
			A[q] = x;
			A[q + 1] = y;
			A[q + 2] = z;
			A[q + 3] = size;
			B[q] = (x - x0) * mv;
			B[q + 1] = (y - y0) * mv;
			B[q + 2] = (z - z0) * mv;
			B[q + 3] = d[f + 10];
			C[q] = (d[f + o0] + (d[f + o1] - d[f + o0]) * u) * bright;
			C[q + 1] = (d[f + o0 + 1] + (d[f + o1 + 1] - d[f + o0 + 1]) * u) * bright;
			C[q + 2] = (d[f + o0 + 2] + (d[f + o1 + 2] - d[f + o0 + 2]) * u) * bright;
			C[q + 3] = alpha;
			D[q] = t;
			D[q + 1] = d[f + 35];
			D[q + 2] = age;
			D[q + 3] = d[f + 42] + d[f + 44];
			out++;
		}
		this.count = n;
		this.geometry.instanceCount = out;
		for (const attr of [
			this.a,
			this.b,
			this.c,
			this.d
		]) {
			attr.clearUpdateRanges();
			attr.addUpdateRange(0, Math.max(out, 1) * 4);
			attr.needsUpdate = true;
		}
	}
	primeForCompile(on) {
		this.geometry.instanceCount = on ? 1 : 0;
		if (on) {
			this.a.array.set([
				0,
				-1e3,
				0,
				.001
			], 0);
			this.a.needsUpdate = true;
		}
	}
	get alive() {
		return this.count;
	}
	clear() {
		for (let i = 0; i < this.count; i++) {
			if (this.data[i * FIELDS + 43]) dropOrbit(this.data[i * FIELDS + 43] - 1);
			if (this.data[i * FIELDS + 47]) dropHook$1(this.data[i * FIELDS + 47] - 1);
		}
		this.count = 0;
		this.geometry.instanceCount = 0;
	}
	dispose() {
		this.geometry.dispose();
		this.material.dispose();
	}
};
var sizeFloor = uniform(0);
var emission = { scale: 1 };
var screenCap = uniform(.5);
var tanHalfFov = uniform(Math.tan(45 * Math.PI / 360));
var nearFade = uniform(new THREE.Vector2(.4, 1.4));
var orthoHalf = uniform(0);
var noiseTex = noiseTexture();
function particleMaterial(kind, a, b, c, d) {
	const A = instancedDynamicBufferAttribute(a);
	const B = instancedDynamicBufferAttribute(b);
	const C = instancedDynamicBufferAttribute(c);
	const D = instancedDynamicBufferAttribute(d);
	const additive = kind !== "smoke" && kind !== "haze";
	const material = new THREE.MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
		blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
		side: THREE.DoubleSide
	});
	material.vertexNode = Fn(() => {
		const center = cameraViewMatrix.mul(vec4(A.xyz, 1));
		const sv = cameraViewMatrix.mul(vec4(B.xyz, 0)).xy;
		const len = length(sv);
		const axis = select(len.greaterThan(1e-5), sv.div(max(len, 1e-5)), vec2(cos(B.w), sin(B.w)));
		const perp = vec2(axis.y.negate(), axis.x);
		const corner = positionGeometry.xy;
		const depth = center.z.negate();
		const cap = screenCap.mul(select(orthoHalf.greaterThan(0), orthoHalf, depth.mul(tanHalfFov)));
		const near = smoothstep(nearFade.x, nearFade.y, depth);
		const size = min(max(A.w, sizeFloor), cap).mul(step(.001, near));
		const stretch = min(len.mul(.5), cap.mul(2));
		const offset = axis.mul(corner.x.mul(size.add(stretch))).add(perp.mul(corner.y.mul(size)));
		return cameraProjectionMatrix.mul(vec4(center.xy.add(offset), center.z, 1));
	})();
	const col = varying(C);
	const viewDepth = varying(cameraViewMatrix.mul(vec4(A.xyz, 1)).z.negate());
	const info = varying(D);
	const q = uv().mul(2).sub(1);
	const d2 = q.dot(q);
	const dist = d2.sqrt();
	const peak = (rgb) => vec3(max(max(rgb.x, rgb.y), rgb.z));
	const offs = vec2(fract(info.y.mul(7.13)), fract(info.y.mul(3.71)));
	const noise = (scale, drift) => texture(noiseTex, q.mul(scale / 4).add(offs).add(vec2(.7, .45).mul(info.z.mul(drift / 4))));
	const evolving = (scale, drift) => {
		const a = noise(scale, drift);
		const b = texture(noiseTex, q.mul(scale * 1.07 / 4).add(offs.yx).add(vec2(-.5, .8).mul(info.z.mul(drift / 4))).add(.37));
		return a.r.add(b.g).mul(.5).sub(.5).mul(1.4).add(.5);
	};
	let rgb;
	let alpha;
	if (kind === "glow") {
		const g = exp(d2.mul(-4.5)).mul(smoothstep(1, .75, dist));
		rgb = mix(col.rgb, peak(col.rgb), exp(d2.mul(-30)).mul(.6)).mul(g);
		alpha = col.a;
	} else if (kind === "mote") {
		const g = exp(d2.mul(-9)).add(exp(d2.mul(-60)).mul(1.5)).mul(smoothstep(1, .6, dist));
		rgb = mix(col.rgb, peak(col.rgb), exp(d2.mul(-40))).mul(g);
		alpha = col.a;
	} else if (kind === "spark") {
		const g = smoothstep(1, 0, dist).pow(2.2);
		rgb = mix(col.rgb, peak(col.rgb).mul(1.2), smoothstep(.55, 0, dist)).mul(g);
		alpha = col.a;
	} else if (kind === "flare") {
		const ay = abs(q.y);
		const g = exp(ay.mul(-38)).mul(exp(q.x.mul(q.x).mul(-2.5))).add(exp(d2.mul(-25)).mul(.5)).mul(smoothstep(1, .8, abs(q.x)));
		rgb = mix(col.rgb, peak(col.rgb), exp(d2.mul(-80))).mul(g);
		alpha = col.a;
	} else if (kind === "shard") {
		const h1 = fract(sin(info.y.mul(91.3)).mul(43758.5453));
		const h2 = fract(sin(info.y.mul(47.1).add(3.1)).mul(24634.6345));
		const qs = vec2(q.x.add(q.y.mul(h2.sub(.5).mul(.9))), q.y.mul(mix(.7, 1.6, h1)));
		const m = max(abs(qs.x).add(abs(qs.y)), abs(qs.x.mul(.6).add(qs.y.mul(h1.sub(.5)))).mul(1.6));
		const body = smoothstep(1, .86, m);
		const facet = select(qs.x.mul(qs.y.add(h2.sub(.5))).greaterThan(0), float(1), float(.4));
		const edge = smoothstep(.78, .97, m).mul(body);
		rgb = mix(col.rgb.mul(facet), peak(col.rgb).mul(1.3), edge.add(exp(d2.mul(-20)).mul(.5))).mul(body);
		alpha = col.a;
	} else if (kind === "bubble") {
		const x = dist.sub(.78).div(.09);
		const ring = exp(x.mul(x).negate());
		const hl = exp(q.sub(vec2(-.35, .38)).dot(q.sub(vec2(-.35, .38))).mul(-40));
		const g = ring.add(hl.mul(1.5)).add(smoothstep(.85, 0, dist).mul(.08));
		rgb = mix(col.rgb, peak(col.rgb), hl).mul(g);
		alpha = col.a;
	} else if (kind === "glyph") {
		const h = fract(sin(info.y.mul(78.233).add(1.7)).mul(43758.5453)).mul(64);
		const bit = (k) => step(.5, fract(h.div(2 ** k)));
		const line = (dd) => smoothstep(.1, .03, abs(dd));
		const ring = line(dist.sub(.72)).mul(bit(0).mul(.8).add(.2));
		const v = line(q.x.sub(bit(1).sub(.5).mul(.5))).mul(step(abs(q.y), .55));
		const hbar = line(q.y.sub(bit(2).sub(.5).mul(.6))).mul(step(abs(q.x), .5)).mul(bit(3));
		const diag = line(q.x.sub(q.y.mul(bit(4).mul(2).sub(1)))).mul(step(dist, .55)).mul(bit(5));
		const dot = smoothstep(.16, .08, q.sub(vec2(0, .3)).length()).mul(bit(2).mul(bit(5)));
		const rune = max(max(ring, v), max(max(hbar, diag), dot)).add(exp(d2.mul(-5)).mul(.25));
		const sq = vec2(q.x.mul(1.05), q.y.negate());
		const cran = smoothstep(.6, .55, sq.sub(vec2(0, -.15)).length());
		const jaw = smoothstep(.03, 0, max(abs(sq.x).sub(.3), abs(sq.y.sub(.38)).sub(.2)));
		const eyeL = smoothstep(.19, .14, sq.sub(vec2(-.22, -.08)).length());
		const eyeR = smoothstep(.19, .14, sq.sub(vec2(.22, -.08)).length());
		const nose = smoothstep(.09, .05, sq.sub(vec2(0, .17)).length());
		const teeth = step(.3, sq.y).mul(smoothstep(.03, 0, abs(fract(sq.x.mul(5).add(.5)).sub(.5)).sub(.06)));
		const skull = max(cran, jaw).mul(float(1).sub(max(max(eyeL, eyeR), max(nose, teeth)))).mul(.55).add(max(eyeL, eyeR).mul(max(cran, jaw)).mul(1.4)).add(exp(d2.mul(-3)).mul(.15));
		const arm = (a, b) => smoothstep(.2, .12, abs(a)).mul(smoothstep(.72, .6, abs(b)));
		const plus = max(arm(q.x, q.y), arm(q.y, q.x)).add(exp(d2.mul(-4)).mul(.25));
		const lq = vec2(q.x.mul(.7071).sub(q.y.mul(.7071)), q.x.mul(.7071).add(q.y.mul(.7071)));
		const lens = smoothstep(.05, 0, abs(lq.x).mul(2.2).sub(float(.62).sub(lq.y.mul(lq.y).mul(.62))));
		const rib = smoothstep(.05, .015, abs(lq.x)).mul(step(abs(lq.y), .7));
		const leaf = lens.mul(.75).add(rib.mul(.6)).add(exp(d2.mul(-4)).mul(.15));
		const vt = floor(info.w);
		const g = select(vt.greaterThan(2.5), leaf, select(vt.greaterThan(1.5), plus, select(vt.greaterThan(.5), skull, rune)));
		rgb = mix(col.rgb, peak(col.rgb), .35).mul(g);
		alpha = col.a;
	} else if (kind === "haze") {
		const n = noise(1.2, .4).a;
		const shape = exp(d2.mul(-2.2)).mul(n.mul(1.1).add(.15)).mul(smoothstep(1, .55, dist));
		rgb = col.rgb.mul(float(.75).add(q.y.mul(-.25)));
		alpha = clamp(shape.mul(col.a), 0, 1);
	} else if (kind === "mist") {
		const n = evolving(1.4, .6);
		const g = exp(d2.mul(-2.6)).mul(n.mul(1.3).add(.1)).mul(smoothstep(1, .6, dist));
		rgb = col.rgb.mul(g);
		alpha = col.a;
	} else if (kind === "star") {
		const ax = abs(q.x);
		const ay = abs(q.y);
		const rays = max(exp(ax.mul(-22)).mul(exp(ay.mul(-2.2))), exp(ay.mul(-22)).mul(exp(ax.mul(-2.2))));
		const diag = exp(abs(q.x.add(q.y)).mul(-26)).mul(exp(abs(q.x.sub(q.y)).mul(-3))).add(exp(abs(q.x.sub(q.y)).mul(-26)).mul(exp(abs(q.x.add(q.y)).mul(-3)))).mul(.35);
		const g = rays.add(diag).add(exp(d2.mul(-18)).mul(.8)).mul(smoothstep(1, .7, dist));
		rgb = mix(col.rgb, peak(col.rgb), exp(d2.mul(-60))).mul(g);
		alpha = col.a;
	} else {
		const t = info.x;
		const flame = kind === "flame";
		const n = evolving(flame ? 1.3 : 1.1, flame ? 1.6 : .5);
		const body = float(1).sub(dist);
		if (kind === "flame") {
			const dens = clamp(body.mul(1.25).add(n.sub(.5).mul(1.1)).sub(t.mul(.75)), 0, 1);
			const shape = smoothstep(.02, .3, dens).mul(smoothstep(1, .72, dist));
			const hot = smoothstep(.25, .75, dens).mul(float(1).sub(t));
			rgb = mix(col.rgb.mul(.55), mix(col.rgb, peak(col.rgb), .55).mul(1.6), hot).mul(shape);
			alpha = col.a;
		} else {
			const dens = clamp(body.mul(1.1).add(n.sub(.5).mul(1.2)).sub(t.mul(.45)), 0, 1);
			const shape = smoothstep(.02, .45, dens).mul(smoothstep(1, .7, dist));
			const light = noise(1.1, .5).b.mul(1.3);
			rgb = col.rgb.mul(light);
			alpha = shape.mul(col.a).mul(.85);
		}
	}
	if (kind !== "spark" && kind !== "mote" && kind !== "star" && kind !== "flare") {
		const amount = fract(info.w);
		const nd = texture(noiseTex, q.mul(.575).add(offs.mul(1.7))).a.mul(.8).add(dist.mul(.25));
		const thr = amount.mul(smoothstep(.1, 1, info.x)).mul(1.25);
		const on = amount.greaterThan(.001);
		const alive = select(on, smoothstep(thr, thr.add(.03), nd), float(1));
		const rim = select(on, alive.mul(float(1).sub(smoothstep(thr.add(.02), thr.add(.1), nd))).mul(step(.02, thr)), float(0));
		rgb = rgb.mul(alive).add(peak(col.rgb).mul(rim).mul(additive ? 1.6 : .8));
		alpha = alpha.mul(max(alive, rim));
	}
	alpha = alpha.mul(smoothstep(nearFade.x, nearFade.y, viewDepth));
	if (additive) {
		material.colorNode = rgb.mul(alpha);
		material.opacityNode = float(1);
	} else {
		material.colorNode = rgb;
		material.opacityNode = alpha;
	}
	material.fog = false;
	return material;
}
//#endregion
//#region src/runtime/shaders.ts
var TWO_PI$1 = Math.PI * 2;
var oneMinus$1 = (x) => float(1).sub(x);
var wrap = (a) => a.sub(floor(a.div(TWO_PI$1)).mul(TWO_PI$1));
function circleLine$1(x, center, width) {
	return oneMinus$1(smoothstep(width * .5, width * .5 + .006, abs(x.sub(center))));
}
function circleRunes$1(angle, r, inner, outer, count, seed) {
	const u = angle.div(TWO_PI$1).mul(count);
	const cell = floor(u);
	const x = fract(u).sub(.5).mul(2);
	const y = r.sub((inner + outer) / 2).div((outer - inner) / 2);
	const h = hash(cell.add(seed * 131 + 7)).mul(64);
	const bit = (k) => step(.5, fract(h.div(2 ** k)));
	const w = .16;
	const stem = oneMinus$1(smoothstep(w, .24, abs(x.sub(bit(0).sub(.5).mul(.6)))));
	const bar = oneMinus$1(smoothstep(w, .24, abs(y.sub(bit(1).sub(.5).mul(.8))))).mul(bit(2));
	const slant = oneMinus$1(smoothstep(w, .24, abs(x.sub(y.mul(bit(3).mul(2).sub(1)).mul(.7))))).mul(bit(4));
	const blob = oneMinus$1(smoothstep(.18, .28, length(vec2(x.sub(bit(5).sub(.5).mul(.9)), y.add(.45))))).mul(bit(1).mul(bit(4)));
	const inside = step(abs(x), .62).mul(step(abs(y), .8));
	return max(max(stem, bar), max(slant, blob)).mul(inside);
}
var MAXV = 9;
function segDist(p, a, b) {
	const pa = p.sub(a);
	const ba = b.sub(a);
	const h = clamp(pa.dot(ba).div(max(ba.dot(ba), 1e-5)), 0, 1);
	return length(pa.sub(ba.mul(h)));
}
function starPolygon(c, turn, sides, skip, radius, width) {
	let best = float(9);
	const step2 = float(TWO_PI$1).div(max(sides, 1));
	for (let i = 0; i < MAXV; i++) {
		const a0 = turn.add(step2.mul(i));
		const a1 = turn.add(step2.mul(skip.add(i)));
		const d = segDist(c, vec2(cos(a0), sin(a0)).mul(radius), vec2(cos(a1), sin(a1)).mul(radius));
		best = min(best, d.add(step(sides.sub(.5), float(i)).mul(9)));
	}
	return oneMinus$1(smoothstep(width * .5, width * .5 + .006, best)).mul(step(.5, sides));
}
function patternCircle(uv, turn, reveal, mode, P) {
	const c = uv.mul(2).sub(1);
	const r = length(c);
	const base = atan(c.y, c.x);
	const outer = base.add(turn);
	const inner = base.sub(turn.mul(2));
	let lines = circleLine$1(r, .955, .03).add(circleLine$1(r, .86, .012)).add(circleLine$1(r, .835, .008));
	const runeOuter = step(.5, fract(P.runes.div(2)));
	const runeInner = step(1.5, P.runes);
	lines = lines.add(circleRunes$1(wrap(outer), r, .865, .95, 40, 3).mul(.9).mul(runeOuter));
	const tickAt = wrap(outer).div(TWO_PI$1).mul(120);
	const tickLong = step(fract(floor(tickAt).div(5)), .1);
	const ticks = oneMinus$1(smoothstep(.1, .22, abs(fract(tickAt).sub(.5)))).mul(step(r, .83)).mul(step(mix(.795, .765, tickLong), r));
	lines = lines.add(ticks.mul(.8).mul(P.ticks));
	const star = .64;
	lines = lines.add(circleLine$1(r, star, .014));
	const inside = step(r, .65);
	lines = lines.add(starPolygon(c, turn.negate().mul(2).add(Math.PI / 2), P.sidesA, P.skipA, star, .014).mul(inside));
	lines = lines.add(starPolygon(c, turn.negate().mul(2).add(P.rotB).add(Math.PI / 2), P.sidesB, P.skipB, star, .012).mul(inside));
	const sp = max(P.spokes, 1);
	const cell = fract(outer.div(TWO_PI$1).mul(sp).add(.5)).sub(.5);
	const arc = abs(cell).mul(TWO_PI$1).div(sp).mul(r);
	const spokeBand = step(.36, r).mul(step(r, .62));
	lines = lines.add(oneMinus$1(smoothstep(.006, .012, arc)).mul(spokeBand).mul(step(.5, P.spokes)));
	const bar = (rb, len) => oneMinus$1(smoothstep(.005, .011, abs(r.sub(rb)))).mul(step(arc, len));
	lines = lines.add(bar(.47, .05).add(bar(.55, .035)).mul(step(.5, P.spokes)).mul(P.branch));
	const sa = max(P.spiral, 1);
	const spiralCell = fract(inner.sub(r.add(.02).log().mul(2.4)).div(TWO_PI$1).mul(sa)).sub(.5);
	const spiralLine = oneMinus$1(smoothstep(.02, .045, abs(spiralCell))).mul(step(.13, r)).mul(step(r, .62));
	lines = lines.add(spiralLine.mul(step(.5, P.spiral)).mul(.9));
	const wv = max(P.waves, 1);
	const wave = (rad, amp) => circleLine$1(r.sub(sin(outer.mul(wv)).mul(amp)), rad, .01);
	lines = lines.add(wave(.74, .025).add(wave(.45, .02)).mul(step(.5, P.waves)));
	const dn = max(P.dots, 1);
	const da = floor(inner.div(TWO_PI$1).mul(dn).add(.5)).mul(TWO_PI$1).div(dn);
	const dp = vec2(cos(da.sub(inner.sub(base))), sin(da.sub(inner.sub(base)))).mul(star);
	const dd = length(c.sub(dp));
	lines = lines.add(circleLine$1(dd, .06, .012).add(oneMinus$1(smoothstep(.02, .028, dd)).mul(.8)).mul(step(.5, P.dots)));
	const pet = r.sub(mix(.2, .52, abs(cos(inner.mul(max(P.petals, 1)).mul(.5)))));
	lines = lines.add(oneMinus$1(smoothstep(.006, .013, abs(pet))).mul(step(r, .53)).mul(step(.5, P.petals)));
	lines = lines.add(circleLine$1(r, .34, .012)).add(circleRunes$1(wrap(inner), r, .25, .33, 18, 8).mul(.8).mul(runeInner)).add(circleLine$1(r, .24, .008));
	lines = lines.add(circleLine$1(r, .12, .012)).add(circleLine$1(r, .06, .01));
	const glow = pow(max(oneMinus$1(r), 0), 3).mul(.25).add(oneMinus$1(smoothstep(.9, 1, r)).mul(.06));
	const shape = clamp(lines, 0, 1).mul(step(r, 1)).add(glow);
	const at = wrap(base.add(Math.PI / 2)).div(TWO_PI$1);
	const angular = step(at, reveal.mul(1.02));
	const angularPen = oneMinus$1(smoothstep(0, .05, abs(at.sub(reveal)))).mul(step(reveal, .999)).mul(step(r, .97)).mul(step(.82, r)).mul(1.5);
	const front = reveal.mul(1.1);
	const radialOut = step(r, front);
	const radialOutPen = oneMinus$1(smoothstep(0, .03, abs(r.sub(front)))).mul(step(reveal, .999)).mul(1.4);
	const radialIn = step(float(1).sub(front), r);
	const radialInPen = oneMinus$1(smoothstep(0, .03, abs(r.sub(float(1).sub(front))))).mul(step(reveal, .999)).mul(1.4);
	const m0 = step(mode, .5);
	const m1 = step(.5, mode).mul(step(mode, 1.5));
	const m2 = step(1.5, mode);
	return shape.mul(angular.mul(m0).add(radialOut.mul(m1)).add(radialIn.mul(m2))).add(angularPen.mul(m0)).add(radialOutPen.mul(m1)).add(radialInPen.mul(m2));
}
//#endregion
//#region src/runtime/shapes.ts
var TAU = Math.PI * 2;
var latheGeometry = new THREE.PlaneGeometry(1, 1, 72, 40);
function latheUniforms() {
	return {
		mode: uniform(0),
		r0: uniform(1),
		r1: uniform(1),
		curve: uniform(1),
		bulge: uniform(0),
		height: uniform(1),
		a0: uniform(0),
		span: uniform(TAU),
		t0: uniform(-Math.PI / 2),
		t1: uniform(Math.PI / 2),
		twist: uniform(0),
		spin: uniform(0),
		flow: uniform(0),
		tilesA: uniform(3),
		tilesV: uniform(2),
		erode: uniform(0),
		edge: uniform(.08),
		rim: uniform(0),
		wobble: uniform(0),
		fadeLo: uniform(.15),
		fadeHi: uniform(.3),
		streak: uniform(.5),
		bendX: uniform(0),
		turn: uniform(0),
		erodeTilt: uniform(0),
		bendZ: uniform(0),
		sway: uniform(0),
		swayF: uniform(2),
		core: uniform(new THREE.Color()),
		main: uniform(new THREE.Color()),
		accent: uniform(new THREE.Color()),
		bright: uniform(1),
		fade: uniform(1),
		time: uniform(0),
		seed: uniform(0)
	};
}
function latheShape(u) {
	const U = uv().x;
	const V = clamp(uv().y, 5e-4, 1);
	const a = u.a0.add(U.mul(u.span));
	const tube = u.mode.lessThan(.5);
	const rT = mix(u.r0, u.r1, pow(V, u.curve)).add(u.bulge.mul(sin(V.mul(Math.PI))));
	const yT = V.mul(u.height);
	const th = mix(u.t0, u.t1, V);
	const rS = cos(th).mul(u.r0);
	const yS = sin(th).mul(u.height);
	const r = select(tube, rT, rS);
	const y = select(tube, yT, yS);
	const wob = mx_noise_float(vec3(cos(a).mul(1.7), sin(a).mul(1.7), V.mul(3).sub(u.time.mul(1.4)).add(u.seed))).mul(u.wobble);
	const rr = max(r.mul(float(1).add(wob)), 0);
	const drdV = u.r1.sub(u.r0).mul(u.curve).mul(pow(V, u.curve.sub(1))).add(u.bulge.mul(Math.PI).mul(cos(V.mul(Math.PI))));
	const nT = vec3(cos(a), drdV.div(max(u.height, .001)).negate(), sin(a));
	const nS = vec3(cos(th).mul(cos(a)), sin(th), cos(th).mul(sin(a)));
	const nLocal = select(tube, nT, nS).normalize();
	const nView = varying(cameraViewMatrix.mul(modelWorldMatrix.mul(vec4(nLocal, 0))).xyz.normalize());
	const bend = V.mul(V);
	const sw = u.sway.mul(V);
	const ph = V.mul(2.4).sub(u.time.mul(u.swayF)).add(u.seed);
	const ox = u.bendX.mul(bend).add(sw.mul(sin(ph)));
	const oz = u.bendZ.mul(bend).add(sw.mul(cos(ph.mul(.8))));
	return {
		position: vec3(cos(a).mul(rr).add(ox), y, sin(a).mul(rr).add(oz)),
		nView
	};
}
function latheFields(u, nView) {
	const U = uv().x;
	const V = uv().y;
	const aF = u.a0.add(U.mul(u.span)).add(u.twist.mul(V)).add(u.time.mul(u.spin)).add(u.turn);
	const along = V.mul(u.tilesV).sub(u.time.mul(u.flow));
	const sa = mix(float(1), float(.1), u.streak);
	const k1 = max(floor(u.tilesA.mul(.5).add(.5)), 1);
	const k2 = max(floor(u.tilesA.mul(.3).add(.5)), 1);
	const a01 = aF.div(TAU);
	const n1 = tnoise(vec2(a01.mul(k1), along.mul(sa).mul(.25)).add(seedShift(u.seed))).r;
	const n2 = tnoise(vec2(a01.mul(k2), along.mul(.15)).add(seedShift(u.seed.add(11)))).g;
	const lo = mix(float(.2), float(.42), u.streak);
	const dens = smoothstep(lo, .95, n1.mul(.75).add(n2.mul(.4)));
	const facing = abs(nView.dot(positionView.normalize().negate()));
	const rimF = float(1).sub(facing).max(0);
	const rimTerm = select(u.rim.greaterThanEqual(0), mix(float(1), rimF.pow(1.5).mul(1.8).add(.05), u.rim), mix(float(1), facing.pow(1.5), u.rim.negate()));
	const ends = smoothstep(0, max(u.fadeLo, .001), V).mul(smoothstep(1, float(1).sub(max(u.fadeHi, .001)), V));
	const ang = select(u.span.lessThan(TAU - .01), smoothstep(0, .12, U).mul(smoothstep(1, .88, U)), float(1));
	const cut = n2.add(n1.mul(.35)).sub(u.erode.mul(1.4)).sub(u.erodeTilt.mul(V.sub(.5)));
	const eroding = u.erode.greaterThan(.001).or(u.erodeTilt.greaterThan(.001));
	const alive = select(eroding, smoothstep(0, .04, cut), float(1));
	const band = select(eroding, alive.mul(float(1).sub(smoothstep(0, max(u.edge, .001), cut))), float(0));
	return {
		dens,
		rimTerm,
		mask: ends.mul(ang).mul(alive),
		band
	};
}
function lathePrim(smoke = false) {
	return () => {
		const u = latheUniforms();
		const m = smoke ? new THREE.MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide
		}) : new THREE.MeshBasicNodeMaterial({
			transparent: true,
			depthWrite: false,
			blending: THREE.AdditiveBlending,
			side: THREE.DoubleSide
		});
		const { position, nView } = latheShape(u);
		m.positionNode = position;
		const { dens, rimTerm, mask, band } = latheFields(u, nView);
		if (smoke) {
			m.colorNode = mix(u.accent, u.main, clamp(dens.mul(1.3), 0, 1)).mul(u.bright).add(u.core.mul(band));
			m.opacityNode = clamp(dens.mul(rimTerm).mul(mask).mul(u.fade).add(band.mul(u.fade)), 0, 1);
		} else m.colorNode = mix(mix(u.accent, u.main, clamp(dens.mul(1.4), 0, 1)), u.core, smoothstep(.7, 1.1, dens.mul(rimTerm))).mul(dens).mul(rimTerm).mul(mask).add(mix(u.main, u.core, .5).mul(band).mul(1.3)).mul(u.bright).mul(u.fade);
		const mesh = new THREE.Mesh(latheGeometry, m);
		mesh.userData.sharedGeometry = true;
		mesh.frustumCulled = false;
		return {
			mesh,
			u
		};
	};
}
function bandMaterial(u) {
	const m = new THREE.MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide
	});
	const q = uv().mul(2).sub(1);
	const d = q.length();
	const ang = atan(q.y, q.x).div(TAU);
	const spanN = clamp(u.span.div(TAU), .001, 1);
	const tt = fract(ang.sub(u.a0.div(TAU))).div(spanN);
	const within = step(tt, 1);
	const angFade = select(spanN.greaterThan(.999), float(1), smoothstep(0, max(u.fadeS, .001), tt).mul(smoothstep(1, float(1).sub(max(u.fadeE, .001)), tt)).mul(within));
	const n = tnoise(vec2(ang.mul(5), d.add(u.k.mul(.5))).add(seedShift(u.seed))).r;
	const x = d.sub(u.inner).div(max(float(1).sub(u.inner), .001)).add(n.sub(.5).mul(.35).mul(u.noise).mul(u.hard));
	const soft = mix(float(.45), float(.03), u.hard);
	const radial = smoothstep(0, soft, x).mul(smoothstep(1, float(1).sub(soft), x));
	const xs = mix(x, floor(x.mul(3)).div(2), u.hard);
	const col = select(xs.lessThan(.5), mix(u.cIn, u.cMid, clamp(xs.mul(2), 0, 1)), mix(u.cMid, u.cOut, clamp(xs.mul(2).sub(1), 0, 1)));
	const streak = mix(float(1), n.mul(1.1).add(.3), u.noise.mul(float(1).sub(u.hard)));
	const fade = pow(float(1).sub(u.k), mix(float(1.5), float(.6), u.hard));
	const hardCut = mix(float(1), step(.35, radial.mul(fade).mul(angFade)), u.hard);
	m.colorNode = col.mul(radial).mul(streak).mul(angFade).mul(fade).mul(hardCut).mul(u.bright).mul(smoothstep(1, .98, d));
	return m;
}
function linesMaterial(u) {
	const m = new THREE.MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
		blending: THREE.AdditiveBlending,
		side: THREE.DoubleSide
	});
	m.depthTest = false;
	const q = uv().mul(2).sub(1);
	const d = q.length();
	const ang = atan(q.y, q.x).div(TAU).add(.5);
	const radialMode = u.mode.lessThan(.5);
	const coord = select(radialMode, ang.mul(u.count), q.y.mul(.5).add(.5).mul(u.count));
	const ci = floor(coord);
	const f = fract(coord);
	const h1 = hash(ci.add(u.seed));
	const h2 = hash(ci.mul(1.71).add(u.seed).add(3.1));
	const h3 = hash(ci.mul(2.37).add(u.seed).add(7.7));
	const present = step(h3, u.density);
	const start = mix(u.inner, float(.92), h1.mul(h1));
	const startK = start.add(float(1).sub(start).mul(u.k));
	const wR = u.width.mul(h2.mul(.8).add(.4)).mul(smoothstep(startK, float(1), d));
	const offset = h2.sub(.5).mul(.5);
	const dxR = abs(f.sub(.5).sub(offset));
	const reachR = mix(start, float(1), u.reach);
	const insideR = step(startK, d).mul(step(d, reachR));
	const lineR = float(1).sub(smoothstep(wR.mul(.7), wR, dxR)).mul(insideR).mul(smoothstep(1, .93, d));
	const len = h2.mul(.8).add(.35);
	const x0 = h1.mul(2.6).sub(1.3).sub(u.k.mul(1.2).mul(h3.add(.6)));
	const along = abs(q.x.sub(x0)).div(len.mul(.5));
	const taper = clamp(float(1).sub(along), 0, 1);
	const wP = u.width.mul(.9).mul(taper).mul(h2.mul(.8).add(.4));
	const lineP = float(1).sub(smoothstep(wP.mul(.6), wP, abs(f.sub(.5)))).mul(step(along, 1)).mul(smoothstep(1, .8, abs(q.x)));
	const line = select(radialMode, lineR, lineP).mul(present);
	const fade = smoothstep(1, .8, u.k);
	m.colorNode = mix(u.main, u.core, select(radialMode, smoothstep(start, float(1), d), taper)).mul(line).mul(fade).mul(u.bright);
	return m;
}
function hitmarkMaterial(u) {
	const m = new THREE.MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
		side: THREE.DoubleSide
	});
	m.depthTest = false;
	const q = uv().mul(2).sub(1);
	const d = q.length();
	const cf = atan(q.y, q.x).div(TAU).add(.5).add(u.seed.mul(.013)).mul(u.spikes);
	const ci = floor(cf);
	const f = fract(cf);
	const dirA = ci.add(.5).div(u.spikes).sub(.5).sub(u.seed.mul(.013)).mul(TAU);
	const len = mix(float(.45), float(1), hash(ci.add(u.seed))).mul(float(1).add(u.boost.mul(pow(abs(cos(dirA)), 6))));
	const tri = float(1).sub(abs(f.mul(2).sub(1)));
	const R = u.inner.mul(len).add(len.mul(float(1).sub(u.inner)).mul(pow(tri, u.sharp)));
	const shape = d.div(max(R, .001));
	const hole = u.hole;
	const aa = max(fwidth(shape).mul(1.5), .004);
	const inside = smoothstep(1, float(1).sub(aa), shape).mul(smoothstep(hole, hole.add(aa), shape));
	const soft = float(1).sub(u.hard);
	const zCore = mix(step(shape, .52), smoothstep(.7, .35, shape), soft);
	const zMid = mix(step(shape, .8), smoothstep(.95, .6, shape), soft);
	const col = mix(u.accent, mix(u.main, u.core, zCore), zMid);
	const fade = step(u.k, .999);
	m.colorNode = col.mul(u.bright);
	m.opacityNode = inside.mul(fade).mul(u.alpha);
	return m;
}
function helixGeometry(geometry, o) {
	const segments = o.segments ?? 96;
	const existing = geometry.getAttribute("position");
	const reuse = existing && existing.count === (segments + 1) * 2;
	const pos = reuse ? existing.array : new Float32Array((segments + 1) * 2 * 3);
	const axis = (o.axis ?? new THREE.Vector3(0, 1, 0)).clone().normalize();
	const e1 = new THREE.Vector3(1, 0, 0);
	if (Math.abs(axis.dot(e1)) > .9) e1.set(0, 0, 1);
	e1.sub(axis.clone().multiplyScalar(axis.dot(e1))).normalize();
	const e2 = axis.clone().cross(e1).normalize();
	const p = new THREE.Vector3();
	const phase = o.phase ?? 0;
	for (let i = 0; i <= segments; i++) {
		const s = i / segments;
		const a = phase + s * o.turns * TAU;
		const r = o.r0 + (o.r1 - o.r0) * s;
		for (let j = 0; j < 2; j++) {
			const h = s * o.height + (j - .5) * o.width;
			p.copy(o.center).addScaledVector(e1, Math.cos(a) * r).addScaledVector(e2, Math.sin(a) * r).addScaledVector(axis, h);
			pos.set([
				p.x,
				p.y,
				p.z
			], (i * 2 + j) * 3);
		}
	}
	if (reuse) {
		existing.needsUpdate = true;
		return;
	}
	const uvs = new Float32Array((segments + 1) * 2 * 2);
	const idx = [];
	for (let i = 0; i <= segments; i++) {
		uvs.set([
			i / segments,
			0,
			i / segments,
			1
		], i * 4);
		if (i < segments) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
	}
	const attr = new THREE.BufferAttribute(pos, 3);
	attr.setUsage(THREE.DynamicDrawUsage);
	geometry.setAttribute("position", attr);
	geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
	geometry.setIndex(idx);
}
//#endregion
//#region src/runtime/prims.ts
var batchSpecs = () => ({
	ring: {
		layout: [
			["k", 1],
			[
				"thick",
				1,
				.08
			],
			["core", 3],
			["main", 3],
			[
				"bright",
				1,
				1
			],
			["seed", 1]
		],
		geometry: quad(),
		build: (u) => ringMaterial(u),
		cap: 256
	},
	decal: {
		layout: [
			["k", 1],
			[
				"heat",
				1,
				1
			],
			["ember", 3],
			["tint", 3],
			["seed", 1],
			[
				"glow",
				1,
				1
			],
			[
				"crackScale",
				1,
				4.5
			],
			[
				"crackWidth",
				1,
				.08
			],
			[
				"alpha",
				1,
				.9
			],
			[
				"core",
				1,
				.6
			]
		],
		geometry: quad(),
		build: (u) => decalMaterial(u),
		cap: 96,
		renderOrder: 0
	},
	crescent: {
		layout: [
			["k", 1],
			["core", 3],
			["main", 3],
			[
				"bright",
				1,
				1
			],
			[
				"bend",
				1,
				.35
			]
		],
		geometry: quad(),
		build: (u) => crescentMaterial(u),
		cap: 64,
		renderOrder: 5
	},
	circle: {
		layout: [
			["turn", 1],
			[
				"reveal",
				1,
				1
			],
			[
				"fade",
				1,
				1
			],
			["core", 3],
			["main", 3],
			["accent", 3],
			[
				"bright",
				1,
				1
			],
			["mode", 1],
			[
				"sidesA",
				1,
				6
			],
			[
				"skipA",
				1,
				1
			],
			["sidesB", 1],
			[
				"skipB",
				1,
				1
			],
			["rotB", 1],
			["spokes", 1],
			["branch", 1],
			["spiral", 1],
			["waves", 1],
			["dots", 1],
			["petals", 1],
			[
				"runes",
				1,
				3
			],
			[
				"ticks",
				1,
				1
			]
		],
		geometry: quad(),
		build: (u) => circleMaterial(u),
		cap: 96
	},
	sphere: {
		layout: [
			["k", 1],
			["core", 3],
			["main", 3],
			["accent", 3],
			[
				"bright",
				1,
				1
			],
			["seed", 1]
		],
		geometry: sphereGeometry(),
		build: (u) => sphereMaterial(u),
		cap: 64
	},
	band: {
		layout: [
			["k", 1],
			["a0", 1],
			[
				"span",
				1,
				Math.PI * 2
			],
			[
				"inner",
				1,
				.6
			],
			[
				"fadeS",
				1,
				.2
			],
			[
				"fadeE",
				1,
				.2
			],
			["hard", 1],
			[
				"noise",
				1,
				1
			],
			["cIn", 3],
			["cMid", 3],
			["cOut", 3],
			[
				"bright",
				1,
				1
			],
			["seed", 1]
		],
		geometry: quad(),
		build: (u) => bandMaterial(u),
		cap: 128
	},
	lines: {
		layout: [
			["k", 1],
			[
				"count",
				1,
				48
			],
			[
				"inner",
				1,
				.35
			],
			[
				"width",
				1,
				.18
			],
			[
				"density",
				1,
				.7
			],
			["mode", 1],
			[
				"reach",
				1,
				1
			],
			["core", 3],
			["main", 3],
			[
				"bright",
				1,
				1
			],
			["seed", 1]
		],
		geometry: quad(),
		build: (u) => linesMaterial(u),
		cap: 32,
		renderOrder: 6
	},
	hitmark: {
		layout: [
			["k", 1],
			[
				"spikes",
				1,
				12
			],
			[
				"inner",
				1,
				.35
			],
			[
				"sharp",
				1,
				1
			],
			[
				"hard",
				1,
				1
			],
			["core", 3],
			["main", 3],
			["accent", 3],
			[
				"bright",
				1,
				1
			],
			["seed", 1],
			[
				"alpha",
				1,
				1
			],
			["boost", 1],
			["hole", 1]
		],
		geometry: quad(),
		build: (u) => hitmarkMaterial(u),
		cap: 32,
		renderOrder: 7
	}
});
var tmpM = new THREE.Matrix4();
var zero = new THREE.Matrix4().makeScale(0, 0, 0);
var Batch = class {
	type;
	spec;
	mesh;
	buffer;
	stride;
	slots = [];
	order = [];
	pinned = [];
	free = [];
	offsets = [];
	constructor(type, spec) {
		this.type = type;
		this.spec = spec;
		let at = 0;
		for (const [name, size, def] of spec.layout) {
			this.offsets.push({
				name,
				size,
				at,
				def: def ?? 0
			});
			at += size;
		}
		const vecs = Math.ceil(at / 4);
		this.stride = vecs * 4;
		const nodes = {};
		this.buffer = new THREE.InstancedInterleavedBuffer(new Float32Array(spec.cap * this.stride), this.stride);
		this.buffer.setUsage(THREE.DynamicDrawUsage);
		const reads = Array.from({ length: vecs }, (_, i) => varying(instancedDynamicBufferAttribute(this.buffer, "vec4", this.stride, i * 4)));
		const comp = (i) => reads[Math.floor(i / 4)][[
			"x",
			"y",
			"z",
			"w"
		][i % 4]];
		for (const o of this.offsets) nodes[o.name] = o.size === 1 ? comp(o.at) : vec3(comp(o.at), comp(o.at + 1), comp(o.at + 2));
		this.mesh = new THREE.InstancedMesh(spec.geometry, spec.build(nodes), spec.cap);
		this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.mesh.frustumCulled = false;
		this.mesh.count = 0;
		if (spec.renderOrder !== void 0) this.mesh.renderOrder = spec.renderOrder;
	}
	acquire() {
		let i = this.free.pop();
		if (i === void 0) {
			if (this.slots.length < this.spec.cap) i = this.slots.length;
			else {
				this.release(this.order[0] ?? this.pinned[0]);
				i = this.free.pop();
			}
		}
		const u = {};
		for (const o of this.offsets) u[o.name] = { value: o.size === 1 ? o.def : new THREE.Color(o.def, o.def, o.def) };
		const prim = {
			mesh: new THREE.Object3D(),
			u
		};
		prim.mesh.userData.type = this.type;
		prim.mesh.userData.slot = i;
		this.slots[i] = prim;
		this.order.push(prim);
		return prim;
	}
	pin(prim) {
		const k = this.order.indexOf(prim);
		if (k < 0) return;
		this.order.splice(k, 1);
		this.pinned.push(prim);
	}
	release(prim) {
		const i = prim.mesh.userData.slot;
		if (this.slots[i] !== prim) return;
		this.slots[i] = null;
		this.free.push(i);
		const k = this.order.indexOf(prim);
		if (k >= 0) this.order.splice(k, 1);
		const p = this.pinned.indexOf(prim);
		if (p >= 0) this.pinned.splice(p, 1);
	}
	sync() {
		let hi = 0;
		for (let i = 0; i < this.slots.length; i++) {
			const prim = this.slots[i];
			if (!prim) {
				this.mesh.setMatrixAt(i, zero);
				continue;
			}
			hi = i + 1;
			const m = prim.mesh;
			if (m.userData.hidden) {
				this.mesh.setMatrixAt(i, zero);
				continue;
			}
			m.updateMatrix();
			this.mesh.setMatrixAt(i, tmpM.copy(m.matrix));
			for (const o of this.offsets) {
				const v = prim.u[o.name].value;
				const base = i * this.stride;
				if (o.size === 1) this.write(base, o.at, v);
				else {
					this.write(base, o.at, v.r);
					this.write(base, o.at + 1, v.g);
					this.write(base, o.at + 2, v.b);
				}
			}
		}
		this.mesh.count = hi;
		this.mesh.instanceMatrix.needsUpdate = true;
		this.buffer.needsUpdate = true;
	}
	write(base, at, v) {
		this.buffer.array[base + at] = v;
	}
	prime(on) {
		if (on) {
			this.mesh.setMatrixAt(0, tmpM.makeTranslation(0, -1e3, 0).scale(new THREE.Vector3(.001, .001, .001)));
			this.mesh.count = Math.max(this.mesh.count, 1);
			this.mesh.instanceMatrix.needsUpdate = true;
		} else this.sync();
	}
	get live() {
		return this.order.length;
	}
	dispose() {
		this.mesh.geometry.dispose();
		this.mesh.material.dispose();
	}
};
var PrimPool = class {
	root;
	factories;
	free = /* @__PURE__ */ new Map();
	created = 0;
	mask = () => false;
	createdBy = {};
	using = /* @__PURE__ */ new Map();
	batches = {};
	constructor(root, factories) {
		this.root = root;
		this.factories = factories;
		for (const [type, spec] of Object.entries(batchSpecs())) {
			const b = new Batch(type, spec);
			this.batches[type] = b;
			root.add(b.mesh);
		}
	}
	sync() {
		for (const b of Object.values(this.batches)) b.sync();
	}
	prime(on) {
		for (const b of Object.values(this.batches)) b.prime(on);
	}
	acquire(type) {
		const hidden = this.mask();
		const batch = this.batches[type];
		if (batch) {
			const prim = batch.acquire();
			prim.mesh.userData.hidden = hidden;
			return prim;
		}
		let prim = this.free.get(type)?.pop();
		if (!prim) {
			prim = this.factories[type]();
			this.created++;
			this.createdBy[type] = (this.createdBy[type] ?? 0) + 1;
		}
		prim.mesh.visible = !hidden;
		prim.mesh.userData.type = type;
		this.root.add(prim.mesh);
		if (!this.using.has(type)) this.using.set(type, /* @__PURE__ */ new Set());
		this.using.get(type).add(prim);
		return prim;
	}
	inUse(type) {
		return this.using.get(type)?.size ?? 0;
	}
	pin(prim) {
		this.batches[prim.mesh.userData.type]?.pin(prim);
	}
	release(prim) {
		const batch = this.batches[prim.mesh.userData.type];
		if (batch) {
			batch.release(prim);
			return;
		}
		prim.mesh.removeFromParent();
		prim.mesh.position.set(0, 0, 0);
		prim.mesh.quaternion.identity();
		prim.mesh.scale.set(1, 1, 1);
		const type = prim.mesh.userData.type;
		if (!this.free.has(type)) this.free.set(type, []);
		const list = this.free.get(type);
		if (list.includes(prim)) return;
		list.push(prim);
		this.using.get(type)?.delete(prim);
	}
	fill(type, n) {
		if (!this.free.has(type)) this.free.set(type, []);
		const list = this.free.get(type);
		const made = [];
		while (list.length + made.length < n) {
			const prim = this.factories[type]();
			prim.mesh.userData.type = type;
			made.push(prim);
		}
		return made;
	}
	dispose() {
		for (const list of this.free.values()) for (const p of list) disposePrim(p);
		this.free.clear();
		for (const b of Object.values(this.batches)) b.dispose();
	}
};
function disposePrim(p) {
	if (!p.mesh.userData.sharedGeometry) p.mesh.geometry.dispose();
	p.mesh.material.dispose();
}
var quad = () => new THREE.PlaneGeometry(2, 2);
var sphereGeometry = () => new THREE.SphereGeometry(1, 40, 24);
var sphereGeo = sphereGeometry();
var additive$1 = () => new THREE.MeshBasicNodeMaterial({
	transparent: true,
	depthWrite: false,
	blending: THREE.AdditiveBlending,
	side: THREE.DoubleSide
});
var shared = (mesh) => {
	mesh.userData.sharedGeometry = true;
	mesh.frustumCulled = false;
	return mesh;
};
function ringMaterial(u) {
	const m = additive$1();
	const q = uv().mul(2).sub(1);
	const d = q.length();
	const r = float(1).sub(pow(float(1).sub(u.k), 3));
	const w = u.thick.mul(float(1).sub(u.k.mul(.6)));
	const x = d.sub(r).div(w);
	const band = exp(x.mul(x).negate()).add(exp(x.mul(x).mul(-.08)).mul(.12).mul(smoothstep(r, r.mul(.3), d)));
	const ang = atan(q.y, q.x);
	const n = tnoise(vec2(ang.div(Math.PI * 2).mul(4), d.mul(.75)).add(seedShift(u.seed))).r;
	const fade = pow(float(1).sub(u.k), 1.5);
	const b = band.mul(n.mul(.9).add(.45)).mul(fade).mul(smoothstep(1, .96, d));
	m.colorNode = mix(u.main, u.core, clamp(b.mul(b).mul(.8), 0, 1)).mul(b).mul(u.bright);
	return m;
}
function decalMaterial(u) {
	const m = new THREE.MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false,
		polygonOffset: true,
		polygonOffsetFactor: -2,
		polygonOffsetUnits: -2
	});
	const q = uv().mul(2).sub(1);
	const d = q.length();
	const n = tnoise(q.mul(.55).add(seedShift(u.seed))).r.mul(2).sub(1);
	const mask = smoothstep(1, .35, d.add(n.mul(.35)));
	const erode = tnoise(q.mul(.775).add(seedShift(u.seed.add(7)))).g;
	const alive = smoothstep(u.k.mul(1.6).sub(.35), u.k.mul(1.6).sub(.2), erode);
	const hot = smoothstep(u.crackWidth, 0, abs(tnoise(q.mul(u.crackScale.mul(.25)).add(seedShift(u.seed.add(3)))).a.mul(2).sub(1))).mul(smoothstep(.95, .1, d)).mul(u.heat).add(smoothstep(.55, 0, d).mul(u.heat).mul(u.heat).mul(u.core));
	m.colorNode = mix(u.tint, u.ember.mul(u.glow), clamp(hot, 0, 1)).add(u.ember.mul(hot).mul(u.glow));
	m.opacityNode = mask.mul(alive).mul(u.alpha);
	return m;
}
function arcPrim() {
	const u = {
		head: uniform(0),
		lag: uniform(.35),
		fade: uniform(1),
		core: uniform(new THREE.Color()),
		main: uniform(new THREE.Color()),
		accent: uniform(new THREE.Color()),
		bright: uniform(1),
		seed: uniform(0),
		time: uniform(0)
	};
	const m = additive$1();
	const s = uv().x;
	const v = uv().y;
	const rel = u.head.sub(s).div(u.lag);
	const inside = smoothstep(-.02, .01, rel).mul(smoothstep(1, .75, rel));
	const trail = pow(clamp(float(1).sub(rel), 0, 1), 1.6);
	const n = tnoise(vec2(s.mul(2.25).sub(u.time.mul(.5)), v.mul(.625)).add(seedShift(u.seed))).r;
	const edgeX = v.sub(.93).div(.035);
	const edge = exp(edgeX.mul(edgeX).negate());
	const body = smoothstep(.05, .92, v).pow(2.2).mul(smoothstep(1, .95, v));
	const streak = smoothstep(.35, .8, n).mul(body);
	const dissolve = smoothstep(rel.sub(.25), rel.add(.05), n.add(.25));
	const glow = body.mul(.7).add(streak.mul(1.1)).mul(dissolve);
	m.colorNode = mix(u.accent, u.main, clamp(glow.mul(1.5), 0, 1)).mul(glow).add(mix(u.main, u.core, trail).mul(edge).mul(1.6).mul(trail.add(.2))).mul(inside).mul(trail.mul(.8).add(.2)).mul(u.fade).mul(u.bright);
	const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
	mesh.frustumCulled = false;
	return {
		mesh,
		u
	};
}
function crescentMaterial(u) {
	const m = additive$1();
	m.depthTest = false;
	const q = uv().mul(2).sub(1);
	const x2 = q.x.mul(q.x);
	const yc = u.bend.mul(float(1).sub(x2)).sub(u.bend.mul(.5));
	const th = float(.1).mul(pow(clamp(float(1).sub(x2), 0, 1), 1.3)).add(.004);
	const y = q.y.sub(yc).div(th);
	const line = exp(y.mul(y).negate());
	const halo = exp(y.mul(y).mul(-.06)).mul(.18).mul(clamp(float(1).sub(x2), 0, 1));
	const fade = smoothstep(1, .55, u.k);
	m.colorNode = mix(u.main, u.core, line).mul(line.mul(1.4).add(halo)).mul(fade).mul(u.bright);
	return m;
}
function ribbonPrim() {
	const u = {
		core: uniform(new THREE.Color()),
		main: uniform(new THREE.Color()),
		accent: uniform(new THREE.Color()),
		bright: uniform(1),
		time: uniform(0),
		seed: uniform(0),
		fade: uniform(1)
	};
	const m = additive$1();
	const s = uv().x;
	const v = uv().y.mul(2).sub(1);
	const n = tnoise(vec2(s.mul(1.5).sub(u.time.mul(1.25)), v.mul(.375)).add(seedShift(u.seed))).r;
	const w = float(1).sub(s.mul(.6));
	const prof = exp(v.mul(v).div(w.mul(w).mul(.25)).negate());
	const core = exp(v.mul(v).div(w.mul(w).mul(.02)).negate()).mul(float(1).sub(s).pow(2));
	const along = pow(float(1).sub(s), 1.4).mul(smoothstep(0, .04, s).mul(.5).add(.5));
	const dens = prof.mul(n.mul(1.2).add(.2)).mul(along);
	m.colorNode = mix(u.accent, u.main, clamp(dens.mul(2), 0, 1)).mul(dens).add(u.core.mul(core).mul(1.2)).mul(u.bright).mul(u.fade);
	const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
	mesh.frustumCulled = false;
	return {
		mesh,
		u
	};
}
function circleMaterial(u) {
	const m = additive$1();
	const shape = patternCircle(uv(), u.turn, u.reveal, u.mode, u);
	const q = uv().mul(2).sub(1);
	m.colorNode = mix(u.accent, u.main, clamp(shape, 0, 1)).mul(shape).add(u.core.mul(smoothstep(.6, 1.4, shape))).mul(u.fade).mul(u.bright).mul(smoothstep(1, .98, q.length()));
	return m;
}
function sphereMaterial(u) {
	const m = additive$1();
	m.side = THREE.FrontSide;
	const fres = float(1).sub(abs(normalView.dot(positionView.normalize().negate()))).max(0);
	const n = tnoise(vec2(uv().x.mul(2), uv().y.mul(.75).add(u.k.mul(.5))).add(seedShift(u.seed))).r;
	const dens = float(1).sub(fres).pow(1.5).mul(n.mul(.8).add(.5)).add(fres.pow(3).mul(.3));
	const fade = pow(float(1).sub(u.k), 2);
	m.colorNode = mix(mix(u.accent, u.main, clamp(dens.mul(1.4), 0, 1)), u.core, smoothstep(.6, 1.1, dens).mul(float(1).sub(u.k))).mul(dens).mul(fade).mul(u.bright);
	return m;
}
function boltPrim() {
	const u = {
		core: uniform(new THREE.Color()),
		main: uniform(new THREE.Color()),
		bright: uniform(1),
		fade: uniform(1)
	};
	const m = additive$1();
	const v = uv().y.mul(2).sub(1);
	const along = uv().x;
	const core = exp(v.mul(v).div(.012).negate());
	const glow = exp(v.mul(v).mul(-3.5)).mul(.35);
	const taper = smoothstep(0, .04, along).mul(smoothstep(1, .9, along).mul(.6).add(.4));
	m.colorNode = mix(u.main, u.core, core).mul(core.mul(2.2).add(glow)).mul(taper).mul(u.bright).mul(u.fade);
	const mesh = new THREE.Mesh(new THREE.BufferGeometry(), m);
	mesh.frustumCulled = false;
	return {
		mesh,
		u
	};
}
var beamGeo = new THREE.CylinderGeometry(1, 1, 1, 32, 1, true).translate(0, .5, 0);
function beamPrim() {
	const u = {
		time: uniform(0),
		len: uniform(1),
		core: uniform(new THREE.Color()),
		main: uniform(new THREE.Color()),
		accent: uniform(new THREE.Color()),
		bright: uniform(1),
		fade: uniform(1),
		flow: uniform(6),
		inner: uniform(0)
	};
	const m = additive$1();
	m.side = THREE.DoubleSide;
	const y = uv().y;
	const edge = float(1).sub(abs(normalView.dot(positionView.normalize().negate()))).max(0);
	const center = float(1).sub(edge);
	const n = tnoise(vec2(uv().x.mul(2), y.mul(u.len).mul(1.4).sub(u.time.mul(u.flow)).mul(.25))).r;
	const n2 = tnoise(vec2(uv().x.mul(4), y.mul(u.len).mul(3).sub(u.time.mul(u.flow).mul(1.7)).mul(.25)).add(.37)).a;
	const ends = smoothstep(0, .04, y).mul(smoothstep(1, .9, y));
	const dens = center.pow(1.4).mul(n.mul(.9).add(n2.mul(.5)).add(.1)).add(edge.pow(4).mul(.15));
	const hot = mix(smoothstep(.55, 1.1, dens), center.pow(6), u.inner);
	m.colorNode = mix(mix(u.accent, u.main, clamp(dens.mul(1.6), 0, 1)), u.core, hot).mul(dens.add(hot)).mul(ends).mul(u.bright).mul(u.fade);
	return {
		mesh: shared(new THREE.Mesh(beamGeo, m)),
		u
	};
}
var shieldGeo = new THREE.SphereGeometry(1, 64, 32);
function shieldPrim() {
	const hits = Array.from({ length: 4 }, () => new THREE.Vector4(0, 1, 0, 9));
	const u = {
		reveal: uniform(1),
		fade: uniform(1),
		time: uniform(0),
		core: uniform(new THREE.Color()),
		main: uniform(new THREE.Color()),
		accent: uniform(new THREE.Color()),
		bright: uniform(1),
		hits: uniformArray(hits, "vec4"),
		hitData: hits
	};
	const m = additive$1();
	m.side = THREE.DoubleSide;
	const p = positionLocal.normalize();
	const edge = float(1).sub(abs(normalView.dot(positionView.normalize().negate()))).max(0);
	const hexEdge = Fn(() => {
		const g = vec2(atan(p.z, p.x).mul(7 / Math.PI), p.y.mul(6));
		const r = vec2(1, 1.732);
		const h = r.mul(.5);
		const a = mod(g, r).sub(h);
		const b = mod(g.sub(h), r).sub(h);
		const c = select(dot(a, a).lessThan(dot(b, b)), a, b);
		const q = abs(c);
		const d = max(dot(q, vec2(.866, .5)), q.y);
		return smoothstep(.4, .49, d);
	})();
	let ripple = float(0);
	for (let i = 0; i < 4; i++) {
		const h = u.hits.element(i);
		const x = dot(p, h.xyz).clamp(-1, 1).acos().sub(h.w.mul(3)).div(.18);
		ripple = ripple.add(exp(x.mul(x).negate()).mul(max(float(1).sub(h.w.mul(1.4)), 0)));
	}
	const shimmer = mx_noise_float(vec3(p.mul(3)).add(vec3(0, u.time.mul(.5), 0))).mul(.5).add(.5);
	const front = smoothstep(u.reveal.mul(2.2).sub(1.1), u.reveal.mul(2.2).sub(1.2), p.y);
	const dens = edge.pow(2.5).mul(.9).add(hexEdge.mul(edge.mul(.7).add(.15)).mul(shimmer.mul(.8).add(.4))).add(ripple.mul(hexEdge.mul(.8).add(.4)));
	const col = mix(mix(u.accent, u.main, clamp(dens, 0, 1)), u.core, clamp(ripple.add(edge.pow(6)), 0, 1));
	const band = exp(p.y.sub(u.reveal.mul(2.2).sub(1.15)).div(.04).pow(2).negate()).mul(step1(u.reveal));
	m.colorNode = col.mul(dens.mul(front).add(band.mul(1.5))).mul(u.bright).mul(u.fade);
	return {
		mesh: shared(new THREE.Mesh(shieldGeo, m)),
		u
	};
}
var step1 = (x) => float(1).sub(smoothstep(.98, 1, x));
function voidPrim() {
	const u = {
		k: uniform(0),
		main: uniform(new THREE.Color()),
		accent: uniform(new THREE.Color()),
		bright: uniform(1),
		time: uniform(0)
	};
	const m = new THREE.MeshBasicNodeMaterial({
		transparent: true,
		depthWrite: false
	});
	const edge = float(1).sub(abs(normalView.dot(positionView.normalize().negate()))).max(0);
	const n = tnoise(vec2(uv().x.mul(3), uv().y.mul(1.2).sub(u.time.mul(.25)))).r;
	const rim = edge.pow(3).mul(n.mul(1.2).add(.4));
	m.colorNode = mix(u.accent.mul(.02), u.main.mul(u.bright), clamp(rim, 0, 1)).add(u.main.mul(rim).mul(u.bright));
	m.opacityNode = mix(float(.97), float(1), rim).mul(float(1).sub(u.k.pow(3)));
	return {
		mesh: shared(new THREE.Mesh(sphereGeo, m)),
		u
	};
}
var PRIM_FACTORIES = {
	arc: arcPrim,
	ribbon: ribbonPrim,
	bolt: boltPrim,
	beam: beamPrim,
	shield: shieldPrim,
	void: voidPrim,
	lathe: lathePrim(false),
	latheSmoke: lathePrim(true),
	helix: arcPrim
};
function stripGeometry(geometry, points, width, camera) {
	const n = points.length;
	let pos = geometry.getAttribute("position");
	if (!pos || pos.count !== n * 2) {
		pos = new THREE.BufferAttribute(new Float32Array(n * 6), 3);
		pos.setUsage(THREE.DynamicDrawUsage);
		const uvs = new Float32Array(n * 4);
		const idx = [];
		for (let i = 0; i < n; i++) {
			uvs.set([
				i / (n - 1),
				0,
				i / (n - 1),
				1
			], i * 4);
			if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
		}
		geometry.setAttribute("position", pos);
		geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
		geometry.setIndex(idx);
	}
	const eye = camera.getWorldPosition(new THREE.Vector3());
	const t = new THREE.Vector3();
	const side = new THREE.Vector3();
	const arr = pos.array;
	for (let i = 0; i < n; i++) {
		const p = points[i];
		t.subVectors(points[Math.min(i + 1, n - 1)], points[Math.max(i - 1, 0)]);
		side.crossVectors(t, eye.clone().sub(p)).normalize().multiplyScalar(width(i) * .5);
		arr.set([
			p.x - side.x,
			p.y - side.y,
			p.z - side.z,
			p.x + side.x,
			p.y + side.y,
			p.z + side.z
		], i * 6);
	}
	pos.needsUpdate = true;
}
function arcGeometry(geometry, pivot, e1, e2, a0, a1, r0, r1, segments = 64) {
	const existing = geometry.getAttribute("position");
	const reuse = existing && existing.count === (segments + 1) * 2;
	const pos = reuse ? existing.array : new Float32Array((segments + 1) * 2 * 3);
	const uvs = new Float32Array((segments + 1) * 2 * 2);
	const idx = [];
	const p = new THREE.Vector3();
	for (let i = 0; i <= segments; i++) {
		const s = i / segments;
		const a = a0 + (a1 - a0) * s;
		const c = Math.cos(a);
		const sn = Math.sin(a);
		for (let j = 0; j < 2; j++) {
			const r = j ? r1 : r0;
			p.copy(pivot).addScaledVector(e1, c * r).addScaledVector(e2, sn * r);
			const k = i * 2 + j;
			pos.set([
				p.x,
				p.y,
				p.z
			], k * 3);
			uvs.set([s, j], k * 2);
		}
		if (i < segments) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
	}
	if (reuse) {
		existing.needsUpdate = true;
		return;
	}
	const attr = new THREE.BufferAttribute(pos, 3);
	attr.setUsage(THREE.DynamicDrawUsage);
	geometry.setAttribute("position", attr);
	geometry.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
	geometry.setIndex(idx);
}
var RibbonTrail = class {
	prim;
	length;
	width;
	points = [];
	pos;
	constructor(prim, length = 28, width = .3) {
		this.prim = prim;
		this.length = length;
		this.width = width;
		const g = prim.mesh.geometry;
		const n = length;
		const existing = g.getAttribute("position");
		if (existing && existing.count === n * 2) {
			this.pos = existing;
			return;
		}
		this.pos = new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3);
		this.pos.setUsage(THREE.DynamicDrawUsage);
		const uvs = new Float32Array(n * 2 * 2);
		const idx = [];
		for (let i = 0; i < n; i++) {
			uvs.set([
				i / (n - 1),
				0,
				i / (n - 1),
				1
			], i * 4);
			if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
		}
		g.setAttribute("position", this.pos);
		g.setAttribute("uv", new THREE.BufferAttribute(uvs, 2));
		g.setIndex(idx);
	}
	push(p) {
		this.points.unshift(p.clone());
		if (this.points.length > this.length) this.points.pop();
	}
	update(camera) {
		const pts = this.points;
		if (pts.length === 0) return;
		const arr = this.pos.array;
		const eye = camera.getWorldPosition(new THREE.Vector3());
		const t = new THREE.Vector3();
		const side = new THREE.Vector3();
		const view = new THREE.Vector3();
		for (let i = 0; i < this.length; i++) {
			const p = pts[Math.min(i, pts.length - 1)];
			const a = pts[Math.max(Math.min(i - 1, pts.length - 1), 0)];
			const b = pts[Math.min(i + 1, pts.length - 1)];
			t.subVectors(a, b);
			if (t.lengthSq() < 1e-10) t.set(1, 0, 0);
			view.subVectors(eye, p);
			side.crossVectors(t, view).normalize().multiplyScalar(this.width * .5);
			arr.set([
				p.x - side.x,
				p.y - side.y,
				p.z - side.z,
				p.x + side.x,
				p.y + side.y,
				p.z + side.z
			], i * 6);
		}
		this.pos.needsUpdate = true;
	}
};
//#endregion
//#region src/runtime/elements.ts
var UP$8 = new THREE.Vector3(0, 1, 0);
var CIRCLES = {
	plain: {
		sidesA: 0,
		skipA: 1,
		dots: 4,
		runes: 0,
		ticks: 1
	},
	fire: {
		sidesA: 3,
		skipA: 1,
		sidesB: 3,
		skipB: 1,
		rotB: Math.PI / 3,
		petals: 6,
		dots: 6,
		runes: 1,
		ticks: 0
	},
	ice: {
		sidesA: 6,
		skipA: 1,
		spokes: 6,
		branch: 1,
		dots: 6,
		runes: 2,
		ticks: 1
	},
	thunder: {
		sidesA: 8,
		skipA: 3,
		spokes: 8,
		waves: 24,
		runes: 1,
		ticks: 1
	},
	wind: {
		sidesA: 0,
		skipA: 1,
		spiral: 3,
		dots: 3,
		runes: 2,
		ticks: 0
	},
	earth: {
		sidesA: 4,
		skipA: 1,
		sidesB: 4,
		skipB: 1,
		rotB: Math.PI / 4,
		dots: 8,
		runes: 3,
		ticks: 1
	},
	water: {
		sidesA: 0,
		skipA: 1,
		waves: 12,
		dots: 12,
		petals: 0,
		runes: 2,
		ticks: 0
	},
	light: {
		sidesA: 12,
		skipA: 5,
		spokes: 24,
		petals: 12,
		runes: 1,
		ticks: 1
	},
	dark: {
		sidesA: 5,
		skipA: 2,
		sidesB: 5,
		skipB: 1,
		rotB: Math.PI / 5,
		spokes: 10,
		dots: 5,
		runes: 3,
		ticks: 0
	},
	poison: {
		sidesA: 7,
		skipA: 3,
		waves: 7,
		dots: 7,
		runes: 1,
		ticks: 0
	},
	arcane: {
		sidesA: 6,
		skipA: 1,
		sidesB: 6,
		skipB: 1,
		rotB: Math.PI / 6,
		dots: 12,
		runes: 3,
		ticks: 1
	}
};
var along = (a) => () => a.prev.clone().lerp(a.head, Math.random());
var back = (a, k) => a.vel.clone().multiplyScalar(-k);
var rate = (a, r) => poisson(r * a.dt * a.density);
function ringPoints(p, n, r, jitter = .3) {
	const out = [];
	const off = Math.random() * Math.PI * 2;
	for (let i = 0; i < n; i++) {
		const a = off + i / n * Math.PI * 2 + (Math.random() - .5) * jitter;
		const rr = r * (.8 + Math.random() * .4);
		out.push(new THREE.Vector3(p.x + Math.cos(a) * rr, p.y, p.z + Math.sin(a) * rr));
	}
	return out;
}
function splash(c, chance) {
	return c.hook({
		floorKill: true,
		onFloor: (p) => {
			if (Math.random() > chance) return;
			c.emit("spark", 4, {
				p,
				v: () => new THREE.Vector3((Math.random() - .5) * 1.6, 1.2 + Math.random() * 1.4, (Math.random() - .5) * 1.6),
				life: [.2, .35],
				size: [.012, .02],
				gravity: 9,
				colors: c.cols("core", "main"),
				bright: 1.4 * c.B,
				fadeIn: 0
			});
			c.band(p.clone().setY(p.y + .01), {
				radius: .18 + Math.random() * .12,
				inner: .72,
				dur: .4,
				noise: 0,
				bright: 1.2
			});
		}
	});
}
function acid(c, chance) {
	return c.hook({
		floorKill: true,
		onFloor: (p) => {
			if (Math.random() > chance) return;
			c.emit("bubble", 2, {
				p: p.clone().setY(p.y + .03),
				jitter: .06,
				v: () => new THREE.Vector3(0, .15, 0),
				life: [.3, .6],
				size: [.03, .06],
				grow: 1.8,
				colors: c.cols("main", "accent"),
				bright: .9 * c.B,
				fadePow: .4
			});
			c.emit("smoke", 1, {
				p: p.clone().setY(p.y + .05),
				v: () => new THREE.Vector3(0, .25, 0),
				life: [.6, 1],
				size: [.1, .16],
				grow: 2,
				colors: [c.pal.smoke.clone().lerp(c.pal.main, .35), c.pal.smoke],
				fadeIn: .1
			});
		}
	});
}
var ELEMENT_FX = {
	plain: {
		sparks: 1.3,
		glare: .75,
		physical: true,
		swirl(c, around, orbit, rate) {
			c.emit("spark", poisson(40 * rate), {
				p: around(.8, .3),
				orbit: orbit(10, 2, .4, 1, 1),
				life: [.15, .3],
				size: [.01, .018],
				stretch: .04,
				colors: c.cols("core", "main"),
				bright: 2.4 * c.B,
				fadeIn: 0
			});
			c.emit("mote", poisson(25 * rate), {
				p: around(1),
				orbit: orbit(6, 1.5, .5, 1.1, 1),
				life: [.5, .9],
				size: [.015, .025],
				colors: c.cols("core", "main"),
				bright: 1.6 * c.B
			});
		},
		burst(c, p, { n, s, sp, vel }) {
			const B = c.B;
			c.emit("spark", n * .7, {
				p,
				jitter: .05 * s,
				v: vel(sp * .6, sp * 1.6),
				life: [.15, .45],
				size: [.01, .022],
				gravity: 9,
				drag: 1.4,
				stretch: .04,
				bounce: .25,
				colors: c.cols("core", "main"),
				bright: 2.8 * B,
				fadeIn: 0
			});
			c.emit("shard", n * .12, {
				p,
				jitter: .08 * s,
				v: vel(sp * .3, sp * .9),
				life: [.4, .8],
				size: [.02 * s, .045 * s],
				gravity: 9,
				drag: 1,
				spin: [-12, 12],
				bounce: .3,
				colors: [
					c.pal.main.clone().multiplyScalar(.8),
					c.pal.accent,
					c.pal.accent
				],
				bright: 1.1 * B,
				fadeIn: 0
			});
			c.smoke(p, n * .06 * s, {
				size: [.22 * s, .4 * s],
				speed: [.6, 1.6],
				gravity: -.2,
				delay: [0, .05]
			});
		},
		trail(c, a) {
			c.emit("spark", rate(a, 60), {
				p: along(a),
				jitter: .03 * a.s,
				v: () => back(a, .05).add(randomDir().multiplyScalar(.8)),
				life: [.08, .2],
				size: [.008, .014],
				gravity: 6,
				stretch: .03,
				colors: c.cols("core", "main"),
				bright: 2.2 * c.B,
				fadeIn: 0
			});
		},
		decal: {
			tint: (c) => (c.pal.smoke ?? c.pal.accent).clone().multiplyScalar(.5),
			ember: "accent",
			glow: 0,
			decay: 2,
			crackScale: 5,
			crackWidth: .05,
			alpha: .7,
			core: 0
		},
		extra(c, p, pw, s) {
			const g = c.ground(p);
			c.dust(g, 1.4 * s);
			c.emitShape("spark", 40 * pw, {
				type: "circle",
				at: g.clone().setY(g.y + .05),
				r: .3 * s
			}, {
				outward: [3, 7],
				v: () => new THREE.Vector3(0, 1.5 + Math.random() * 2, 0),
				life: [.2, .45],
				size: [.01, .02],
				gravity: 9,
				stretch: .04,
				colors: c.cols("core", "main"),
				bright: 2.6 * c.B,
				fadeIn: 0
			});
		}
	},
	fire: {
		sparks: 1,
		swirl(c, around, orbit, rate) {
			c.emit("flame", poisson(55 * rate), {
				p: around(.8, .4),
				orbit: orbit(8, 2.4, .5, 1.1, .9),
				life: [.35, .6],
				size: [.18, .3],
				grow: 1.5,
				colors: c.cols("core", "main", "accent"),
				bright: .9 * c.B,
				fadeIn: .03
			});
			c.emit("mote", poisson(40 * rate), {
				p: around(1),
				orbit: orbit(7, 2, .5, 1.2, 1.1),
				life: [.8, 1.4],
				size: [.02, .035],
				flicker: .6,
				colors: c.cols("core", "main"),
				bright: 2.4 * c.B
			});
		},
		burst(c, p, { n, s, sp, vel }) {
			const B = c.B;
			c.emit("flame", n * .3, {
				p,
				jitter: .12 * s,
				v: vel(sp * .2, sp * .55),
				life: [.4, .8],
				size: [.28 * s, .5 * s],
				grow: 1.8,
				gravity: -2.2,
				drag: 3.6,
				turb: 1,
				curl: 1.6,
				curlScale: 1.5,
				colors: c.cols("core", "main", "accent"),
				bright: 1.7 * B,
				fadeIn: .03,
				fadePow: 1.1
			});
			c.emit("flame", n * .12, {
				p,
				jitter: .2 * s,
				v: vel(sp * .05, sp * .2),
				life: [.5, .9],
				size: [.45 * s, .7 * s],
				grow: 1.5,
				gravity: -1.6,
				drag: 3,
				curl: 1.2,
				curlScale: 1.1,
				colors: c.cols("core", "main", "accent"),
				bright: 1.3 * B,
				fadeIn: .04,
				fadePow: 1.2,
				delay: [0, .06]
			});
			c.emit("mist", n * .12, {
				p,
				jitter: .25 * s,
				v: vel(sp * .1, sp * .3),
				life: [.5, .9],
				size: [.12 * s, .2 * s],
				gravity: -1.5,
				drag: 2,
				curl: 2.4,
				curlScale: 1.8,
				stretch: .14,
				colors: c.cols("main", "accent"),
				bright: 1.4 * B,
				fadeIn: .05
			});
			c.emit("mote", n * .15, {
				p,
				jitter: .2 * s,
				v: vel(sp * .1, sp * .4),
				life: [.8, 1.6],
				size: [.02, .035],
				gravity: -.8,
				drag: 1.5,
				curl: 2.2,
				curlScale: 2,
				flicker: .6,
				colors: c.cols("core", "main"),
				bright: 2.4 * B
			});
			c.smoke(p, n * .12 * s, {
				size: [.35 * s, .6 * s],
				delay: [.08, .25],
				curl: .9,
				curlScale: 1.2,
				dissolve: .6
			});
		},
		trail(c, a) {
			const B = c.B;
			c.emit("flame", rate(a, 110), {
				p: along(a),
				jitter: .07 * a.s,
				v: () => back(a, .06).add(randomDir().multiplyScalar(.6)),
				life: [.3, .55],
				size: [.18 * a.s, .32 * a.s],
				grow: 1.6,
				gravity: -2.4,
				drag: 2.5,
				curl: 1.4,
				curlScale: 1.8,
				colors: c.cols("core", "main", "accent"),
				bright: 1.5 * B,
				fadeIn: .02,
				fadePow: 1.1
			});
			c.emit("mist", rate(a, 35), {
				p: along(a),
				jitter: .08 * a.s,
				v: () => back(a, .08),
				life: [.3, .6],
				size: [.08 * a.s, .14 * a.s],
				gravity: -1.2,
				curl: 2.4,
				curlScale: 2,
				stretch: .14,
				colors: c.cols("main", "accent"),
				bright: 1.3 * B
			});
			c.smoke(along(a)(), rate(a, 26), {
				jitter: .08,
				speed: [.2, .5],
				life: [.8, 1.4],
				size: [.18 * a.s, .3 * a.s],
				delay: [.05, .12],
				curl: .8
			});
		},
		decal: {
			tint: (c) => c.pal.smoke.clone().multiplyScalar(.4),
			ember: "main",
			glow: 2.5,
			decay: 1.6,
			crackScale: 4.5,
			crackWidth: .08,
			alpha: .9,
			core: .6
		},
		extra(c, p, pw, s) {
			const g = c.ground(p);
			c.during(0, .35, (_k, dt) => {
				c.emit("flame", poisson(160 * dt * pw), {
					p: () => g.clone().add(randomDir().multiply(new THREE.Vector3(.5 * s, 0, .5 * s))),
					v: () => new THREE.Vector3((Math.random() - .5) * .6, 2.5 + Math.random() * 2.5, (Math.random() - .5) * .6).multiplyScalar(Math.sqrt(s)),
					life: [.35, .6],
					size: [.25 * s, .4 * s],
					grow: 1.5,
					drag: 2,
					curl: 2,
					curlScale: 1.4,
					colors: c.cols("core", "main", "accent"),
					bright: 1.6 * c.B,
					fadeIn: .03
				});
			});
		}
	},
	ice: {
		sparks: .6,
		swirl(c, around, orbit, rate) {
			c.emit("shard", poisson(40 * rate), {
				p: around(1.2),
				orbit: orbit(7, 1.6, .5, 1.1, 1),
				life: [.8, 1.3],
				size: [.04, .09],
				spin: [-9, 9],
				colors: c.cols("core", "main"),
				bright: 2 * c.B
			});
			c.emit("mist", poisson(30 * rate), {
				p: around(.8),
				orbit: orbit(6, 1.4, .6, 1.2, 1),
				life: [.6, 1],
				size: [.3, .5],
				grow: 1.5,
				colors: c.cols("main", "accent"),
				bright: .6 * c.B,
				fadeIn: .1
			});
		},
		burst(c, p, { n, s, sp, vel }) {
			const B = c.B;
			c.emit("shard", n * .45, {
				p,
				jitter: .1 * s,
				v: vel(sp * .4, sp * 1.2),
				life: [.5, .9],
				size: [.05 * s, .1 * s],
				gravity: 8,
				drag: 1.2,
				stretch: .025,
				bounce: .3,
				colors: c.cols("core", "main", "accent"),
				bright: 2.2 * B,
				fadeIn: 0,
				fadePow: 1.3
			});
			c.emit("mist", n * .15, {
				p,
				jitter: .2 * s,
				v: vel(sp * .05, sp * .25),
				life: [.7, 1.2],
				size: [.4 * s, .7 * s],
				grow: 1.8,
				drag: 2.5,
				colors: c.cols("main", "accent"),
				bright: .8 * B,
				fadeIn: .05
			});
			c.emit("star", n * .08, {
				p,
				jitter: .5 * s,
				v: vel(0, sp * .2),
				life: [.3, .7],
				size: [.12 * s, .22 * s],
				grow: .3,
				drag: 3,
				colors: c.cols("core", "main"),
				bright: 2 * B,
				fadeIn: .05,
				flicker: .4
			});
		},
		trail(c, a) {
			const B = c.B;
			c.emit("mist", rate(a, 50), {
				p: along(a),
				jitter: .06 * a.s,
				v: () => back(a, .05).add(randomDir().multiplyScalar(.3)),
				life: [.4, .7],
				size: [.2 * a.s, .35 * a.s],
				grow: 1.8,
				drag: 2,
				colors: c.cols("main", "accent"),
				bright: .9 * B,
				fadeIn: .03
			});
			c.emit("shard", rate(a, 40), {
				p: along(a),
				jitter: .1 * a.s,
				v: () => back(a, .1).add(randomDir().multiplyScalar(1)),
				life: [.3, .6],
				size: [.03 * a.s, .06 * a.s],
				gravity: 3,
				spin: [-8, 8],
				colors: c.cols("core", "main"),
				bright: 2 * B,
				fadeIn: 0
			});
			c.emit("mote", rate(a, 30), {
				p: along(a),
				jitter: .15 * a.s,
				v: () => randomDir().multiplyScalar(.3),
				life: [.6, 1.1],
				size: [.02, .035],
				gravity: .6,
				turb: 1.5,
				flicker: .5,
				colors: c.cols("core", "main"),
				bright: 2 * B
			});
		},
		decal: {
			tint: (c) => c.pal.main.clone().multiplyScalar(.28),
			ember: "core",
			glow: 1.1,
			decay: .25,
			crackScale: 7,
			crackWidth: .06,
			alpha: .8,
			core: .25
		},
		extra(c, p, pw, s) {
			const g = c.ground(p);
			ringPoints(g, Math.round(7 + 3 * pw), .9 * s).forEach((q, i) => c.after(i * .025, () => c.spike(q, g, (.7 + Math.random() * .6) * s, "crystal", 1.1)));
			c.spike(g, g, 1.3 * s, "crystal", 1.2);
		}
	},
	thunder: {
		sparks: 1.5,
		swirl(c, around, orbit, rate) {
			c.emit("spark", poisson(60 * rate), {
				p: around(.7, .3),
				orbit: orbit(12, 3, .4, 1, 1),
				life: [.15, .35],
				size: [.01, .02],
				stretch: .05,
				colors: c.cols("core", "main"),
				bright: 3.5 * c.B,
				fadeIn: 0
			});
			if (Math.random() < rate * 5) {
				const a = around(.4, 1.5 + Math.random() * 1.5)();
				c.bolt(a, a.clone().add(randomDir().multiplyScalar(.9)), {
					dur: .12,
					width: .08,
					jag: .3
				});
			}
		},
		burst(c, p, { n, s, sp, vel }) {
			const B = c.B;
			c.emit("spark", n * .5, {
				p,
				jitter: .05 * s,
				v: vel(sp, sp * 2.2),
				life: [.12, .3],
				size: [.012 * s, .022 * s],
				drag: 3,
				stretch: .03,
				colors: c.cols("core", "main"),
				bright: 3.5 * B,
				fadeIn: 0,
				fadePow: .8
			});
			for (let i = 0; i < 3 + Math.round(n / 40); i++) c.bolt(p, p.clone().add(randomDir().multiplyScalar((.8 + Math.random() * .8) * s)), {
				dur: .18,
				width: .12 * s,
				jag: .25,
				branches: 1
			});
			c.emit("glow", n * .06, {
				p,
				jitter: .4 * s,
				speed: 0,
				life: [.05, .12],
				size: [.3 * s, .6 * s],
				colors: c.cols("core", "main"),
				bright: 1.4 * B,
				fadeIn: 0,
				delay: [0, .2]
			});
		},
		trail(c, a) {
			const B = c.B;
			if (Math.random() < a.dt * 18) c.bolt(a.head, a.head.clone().add(randomDir().multiplyScalar(.5 * a.s)), {
				dur: .08,
				width: .06 * a.s,
				jag: .3
			});
			c.emit("spark", rate(a, 120), {
				p: along(a),
				jitter: .08 * a.s,
				v: () => randomDir().multiplyScalar(2 + Math.random() * 3),
				life: [.08, .2],
				size: [.01, .018],
				drag: 4,
				stretch: .03,
				colors: c.cols("core", "main"),
				bright: 3 * B,
				fadeIn: 0
			});
			c.emit("glow", rate(a, 40), {
				p: along(a),
				jitter: .1 * a.s,
				speed: 0,
				life: [.05, .1],
				size: [.15 * a.s, .3 * a.s],
				colors: c.cols("main", "accent"),
				bright: 1.2 * B,
				fadeIn: 0
			});
		},
		decal: {
			tint: (c) => c.pal.accent.clone().multiplyScalar(.06),
			ember: "main",
			glow: 3,
			decay: 3,
			crackScale: 6,
			crackWidth: .06,
			alpha: .9,
			core: .3
		},
		extra(c, p, pw, s) {
			const top = p.clone().add(new THREE.Vector3((Math.random() - .5) * 2, 7, (Math.random() - .5) * 2));
			const g = c.ground(p);
			c.bolt(top, g, {
				dur: .3,
				width: .35 * s,
				jag: .12,
				branches: 3,
				flicker: true
			});
			c.after(.07, () => c.bolt(top, g, {
				dur: .2,
				width: .25 * s,
				jag: .14,
				branches: 2
			}));
			c.screenFlash(.15 * pw);
			c.light(g.clone().setY(g.y + 1.5), 5 * pw, .3, 12);
		}
	},
	wind: {
		sparks: .5,
		swirl(c, around, orbit, rate) {
			c.emit("mist", poisson(50 * rate), {
				p: around(.9),
				orbit: orbit(9, 2, .5, 1.1, 1),
				life: [.5, .9],
				size: [.14, .24],
				stretch: .16,
				colors: c.cols("core", "main", "accent"),
				bright: .7 * c.B,
				fadeIn: .05
			});
			c.emit("shard", poisson(20 * rate), {
				p: around(1.4),
				orbit: orbit(6, 1.2, .6, 1.3, 1.1),
				life: [1.2, 1.8],
				size: [.05, .09],
				spin: [-12, 12],
				colors: [
					new THREE.Color(.35, .55, .2),
					new THREE.Color(.25, .4, .12),
					new THREE.Color(.4, .33, .15)
				],
				bright: .9,
				fadeIn: .1
			});
		},
		burst(c, p, { n, s, sp }) {
			const B = c.B;
			c.emit("spark", n * .6, {
				p: () => p.clone().add(randomDir().multiplyScalar(.3 * s)),
				v: () => {
					const r = randomDir().setY(0).normalize();
					return new THREE.Vector3(-r.z, .2 + Math.random() * .4, r.x).multiplyScalar(sp * (.6 + Math.random() * .6)).addScaledVector(r, sp * .3);
				},
				life: [.35, .7],
				size: [.012 * s, .02 * s],
				drag: 1.5,
				swirl: 6,
				center: p,
				curl: 3,
				curlScale: 1.2,
				stretch: .07,
				colors: c.cols("core", "main", "accent"),
				bright: 1.8 * B,
				fadeIn: .05
			});
			c.emit("mist", n * .25, {
				p,
				jitter: .3 * s,
				v: () => randomDir().setY(.2).multiplyScalar(sp * .35),
				life: [.5, .9],
				size: [.18 * s, .3 * s],
				grow: 1.6,
				drag: 2.5,
				swirl: 4,
				center: p,
				curl: 3,
				curlScale: 1.3,
				stretch: .16,
				colors: c.cols("core", "main", "accent"),
				bright: .7 * B,
				fadeIn: .05
			});
		},
		trail(c, a) {
			const B = c.B;
			const dir = a.vel.clone().normalize();
			const side = dir.clone().cross(UP$8).normalize();
			const up = side.clone().cross(dir).normalize();
			const n = rate(a, 140);
			for (let i = 0; i < n; i++) {
				const ang = Math.random() * Math.PI * 2;
				const r = (.12 + Math.random() * .2) * a.s;
				const off = side.clone().multiplyScalar(Math.cos(ang) * r).addScaledVector(up, Math.sin(ang) * r);
				const tan = side.clone().multiplyScalar(-Math.sin(ang)).addScaledVector(up, Math.cos(ang)).multiplyScalar(4 * a.s);
				c.emit("spark", 1, {
					p: along(a)().add(off),
					v: () => tan.clone().addScaledVector(dir, -2),
					life: [.15, .3],
					size: [.01, .016],
					drag: 2,
					stretch: .06,
					curl: 2,
					colors: c.cols("core", "main"),
					bright: 1.6 * B,
					fadeIn: .02
				});
			}
			c.emit("mist", rate(a, 40), {
				p: along(a),
				jitter: .12,
				v: () => back(a, .05),
				life: [.35, .6],
				size: [.1 * a.s, .18 * a.s],
				grow: 1.8,
				curl: 3,
				curlScale: 1.6,
				stretch: .16,
				colors: c.cols("core", "main", "accent"),
				bright: .7 * B
			});
		},
		decal: null,
		extra(c, p, pw, s) {
			const g = c.ground(p);
			c.tornado(g, {
				radius: .85 * s,
				height: 3 * s * Math.sqrt(pw),
				dur: 1.6,
				power: pw
			});
			c.ring(g, 1.6 * s, {
				dur: .45,
				thick: .05,
				delay: 0
			});
			c.ring(g.clone().setY(g.y + .6), 1.2 * s, {
				dur: .4,
				thick: .05,
				delay: .06
			});
			c.during(0, .6, (k, dt) => {
				const around = () => {
					const a = Math.random() * Math.PI * 2;
					const r = (.3 + k * .6) * s;
					return g.clone().add(new THREE.Vector3(Math.cos(a) * r, Math.random() * .3, Math.sin(a) * r));
				};
				c.emit("spark", poisson(200 * dt * pw), {
					p: around,
					v: () => new THREE.Vector3(0, 3 + Math.random() * 2, 0),
					life: [.3, .6],
					size: [.01, .018],
					swirl: 9,
					center: g,
					drag: .5,
					curl: 1.5,
					stretch: .07,
					colors: c.cols("core", "main"),
					bright: 1.6 * c.B
				});
				c.emit("mist", poisson(60 * dt * pw), {
					p: around,
					v: () => new THREE.Vector3(0, 2 + Math.random() * 2, 0),
					life: [.4, .8],
					size: [.15 * s, .25 * s],
					swirl: 7,
					center: g,
					curl: 2.5,
					stretch: .15,
					colors: c.cols("core", "main", "accent"),
					bright: .6 * c.B
				});
			});
		}
	},
	earth: {
		sparks: .5,
		swirl(c, around, orbit, rate) {
			c.emit("shard", poisson(35 * rate), {
				p: around(1.3),
				orbit: orbit(6, 1.3, .6, 1.2, .9),
				life: [1, 1.6],
				size: [.05, .1],
				spin: [-10, 10],
				colors: [
					c.pal.smoke.clone().multiplyScalar(1.8),
					c.pal.smoke,
					c.pal.accent.clone().multiplyScalar(.5)
				],
				bright: .9,
				fadeIn: .1
			});
		},
		burst(c, p, { n, s, sp, vel }) {
			c.rocks(p, Math.round(n * .12), s, vel(sp * .4, sp * .9));
			c.dust(p, s * 1.2);
			c.smoke(p, n * .1, {
				size: [.3 * s, .5 * s],
				speed: [.8, 2],
				gravity: -.3,
				delay: [0, .1]
			});
			c.emit("glow", n * .05, {
				p,
				jitter: .1 * s,
				v: vel(sp * .05, sp * .2),
				life: [.2, .4],
				size: [.25 * s, .4 * s],
				grow: 1.6,
				drag: 3,
				colors: c.cols("main", "accent"),
				bright: 1 * c.B
			});
		},
		trail(c, a) {
			if (Math.random() < a.dt * 12) c.rocks(a.head, 1, a.s * .5, () => back(a, .1).add(randomDir().multiplyScalar(1)));
			c.smoke(along(a)(), rate(a, 30), {
				jitter: .08,
				speed: [.1, .4],
				life: [.6, 1],
				size: [.15 * a.s, .25 * a.s],
				delay: 0
			});
			c.emit("mote", rate(a, 20), {
				p: along(a),
				jitter: .1,
				v: () => randomDir().multiplyScalar(.3),
				life: [.4, .8],
				size: [.02, .03],
				gravity: 2,
				colors: c.cols("main", "accent"),
				bright: 1.4 * c.B
			});
		},
		decal: {
			tint: (c) => c.pal.smoke.clone().multiplyScalar(.55),
			ember: "accent",
			glow: .8,
			decay: .8,
			crackScale: 3.4,
			crackWidth: .11,
			alpha: .95,
			core: .1
		},
		extra(c, p, pw, s) {
			const g = c.ground(p);
			ringPoints(g, Math.round(9 + 4 * pw), .85 * s, .25).forEach((q, i) => c.after(i * .025, () => c.spike(q, g, (.6 + Math.random() * .6) * s, "rock", 1)));
			c.spike(g, g, 1.1 * s, "rock", 1.1);
			c.dust(g, 1.6 * s);
		}
	},
	water: {
		sparks: .3,
		swirl(c, around, orbit, rate) {
			c.emit("spark", poisson(60 * rate), {
				p: around(.9),
				orbit: orbit(9, 2.2, .45, 1.05, 1),
				life: [.5, .9],
				size: [.02, .035],
				stretch: .04,
				colors: c.cols("core", "main"),
				bright: 1.6 * c.B
			});
			c.emit("mist", poisson(45 * rate), {
				p: around(.8),
				orbit: orbit(8, 1.8, .5, 1.1, 1),
				life: [.5, .9],
				size: [.14, .24],
				stretch: .14,
				colors: c.cols("core", "main", "accent"),
				bright: .9 * c.B
			});
			c.emit("bubble", poisson(15 * rate), {
				p: around(.8),
				orbit: orbit(6, 1.5, .5, 1, 1),
				life: [.6, 1],
				size: [.04, .08],
				colors: c.cols("core", "main"),
				bright: 1.3 * c.B
			});
		},
		burst(c, p, { n, s, sp, vel }) {
			const B = c.B;
			c.emit("spark", n * .6, {
				p,
				jitter: .1 * s,
				v: vel(sp * .4, sp * 1.1),
				life: [.7, 1.2],
				size: [.02 * s, .035 * s],
				gravity: 9,
				drag: .8,
				stretch: .03,
				colors: c.cols("core", "main"),
				bright: 1.6 * B,
				fadeIn: 0,
				hook: splash(c, .35)
			});
			c.emit("bubble", n * .15, {
				p,
				jitter: .25 * s,
				v: vel(sp * .05, sp * .3),
				life: [.6, 1.2],
				size: [.05 * s, .1 * s],
				gravity: -.8,
				drag: 2,
				curl: .8,
				colors: c.cols("core", "main"),
				bright: 1.4 * B,
				fadeIn: .05
			});
			c.emit("mist", n * .3, {
				p,
				jitter: .2 * s,
				v: vel(sp * .15, sp * .45),
				life: [.5, .9],
				size: [.12 * s, .22 * s],
				grow: 1.5,
				drag: 2.5,
				curl: 2.6,
				curlScale: 1.6,
				stretch: .14,
				colors: c.cols("core", "main", "accent"),
				bright: .9 * B,
				fadeIn: .03
			});
			c.emit("mist", n * .1, {
				p,
				jitter: .2 * s,
				v: vel(sp * .1, sp * .3),
				life: [.5, .9],
				size: [.35 * s, .6 * s],
				grow: 1.8,
				drag: 3,
				curl: 1,
				colors: c.cols("main", "accent"),
				bright: .6 * B,
				fadeIn: .03
			});
		},
		trail(c, a) {
			const B = c.B;
			c.emit("spark", rate(a, 80), {
				p: along(a),
				jitter: .08 * a.s,
				v: () => back(a, .1).add(randomDir().multiplyScalar(1.2)),
				life: [.3, .5],
				size: [.015, .025],
				gravity: 7,
				stretch: .03,
				colors: c.cols("core", "main"),
				bright: 1.5 * B,
				fadeIn: 0
			});
			c.emit("bubble", rate(a, 30), {
				p: along(a),
				jitter: .12 * a.s,
				v: () => randomDir().multiplyScalar(.3),
				life: [.4, .8],
				size: [.03 * a.s, .06 * a.s],
				gravity: -.5,
				curl: 1,
				colors: c.cols("core", "main"),
				bright: 1.3 * B
			});
			c.emit("mist", rate(a, 70), {
				p: along(a),
				jitter: .06 * a.s,
				v: () => back(a, .06),
				life: [.35, .6],
				size: [.1 * a.s, .18 * a.s],
				grow: 1.5,
				curl: 2.8,
				curlScale: 2,
				stretch: .14,
				colors: c.cols("core", "main", "accent"),
				bright: 1 * B
			});
		},
		decal: {
			tint: (c) => c.pal.accent.clone().multiplyScalar(.3),
			ember: "main",
			glow: .6,
			decay: .5,
			crackScale: 3,
			crackWidth: 0,
			alpha: .6,
			core: .5
		},
		extra(c, p, pw, s) {
			const g = c.ground(p);
			c.emit("spark", 120 * pw * s, {
				p: () => g.clone().add(randomDir().setY(0).multiplyScalar(.4 * s)),
				v: () => coneDir(UP$8, .35).multiplyScalar((4 + Math.random() * 4) * Math.sqrt(s)),
				life: [.6, 1.1],
				size: [.025 * s, .04 * s],
				gravity: 10,
				stretch: .03,
				colors: c.cols("core", "main"),
				bright: 1.6 * c.B,
				fadeIn: 0
			});
			c.during(0, .5, (_k, dt) => {
				c.emit("mist", poisson(90 * dt * pw), {
					p: () => g.clone().add(randomDir().setY(0).multiplyScalar(.5 * s)),
					v: () => new THREE.Vector3(0, 2.5 + Math.random() * 2, 0),
					life: [.5, .8],
					size: [.12 * s, .22 * s],
					swirl: 6,
					center: g,
					curl: 2.5,
					stretch: .15,
					gravity: 3,
					colors: c.cols("core", "main", "accent"),
					bright: .9 * c.B
				});
			});
			c.ring(g, 1.5 * s, {
				dur: .7,
				thick: .04
			});
			c.ring(g, 1 * s, {
				dur: .7,
				thick: .04,
				delay: .15
			});
			c.ring(g, .6 * s, {
				dur: .7,
				thick: .04,
				delay: .3
			});
		}
	},
	light: {
		sparks: .8,
		swirl(c, around, orbit, rate) {
			c.emit("star", poisson(14 * rate), {
				p: around(.9),
				orbit: orbit(7, 2, .5, 1.1, 1),
				life: [.4, .8],
				size: [.1, .18],
				grow: .4,
				colors: c.cols("core", "main"),
				bright: 2 * c.B
			});
			c.emit("mote", poisson(50 * rate), {
				p: around(1),
				orbit: orbit(8, 2.2, .5, 1.1, 1.1),
				life: [.8, 1.3],
				size: [.02, .04],
				flicker: .5,
				colors: c.cols("core", "main"),
				bright: 2.4 * c.B
			});
		},
		burst(c, p, { n, s, sp, vel }) {
			const B = c.B;
			c.emit("star", n * .12, {
				p,
				jitter: .1 * s,
				v: vel(sp * .2, sp * .7),
				life: [.4, .8],
				size: [.12 * s, .25 * s],
				grow: .4,
				drag: 3,
				spin: [-2, 2],
				colors: c.cols("core", "main"),
				bright: 2 * B,
				fadeIn: .02
			});
			c.emit("mote", n * .3, {
				p,
				jitter: .3 * s,
				v: () => vel(sp * .05, sp * .3)().add(new THREE.Vector3(0, 1, 0)),
				life: [.8, 1.6],
				size: [.025, .045],
				drag: 1.5,
				turb: 1,
				flicker: .5,
				colors: c.cols("core", "main"),
				bright: 2.4 * B
			});
		},
		trail(c, a) {
			const B = c.B;
			c.emit("mote", rate(a, 70), {
				p: along(a),
				jitter: .1 * a.s,
				v: () => randomDir().multiplyScalar(.3).add(new THREE.Vector3(0, .4, 0)),
				life: [.5, 1],
				size: [.02, .04],
				drag: 1,
				flicker: .5,
				colors: c.cols("core", "main"),
				bright: 2.2 * B
			});
			c.emit("star", rate(a, 10), {
				p: along(a),
				jitter: .12 * a.s,
				speed: 0,
				life: [.2, .35],
				size: [.1 * a.s, .18 * a.s],
				grow: .2,
				colors: c.cols("core", "main"),
				bright: 2 * B
			});
			c.emit("glow", rate(a, 30), {
				p: along(a),
				jitter: .04,
				speed: 0,
				life: [.15, .3],
				size: [.2 * a.s, .3 * a.s],
				colors: c.cols("main", "accent"),
				bright: .9 * B
			});
		},
		decal: {
			tint: (c) => c.pal.accent.clone().multiplyScalar(.12),
			ember: "core",
			glow: 1.4,
			decay: .8,
			crackScale: 5,
			crackWidth: .035,
			alpha: .6,
			core: 1
		},
		extra(c, p, pw, s) {
			const g = c.ground(p);
			c.beam(() => g.clone().setY(g.y + 9), () => g, {
				radius: .45 * s * Math.sqrt(pw),
				dur: .55,
				fadeIn: .04,
				flow: -10
			});
			c.star(g.clone().setY(g.y + .2), 2.2 * s, .3, 2.2);
			c.circle(g, 1.4 * s, .7, {
				spin: 1.5,
				bright: 1.6,
				slot: "target"
			});
		}
	},
	dark: {
		sparks: .7,
		swirl(c, around, orbit, rate) {
			c.emit("smoke", poisson(35 * rate), {
				p: around(.9),
				orbit: orbit(6, 1.5, .6, 1.2, 1),
				life: [.8, 1.3],
				size: [.3, .5],
				grow: 1.8,
				colors: [c.pal.smoke.clone().multiplyScalar(1.6), c.pal.smoke],
				fadeIn: .15
			});
			c.emit("mote", poisson(40 * rate), {
				p: around(1.2),
				orbit: orbit(8, 1.8, .5, 1, 1),
				life: [.6, 1.1],
				size: [.02, .04],
				colors: c.cols("core", "main"),
				bright: 2.2 * c.B
			});
		},
		glare: .7,
		burst(c, p, { n, s, sp, vel }) {
			const B = c.B;
			c.smoke(p, n * .2, {
				jitter: .2 * s,
				speed: [.8, 2.5],
				v: void 0,
				dir: void 0,
				spread: 1,
				life: [.8, 1.4],
				size: [.3 * s, .55 * s],
				gravity: -.2,
				delay: [0, .1]
			});
			c.emit("mote", n * .3, {
				p: () => p.clone().add(randomDir().multiplyScalar(1.2 * s)),
				center: p,
				attract: 9,
				v: () => new THREE.Vector3(),
				life: [.35, .6],
				size: [.025, .045],
				drag: 3,
				colors: c.cols("core", "main"),
				bright: 2.2 * B,
				fadeIn: .1
			});
			c.emit("glyph", n * .05, {
				p,
				jitter: .3 * s,
				v: vel(sp * .1, sp * .3),
				life: [.5, .9],
				size: [.1 * s, .16 * s],
				drag: 2,
				spin: [-3, 3],
				colors: c.cols("core", "main"),
				bright: 1.6 * B,
				fadeIn: .05
			});
		},
		trail(c, a) {
			const B = c.B;
			c.smoke(along(a)(), rate(a, 45), {
				jitter: .1,
				speed: [.1, .4],
				life: [.6, 1.1],
				size: [.2 * a.s, .35 * a.s],
				delay: 0
			});
			c.emit("mote", rate(a, 50), {
				p: along(a),
				jitter: .15 * a.s,
				v: () => randomDir().multiplyScalar(.4),
				life: [.4, .8],
				size: [.02, .04],
				drag: 1,
				turb: 2,
				flicker: .4,
				colors: c.cols("core", "main"),
				bright: 2.2 * B
			});
		},
		decal: {
			tint: (c) => c.pal.accent.clone().multiplyScalar(.04),
			ember: "main",
			glow: 2.2,
			decay: 1.2,
			crackScale: 5,
			crackWidth: .07,
			alpha: .95,
			core: .4
		},
		extra(c, p, pw, s) {
			c.voidSphere(p, 1.1 * s * Math.sqrt(pw), .7);
			c.after(.55, () => {
				c.ring(p, 1.8 * s, {
					normal: "camera",
					dur: .35,
					thick: .06
				});
				c.emit("spark", 60 * pw, {
					p,
					v: () => randomDir().multiplyScalar(5 + Math.random() * 4),
					life: [.2, .45],
					size: [.012, .022],
					drag: 2.5,
					stretch: .035,
					colors: c.cols("core", "main"),
					bright: 3 * c.B,
					fadeIn: 0
				});
			});
		}
	},
	poison: {
		sparks: .2,
		swirl(c, around, orbit, rate) {
			const sludge = c.pal.smoke;
			c.emit("smoke", poisson(35 * rate), {
				p: around(1),
				orbit: orbit(5, 1.2, .7, 1.3, .9),
				life: [1, 1.5],
				size: [.35, .55],
				grow: 1.8,
				colors: [sludge.clone().lerp(c.pal.main, .3), sludge],
				fadeIn: .15
			});
			c.emit("bubble", poisson(25 * rate), {
				p: around(.9),
				orbit: orbit(7, 1.6, .5, 1.1, 1),
				life: [.5, .9],
				size: [.05, .09],
				colors: c.cols("main", "accent"),
				bright: .9 * c.B
			});
		},
		glare: .4,
		burst(c, p, { n, s, sp, vel }) {
			const B = c.B;
			const sludge = c.pal.smoke;
			c.emit("smoke", n * .3, {
				p,
				jitter: .25 * s,
				v: vel(sp * .15, sp * .45),
				life: [1.1, 1.8],
				size: [.35 * s, .6 * s],
				grow: 2,
				drag: 2.5,
				gravity: .25,
				curl: 1,
				curlScale: 1.2,
				colors: [sludge.clone().lerp(c.pal.main, .35), sludge.clone().lerp(c.pal.accent, .45)],
				fadeIn: .08,
				fadePow: 1.1
			});
			c.emit("spark", n * .4, {
				p,
				v: vel(sp * .3, sp * .9),
				life: [.8, 1.2],
				size: [.022 * s, .035 * s],
				gravity: 9,
				stretch: .05,
				colors: c.cols("core", "main", "accent"),
				bright: 1.1 * B,
				fadeIn: 0,
				hook: acid(c, .4)
			});
			c.emit("mist", n * .2, {
				p,
				jitter: .25 * s,
				v: vel(sp * .05, sp * .25),
				life: [.9, 1.6],
				size: [.4 * s, .7 * s],
				grow: 1.8,
				drag: 2,
				curl: 1.4,
				colors: c.cols("main", "accent"),
				bright: .4 * B,
				fadeIn: .1
			});
			c.emit("bubble", n * .15, {
				p,
				jitter: .3 * s,
				v: vel(sp * .05, sp * .3),
				life: [.3, .7],
				size: [.04 * s, .09 * s],
				grow: 1.8,
				gravity: -.6,
				drag: 2,
				curl: 1,
				colors: c.cols("main", "accent"),
				bright: .9 * B,
				fadeIn: .05,
				fadePow: .4
			});
			c.emit("glyph", 2 + n * .02, {
				p,
				jitter: .35 * s,
				v: () => new THREE.Vector3((Math.random() - .5) * .4, .5 + Math.random() * .6, (Math.random() - .5) * .4),
				life: [.9, 1.5],
				size: [.14 * s, .24 * s],
				grow: 1.3,
				drag: 1,
				curl: .8,
				colors: c.cols("main", "accent"),
				bright: 1 * B,
				fadeIn: .15,
				variant: 1
			});
		},
		trail(c, a) {
			const B = c.B;
			const sludge = c.pal.smoke;
			c.emit("smoke", rate(a, 50), {
				p: along(a),
				jitter: .08 * a.s,
				v: () => back(a, .05),
				life: [.7, 1.2],
				size: [.2 * a.s, .35 * a.s],
				grow: 1.8,
				drag: 2,
				gravity: .3,
				curl: 1,
				colors: [sludge.clone().lerp(c.pal.main, .25), sludge],
				fadeIn: .05
			});
			c.emit("spark", rate(a, 45), {
				p: along(a),
				jitter: .06 * a.s,
				v: () => new THREE.Vector3(0, -.3, 0),
				life: [.6, 1.1],
				size: [.018, .03],
				gravity: 7,
				stretch: .06,
				colors: c.cols("core", "main"),
				bright: 1.1 * B,
				hook: acid(c, .25)
			});
			c.emit("mist", rate(a, 30), {
				p: along(a),
				jitter: .06,
				v: () => back(a, .05),
				life: [.5, .8],
				size: [.22 * a.s, .35 * a.s],
				grow: 1.8,
				curl: 1.5,
				colors: c.cols("main", "accent"),
				bright: .45 * B
			});
			if (Math.random() < a.dt * 4) c.emit("glyph", 1, {
				p: along(a)(),
				speed: .4,
				life: 1,
				size: .14 * a.s,
				curl: .8,
				colors: c.cols("main", "accent"),
				bright: .9 * B,
				fadeIn: .15,
				variant: 1
			});
		},
		decal: {
			tint: (c) => c.pal.smoke.clone().lerp(c.pal.accent, .25).multiplyScalar(1.2),
			ember: "main",
			glow: 1.1,
			decay: .25,
			crackScale: 3.2,
			crackWidth: .03,
			alpha: .92,
			core: .25
		},
		extra(c, p, pw, s) {
			const g = c.ground(p);
			const sludge = c.pal.smoke;
			c.during(.1, 1.4, (_k, dt) => {
				const at = () => g.clone().add(randomDir().multiply(new THREE.Vector3(1 * s, 0, 1 * s))).setY(g.y + .1);
				c.emit("smoke", poisson(28 * dt * pw), {
					p: at,
					v: () => randomDir().setY(.05).multiplyScalar(.4),
					life: [1.2, 2],
					size: [.4 * s, .7 * s],
					grow: 1.6,
					gravity: .1,
					curl: 1.2,
					colors: [sludge.clone().lerp(c.pal.main, .2), sludge],
					fadeIn: .3
				});
				c.emit("mist", poisson(18 * dt * pw), {
					p: at,
					v: () => new THREE.Vector3(0, .2, 0),
					life: [1, 1.6],
					size: [.5 * s, .8 * s],
					grow: 1.5,
					curl: 1.4,
					colors: c.cols("main", "accent"),
					bright: .35 * c.B,
					fadeIn: .3
				});
				c.emit("bubble", poisson(40 * dt * pw), {
					p: at,
					v: () => new THREE.Vector3(0, .15, 0),
					life: [.25, .6],
					size: [.04, .1],
					grow: 2,
					colors: c.cols("main", "accent"),
					bright: .9 * c.B,
					fadePow: .3
				});
				if (Math.random() < dt * 3 * pw) c.emit("glyph", 1, {
					p: at(),
					v: () => new THREE.Vector3(0, .6, 0),
					life: 1.4,
					size: .3 * s,
					grow: 1.4,
					curl: .6,
					colors: c.cols("main", "accent"),
					bright: .8 * c.B,
					fadeIn: .25,
					variant: 1
				});
			});
		}
	},
	arcane: {
		sparks: .7,
		swirl(c, around, orbit, rate) {
			c.emit("glyph", poisson(14 * rate), {
				p: around(1),
				orbit: orbit(6, 1.6, .5, 1.1, 1),
				life: [.7, 1.2],
				size: [.1, .16],
				spin: [-2, 2],
				colors: c.cols("core", "main"),
				bright: 2 * c.B,
				fadeIn: .1
			});
			c.emit("mote", poisson(40 * rate), {
				p: around(1),
				orbit: orbit(8, 2, .5, 1.1, 1),
				life: [.6, 1.1],
				size: [.02, .035],
				colors: c.cols("core", "main"),
				bright: 2 * c.B
			});
		},
		burst(c, p, { n, s, sp, vel }) {
			const B = c.B;
			c.emit("glyph", n * .15, {
				p,
				jitter: .15 * s,
				v: vel(sp * .15, sp * .4),
				life: [.6, 1.1],
				size: [.1 * s, .18 * s],
				drag: 2.5,
				swirl: 3,
				center: p,
				spin: [-2, 2],
				colors: c.cols("core", "main"),
				bright: 2 * B,
				fadeIn: .05
			});
			c.emit("star", n * .06, {
				p,
				jitter: .4 * s,
				speed: 0,
				life: [.25, .5],
				size: [.12 * s, .2 * s],
				grow: .3,
				colors: c.cols("core", "main"),
				bright: 2 * B,
				delay: [0, .2]
			});
			c.emit("glow", n * .1, {
				p,
				jitter: .1 * s,
				v: vel(sp * .1, sp * .3),
				life: [.3, .5],
				size: [.25 * s, .4 * s],
				grow: 1.6,
				drag: 3,
				colors: c.cols("main", "accent"),
				bright: 1.2 * B
			});
		},
		trail(c, a) {
			const B = c.B;
			c.emit("glyph", rate(a, 22), {
				p: along(a),
				jitter: .12 * a.s,
				v: () => randomDir().multiplyScalar(.3),
				life: [.4, .8],
				size: [.07 * a.s, .12 * a.s],
				spin: [-2, 2],
				colors: c.cols("core", "main"),
				bright: 1.8 * B,
				fadeIn: .05
			});
			c.emit("mote", rate(a, 50), {
				p: along(a),
				jitter: .1 * a.s,
				v: () => randomDir().multiplyScalar(.3),
				life: [.4, .8],
				size: [.02, .035],
				turb: 2,
				flicker: .4,
				colors: c.cols("core", "main"),
				bright: 2 * B
			});
			c.emit("glow", rate(a, 30), {
				p: along(a),
				jitter: .05,
				speed: 0,
				life: [.15, .3],
				size: [.2 * a.s, .3 * a.s],
				colors: c.cols("main", "accent"),
				bright: .9 * B
			});
		},
		decal: null,
		extra(c, p, pw, s) {
			const g = c.ground(p);
			c.circle(g, 1.6 * s * Math.sqrt(pw), .9, {
				spin: 2,
				bright: 2,
				slot: "target"
			});
			c.ring(p, 1.2 * s, {
				normal: UP$8,
				dur: .5,
				thick: .05,
				delay: .05
			});
		}
	}
};
function elementFX(name) {
	return ELEMENT_FX[name] ?? ELEMENT_FX.fire;
}
//#endregion
//#region src/runtime/ctx.ts
var ease = {
	outCubic: (t) => 1 - Math.pow(1 - t, 3),
	inOutQuad: (t) => t < .5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2,
	outBack: (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2),
	slash: (t) => 1 - Math.pow(1 - t, 2.2),
	inQuad: (t) => t * t,
	outQuad: (t) => 1 - (1 - t) * (1 - t),
	outQuint: (t) => 1 - Math.pow(1 - t, 5),
	outExpo: (t) => t >= 1 ? 1 : 1 - Math.pow(2, -10 * t),
	inExpo: (t) => t <= 0 ? 0 : Math.pow(2, 10 * t - 10),
	inCubic: (t) => t * t * t,
	inOutCubic: (t) => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2,
	outBackStrong: (t) => 1 + 3.2 * Math.pow(t - 1, 3) + 2.2 * Math.pow(t - 1, 2),
	outElastic: (t) => t <= 0 ? 0 : t >= 1 ? 1 : Math.pow(2, -10 * t) * Math.sin((t * 10 - .75) * (2 * Math.PI / 3)) + 1
};
var clamp01 = (t) => Math.min(Math.max(t, 0), 1);
var span = (k, a, b) => clamp01((k - a) / (b - a));
var UP$7 = new THREE.Vector3(0, 1, 0);
var v3 = () => new THREE.Vector3();
function resolve(a, out = v3()) {
	return a instanceof THREE.Object3D ? a.getWorldPosition(out) : out.copy(a);
}
var Ctx = class {
	fx;
	handle;
	def;
	pal;
	opts;
	power;
	scale;
	B = .55;
	hits = 0;
	constructor(fx, handle, def, pal, opts) {
		this.fx = fx;
		this.handle = handle;
		this.def = def;
		this.pal = pal;
		this.opts = opts;
		this.power = opts.power ?? 1;
		this.scale = opts.scale ?? 1;
	}
	get element() {
		return this.def.element;
	}
	get efx() {
		return elementFX(this.def.element);
	}
	from(out = v3()) {
		return resolve(this.opts.from, out);
	}
	to(out = v3()) {
		return resolve(this.opts.to, out);
	}
	floorOf = null;
	get floor() {
		return this.floorOf ? this.floorOf() : this.opts.floorY ?? this.fx.floorY;
	}
	ground(p) {
		return new THREE.Vector3(p.x, this.floor + .02, p.z);
	}
	heightAboveFloor(p) {
		return p.y - this.floor;
	}
	after(delay, fn) {
		this.fx.scheduler.after(delay, fn, this.handle);
	}
	during(delay, dur, fn, end) {
		this.fx.scheduler.during(delay, dur, fn, end, this.handle);
	}
	hold(range) {
		const held = this.fx.lights.hold(this.pal.main, range);
		let open = true;
		const release = (fade) => {
			if (!open) return;
			open = false;
			held.release(fade);
		};
		this.fx.scheduler.add({
			update: () => open,
			dispose: () => release(.15)
		}, this.handle);
		return {
			set: held.set,
			release
		};
	}
	finish() {
		const sched = this.fx.scheduler;
		sched.add({ update: () => {
			if (!this.handle.playing) return false;
			if (sched.busy(this.handle)) return true;
			this.handle.emit("end");
			return false;
		} });
	}
	part(name) {
		this.fx.scheduler.part = name;
	}
	get hidden() {
		return this.fx.only !== null && this.fx.scheduler.part !== this.fx.only;
	}
	emit(kind, n, o) {
		if (this.hidden) return;
		this.fx.particles[kind].emit(n, {
			floor: this.floor,
			...o
		});
	}
	hook(h) {
		const part = this.fx.scheduler.part;
		const wrap = (fn) => fn && ((p, v) => {
			if (!this.handle.playing) return;
			const outer = this.fx.scheduler.part;
			this.fx.scheduler.part = part;
			fn(p, v);
			this.fx.scheduler.part = outer;
		});
		return {
			...h,
			onDie: wrap(h.onDie),
			onFloor: wrap(h.onFloor)
		};
	}
	emitShape(kind, n, shape, o) {
		const total = Math.round(n);
		const pt = new THREE.Vector3();
		const nrm = new THREE.Vector3();
		const tan = new THREE.Vector3();
		for (let i = 0; i < total; i++) {
			sampleShape(shape, i, total, pt, nrm, tan);
			const base = o.v ? o.v() : o.dir ? coneDir(o.dir, o.spread ?? .3).multiplyScalar(pickRange(o.speed, 0)) : new THREE.Vector3();
			base.addScaledVector(nrm, pickRange(o.outward, 0)).addScaledVector(tan, pickRange(o.tangent, 0));
			const p = pt.clone();
			this.emit(kind, 1, {
				...o,
				p,
				v: () => base.clone()
			});
		}
	}
	homing(o) {
		const head = o.from.clone();
		const prev = o.from.clone();
		const vel = o.v0.clone();
		const want = new THREE.Vector3();
		const maxTime = o.maxTime ?? 4;
		let done = false;
		let elapsed = 0;
		this.fx.scheduler.add({ update: (dt) => {
			if (done) return false;
			const tgt = o.to();
			want.subVectors(tgt, head);
			const dist = want.length();
			const t = vel.length();
			const sp = Math.min(o.speed, t + (o.accel ?? o.speed * 2) * dt);
			want.multiplyScalar(sp / Math.max(dist, 1e-5));
			vel.lerp(want, Math.min(o.steer * dt, 1));
			prev.copy(head);
			head.addScaledVector(vel, dt);
			this.handle.head.copy(head);
			o.step?.(head, prev, vel, dt, Math.min(elapsed / maxTime, 1));
			elapsed += dt;
			if (dist < Math.max(vel.length() * dt * 1.5, .12) || elapsed > maxTime) {
				done = true;
				o.arrive(tgt.clone());
				return false;
			}
			return true;
		} }, this.handle);
	}
	cols(...keys) {
		return keys.map((k) => k === "smoke" ? this.pal.smoke ?? this.pal.accent : this.pal[k]);
	}
	get glare() {
		return this.efx.glare ?? 1;
	}
	glow(p, size, life, bright = 1, keys = [
		"core",
		"main",
		"accent"
	]) {
		this.emit("glow", 1, {
			p,
			speed: 0,
			life,
			size,
			grow: 1.1,
			colors: this.cols(...keys),
			bright: bright * this.B * this.glare,
			fadeIn: .01,
			fadePow: 1.6
		});
	}
	star(p, size, life = .16, bright = 3) {
		this.emit("star", 1, {
			p,
			speed: 0,
			life,
			size,
			grow: .6,
			colors: this.cols("core", "main"),
			bright: bright * this.B * this.glare,
			fadeIn: .005,
			fadePow: 1.4,
			spin: 0
		});
	}
	flare(p, size, life = .22) {
		this.emit("flare", 1, {
			p,
			speed: 0,
			life,
			size: size * 1.6,
			grow: 1.3,
			colors: this.cols("core", "main"),
			bright: 2 * this.B * this.glare,
			fadeIn: .005,
			fadePow: 1.3,
			spin: 0
		});
	}
	light(p, intensity, dur, range = 8) {
		this.fx.lights.flash(p, this.pal.main, intensity * 18 * this.glare, dur, range);
	}
	ring(p, radius, o = {}) {
		const dur = o.dur ?? .4;
		this.after(o.delay ?? 0, () => {
			const prim = this.fx.prims.acquire("ring");
			const m = prim.mesh;
			m.position.copy(p);
			m.scale.setScalar(radius);
			prim.u.thick.value = o.thick ?? .08;
			prim.u.core.value.copy(this.pal.core);
			prim.u.main.value.copy(this.pal.main);
			prim.u.bright.value = (o.bright ?? 2.2) * this.B * this.glare;
			prim.u.seed.value = Math.random() * 50;
			prim.u.k.value = 0;
			const normal = o.normal ?? "up";
			const orient = () => {
				if (normal === "camera") m.quaternion.copy(this.fx.camera.quaternion);
				else if (normal === "up") m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), UP$7);
				else m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
			};
			orient();
			this.live(prim, dur, (k) => {
				prim.u.k.value = k;
				if (normal === "camera") orient();
			});
		});
	}
	params = {};
	circleStyle(slot) {
		const key = `circle${slot[0].toUpperCase()}${slot.slice(1)}`;
		return Math.round(this.params[key] ?? 0);
	}
	circle(p, size, dur, o = {}) {
		const style = o.style ?? (o.slot ? this.circleStyle(o.slot) : 1);
		if (style <= 0) return;
		const prim = this.fx.prims.acquire("circle");
		const m = prim.mesh;
		m.position.copy(p);
		prim.u.core.value.copy(this.pal.core);
		prim.u.main.value.copy(this.pal.main);
		prim.u.accent.value.copy(this.pal.accent);
		prim.u.bright.value = (o.bright ?? 1.6) * this.B * (.5 + .5 * this.glare);
		const look = CIRCLES[this.element] ?? CIRCLES.arcane;
		for (const [k, v] of Object.entries({
			sidesB: 0,
			skipB: 1,
			rotB: 0,
			spokes: 0,
			branch: 0,
			spiral: 0,
			waves: 0,
			dots: 0,
			petals: 0,
			runes: 3,
			ticks: 1,
			...look
		})) prim.u[k].value = v;
		prim.u.mode.value = style === 5 ? 1 : style === 6 ? 2 : 0;
		const normal = o.normal ?? "up";
		if (normal === "up") m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), UP$7);
		else if (normal !== "camera") m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
		const spin = o.spin ?? 1;
		const flat = normal === "up";
		const seed = Math.random() * 100;
		let landed = false;
		this.live(prim, dur, (k, age) => {
			if (normal === "camera") m.quaternion.copy(this.fx.camera.quaternion);
			const out = k > .8 ? 1 - (k - .8) / .2 : 1;
			let scale = 1;
			let fade = 1;
			let reveal = 1;
			let turn = age * spin * 1.6;
			m.position.copy(p);
			if (style === 1) {
				scale = .6 + .4 * ease.outBack(Math.min(age / .18, 1));
				reveal = Math.min(age / .3, 1);
			} else if (style === 2) {
				const t = ease.outCubic(Math.min(age / .28, 1));
				scale = 2.6 - 1.6 * t;
				fade = t;
			} else if (style === 3) fade = ease.inOutQuad(Math.min(age / .4, 1));
			else if (style === 4) {
				const t = Math.min(age / .45, 1);
				scale = .3 + .7 * ease.outBack(t);
				turn = spin * (age * 1.6 + 9 * (1 - Math.pow(1 - t, 3)));
				fade = Math.min(age / .1, 1);
			} else if (style === 5 || style === 6) {
				reveal = ease.outCubic(Math.min(age / .35, 1));
				scale = style === 6 ? 1.25 - .25 * reveal : 1;
			} else if (style === 7) {
				const t = Math.min(age / .3, 1);
				fade = t < 1 ? Math.sin(age * 90 + seed) > .1 - t * .9 ? .4 + t * .6 : .05 : 1;
			} else if (style === 8) {
				const t = Math.min(age / .3, 1);
				if (flat) m.position.y = p.y + (1 - ease.inQuad(t)) * 2.2;
				scale = .85 + .15 * ease.outBack(t);
				fade = Math.min(age / .08, 1);
				if (t >= 1 && !landed) {
					landed = true;
					this.ring(p, size * 1.2, {
						dur: .3,
						thick: .05
					});
				}
			}
			m.scale.setScalar(size * scale);
			prim.u.reveal.value = reveal;
			prim.u.turn.value = turn;
			prim.u.fade.value = fade * out * Math.min(age / .03, 1);
		});
	}
	sphere(p, size, dur, bright = 2) {
		const prim = this.fx.prims.acquire("sphere");
		const m = prim.mesh;
		m.position.copy(p);
		prim.u.core.value.copy(this.pal.core);
		prim.u.main.value.copy(this.pal.main);
		prim.u.accent.value.copy(this.pal.accent);
		prim.u.bright.value = bright * this.B * this.glare;
		prim.u.seed.value = Math.random() * 50;
		m.rotation.set(Math.random() * 6, Math.random() * 6, 0);
		this.live(prim, dur, (k) => {
			prim.u.k.value = k;
			m.scale.setScalar(size * (.35 + .65 * ease.outCubic(Math.min(k * 1.6, 1))));
		});
	}
	decal(p, size, life = 4) {
		const style = this.efx.decal;
		if (!style) return;
		const prim = this.fx.prims.acquire("decal");
		const m = prim.mesh;
		m.position.copy(this.ground(p));
		m.position.y += Math.random() * .004;
		m.rotation.set(-Math.PI / 2, 0, Math.random() * Math.PI * 2);
		m.scale.setScalar(size);
		m.renderOrder = 0;
		prim.u.ember.value.copy(this.pal[style.ember]);
		prim.u.glow.value = style.glow * this.B;
		prim.u.seed.value = Math.random() * 50;
		prim.u.tint.value.copy(style.tint(this));
		prim.u.crackScale.value = style.crackScale;
		prim.u.crackWidth.value = style.crackWidth;
		prim.u.alpha.value = style.alpha;
		prim.u.core.value = style.core;
		this.live(prim, life, (k, age) => {
			prim.u.heat.value = Math.exp(-age * style.decay);
			prim.u.k.value = Math.max(k - .5, 0) * 2;
		}, false);
	}
	wave(p, radius, dur = .45, strength = 1) {
		this.fx.post?.wave(p, radius, dur, strength);
	}
	screenFlash(amount) {
		if (!this.fx.post) return;
		this.fx.post.flashTint(this.pal.core);
		this.fx.post.flash = Math.max(this.fx.post.flash, (this.fx.photosensitive ? .25 : .6) * amount * this.glare);
	}
	live(prim, dur, fn, owned = true) {
		let age = 0;
		fn(0, 0);
		this.fx.scheduler.add({
			update: (dt) => {
				age += dt;
				const k = Math.min(age / dur, 1);
				fn(k, age);
				return k < 1;
			},
			dispose: () => this.fx.prims.release(prim)
		}, owned ? this.handle : null);
	}
	dust(p, s = 1) {
		const g = this.ground(p);
		const c = this.efx.glare !== void 0 && this.pal.smoke ? this.pal.smoke.clone().lerp(new THREE.Color(.32, .29, .26), .35) : new THREE.Color(.32, .29, .26);
		this.emit("smoke", 18 * s, {
			p: () => g.clone().add(new THREE.Vector3((Math.random() - .5) * .3, .05, (Math.random() - .5) * .3)),
			v: () => {
				const a = Math.random() * Math.PI * 2;
				const sp = (2 + Math.random() * 2.5) * s;
				return new THREE.Vector3(Math.cos(a) * sp, .25 + Math.random() * .5, Math.sin(a) * sp);
			},
			life: [.7, 1.3],
			size: [.18 * s, .3 * s],
			grow: 2.8,
			drag: 3.2,
			colors: [c, c.clone().multiplyScalar(.7)],
			bright: 1,
			fadeIn: .05,
			fadePow: 1.2
		});
	}
	smoke(p, n, o = {}) {
		const c = this.pal.smoke ?? new THREE.Color(.1, .1, .12);
		this.emit("smoke", n, {
			p,
			jitter: .2,
			dir: UP$7,
			spread: .6,
			speed: [.5, 1.5],
			life: [1.1, 2],
			size: [.3, .5],
			grow: 2.4,
			drag: 1.5,
			gravity: -.6,
			turb: 1.2,
			colors: [c.clone().multiplyScalar(1.6), c],
			fadeIn: .15,
			fadePow: 1.3,
			delay: [.05, .2],
			...o
		});
	}
	burst(p, o = {}) {
		const s = (o.scale ?? 1) * this.scale;
		const n = (o.count ?? 60) * s;
		const sp = (o.speed ?? 6) * Math.sqrt(s);
		const dir = o.dir;
		const spread = dir ? o.spread ?? .8 : 1;
		const B = this.B * this.glare;
		const vel = (min, max) => () => {
			return (dir ? coneDir(dir, spread) : randomDir()).multiplyScalar(min + Math.random() * (max - min));
		};
		this.emit("spark", n * .7 * this.efx.sparks, {
			p,
			jitter: .08 * s,
			v: vel(sp * .5, sp * 1.6),
			life: [.3, .75],
			size: [.018 * s, .035 * s],
			gravity: 6,
			drag: 1.8,
			stretch: .035,
			colors: this.cols("core", "main", "accent"),
			bright: 3 * B,
			bounce: .35,
			fadeIn: 0,
			fadePow: 1.2
		});
		this.emit("mote", n * .25, {
			p,
			jitter: .15 * s,
			v: vel(sp * .1, sp * .5),
			life: [.6, 1.4],
			size: [.025 * s, .05 * s],
			gravity: -.4,
			drag: 2.2,
			turb: 2,
			flicker: .6,
			colors: this.cols("core", "main", "accent"),
			bright: 2.5 * B,
			fadeIn: .05
		});
		this.efx.burst(this, p, {
			n,
			sp,
			s,
			vel
		});
	}
	extra(p, pw = 1, s = 1) {
		this.efx.extra(this, p, pw * this.power, s * this.scale);
	}
	trail(head, prev, vel, dt, s = 1, density = 1) {
		if (dt <= 0) return;
		this.efx.trail(this, {
			head,
			prev,
			vel,
			dt,
			s: s * this.scale,
			density
		});
	}
	impact(p, o = {}) {
		const pw = (o.power ?? 1) * this.power;
		const s = (o.scale ?? 1) * this.scale;
		const physical = this.efx.physical === true;
		this.light(p, (physical ? 1.5 : 3) * pw * s, .4);
		this.star(p, 1.5 * s * Math.sqrt(pw), .16);
		if (!physical) this.flare(p, s * pw);
		this.glow(p, (physical ? .6 : 1.1) * s * Math.sqrt(pw), physical ? .18 : .3, 1.6);
		if (!physical) this.sphere(p, .9 * s * Math.sqrt(pw), .45, 1.6);
		this.ring(p, 1.3 * s, {
			normal: o.ringNormal ?? "camera",
			dur: .35,
			thick: .1
		});
		this.wave(p, 1.8 * s * pw, .45, pw);
		const h = this.heightAboveFloor(p);
		if (h < 1.7) {
			this.ring(this.ground(p), 1.8 * s, {
				dur: .5,
				thick: .07
			});
			this.decal(p, (.8 + .4 * pw) * s);
			if (h < .6) this.dust(p, s);
		}
		this.burst(p, {
			count: 70 * pw,
			dir: o.dir,
			spread: o.dir ? .8 : 1,
			scale: o.scale
		});
		if (o.extra) this.efx.extra(this, p, pw, s);
		if (o.hit !== false) this.hit(p, pw * s, o.role, o.push ?? o.dir);
	}
	lastAnime = -1;
	stopUsed = 0;
	stopEnd = -1;
	hit(p, pw, role, push) {
		const now = this.fx.scheduler.time;
		const dir = push ? push.clone() : p.clone().sub(this.from()).setY(0);
		if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
		dir.normalize();
		const r = role ?? (this.hits === 0 ? "first" : "link");
		if ((this.params.anime ?? 0) > 0 && pw >= .75 && r !== "tick" && this.fx.scheduler.time - this.lastAnime > .12) {
			this.lastAnime = this.fx.scheduler.time;
			const dir = p.clone().sub(this.from());
			const near = Math.min(Math.max(dir.length() / 5, .5), 1);
			this.animeHit(p, {
				dir: dir.lengthSq() > 1e-4 ? dir : void 0,
				power: Math.min(Math.max(pw, .6), 1.6),
				scale: (pw < .8 ? .7 : 1) * near
			});
		}
		const full = Math.min(pw >= 1.2 ? .07 + .03 * pw : .04, .12);
		let stop = 0;
		if (r === "final") stop = Math.min(full * 1.2, .14);
		else if (r === "first") stop = full;
		else if (r === "link" && now - this.stopEnd > .25) stop = full * .3;
		if (r !== "final") stop = Math.min(stop, Math.max(.2 - this.stopUsed, 0));
		if (stop > 0) {
			this.stopUsed += stop;
			this.stopEnd = now + stop;
		}
		const big = r === "first" || r === "final";
		const shake = (big ? .3 : r === "link" ? .12 : .06) * pw;
		const e = {
			point: p.clone(),
			power: pw,
			index: this.hits++,
			shake,
			hitStop: stop,
			role: r,
			dir
		};
		this.handle.emit("hit", e);
		if (!this.fx.feel) return;
		this.fx.shake(e.shake);
		if (stop > 0 && this.fx.hitStopScale > 0) this.fx.hitStop(stop * this.fx.hitStopScale);
		const post = this.fx.post;
		if (!post || !big) return;
		post.aberration = Math.max(post.aberration, .5 * pw);
		if (pw >= 1.4) post.zoomAt(p, .3 * pw);
		if (pw >= 1.8 && this.fx.impactFrames && !this.fx.photosensitive) post.impactFrames = .1;
	}
	charge(p, dur, o = {}) {
		const r = (o.radius ?? .9) * this.scale;
		const B = this.B;
		this.handle.emit("cast");
		if (o.ground) this.circle(this.ground(o.ground), 1.3 * this.scale, dur + .45, {
			spin: .6,
			slot: "feet"
		});
		if (o.aim) this.circle(p.clone().addScaledVector(o.aim, .15), .5 * this.scale, dur + .12, {
			normal: o.aim,
			spin: -1.4,
			bright: 2,
			slot: "hand"
		});
		this.ring(p, r * 1.2, {
			normal: "camera",
			dur,
			thick: .05,
			bright: 1.2
		});
		const held = this.hold(5);
		this.during(0, dur, (k, dt) => {
			const n = poisson(90 * (.4 + k) * this.scale * dt);
			this.emitConverge(p, n, r);
			if (Math.random() < dt * 30) this.emit("glow", 1, {
				p,
				speed: 0,
				life: .12,
				size: .25 * this.scale * (.5 + k),
				colors: this.cols("core", "main"),
				bright: (.8 + 1.4 * k) * B,
				fadeIn: .02
			});
			held.set(p, k * 1.5 * 30);
		}, () => {
			held.release(.15);
			this.star(p, .9 * this.scale, .14, 3);
			this.wave(p, .9, .3, .5);
		});
	}
	emitConverge(p, n, r) {
		if (n <= 0) return;
		const hook = this.hook({ seek: {
			target: p,
			speed: 5.5 * Math.sqrt(r),
			steer: 5,
			arrive: .08
		} });
		for (let i = 0; i < n; i++) {
			const out = randomDir();
			const start = p.clone().addScaledVector(out, r * (.8 + Math.random() * .6));
			const swirl = out.clone().cross(UP$7).normalize().multiplyScalar((2.5 + Math.random() * 1.5) * Math.sqrt(r));
			this.emit("spark", 1, {
				p: start,
				v: () => swirl.clone(),
				hook,
				life: .9,
				size: [.012, .022],
				stretch: .06,
				colors: this.cols("core", "main"),
				bright: 2.2 * this.B,
				fadeIn: .08,
				alphaCurve: "hold"
			});
		}
	}
	bolt(a, b, o = {}) {
		const dur = o.dur ?? .2;
		const width = o.width ?? .15;
		const jag = o.jag ?? .18;
		const make = (from, to, w, depth) => {
			let pts = zigzag(from, to, jag);
			if (this.fx.prims.inUse("bolt") >= 64) return pts;
			const prim = this.fx.prims.acquire("bolt");
			prim.u.core.value.copy(this.pal.core);
			prim.u.main.value.copy(this.pal.main);
			prim.u.bright.value = (depth ? 2.2 : 3) * this.B;
			let t = 0;
			const build = () => stripGeometry(prim.mesh.geometry, pts, (i) => w * (1 - i / pts.length * .4), this.fx.camera);
			build();
			this.live(prim, dur, (k, age) => {
				if (age - t > .05) {
					t = age;
					pts = zigzag(from, to, jag);
				}
				build();
				const flick = o.flicker ? Math.sin(age * 90) > -.3 ? 1 : .25 : 1;
				prim.u.fade.value = (k < .6 ? 1 : 1 - (k - .6) / .4) * flick;
			});
			return pts;
		};
		const main = make(a, b, width, 0);
		for (let i = 0; i < (o.branches ?? 0); i++) {
			const at = main[Math.floor(main.length * (.2 + Math.random() * .5))].clone();
			const len = a.distanceTo(b) * (.2 + Math.random() * .25);
			const dir = b.clone().sub(a).normalize().add(randomDir().multiplyScalar(.9)).normalize();
			make(at, at.clone().addScaledVector(dir, len), width * .55, 1);
		}
	}
	beam(from, to, o) {
		const r = (o.radius ?? .3) * this.scale;
		const layers = [this.fx.prims.acquire("beam"), this.fx.prims.acquire("beam")];
		layers.forEach((prim, i) => {
			prim.u.core.value.copy(i ? this.pal.core : this.pal.core);
			prim.u.main.value.copy(this.pal.main);
			prim.u.accent.value.copy(this.pal.accent);
			prim.u.bright.value = (i ? 2.6 : 1.6) * this.B;
			prim.u.inner.value = i;
			prim.u.flow.value = o.flow ?? 8;
		});
		const fi = o.fadeIn ?? .1;
		const fo = o.fadeOut ?? .25;
		const up = new THREE.Vector3(0, 1, 0);
		layers.forEach((prim, i) => this.live(prim, o.dur, (_k, age) => {
			const a = from();
			const d = to().clone().sub(a);
			const len = Math.max(d.length(), .01);
			prim.mesh.position.copy(a);
			prim.mesh.quaternion.setFromUnitVectors(up, d.divideScalar(len));
			const open = Math.min(age / fi, 1);
			const close = Math.min(Math.max((o.dur - age) / fo, 0), 1);
			const pulse = 1 + .08 * Math.sin(age * 50);
			const w = r * (i ? .42 : 1) * ease.outCubic(open) * (.3 + .7 * close) * pulse;
			prim.mesh.scale.set(w, len, w);
			prim.u.len.value = len;
			prim.u.time.value = age;
			prim.u.fade.value = close;
		}));
	}
	voidSphere(p, size, dur) {
		const prim = this.fx.prims.acquire("void");
		prim.u.main.value.copy(this.pal.main);
		prim.u.accent.value.copy(this.pal.accent);
		prim.u.bright.value = 3 * this.B;
		prim.mesh.position.copy(p);
		prim.mesh.renderOrder = 3;
		this.live(prim, dur, (k, age) => {
			prim.u.k.value = k;
			prim.u.time.value = age;
			const grow = ease.outBack(Math.min(k / .25, 1));
			const collapse = k > .75 ? 1 - ease.inQuad((k - .75) / .25) : 1;
			prim.mesh.scale.setScalar(Math.max(size * grow * collapse, .001));
		});
	}
	rocks(p, n, s, vel) {
		const base = this.element === "earth" ? this.pal.main.clone().lerp(new THREE.Color(.35, .3, .26), .6).multiplyScalar(.32) : new THREE.Color(.16, .15, .14);
		for (let i = 0; i < n; i++) {
			const size = (.06 + Math.random() * .12) * s;
			this.fx.rocks.spawn({
				p: p.clone().add(randomDir().multiplyScalar(.15 * s)),
				v: vel(),
				size: new THREE.Vector3(size, size * (.7 + Math.random() * .5), size),
				spin: 6 + Math.random() * 10,
				life: 1.6 + Math.random() * 1.2,
				gravity: 12,
				bounce: .35,
				color: base.clone().multiplyScalar(.8 + Math.random() * .4),
				onLand: (q, speed) => {
					if (speed > 4) this.emit("smoke", 2, {
						p: q.clone(),
						v: () => randomDir().setY(.3).multiplyScalar(.6),
						life: [.4, .7],
						size: [.08, .14],
						grow: 2.2,
						drag: 3,
						colors: [new THREE.Color(.3, .27, .24)],
						fadeIn: .03
					});
				}
			});
		}
	}
	spike(p, center, h, kind, hold = 1) {
		const out = p.clone().sub(center).setY(0);
		const outward = out.lengthSq() > 1e-4 ? out.normalize() : randomDir().setY(0).normalize();
		const g = this.ground(p).setY(this.floor - .04);
		const life = .12 + hold + .25;
		const rockCol = this.pal.main.clone().lerp(new THREE.Color(.35, .3, .26), .6).multiplyScalar(.32);
		const iceCol = this.pal.main.clone().lerp(this.pal.core, .3);
		const pieces = kind === "crystal" ? 2 + Math.floor(Math.random() * 3) : 1 + Math.floor(Math.random() * 2);
		const tops = [];
		for (let i = 0; i < pieces; i++) {
			const main = i === 0;
			const hh = h * (main ? 1 : .35 + Math.random() * .35);
			const lean = (main ? .35 : .6 + Math.random() * .5) * (kind === "rock" ? .7 : 1);
			const side = randomDir().setY(0).normalize();
			const axis = outward.clone().multiplyScalar(lean).addScaledVector(side, main ? (Math.random() - .5) * .3 : .5).add(new THREE.Vector3(0, 1, 0)).normalize();
			const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.random() * Math.PI * 2));
			const base = g.clone().addScaledVector(side, main ? 0 : h * (.15 + Math.random() * .2));
			const w = hh * (kind === "rock" ? .55 + Math.random() * .2 : .3 + Math.random() * .15);
			const delay = main ? 0 : .02 + Math.random() * .05;
			this.after(delay, () => {
				if (kind === "crystal") this.fx.crystals.spawn({
					p: base,
					size: new THREE.Vector3(w, hh, w * (.8 + Math.random() * .4)),
					quat: q,
					life: life - delay,
					grow: .1 + Math.random() * .05,
					shrink: .15,
					color: iceCol.clone().offsetHSL(0, 0, (Math.random() - .5) * .12)
				});
				else this.fx.spikes.spawn({
					p: base,
					size: new THREE.Vector3(w, hh, w * (.8 + Math.random() * .4)),
					quat: q,
					life: life - delay,
					grow: .1 + Math.random() * .04,
					shrink: .15,
					color: rockCol.clone().multiplyScalar(.8 + Math.random() * .4)
				});
			});
			tops.push(base.clone().addScaledVector(axis, hh * .6));
		}
		if (kind === "rock") {
			const n = 3 + Math.floor(Math.random() * 3);
			for (let i = 0; i < n; i++) {
				const a = Math.random() * Math.PI * 2;
				const r = h * (.25 + Math.random() * .25);
				const sz = h * (.14 + Math.random() * .14);
				this.fx.rocks.spawn({
					p: g.clone().add(new THREE.Vector3(Math.cos(a) * r, sz * .25, Math.sin(a) * r)),
					size: new THREE.Vector3(sz, sz * .7, sz),
					life,
					grow: .08,
					shrink: .15,
					color: rockCol.clone().multiplyScalar(.7 + Math.random() * .5)
				});
			}
		}
		if (Math.random() < .35) this.dust(g, .3 * h);
		this.after(.12 + hold, () => {
			for (const top of tops) if (kind === "crystal") {
				this.emit("shard", 10 * h, {
					p: top,
					jitter: .2 * h,
					v: () => randomDir().multiplyScalar(2 + Math.random() * 2),
					life: [.35, .6],
					size: [.03, .08],
					gravity: 8,
					stretch: .02,
					bounce: .3,
					colors: this.cols("core", "main"),
					bright: 2 * this.B
				});
				for (let i = 0; i < 3 + Math.floor(Math.random() * 3); i++) {
					const sz = .05 + Math.random() * .1;
					this.fx.crystals.spawn({
						p: top.clone().add(randomDir().multiplyScalar(.15 * h)),
						v: randomDir().setY(Math.random() * 1.5).multiplyScalar(2 + Math.random() * 2),
						size: new THREE.Vector3(sz, sz * (1.5 + Math.random()), sz),
						spin: 8 + Math.random() * 10,
						life: .7 + Math.random() * .6,
						gravity: 11,
						bounce: .3,
						shrink: .3,
						color: iceCol
					});
				}
			} else this.rocks(top, Math.round(3 * h + 2), h * .7, () => randomDir().setY(Math.random() * 2).multiplyScalar(2));
		});
	}
	fly(o) {
		const head = o.from.clone();
		const prev = o.from.clone();
		const vel = new THREE.Vector3();
		const ctrl = new THREE.Vector3();
		const e = o.ease ?? ((t) => t);
		this.during(0, o.dur, (k, dt) => {
			const b = o.to();
			ctrl.copy(o.from).lerp(b, .5);
			if (o.curve) ctrl.add(o.curve);
			const t = e(k);
			const u = 1 - t;
			head.set(0, 0, 0).addScaledVector(o.from, u * u).addScaledVector(ctrl, 2 * u * t).addScaledVector(b, t * t);
			if (dt > 0) vel.subVectors(head, prev).divideScalar(dt);
			this.handle.head.copy(head);
			o.step?.(head, prev, vel, dt, k);
			prev.copy(head);
		}, () => o.arrive(head.clone()));
	}
	ribbon(width) {
		const prim = this.fx.prims.acquire("ribbon");
		prim.u.core.value.copy(this.pal.core);
		prim.u.main.value.copy(this.pal.main);
		prim.u.accent.value.copy(this.pal.accent);
		prim.u.bright.value = 1.2 * this.B;
		prim.u.seed.value = Math.random() * 50;
		prim.u.fade.value = 1;
		const trail = new RibbonTrail(prim, 20, width);
		let released = false;
		let fadeAge = -1;
		let fadeDur = .25;
		this.fx.scheduler.add({
			update: (dt) => {
				prim.u.time.value += dt;
				if (released) {
					fadeAge += dt;
					prim.u.fade.value = Math.max(1 - fadeAge / fadeDur, 0);
					if (trail.points.length > 1) trail.points.pop();
				}
				trail.update(this.fx.camera);
				return !released || fadeAge < fadeDur;
			},
			dispose: () => this.fx.prims.release(prim)
		}, this.handle);
		return {
			trail,
			release: (fade = .25) => {
				released = true;
				fadeAge = 0;
				fadeDur = fade;
			}
		};
	}
	arc(o) {
		const prim = this.fx.prims.acquire("arc");
		arcGeometry(prim.mesh.geometry, o.pivot, o.e1, o.e2, o.a0, o.a1, o.r0, o.r1);
		prim.u.core.value.copy(this.pal.core);
		prim.u.main.value.copy(this.pal.main);
		prim.u.accent.value.copy(this.pal.accent);
		prim.u.bright.value = 3.2 * this.B;
		prim.u.seed.value = Math.random() * 50;
		prim.u.lag.value = o.lag;
		prim.u.fade.value = 1;
		prim.u.time.value = 0;
		const hold = o.hold ?? .12;
		const total = o.dur + hold + o.lag * o.dur;
		if (o.offset) prim.mesh.position.copy(o.offset);
		this.live(prim, total, (_k, age) => {
			prim.u.time.value = age;
			if (o.offset && age <= o.dur) prim.mesh.position.copy(o.offset);
			const k = Math.min(age / o.dur, 1);
			const over = Math.max(age - o.dur, 0);
			prim.u.head.value = o.ease(k) + over / o.dur;
			prim.u.fade.value = 1 - Math.max(over - hold * .5, 0) / (total - o.dur);
		});
	}
	crescent(p, size, screenAngle, o = {}) {
		if (o.from) {
			const cam0 = this.fx.camera;
			const aspect = cam0.aspect ?? 1;
			const flat = (v) => {
				const q = v.clone().project(cam0);
				return new THREE.Vector2(q.x * aspect, q.y);
			};
			let bulge;
			const r = p.clone().sub(o.from);
			const t = o.tangent ? o.tangent.clone().sub(r.clone().multiplyScalar(o.tangent.dot(r) / Math.max(r.lengthSq(), 1e-6))) : null;
			if (t && t.lengthSq() > 1e-6 && r.lengthSq() > 1e-4) {
				const d = .35;
				t.normalize().multiplyScalar(r.length() * Math.sin(d));
				const rc = r.clone().multiplyScalar(Math.cos(d));
				const a = flat(o.from.clone().add(rc).sub(t));
				const b = flat(o.from.clone().add(rc).add(t));
				const mid = flat(p);
				const chord = b.clone().sub(a);
				if (chord.lengthSq() > 1e-8) screenAngle = Math.atan2(chord.y, chord.x);
				bulge = mid.sub(a.add(b).multiplyScalar(.5));
				if (bulge.lengthSq() < 1e-10) bulge = flat(p).sub(flat(o.from));
			} else bulge = flat(p).sub(flat(o.from));
			if (-Math.sin(screenAngle) * bulge.x + Math.cos(screenAngle) * bulge.y < 0) screenAngle += Math.PI;
		}
		const prim = this.fx.prims.acquire("crescent");
		const m = prim.mesh;
		prim.u.core.value.copy(this.pal.core);
		prim.u.main.value.copy(this.pal.main);
		prim.u.bright.value = 3 * this.B;
		prim.u.bend.value = o.bend ?? .3;
		m.renderOrder = 5;
		const cam = this.fx.camera;
		const dir = cam.getWorldPosition(v3()).sub(p).normalize();
		const hold = o.hold ?? .3;
		this.live(prim, hold, (k) => {
			prim.u.k.value = k;
			m.position.copy(p).addScaledVector(dir, .4);
			m.quaternion.copy(cam.quaternion);
			m.rotateZ(screenAngle);
			const pop = k < .08 ? ease.outBack(k / .08) : 1;
			m.scale.set(size * (.6 + .4 * pop) * (1 + k * .15), size * .5 * pop, 1);
		});
	}
	color(k) {
		return k === "smoke" ? this.pal.smoke ?? this.pal.accent : this.pal[k];
	}
	lathe(p, o) {
		this.after(o.delay ?? 0, () => {
			const prim = this.fx.prims.acquire(o.smoke ? "latheSmoke" : "lathe");
			const u = prim.u;
			const m = prim.mesh;
			const profile = o.profile ?? "cylinder";
			const r = o.radius * this.scale;
			const h = o.height * this.scale;
			const set = {
				mode: profile === "dome" || profile === "sphere" ? 1 : 0,
				r0: profile === "funnel" ? r * .18 : r,
				r1: o.top !== void 0 ? o.top * this.scale : profile === "cone" ? r * .04 : profile === "funnel" ? r : r,
				curve: o.curve ?? (profile === "funnel" ? 1.8 : 1),
				bulge: (o.bulge ?? (profile === "vase" ? .35 : 0)) * r,
				height: profile === "sphere" || profile === "dome" ? o.height ? h : r : h,
				a0: o.a0 ?? 0,
				span: o.span ?? Math.PI * 2,
				t0: profile === "dome" ? 0 : -Math.PI / 2,
				t1: Math.PI / 2,
				twist: o.twist ?? 0,
				spin: o.spin ?? 0,
				flow: o.flow ?? 0,
				tilesA: o.tiles?.[0] ?? 3,
				tilesV: o.tiles?.[1] ?? 2,
				streak: o.streak ?? .5,
				rim: o.rim ?? 0,
				wobble: o.wobble ?? 0,
				fadeLo: o.fadeLo ?? (profile === "dome" ? .001 : .15),
				fadeHi: o.fadeHi ?? (profile === "dome" || profile === "sphere" ? .001 : .3),
				edge: o.edge ?? .08,
				bendX: (o.bend?.[0] ?? 0) * this.scale,
				bendZ: (o.bend?.[1] ?? 0) * this.scale,
				sway: (o.sway ?? 0) * this.scale,
				swayF: o.swayF ?? 2,
				seed: o.seed ?? Math.random() * 50,
				time: 0,
				erode: 0,
				turn: Math.random() * Math.PI * 2,
				erodeTilt: 0
			};
			for (const [k, v] of Object.entries(set)) u[k].value = v;
			const [c0, c1, c2] = o.colors ?? [
				"core",
				"main",
				"accent"
			];
			u.core.value.copy(this.color(c0));
			u.main.value.copy(this.color(c1));
			u.accent.value.copy(this.color(c2));
			const bright = (o.bright ?? 1.4) * (o.smoke ? 1 : this.B * this.glare);
			u.bright.value = bright;
			if (o.axis) m.quaternion.setFromUnitVectors(UP$7, o.axis.clone().normalize());
			else m.quaternion.identity();
			m.renderOrder = o.smoke ? 1 : 3;
			let last = 0;
			this.live(prim, o.dur, (k, age) => {
				m.position.copy(o.at ? o.at() : p);
				u.time.value = age;
				if (o.turnRate) u.turn.value += o.turnRate(k) * (age - last);
				last = age;
				u.erodeTilt.value = o.erodeTilt ? o.erodeTilt(k) : 0;
				u.erode.value = o.erode ? o.erode(k) : Math.max(k - .55, 0) / .45;
				u.fade.value = o.fade ? o.fade(k) : Math.min(age / .06, 1);
				const g = o.grow ? o.grow(k) : 1;
				if (Array.isArray(g)) m.scale.set(Math.max(g[0], .001), Math.max(g[1], .001), Math.max(g[0], .001));
				else m.scale.setScalar(Math.max(g, .001));
			});
		});
	}
	helix(o) {
		this.after(o.delay ?? 0, () => {
			const prim = this.fx.prims.acquire("helix");
			const s = this.scale;
			const opts = {
				...o,
				r0: o.r0 * s,
				r1: o.r1 * s,
				height: o.height * s,
				width: o.width * s
			};
			helixGeometry(prim.mesh.geometry, opts);
			prim.u.core.value.copy(this.pal.core);
			prim.u.main.value.copy(this.pal.main);
			prim.u.accent.value.copy(this.pal.accent);
			prim.u.bright.value = (o.bright ?? 2.4) * this.B * this.glare;
			prim.u.seed.value = Math.random() * 50;
			prim.u.lag.value = o.lag ?? .5;
			prim.u.fade.value = 1;
			const e = o.ease ?? ease.outCubic;
			const hold = o.hold ?? .15;
			const lag = o.lag ?? .5;
			const total = o.dur + hold + lag * o.dur;
			const center = o.center.clone();
			this.live(prim, total, (_k, age) => {
				if (o.at) {
					const c = o.at();
					if (!c.equals(center)) {
						center.copy(c);
						helixGeometry(prim.mesh.geometry, {
							...opts,
							center
						});
					}
				}
				prim.u.time.value = age;
				const k = Math.min(age / o.dur, 1);
				const over = Math.max(age - o.dur, 0);
				prim.u.head.value = e(k) + over / o.dur;
				prim.u.fade.value = 1 - Math.max(over - hold * .5, 0) / (total - o.dur);
			});
		});
	}
	band(p, o) {
		const dur = o.dur ?? .45;
		this.after(o.delay ?? 0, () => {
			const prim = this.fx.prims.acquire("band");
			const u = prim.u;
			const m = prim.mesh;
			m.position.copy(p);
			const [c0, c1, c2] = o.colors ?? [
				"core",
				"main",
				"accent"
			];
			u.cIn.value.copy(this.color(c0));
			u.cMid.value.copy(this.color(c1));
			u.cOut.value.copy(this.color(c2));
			u.inner.value = o.inner ?? .6;
			u.span.value = o.span ?? Math.PI * 2;
			u.fadeS.value = o.fadeS ?? .2;
			u.fadeE.value = o.fadeE ?? .2;
			u.hard.value = o.hard ?? 0;
			u.noise.value = o.noise ?? 1;
			u.seed.value = Math.random() * 50;
			u.bright.value = (o.bright ?? 1.8) * this.B * this.glare;
			const normal = o.normal ?? "up";
			const orient = () => {
				if (o.quat) m.quaternion.copy(o.quat);
				else if (normal === "camera") m.quaternion.copy(this.fx.camera.quaternion);
				else if (normal === "up") m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), UP$7);
				else m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize());
			};
			orient();
			const grow = o.grow ?? ((k) => .2 + .8 * ease.outExpo(k));
			this.live(prim, dur, (k, age) => {
				if (normal === "camera" && !o.quat) orient();
				if (o.at) m.position.copy(o.at());
				u.k.value = o.kFn ? o.kFn(k) : k;
				if (o.thick) u.inner.value = 1 - o.thick(k);
				u.a0.value = (o.a0 ?? 0) + (o.spin ?? 0) * age;
				m.scale.setScalar(Math.max(o.radius * this.scale * grow(k), .001));
			});
		});
	}
	screenAngle(p, dir) {
		const cam = this.fx.camera;
		const a = p.clone().project(cam);
		const b = p.clone().add(dir).project(cam);
		return Math.atan2(b.y - a.y, b.x - a.x);
	}
	lines(p, o) {
		const dur = o.dur ?? .34;
		const burst = o.burst ?? .07;
		const hold = o.hold ?? .08;
		this.after(o.delay ?? 0, () => {
			const prim = this.fx.prims.acquire("lines");
			const u = prim.u;
			const m = prim.mesh;
			u.count.value = o.count ?? (o.parallel !== void 0 ? 22 : 64);
			u.inner.value = o.inner ?? .28;
			u.width.value = o.width ?? .2;
			u.density.value = o.density ?? .7;
			u.mode.value = o.parallel !== void 0 ? 1 : 0;
			u.core.value.copy(this.pal.core).lerp(new THREE.Color(1, 1, 1), .5);
			u.main.value.copy(this.pal.main);
			u.seed.value = Math.floor(Math.random() * 500);
			u.bright.value = (o.bright ?? 1.6) * this.B * this.glare;
			const cam = this.fx.camera;
			this.live(prim, dur, (_k, age) => {
				u.reach.value = ease.outExpo(clamp01(age / burst));
				u.k.value = o.parallel !== void 0 ? ease.outCubic(clamp01(age / dur)) : ease.inCubic(span(age, burst + hold * .3, dur));
				m.position.copy(p);
				m.quaternion.copy(cam.quaternion);
				if (o.parallel !== void 0) m.rotateZ(o.parallel);
				m.scale.setScalar(o.size * this.scale * (1 + .08 * ease.outCubic(clamp01(age / dur))));
			});
		});
	}
	hitmark(p, o) {
		const dur = o.dur ?? .3;
		this.after(o.delay ?? 0, () => {
			const prim = this.fx.prims.acquire("hitmark");
			const u = prim.u;
			const m = prim.mesh;
			u.spikes.value = o.spikes ?? 7 + Math.floor(Math.random() * 4);
			u.inner.value = o.inner ?? .36;
			u.sharp.value = o.sharp ?? 1;
			u.hard.value = o.hard ?? 1;
			u.boost.value = o.boost ?? 0;
			const [c0, c1, c2] = o.colors ?? [
				new THREE.Color(1, 1, 1).lerp(this.pal.core, .2),
				this.pal.core.clone().lerp(this.pal.main, .55),
				this.pal.main.clone().lerp(this.pal.accent, .5)
			];
			u.core.value.copy(c0);
			u.main.value.copy(c1);
			u.accent.value.copy(c2);
			const seed0 = Math.floor(Math.random() * 500);
			u.seed.value = seed0;
			u.bright.value = o.bright ?? 1.25;
			u.alpha.value = 1;
			u.hole.value = 0;
			const cam = this.fx.camera;
			const dir = cam.getWorldPosition(v3()).sub(p).normalize();
			const angle = o.angle ?? Math.random() * Math.PI * 2;
			const [sx, sy] = o.stretch ?? [1, 1];
			const size = o.size * this.scale;
			const boil = o.boil ?? 12;
			const holdEnd = Math.min(.13, dur * .45);
			this.live(prim, dur, (k, age) => {
				m.position.copy(p).addScaledVector(dir, .3);
				m.quaternion.copy(cam.quaternion);
				m.rotateZ(angle);
				if (o.line) {
					const len = .25 + .75 * ease.outExpo(clamp01(age / .1)) + .2 * k;
					const wid = 1 - .8 * ease.outCubic(k);
					m.scale.set(Math.max(size * sx * len, .001), Math.max(size * sy * wid, .001), 1);
					u.alpha.value = 1 - ease.inCubic(span(k, .55, 1));
					u.k.value = k;
					return;
				}
				let pop;
				if (age < .05) pop = 1.15 * ease.outExpo(age / .05);
				else if (age < .09) pop = 1.15 - .15 * ease.outCubic((age - .05) / .04);
				else pop = 1 + .15 * ease.outCubic(span(age, holdEnd, dur));
				m.scale.set(Math.max(size * sx * pop, .001), Math.max(size * sy * pop, .001), 1);
				u.hole.value = 1.05 * ease.inCubic(span(age, holdEnd, dur));
				if (boil > 0) u.seed.value = seed0 + Math.floor(age * boil);
				u.k.value = k;
			});
		});
	}
	animeHit(p, o = {}) {
		const pw = (o.power ?? 1) * this.power;
		const s = (o.scale ?? 1) * Math.sqrt(pw);
		const f = 1 / 60;
		const ang = o.dir && o.dir.lengthSq() > 1e-6 ? this.screenAngle(p, o.dir) : (Math.random() - .5) * .8;
		const white = new THREE.Color(1, 1, 1);
		const post = this.fx.post;
		if (post && pw >= 1 && (this.fx.scheduler.time - lastBlink > .4 || this.fx.scheduler.time < lastBlink)) {
			lastBlink = this.fx.scheduler.time;
			post.flashTint(white.clone().lerp(this.pal.core, .3));
			post.blinkAmount = (this.fx.photosensitive ? .04 : .09) * Math.min(pw, 1.4) * this.glare;
			post.blinkT = 2.2 * f;
		}
		this.emit("glow", 1, {
			p,
			speed: 0,
			life: .06,
			size: .8 * s,
			grow: 1.3,
			colors: [white, this.pal.core],
			bright: 3.2 * this.B,
			fadeIn: 0,
			fadePow: 2
		});
		this.hitmark(p, {
			size: 1.5 * s,
			spikes: 7 + Math.floor(Math.random() * 3),
			sharp: 1.9,
			inner: .3,
			boost: 1,
			stretch: [1.45, .8],
			angle: ang,
			dur: .34,
			bright: .85
		});
		this.hitmark(p, {
			size: 1 * s,
			spikes: 5 + Math.floor(Math.random() * 3),
			sharp: 2.4,
			inner: .22,
			angle: ang + Math.PI / 7,
			dur: .26,
			bright: .9,
			delay: f,
			boil: 0,
			colors: [
				white,
				white.clone().lerp(this.pal.core, .5),
				this.pal.main.clone()
			]
		});
		this.hitmark(p, {
			size: 2.6 * s,
			spikes: 2,
			inner: .03,
			sharp: 1,
			line: true,
			stretch: [1.6, .12],
			angle: ang + (Math.random() - .5) * .5,
			dur: .3,
			delay: f,
			boil: 0,
			bright: .9
		});
		this.band(p, {
			radius: 1.9 * s,
			normal: "camera",
			hard: 1,
			noise: 1,
			dur: .36,
			delay: f,
			colors: [
				"core",
				"main",
				"accent"
			],
			grow: (k) => .18 + .64 * ease.outExpo(clamp01(k * 2.5)) + .18 * k,
			thick: (k) => k < .3 ? .06 + .26 * ease.outCubic(k / .3) : .32 * Math.pow(1 - (k - .3) / .7, 1.5) + .015
		});
		this.lines(p, {
			size: 3.4 * s,
			dur: .4,
			delay: f * 2,
			count: 36,
			density: .6,
			inner: .45,
			width: .2
		});
		const dir = o.dir && o.dir.lengthSq() > 1e-6 ? o.dir.clone().normalize() : void 0;
		this.emit("spark", 26 * pw, {
			p,
			v: () => (dir ? coneDir(dir, .45) : randomDir()).multiplyScalar(7 + Math.random() * 9),
			life: [.12, .26],
			size: [.02 * s, .035 * s],
			drag: 5,
			stretch: .05,
			colors: [
				white,
				this.pal.core,
				this.pal.main
			],
			bright: 3 * this.B,
			fadeIn: 0,
			fadePow: .7
		});
		this.emit("shard", 10 * pw, {
			p,
			v: () => (dir ? coneDir(dir, .7) : randomDir()).multiplyScalar(4 + Math.random() * 5),
			life: [.25, .45],
			size: [.05 * s, .1 * s],
			gravity: 9,
			drag: 2.5,
			spin: [-14, 14],
			colors: [
				white,
				this.pal.core,
				this.pal.main
			],
			bright: 2 * this.B,
			fadeIn: 0,
			fadePow: .6
		});
		this.after(f * 4, () => this.smoke(p, 5 * s, {
			jitter: .15 * s,
			speed: [.6, 1.4],
			size: [.22 * s, .35 * s],
			life: [.5, .8],
			delay: 0
		}));
	}
	tornado(g, o) {
		const s = this.scale;
		const R = o.radius;
		const H = o.height;
		const pw = o.power ?? 1;
		const life = o.dur;
		const spinUp = Math.min(.5, life * .3);
		const fall = Math.min(.7, life * .35);
		const pos = g.clone();
		const id = claimAnchor(g);
		const center = anchors[id];
		const ph = Math.random() * Math.PI * 2;
		const travel = o.travel?.clone() ?? new THREE.Vector3();
		this.during(0, life + .3, (_k, dt, age) => {
			if (o.goal) pos.copy(g).lerp(o.goal, ease.inOutCubic(clamp01(age / (o.reach ?? life * .5))));
			else pos.addScaledVector(travel, dt * Math.min(age / spinUp, 1));
			center.set(pos.x + Math.cos(ph + age * 2.2) * .12 * R * s, pos.y, pos.z + Math.sin(ph + age * 2.2) * .12 * R * s);
		});
		this.fx.scheduler.after(life + 3, () => releaseAnchor(id), null);
		const at = () => center;
		const rise = (age) => ease.outExpo(clamp01(age / spinUp));
		const gone = (age) => ease.inOutQuad(span(age, life - fall, life));
		const grow = (k) => {
			const age = k * life;
			return [(.3 + .7 * rise(age)) * (1 + .35 * gone(age)), ease.outCubic(clamp01(age / (spinUp * 1.3)))];
		};
		const turn = (speed) => (k) => speed * (.35 + .65 * ease.inQuad(clamp01(k * life / spinUp)));
		const bend = [(Math.random() - .5) * R * .9, (Math.random() - .5) * R * .9];
		const erode = (k) => .9 * gone(k * life);
		const fade = (k) => Math.min(k * life / .08, 1) * (1 - Math.pow(gone(k * life), 2));
		const tilt = (t) => (k) => t - 1.2 * gone(k * life);
		const base = {
			profile: "funnel",
			at,
			dur: life,
			grow,
			bend,
			sway: .14 * R,
			swayF: 2.6,
			erode,
			fade,
			erodeTilt: tilt(0)
		};
		this.lathe(g, {
			...base,
			radius: .75 * R,
			height: .95 * H,
			twist: 6,
			flow: 1.8,
			tiles: [6, 2],
			streak: .9,
			rim: -.3,
			bright: 1.25,
			turnRate: turn(9)
		});
		this.lathe(g, {
			...base,
			radius: 1.1 * R,
			height: H,
			twist: 5,
			flow: 1.2,
			tiles: [5, 1.6],
			streak: .85,
			rim: .5,
			bright: 1.1,
			turnRate: turn(6.5),
			erodeTilt: tilt(.5),
			wobble: .08
		});
		const dusty = !!this.pal.smoke && [
			"earth",
			"fire",
			"poison",
			"dark"
		].includes(this.element);
		this.lathe(g, {
			...base,
			radius: 1.45 * R,
			height: 1.05 * H,
			twist: 3.5,
			flow: .8,
			tiles: [4, 1.3],
			streak: .75,
			rim: .7,
			bright: dusty ? .9 : .55,
			smoke: dusty,
			colors: dusty ? [
				"main",
				"smoke",
				"smoke"
			] : [
				"main",
				"main",
				"accent"
			],
			turnRate: turn(-4),
			erodeTilt: tilt(.8),
			wobble: .12
		});
		this.lathe(g, {
			profile: "cone",
			at,
			radius: 1.8 * R,
			top: .35 * R,
			height: .14,
			dur: life,
			twist: 3,
			flow: 1.6,
			tiles: [5, 1],
			streak: .6,
			rim: 0,
			fadeLo: .35,
			fadeHi: .35,
			bright: .8,
			grow: (k) => grow(k)[0],
			erode,
			turnRate: turn(5)
		});
		const light = this.hold(7);
		const B = this.B * this.glare;
		const debris = (o.debris ?? 1) * pw;
		const orbit = (w, rise, r0, r1, h, pull = 3) => ({
			w,
			rise,
			r0: r0 * R * s,
			r1: r1 * R * s,
			h: h * H * s,
			pull,
			anchor: id
		});
		const wisp = orbit(10, 2.6 * s, .4, 1.25, 1);
		const leaf = orbit(7, 1.5 * s, .55, 1.45, 1.05);
		const dust = orbit(4.5, .5 * s, .9, 1.6, .35, 2);
		const around = (rr, y = .05) => () => {
			const a = Math.random() * Math.PI * 2;
			const r = rr * R * s * (.7 + Math.random() * .6);
			return center.clone().add(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
		};
		const smokeCol = this.pal.smoke ?? this.pal.accent.clone().multiplyScalar(.4);
		const dustCol = smokeCol.clone().lerp(new THREE.Color(.32, .29, .26), .5);
		this.during(0, life - fall * .5, (_k, dt, age) => {
			const on = rise(age);
			this.emit("spark", poisson(70 * dt * on * debris), {
				p: around(.6, .1),
				orbit: wisp,
				life: [.6, 1.1],
				size: [.012 * s, .022 * s],
				stretch: .06,
				colors: this.cols("core", "main"),
				bright: 2 * B,
				fadeIn: .1
			});
			this.emit("shard", poisson(22 * dt * on * debris), {
				p: around(1.3),
				orbit: leaf,
				life: [1, 1.6],
				size: [.04 * s, .09 * s],
				spin: [-10, 10],
				colors: [
					this.pal.main.clone().lerp(this.pal.accent, .5),
					this.pal.accent,
					smokeCol
				],
				bright: 1.3 * B,
				fadeIn: .1
			});
			this.emit("mote", poisson(30 * dt * on * debris), {
				p: around(1),
				orbit: leaf,
				life: [.8, 1.4],
				size: [.02, .035],
				flicker: .4,
				colors: this.cols("core", "main"),
				bright: 2 * B,
				fadeIn: .1
			});
			this.emit("smoke", poisson(26 * dt * on * debris), {
				p: around(1.2, .1),
				orbit: dust,
				v: () => new THREE.Vector3(0, .2, 0),
				life: [.9, 1.5],
				size: [.3 * s * R, .5 * s * R],
				grow: 2,
				colors: [dustCol, dustCol.clone().multiplyScalar(.7)],
				fadeIn: .15,
				fadePow: 1.2
			});
			this.efx.swirl?.(this, around, orbit, dt * on * debris);
			if (Math.random() < dt * 9 * debris && age < life - fall) this.debrisRock(center, R * s, H * s, () => age >= life - fall * .7 || !this.handle.playing);
			light.set(center.clone().setY(center.y + H * s * .4), 42 * on * (1 - gone(age)));
			if (this.fx.feel) this.fx.shake(dt * .25 * on);
		}, () => light.release(.4));
		return center;
	}
	debrisRock(center, R, H, stop) {
		const size = (.05 + Math.random() * .1) * Math.sqrt(R);
		const low = 1 - size / (.15 * Math.sqrt(R));
		let th = Math.random() * Math.PI * 2;
		let h = .05;
		let r = R * (1.4 + Math.random() * .5);
		const top = H * (.35 + .5 * Math.max(low, .2));
		const w = 5 + Math.random() * 3;
		const prev = new THREE.Vector3();
		const col = this.element === "earth" ? this.pal.main.clone().lerp(new THREE.Color(.35, .3, .26), .6).multiplyScalar(.32) : new THREE.Color(.16, .15, .14);
		this.fx.rocks.spawn({
			p: center.clone(),
			size: new THREE.Vector3(size, size * (.7 + Math.random() * .5), size),
			spin: 8 + Math.random() * 8,
			life: 4,
			gravity: 12,
			bounce: .3,
			shrink: .1,
			color: col.multiplyScalar(.8 + Math.random() * .4),
			drive: (p, v, _age, dt) => {
				if (dt <= 0) return true;
				prev.copy(p);
				const target = R * (.45 + .5 * Math.min(h / top, 1));
				r += (target - r) * Math.min(2 * dt, 1);
				h += (top - h) * Math.min(1.2 * dt, 1);
				th += w * dt * Math.sqrt(R / Math.max(r, .2));
				p.set(center.x + Math.cos(th) * r, center.y + h, center.z + Math.sin(th) * r);
				v.subVectors(p, prev).divideScalar(dt);
				if (!stop()) return true;
				v.add(new THREE.Vector3(Math.cos(th), .6, Math.sin(th)).multiplyScalar(3));
				return false;
			}
		});
	}
};
function zigzag(a, b, jag) {
	let pts = [a.clone(), b.clone()];
	let amp = a.distanceTo(b) * jag;
	for (let level = 0; level < 5; level++) {
		const next = [];
		for (let i = 0; i < pts.length - 1; i++) {
			next.push(pts[i]);
			next.push(pts[i].clone().lerp(pts[i + 1], .5).add(randomDir().multiplyScalar(amp * (Math.random() * .8 + .2))));
		}
		next.push(pts[pts.length - 1]);
		pts = next;
		amp *= .5;
	}
	return pts;
}
var lastBlink = -1;
function poisson(lambda) {
	if (lambda < 30) {
		const L = Math.exp(-lambda);
		let k = 0;
		let p = 1;
		do {
			k++;
			p *= Math.random();
		} while (p > L);
		return k - 1;
	}
	return Math.max(0, Math.round(lambda + Math.sqrt(lambda) * (Math.random() * 2 - 1)));
}
function pickRange(r, fallback) {
	if (r === void 0) return fallback;
	if (typeof r === "number") return r;
	if (typeof r === "function") return r();
	return r[0] + Math.random() * (r[1] - r[0]);
}
function basis(axis, e1, e2) {
	const ax = (axis ?? UP$7).clone().normalize();
	e1.set(1, 0, 0);
	if (Math.abs(ax.dot(e1)) > .9) e1.set(0, 0, 1);
	e1.sub(ax.clone().multiplyScalar(ax.dot(e1))).normalize();
	e2.crossVectors(ax, e1).normalize();
	return ax;
}
var sb1 = new THREE.Vector3();
var sb2 = new THREE.Vector3();
function sampleShape(s, i, n, p, nrm, tan) {
	if (s.type === "circle" || s.type === "disc") {
		const ax = basis(s.axis, sb1, sb2);
		const arc = s.type === "circle" && s.arc ? s.arc : [0, Math.PI * 2];
		const ordered = s.type === "circle" && s.ordered;
		const full = arc[1] - arc[0] >= Math.PI * 2 - .001;
		const u = ordered ? full ? i / n : n > 1 ? i / (n - 1) : .5 : Math.random();
		const a = arc[0] + (arc[1] - arc[0]) * u + (s.type === "circle" ? (Math.random() - .5) * (s.jitter ?? 0) : 0);
		const r = s.type === "disc" ? s.r * Math.sqrt(Math.random()) : s.r;
		nrm.copy(sb1).multiplyScalar(Math.cos(a)).addScaledVector(sb2, Math.sin(a));
		tan.crossVectors(ax, nrm).normalize();
		p.copy(s.at).addScaledVector(nrm, r);
	} else if (s.type === "line") {
		const u = s.ordered ? n > 1 ? i / (n - 1) : .5 : Math.random();
		p.copy(s.a).lerp(s.b, u);
		tan.subVectors(s.b, s.a).normalize();
		nrm.copy(randomDir()).addScaledVector(tan, -nrm.dot(tan)).normalize();
		if (s.jitter) p.addScaledVector(nrm, (Math.random() - .5) * s.jitter);
	} else if (s.type === "body") {
		const a = Math.random() * Math.PI * 2;
		nrm.set(Math.cos(a), 0, Math.sin(a));
		tan.set(-Math.sin(a), 0, Math.cos(a));
		p.copy(s.at).addScaledVector(nrm, s.r).setY(s.at.y + Math.random() * s.h);
	} else {
		randomDir(nrm);
		tan.crossVectors(UP$7, nrm).normalize();
		p.copy(s.at).addScaledVector(nrm, s.shell === false ? s.r * Math.cbrt(Math.random()) : s.r);
	}
}
//#endregion
//#region src/runtime/recipes/magic.ts
var UP$6 = new THREE.Vector3(0, 1, 0);
function aimOf$2(ctx) {
	const d = ctx.to().sub(ctx.from());
	return d.lengthSq() > 1e-6 ? d.normalize() : new THREE.Vector3(0, 0, -1);
}
function sideOf(aim) {
	const s = aim.clone().cross(UP$6);
	return s.lengthSq() > 1e-6 ? s.normalize() : new THREE.Vector3(1, 0, 0);
}
function launchFlash(ctx, at, aim, s) {
	ctx.glow(at, .7 * s, .14, 2.2);
	ctx.ring(at, .55 * s, {
		normal: aim,
		dur: .22,
		thick: .1
	});
	ctx.burst(at, {
		count: 18,
		speed: 4,
		dir: aim,
		spread: .5,
		scale: .5 * s
	});
}
function missile(ctx, from, to, o) {
	if (o.split) ctx.part("fly");
	const B = ctx.B * ctx.glare;
	const ribbon = ctx.ribbon((o.ribbon ?? .42) * o.s);
	const light = ctx.hold(6);
	const head = o.head ?? 1;
	ctx.fly({
		from,
		to,
		dur: o.dur,
		curve: o.curve,
		ease: o.ease,
		step: (h, prev, vel, dt) => {
			ctx.emit("glow", 1, {
				p: h,
				speed: 0,
				life: .04,
				size: .7 * o.s * head,
				colors: ctx.cols("main", "accent"),
				bright: .6 * B,
				fadeIn: 0,
				fadePow: 1
			});
			if (ctx.element !== "fire") ctx.emit("mist", 1, {
				p: h,
				speed: 0,
				life: .05,
				size: .42 * o.s * head,
				colors: ctx.cols("main"),
				bright: 1.4 * B,
				fadeIn: 0,
				fadePow: 1
			});
			ctx.emit("glow", 1, {
				p: h,
				speed: 0,
				life: .04,
				size: .14 * o.s * head,
				colors: ctx.cols("core"),
				bright: 2 * B,
				fadeIn: 0,
				fadePow: 1
			});
			if (ctx.element === "fire") ctx.emit("flame", poisson(70 * dt), {
				p: h,
				jitter: .04 * o.s,
				v: () => randomDir().multiplyScalar(.4).add(vel.clone().multiplyScalar(.9)),
				life: [.07, .12],
				size: [.2 * o.s, .3 * o.s],
				grow: 1.3,
				turb: 2,
				colors: ctx.cols("core", "main", "accent"),
				bright: 2 * B,
				fadeIn: .01,
				fadePow: .8
			});
			ctx.trail(h, prev, vel, dt, o.s, o.density);
			ctx.emit("spark", poisson(100 * dt * o.density * ctx.efx.sparks), {
				p: () => prev.clone().lerp(h, Math.random()),
				jitter: .05 * o.s,
				v: () => vel.clone().multiplyScalar(-.18).add(randomDir().multiplyScalar(2.2)),
				life: [.2, .5],
				size: [.012 * o.s, .024 * o.s],
				gravity: 5,
				drag: 2,
				stretch: .03,
				colors: ctx.cols("core", "main", "accent"),
				bright: 3 * B,
				fadeIn: 0
			});
			ribbon.trail.push(h);
			light.set(h, 39);
		},
		arrive: (at) => {
			ribbon.release(.18);
			light.release(.08);
			if (o.split) ctx.part("hit");
			o.arrive(at);
		}
	});
}
function targetCircle(ctx, size, dur) {
	ctx.part("mark");
	ctx.circle(ctx.ground(ctx.to()), size, dur, {
		slot: "target",
		spin: -.8,
		bright: 1.4
	});
	ctx.part("cast");
}
function projectile(ctx, p) {
	const s = ctx.scale * p.size;
	const aim0 = aimOf$2(ctx);
	ctx.part("cast");
	ctx.charge(ctx.from(), p.charge, {
		radius: .55 * p.size,
		aim: aim0,
		ground: ctx.from()
	});
	targetCircle(ctx, 1.3 * s, p.charge + ctx.from().distanceTo(ctx.to()) / p.speed + .6);
	ctx.after(p.charge, () => {
		ctx.handle.emit("release");
		const count = Math.max(1, Math.round(p.count));
		for (let i = 0; i < count; i++) ctx.after(i * .08, () => {
			const a = ctx.from();
			const b0 = ctx.to();
			const dist = Math.max(a.distanceTo(b0), .5);
			const aim = b0.clone().sub(a).normalize();
			const side = sideOf(aim);
			const sign = count > 1 ? i / (count - 1) * 2 - 1 : Math.random() < .5 ? -1 : 1;
			const curve = side.multiplyScalar(dist * .16 * p.curve * sign).addScaledVector(UP$6, dist * .1 * p.curve);
			const spreadTo = count > 1 ? sideOf(aim).multiplyScalar(sign * .25) : new THREE.Vector3();
			launchFlash(ctx, a, aim, p.size);
			missile(ctx, a, () => ctx.to().add(spreadTo), {
				dur: Math.max(dist / p.speed, .15),
				curve,
				s,
				density: p.density / Math.sqrt(count),
				split: true,
				arrive: (b) => {
					ctx.impact(b, {
						power: p.power,
						scale: 1.25 * p.size / Math.sqrt(count),
						extra: i === count - 1 && p.extra > 0,
						role: count > 1 && i === count - 1 ? "final" : void 0
					});
					for (let k = 0; k < p.after; k++) {
						const q = b.clone().add(randomDir().multiplyScalar(.25 + Math.random() * .45).multiply(new THREE.Vector3(1, .6, 1)));
						ctx.after(.05 + Math.random() * .22, () => {
							ctx.glow(q, .6 * s, .22, 1.6);
							ctx.burst(q, {
								count: 22,
								speed: 3.5,
								scale: .55 * p.size
							});
							ctx.light(q, 1.2, .2);
						});
					}
					if (ctx.pal.smoke) ctx.during(.08, .6, (_k, dt) => ctx.smoke(b.clone().add(new THREE.Vector3(0, .1, 0)), poisson(35 * dt), {
						jitter: .3,
						speed: [.8, 1.8],
						size: [.3 * s, .5 * s],
						delay: 0
					}));
				}
			});
		});
	});
}
projectile.defaults = {
	circleFeet: 1,
	circleHand: 1,
	circleTarget: 0,
	charge: .35,
	speed: 12,
	curve: .8,
	size: 1,
	after: 3,
	power: 1,
	density: 1,
	count: 1,
	extra: 1
};
function lance(ctx, p) {
	const s = ctx.scale * p.size;
	const aim0 = aimOf$2(ctx);
	ctx.part("cast");
	ctx.charge(ctx.from(), p.charge, {
		radius: .45,
		aim: aim0,
		ground: ctx.from()
	});
	targetCircle(ctx, 1.1 * s, p.charge + .6);
	ctx.after(p.charge, () => {
		ctx.handle.emit("release");
		const a = ctx.from();
		const aim = ctx.to().sub(a).normalize();
		ctx.ring(a, .5 * s, {
			normal: aim,
			dur: .2,
			thick: .12
		});
		ctx.ring(a.clone().addScaledVector(aim, .6), .35 * s, {
			normal: aim,
			dur: .2,
			thick: .12,
			delay: .03
		});
		ctx.wave(a, .8, .3, .6);
		ctx.star(a, .8 * s, .12);
		const dist = a.distanceTo(ctx.to());
		missile(ctx, a, () => ctx.to(), {
			dur: Math.max(dist / p.speed, .08),
			s: s * .7,
			density: .7,
			ribbon: .22,
			head: .8,
			split: true,
			arrive: (b) => {
				const d = aim.clone();
				ctx.impact(b, {
					power: p.power,
					dir: d,
					ringNormal: d,
					scale: .9 * p.size,
					extra: p.extra > 0
				});
				const exit = b.clone().addScaledVector(d, .7);
				ctx.ring(exit, .9 * s, {
					normal: d,
					dur: .3,
					thick: .08,
					delay: .03
				});
				ctx.burst(exit, {
					count: 50,
					speed: 9,
					dir: d,
					spread: .35,
					scale: .8 * p.size
				});
				ctx.flare(b, 1.6 * s, .3);
			}
		});
		ctx.part("fly");
		ctx.during(0, Math.max(dist / p.speed, .08), (k) => {
			const h = a.clone().lerp(ctx.to(), k);
			ctx.emit("spark", 1, {
				p: h,
				v: () => aim.clone().multiplyScalar(p.speed),
				life: .05,
				size: .07 * s,
				stretch: .035,
				colors: ctx.cols("core", "main"),
				bright: 3 * ctx.B,
				fadeIn: 0,
				fadePow: 1
			});
		});
	});
}
lance.defaults = {
	circleFeet: 0,
	circleHand: 1,
	circleTarget: 0,
	charge: .25,
	speed: 32,
	size: 1,
	power: 1.3,
	extra: 1
};
function beam(ctx, p) {
	const s = ctx.scale * p.size;
	const aim0 = aimOf$2(ctx);
	ctx.part("cast");
	ctx.charge(ctx.from(), p.charge, {
		radius: .6,
		aim: aim0,
		ground: ctx.from()
	});
	targetCircle(ctx, 1.4 * s, p.charge + p.dur + .4);
	ctx.after(p.charge, () => {
		ctx.handle.emit("release");
		const from = () => ctx.from();
		const to = () => ctx.to();
		ctx.part("beam");
		ctx.beam(from, to, {
			radius: p.radius * p.size,
			dur: p.dur,
			fadeIn: .08,
			fadeOut: .3,
			flow: 14
		});
		ctx.circle(from().addScaledVector(aim0, .2), .7 * s, p.dur + .1, {
			slot: "hand",
			normal: aim0,
			spin: -2.5,
			bright: 2.2
		});
		ctx.wave(from(), 1.2, .35, .8);
		ctx.part("hit");
		ctx.decal(to(), 1.2 * s, 3 + p.dur);
		const light = ctx.hold(7);
		let tick = 0;
		ctx.during(0, p.dur, (k, dt, age) => {
			const a = from();
			const b = to();
			const d = b.clone().sub(a).normalize();
			ctx.part("beam");
			ctx.emit("glow", 1, {
				p: a,
				speed: 0,
				life: .05,
				size: .8 * s,
				colors: ctx.cols("core", "main"),
				bright: 1.3 * ctx.B,
				fadeIn: 0
			});
			ctx.emit("spark", poisson(60 * dt), {
				p: () => a.clone().lerp(b, Math.random()),
				jitter: .25 * s * p.radius,
				v: () => d.clone().multiplyScalar(8),
				life: [.15, .3],
				size: [.01, .02],
				stretch: .03,
				colors: ctx.cols("core", "main"),
				bright: 2.5 * ctx.B,
				fadeIn: 0
			});
			ctx.part("hit");
			ctx.emit("glow", 1, {
				p: b,
				speed: 0,
				life: .05,
				size: 1.1 * s,
				colors: ctx.cols("core", "main"),
				bright: 1.3 * ctx.B,
				fadeIn: 0
			});
			ctx.emit("spark", poisson(260 * dt), {
				p: b,
				jitter: .15 * s,
				v: () => d.clone().multiplyScalar(-2).add(randomDir().multiplyScalar(6)),
				life: [.2, .45],
				size: [.015, .03],
				gravity: 5,
				drag: 2,
				stretch: .035,
				bounce: .3,
				colors: ctx.cols("core", "main", "accent"),
				bright: 3 * ctx.B,
				fadeIn: 0
			});
			ctx.trail(b, b.clone().addScaledVector(d, -.3), d.clone().multiplyScalar(-4), dt, s * 1.3, 1.5);
			light.set(b, 60);
			if (ctx.fx.feel) ctx.fx.shake(dt * .9);
			if (age >= tick) {
				tick += p.tick;
				ctx.ring(b, .9 * s, {
					normal: d,
					dur: .3,
					thick: .07
				});
				ctx.wave(b, .9, .3, .4);
				ctx.hit(b, p.power, "tick");
			}
		}, () => {
			light.release(.3);
			ctx.part("hit");
			ctx.impact(to(), {
				power: p.power * 1.6,
				scale: 1.1 * p.size,
				extra: true,
				role: "final"
			});
		});
	});
}
beam.defaults = {
	circleFeet: 1,
	circleHand: 1,
	circleTarget: 0,
	charge: .5,
	dur: 1.2,
	radius: .34,
	size: 1,
	power: .5,
	tick: .16
};
function blast(ctx, t, s, pw, secondary, o = {}) {
	const g = ctx.ground(t);
	ctx.screenFlash(.22);
	ctx.star(t, 2.6 * s, .22, 3);
	ctx.flare(t, 2.5 * s, .35);
	ctx.glow(t, 2 * s, .4, 1.3);
	ctx.sphere(t, 2.2 * s, .7, 2.2);
	ctx.light(t, 7 * pw, .7, 14);
	ctx.ring(t, 2.8 * s, {
		normal: "camera",
		dur: .45,
		thick: .08
	});
	for (let i = 0; i < 3; i++) ctx.ring(g, (2.6 + i * 1.1) * s, {
		dur: .55 + i * .1,
		thick: .06,
		delay: i * .07
	});
	ctx.wave(t, 3.5 * s, .6, 1.6);
	ctx.decal(t, 2.6 * s, 5);
	ctx.dust(g, 2 * s);
	ctx.burst(t, {
		count: 170,
		speed: 8,
		scale: 1.4 * s
	});
	ctx.extra(t, pw, 1.4 * s);
	if (o.hit !== false) ctx.hit(t, pw, o.role);
	for (let i = 0; i < secondary; i++) ctx.after(.05 + Math.random() * .3, () => {
		const q = t.clone().add(randomDir().multiply(new THREE.Vector3(1.4, .8, 1.4)).multiplyScalar(s));
		q.y = Math.max(q.y, g.y + .3);
		ctx.glow(q, .9 * s, .25, 1.8);
		ctx.burst(q, {
			count: 30,
			speed: 4,
			scale: .7 * s
		});
		ctx.light(q, 1.5, .25);
	});
	if (ctx.pal.smoke) ctx.during(.1, .9, (_k, dt) => ctx.smoke(g.clone().setY(g.y + .4), poisson(50 * dt), {
		jitter: .6 * s,
		speed: [1.2, 2.6],
		size: [.45 * s, .8 * s],
		delay: 0
	}));
}
function explosion(ctx, p) {
	const s = ctx.scale * p.size;
	const t = ctx.to();
	const g = ctx.ground(t);
	ctx.part("cast");
	ctx.charge(ctx.from(), .3, {
		radius: .45,
		aim: aimOf$2(ctx),
		ground: ctx.from()
	});
	ctx.part("hit");
	ctx.circle(g, 2 * s, p.gather + .5, {
		slot: "target",
		spin: 1.2,
		bright: 1.8
	});
	ctx.during(0, p.gather, (k, dt) => {
		ctx.emit("mote", poisson(160 * dt), {
			p: () => g.clone().add(randomDir().setY(0).normalize().multiplyScalar(2 * s)),
			center: t,
			attract: 14,
			v: () => new THREE.Vector3(0, 1.5, 0),
			life: [.3, .5],
			size: [.025, .045],
			drag: 2.5,
			colors: ctx.cols("core", "main"),
			bright: 2.2 * ctx.B,
			fadeIn: .1
		});
		if (Math.random() < dt * 25) ctx.glow(t, (.3 + k * .9) * s, .1, 1 + k * 2);
	});
	ctx.after(p.gather, () => {
		ctx.handle.emit("release");
		blast(ctx, t, s, p.power, p.secondary);
	});
}
explosion.defaults = {
	circleFeet: 0,
	circleHand: 1,
	circleTarget: 1,
	gather: .55,
	size: 1.2,
	power: 1.9,
	secondary: 5
};
function pillar(ctx, p) {
	const s = ctx.scale * p.size;
	const g = ctx.ground(ctx.to());
	ctx.part("cast");
	ctx.charge(ctx.from(), .3, {
		radius: .45,
		aim: aimOf$2(ctx),
		ground: ctx.from()
	});
	ctx.part("hit");
	ctx.circle(g, 1.5 * s, p.delay + p.dur + .2, {
		slot: "target",
		spin: 1.6,
		bright: 1.8
	});
	ctx.during(0, p.delay, (_k, dt) => {
		ctx.emit("mote", poisson(80 * dt), {
			p: () => g.clone().add(randomDir().setY(0).multiplyScalar(1.2 * s)),
			v: () => new THREE.Vector3(0, 1 + Math.random() * 2, 0),
			life: [.3, .6],
			size: [.02, .04],
			colors: ctx.cols("core", "main"),
			bright: 2 * ctx.B
		});
	});
	ctx.after(p.delay, () => {
		ctx.handle.emit("release");
		const top = g.clone().setY(g.y + p.height);
		ctx.beam(() => g, () => top, {
			radius: p.radius * s,
			dur: p.dur,
			fadeIn: .06,
			fadeOut: .3,
			flow: 10
		});
		const sheath = (k) => [1 + .25 * k, ease.outCubic(Math.min(k * 5, 1))];
		ctx.lathe(g, {
			profile: "cylinder",
			radius: p.radius * 1.35 * p.size,
			top: p.radius * 1.05 * p.size,
			height: p.height * .75 * p.size,
			flow: 2.2,
			twist: 1.5,
			tiles: [6, 1.2],
			streak: 1,
			rim: .8,
			fadeHi: .55,
			dur: p.dur + .2,
			bright: 1,
			grow: sheath,
			erode: (k) => Math.max(k - .7, 0) / .3
		});
		for (let i = 0; i < 3; i++) ctx.helix({
			center: g,
			r0: p.radius * 1.7 * p.size,
			r1: p.radius * .9 * p.size,
			height: p.height * .6 * p.size,
			turns: 1.3,
			phase: i / 3 * Math.PI * 2,
			width: .22,
			dur: .45,
			lag: .7,
			hold: p.dur * .3,
			delay: .04 * i,
			bright: 2
		});
		ctx.band(g, {
			radius: 2.2 * s,
			inner: .55,
			dur: .7,
			noise: 1
		});
		ctx.impact(g.clone().setY(g.y + 1), {
			power: p.power,
			scale: 1.1 * p.size,
			extra: true
		});
		ctx.ring(g, 2.4 * s, {
			dur: .6,
			thick: .06
		});
		const light = ctx.hold(8);
		ctx.during(0, p.dur, (k, dt) => {
			const h = g.clone().setY(g.y + Math.random() * p.height * .6);
			const vel = new THREE.Vector3(0, 9, 0);
			ctx.trail(h, h.clone().setY(h.y - .5), vel, dt, s * 1.5, 2);
			ctx.emit("spark", poisson(160 * dt), {
				p: () => g.clone().add(randomDir().setY(0).multiplyScalar(p.radius * s)),
				v: () => new THREE.Vector3(0, 6 + Math.random() * 6, 0),
				life: [.3, .6],
				size: [.012, .022],
				drag: 1,
				stretch: .04,
				colors: ctx.cols("core", "main"),
				bright: 3 * ctx.B,
				fadeIn: 0
			});
			light.set(g.clone().setY(g.y + 1.5), 90 * (1 - k * .5));
			if (ctx.fx.feel) ctx.fx.shake(dt * .6);
		}, () => light.release(.3));
	});
}
pillar.defaults = {
	circleFeet: 0,
	circleHand: 1,
	circleTarget: 1,
	delay: .35,
	dur: 1.1,
	radius: .75,
	height: 6,
	size: 1,
	power: 1.4
};
function meteor(ctx, p) {
	const s = ctx.scale * p.size;
	const hand = ctx.from();
	ctx.part("cast");
	ctx.charge(hand, .35, {
		radius: .5,
		aim: UP$6.clone(),
		ground: hand
	});
	ctx.part("main");
	const t = ctx.to();
	const aim = aimOf$2(ctx);
	const side = sideOf(aim);
	ctx.after(.35, () => {
		ctx.handle.emit("release");
		ctx.circle(ctx.ground(t), p.radius * 1.2 * s, p.dur + p.fall + .8, {
			slot: "target",
			spin: .8,
			bright: 1.2
		});
		const count = Math.round(p.count);
		for (let i = 0; i < count; i++) {
			const last = i === count - 1;
			ctx.after(last ? p.dur : Math.random() * p.dur * .9, () => {
				const off = last ? new THREE.Vector3() : randomDir().setY(0).multiplyScalar(Math.random() * p.radius * s);
				const land = ctx.ground(t.clone().add(off));
				const start = land.clone().add(new THREE.Vector3(0, 10, 0)).addScaledVector(side, -3.5).addScaledVector(aim, -2);
				const sz = (last ? 2 : .8 + Math.random() * .5) * p.size;
				missile(ctx, start, () => land, {
					dur: last ? p.fall * 1.3 : p.fall,
					s: sz * ctx.scale,
					density: 1,
					ribbon: .6,
					head: 1.6,
					ease: ease.inQuad,
					arrive: (b) => {
						const at = b.clone().setY(b.y + .2);
						if (last) {
							blast(ctx, at, 1.5 * s, 1.9, 6, { role: "final" });
							return;
						}
						const hitTarget = b.distanceTo(ctx.ground(ctx.to())) < 1.2;
						ctx.impact(at, {
							power: 1.25,
							scale: sz * 1.25,
							hit: hitTarget
						});
						ctx.decal(b, 1.2 * sz, 5);
						ctx.dust(b, sz);
						ctx.rocks(at, 4, sz * .8, () => randomDir().setY(.6 + Math.random()).multiplyScalar(4));
						if (ctx.fx.feel) ctx.fx.shake(.12);
					}
				});
			});
		}
	});
}
meteor.defaults = {
	circleFeet: 1,
	circleHand: 1,
	circleTarget: 1,
	count: 8,
	dur: 1.2,
	fall: .5,
	radius: 2.2,
	size: 1
};
function nova(ctx, p) {
	const s = ctx.scale * p.size;
	const c = ctx.from();
	const g = ctx.ground(c);
	const dist = g.distanceTo(ctx.ground(ctx.to()));
	const R = (p.radius > 0 ? p.radius : Math.max(dist + 1.2, 3.5)) * ctx.scale;
	ctx.part("cast");
	ctx.charge(c, p.charge, {
		radius: .9,
		ground: c,
		aim: UP$6.clone()
	});
	targetCircle(ctx, 1.2 * s, p.charge + .8);
	ctx.during(0, p.charge, (k, dt) => {
		ctx.emit("mote", poisson(120 * dt), {
			p: () => g.clone().add(randomDir().setY(0).normalize().multiplyScalar(R * .6)),
			center: c,
			attract: 12,
			v: () => new THREE.Vector3(0, 1, 0),
			life: [.3, .5],
			size: [.025, .045],
			drag: 2.5,
			colors: ctx.cols("core", "main"),
			bright: 2 * ctx.B,
			fadeIn: .1
		});
		if (Math.random() < dt * 20) ctx.glow(c, (.4 + k) * s, .1, 1 + k * 1.5);
	});
	ctx.after(p.charge, () => {
		ctx.handle.emit("release");
		ctx.part("main");
		const pw = p.power;
		ctx.screenFlash(.22);
		ctx.star(c, 2.8 * s, .24, 3);
		ctx.flare(c, 2.6 * s, .35);
		ctx.glow(c, 2.2 * s, .4, 1.3);
		ctx.light(c, 7 * pw, .8, R * 2);
		ctx.wave(c, R, .6, 1.4);
		ctx.sphere(c, R * .7, .6, 1.1);
		ctx.lathe(g, {
			profile: "dome",
			radius: R * .8 / ctx.scale,
			height: R * .3 / ctx.scale,
			tiles: [7, 1.5],
			streak: .4,
			rim: 1,
			flow: 1.2,
			dur: .55,
			bright: .55,
			grow: (k) => .15 + .85 * ease.outCubic(Math.min(k * 1.4, 1)),
			erode: (k) => Math.max(k - .25, 0) / .75,
			edge: .06,
			fade: (k) => 1 - k * k
		});
		ctx.band(g, {
			radius: R * 1.05 / ctx.scale,
			inner: .8,
			dur: .6,
			noise: 1,
			grow: (k) => .1 + .9 * ease.outCubic(k)
		});
		ctx.burst(c, {
			count: 90,
			speed: 7,
			scale: 1.2 * s
		});
		ctx.dust(g, 1.5 * s);
		for (let i = 0; i < 4; i++) ctx.ring(g, R * (1.05 - i * .2), {
			dur: .6 + i * .08,
			thick: .06,
			delay: i * .05
		});
		ctx.ring(c, R * .8, {
			normal: "camera",
			dur: .45,
			thick: .07
		});
		const expand = .6;
		ctx.during(0, expand, (k, dt) => {
			const r = R * ease.outCubic(k);
			const n = poisson(38 * dt * R);
			for (let i = 0; i < n; i++) {
				const front = Math.random() < .45;
				const u = front ? .9 + Math.random() * .1 : Math.sqrt(Math.random());
				const a = Math.random() * Math.PI * 2;
				const rr = r * u;
				const q = g.clone().add(new THREE.Vector3(Math.cos(a) * rr, .15, Math.sin(a) * rr));
				const out = new THREE.Vector3(Math.cos(a), .3 + (1 - u) * .6, Math.sin(a));
				const grow = .3 + 1.1 * (rr / R);
				ctx.burst(q, {
					count: front ? 5 : 2.5,
					speed: 3 + 3 * u,
					dir: out,
					spread: .45,
					scale: grow * p.size
				});
			}
			if (k > .3) ctx.dust(g.clone().add(randomDir().setY(0).normalize().multiplyScalar(r)), .2 * s);
		});
		const solid = ctx.element === "ice" ? "crystal" : ctx.element === "earth" ? "rock" : null;
		if (solid) [
			.22,
			.4,
			.57,
			.73,
			.88
		].forEach((u, j) => {
			const n = 5 + j * 3;
			const off = Math.random() * Math.PI * 2;
			const at = expand * (1 - Math.cbrt(1 - u)) * .95;
			for (let i = 0; i < n; i++) {
				const a = off + i / n * Math.PI * 2 + (Math.random() - .5) * .25;
				const rr = R * u * (.94 + Math.random() * .12);
				const h = (.35 + 1.55 * Math.pow(u / .88, 1.4)) * s * (.85 + Math.random() * .3);
				ctx.after(at + Math.random() * .04, () => ctx.spike(g.clone().add(new THREE.Vector3(Math.cos(a) * rr, 0, Math.sin(a) * rr)), g, h, solid, .7 + u * .5));
			}
		});
		else {
			const pts = 8;
			for (let i = 0; i < pts; i++) {
				const a = i / pts * Math.PI * 2 + Math.random() * .3;
				ctx.after(expand * (.55 + Math.random() * .25), () => {
					const q = g.clone().add(new THREE.Vector3(Math.cos(a) * R * .85, .3, Math.sin(a) * R * .85));
					ctx.glow(q, .9 * s, .3, 1.6);
					ctx.burst(q, {
						count: 30,
						speed: 4,
						dir: UP$6,
						spread: .6,
						scale: .9 * p.size
					});
					ctx.light(q, 1.5, .3);
				});
			}
		}
		const tHit = Math.min(Math.max(dist / R, 0), 1);
		const kHit = 1 - Math.cbrt(1 - tHit);
		ctx.after(expand * kHit, () => ctx.impact(ctx.to(), {
			power: pw,
			scale: .9,
			extra: true
		}));
		ctx.decal(c, Math.min(R * .6, 3), 5);
		if (ctx.pal.smoke) ctx.during(.2, .8, (_k, dt) => ctx.smoke(g.clone().add(randomDir().setY(0).normalize().multiplyScalar(R * .7)).setY(g.y + .3), poisson(40 * dt), {
			jitter: .4,
			speed: [.6, 1.5],
			size: [.4 * s, .7 * s],
			delay: 0
		}));
	});
}
nova.defaults = {
	circleFeet: 1,
	circleHand: 0,
	circleTarget: 0,
	charge: .55,
	radius: 0,
	size: 1,
	power: 1.7
};
function barrier$1(ctx, p) {
	const s = ctx.scale * p.size;
	const center = () => ctx.from();
	const r = p.radius * s;
	const g = ctx.ground(center());
	ctx.handle.emit("cast");
	ctx.circle(g, r * 1.2, p.dur + .4, {
		slot: "feet",
		spin: .8,
		bright: 1.6
	});
	ctx.ring(g, r * 1.5, {
		dur: .4,
		thick: .06
	});
	const prim = ctx.fx.prims.acquire("shield");
	prim.u.core.value.copy(ctx.pal.core);
	prim.u.main.value.copy(ctx.pal.main);
	prim.u.accent.value.copy(ctx.pal.accent);
	prim.u.bright.value = 1.8 * ctx.B;
	const hits = prim.u.hitData;
	hits.forEach((h) => h.set(0, 1, 0, 9));
	let slot = 0;
	let next = p.poke;
	ctx.after(.1, () => ctx.handle.emit("release"));
	ctx.live(prim, p.dur, (k, age) => {
		const c = center();
		prim.mesh.position.copy(c);
		const pop = ease.outBack(Math.min(age / .3, 1));
		prim.mesh.scale.setScalar(r * (.85 + .15 * pop));
		prim.u.reveal.value = Math.min(age / .35, 1);
		prim.u.time.value = age;
		prim.u.fade.value = k > .9 ? 1 - (k - .9) / .1 : 1;
		if (p.poke > 0 && age > next && k < .85) {
			next += p.poke * (.6 + Math.random() * .8);
			const toward = ctx.to().sub(c).normalize().add(randomDir().multiplyScalar(.5)).normalize();
			hits[slot].set(toward.x, toward.y, toward.z, 0);
			slot = (slot + 1) % hits.length;
			const at = c.clone().addScaledVector(toward, r);
			ctx.emit("spark", 30, {
				p: at,
				v: () => toward.clone().add(randomDir().multiplyScalar(.8)).multiplyScalar(4),
				life: [.15, .35],
				size: [.012, .022],
				drag: 3,
				stretch: .03,
				colors: ctx.cols("core", "main"),
				bright: 3 * ctx.B,
				fadeIn: 0
			});
			ctx.star(at, .6 * s, .12, 2.5);
			ctx.light(at, 1.5, .2);
		}
	});
	ctx.fx.scheduler.add({ update: (dt) => {
		for (const h of hits) h.w += dt;
		return prim.mesh.parent != null;
	} });
	ctx.after(p.dur, () => {
		const c = center();
		ctx.star(c, 2 * s, .2, 2.5);
		ctx.ring(c, r * 1.6, {
			normal: "camera",
			dur: .4,
			thick: .08
		});
		ctx.wave(c, r * 2, .5, 1);
		ctx.emit("shard", 120 * s, {
			p: () => c.clone().add(randomDir().multiplyScalar(r)),
			v: () => randomDir().multiplyScalar(3 + Math.random() * 3),
			life: [.4, .8],
			size: [.04, .08],
			gravity: 6,
			drag: 1.5,
			stretch: .02,
			colors: ctx.cols("core", "main"),
			bright: 2 * ctx.B,
			fadeIn: 0
		});
		ctx.emit("mote", 80 * s, {
			p: () => c.clone().add(randomDir().multiplyScalar(r)),
			v: () => randomDir().multiplyScalar(1),
			life: [.6, 1.1],
			size: [.02, .04],
			turb: 2,
			colors: ctx.cols("core", "main"),
			bright: 2 * ctx.B
		});
	});
}
barrier$1.defaults = {
	circleFeet: 1,
	circleHand: 0,
	circleTarget: 0,
	dur: 2.4,
	radius: 1.35,
	size: 1,
	poke: .45
};
//#endregion
//#region src/runtime/recipes/own.ts
var owners = /* @__PURE__ */ new WeakMap();
var serial = 0;
function claim(handle, slot) {
	const id = ++serial;
	const map = owners.get(handle) ?? {};
	map[slot] = id;
	owners.set(handle, map);
	return id;
}
function owns(handle, slot, id) {
	return owners.get(handle)?.[slot] === id;
}
//#endregion
//#region src/runtime/recipes/melee.ts
var UP$5 = new THREE.Vector3(0, 1, 0);
var DEG = Math.PI / 180;
function frame$2(ctx, reach = 0) {
	const pivot = ctx.from();
	const target = ctx.to();
	const fwd = target.clone().sub(pivot).setY(0);
	if (fwd.lengthSq() < 1e-6) fwd.set(0, 0, -1);
	fwd.normalize();
	const right = fwd.clone().cross(UP$5).normalize();
	const dist = pivot.distanceTo(target);
	return {
		pivot,
		fwd,
		right,
		dist,
		reach: reach > 0 ? reach : THREE.MathUtils.clamp(dist * .9, 1.1, 2.4)
	};
}
function swing(ctx, f, o) {
	ctx.part("swing");
	const roll = o.roll * DEG;
	const e1 = f.fwd;
	const e2 = f.right.clone().multiplyScalar(Math.cos(roll) * (o.mirror ? -1 : 1)).addScaledVector(UP$5, Math.sin(roll));
	const body = ctx.handle.body;
	const side = Math.cos(roll) * (o.mirror ? -1 : 1);
	const step = o.step ?? .35;
	const [lean0, lean1] = o.lean ?? [-.15, .3];
	const r1 = f.reach;
	const r0 = r1 * .28;
	const a0 = o.a0 * DEG;
	const a1 = o.a1 * DEG;
	const e = o.ease ?? ease.slash;
	const blade = ctx.handle.blade;
	const pose = (a) => {
		const d = e1.clone().multiplyScalar(Math.cos(a)).addScaledVector(e2, Math.sin(a));
		blade.base.copy(f.pivot).add(body.offset).addScaledVector(d, r0);
		blade.tip.copy(f.pivot).add(body.offset).addScaledVector(d, r1);
	};
	const angle = (k) => a0 + (a1 - a0) * e(k);
	const hits = [];
	const steps = 240;
	for (let i = 1; i <= steps; i++) if (Math.floor(angle((i - 1) / steps) / (Math.PI * 2)) !== Math.floor(angle(i / steps) / (Math.PI * 2))) hits.push(i / steps);
	const t0 = o.delay ?? 0;
	const W = o.windup;
	let id = 0;
	const mine = () => owns(ctx.handle, "swing", id);
	ctx.after(t0, () => {
		id = claim(ctx.handle, "swing");
		blade.active = true;
		const start = angle(0) * .35;
		if (W > 0) ctx.during(0, W, (k) => {
			if (!mine()) return;
			const a = start + (angle(0) + Math.sign(a0 - a1) * .2 - start) * ease.inOutQuad(k);
			pose(a);
			body.lean = lean0 * ease.inOutQuad(k);
			body.turn = -Math.sin(a) * side * .6;
		});
		if (o.glint !== false && W > .05) ctx.after(W * .6, () => ctx.star(blade.tip.clone(), .5 * ctx.scale, .18, 2.5));
	});
	ctx.after(t0 + W, () => {
		const lead = Math.sign(a0 - a1) * .2;
		const from = body.offset.clone();
		const shift = from.clone();
		if (o.trail !== false) ctx.arc({
			pivot: f.pivot,
			e1,
			e2,
			a0: a0 + lead,
			a1,
			r0,
			r1,
			dur: o.dur,
			ease: e,
			lag: o.lag,
			hold: .2,
			offset: shift
		});
		const prevTip = blade.tip.clone();
		let hi = 0;
		ctx.during(0, o.dur, (k, dt) => {
			const a = a0 + lead + (a1 - a0 - lead) * e(k);
			if (mine()) {
				body.lean = lean0 + (lean1 - lean0) * e(k);
				body.turn = -Math.sin(a) * side * .6;
				body.offset.copy(from).addScaledVector(f.fwd, step * e(k));
				shift.copy(body.offset);
				pose(a);
				const tipVel = dt > 0 ? blade.tip.clone().sub(prevTip).divideScalar(dt) : new THREE.Vector3();
				const sp = o.sparks ?? 1;
				ctx.emit("spark", poisson(sp * 260 * dt * ctx.efx.sparks), {
					p: () => blade.base.clone().lerp(blade.tip, .55 + Math.random() * .45),
					v: () => tipVel.clone().multiplyScalar(.15).add(randomDir().multiplyScalar(1.2)),
					life: [.15, .4],
					size: [.01, .02],
					gravity: 4,
					drag: 3,
					stretch: .03,
					colors: ctx.cols("core", "main"),
					bright: 2.5 * ctx.B,
					fadeIn: 0
				});
				ctx.trail(blade.tip, prevTip, tipVel, dt * .35 * sp, .55, 1);
				prevTip.copy(blade.tip);
			}
			while (hi < hits.length && k >= hits[hi]) {
				const tangent = e2.clone().multiplyScalar(Math.sign(a1 - a0));
				ctx.part("hit");
				if (o.onHit) o.onHit(hi, tangent);
				else strike$1(ctx, f, tangent, 1, { push: o.push });
				ctx.part("swing");
				hi++;
			}
		}, () => {
			ctx.after(.12, () => {
				if (mine()) blade.active = false;
			});
			const lean = body.lean;
			const turn = body.turn;
			const held = body.offset.clone();
			ctx.during(.1, .35, (k) => {
				if (!mine()) return;
				const q = ease.inOutQuad(k);
				body.lean = lean * (1 - q);
				body.turn = turn * (1 - q);
				body.offset.copy(held).multiplyScalar(1 - q);
			});
		});
	});
	return t0 + W + o.dur;
}
function screenAngle(ctx, at, dir) {
	const cam = ctx.fx.camera;
	const s0 = at.clone().project(cam);
	const s1 = at.clone().add(dir).project(cam);
	return Math.atan2(s1.y - s0.y, (s1.x - s0.x) * (cam.aspect ?? 1));
}
function strike$1(ctx, f, tangent, pw, o = {}) {
	const target = o.at ?? ctx.to();
	const ang = screenAngle(ctx, target, tangent);
	const power = pw * ctx.power;
	if (o.mark !== 0) ctx.crescent(target, (o.mark ?? 1.9) * ctx.scale * (power > 1.1 ? 1.1 : 1), ang, {
		hold: .28,
		from: f.pivot,
		tangent
	});
	const out = f.fwd.clone().add(tangent.clone().multiplyScalar(.8)).normalize();
	ctx.impact(target, {
		power: pw,
		dir: out,
		push: o.push,
		ringNormal: "camera",
		scale: o.scale ?? .8,
		extra: o.extra,
		role: o.role
	});
}
function slash(ctx, p) {
	const f = frame$2(ctx, p.reach);
	ctx.handle.emit("cast");
	ctx.after(p.windup, () => ctx.handle.emit("release"));
	swing(ctx, f, {
		roll: p.roll,
		mirror: p.mirror >= .5,
		a0: p.sweep / 2,
		a1: -p.sweep / 2,
		windup: p.windup,
		dur: p.dur,
		lag: p.lag,
		sparks: p.sparks,
		onHit: (_i, t) => strike$1(ctx, f, t, p.power, { extra: p.power >= 1.5 })
	});
}
slash.defaults = {
	windup: .12,
	dur: .18,
	sweep: 190,
	roll: 55,
	mirror: 0,
	reach: 0,
	lag: .6,
	power: 1,
	sparks: 1
};
function swipe(ctx, p) {
	const f = frame$2(ctx, p.reach);
	ctx.handle.emit("cast");
	ctx.after(p.windup, () => ctx.handle.emit("release"));
	swing(ctx, f, {
		roll: p.roll,
		mirror: p.mirror >= .5,
		a0: p.sweep / 2,
		a1: -p.sweep / 2,
		windup: p.windup,
		dur: p.dur,
		lag: p.lag,
		sparks: p.sparks,
		glint: false,
		onHit: (_i, t) => {
			const at = ctx.to();
			if (p.sparks > 0) ctx.emitShape("spark", Math.round(24 * p.sparks), {
				type: "sphere",
				at,
				r: .1
			}, {
				v: () => t.clone().multiplyScalar(3 + Math.random() * 3).add(randomDir().multiplyScalar(1.5)),
				life: [.1, .25],
				size: [.01, .018],
				gravity: 4,
				stretch: .04,
				colors: ctx.cols("core", "main"),
				bright: 2.4 * ctx.B,
				fadeIn: 0
			});
			ctx.hit(at, p.power);
		}
	});
}
swipe.defaults = {
	windup: .1,
	dur: .16,
	sweep: 190,
	roll: 55,
	mirror: 0,
	reach: 0,
	lag: .6,
	power: 1,
	sparks: .3
};
function spin(ctx, p) {
	const f = frame$2(ctx, p.reach);
	ctx.handle.emit("cast");
	ctx.after(p.windup, () => ctx.handle.emit("release"));
	const end = swing(ctx, f, {
		roll: p.roll,
		a0: p.sweep / 2,
		a1: -p.sweep / 2,
		windup: p.windup,
		dur: p.dur,
		lag: .45,
		ease: ease.inOutQuad,
		sparks: 1.4,
		onHit: (_i, t) => strike$1(ctx, f, t, p.power, { scale: .7 })
	});
	ctx.after(end - p.dur * .3, () => {
		const g = ctx.ground(f.pivot);
		ctx.ring(g, f.reach * 1.5, {
			dur: .45,
			thick: .06
		});
		ctx.dust(g, 1.2);
		ctx.wave(f.pivot, f.reach * 1.4, .4, .8);
	});
}
spin.defaults = {
	windup: .1,
	dur: .36,
	sweep: 420,
	roll: 6,
	reach: 0,
	power: 1.1
};
function cross$1(ctx, p) {
	const f = frame$2(ctx, p.reach);
	ctx.handle.emit("cast");
	ctx.after(p.windup, () => ctx.handle.emit("release"));
	const marks = [];
	const first = swing(ctx, f, {
		roll: 50,
		a0: 95,
		a1: -95,
		windup: p.windup,
		dur: p.dur,
		lag: .5,
		onHit: (_i, t) => {
			const ang = screenAngle(ctx, ctx.to(), t);
			marks.push(ang);
			ctx.crescent(ctx.to(), 2 * ctx.scale, ang, {
				hold: p.gap + .3,
				from: f.pivot,
				tangent: t
			});
			ctx.burst(ctx.to(), {
				count: 30,
				dir: f.fwd,
				scale: .6
			});
			ctx.hit(ctx.to(), .5);
		}
	});
	const second = swing(ctx, f, {
		roll: -50,
		a0: 95,
		a1: -95,
		windup: .05,
		dur: p.dur,
		lag: .5,
		delay: first - .02,
		glint: false,
		onHit: (_i, t) => {
			const ang = screenAngle(ctx, ctx.to(), t);
			ctx.crescent(ctx.to(), 2 * ctx.scale, ang, {
				hold: p.gap + .1,
				from: f.pivot,
				tangent: t
			});
			ctx.burst(ctx.to(), {
				count: 30,
				dir: f.fwd,
				scale: .6
			});
			ctx.hit(ctx.to(), .5);
		}
	});
	ctx.after(second + p.gap, () => {
		ctx.part("hit");
		const t = ctx.to();
		for (const a of marks) ctx.crescent(t, 2.4 * ctx.scale, a, {
			hold: .2,
			from: f.pivot
		});
		ctx.screenFlash(.25);
		ctx.impact(t, {
			power: p.power,
			scale: 1.1,
			extra: true,
			ringNormal: "camera",
			role: "final"
		});
	});
}
cross$1.defaults = {
	windup: .12,
	dur: .15,
	gap: .22,
	reach: 0,
	power: 1.6
};
function thrust(ctx, p) {
	const f = frame$2(ctx, p.reach);
	const blade = ctx.handle.blade;
	const aim = ctx.to().clone().sub(f.pivot).normalize();
	const len = f.reach * .75;
	const body = ctx.handle.body;
	const pose = (x) => {
		body.offset.copy(f.fwd).multiplyScalar(Math.max(x, 0) * .45);
		body.lean = x < 0 ? x * .4 : Math.min(x / Math.max(f.dist, 1), 1) * .3;
		blade.base.copy(f.pivot).add(body.offset).addScaledVector(aim, x);
		blade.tip.copy(f.pivot).add(body.offset).addScaledVector(aim, x + len);
	};
	ctx.handle.emit("cast");
	ctx.part("swing");
	blade.active = true;
	ctx.during(0, p.windup, (k) => pose(-.35 * ease.inOutQuad(k)));
	ctx.after(p.windup * .6, () => ctx.star(blade.tip.clone(), .5 * ctx.scale, .18, 2.5));
	ctx.after(p.windup, () => {
		ctx.handle.emit("release");
		const far = Math.max(f.dist - len + .25, .3);
		let hit = false;
		const prev = blade.tip.clone();
		ctx.during(0, p.dur, (k, dt) => {
			pose(-.35 + (far + .35) * ease.slash(k));
			const v = dt > 0 ? blade.tip.clone().sub(prev).divideScalar(dt) : new THREE.Vector3();
			ctx.emit("spark", poisson(300 * dt), {
				p: () => blade.base.clone().lerp(blade.tip, Math.random()),
				v: () => aim.clone().multiplyScalar(6).add(randomDir()),
				life: [.1, .25],
				size: [.01, .018],
				stretch: .04,
				colors: ctx.cols("core", "main"),
				bright: 2.5 * ctx.B,
				fadeIn: 0
			});
			ctx.emit("spark", 1, {
				p: blade.tip.clone(),
				v: () => v.clone(),
				life: .08,
				size: .06,
				stretch: .03,
				colors: ctx.cols("core", "main"),
				bright: 2.5 * ctx.B,
				fadeIn: 0
			});
			ctx.trail(blade.tip, prev, v, dt * .4, .5);
			prev.copy(blade.tip);
			if (!hit && k > .55) {
				hit = true;
				ctx.part("hit");
				const t = ctx.to();
				ctx.ring(t.clone().addScaledVector(aim, -.5), .6 * ctx.scale, {
					normal: aim,
					dur: .25,
					thick: .12
				});
				ctx.ring(t, 1 * ctx.scale, {
					normal: aim,
					dur: .3,
					thick: .1,
					delay: .03
				});
				ctx.ring(t.clone().addScaledVector(aim, .6), 1.3 * ctx.scale, {
					normal: aim,
					dur: .35,
					thick: .08,
					delay: .06
				});
				ctx.impact(t, {
					power: p.power,
					dir: aim,
					ringNormal: aim,
					scale: .8,
					extra: p.power >= 1.5
				});
				ctx.burst(t.clone().addScaledVector(aim, .5), {
					count: 50,
					speed: 10,
					dir: aim,
					spread: .3,
					scale: .8
				});
				ctx.flare(t, 1.8 * ctx.scale, .3);
				ctx.part("swing");
			}
		}, () => ctx.during(.05, .2, (k) => pose(far * (1 - ease.inOutQuad(k))), () => blade.active = false));
	});
}
thrust.defaults = {
	windup: .16,
	dur: .12,
	reach: 0,
	power: 1.3
};
function smash(ctx, p) {
	const f = frame$2(ctx, p.reach);
	ctx.handle.emit("cast");
	ctx.after(p.windup, () => ctx.handle.emit("release"));
	const a1 = -40;
	const end = swing(ctx, f, {
		roll: 90,
		a0: 120,
		a1,
		windup: p.windup,
		dur: p.dur,
		lag: .55,
		ease: ease.inQuad,
		onHit: () => {}
	});
	const tip = f.pivot.clone().addScaledVector(f.fwd, f.reach * Math.cos(a1 * DEG)).addScaledVector(UP$5, f.reach * Math.sin(a1 * DEG));
	const g = ctx.ground(tip);
	ctx.after(end, () => {
		ctx.part("hit");
		const pw = p.power;
		ctx.screenFlash(.1);
		ctx.impact(g.clone().setY(g.y + .25), {
			power: pw,
			scale: 1.2,
			ringNormal: "up",
			extra: true
		});
		ctx.decal(g, 2.2, 5);
		ctx.dust(g, 1.2);
		ctx.rocks(g, 14, 1, () => randomDir().setY(.5 + Math.random()).multiplyScalar(4 + Math.random() * 3));
		for (let i = 1; i <= p.fissure; i++) {
			const q = g.clone().addScaledVector(f.fwd, i * .55).addScaledVector(f.right, (Math.random() - .5) * .3);
			ctx.after(i * .045, () => {
				ctx.decal(q, .9, 4);
				ctx.burst(q.clone().setY(q.y + .1), {
					count: 18,
					speed: 4,
					dir: UP$5,
					spread: .5,
					scale: .6
				});
				if (i % 2) ctx.dust(q, .5);
				if (ctx.element === "ice") ctx.spike(q, g, .7, "crystal", .8);
				else if (ctx.element === "earth") ctx.spike(q, g, .7, "rock", .8);
				if (q.distanceTo(ctx.ground(ctx.to())) < .6) ctx.hit(ctx.to(), .6, "tick");
			});
		}
	});
}
smash.defaults = {
	windup: .28,
	dur: .14,
	reach: 0,
	power: 1.8,
	fissure: 5
};
function iaido(ctx, p) {
	const f = frame$2(ctx, p.reach);
	const blade = ctx.handle.blade;
	const roll = 8 * DEG;
	const e2 = f.right.clone().multiplyScalar(Math.cos(roll)).addScaledVector(UP$5, Math.sin(roll));
	const sheath = 150 * DEG;
	const d = f.fwd.clone().multiplyScalar(Math.cos(sheath)).addScaledVector(e2, Math.sin(sheath));
	blade.base.copy(f.pivot).addScaledVector(d, f.reach * .28);
	blade.tip.copy(f.pivot).addScaledVector(d, f.reach);
	blade.active = true;
	ctx.handle.emit("cast");
	ctx.part("cast");
	const mid = blade.base.clone().lerp(blade.tip, .5);
	ctx.during(0, p.charge, (k, dt) => {
		const n = poisson(140 * (.3 + k) * dt);
		for (let i = 0; i < n; i++) {
			const target = blade.base.clone().lerp(blade.tip, Math.random());
			const start = target.clone().add(randomDir().multiplyScalar(.8));
			const life = .25 + Math.random() * .1;
			const v = target.clone().sub(start).divideScalar(life);
			ctx.emit("spark", 1, {
				p: start,
				v: () => v.clone(),
				life,
				size: [.01, .018],
				stretch: .05,
				colors: ctx.cols("core", "main"),
				bright: 2.2 * ctx.B,
				fadeIn: .1,
				fadePow: .5
			});
		}
		if (Math.random() < dt * 20) ctx.emit("glow", 1, {
			p: mid,
			jitter: f.reach * .3,
			speed: 0,
			life: .12,
			size: .3 + k * .4,
			colors: ctx.cols("main", "accent"),
			bright: (.5 + k) * ctx.B
		});
	});
	ctx.after(p.charge * .85, () => ctx.star(blade.tip.clone(), .9, .2, 3));
	const end = swing(ctx, f, {
		roll: 8,
		a0: 150,
		a1: -110,
		windup: 0,
		dur: p.dur,
		lag: 1.1,
		delay: p.charge,
		glint: false,
		sparks: .6,
		onHit: (_i, t) => {
			ctx.screenFlash(.35);
			const ang = screenAngle(ctx, ctx.to(), t);
			ctx.crescent(ctx.to(), 3 * ctx.scale, ang, {
				hold: p.delay + .2,
				bend: .15,
				from: f.pivot,
				tangent: t
			});
			ctx.hit(ctx.to(), .4);
		}
	});
	ctx.after(p.charge, () => ctx.handle.emit("release"));
	ctx.after(end + p.delay, () => {
		ctx.part("hit");
		const t = ctx.to();
		for (let i = 0; i < 3; i++) ctx.after(i * .03, () => ctx.crescent(t.clone().add(randomDir().multiplyScalar(.25)), 2.2 * ctx.scale, Math.random() * Math.PI, {
			hold: .25,
			bend: .2,
			from: f.pivot
		}));
		ctx.impact(t, {
			power: p.power,
			scale: 1.2,
			extra: true,
			role: "final"
		});
	});
}
iaido.defaults = {
	charge: .6,
	dur: .07,
	delay: .4,
	reach: 0,
	power: 2
};
var DOWN$1 = new THREE.Vector3(0, -1, 0);
function rising(ctx, p) {
	const f = frame$2(ctx, p.reach);
	ctx.handle.emit("cast");
	ctx.after(p.windup, () => ctx.handle.emit("release"));
	const lift = f.fwd.clone().multiplyScalar(.3).add(UP$5).normalize();
	swing(ctx, f, {
		roll: p.roll,
		mirror: p.mirror >= .5,
		a0: -p.sweep / 2,
		a1: p.sweep / 2,
		windup: p.windup,
		dur: p.dur,
		lag: p.lag,
		sparks: p.sparks,
		lean: [.3, -.2],
		push: lift,
		onHit: (_i, t) => {
			strike$1(ctx, f, t, p.power, {
				push: lift,
				extra: p.power >= 1.5
			});
			const at = ctx.to();
			ctx.emitShape("spark", 40, {
				type: "sphere",
				at,
				r: .2
			}, {
				v: () => UP$5.clone().multiplyScalar(5 + Math.random() * 5).add(randomDir().multiplyScalar(1.5)),
				life: [.2, .45],
				size: [.01, .02],
				gravity: 6,
				stretch: .05,
				colors: ctx.cols("core", "main"),
				bright: 2.6 * ctx.B,
				fadeIn: 0
			});
			ctx.lines(at.clone().add(new THREE.Vector3(0, .6, 0)), {
				size: 1.6 * ctx.scale,
				parallel: Math.PI / 2,
				dur: .25,
				count: 14,
				width: .25,
				bright: 1.1
			});
		}
	});
}
rising.defaults = {
	windup: .14,
	dur: .17,
	sweep: 190,
	roll: 65,
	mirror: 0,
	reach: 0,
	lag: .6,
	power: 1.3,
	sparks: 1
};
function cleave(ctx, p) {
	const f = frame$2(ctx, p.reach);
	ctx.handle.emit("cast");
	ctx.after(p.windup, () => ctx.handle.emit("release"));
	const end = swing(ctx, f, {
		roll: 90,
		a0: 165,
		a1: -25,
		windup: p.windup,
		dur: p.dur,
		lag: .5,
		ease: ease.inQuad,
		step: .5,
		lean: [-.3, .45],
		sparks: 1.3,
		onHit: () => {}
	});
	ctx.after(end - p.dur * .15, () => {
		ctx.part("hit");
		const t = ctx.to();
		ctx.crescent(t, 1.6 * ctx.scale, Math.PI / 2, {
			hold: p.split + .25,
			bend: .04,
			from: f.pivot
		});
		ctx.hit(t, .6 * p.power, "first", DOWN$1);
		ctx.burst(t, {
			count: 40,
			dir: f.fwd,
			scale: .6
		});
		const g = ctx.ground(t.clone().addScaledVector(f.fwd, -.4));
		ctx.decal(g, 1.2, 4);
		ctx.dust(g, .9);
		ctx.after(p.split, () => {
			ctx.crescent(t, 1.9 * ctx.scale, Math.PI / 2, {
				hold: .22,
				bend: 0,
				from: f.pivot
			});
			ctx.impact(t, {
				power: p.power,
				dir: f.fwd,
				push: DOWN$1,
				ringNormal: "camera",
				scale: 1,
				extra: true,
				role: "final"
			});
		});
	});
}
cleave.defaults = {
	windup: .3,
	dur: .12,
	split: .18,
	reach: 0,
	power: 1.8
};
function combo(ctx, p) {
	const f = frame$2(ctx, p.reach);
	ctx.handle.emit("cast");
	ctx.after(p.windup, () => ctx.handle.emit("release"));
	const light = (i) => (_n, t) => strike$1(ctx, f, t, p.power * .55, {
		scale: .6,
		mark: 1.5,
		role: i === 0 ? "first" : "link"
	});
	const one = swing(ctx, f, {
		roll: 10,
		a0: 85,
		a1: -85,
		windup: p.windup,
		dur: p.dur,
		lag: .5,
		step: .2,
		onHit: light(0)
	});
	const two = swing(ctx, f, {
		roll: 25,
		mirror: true,
		a0: -85,
		a1: 85,
		windup: .04,
		dur: p.dur,
		lag: .5,
		delay: one + p.gap,
		step: .2,
		glint: false,
		lean: [.2, -.05],
		onHit: light(1)
	});
	swing(ctx, f, {
		roll: 80,
		a0: 160,
		a1: -35,
		windup: .12,
		dur: p.dur * .9,
		lag: .55,
		delay: two + p.gap,
		step: .4,
		glint: false,
		ease: ease.inQuad,
		lean: [-.3, .45],
		sparks: 1.4,
		onHit: (_n, t) => strike$1(ctx, f, t, p.power, {
			extra: true,
			push: f.fwd.clone().add(DOWN$1).normalize(),
			role: "final"
		})
	});
}
combo.defaults = {
	windup: .1,
	dur: .13,
	gap: .06,
	reach: 0,
	power: 1.6
};
function flyingArc(ctx, o) {
	const prim = ctx.fx.prims.acquire("arc");
	const half = o.span / 2 * DEG;
	arcGeometry(prim.mesh.geometry, o.pivot, o.e1, o.e2, half, -half, o.radius * .72, o.radius);
	prim.u.core.value.copy(ctx.pal.core);
	prim.u.main.value.copy(ctx.pal.main);
	prim.u.accent.value.copy(ctx.pal.accent);
	prim.u.bright.value = 3.4 * ctx.B;
	prim.u.seed.value = Math.random() * 50;
	prim.u.lag.value = 1.05;
	prim.u.head.value = 1;
	prim.mesh.position.set(0, 0, 0);
	const travel = o.dist / o.speed;
	const total = travel + .25;
	let arrived = false;
	const tipAt = (a) => o.pivot.clone().add(prim.mesh.position).addScaledVector(o.e1, Math.cos(a) * o.radius).addScaledVector(o.e2, Math.sin(a) * o.radius);
	let prev = tipAt(0);
	ctx.live(prim, total, (_k, age) => {
		prim.u.time.value = age;
		const d = Math.min(age * o.speed, o.dist + 1.5);
		prim.mesh.position.copy(o.dir).multiplyScalar(d);
		prim.u.fade.value = age < travel ? 1 : Math.max(1 - (age - travel) / .25, 0);
		const head = tipAt(0);
		ctx.handle.head.copy(head);
		const dt = 1 / 60;
		ctx.emit("spark", 3, {
			p: () => tipAt((Math.random() - .5) * 2 * half),
			v: () => o.dir.clone().multiplyScalar(-2).add(randomDir()),
			life: [.1, .25],
			size: [.01, .018],
			stretch: .03,
			colors: ctx.cols("core", "main"),
			bright: 2.4 * ctx.B,
			fadeIn: 0
		});
		ctx.trail(head, prev, o.dir.clone().multiplyScalar(o.speed), dt, .7);
		prev = head;
		if (!arrived && age >= travel) {
			arrived = true;
			o.arrive();
		}
	});
}
function wave(ctx, p) {
	const f = frame$2(ctx, 1.6);
	ctx.handle.emit("cast");
	ctx.after(p.windup, () => ctx.handle.emit("release"));
	const end = swing(ctx, f, {
		roll: p.roll,
		a0: 90,
		a1: -90,
		windup: p.windup,
		dur: p.dur,
		lag: .5,
		step: .3,
		onHit: () => {}
	});
	ctx.after(end - p.dur * .4, () => {
		ctx.part("fly");
		const roll = p.roll * DEG;
		const e2 = f.right.clone().multiplyScalar(Math.cos(roll)).addScaledVector(UP$5, Math.sin(roll));
		const pivot = f.pivot.clone().add(ctx.handle.body.offset).addScaledVector(f.fwd, -.4 * p.size);
		const target = ctx.to();
		const dir = target.clone().sub(pivot).setY(0).normalize();
		const dist = Math.max(target.clone().sub(pivot).setY(0).length() - 1.2 * p.size, .3);
		flyingArc(ctx, {
			pivot,
			e1: dir,
			e2,
			radius: 1.5 * p.size * ctx.scale,
			span: 120,
			dir,
			dist,
			speed: p.speed,
			arrive: () => {
				ctx.part("hit");
				strike$1(ctx, f, e2.clone().negate(), p.power, {
					mark: 0,
					extra: p.power >= 1.5
				});
			}
		});
	});
}
wave.defaults = {
	windup: .1,
	dur: .12,
	roll: 20,
	speed: 14,
	size: 1,
	power: 1.3
};
function dash(ctx, p) {
	const f = frame$2(ctx, 1.4);
	const blade = ctx.handle.blade;
	const body = ctx.handle.body;
	const target = ctx.to();
	const travel = f.dist + p.over;
	const low = f.fwd.clone().multiplyScalar(-.5).add(f.right.clone().multiplyScalar(.6)).add(DOWN$1.clone().multiplyScalar(.35)).normalize();
	const hold = () => {
		blade.base.copy(f.pivot).add(body.offset).addScaledVector(low, .35);
		blade.tip.copy(f.pivot).add(body.offset).addScaledVector(low, 1.4);
	};
	ctx.handle.emit("cast");
	ctx.part("cast");
	blade.active = true;
	ctx.during(0, p.charge, (k) => {
		body.lean = .35 * ease.inOutQuad(k);
		body.offset.copy(f.fwd).multiplyScalar(-.15 * k);
		hold();
	});
	ctx.after(p.charge * .7, () => ctx.star(f.pivot.clone().addScaledVector(low, 1.4), .6 * ctx.scale, .18, 2.5));
	ctx.after(p.charge, () => {
		ctx.handle.emit("release");
		ctx.part("swing");
		const start = ctx.from().add(body.offset).setY(ctx.floor + .05);
		ctx.dust(start, .8);
		let hit = false;
		const prev = blade.tip.clone();
		ctx.during(0, p.dash, (k, dt) => {
			body.offset.copy(f.fwd).multiplyScalar(-.15 + (travel + .15) * ease.outQuint(k));
			body.lean = .45;
			hold();
			const v = dt > 0 ? blade.tip.clone().sub(prev).divideScalar(dt) : new THREE.Vector3();
			ctx.trail(blade.tip, prev, v, dt * .6, .6);
			ctx.emit("spark", poisson(400 * dt), {
				p: () => blade.base.clone().lerp(blade.tip, Math.random()),
				v: () => f.fwd.clone().multiplyScalar(-3).add(randomDir()),
				life: [.1, .25],
				size: [.01, .018],
				stretch: .04,
				colors: ctx.cols("core", "main"),
				bright: 2.4 * ctx.B,
				fadeIn: 0
			});
			prev.copy(blade.tip);
			if (!hit && body.offset.length() >= f.dist - .3) {
				hit = true;
				ctx.part("hit");
				ctx.crescent(target, 2 * ctx.scale, screenAngle(ctx, target, f.fwd), {
					hold: p.delay + .2,
					bend: .05,
					from: f.pivot
				});
				ctx.hit(target, .5, "first");
				ctx.part("swing");
			}
		}, () => {
			const end = ctx.from().add(body.offset).setY(ctx.floor + .05);
			ctx.dust(end, 1);
			ctx.lines(start.clone().lerp(end, .5).setY(target.y), {
				size: travel * .5,
				parallel: screenAngle(ctx, target, f.fwd),
				dur: .25,
				count: 20,
				width: .35,
				bright: 1.2
			});
			ctx.after(p.delay, () => {
				ctx.part("hit");
				ctx.screenFlash(.3);
				ctx.impact(target, {
					power: p.power,
					dir: f.fwd,
					ringNormal: "camera",
					scale: 1.1,
					extra: true,
					role: "final"
				});
				blade.active = false;
				const held = body.offset.clone();
				ctx.during(.15, .3, (k) => {
					body.offset.copy(held).multiplyScalar(1 - ease.inOutQuad(k));
					body.lean = .45 * (1 - k);
				});
			});
		});
	});
}
dash.defaults = {
	charge: .18,
	dash: .14,
	over: 1.4,
	delay: .25,
	power: 1.7
};
function flurry(ctx, p) {
	const f = frame$2(ctx, p.reach);
	const n = Math.max(3, Math.round(p.count));
	ctx.handle.emit("cast");
	ctx.after(p.windup, () => ctx.handle.emit("release"));
	let t = 0;
	for (let i = 0; i < n; i++) {
		const roll = 20 + Math.random() * 70;
		const mirror = Math.random() < .5;
		const up = Math.random() < .3;
		t = swing(ctx, f, {
			roll,
			mirror,
			a0: up ? -70 : 70,
			a1: up ? 70 : -70,
			windup: i === 0 ? p.windup : .01,
			dur: p.dur,
			lag: .45,
			delay: t + (i === 0 ? 0 : p.gap),
			step: .15,
			glint: i === 0,
			sparks: .7,
			onHit: (_n, tg) => {
				const at = ctx.to().add(randomDir().multiplyScalar(.25));
				ctx.crescent(at, (1.4 + Math.random() * .6) * ctx.scale, screenAngle(ctx, at, tg), {
					hold: .2,
					bend: .25,
					from: f.pivot,
					tangent: tg
				});
				ctx.burst(at, {
					count: 14,
					dir: f.fwd,
					scale: .4
				});
				ctx.hit(at, .35, i === 0 ? "first" : "tick");
			}
		});
	}
	swing(ctx, f, {
		roll: 85,
		a0: 165,
		a1: -30,
		windup: .14,
		dur: p.dur * 2,
		lag: .55,
		delay: t + .05,
		step: .45,
		glint: true,
		ease: ease.inQuad,
		lean: [-.3, .45],
		sparks: 1.4,
		onHit: (_n, tg) => strike$1(ctx, f, tg, p.power, {
			extra: true,
			role: "final",
			push: f.fwd.clone().add(DOWN$1).normalize()
		})
	});
}
flurry.defaults = {
	windup: .12,
	count: 8,
	dur: .06,
	gap: .015,
	reach: 0,
	power: 1.6
};
//#endregion
//#region src/runtime/recipes/blunt.ts
var UP$4 = new THREE.Vector3(0, 1, 0);
var DOWN = new THREE.Vector3(0, -1, 0);
function frame$1(ctx) {
	const from = ctx.from();
	const to = ctx.to();
	const aim = to.clone().sub(from).setY(0);
	if (aim.lengthSq() < 1e-6) aim.set(1, 0, 0);
	aim.normalize();
	return {
		from,
		to,
		aim,
		side: aim.clone().cross(UP$4).normalize(),
		dist: from.clone().setY(0).distanceTo(to.clone().setY(0))
	};
}
function limb(ctx, kind, o) {
	const head = ctx.handle.head;
	const body = ctx.handle.body;
	const e = o.ease ?? ease.outExpo;
	const s = (o.size ?? 1) * ctx.scale;
	ctx.after(o.delay, () => {
		const id = claim(ctx.handle, "limb");
		const mine = () => owns(ctx.handle, "limb", id);
		body.limb = kind;
		const prev = o.path(0);
		head.copy(prev);
		ctx.during(0, o.dur, (k, dt) => {
			if (!mine()) return;
			head.copy(o.path(e(k)));
			const vel = dt > 0 ? head.clone().sub(prev).divideScalar(dt) : new THREE.Vector3();
			ctx.emit("glow", 1, {
				p: head.clone(),
				speed: 0,
				life: .09,
				size: .32 * s,
				colors: ctx.cols("core", "main"),
				bright: 1.2 * ctx.B * ctx.glare,
				fadeIn: 0
			});
			ctx.emit("spark", poisson(220 * dt), {
				p: head.clone(),
				jitter: .06 * s,
				v: () => vel.clone().multiplyScalar(-.08).add(randomDir().multiplyScalar(1.2)),
				life: [.08, .18],
				size: [.01, .018],
				stretch: .04,
				colors: ctx.cols("core", "main"),
				bright: 2.4 * ctx.B,
				fadeIn: 0
			});
			ctx.trail(head, prev, vel, dt * .5, .55 * s);
			prev.copy(head);
		}, () => {
			const vel = o.path(1).sub(o.path(.9)).multiplyScalar(10 / Math.max(o.dur, .001));
			o.arrive?.(mine() ? head.clone() : o.path(1), vel);
			ctx.after(o.after ?? .12, () => {
				if (mine()) body.limb = null;
			});
		});
	});
}
function settle(ctx, delay, dur = .35) {
	const body = ctx.handle.body;
	ctx.after(delay, () => {
		const off = body.offset.clone();
		const lean = body.lean;
		const turn = body.turn;
		ctx.during(0, dur, (k) => {
			const q = ease.inOutQuad(k);
			body.offset.copy(off).multiplyScalar(1 - q);
			body.lean = lean * (1 - q);
			body.turn = turn * (1 - q);
		});
	});
}
function pose(ctx, delay, dur, to, e = ease.inOutQuad) {
	const body = ctx.handle.body;
	ctx.after(delay, () => {
		const lean = body.lean;
		const turn = body.turn;
		const off = body.offset.clone();
		ctx.during(0, dur, (k) => {
			const q = e(k);
			if (to.lean !== void 0) body.lean = lean + (to.lean - lean) * q;
			if (to.turn !== void 0) body.turn = turn + (to.turn - turn) * q;
			if (to.offset) body.offset.copy(off).lerp(to.offset, q);
		});
	});
}
function cone(ctx, at, axis, size, s) {
	ctx.lathe(at, {
		profile: "cone",
		axis,
		radius: .18 * size,
		top: size * 1.1,
		height: 2.6 * size,
		flow: -6,
		tiles: [7, 1.5],
		streak: 1,
		rim: .7,
		fadeLo: .05,
		fadeHi: .5,
		dur: .32,
		bright: 1.3,
		grow: (k) => [1, .3 + .7 * ease.outExpo(clamp01(k * 3))],
		erode: (k) => ease.inQuad(span(k, .3, 1)),
		edge: .1
	});
	for (let j = 1; j <= 2; j++) ctx.band(at.clone().addScaledVector(axis, .6 * j * size), {
		radius: (.6 + .4 * j) * size * s,
		inner: .82,
		normal: axis,
		hard: .6,
		noise: 1,
		dur: .28,
		delay: .03 * j
	});
}
function knuckle(f, sign) {
	return f.from.clone().addScaledVector(f.aim, -.1).addScaledVector(f.side, .26 * sign).add(new THREE.Vector3(0, .05, 0));
}
function ghost(ctx, from, to, delay, dur, s) {
	ctx.after(delay, () => {
		const prev = from.clone();
		ctx.during(0, dur, (k, dt) => {
			const head = from.clone().lerp(to, ease.outExpo(k));
			const vel = dt > 0 ? head.clone().sub(prev).divideScalar(dt) : new THREE.Vector3();
			ctx.emit("glow", 1, {
				p: head,
				speed: 0,
				life: .07,
				size: .26 * s,
				colors: ctx.cols("core", "main"),
				bright: 1.1 * ctx.B * ctx.glare,
				fadeIn: 0
			});
			ctx.trail(head, prev, vel, dt * .3, .4 * s);
			prev.copy(head);
		}, () => {
			ctx.glow(to, .25 * s, .07, 1);
			ctx.emit("spark", 5, {
				p: to,
				v: () => randomDir().multiplyScalar(2.5),
				life: [.08, .18],
				size: [.01, .016],
				stretch: .04,
				colors: ctx.cols("core", "main"),
				bright: 2.2 * ctx.B,
				fadeIn: 0
			});
		});
	});
}
function rush(ctx, p) {
	const f = frame$1(ctx);
	const s = ctx.scale * p.size;
	const n = Math.max(3, Math.round(p.count));
	const body = ctx.handle.body;
	ctx.handle.emit("cast");
	ctx.part("cast");
	pose(ctx, 0, p.windup, {
		lean: -.15,
		offset: f.aim.clone().multiplyScalar(-.1)
	});
	ctx.after(p.windup, () => ctx.handle.emit("release"));
	const reach = f.to.clone().addScaledVector(f.aim, -.35);
	const back = f.to.clone().addScaledVector(f.aim, .25);
	const spot = (w) => reach.clone().addScaledVector(f.side, (Math.random() - .5) * .8 * s * w).add(new THREE.Vector3(0, (Math.random() - .4) * 1.1 * s * w, 0));
	const lunge = f.aim.clone().multiplyScalar(.25);
	ctx.during(p.windup, n * p.gap, (k, dt) => {
		ctx.emit("spark", poisson((60 + 140 * k) * dt), {
			p: back,
			jitter: .25 * s,
			v: () => f.aim.clone().multiplyScalar(5 + Math.random() * 8).add(randomDir().multiplyScalar(2.5)),
			life: [.12, .3],
			size: [.01, .02],
			gravity: 5,
			stretch: .05,
			colors: ctx.cols("core", "main"),
			bright: 2.4 * ctx.B,
			fadeIn: 0
		});
		if (Math.random() < dt * 25) ctx.glow(reach, (.3 + .45 * k) * s, .08, .6 + k);
	});
	for (let i = 0; i < n; i++) {
		const k = i / Math.max(n - 1, 1);
		const sign = i % 2 ? -1 : 1;
		const t0 = p.windup + i * p.gap;
		const at = spot(1);
		const start = knuckle(f, sign).add(new THREE.Vector3(0, (Math.random() - .5) * .2, 0));
		ctx.after(t0, () => {
			ctx.part("swing");
			body.lean = .2 + Math.random() * .12;
			body.turn = (.2 + Math.random() * .15) * sign;
			body.offset.copy(lunge).multiplyScalar(.85 + Math.random() * .3);
		});
		for (let g = 0; g < 2; g++) ghost(ctx, knuckle(f, g ? -sign : sign).add(lunge).add(new THREE.Vector3(0, (Math.random() - .5) * .3, 0)), spot(1.3), t0 + Math.random() * p.gap, p.gap * .8, s);
		limb(ctx, "fist", {
			delay: t0,
			dur: p.gap * .7,
			path: (q) => start.clone().add(body.offset).lerp(at, q),
			after: p.gap * .3,
			arrive: (hit) => {
				ctx.part("hit");
				const big = i % 3 === 2;
				ctx.hitmark(hit, {
					size: (.18 + .1 * Math.random() + .12 * k + (big ? .12 : 0)) * s,
					spikes: 8 + Math.floor(Math.random() * 5),
					dur: .08,
					angle: Math.random() * Math.PI
				});
				ctx.burst(hit, {
					count: 8 + 10 * k,
					dir: f.aim,
					speed: 8,
					spread: .45,
					scale: .35
				});
				ctx.glow(hit, (.3 + .2 * k) * s, .08, 1.2);
				ctx.band(hit.clone().addScaledVector(f.aim, .2), {
					radius: (.25 + .2 * k + (big ? .15 : 0)) * s,
					inner: .78,
					normal: f.aim,
					hard: .7,
					noise: 1,
					dur: .14
				});
				if (big) ctx.wave(hit, .6 + .5 * k, .2, .5);
				ctx.hit(hit, .3, i === 0 ? "first" : "tick", f.aim);
			}
		});
	}
	const tEnd = p.windup + n * p.gap + .05;
	pose(ctx, tEnd, .1, {
		lean: -.1,
		turn: -.4,
		offset: f.aim.clone().multiplyScalar(.1)
	});
	const final = knuckle(f, 1);
	limb(ctx, "fist", {
		delay: tEnd + .1,
		dur: .07,
		path: (q) => final.clone().add(body.offset).lerp(reach, q),
		arrive: (at) => {
			ctx.part("hit");
			body.lean = .4;
			body.turn = .3;
			body.offset.copy(f.aim).multiplyScalar(.4);
			ctx.lines(at, {
				size: 1.6 * s,
				parallel: ctx.screenAngle(at, f.aim),
				dur: .22,
				count: 18,
				width: .3,
				bright: 1.2
			});
			ctx.impact(at, {
				power: p.power,
				dir: f.aim,
				ringNormal: f.aim,
				scale: .9 * p.size,
				extra: p.power >= 1.5,
				role: "final"
			});
			cone(ctx, at, f.aim, .9 * p.size, s);
		}
	});
	settle(ctx, tEnd + .4);
}
rush.defaults = {
	windup: .15,
	count: 10,
	gap: .065,
	size: 1,
	power: 1.7
};
function uppercut(ctx, p) {
	const f = frame$1(ctx);
	const s = ctx.scale * p.size;
	const body = ctx.handle.body;
	ctx.handle.emit("cast");
	ctx.part("cast");
	pose(ctx, 0, p.windup, {
		lean: .3,
		turn: .35,
		offset: new THREE.Vector3(0, -.25, 0).addScaledVector(f.aim, .15)
	});
	const low = f.from.clone().addScaledVector(f.aim, .3).addScaledVector(f.side, .2).add(new THREE.Vector3(0, -.75, 0));
	ctx.during(0, p.windup, (k, dt) => {
		if (Math.random() < dt * 25) ctx.glow(low.clone().add(body.offset), (.15 + .25 * k) * s, .08, 1 + k);
	});
	const hitAt = f.to.clone().addScaledVector(f.aim, -.3);
	const top = hitAt.clone().add(new THREE.Vector3(0, .9 * s, 0));
	ctx.after(p.windup, () => {
		ctx.handle.emit("release");
		ctx.part("swing");
	});
	pose(ctx, p.windup, p.rise, {
		lean: -.2,
		turn: -.2,
		offset: new THREE.Vector3(0, .25, 0).addScaledVector(f.aim, .45)
	}, ease.outQuad);
	const curve = (k) => {
		const a = low.clone().add(new THREE.Vector3(0, .25, 0));
		const b = hitAt.clone().add(new THREE.Vector3(0, -.2, 0));
		return k < .6 ? a.lerp(b, k / .6) : b.lerp(top, (k - .6) / .4);
	};
	let landed = false;
	limb(ctx, "fist", {
		delay: p.windup,
		dur: p.rise,
		ease: (t) => t,
		path: (k) => {
			if (!landed && k >= .6) {
				landed = true;
				ctx.part("hit");
				ctx.impact(hitAt, {
					power: p.power,
					dir: UP$4,
					push: UP$4,
					ringNormal: UP$4,
					scale: .85 * p.size,
					extra: p.power >= 1.5,
					role: "final"
				});
				ctx.lines(hitAt.clone().add(new THREE.Vector3(0, .8, 0)), {
					size: 1.8 * s,
					parallel: Math.PI / 2,
					dur: .3,
					count: 18,
					width: .3,
					bright: 1.2
				});
				cone(ctx, hitAt, UP$4, .8 * p.size, s);
				ctx.emitShape("spark", 50, {
					type: "sphere",
					at: hitAt,
					r: .25 * s
				}, {
					v: () => UP$4.clone().multiplyScalar(6 + Math.random() * 6).add(randomDir().multiplyScalar(1.5)),
					life: [.25, .5],
					size: [.01, .02],
					gravity: 8,
					stretch: .05,
					colors: ctx.cols("core", "main"),
					bright: 2.6 * ctx.B,
					fadeIn: 0
				});
			}
			return curve(k);
		}
	});
	settle(ctx, p.windup + p.rise + .25, .4);
}
uppercut.defaults = {
	windup: .2,
	rise: .14,
	size: 1,
	power: 1.7
};
function kick(ctx, p) {
	const f = frame$1(ctx);
	const s = ctx.scale * p.size;
	const body = ctx.handle.body;
	const hip = ctx.ground(f.from).add(new THREE.Vector3(0, p.height, 0));
	const reach = Math.min(Math.max(f.dist * .75, 1.1), 1.7);
	const e1 = f.aim;
	const e2 = f.side;
	const a0 = 2.6;
	const a1 = -.9;
	const at = (a) => hip.clone().add(body.offset).addScaledVector(e1, Math.cos(a) * reach).addScaledVector(e2, Math.sin(a) * reach);
	ctx.handle.emit("cast");
	ctx.part("cast");
	pose(ctx, 0, p.windup, {
		lean: -.2,
		turn: .9,
		offset: f.aim.clone().multiplyScalar(-.1)
	});
	ctx.after(p.windup, () => {
		ctx.handle.emit("release");
		ctx.part("swing");
		ctx.arc({
			pivot: hip.clone().add(body.offset),
			e1,
			e2,
			a0,
			a1,
			r0: reach * .55,
			r1: reach * 1.05,
			dur: p.dur,
			ease: ease.slash,
			lag: .55,
			hold: .15
		});
	});
	pose(ctx, p.windup, p.dur, {
		lean: -.35,
		turn: -1.1,
		offset: f.aim.clone().multiplyScalar(.2)
	}, ease.slash);
	let landed = false;
	limb(ctx, "foot", {
		delay: p.windup,
		dur: p.dur,
		ease: ease.slash,
		size: p.size,
		path: (k) => {
			const a = a0 + -3.5 * k;
			if (!landed && a <= .05) {
				landed = true;
				ctx.part("hit");
				const t = f.to.clone().addScaledVector(f.aim, -.25);
				const push = f.aim.clone().addScaledVector(f.side, -.8).normalize();
				ctx.impact(t, {
					power: p.power,
					dir: push,
					ringNormal: "camera",
					scale: .9 * p.size,
					extra: p.power >= 1.5,
					role: "final"
				});
				ctx.hitmark(t, {
					size: 1.1 * s,
					spikes: 10,
					dur: .18,
					angle: ctx.screenAngle(t, push)
				});
				ctx.lines(t, {
					size: 1.6 * s,
					parallel: ctx.screenAngle(t, push),
					dur: .22,
					count: 16,
					width: .3,
					bright: 1.1
				});
				ctx.part("swing");
			}
			return at(a);
		}
	});
	settle(ctx, p.windup + p.dur + .15, .4);
}
kick.defaults = {
	windup: .16,
	dur: .16,
	height: 1.15,
	size: 1,
	power: 1.6
};
function heel(ctx, p) {
	const f = frame$1(ctx);
	const s = ctx.scale * p.size;
	const body = ctx.handle.body;
	const hip = ctx.ground(f.from).add(new THREE.Vector3(0, 1, 0));
	const reach = Math.min(Math.max(f.dist * .8, 1.2), 1.8);
	const at = (a) => hip.clone().add(body.offset).addScaledVector(f.aim, Math.cos(a) * reach).addScaledVector(UP$4, Math.sin(a) * reach);
	const hi = 1.75;
	const lo = -.15;
	ctx.handle.emit("cast");
	ctx.part("cast");
	pose(ctx, 0, p.windup, {
		lean: -.35,
		offset: new THREE.Vector3(0, .15, 0).addScaledVector(f.aim, .1)
	});
	limb(ctx, "foot", {
		delay: 0,
		dur: p.windup,
		ease: ease.outCubic,
		size: p.size,
		after: 0,
		path: (k) => at(-.6 + 2.35 * k)
	});
	ctx.after(p.windup * .7, () => ctx.star(at(hi), .6 * s, .2, 2.5));
	ctx.after(p.windup, () => {
		ctx.handle.emit("release");
		ctx.part("swing");
		ctx.arc({
			pivot: hip.clone().add(body.offset),
			e1: f.aim,
			e2: UP$4,
			a0: hi,
			a1: lo,
			r0: reach * .55,
			r1: reach * 1.05,
			dur: p.dur,
			ease: ease.inQuad,
			lag: .5,
			hold: .15
		});
	});
	pose(ctx, p.windup, p.dur, {
		lean: .35,
		offset: f.aim.clone().multiplyScalar(.25)
	}, ease.inQuad);
	limb(ctx, "foot", {
		delay: p.windup + .001,
		dur: p.dur,
		ease: ease.inQuad,
		size: p.size,
		path: (k) => at(hi + -1.9 * k),
		arrive: () => {
			ctx.part("hit");
			const t = f.to.clone().add(new THREE.Vector3(0, .3, 0)).addScaledVector(f.aim, -.2);
			const g = ctx.ground(f.to);
			ctx.screenFlash(.08);
			ctx.impact(t, {
				power: p.power,
				dir: DOWN,
				push: DOWN,
				ringNormal: "up",
				scale: 1 * p.size,
				extra: true,
				role: "final"
			});
			ctx.lines(t.clone().add(new THREE.Vector3(0, .8, 0)), {
				size: 1.8 * s,
				parallel: Math.PI / 2,
				dur: .25,
				count: 16,
				width: .3,
				bright: 1.1
			});
			ctx.decal(g, 1.8 * s, 5);
			ctx.ring(g, 2.2 * s, {
				dur: .5,
				thick: .06
			});
			ctx.dust(g, 1.3 * s);
			ctx.rocks(g, 8, .8 * s, () => randomDir().setY(.6 + Math.random()).multiplyScalar(3 + Math.random() * 2));
		}
	});
	settle(ctx, p.windup + p.dur + .25, .4);
}
heel.defaults = {
	windup: .32,
	dur: .12,
	size: 1,
	power: 1.9
};
function palm(ctx, p) {
	const f = frame$1(ctx);
	const s = ctx.scale * p.size;
	const body = ctx.handle.body;
	ctx.handle.emit("cast");
	ctx.part("cast");
	pose(ctx, 0, p.windup, {
		lean: -.1,
		turn: .4,
		offset: f.aim.clone().multiplyScalar(-.1).add(new THREE.Vector3(0, -.15, 0))
	});
	const start = knuckle(f, 1).add(new THREE.Vector3(0, -.1, 0));
	const contact = f.to.clone().addScaledVector(f.aim, -.35);
	ctx.during(0, p.windup, (k, dt) => {
		if (Math.random() < dt * 30) ctx.glow(start.clone().add(body.offset), (.15 + .35 * k) * s, .08, 1 + 1.5 * k);
	});
	ctx.after(p.windup, () => {
		ctx.handle.emit("release");
		ctx.part("swing");
	});
	pose(ctx, p.windup, .08, {
		lean: .3,
		turn: -.3,
		offset: f.aim.clone().multiplyScalar(.45).add(new THREE.Vector3(0, -.1, 0))
	}, ease.outExpo);
	limb(ctx, "fist", {
		delay: p.windup,
		dur: .08,
		after: .3,
		path: (k) => start.clone().add(body.offset).lerp(contact, k),
		arrive: (at) => {
			ctx.part("hit");
			ctx.glow(at, .7 * s, .15, 1.6);
			ctx.ring(at, .6 * s, {
				normal: f.aim,
				dur: .22,
				thick: .12
			});
			ctx.wave(at, 1.2, .35, .8);
			ctx.hit(at, .5 * p.power, "first", f.aim);
			for (let i = 0; i < 4; i++) ctx.band(at.clone().addScaledVector(f.aim, .35 + i * .45), {
				radius: (.55 + i * .22) * s,
				inner: .8,
				normal: f.aim,
				hard: .7,
				noise: .6,
				dur: .3,
				delay: p.delay * .5 + i * .035
			});
			ctx.after(p.delay, () => {
				const out = f.to.clone().addScaledVector(f.aim, .9 * s);
				ctx.impact(f.to, {
					power: p.power,
					dir: f.aim,
					ringNormal: f.aim,
					scale: .8 * p.size,
					hit: false
				});
				ctx.burst(out, {
					count: 60,
					speed: 9,
					dir: f.aim,
					spread: .35,
					scale: .8
				});
				ctx.flare(out, 1.4 * s, .25);
				ctx.wave(out, 1.6, .4, 1);
				ctx.hit(f.to, p.power, "final", f.aim);
			});
		}
	});
	settle(ctx, p.windup + p.delay + .35, .4);
}
palm.defaults = {
	windup: .18,
	delay: .1,
	size: 1,
	power: 1.8
};
function tackle(ctx, p) {
	const f = frame$1(ctx);
	const s = ctx.scale * p.size;
	const body = ctx.handle.body;
	const run = Math.max(f.dist - .75, .2);
	ctx.handle.emit("cast");
	ctx.part("cast");
	pose(ctx, 0, p.charge, {
		lean: .45,
		turn: .6,
		offset: f.aim.clone().multiplyScalar(-.2).add(new THREE.Vector3(0, -.12, 0))
	});
	ctx.after(p.charge, () => {
		ctx.handle.emit("release");
		ctx.part("swing");
		const start = ctx.ground(f.from).add(body.offset);
		ctx.dust(start, .8 * s);
		let hit = false;
		ctx.during(0, p.dash, (k, dt) => {
			body.offset.copy(f.aim).multiplyScalar(-.2 + (run + .2) * ease.inQuad(k));
			body.lean = .5;
			body.turn = .6;
			const at = f.from.clone().add(body.offset);
			ctx.emit("smoke", poisson(50 * dt), {
				p: ctx.ground(at).setY(ctx.floor + .05),
				jitter: .2,
				v: () => f.aim.clone().multiplyScalar(-1.5).setY(.5),
				life: [.4, .7],
				size: [.15 * s, .25 * s],
				grow: 2,
				drag: 3,
				colors: [ctx.pal.smoke ?? new THREE.Color(.3, .28, .25), new THREE.Color(.3, .28, .25)],
				fadeIn: .03
			});
			if (Math.random() < dt * 30) ctx.lines(at, {
				size: 1.3 * s,
				parallel: ctx.screenAngle(at, f.aim),
				dur: .15,
				count: 12,
				width: .3,
				bright: .9
			});
			if (!hit && k >= .999) hit = true;
		}, () => {
			ctx.part("hit");
			const at = f.to.clone().addScaledVector(f.aim, -.4);
			ctx.screenFlash(.08);
			ctx.impact(at, {
				power: p.power,
				dir: f.aim,
				ringNormal: f.aim,
				scale: 1 * p.size,
				extra: p.power >= 1.5,
				role: "final"
			});
			ctx.hitmark(at, {
				size: 1.3 * s,
				spikes: 12,
				dur: .2,
				angle: ctx.screenAngle(at, f.aim)
			});
			for (let j = 1; j <= 3; j++) ctx.band(at.clone().addScaledVector(f.aim, .4 * j), {
				radius: (.6 + .3 * j) * s,
				inner: .82,
				normal: f.aim,
				hard: .6,
				noise: 1,
				dur: .28,
				delay: .03 * j
			});
			const held = body.offset.clone();
			ctx.during(0, .12, (k) => body.offset.copy(held).addScaledVector(f.aim, -.35 * ease.outCubic(k)));
			settle(ctx, .25, .4);
		});
	});
}
tackle.defaults = {
	charge: .22,
	dash: .2,
	size: 1,
	power: 1.8
};
function pound(ctx, p) {
	const f = frame$1(ctx);
	const s = ctx.scale * p.size;
	const body = ctx.handle.body;
	ctx.handle.emit("cast");
	ctx.part("cast");
	pose(ctx, 0, p.windup * .35, {
		lean: .25,
		offset: new THREE.Vector3(0, -.2, 0)
	});
	pose(ctx, p.windup * .35, p.windup * .65, {
		lean: -.25,
		offset: new THREE.Vector3(0, .6, 0).addScaledVector(f.aim, .2)
	}, ease.outCubic);
	const raised = () => f.from.clone().add(body.offset).add(new THREE.Vector3(0, .75, 0)).addScaledVector(f.aim, .1);
	const g = ctx.ground(f.from.clone().addScaledVector(f.aim, .75));
	limb(ctx, "fist", {
		delay: p.windup * .35,
		dur: p.windup * .65,
		ease: ease.outCubic,
		after: 0,
		path: () => raised()
	});
	ctx.after(p.windup, () => {
		ctx.handle.emit("release");
		ctx.part("swing");
	});
	pose(ctx, p.windup, .1, {
		lean: .38,
		offset: new THREE.Vector3(0, -.15, 0).addScaledVector(f.aim, .25)
	}, ease.inQuad);
	limb(ctx, "fist", {
		delay: p.windup + .001,
		dur: .1,
		ease: ease.inQuad,
		after: .25,
		path: (k) => raised().lerp(g.clone().setY(g.y + .1), k),
		arrive: () => {
			ctx.part("hit");
			ctx.screenFlash(.1);
			ctx.impact(g.clone().setY(g.y + .2), {
				power: p.power * .6,
				ringNormal: "up",
				scale: .9 * p.size,
				hit: false,
				extra: true
			});
			ctx.decal(g, 2 * s, 5);
			ctx.rocks(g, 10, .9 * s, () => randomDir().setY(.7 + Math.random()).multiplyScalar(3 + Math.random() * 3));
			const reach = g.clone().setY(0).distanceTo(f.to.clone().setY(0));
			const out = reach + 1.5;
			const dur = out / p.speed;
			ctx.band(g.clone().setY(g.y + .02), {
				radius: out * s,
				inner: .9,
				normal: "up",
				hard: .5,
				noise: 1,
				dur,
				grow: (k) => .05 + .95 * k,
				bright: 1.6
			});
			ctx.band(g.clone().setY(g.y + .02), {
				radius: out * .85 * s,
				inner: .8,
				normal: "up",
				hard: .3,
				noise: 1,
				dur,
				delay: .04,
				grow: (k) => .05 + .95 * k,
				colors: [
					"main",
					"accent",
					"accent"
				],
				bright: 1
			});
			ctx.wave(g, out * .8, dur, 1.2);
			ctx.during(0, dur, (k, dt) => {
				const r = out * k;
				ctx.emitShape("smoke", poisson(80 * dt), {
					type: "circle",
					at: g.clone().setY(g.y + .05),
					r
				}, {
					outward: [1, 2],
					v: () => new THREE.Vector3(0, .6, 0),
					life: [.4, .7],
					size: [.15 * s, .28 * s],
					grow: 2,
					drag: 3,
					colors: [ctx.pal.smoke ?? new THREE.Color(.3, .28, .25), new THREE.Color(.3, .28, .25)],
					fadeIn: .03
				});
				ctx.emitShape("spark", poisson(160 * dt), {
					type: "circle",
					at: g.clone().setY(g.y + .05),
					r
				}, {
					outward: [1, 3],
					v: () => new THREE.Vector3(0, 2 + Math.random() * 3, 0),
					life: [.2, .4],
					size: [.01, .018],
					gravity: 9,
					stretch: .04,
					colors: ctx.cols("core", "main"),
					bright: 2.4 * ctx.B,
					fadeIn: 0
				});
			});
			ctx.after(reach / p.speed, () => {
				ctx.impact(f.to, {
					power: p.power,
					dir: UP$4,
					push: f.aim.clone().add(UP$4).normalize(),
					ringNormal: "camera",
					scale: .7 * p.size,
					role: "final"
				});
			});
		}
	});
	settle(ctx, p.windup + .45, .4);
}
pound.defaults = {
	windup: .38,
	speed: 9,
	size: 1,
	power: 1.8
};
//#endregion
//#region src/runtime/recipes/support.ts
var UP$3 = new THREE.Vector3(0, 1, 0);
var SYMBOL = {
	light: 2,
	water: 2,
	ice: 2,
	fire: 2,
	thunder: 2,
	arcane: 0,
	wind: 3,
	earth: 3,
	poison: 3,
	dark: 0
};
function bodyHeight(ctx, p) {
	return Math.min(Math.max(ctx.heightAboveFloor(p) * 1.5, 1.2), 2.4);
}
function healFlavor(ctx, g, h, r, dt, k) {
	const B = ctx.B * ctx.glare;
	const at = g();
	const body = {
		type: "body",
		at,
		r: r * .8,
		h: h * .8
	};
	switch (ctx.element) {
		case "water":
			ctx.emitShape("bubble", poisson(18 * dt), body, {
				v: () => new THREE.Vector3(0, .6 + Math.random() * .4, 0),
				life: [1, 1.6],
				size: [.04, .08],
				sizeCurve: "bell",
				colors: ctx.cols("core", "main"),
				bright: 1.3 * B,
				fadeIn: .1
			});
			if (Math.random() < dt * 2.5) ctx.band(at.clone().setY(at.y + .02), {
				radius: r * 1.6,
				inner: .85,
				dur: .9,
				noise: 0,
				bright: 1
			});
			break;
		case "wind":
			ctx.emitShape("mist", poisson(20 * dt), body, {
				v: () => new THREE.Vector3(0, 1, 0),
				tangent: 1.5,
				life: [.6, 1],
				size: [.12, .2],
				stretch: .15,
				colors: ctx.cols("core", "main"),
				bright: .6 * B,
				fadeIn: .1
			});
			break;
		case "earth":
			ctx.emitShape("shard", poisson(14 * dt), {
				type: "disc",
				at,
				r: r * 1.3
			}, {
				v: () => new THREE.Vector3(0, .7 + Math.random() * .5, 0),
				life: [1, 1.5],
				size: [.05, .09],
				spin: [-2, 2],
				colors: ctx.cols("core", "main", "accent"),
				bright: 1.4 * B,
				fadeIn: .1,
				alphaCurve: "hold",
				dissolve: .8
			});
			break;
		case "ice":
			ctx.emitShape("shard", poisson(16 * dt), body, {
				v: () => new THREE.Vector3(0, .5 + Math.random() * .4, 0),
				life: [.9, 1.4],
				size: [.04, .07],
				spin: [-3, 3],
				colors: ctx.cols("core", "main"),
				bright: 2 * B,
				fadeIn: .1,
				sizeCurve: "bell"
			});
			ctx.emitShape("mist", poisson(10 * dt), {
				type: "disc",
				at,
				r: r * 1.2
			}, {
				v: () => new THREE.Vector3(0, .3, 0),
				life: [1, 1.5],
				size: [.3, .5],
				grow: 1.4,
				colors: ctx.cols("main", "accent"),
				bright: .5 * B,
				fadeIn: .2
			});
			break;
		case "fire":
			ctx.emitShape("mote", poisson(40 * dt), body, {
				v: () => new THREE.Vector3(0, .8 + Math.random() * .6, 0),
				life: [.8, 1.4],
				size: [.02, .035],
				flicker: .5,
				curl: 1.2,
				colors: [ctx.pal.core, ctx.pal.core.clone().lerp(ctx.pal.main, .4)],
				bright: 2.4 * B
			});
			break;
		case "thunder":
			if (k * 3.2 % 1 < dt * 3.2) {
				ctx.band(at.clone().setY(at.y + h * .5), {
					radius: r * 1.4,
					inner: .8,
					normal: "up",
					dur: .3,
					noise: 1,
					bright: 1.6
				});
				ctx.emitShape("spark", 20, body, {
					outward: 2.5,
					life: [.12, .25],
					size: [.01, .018],
					stretch: .04,
					colors: ctx.cols("core", "main"),
					bright: 3 * B,
					fadeIn: 0
				});
			}
			break;
		case "arcane":
			ctx.emitShape("glyph", poisson(10 * dt), {
				type: "circle",
				at: at.clone().setY(at.y + h * (.2 + .6 * Math.random())),
				r: r * 1.2
			}, {
				tangent: 1.2,
				v: () => new THREE.Vector3(0, .25, 0),
				life: [.9, 1.3],
				size: [.1, .14],
				sizeCurve: "bell",
				colors: ctx.cols("core", "main"),
				bright: 1.8 * B,
				fadeIn: .1,
				hook: ctx.hook({ fields: [{
					kind: "vortex",
					power: 4,
					at,
					shape: "tube",
					max: 3
				}] })
			});
			break;
		case "dark": {
			const center = at.clone().setY(at.y + h * .5);
			ctx.emitShape("mote", poisson(70 * dt), {
				type: "sphere",
				at: center,
				r: 2.4
			}, {
				hook: ctx.hook({ seek: {
					target: center,
					speed: 3.5,
					steer: 3,
					arrive: .25
				} }),
				v: () => randomDir().multiplyScalar(1.2),
				life: 2,
				size: [.02, .04],
				stretch: .04,
				colors: [ctx.pal.core, new THREE.Color(.9, .15, .2)],
				bright: 2.2 * B,
				fadeIn: .15,
				alphaCurve: "hold"
			});
			ctx.smoke(at.clone().setY(at.y + .2), poisson(8 * dt), {
				jitter: r,
				speed: [.2, .5],
				size: [.3, .5],
				delay: 0
			});
			break;
		}
		case "poison":
			ctx.emitShape("bubble", poisson(22 * dt), body, {
				v: () => new THREE.Vector3(0, .5 + Math.random() * .4, 0),
				life: [.8, 1.3],
				size: [.04, .08],
				sizeCurve: "bell",
				colors: ctx.cols("core", "main"),
				bright: 1.1 * B,
				fadeIn: .1
			});
			break;
		default: ctx.emitShape("star", poisson(6 * dt), body, {
			v: () => new THREE.Vector3(0, .6, 0),
			life: [.6, 1],
			size: [.08, .14],
			sizeCurve: "bell",
			colors: ctx.cols("core", "main"),
			bright: 2 * B
		});
	}
}
function heal(ctx, p) {
	const s = ctx.scale * p.size;
	const B = ctx.B * ctx.glare;
	const r = p.radius * s;
	const aimFrom = ctx.from();
	ctx.part("cast");
	ctx.handle.emit("cast");
	const hand = ctx.to().sub(aimFrom).normalize();
	ctx.circle(aimFrom.clone().addScaledVector(hand, .15), .45 * ctx.scale, p.charge + .3, {
		normal: hand,
		spin: -1,
		bright: 1.6,
		slot: "hand"
	});
	ctx.during(0, p.charge, (k, dt) => {
		ctx.emitShape("mote", poisson(70 * dt), {
			type: "sphere",
			at: aimFrom,
			r: .6 * ctx.scale
		}, {
			hook: ctx.hook({ seek: {
				target: aimFrom,
				speed: 2.5,
				steer: 4,
				arrive: .08
			} }),
			v: () => randomDir().multiplyScalar(.8),
			life: .8,
			size: [.02, .035],
			colors: ctx.cols("core", "main"),
			bright: 2.2 * B,
			alphaCurve: "hold",
			fadeIn: .1
		});
		if (Math.random() < dt * 15) ctx.glow(aimFrom, (.3 + .4 * k) * ctx.scale, .12, 1 + k);
	});
	ctx.after(p.charge, () => {
		ctx.handle.emit("release");
		const a = ctx.from();
		const n = Math.round(10 + 6 * p.symbols);
		for (let i = 0; i < n; i++) ctx.after(i * .02, () => {
			const target = () => ctx.to();
			ctx.emit("glow", 1, {
				p: a.clone(),
				v: () => randomDir().setY(Math.random() * 1.5).multiplyScalar(3),
				hook: ctx.hook({ seek: {
					target: target(),
					speed: 14,
					steer: 7,
					arrive: .35
				} }),
				life: 1.2,
				size: [.05, .08],
				colors: ctx.cols("core", "main"),
				bright: 1.6 * B,
				alphaCurve: "hold",
				fadeIn: .05,
				stretch: .05
			});
		});
	});
	const land = p.charge + .35;
	ctx.part("main");
	const g = () => ctx.ground(ctx.to());
	const h = bodyHeight(ctx, ctx.to());
	const total = land + p.dur;
	ctx.circle(g(), 1.5 * r, total + .3 - p.charge * .5, {
		slot: "target",
		spin: .5,
		bright: 1.3
	});
	ctx.during(p.charge * .5, land - p.charge * .5, (_k, dt) => {
		ctx.emitShape("mote", poisson(40 * dt), {
			type: "circle",
			at: g(),
			r: 1.6 * r
		}, {
			hook: ctx.hook({ fields: [{
				kind: "attract",
				power: 3,
				at: g(),
				max: 3
			}] }),
			v: () => new THREE.Vector3(0, .3, 0),
			life: [.5, .8],
			size: [.02, .035],
			colors: ctx.cols("core", "main"),
			bright: 2 * B,
			fadeIn: .1
		});
	});
	ctx.after(land, () => {
		const at = g();
		const chest = at.clone().setY(at.y + h * .55);
		ctx.handle.emit("hit", {
			point: chest.clone(),
			power: 0,
			index: 0,
			shake: 0,
			hitStop: 0,
			role: "final",
			dir: new THREE.Vector3(0, 1, 0)
		});
		ctx.emit("glow", 1, {
			p: chest,
			speed: 0,
			life: .35,
			size: 1.3 * r,
			grow: 1.4,
			sizeCurve: "burst",
			colors: ctx.cols("core", "main"),
			bright: 1.4 * B,
			fadeIn: .1,
			alphaCurve: "bell"
		});
		ctx.band(at.clone().setY(at.y + .03), {
			radius: 1.6 * r,
			inner: .7,
			dur: .7,
			noise: .6,
			grow: (k) => .3 + .7 * ease.outQuad(k)
		});
		ctx.light(chest, 2.2, .5);
		const dur = p.dur;
		const fadeCol = (k) => Math.min(k * dur / .25, 1) * (1 - ease.inQuad(span(k, .75, 1)));
		ctx.lathe(at, {
			profile: "cone",
			radius: 1.05 * r,
			top: .75 * r,
			height: h * 1.35,
			flow: .8,
			twist: 1.2,
			tiles: [7, 1.2],
			streak: 1,
			rim: .85,
			fadeLo: .05,
			fadeHi: .65,
			dur,
			bright: .9,
			fade: fadeCol,
			erode: (k) => ease.inQuad(span(k, .7, 1)),
			grow: (k) => [1, ease.outCubic(clamp01(k * dur / .45))],
			at: g
		});
		const ribbons = Math.round(p.ribbons);
		for (let i = 0; i < ribbons; i++) ctx.helix({
			center: at,
			r0: 1.25 * r,
			r1: .65 * r,
			height: h * 1.1,
			turns: p.turns,
			phase: i / ribbons * Math.PI * 2,
			width: .16,
			dur: .9,
			lag: .8,
			hold: dur * .35,
			delay: .1 + i * .07,
			ease: ease.inOutCubic,
			bright: 1.6,
			at: g
		});
		const glyph = SYMBOL[ctx.element] ?? 2;
		const hook = ctx.hook({ fields: [{
			kind: "wind",
			power: .6,
			axis: UP$3
		}] });
		ctx.during(0, dur * .8, (k, dt) => {
			const at2 = g();
			ctx.emitShape("glyph", poisson(9 * p.symbols * dt), {
				type: "body",
				at: at2,
				r: .7 * r,
				h: h * .9
			}, {
				hook,
				v: () => new THREE.Vector3(0, .45 + Math.random() * .3, 0),
				life: [1.2, 1.9],
				size: [.13, .2],
				sizeCurve: "bell",
				alphaCurve: "bell",
				colors: ctx.cols("core", "main"),
				bright: 1.9 * B,
				fadeIn: 0,
				variant: glyph
			});
			ctx.emitShape("mote", poisson(35 * dt), {
				type: "body",
				at: at2,
				r: .9 * r,
				h: h * .4
			}, {
				hook,
				v: () => new THREE.Vector3(0, .6 + Math.random() * .6, 0),
				life: [.9, 1.5],
				size: [.018, .03],
				alphaCurve: "bell",
				colors: ctx.cols("core", "main"),
				bright: 2.4 * B,
				fadeIn: 0
			});
			healFlavor(ctx, g, h, r, dt, k);
		});
		ctx.after(dur * .78, () => {
			const top = g();
			top.y += h * .6;
			ctx.emit("mote", 30, {
				p: top,
				jitter: .3 * r,
				v: () => randomDir().multiplyScalar(.8).add(new THREE.Vector3(0, .6, 0)),
				life: [.6, 1],
				size: [.02, .035],
				drag: 1.5,
				alphaCurve: "bell",
				colors: ctx.cols("core", "main"),
				bright: 2.4 * B
			});
			ctx.emit("glow", 1, {
				p: top,
				speed: 0,
				life: .5,
				size: .9 * r,
				colors: ctx.cols("core", "main"),
				bright: .8 * B,
				alphaCurve: "bell",
				fadeIn: 0
			});
		});
		const light = ctx.hold(5);
		ctx.during(0, dur, (k) => light.set(g().setY(g().y + h * .5), 33 * fadeCol(k)), () => light.release(.3));
	});
}
heal.defaults = {
	circleHand: 1,
	circleTarget: 1,
	charge: .3,
	dur: 1.6,
	radius: .65,
	size: 1,
	turns: 1.3,
	ribbons: 3,
	symbols: 1
};
function buffFlavor(ctx, g, h, r, dt, age, state) {
	const B = ctx.B * ctx.glare;
	const body = {
		type: "body",
		at: g,
		r: r * .9,
		h: h * .7
	};
	switch (ctx.element) {
		case "fire":
			ctx.emitShape("flame", poisson(45 * dt), body, {
				v: () => new THREE.Vector3(0, 1.6 + Math.random(), 0),
				life: [.3, .5],
				size: [.14, .22],
				grow: 1.3,
				curl: 1.4,
				colors: ctx.cols("core", "main", "accent"),
				bright: .75 * B,
				fadeIn: .03
			});
			break;
		case "thunder":
			if (Math.random() < dt * 9) {
				const a = g.clone().add(new THREE.Vector3((Math.random() - .5) * r * 2, h * Math.random(), (Math.random() - .5) * r * 2));
				ctx.bolt(a, a.clone().add(randomDir().multiplyScalar(.5 + Math.random() * .4)), {
					dur: .1,
					width: .05,
					jag: .35
				});
			}
			if (Math.random() < dt * 12) ctx.glow(g.clone().setY(g.y + h * .55), .7 * r, .1, .8, ["core", "main"]);
			break;
		case "ice":
			ctx.emitShape("shard", poisson(14 * dt), {
				type: "circle",
				at: g.clone().setY(g.y + h * Math.random() * .8),
				r: r * 1.3
			}, {
				tangent: 2,
				v: () => new THREE.Vector3(0, .4, 0),
				life: [.8, 1.2],
				size: [.04, .08],
				spin: [-4, 4],
				colors: ctx.cols("core", "main"),
				bright: 2 * B,
				sizeCurve: "bell",
				hook: ctx.hook({ fields: [{
					kind: "vortex",
					power: 3,
					at: g,
					shape: "tube",
					max: 3
				}] })
			});
			ctx.emitShape("mist", poisson(12 * dt), {
				type: "disc",
				at: g,
				r: r * 1.3
			}, {
				v: () => new THREE.Vector3(0, .3, 0),
				life: [.8, 1.2],
				size: [.3, .45],
				grow: 1.4,
				colors: ctx.cols("main", "accent"),
				bright: .5 * B,
				fadeIn: .2
			});
			break;
		case "earth":
			if (!state.rocks) {
				state.rocks = true;
				const center = g.clone();
				for (let i = 0; i < 6; i++) {
					const a0 = i / 6 * Math.PI * 2;
					const y = h * (.25 + .5 * Math.random());
					const rr = r * (1.35 + Math.random() * .3);
					const size = .07 + Math.random() * .06;
					ctx.fx.rocks.spawn({
						p: center.clone(),
						size: new THREE.Vector3(size, size * .8, size),
						spin: 2 + Math.random() * 2,
						life: state.life ?? 4,
						grow: .25,
						shrink: .02,
						gravity: 12,
						bounce: .3,
						color: ctx.pal.main.clone().lerp(new THREE.Color(.35, .3, .26), .6).multiplyScalar(.32),
						drive: (pp, v, a2, d2) => {
							const th = a0 + a2 * 1.3;
							const bob = Math.sin(a2 * 2 + i) * .08;
							const prev = pp.clone();
							pp.set(center.x + Math.cos(th) * rr, center.y + y + bob, center.z + Math.sin(th) * rr);
							if (d2 > 0) v.subVectors(pp, prev).divideScalar(d2);
							return !!state.rocks && ctx.handle.playing;
						}
					});
				}
			}
			if (Math.random() < dt * 3) ctx.dust(g, .3);
			break;
		case "wind":
			ctx.emitShape("spark", poisson(50 * dt), {
				type: "circle",
				at: g.clone().setY(g.y + Math.random() * h),
				r: r * 1.2
			}, {
				tangent: 7,
				v: () => new THREE.Vector3(0, 2.5, 0),
				life: [.25, .45],
				size: [.01, .016],
				stretch: .08,
				colors: ctx.cols("core", "main"),
				bright: 1.8 * B,
				hook: ctx.hook({ fields: [{
					kind: "vortex",
					power: 12,
					at: g,
					shape: "tube",
					max: 3
				}, {
					kind: "attract",
					power: 6,
					at: g,
					shape: "tube",
					max: 3
				}] })
			});
			break;
		case "water":
			ctx.emitShape("spark", poisson(30 * dt), body, {
				v: () => new THREE.Vector3(Math.random() - .5, 2 + Math.random() * 1.5, Math.random() - .5),
				gravity: 7,
				life: [.5, .8],
				size: [.018, .03],
				stretch: .03,
				colors: ctx.cols("core", "main"),
				bright: 1.5 * B,
				hook: ctx.hook({ floorKill: true })
			});
			ctx.emitShape("mist", poisson(25 * dt), body, {
				tangent: 2,
				v: () => new THREE.Vector3(0, 1.2, 0),
				life: [.4, .7],
				size: [.12, .2],
				stretch: .14,
				colors: ctx.cols("core", "main", "accent"),
				bright: .8 * B
			});
			break;
		case "light":
			if (Math.random() < dt * 6) ctx.star(g.clone().add(new THREE.Vector3((Math.random() - .5) * r * 2, h * (.2 + .8 * Math.random()), (Math.random() - .5) * r * 2)), .25, .25, 2);
			ctx.emitShape("mote", poisson(40 * dt), body, {
				v: () => new THREE.Vector3(0, 1.5, 0),
				life: [.6, 1],
				size: [.02, .04],
				colors: ctx.cols("core", "main"),
				bright: 2.4 * B
			});
			break;
		case "dark":
			ctx.emitShape("smoke", poisson(14 * dt), {
				type: "body",
				at: g.clone().setY(g.y + h * .9),
				r,
				h: .3
			}, {
				v: () => new THREE.Vector3(0, -.6, 0),
				life: [.8, 1.3],
				size: [.25, .4],
				grow: 1.8,
				colors: [ctx.pal.smoke.clone().multiplyScalar(1.4), ctx.pal.smoke],
				fadeIn: .15
			});
			ctx.emitShape("mote", poisson(25 * dt), body, {
				v: () => new THREE.Vector3(0, 1, 0),
				life: [.5, .9],
				size: [.02, .035],
				colors: ctx.cols("core", "main"),
				bright: 2.2 * B
			});
			break;
		case "poison":
			ctx.emitShape("bubble", poisson(24 * dt), body, {
				v: () => new THREE.Vector3(0, .8, 0),
				life: [.5, .9],
				size: [.04, .08],
				sizeCurve: "bell",
				colors: ctx.cols("main", "accent"),
				bright: .9 * B
			});
			ctx.emitShape("spark", poisson(10 * dt), body, {
				v: () => new THREE.Vector3(0, -.2, 0),
				gravity: 6,
				life: [.6, 1],
				size: [.018, .03],
				stretch: .06,
				colors: ctx.cols("core", "main"),
				bright: 1.1 * B,
				hook: ctx.hook({ floorKill: true })
			});
			break;
		default:
			if (Math.floor(age * 1.2) !== Math.floor((age - dt) * 1.2)) for (const y of [.3, .75]) ctx.circle(g.clone().setY(g.y + h * y), r * 2.2, .8, {
				spin: y > .5 ? -2 : 2,
				bright: 1.2,
				style: 3
			});
			ctx.emitShape("glyph", poisson(6 * dt), body, {
				v: () => new THREE.Vector3(0, .8, 0),
				life: [.6, 1],
				size: [.08, .12],
				sizeCurve: "bell",
				colors: ctx.cols("core", "main"),
				bright: 1.8 * B
			});
	}
}
function buff(ctx, p) {
	const s = ctx.scale * p.size;
	const B = ctx.B * ctx.glare;
	const r = p.radius * s;
	const g = () => ctx.ground(ctx.from());
	const h = p.height * s;
	const f = 1 / 60;
	ctx.part("cast");
	ctx.handle.emit("cast");
	ctx.circle(g(), 1.3 * ctx.scale, p.charge + .6, {
		slot: "feet",
		spin: 1.2,
		bright: 1.6
	});
	ctx.during(0, p.charge, (k, dt) => {
		const c = g().setY(g().y + h * .5);
		ctx.emitShape("mote", poisson(120 * dt), {
			type: "sphere",
			at: c,
			r: 1.6 * s
		}, {
			hook: ctx.hook({ fields: [{
				kind: "attract",
				power: 14,
				at: c,
				max: 3
			}] }),
			v: () => new THREE.Vector3(),
			life: [.25, .4],
			size: [.02, .04],
			stretch: .05,
			drag: 1.5,
			colors: ctx.cols("core", "main"),
			bright: 2.4 * B,
			fadeIn: .05
		});
		if (Math.random() < dt * 20) ctx.glow(c, (.4 + .5 * k) * s, .1, 1 + k);
	});
	ctx.after(p.charge, () => {
		ctx.handle.emit("release");
		const at = g();
		const c = at.clone().setY(at.y + h * .5);
		const post = ctx.fx.post;
		if (post) {
			post.flashTint(ctx.pal.core);
			post.blinkAmount = (ctx.fx.photosensitive ? .05 : .1) * ctx.glare;
			post.blinkT = 2 * f;
		}
		ctx.band(at.clone().setY(at.y + .03), {
			radius: 3 * s,
			inner: .6,
			dur: .45,
			noise: 1,
			grow: (k) => .12 + .88 * ease.outExpo(k)
		});
		ctx.band(c, {
			radius: 1.6 * s,
			inner: .82,
			normal: "camera",
			dur: .3,
			hard: .6,
			noise: 1
		});
		ctx.lines(c, {
			size: 3 * s,
			dur: .3,
			count: 40,
			density: .5,
			inner: .5,
			width: .14,
			bright: 1.1
		});
		ctx.dust(at, 1.3 * s);
		ctx.emitShape("spark", 50, {
			type: "circle",
			at: at.clone().setY(at.y + .1),
			r: .4 * s
		}, {
			outward: [5, 9],
			v: () => new THREE.Vector3(0, 1 + Math.random() * 2, 0),
			life: [.3, .55],
			size: [.012, .022],
			drag: 3,
			stretch: .05,
			colors: ctx.cols("core", "main"),
			bright: 3 * B,
			fadeIn: 0
		});
		ctx.fx.lights.flash(c, ctx.pal.main, 54 * ctx.glare, .35, 7);
		if (ctx.fx.feel) ctx.fx.shake(.25);
	});
	ctx.part("main");
	const hold = p.hold;
	const start = p.charge + .02;
	const warn = Math.min(1, hold * .3);
	const life = (k) => {
		const age = k * hold;
		const blink = age > hold - warn ? .55 + .45 * Math.cos((age - (hold - warn)) * Math.PI * 2 * 4) : 1;
		const pulse = 1 + .2 * Math.sin(age * Math.PI * 2 * p.pulse);
		return clamp01(age / .2) * blink * pulse * (1 - ease.inQuad(span(age, hold - .4, hold)));
	};
	const size = (k) => {
		const age = k * hold;
		const pop = age < .25 ? ease.outBackStrong(age / .25) : 1;
		return [pop * (1 + .06 * Math.sin(age * Math.PI * 2 * p.pulse)), pop * (1 + .04 * Math.sin(age * Math.PI * 2 * p.pulse + 1))];
	};
	const erodeEnd = (base) => (k) => base + (1 - base) * ease.inQuad(span(k * hold, hold - .4, hold));
	const dark = ctx.element === "dark";
	ctx.after(start, () => {
		const opts = {
			at: g,
			dur: hold,
			fade: life,
			grow: size,
			fadeLo: .02
		};
		ctx.lathe(g(), {
			...opts,
			profile: "cylinder",
			radius: 1.15 * r,
			top: .8 * r,
			height: h * 1.3,
			flow: 2.6 * p.rate,
			twist: 1.9,
			tiles: [6, 1.6],
			streak: .5,
			rim: .4,
			fadeHi: .6,
			wobble: .1,
			bright: dark ? .9 : 1.1,
			erode: erodeEnd(.42),
			edge: .12,
			smoke: dark,
			colors: dark ? [
				"core",
				"smoke",
				"smoke"
			] : void 0
		});
		ctx.lathe(g(), {
			...opts,
			profile: "cylinder",
			radius: .9 * r,
			top: .5 * r,
			height: h * 1.5,
			flow: 3.3 * p.rate,
			twist: -1.2,
			tiles: [8, 2],
			streak: .7,
			rim: .2,
			fadeHi: .55,
			bright: 1.1,
			erode: erodeEnd(.55),
			edge: .12,
			wobble: .12
		});
		ctx.lathe(g(), {
			...opts,
			profile: "vase",
			radius: .8 * r,
			height: h * .95,
			bulge: .2,
			flow: 1.6 * p.rate,
			twist: .8,
			tiles: [5, 1],
			streak: .6,
			rim: .9,
			fadeHi: .35,
			bright: .7
		});
		ctx.lathe(g(), {
			...opts,
			profile: "dome",
			radius: 1.3 * r,
			height: .35 * s,
			flow: 1.5,
			tiles: [6, 1],
			streak: .7,
			rim: .5,
			bright: .8,
			erode: erodeEnd(.3)
		});
		const state = { life: hold + 1.2 };
		const light = ctx.hold(6);
		ctx.during(0, hold, (k, dt, age) => {
			const at = g();
			const on = life(k);
			ctx.emitShape("spark", poisson(45 * p.rate * dt * Math.min(on, 1)), {
				type: "body",
				at,
				r: .9 * r,
				h: h * .6
			}, {
				v: () => new THREE.Vector3(0, 2 + Math.random() * 2, 0),
				life: [.4, .8],
				size: [.012, .02],
				stretch: .06,
				drag: .5,
				colors: ctx.cols("core", "main"),
				bright: 2.6 * B,
				fadeIn: 0
			});
			if (age < hold - .3) buffFlavor(ctx, at, h, r, dt, age, state);
			light.set(at.setY(at.y + h * .5), 36 * on);
		}, () => {
			state.rocks = false;
			light.release(.3);
			const at = g();
			ctx.smoke(at.clone().setY(at.y + .2), 8, {
				jitter: .3,
				speed: [.3, .8],
				size: [.3, .5],
				delay: 0
			});
			ctx.emit("mote", 25, {
				p: at.clone().setY(at.y + h * .5),
				jitter: .4,
				v: () => randomDir().multiplyScalar(1).add(new THREE.Vector3(0, .8, 0)),
				life: [.5, .9],
				size: [.02, .035],
				drag: 1.5,
				colors: ctx.cols("core", "main"),
				bright: 2 * B,
				alphaCurve: "bell"
			});
		});
	});
}
buff.defaults = {
	circleFeet: 1,
	charge: .3,
	hold: 2.6,
	radius: .55,
	height: 2,
	size: 1,
	rate: 1,
	pulse: 1.8
};
//#endregion
//#region src/runtime/recipes/strike.ts
var UP$2 = new THREE.Vector3(0, 1, 0);
function frame(ctx) {
	const from = ctx.from();
	const to = ctx.to();
	const aim = to.clone().sub(from).setY(0);
	if (aim.lengthSq() < 1e-6) aim.set(1, 0, 0);
	aim.normalize();
	return {
		from,
		to,
		aim,
		side: aim.clone().cross(UP$2).normalize()
	};
}
function strike(ctx, p) {
	const s = ctx.scale * p.size;
	const B = ctx.B * ctx.glare;
	const hits = Math.max(1, Math.round(p.hits));
	const gap = .16;
	ctx.part("swing");
	ctx.handle.emit("cast");
	const { aim, side } = frame(ctx);
	const fistAt = (k) => {
		const back = ctx.from().clone().addScaledVector(aim, -.2).addScaledVector(side, .28).add(new THREE.Vector3(0, .05, 0));
		const hit = ctx.to().addScaledVector(aim, -.3);
		return back.lerp(hit, k);
	};
	const charge = ctx.hold(4);
	const body = ctx.handle.body;
	body.limb = "fist";
	ctx.during(0, p.windup, (k, dt) => {
		const f = fistAt(0);
		ctx.handle.head.copy(f);
		body.lean = -.15 * k;
		body.turn = .35 * k;
		if (Math.random() < dt * 30) ctx.glow(f, (.15 + .3 * ease.inQuad(k)) * s, .08, 1 + 1.5 * k);
		ctx.emitShape("spark", poisson(60 * dt * k), {
			type: "sphere",
			at: f,
			r: .5 * s
		}, {
			hook: ctx.hook({ seek: {
				target: f,
				speed: 4,
				steer: 8,
				arrive: .05
			} }),
			v: () => new THREE.Vector3(),
			life: .4,
			size: [.01, .018],
			stretch: .05,
			colors: ctx.cols("core", "main"),
			bright: 2.4 * B,
			alphaCurve: "hold"
		});
		charge.set(f, 30 * k);
	}, () => charge.release(.1));
	ctx.dust(ctx.ground(ctx.from()), .35 * s);
	for (let i = 0; i < hits; i++) {
		const last = i === hits - 1;
		const t0 = p.windup + i * gap;
		const travel = last ? .07 : .05;
		const pw = last ? p.power : p.power * .55;
		ctx.after(t0, () => {
			ctx.part("swing");
			if (i === 0) ctx.handle.emit("release");
			const start = fistAt(.35);
			const end = fistAt(1);
			const ang = ctx.screenAngle(start, aim);
			ctx.lines(start.clone().lerp(end, .5), {
				size: 1.4 * s,
				parallel: ang,
				dur: .2,
				count: 16,
				width: .3,
				bright: 1.2
			});
			ctx.during(0, travel, (k, dt) => {
				const f = start.clone().lerp(end, ease.outExpo(k));
				ctx.handle.head.copy(f);
				body.lean = .3 * ease.outExpo(k);
				body.turn = (i % 2 ? .3 : -.3) * ease.outExpo(k);
				body.offset.copy(aim).multiplyScalar(.3 * ease.outExpo(k));
				ctx.emit("glow", 1, {
					p: f,
					speed: 0,
					life: .06,
					size: (last ? .45 : .3) * s,
					colors: ctx.cols("core", "main"),
					bright: 1.4 * B,
					fadeIn: 0
				});
				ctx.emit("spark", poisson(300 * dt), {
					p: f,
					jitter: .08 * s,
					v: () => aim.clone().multiplyScalar(-2).add(randomDir().multiplyScalar(1.5)),
					life: [.08, .16],
					size: [.012, .02],
					stretch: .05,
					colors: ctx.cols("core", "main"),
					bright: 2.6 * B,
					fadeIn: 0
				});
			}, () => {
				ctx.part("hit");
				if (last) ctx.during(.2, .35, (k) => {
					body.lean = .3 * (1 - k);
					body.turn = (i % 2 ? .3 : -.3) * (1 - k);
					body.offset.copy(aim).multiplyScalar(.3 * (1 - k));
					if (k >= 1) body.limb = null;
				});
				const at = ctx.to().addScaledVector(aim, -.25);
				ctx.impact(at, {
					power: pw,
					dir: aim,
					ringNormal: aim,
					scale: (last ? .8 : .5) * p.size,
					extra: last && p.power >= 1.4,
					role: last && hits > 1 ? "final" : void 0
				});
				ctx.band(at.clone().addScaledVector(aim, .2), {
					radius: (last ? 1.4 : .8) * s,
					inner: .78,
					normal: aim,
					hard: .8,
					noise: 1,
					dur: .3,
					grow: (k) => .2 + .8 * ease.outExpo(k)
				});
				if (!last) return;
				ctx.lathe(at, {
					profile: "cone",
					axis: aim,
					radius: .18 * p.size,
					top: p.cone * 1.1 * p.size,
					height: 2.6 * p.cone * p.size,
					flow: -6,
					tiles: [7, 1.5],
					streak: 1,
					rim: .7,
					fadeLo: .05,
					fadeHi: .5,
					dur: .32,
					bright: 1.3,
					grow: (k) => [1, .3 + .7 * ease.outExpo(clamp01(k * 3))],
					erode: (k) => ease.inQuad(span(k, .3, 1)),
					edge: .1
				});
				for (let j = 1; j <= 2; j++) ctx.band(at.clone().addScaledVector(aim, .6 * j * p.cone), {
					radius: (.6 + .4 * j) * p.cone * s,
					inner: .82,
					normal: aim,
					hard: .6,
					noise: 1,
					dur: .28,
					delay: .03 * j
				});
				ctx.wave(at, 1.4 * p.cone, .35, 1.2);
				const g = ctx.ground(at);
				ctx.emitShape("smoke", 14 * s, {
					type: "circle",
					at: g.clone().setY(g.y + .05),
					r: .3 * s
				}, {
					outward: [2, 4],
					v: () => aim.clone().multiplyScalar(2.5),
					life: [.5, .9],
					size: [.2 * s, .35 * s],
					grow: 2.4,
					drag: 3.5,
					sizeCurve: "burst",
					colors: [ctx.pal.smoke ?? new THREE.Color(.3, .28, .25), new THREE.Color(.3, .28, .25)],
					fadeIn: .03
				});
			});
		});
	}
}
strike.defaults = {
	windup: .18,
	hits: 2,
	power: 1.5,
	size: 1,
	cone: .9,
	anime: 0
};
function shockwave(ctx, p) {
	const s = ctx.scale * p.size;
	const B = ctx.B * ctx.glare;
	const count = Math.max(1, Math.round(p.count));
	ctx.part("cast");
	ctx.handle.emit("cast");
	ctx.circle(ctx.ground(ctx.from()), 1.2 * ctx.scale, p.charge + .3, {
		slot: "feet",
		spin: 1.4,
		bright: 1.4
	});
	ctx.charge(ctx.from(), p.charge, { radius: .5 });
	const span0 = p.span * Math.PI / 180;
	for (let i = 0; i < count; i++) {
		const t0 = p.charge + i * .22;
		ctx.after(t0, () => {
			ctx.part("cast");
			if (i === 0) ctx.handle.emit("release");
			const { from, aim, side } = frame(ctx);
			const tilt = count > 1 ? (i - (count - 1) / 2) * .35 : 0;
			const up = UP$2.clone().applyAxisAngle(aim, tilt);
			const normal = aim.clone().cross(up).normalize();
			const quat = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(aim, normal.clone().cross(aim).normalize(), normal));
			const R = 1.35 * s;
			const pivot = from.clone().addScaledVector(side, .25);
			const sweepSide = i % 2 === 0 ? 1 : -1;
			ctx.arc({
				pivot,
				e1: aim.clone(),
				e2: up.clone().multiplyScalar(sweepSide),
				a0: -1.2,
				a1: 1.2,
				r0: .35 * s,
				r1: 1.05 * s,
				dur: .1,
				ease: ease.slash,
				lag: .6,
				hold: .06
			});
			ctx.ring(from, .5 * s, {
				normal: aim,
				dur: .2,
				thick: .1
			});
			ctx.wave(from, .8, .3, .6);
			ctx.part("fly");
			const dist = Math.max(from.distanceTo(ctx.to()), .5);
			const dur = dist / p.speed;
			const head = new THREE.Vector3();
			const at = () => head.clone().addScaledVector(aim, -R * .8);
			const k01 = (k) => span(k, .9, 1);
			const hold = (k) => .55 + .45 * ease.outExpo(clamp01(k * 6));
			ctx.band(from, {
				radius: R,
				inner: .72,
				a0: -span0 / 2,
				span: span0,
				fadeS: .3,
				fadeE: .3,
				hard: .75,
				noise: 1,
				dur,
				quat,
				at,
				kFn: k01,
				grow: hold,
				bright: 2
			});
			ctx.band(from, {
				radius: R * .98,
				inner: .9,
				a0: -span0 * .4,
				span: span0 * .8,
				fadeS: .35,
				fadeE: .35,
				hard: 1,
				noise: .5,
				dur,
				quat,
				at,
				kFn: k01,
				grow: hold,
				colors: [
					"core",
					"core",
					"main"
				],
				bright: 2.4
			});
			ctx.band(from, {
				radius: R * 1.25,
				inner: .85,
				a0: -span0 * .35,
				span: span0 * .7,
				fadeS: .4,
				fadeE: .4,
				hard: 0,
				noise: 1,
				dur,
				quat,
				at: () => at().addScaledVector(aim, -.25 * s),
				kFn: k01,
				grow: hold,
				colors: [
					"main",
					"accent",
					"accent"
				],
				bright: 1.2
			});
			const ang = ctx.screenAngle(from, aim);
			ctx.fly({
				from,
				to: () => from.clone().addScaledVector(aim, dist),
				dur,
				step: (h, prev, vel, dt) => {
					head.copy(h);
					const back = aim.clone().multiplyScalar(-1);
					ctx.emitShape("spark", poisson(160 * dt), {
						type: "circle",
						at: h.clone().addScaledVector(aim, -R * .15),
						r: R * .85,
						axis: normal,
						arc: [Math.PI - span0 * .4, Math.PI + span0 * .4]
					}, {
						v: () => back.clone().multiplyScalar(3 + Math.random() * 3),
						life: [.12, .25],
						size: [.012 * s, .02 * s],
						stretch: .05,
						drag: 3,
						colors: ctx.cols("core", "main"),
						bright: 2.6 * B,
						fadeIn: 0
					});
					ctx.trail(h, prev, vel, dt, .8 * s, .6);
					const g = ctx.ground(h);
					if (ctx.heightAboveFloor(h) < 1.8) ctx.emit("smoke", poisson(40 * dt), {
						p: g.clone().setY(g.y + .05),
						jitter: .25,
						v: () => aim.clone().multiplyScalar(1.5).add(side.clone().multiplyScalar((Math.random() - .5) * 3)).setY(.4),
						life: [.5, .8],
						size: [.18 * s, .3 * s],
						grow: 2.2,
						drag: 3,
						colors: [ctx.pal.smoke ?? new THREE.Color(.3, .28, .25), new THREE.Color(.3, .28, .25)],
						fadeIn: .03
					});
					if (Math.random() < dt * 10) ctx.lines(h.clone().addScaledVector(aim, -.6 * s), {
						size: 1.6 * s,
						parallel: ang,
						dur: .18,
						count: 14,
						width: .25,
						bright: .9
					});
				},
				arrive: (b) => {
					ctx.part("hit");
					ctx.impact(ctx.to(), {
						power: p.power / Math.sqrt(count),
						dir: aim,
						ringNormal: aim,
						scale: .9 * p.size,
						extra: i === count - 1 && p.power >= 1.4,
						role: count > 1 && i === count - 1 ? "final" : void 0
					});
					ctx.band(b, {
						radius: 1.6 * s,
						inner: .8,
						normal: aim,
						hard: .7,
						noise: 1,
						dur: .35
					});
				}
			});
		});
	}
}
shockwave.defaults = {
	circleFeet: 1,
	charge: .25,
	count: 1,
	speed: 13,
	span: 130,
	size: 1,
	power: 1.3,
	anime: 0
};
//#endregion
//#region src/runtime/recipes/summon.ts
var UP$1 = new THREE.Vector3(0, 1, 0);
function aimOf$1(ctx) {
	const d = ctx.to().sub(ctx.from()).setY(0);
	return d.lengthSq() > 1e-6 ? d.normalize() : new THREE.Vector3(1, 0, 0);
}
var payloadKind = {
	fire: "core",
	earth: "boulder",
	dark: "void",
	poison: "core"
};
function summon(ctx, p) {
	const s = ctx.scale * p.size;
	const B = ctx.B * ctx.glare;
	const R = p.radius * s;
	const aim = aimOf$1(ctx);
	const side = aim.clone().cross(UP$1).normalize();
	ctx.part("cast");
	ctx.charge(ctx.from(), .3, {
		radius: .45,
		aim,
		ground: ctx.from()
	});
	const gate = Math.round(p.gate) % 3;
	const target = ctx.to();
	const tg = ctx.ground(target);
	let center;
	let axis;
	if (gate === 0) {
		center = ctx.from().addScaledVector(aim, -1.2).addScaledVector(side, .6).setY(target.y + 1.6 * s);
		axis = target.clone().sub(center).normalize();
	} else if (gate === 1) {
		center = target.clone().addScaledVector(aim, -1.3).setY(target.y + 2.6 * s);
		axis = target.clone().sub(center).normalize();
	} else {
		center = tg.clone().addScaledVector(aim, -.2).setY(tg.y + .03);
		axis = UP$1.clone();
	}
	const open = .3;
	const openDur = .45;
	const charge = p.charge;
	const fire = .75 + charge;
	const flight = Math.max(center.distanceTo(target) / p.speed, .12);
	const close = fire + flight + .25;
	const life = close + .3 - open;
	ctx.part("main");
	const scaleAt = (age) => {
		const t = age;
		let k = ease.outBackStrong(clamp01(t / openDur));
		if (t > fire - open - .07 && t < fire - open) k *= .9;
		if (t > close - open) k *= 1 - ease.inCubic(clamp01((t - (close - open)) / .3));
		return Math.max(k, .001);
	};
	const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), axis);
	ctx.after(open, () => {
		ctx.circle(center, 2.2 * R, life, {
			normal: axis,
			spin: 1.2,
			bright: 1.6,
			style: 1
		});
		ctx.band(center, {
			radius: 1.15 * R,
			inner: .82,
			quat,
			dur: life,
			noise: 1,
			hard: .4,
			spin: 3,
			grow: (k) => scaleAt(k * life),
			kFn: (k) => span(k, .85, 1),
			bright: 2.2
		});
		const lathe = {
			at: () => center,
			axis,
			dur: life,
			grow: (k) => scaleAt(k * life),
			fade: (k) => 1 - span(k, .9, 1)
		};
		ctx.lathe(center, {
			...lathe,
			profile: "cone",
			radius: R,
			top: .05 * R,
			height: .06,
			smoke: true,
			colors: [
				"main",
				"smoke",
				"smoke"
			],
			twist: 4,
			flow: -1.5,
			tiles: [5, 1],
			streak: .6,
			rim: 0,
			fadeLo: .001,
			fadeHi: .001,
			bright: .5,
			turnRate: () => 3
		});
		ctx.lathe(center, {
			...lathe,
			profile: "cone",
			radius: R,
			top: .1 * R,
			height: .08,
			twist: 5,
			flow: -2.2,
			tiles: [6, 1.2],
			streak: .8,
			rim: 0,
			fadeLo: .02,
			fadeHi: .3,
			bright: 1.4,
			turnRate: (k) => 4 + 10 * span(k * life, close - open - .1, close - open + .3)
		});
		ctx.wave(center, 1.8 * R, .4, 1);
		ctx.light(center, 2, .4);
	});
	ctx.during(.525, charge + openDur * .5, (k, dt) => {
		ctx.emitShape("spark", poisson(160 * dt), {
			type: "circle",
			at: center,
			r: 1.9 * R,
			axis
		}, {
			hook: ctx.hook({ seek: {
				target: center,
				speed: 5 * R + 2,
				steer: 7,
				arrive: .12
			} }),
			tangent: 2,
			life: .8,
			size: [.012, .022],
			stretch: .06,
			colors: ctx.cols("core", "main"),
			bright: 2.4 * B,
			alphaCurve: "hold"
		});
		if (Math.random() < dt * 25) ctx.glow(center, (.3 + .9 * ease.inQuad(k)) * R, .1, 1 + 2 * k);
	});
	ctx.after(fire, () => {
		ctx.part("main");
		ctx.handle.emit("release");
		ctx.star(center, 1.8 * R, .14, 3);
		ctx.wave(center, 2.2 * R, .35, 1.3);
		const back = axis.clone().negate();
		ctx.emit("shard", 24, {
			p: center,
			jitter: .2 * R,
			v: () => back.clone().add(randomDir().multiplyScalar(.8)).multiplyScalar(3 + Math.random() * 3),
			life: [.3, .6],
			size: [.04, .08],
			drag: 2,
			spin: [-10, 10],
			colors: ctx.cols("core", "main"),
			bright: 2 * B,
			fadeIn: 0
		});
		ctx.emit("spark", 50, {
			p: center,
			jitter: .2 * R,
			v: () => back.clone().add(randomDir().multiplyScalar(.9)).multiplyScalar(4 + Math.random() * 5),
			life: [.2, .4],
			size: [.012, .022],
			drag: 3,
			stretch: .05,
			colors: ctx.cols("core", "main"),
			bright: 3 * B,
			fadeIn: 0
		});
		ctx.part("hit");
		const head = center.clone();
		const dir = target.clone().sub(center).normalize();
		const kind = payloadKind[ctx.element] ?? "spear";
		const len = 2.6 * s;
		const tail = (k) => {
			const age = k * (flight + .4);
			return age < flight ? 1 : 1 - ease.inQuad(clamp01((age - flight) / .4));
		};
		if (kind === "spear" || kind === "void") ctx.lathe(center, {
			profile: "cone",
			axis: dir,
			at: () => head.clone().addScaledVector(dir, -len),
			radius: .32 * s,
			top: .02,
			height: len,
			flow: -5,
			tiles: [6, 1.4],
			streak: .9,
			rim: kind === "void" ? .9 : .5,
			fadeLo: .35,
			fadeHi: .02,
			dur: flight + .4,
			bright: 1.8,
			smoke: kind === "void",
			colors: kind === "void" ? [
				"core",
				"smoke",
				"smoke"
			] : void 0,
			fade: tail,
			erode: (k) => ease.inQuad(span(k * (flight + .4), flight, flight + .4)),
			edge: .12,
			grow: (k) => [1, .2 + .8 * ease.outExpo(clamp01(k * (flight + .4) / .08))]
		});
		if (kind === "boulder") {
			const size = .55 * s;
			ctx.fx.rocks.spawn({
				p: center.clone(),
				size: new THREE.Vector3(size, size * .85, size),
				spin: 5,
				life: flight + 2,
				grow: .08,
				shrink: .2,
				gravity: 12,
				bounce: .2,
				color: ctx.pal.main.clone().lerp(new THREE.Color(.35, .3, .26), .6).multiplyScalar(.32),
				drive: (pp, v, age, dt) => {
					if (age >= flight) return false;
					const prev = pp.clone();
					pp.copy(head);
					if (dt > 0) v.subVectors(pp, prev).divideScalar(dt);
					return true;
				}
			});
		}
		const ribbon = ctx.ribbon(.5 * s);
		const prev = center.clone();
		ctx.during(0, flight, (k, dt) => {
			head.copy(center).lerp(target, ease.outQuad(k));
			ctx.handle.head.copy(head);
			const vel = head.clone().sub(prev).divideScalar(Math.max(dt, 1e-4));
			ctx.emit("glow", 1, {
				p: head,
				speed: 0,
				life: .06,
				size: (kind === "core" ? 1.3 : .7) * s,
				colors: ctx.cols("core", "main"),
				bright: 1.4 * B,
				fadeIn: 0
			});
			if (kind === "core") ctx.emit(ctx.element === "fire" ? "flame" : "smoke", poisson(140 * dt), {
				p: head,
				jitter: .25 * s,
				v: () => vel.clone().multiplyScalar(-.1).add(randomDir()),
				life: [.25, .45],
				size: [.35 * s, .55 * s],
				grow: 1.4,
				colors: ctx.element === "fire" ? ctx.cols("core", "main", "accent") : [ctx.pal.smoke.clone().lerp(ctx.pal.main, .4), ctx.pal.smoke],
				bright: 1.4 * B,
				fadeIn: .02
			});
			ctx.trail(head, prev, vel, dt, 1.4 * s, 1.5);
			ribbon.trail.push(head);
			prev.copy(head);
		}, () => {
			ribbon.release(.2);
			ctx.impact(target, {
				power: p.power,
				dir,
				ringNormal: dir,
				scale: 1.3 * p.size,
				extra: true
			});
			ctx.band(tg.clone().setY(tg.y + .03), {
				radius: 2.4 * s,
				inner: .7,
				dur: .6,
				noise: 1
			});
			if (kind === "boulder") ctx.rocks(target, 14, 1.2 * s, () => randomDir().setY(Math.random() * 1.5).multiplyScalar(5));
		});
	});
	ctx.after(close, () => {
		ctx.part("main");
		ctx.during(0, .3, (_k, dt) => ctx.emitShape("mote", poisson(120 * dt), {
			type: "circle",
			at: center,
			r: 1.3 * R,
			axis
		}, {
			hook: ctx.hook({ seek: {
				target: center,
				speed: 5,
				steer: 9,
				arrive: .1
			} }),
			life: .4,
			size: [.02, .035],
			colors: ctx.cols("core", "main"),
			bright: 2.2 * B,
			alphaCurve: "hold"
		}), () => {
			ctx.star(center, .7 * s, .12, 2.5);
			ctx.glow(center, .5 * s, .15, 2);
		});
	});
}
summon.defaults = {
	circleFeet: 1,
	circleHand: 1,
	gate: 0,
	radius: .9,
	charge: .4,
	speed: 16,
	size: 1,
	power: 1.8
};
function warp(ctx, p) {
	const s = ctx.scale * p.size;
	const B = ctx.B * ctx.glare;
	const aim = aimOf$1(ctx);
	const A = ctx.ground(ctx.from());
	const Bp = ctx.ground(ctx.to()).addScaledVector(aim, -p.offset);
	Bp.y = A.y;
	const h = 2.1 * s;
	const r = .5 * s;
	ctx.part("cast");
	ctx.handle.emit("cast");
	ctx.band(A.clone().setY(A.y + .03), {
		radius: 1.1 * s,
		inner: .75,
		dur: p.charge + .5,
		noise: 1,
		grow: (k) => ease.outExpo(clamp01(k * 4)),
		kFn: (k) => span(k, .6, 1)
	});
	ctx.circle(A, 1.2 * ctx.scale, p.charge + .35, {
		slot: "feet",
		spin: 2,
		bright: 1.4
	});
	ctx.during(0, p.charge, (_k, dt) => {
		ctx.emitShape("mote", poisson(90 * dt), {
			type: "body",
			at: A,
			r: .9 * s,
			h
		}, {
			hook: ctx.hook({ fields: [{
				kind: "attract",
				power: 6,
				at: A.clone().setY(A.y + h * .5),
				shape: "tube",
				max: 3
			}] }),
			v: () => new THREE.Vector3(0, .8, 0),
			life: [.3, .5],
			size: [.02, .035],
			colors: ctx.cols("core", "main"),
			bright: 2.2 * B
		});
	});
	const column = (at, appear) => {
		const dur = appear ? .4 : .3;
		ctx.lathe(at, {
			profile: "cylinder",
			radius: r,
			top: r * .9,
			height: h * 1.2,
			flow: appear ? -3 : 3,
			tiles: [8, 1],
			streak: 1,
			rim: .7,
			fadeLo: .05,
			fadeHi: .4,
			dur,
			bright: 1.8,
			grow: (k) => {
				const t = k * dur;
				if (appear) {
					const w = t < .12 ? .05 : ease.outBackStrong(clamp01((t - .12) / .14)) * (1 - ease.inCubic(span(t, .26, dur)));
					return [Math.max(w, .02), ease.outExpo(clamp01(t / .1))];
				}
				const w = 1 - ease.inCubic(clamp01(t / .12));
				return [Math.max(w, .02), t < .12 ? 1 : 1 - ease.inCubic(clamp01((t - .12) / .12))];
			}
		});
	};
	ctx.after(p.charge, () => {
		ctx.handle.emit("release");
		ctx.handle.emit("vanish", { point: A.clone() });
		const c = A.clone().setY(A.y + h * .5);
		ctx.glow(c, 1.2 * s, .12, 2);
		column(A, false);
		ctx.wave(c, 1.2, .3, .8);
		ctx.emitShape("mote", 40, {
			type: "body",
			at: A,
			r: .5 * s,
			h
		}, {
			v: () => new THREE.Vector3(0, 1.5 + Math.random() * 2, 0),
			life: [.4, .8],
			size: [.02, .04],
			alphaCurve: "hold",
			drag: 1,
			colors: ctx.cols("core", "main"),
			bright: 2.4 * B
		});
		ctx.emit("spark", 30, {
			p: c,
			v: () => randomDir().multiplyScalar(3 + Math.random() * 3),
			life: [.15, .3],
			size: [.012, .02],
			drag: 3,
			stretch: .04,
			colors: ctx.cols("core", "main"),
			bright: 3 * B,
			fadeIn: 0
		});
		ctx.band(A.clone().setY(A.y + .03), {
			radius: 1.3 * s,
			inner: .8,
			dur: .45,
			delay: .1,
			noise: 1,
			grow: (k) => 1 - .3 * k
		});
		const c2 = Bp.clone().setY(Bp.y + h * .5);
		const travel = p.travel;
		ctx.part("main");
		if (ctx.element === "thunder") ctx.bolt(c, c2, {
			dur: travel + .15,
			width: .12 * s,
			jag: .08,
			branches: 2
		});
		else {
			const ribbon = ctx.ribbon(.25 * s);
			const hd = c.clone();
			ctx.during(0, travel, (k) => {
				hd.copy(c).lerp(c2, ease.inOutCubic(k));
				ribbon.trail.push(hd);
				ctx.emit("glow", 1, {
					p: hd,
					speed: 0,
					life: .08,
					size: .4 * s,
					colors: ctx.cols("core", "main"),
					bright: 1.6 * B,
					fadeIn: 0
				});
			}, () => ribbon.release(.2));
		}
		const conv = Math.max(travel - .02, .05);
		ctx.after(Math.max(travel - .12, 0), () => {
			ctx.emitShape("spark", 50, {
				type: "sphere",
				at: c2,
				r: 1.1 * s
			}, {
				hook: ctx.hook({ seek: {
					target: c2,
					speed: 9,
					steer: 12,
					arrive: .1
				} }),
				v: () => new THREE.Vector3(),
				life: .5,
				size: [.012, .022],
				stretch: .05,
				colors: ctx.cols("core", "main"),
				bright: 2.6 * B,
				alphaCurve: "hold"
			});
		});
		ctx.after(conv, () => column(Bp, true));
		ctx.after(conv + .12, () => {
			ctx.handle.emit("appear", { point: Bp.clone() });
			ctx.glow(c2, 1.6 * s, .16, 2.2);
			ctx.star(c2, 1.4 * s, .14, 2.5);
			ctx.band(Bp.clone().setY(Bp.y + .03), {
				radius: 1.8 * s,
				inner: .7,
				dur: .4,
				noise: 1,
				grow: (k) => .2 + .8 * ease.outCubic(k)
			});
			ctx.burst(c2, {
				count: 40,
				speed: 5,
				scale: .6 * p.size
			});
			ctx.dust(Bp, .6 * s);
			ctx.light(c2, 2.5, .35);
			ctx.wave(c2, 1.6, .35, 1);
			ctx.emitShape("mote", 30, {
				type: "body",
				at: Bp,
				r: .5 * s,
				h
			}, {
				v: () => new THREE.Vector3(0, .6 + Math.random(), 0),
				life: [.5, .9],
				size: [.02, .035],
				alphaCurve: "bell",
				colors: ctx.cols("core", "main"),
				bright: 2.2 * B
			});
		});
	});
}
warp.defaults = {
	circleFeet: 1,
	charge: .25,
	offset: 1.4,
	travel: .14,
	size: 1
};
function missiles(ctx, p) {
	const s = ctx.scale * p.size;
	const B = ctx.B * ctx.glare;
	const count = Math.max(2, Math.round(p.count));
	const aim = aimOf$1(ctx);
	const side = aim.clone().cross(UP$1).normalize();
	ctx.part("cast");
	ctx.charge(ctx.from(), p.charge, {
		radius: .5,
		aim,
		ground: ctx.from()
	});
	const fan = p.fan * Math.PI / 180;
	const pitch = p.launch * Math.PI / 180;
	const base = UP$1.clone().multiplyScalar(Math.cos(pitch)).addScaledVector(aim, Math.sin(pitch));
	const smokeCol = ctx.pal.smoke ? [ctx.pal.smoke.clone().lerp(ctx.pal.main, .12).multiplyScalar(2.6), ctx.pal.smoke.clone().multiplyScalar(1.4)] : null;
	let arrived = 0;
	for (let i = 0; i < count; i++) {
		const order = i % 2 === 0 ? i / 2 : count - 1 - (i - 1) / 2;
		const u = count > 1 ? order / (count - 1) : .5;
		const t0 = p.charge + i * p.stagger;
		ctx.after(t0, () => {
			ctx.part("main");
			if (i === 0) ctx.handle.emit("release");
			const from = ctx.from().add(new THREE.Vector3(0, .25, 0)).addScaledVector(side, (u - .5) * .5);
			const a = (u - .5) * fan;
			const vel = base.clone().multiplyScalar(Math.cos(a) * .8 + .5).addScaledVector(side, Math.sin(a) * 1.3).add(randomDir().multiplyScalar(.15)).normalize().multiplyScalar(11 + Math.random() * 5);
			const head = from.clone();
			const prev = from.clone();
			const dest = ctx.to().add(randomDir().multiplyScalar(.35));
			const wobble = Math.random() < .35 ? 2.5 + Math.random() * 2 : 0;
			const phase = Math.random() * Math.PI * 2;
			const hang = p.hang * (.7 + Math.random() * .6);
			const steerMax = 3 + Math.random() * 2.5;
			const ribbon = ctx.ribbon(.1 * s);
			const want = new THREE.Vector3();
			const lat = new THREE.Vector3();
			let age = 0;
			let lit = false;
			let speed = vel.length();
			let dist = 0;
			ctx.emit("flare", 1, {
				p: from,
				speed: 0,
				life: .12,
				size: .4 * s,
				colors: ctx.cols("core", "main"),
				bright: 1.6 * B,
				fadeIn: 0
			});
			ctx.fx.scheduler.add({ update: (dt) => {
				if (dt <= 0) return true;
				age += dt;
				const tgt = dest;
				want.subVectors(tgt, head);
				const d = want.length();
				if (age < hang) vel.multiplyScalar(Math.exp(-3.5 * dt));
				else {
					if (!lit) {
						lit = true;
						ctx.emit("flare", 1, {
							p: head,
							speed: 0,
							life: .1,
							size: .35 * s,
							colors: ctx.cols("core", "main"),
							bright: 2 * B,
							fadeIn: 0
						});
					}
					const tt = age - hang;
					speed = Math.min(p.speed, Math.max(speed, 6) + 32 * dt);
					const steer = .8 + steerMax * ease.inQuad(clamp01(tt / 1.1));
					want.normalize();
					if (wobble) {
						lat.crossVectors(want, UP$1).normalize();
						want.addScaledVector(lat, Math.sin(tt * wobble * 6 + phase) * .6 * Math.max(0, 1 - tt / 1.2)).normalize();
					}
					want.multiplyScalar(speed);
					vel.lerp(want, Math.min(steer * dt, 1));
				}
				prev.copy(head);
				head.addScaledVector(vel, dt);
				const step = head.distanceTo(prev);
				dist += step;
				const amt = p.smoke;
				if (amt > 0) {
					const spacing = Math.max(.14 / amt, .06);
					const sz = Math.sqrt(amt);
					while (dist > spacing) {
						dist -= spacing;
						const q = prev.clone().lerp(head, 1 - dist / Math.max(step, 1e-5));
						if (smokeCol) ctx.emit("smoke", 1, {
							p: q,
							v: () => randomDir().multiplyScalar(.12).add(new THREE.Vector3(0, .15, 0)),
							life: [.9, 1.3],
							size: [.045 * s * sz, .06 * s * sz],
							grow: 3.2,
							sizeCurve: "burst",
							curl: .35,
							colors: smokeCol,
							fadeIn: .02,
							fadePow: 2,
							delay: 0
						});
						else ctx.emit("mist", 1, {
							p: q,
							v: () => randomDir().multiplyScalar(.12),
							life: [.7, 1.1],
							size: [.06 * s * sz, .09 * s * sz],
							grow: 2.6,
							sizeCurve: "burst",
							curl: .5,
							colors: ctx.cols("main", "accent"),
							bright: .55 * B,
							fadeIn: .02,
							fadePow: 1.6
						});
					}
					if (lit) ctx.trail(head, prev, vel, dt, .45 * s, .3 * amt);
				} else dist = 0;
				ribbon.trail.push(head);
				ctx.emit("glow", 1, {
					p: head,
					speed: 0,
					life: .04,
					size: .22 * s,
					colors: ctx.cols("core", "main"),
					bright: 1.8 * B,
					fadeIn: 0
				});
				if (lit) ctx.emit("spark", poisson(60 * dt), {
					p: head,
					v: () => vel.clone().multiplyScalar(-.15).add(randomDir()),
					life: [.08, .16],
					size: [.01, .016],
					stretch: .03,
					colors: ctx.cols("core", "main"),
					bright: 2.4 * B,
					fadeIn: 0
				});
				if (d < Math.max(speed * dt * 1.5, .2) || age > 4) {
					ribbon.release(.15);
					ctx.part("hit");
					arrived++;
					const last = arrived === count;
					ctx.impact(head.clone(), {
						power: last ? p.power : .55,
						dir: vel.clone().normalize(),
						scale: last ? .9 * p.size : .4 * p.size,
						extra: last,
						hit: true,
						role: last ? "final" : void 0
					});
					ctx.part("main");
					return false;
				}
				return true;
			} }, ctx.handle);
		});
	}
}
missiles.defaults = {
	circleFeet: 1,
	circleHand: 1,
	circleTarget: 0,
	charge: .35,
	count: 12,
	launch: -45,
	fan: 200,
	smoke: 1,
	stagger: .045,
	hang: .16,
	speed: 30,
	size: 1,
	power: 1.4
};
//#endregion
//#region src/runtime/recipes/storm.ts
var UP = new THREE.Vector3(0, 1, 0);
function aimOf(ctx) {
	const d = ctx.to().sub(ctx.from()).setY(0);
	return d.lengthSq() > 1e-6 ? d.normalize() : new THREE.Vector3(1, 0, 0);
}
function tornado(ctx, p) {
	const s = ctx.scale * p.size;
	const aim = aimOf(ctx);
	ctx.part("cast");
	ctx.charge(ctx.from(), p.charge, {
		radius: .6,
		aim,
		ground: ctx.from()
	});
	const tg = ctx.ground(ctx.to());
	const start = p.drift > .05 ? ctx.ground(ctx.from()).addScaledVector(aim, 1.4).lerp(tg, 1 - p.drift) : tg.clone();
	ctx.after(p.charge, () => {
		ctx.handle.emit("release");
		ctx.part("main");
		ctx.circle(start, 1.6 * ctx.scale, .8, {
			spin: 2,
			bright: 1.4,
			slot: "target"
		});
		const center = ctx.tornado(start, {
			radius: p.radius * s,
			height: p.height * s,
			dur: p.dur,
			power: p.power,
			goal: tg,
			reach: p.dur * .45,
			debris: p.debris
		});
		let next = .4;
		ctx.part("hit");
		ctx.during(0, p.dur, (_k, _dt, age) => {
			if (age < next) return;
			if (Math.hypot(center.x - tg.x, center.z - tg.z) > p.radius * s * 1.2) return;
			next = age + .3;
			const at = ctx.to();
			ctx.hit(at, .5 * p.power, "tick");
			ctx.emit("spark", 12, {
				p: at,
				v: () => randomDir().setY(Math.random() * 1.5).multiplyScalar(3),
				life: [.15, .3],
				size: [.012, .02],
				stretch: .04,
				colors: ctx.cols("core", "main"),
				bright: 2.4 * ctx.B,
				fadeIn: 0
			});
		}, () => {
			const at = ctx.to();
			ctx.impact(at.clone().setY(at.y + .6), {
				power: p.power,
				scale: 1.1 * p.size,
				extra: false,
				role: "final",
				dir: UP
			});
			ctx.band(tg.clone().setY(tg.y + .03), {
				radius: 2.8 * s,
				inner: .7,
				dur: .6,
				noise: 1
			});
			ctx.dust(tg, 1.6 * s);
		});
	});
}
tornado.defaults = {
	circleFeet: 1,
	circleHand: 1,
	circleTarget: 1,
	charge: .35,
	dur: 2.8,
	radius: 1.1,
	height: 3.6,
	drift: .6,
	size: 1,
	power: 1.5,
	debris: 1
};
var dropHook = (ctx) => ({
	floorKill: true,
	onFloor: (q) => {
		if (Math.random() > .45) return;
		ctx.emit("spark", 3, {
			p: q,
			v: () => new THREE.Vector3((Math.random() - .5) * 1.4, 1 + Math.random() * 1.2, (Math.random() - .5) * 1.4),
			life: [.18, .3],
			size: [.01, .018],
			gravity: 9,
			colors: ctx.cols("core", "main"),
			bright: 1.4 * ctx.B,
			fadeIn: 0
		});
		if (Math.random() < .4) ctx.band(q.clone().setY(q.y + .01), {
			radius: .15 + Math.random() * .15,
			inner: .7,
			dur: .35,
			noise: 0,
			bright: 1
		});
	}
});
var WEATHER = {
	fire: {
		cloud: "smoke",
		fall(ctx, at, slant, dt, s, env) {
			const hook = env.hook({
				floorKill: true,
				onFloor: (q) => {
					if (Math.random() > .35) return;
					ctx.emit("flame", 3, {
						p: q.clone().setY(q.y + .1),
						jitter: .1,
						v: () => new THREE.Vector3(0, 1.5 + Math.random(), 0),
						life: [.25, .45],
						size: [.14, .24],
						grow: 1.4,
						colors: ctx.cols("core", "main", "accent"),
						bright: 1.3 * ctx.B,
						fadeIn: .02
					});
					ctx.emit("mote", 3, {
						p: q,
						v: () => randomDir().setY(1).multiplyScalar(1.5),
						life: [.4, .8],
						size: [.02, .03],
						gravity: 2,
						colors: ctx.cols("core", "main"),
						bright: 2.4 * ctx.B
					});
				}
			});
			ctx.emit("flame", poisson(26 * dt * s), {
				p: at,
				v: () => slant.clone().multiplyScalar(9 + Math.random() * 3),
				life: 2,
				size: [.12, .2],
				stretch: .02,
				colors: ctx.cols("core", "main", "accent"),
				bright: 1.4 * ctx.B,
				fadeIn: .02,
				alphaCurve: "hold",
				curl: env.curl,
				curlScale: .7,
				hook
			});
			ctx.emit("spark", poisson(40 * dt * s), {
				p: at,
				v: () => slant.clone().multiplyScalar(10 + Math.random() * 4),
				life: 2,
				size: [.012, .02],
				stretch: .05,
				colors: ctx.cols("core", "main"),
				bright: 2.4 * ctx.B,
				fadeIn: 0,
				alphaCurve: "hold",
				curl: env.curl,
				curlScale: .7,
				hook: env.hook({ floorKill: true })
			});
		},
		strike(ctx, at) {
			ctx.decal(at, .7, 3);
		}
	},
	ice: {
		cloud: "mist",
		fall(ctx, at, slant, dt, s, env) {
			const wind = slant.clone().setY(0).normalize();
			ctx.emit("mote", poisson(160 * dt * s), {
				p: at,
				v: () => slant.clone().multiplyScalar(3 + Math.random() * 2).addScaledVector(wind, 2.5),
				life: 2.2,
				size: [.02, .04],
				curl: 1.4,
				curlScale: 1.2,
				colors: ctx.cols("core", "main"),
				bright: 2 * ctx.B,
				fadeIn: .1,
				alphaCurve: "hold",
				hook: env.hook({ floorKill: true })
			});
			ctx.emit("shard", poisson(30 * dt * s), {
				p: at,
				v: () => slant.clone().multiplyScalar(5 + Math.random() * 2).addScaledVector(wind, 3),
				life: 2,
				size: [.03, .06],
				spin: [-8, 8],
				colors: ctx.cols("core", "main"),
				bright: 1.8 * ctx.B,
				fadeIn: .05,
				alphaCurve: "hold",
				curl: env.curl,
				curlScale: .7,
				hook: env.hook({ floorKill: true })
			});
		},
		strike(ctx, at, _top, s) {
			ctx.spike(at, at.clone().add(new THREE.Vector3(.01, 0, 0)), (.5 + Math.random() * .5) * s, "crystal", .6);
		},
		ground(ctx, at, dt, s) {
			ctx.emit("mist", poisson(20 * dt * s), {
				p: at,
				v: () => randomDir().setY(.1).multiplyScalar(.6),
				life: [1.2, 1.8],
				size: [.5, .8],
				grow: 1.5,
				colors: ctx.cols("main", "accent"),
				bright: .45 * ctx.B,
				fadeIn: .3
			});
		}
	},
	thunder: {
		cloud: "smoke",
		fall(ctx, at, slant, dt, s, env) {
			ctx.emit("spark", poisson(560 * dt * s), {
				p: at,
				v: () => slant.clone().multiplyScalar(14 + Math.random() * 4),
				life: 1.5,
				size: [.011, .016],
				stretch: .14,
				colors: [new THREE.Color(.65, .7, .85), ctx.pal.core],
				bright: 2.2,
				fadeIn: 0,
				alphaCurve: "hold",
				curl: env.curl,
				curlScale: .7,
				hook: env.hook(dropHook(ctx))
			});
		},
		strike(ctx, at, top, s) {
			ctx.bolt(top, at, {
				dur: .22,
				width: .22 * s,
				jag: .14,
				branches: 2,
				flicker: true
			});
			ctx.glow(at.clone().setY(at.y + .3), .8 * s, .2, 2);
			ctx.burst(at, {
				count: 25,
				speed: 4,
				dir: UP,
				spread: .6,
				scale: .5 * s
			});
			ctx.light(at.clone().setY(at.y + 1), 3, .25, 10);
			ctx.decal(at, .6, 2);
		}
	},
	wind: {
		cloud: "none",
		fall(ctx, at, slant, dt, s, env) {
			const wind = slant.clone().setY(0).normalize();
			const lift = () => at().setY(ctx.floor + .2 + Math.random() * 2.8);
			const gust = env.gust;
			ctx.emit("spark", poisson(260 * dt * s * gust), {
				p: lift,
				v: () => wind.clone().multiplyScalar((9 + Math.random() * 7) * gust),
				life: [.35, .7],
				size: [.01, .016],
				stretch: .14,
				curl: 4,
				curlScale: .8,
				colors: ctx.cols("core", "main"),
				bright: 2.2 * ctx.B,
				fadeIn: .05,
				hook: env.hook({})
			});
			ctx.emit("mist", poisson(30 * dt * s * gust), {
				p: lift,
				v: () => wind.clone().multiplyScalar((5 + Math.random() * 4) * gust),
				life: [.6, 1.1],
				size: [.5, .8],
				stretch: .1,
				curl: 3.2,
				curlScale: .7,
				colors: ctx.cols("main", "accent"),
				bright: .22 * ctx.B,
				fadeIn: .1,
				hook: env.hook({})
			});
			ctx.emit("shard", poisson(34 * dt * s), {
				p: lift,
				v: () => wind.clone().multiplyScalar(4 + Math.random() * 3).add(new THREE.Vector3(0, 1 + Math.random(), 0)),
				life: [1.2, 2],
				size: [.03, .05],
				spin: [-14, 14],
				curl: 3.5,
				curlScale: .9,
				colors: [
					new THREE.Color(.35, .55, .2),
					new THREE.Color(.25, .4, .12),
					new THREE.Color(.4, .33, .15)
				],
				bright: .9,
				fadeIn: .1,
				hook: env.hook({})
			});
			ctx.emit("smoke", poisson(22 * dt * s), {
				p: () => at().setY(ctx.floor + .15),
				v: () => wind.clone().multiplyScalar(3 + Math.random() * 2),
				life: [.9, 1.4],
				size: [.3, .5],
				grow: 2,
				curl: 2,
				curlScale: .8,
				colors: [new THREE.Color(.36, .34, .3), new THREE.Color(.22, .21, .2)],
				fadeIn: .2,
				hook: env.hook({})
			});
			if (Math.random() < dt * 5 * gust) {
				const c = env.center.clone().add(new THREE.Vector3((Math.random() - .5) * env.R * 1.6, .4 + Math.random() * 2, (Math.random() - .5) * env.R * 1.6));
				const ang = Math.atan2(wind.z, wind.x) + (Math.random() - .5) * 1.2;
				const tilt = (Math.random() - .5) * .9;
				const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2 + tilt, 0, 0)).premultiply(new THREE.Quaternion().setFromAxisAngle(UP, -ang));
				const r = (.8 + Math.random() * .9) * s;
				ctx.band(c, {
					radius: r,
					inner: .9,
					a0: Math.random() * Math.PI * 2,
					span: 1.4 + Math.random(),
					fadeS: .5,
					fadeE: .2,
					spin: (Math.random() < .5 ? -1 : 1) * (5 + Math.random() * 4),
					quat: q,
					dur: .45,
					noise: 1,
					hard: .2,
					grow: (k) => .7 + .5 * ease.outCubic(k),
					colors: [
						"core",
						"main",
						"accent"
					],
					bright: 1.8
				});
			}
		},
		strike(ctx, at, _top, s) {
			if (Math.random() < .3) ctx.tornado(at, {
				radius: .32 * s,
				height: 1.6 * s,
				dur: 1.3,
				debris: .4
			});
			else ctx.emitShape("spark", 30, {
				type: "circle",
				at: at.clone().setY(at.y + .2),
				r: .5 * s
			}, {
				tangent: 7,
				v: () => new THREE.Vector3(0, 3, 0),
				life: [.3, .55],
				size: [.01, .016],
				stretch: .08,
				curl: 2,
				colors: ctx.cols("core", "main"),
				bright: 1.8 * ctx.B
			});
		}
	},
	earth: {
		cloud: "none",
		fall(ctx, at, slant, dt, s, _env) {
			const wind = slant.clone().setY(0).normalize();
			const sand = ctx.pal.smoke.clone().lerp(new THREE.Color(.55, .42, .28), .7);
			ctx.emit("smoke", poisson(85 * dt * s), {
				p: () => at().setY(.2 + Math.random() * 2.2),
				v: () => wind.clone().multiplyScalar(4 + Math.random() * 3),
				life: [.9, 1.4],
				size: [.5, .9],
				grow: 1.6,
				curl: 2.2,
				curlScale: .7,
				hook: _env.hook({}),
				colors: [sand, sand.clone().multiplyScalar(.6)],
				fadeIn: .2
			});
			ctx.emit("mote", poisson(160 * dt * s), {
				p: () => at().setY(.2 + Math.random() * 2.4),
				v: () => wind.clone().multiplyScalar(7 + Math.random() * 5),
				life: [.5, .9],
				size: [.015, .025],
				stretch: .07,
				curl: 3,
				curlScale: .8,
				hook: _env.hook({}),
				colors: ctx.cols("main", "accent"),
				bright: 1.4 * ctx.B
			});
		},
		strike(ctx, at, top, s) {
			ctx.rocks(top.clone().lerp(at, .7), 2, .9 * s, () => new THREE.Vector3((Math.random() - .5) * 2, -6, (Math.random() - .5) * 2));
		}
	},
	water: {
		cloud: "smoke",
		fall(ctx, at, slant, dt, s, env) {
			ctx.emit("spark", poisson(700 * dt * s), {
				p: at,
				v: () => slant.clone().multiplyScalar(13 + Math.random() * 4),
				life: 1.5,
				size: [.012, .018],
				stretch: .14,
				colors: ctx.cols("core", "main"),
				bright: 2.2 * ctx.B,
				fadeIn: 0,
				alphaCurve: "hold",
				curl: env.curl,
				curlScale: .7,
				hook: env.hook(dropHook(ctx))
			});
		},
		ground(ctx, at, dt, s) {
			ctx.emit("mist", poisson(14 * dt * s), {
				p: at,
				v: () => randomDir().setY(.1).multiplyScalar(.5),
				life: [1, 1.5],
				size: [.4, .7],
				grow: 1.4,
				colors: ctx.cols("main", "accent"),
				bright: .35 * ctx.B,
				fadeIn: .3
			});
		}
	},
	light: {
		cloud: "mist",
		fall(ctx, at, slant, dt, s, env) {
			ctx.emit("mote", poisson(60 * dt * s), {
				p: at,
				v: () => slant.clone().multiplyScalar(4 + Math.random() * 2),
				life: 2,
				size: [.025, .045],
				colors: ctx.cols("core", "main"),
				bright: 2.4 * ctx.B,
				fadeIn: .1,
				alphaCurve: "hold",
				curl: env.curl,
				curlScale: .7,
				hook: env.hook({
					floorKill: true,
					onFloor: (q) => {
						if (Math.random() < .3) ctx.star(q.clone().setY(q.y + .05), .25, .2, 2);
					}
				})
			});
		},
		strike(ctx, at, top, s) {
			ctx.beam(() => top.clone().setX(at.x).setZ(at.z), () => at, {
				radius: .18 * s,
				dur: .35,
				fadeIn: .04,
				flow: -10
			});
			ctx.star(at.clone().setY(at.y + .1), .9 * s, .2, 2.2);
		}
	},
	dark: {
		cloud: "smoke",
		fall(ctx, at, slant, dt, s, env) {
			ctx.emit("spark", poisson(90 * dt * s), {
				p: at,
				v: () => slant.clone().multiplyScalar(11 + Math.random() * 3),
				life: 1.5,
				size: [.012, .02],
				stretch: .05,
				colors: ctx.cols("main", "accent"),
				bright: 1.4 * ctx.B,
				fadeIn: 0,
				alphaCurve: "hold",
				curl: env.curl,
				curlScale: .7,
				hook: env.hook({
					floorKill: true,
					onFloor: (q) => {
						if (Math.random() < .2) ctx.smoke(q.clone().setY(q.y + .1), 1, {
							jitter: .05,
							speed: [.2, .4],
							size: [.15, .25],
							delay: 0
						});
					}
				})
			});
		},
		strike(ctx, at, _top, s) {
			ctx.voidSphere(at.clone().setY(at.y + .4), .45 * s, .6);
		}
	},
	poison: {
		cloud: "smoke",
		fall(ctx, at, slant, dt, s, env) {
			ctx.emit("spark", poisson(80 * dt * s), {
				p: at,
				v: () => slant.clone().multiplyScalar(9 + Math.random() * 3),
				life: 1.8,
				size: [.018, .028],
				stretch: .06,
				colors: ctx.cols("core", "main"),
				bright: 1.1 * ctx.B,
				fadeIn: 0,
				alphaCurve: "hold",
				curl: env.curl,
				curlScale: .7,
				hook: env.hook({
					floorKill: true,
					onFloor: (q) => {
						if (Math.random() > .25) return;
						ctx.emit("bubble", 2, {
							p: q.clone().setY(q.y + .03),
							jitter: .06,
							v: () => new THREE.Vector3(0, .15, 0),
							life: [.3, .6],
							size: [.03, .06],
							grow: 1.8,
							colors: ctx.cols("main", "accent"),
							bright: .9 * ctx.B,
							fadePow: .4
						});
					}
				})
			});
		},
		ground(ctx, at, dt, s) {
			const sludge = ctx.pal.smoke;
			ctx.emit("smoke", poisson(14 * dt * s), {
				p: at,
				v: () => randomDir().setY(.05).multiplyScalar(.4),
				life: [1.4, 2],
				size: [.5, .8],
				grow: 1.5,
				colors: [sludge.clone().lerp(ctx.pal.main, .25), sludge],
				fadeIn: .3
			});
		}
	},
	arcane: {
		cloud: "mist",
		fall(ctx, at, slant, dt, s, env) {
			ctx.emit("star", poisson(10 * dt * s), {
				p: at,
				v: () => slant.clone().multiplyScalar(6 + Math.random() * 3),
				life: 2,
				size: [.1, .16],
				colors: ctx.cols("core", "main"),
				bright: 2 * ctx.B,
				fadeIn: .05,
				alphaCurve: "hold",
				curl: env.curl,
				curlScale: .7,
				hook: env.hook({
					floorKill: true,
					onFloor: (q) => {
						if (Math.random() < .35) ctx.band(q.clone().setY(q.y + .02), {
							radius: .35,
							inner: .75,
							dur: .4,
							noise: .5
						});
					}
				})
			});
			ctx.emit("glyph", poisson(8 * dt * s), {
				p: at,
				v: () => slant.clone().multiplyScalar(3 + Math.random() * 2),
				life: 2,
				size: [.1, .15],
				spin: [-2, 2],
				colors: ctx.cols("core", "main"),
				bright: 1.8 * ctx.B,
				fadeIn: .1,
				alphaCurve: "hold",
				curl: env.curl,
				curlScale: .7,
				hook: env.hook({ floorKill: true })
			});
		}
	}
};
function storm(ctx, p) {
	const s = ctx.scale;
	const B = ctx.B * ctx.glare;
	const R = p.radius * s;
	const H = 4.4 * s;
	const w = WEATHER[ctx.element] ?? WEATHER.water;
	ctx.part("cast");
	ctx.charge(ctx.from(), p.charge, {
		radius: .5,
		aim: UP.clone(),
		ground: ctx.from()
	});
	const ph = Math.random() * Math.PI * 2;
	const center = () => ctx.ground(ctx.to());
	const c0 = center();
	const wind = new THREE.Vector3();
	const slant = new THREE.Vector3();
	const vortex = {
		kind: "vortex",
		power: 0,
		at: c0.clone(),
		shape: "tube",
		max: R * 1.8,
		falloff: .4
	};
	const push = {
		kind: "wind",
		power: 0,
		axis: new THREE.Vector3(1, 0, 0)
	};
	const fields = [vortex, push];
	const env = {
		hook: (h) => ctx.hook({
			...h,
			fields
		}),
		curl: 1.3,
		gust: 1,
		center: c0.clone(),
		R
	};
	const weather = (age) => {
		const g = .75 + .25 * Math.sin(age * 1.9) + .2 * Math.sin(age * 4.7 + 1.3);
		env.gust = Math.min(Math.max(g, .4), 1.3);
		const a = ph + .45 * Math.sin(age * .7);
		wind.set(Math.cos(a), 0, Math.sin(a));
		const k = p.slant * (.6 + .8 * env.gust);
		slant.set(wind.x * k, -1, wind.z * k).normalize();
		vortex.power = 5 * env.gust;
		vortex.at.copy(center());
		push.axis.copy(wind);
		push.power = 3.5 * env.gust;
		env.center.copy(center());
	};
	weather(0);
	ctx.after(p.charge, () => ctx.handle.emit("release"));
	ctx.part("main");
	const total = p.dur + 1;
	if (ctx.element === "wind" || ctx.element === "earth") ctx.after(p.charge, () => {
		const life = total - .4;
		const cyc = {
			at: center,
			dur: life,
			grow: (k) => [.4 + .6 * ease.outExpo(clamp01(k * life / .6)), ease.outCubic(clamp01(k * life / .8))],
			fade: (k) => Math.min(k * life / .2, 1) * (1 - ease.inQuad(span(k, .8, 1))),
			erodeTilt: () => .6,
			sway: .1 * R,
			swayF: 1.2
		};
		const earth = ctx.element === "earth";
		ctx.lathe(center(), {
			...cyc,
			profile: "funnel",
			radius: 1.05 * R,
			height: 3 * s,
			twist: 4,
			tiles: [6, 1.4],
			streak: .85,
			rim: .7,
			bright: earth ? .45 : .55,
			colors: earth ? [
				"main",
				"accent",
				"smoke"
			] : void 0,
			turnRate: () => 3.2 * env.gust,
			erode: () => .15
		});
		ctx.lathe(center(), {
			...cyc,
			profile: "cone",
			radius: 1.15 * R,
			top: .6 * R,
			height: .5 * s,
			twist: 3,
			tiles: [7, 1],
			streak: .7,
			rim: .3,
			fadeLo: .2,
			fadeHi: .5,
			bright: .5,
			turnRate: () => 4 * env.gust
		});
	});
	ctx.part("mark");
	ctx.after(p.charge * .6, () => {
		const c = center();
		ctx.circle(c, 1.15 * R, total, {
			slot: "target",
			spin: .3,
			bright: .55
		});
		ctx.band(c.clone().setY(c.y + .03), {
			radius: R * 1.05,
			inner: .9,
			dur: total,
			noise: 1,
			spin: .4,
			kFn: (k) => span(k, .85, 1),
			grow: (k) => ease.outCubic(clamp01(k * total / .5)),
			bright: 1.2
		});
	});
	ctx.part("main");
	const smoke = ctx.pal.smoke ?? ctx.pal.accent.clone().multiplyScalar(.25);
	const cloudCol = w.cloud === "smoke" ? [smoke.clone().lerp(new THREE.Color(.3, .3, .33), .5).multiplyScalar(1.3), smoke.clone().multiplyScalar(.8)] : null;
	const belly = cloudCol ? [cloudCol[1].clone().multiplyScalar(.7), cloudCol[1].clone().multiplyScalar(.45)] : null;
	const top = () => center().setY(ctx.floor + H);
	const cloudHook = ctx.hook({ fields: [{
		kind: "vortex",
		power: 2.2,
		at: top(),
		shape: "tube",
		max: R * 2.2,
		falloff: .3
	}] });
	ctx.during(0, p.charge + total - .4, (_k, dt, age) => {
		weather(age);
		const on = clamp01(age / (p.charge + .6)) * (1 - span(age, p.charge + total - 1.2, p.charge + total - .4));
		const t = top();
		const cloudAt = (dy = 0) => () => t.clone().add(new THREE.Vector3((Math.random() - .5) * 2 * R * 1.3, dy + (Math.random() - .5) * .5, (Math.random() - .5) * 2 * R * 1.3));
		if (cloudCol && belly) {
			ctx.emit("haze", poisson(28 * dt * on), {
				p: cloudAt(),
				v: () => wind.clone().multiplyScalar(.8),
				life: [1.6, 2.4],
				size: [1.2 * s, 1.8 * s],
				grow: 1.4,
				curl: .9,
				curlScale: .5,
				colors: cloudCol,
				fadeIn: .35,
				fadePow: 1.3,
				hook: cloudHook
			});
			ctx.emit("haze", poisson(18 * dt * on), {
				p: cloudAt(-.7),
				v: () => wind.clone().multiplyScalar(1.2),
				life: [1.2, 1.8],
				size: [.8 * s, 1.2 * s],
				grow: 1.5,
				curl: 1.4,
				curlScale: .6,
				colors: belly,
				fadeIn: .3,
				fadePow: 1.3,
				hook: cloudHook
			});
		} else if (w.cloud === "mist") ctx.emit("mist", poisson(24 * dt * on), {
			p: cloudAt(),
			v: () => wind.clone().multiplyScalar(.8),
			life: [1.4, 2.2],
			size: [1.2 * s, 1.8 * s],
			grow: 1.3,
			curl: 1,
			curlScale: .5,
			colors: ctx.cols("main", "accent"),
			bright: .3 * B,
			fadeIn: .35,
			hook: cloudHook
		});
		if (ctx.element === "thunder" && Math.random() < dt * 5 * on) ctx.glow(cloudAt()(), 1.8 * s, .1, .9, ["core", "main"]);
		if (age < p.charge) return;
		const inArea = (y) => () => {
			const a = Math.random() * Math.PI * 2;
			const r = R * Math.sqrt(Math.random());
			return center().add(new THREE.Vector3(Math.cos(a) * r, y, Math.sin(a) * r));
		};
		const rainAt = () => inArea(0)().addScaledVector(slant, -H * .85).addScaledVector(wind, -R * .3);
		w.fall(ctx, rainAt, slant, dt * on * p.density * env.gust, 1, env);
		if (ctx.element !== "wind" && ctx.element !== "light" && ctx.element !== "arcane") {
			const sheetCol = ctx.pal.smoke ? [ctx.pal.smoke.clone().multiplyScalar(3), ctx.pal.smoke.clone().multiplyScalar(1.6)] : ctx.cols("main", "accent");
			ctx.emit("mist", poisson(9 * dt * on * env.gust), {
				p: () => inArea(.3 + Math.random() * 2.2)().addScaledVector(wind, -R),
				v: () => wind.clone().multiplyScalar((4 + Math.random() * 3) * env.gust),
				life: [.9, 1.4],
				size: [.7 * s, 1.1 * s],
				stretch: .3,
				curl: 1.6,
				curlScale: .6,
				colors: sheetCol,
				bright: .28 * B,
				fadeIn: .25,
				hook: env.hook({})
			});
		}
		if (w.ground) w.ground(ctx, inArea(.15), dt * on, 1);
		const gusts = (ctx.element === "wind" ? 26 : ctx.element === "light" || ctx.element === "arcane" ? 3 : 8) * env.gust * on;
		if (Math.random() < dt * gusts) {
			const c = center().setY(ctx.floor + .2 + Math.random() * 2.6);
			const r = R * (.35 + .75 * Math.random());
			ctx.helix({
				center: c,
				r0: r,
				r1: r * (.8 + .3 * Math.random()),
				height: (Math.random() - .3) * .8,
				turns: .3 + Math.random() * .35,
				phase: Math.random() * Math.PI * 2,
				width: (.04 + Math.random() * .08) * s,
				dur: .35 + Math.random() * .25,
				lag: .85,
				hold: .05,
				ease: ease.inOutCubic,
				bright: ctx.element === "wind" ? 2.2 : 1.1
			});
		}
	});
	ctx.part("hit");
	let next = p.charge + .3;
	let first = true;
	ctx.during(p.charge, total - .6, (_k, _dt, age) => {
		const t = age + p.charge;
		if (t < next) return;
		next = t + (.18 + Math.random() * .35 / p.density) / env.gust;
		const onTarget = first || Math.random() < .3;
		first = false;
		const a = Math.random() * Math.PI * 2;
		const r = onTarget ? 0 : R * Math.sqrt(Math.random());
		const at = center().add(new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r));
		w.strike?.(ctx, at, top(), s);
		if (ctx.element === "thunder") ctx.glow(top().setX(at.x).setZ(at.z), 2.2 * s, .07, 1.4, ["core", "main"]);
		if (onTarget || r < .6) ctx.hit(ctx.to(), .5 * p.power, "tick");
	}, () => {
		const at = ctx.to();
		const g = center();
		w.strike?.(ctx, g, top(), 1.6 * s);
		ctx.impact(at, {
			power: p.power,
			scale: 1.2,
			extra: true,
			role: "final",
			dir: slant
		});
	});
}
storm.defaults = {
	circleFeet: 1,
	circleTarget: 3,
	charge: .6,
	dur: 3,
	radius: 3.2,
	slant: .35,
	density: 1,
	power: 1.5
};
function drill(ctx, p) {
	const s = ctx.scale * p.size;
	const B = ctx.B * ctx.glare;
	const aim = aimOf(ctx);
	const len = 1.5 * s;
	const rad = .36 * s;
	ctx.part("cast");
	ctx.handle.emit("cast");
	const hand = () => ctx.from().addScaledVector(aim, .2);
	ctx.circle(hand(), .8 * ctx.scale, p.form + .2, {
		normal: aim,
		spin: -3,
		bright: 1.8,
		slot: "hand"
	});
	ctx.circle(ctx.ground(ctx.from()), 1.3 * ctx.scale, p.form + .5, {
		spin: 1.4,
		bright: 1.4,
		slot: "feet"
	});
	const head = new THREE.Vector3();
	let base = hand();
	let spinRate = 6;
	let jitter = 0;
	const drillAt = () => base.clone().add(randomDir().multiplyScalar(jitter));
	const flightDur = Math.max(ctx.from().distanceTo(ctx.to()) / p.speed, .12);
	const total = p.form + flightDur + p.grind + .35;
	const grow = (k) => {
		const t = k * total;
		const g = ease.outBackStrong(clamp01(t / p.form));
		const out = 1 - ease.inCubic(span(t, total - .2, total));
		return [Math.max(g * out, .01), Math.max(g, .01)];
	};
	ctx.lathe(hand(), {
		profile: "cone",
		axis: aim,
		at: drillAt,
		radius: rad * .95,
		top: .01,
		height: len * .98,
		twist: 22,
		tiles: [3, 5],
		streak: .2,
		rim: -.6,
		fadeLo: .001,
		fadeHi: .001,
		dur: total,
		bright: 1,
		smoke: true,
		colors: [
			"core",
			"accent",
			"accent"
		],
		grow,
		turnRate: () => spinRate * 2.2
	});
	ctx.lathe(hand(), {
		profile: "cone",
		axis: aim,
		at: drillAt,
		radius: rad,
		top: .01,
		height: len,
		twist: 22,
		tiles: [3, 5],
		streak: .3,
		rim: .6,
		fadeLo: .08,
		fadeHi: .02,
		dur: total,
		bright: 1.6,
		grow,
		turnRate: () => spinRate * 2.2
	});
	ctx.lathe(hand(), {
		profile: "cone",
		axis: aim,
		at: drillAt,
		radius: rad * 1.25,
		top: .02,
		height: len * 1.1,
		twist: -10,
		flow: -3,
		tiles: [6, 2],
		streak: .9,
		rim: .9,
		fadeLo: .1,
		fadeHi: .1,
		dur: total,
		bright: .9,
		grow,
		turnRate: () => -spinRate * 1.4
	});
	ctx.during(0, p.form, (k, dt) => {
		spinRate = 6 + 20 * ease.inQuad(k);
		ctx.emitShape("spark", poisson(120 * dt), {
			type: "sphere",
			at: base.clone().addScaledVector(aim, len * .5),
			r: .9 * s
		}, {
			hook: ctx.hook({ seek: {
				target: base.clone().addScaledVector(aim, len * .5),
				speed: 5,
				steer: 8,
				arrive: .1
			} }),
			v: () => new THREE.Vector3(),
			life: .5,
			size: [.012, .02],
			stretch: .05,
			colors: ctx.cols("core", "main"),
			bright: 2.4 * B,
			alphaCurve: "hold"
		});
	});
	ctx.after(p.form, () => {
		ctx.handle.emit("release");
		ctx.part("fly");
		const a = hand();
		const contact = ctx.to().addScaledVector(aim, -len - .25);
		const ang = ctx.screenAngle(a, aim);
		ctx.wave(a, .9, .3, .7);
		ctx.band(a.clone().addScaledVector(aim, len * .6), {
			radius: .8 * s,
			inner: .8,
			normal: aim,
			dur: .25,
			hard: .6,
			noise: 1
		});
		ctx.during(0, flightDur, (k, dt) => {
			base = a.clone().lerp(contact, ease.inQuad(k));
			head.copy(base).addScaledVector(aim, len);
			ctx.handle.head.copy(head);
			ctx.emitShape("spark", poisson(160 * dt), {
				type: "circle",
				at: base.clone().addScaledVector(aim, len * .3),
				r: rad * 1.1,
				axis: aim
			}, {
				tangent: 5,
				v: () => aim.clone().multiplyScalar(-4),
				life: [.12, .25],
				size: [.01, .018],
				stretch: .05,
				colors: ctx.cols("core", "main"),
				bright: 2.4 * B,
				fadeIn: 0
			});
			if (Math.random() < dt * 12) ctx.band(base.clone().addScaledVector(aim, len * .5), {
				radius: .9 * s,
				inner: .85,
				normal: aim,
				dur: .22,
				hard: .5,
				noise: 1
			});
			if (Math.random() < dt * 8) ctx.lines(base, {
				size: 2 * s,
				parallel: ang,
				dur: .2,
				count: 16,
				width: .3,
				bright: 1
			});
		}, () => {
			ctx.part("hit");
			const tip = contact.clone().addScaledVector(aim, len);
			ctx.hit(ctx.to(), .8 * p.power, "first");
			ctx.wave(tip, 1.2, .3, 1);
			const light = ctx.hold(5);
			let next = 0;
			ctx.during(0, p.grind, (k, dt, age) => {
				jitter = .035 * s;
				spinRate = 26 + 10 * k;
				base = contact.clone().addScaledVector(aim, .35 * ease.inQuad(k));
				const t = base.clone().addScaledVector(aim, len);
				ctx.emitShape("spark", poisson(420 * dt), {
					type: "circle",
					at: t,
					r: .25 * s,
					axis: aim
				}, {
					tangent: [6, 10],
					outward: [1, 3],
					v: () => aim.clone().multiplyScalar(-2),
					life: [.15, .35],
					size: [.012, .022],
					gravity: 6,
					drag: 1.5,
					stretch: .05,
					colors: ctx.cols("core", "main", "accent"),
					bright: 3 * B,
					fadeIn: 0,
					bounce: .3
				});
				ctx.emitShape("shard", poisson(40 * dt), {
					type: "circle",
					at: t,
					r: .25 * s,
					axis: aim
				}, {
					tangent: [3, 6],
					outward: [1, 2],
					life: [.4, .7],
					size: [.03, .06],
					gravity: 8,
					spin: [-12, 12],
					colors: ctx.cols("main", "accent"),
					bright: 1.6 * B,
					fadeIn: 0
				});
				if (Math.random() < dt * 20) ctx.glow(t, (.4 + .3 * Math.random()) * s, .06, 2);
				light.set(t, 30 * (1.2 + .6 * Math.random()));
				if (age >= next) {
					next = age + .09;
					ctx.hit(ctx.to(), .4 * p.power, "tick");
				}
				ctx.efx.trail(ctx, {
					head: t,
					prev: t.clone().addScaledVector(aim, -.3),
					vel: aim.clone().multiplyScalar(3),
					dt,
					s: .5 * s,
					density: .6
				});
			}, () => {
				light.release(.2);
				jitter = 0;
				const through = ctx.to().addScaledVector(aim, .3);
				ctx.during(0, .12, (k) => {
					base = contact.clone().addScaledVector(aim, .35 + 1.4 * ease.outExpo(k));
				});
				ctx.impact(through, {
					power: p.power,
					dir: aim,
					ringNormal: aim,
					scale: 1.1 * p.size,
					extra: true,
					role: "final"
				});
				ctx.lathe(through, {
					profile: "cone",
					axis: aim,
					radius: .2 * s,
					top: 1.1 * s,
					height: 2.6 * s,
					flow: -6,
					tiles: [7, 1.5],
					streak: 1,
					rim: .7,
					fadeLo: .05,
					fadeHi: .5,
					dur: .35,
					bright: 1.3,
					grow: (k) => [1, .3 + .7 * ease.outExpo(clamp01(k * 3))],
					erode: (k) => ease.inQuad(span(k, .3, 1)),
					edge: .1
				});
				for (let j = 1; j <= 3; j++) ctx.band(through.clone().addScaledVector(aim, .5 * j), {
					radius: (.5 + .35 * j) * s,
					inner: .82,
					normal: aim,
					hard: .6,
					noise: 1,
					dur: .3,
					delay: .03 * j
				});
			});
		});
	});
}
drill.defaults = {
	circleFeet: 1,
	circleHand: 1,
	form: .45,
	speed: 14,
	grind: .6,
	size: 1,
	power: 1.7
};
function finale(ctx, p) {
	const s = ctx.scale * p.size;
	const B = ctx.B * ctx.glare;
	const body = () => ctx.to();
	ctx.part("main");
	ctx.handle.emit("cast");
	const rays = Math.round(p.rays);
	const light = ctx.hold(6);
	const crack = p.crack;
	ctx.during(0, crack, (k, dt, age) => {
		const c = body();
		light.set(c, 30 * (.5 + 2.5 * ease.inQuad(k)) * (.8 + .4 * Math.sin(age * 40)));
		if (Math.random() < dt * 25) ctx.glow(c.clone().add(randomDir().multiplyScalar(.25 * s)), (.25 + .5 * k) * s, .08, 1 + 1.5 * k);
		ctx.emitShape("spark", poisson(60 * dt * (.3 + k)), {
			type: "sphere",
			at: c,
			r: .35 * s
		}, {
			outward: [2, 5],
			life: [.15, .3],
			size: [.01, .018],
			stretch: .05,
			drag: 2,
			colors: ctx.cols("core", "main"),
			bright: 2.6 * B,
			fadeIn: 0
		});
		if (ctx.fx.feel) ctx.fx.shake(dt * .5 * (.3 + k));
	});
	for (let i = 0; i < rays; i++) {
		const t = i / rays * crack * .9 + Math.random() * .05;
		ctx.after(t, () => {
			const dir = randomDir();
			dir.y = Math.abs(dir.y) * .8 + .1;
			dir.normalize();
			const L = (2.5 + Math.random() * 2) * s;
			const from = () => body();
			const dur = crack - t + .5;
			ctx.beam(from, () => body().addScaledVector(dir, L * ease.outExpo(clamp01(.3 + Math.random() * .01))), {
				radius: (.05 + Math.random() * .05) * s,
				dur,
				fadeIn: .05,
				fadeOut: .3,
				flow: 14
			});
			ctx.star(body().addScaledVector(dir, .25 * s), .4 * s, .12, 2.5);
		});
	}
	const pops = Math.round(p.pops);
	for (let i = 0; i < pops; i++) {
		const t = crack * (.2 + .75 * (i / Math.max(pops - 1, 1))) + Math.random() * .05;
		ctx.after(t, () => {
			const q = body().add(randomDir().multiply(new THREE.Vector3(.5, .8, .5)).multiplyScalar(s));
			ctx.glow(q, .8 * s, .2, 1.8);
			ctx.burst(q, {
				count: 25,
				speed: 4,
				scale: .45 * s
			});
			ctx.light(q, 1.2, .2);
			ctx.smoke(q, 4, {
				size: [.25 * s, .4 * s],
				delay: .05
			});
			ctx.hit(ctx.to(), .5, i === 0 ? "first" : "tick");
		});
	}
	ctx.after(crack, () => {
		ctx.during(0, p.implode, (k, dt) => {
			const c = body();
			ctx.emitShape("mote", poisson(220 * dt), {
				type: "sphere",
				at: c,
				r: 2.2 * s
			}, {
				hook: ctx.hook({ seek: {
					target: c,
					speed: 8,
					steer: 10,
					arrive: .12
				} }),
				v: () => new THREE.Vector3(),
				life: .6,
				size: [.02, .035],
				stretch: .06,
				colors: ctx.cols("core", "main"),
				bright: 2.4 * B,
				alphaCurve: "hold"
			});
			if (Math.random() < dt * 30) ctx.glow(c, (.6 + 1.2 * ease.inQuad(k)) * s, .06, 1.5 + 2 * k);
		});
	});
	ctx.after(crack + p.implode, () => {
		ctx.handle.emit("release");
		light.release(.6);
		const c = body();
		const g = ctx.ground(c);
		ctx.screenFlash(.18);
		ctx.lathe(g, {
			profile: "dome",
			radius: 3.2 * s,
			height: 2.4 * s,
			tiles: [7, 1.5],
			streak: .4,
			rim: 1,
			flow: 1.2,
			dur: .8,
			bright: .8,
			grow: (k) => .1 + .9 * ease.outExpo(clamp01(k * 1.4)),
			erode: (k) => Math.max(k - .25, 0) / .75,
			edge: .08,
			fade: (k) => 1 - k * k
		});
		for (let i = 0; i < 3; i++) ctx.band(g.clone().setY(g.y + .03), {
			radius: (3 + i * 1.2) * s,
			inner: .82,
			dur: .6 + i * .12,
			delay: i * .08,
			noise: 1
		});
		ctx.band(c, {
			radius: 2.4 * s,
			inner: .78,
			normal: "camera",
			hard: .7,
			noise: 1,
			dur: .4
		});
		ctx.impact(c, {
			power: p.power,
			scale: 1.25 * s,
			extra: true,
			role: "final"
		});
		ctx.emit("mote", 60 * s, {
			p: c,
			jitter: .6 * s,
			v: () => randomDir().multiplyScalar(1.5).add(new THREE.Vector3(0, 1, 0)),
			life: [1.5, 2.8],
			size: [.02, .04],
			drag: 1.2,
			gravity: -.3,
			flicker: .4,
			curl: .6,
			colors: ctx.cols("core", "main"),
			bright: 2.4 * B,
			alphaCurve: "bell"
		});
		ctx.during(.1, 1.4, (_k, dt) => ctx.smoke(g.clone().setY(g.y + .4), poisson(26 * dt), {
			jitter: .6 * s,
			speed: [.6, 1.4],
			size: [.45 * s, .75 * s],
			life: [1.6, 2.4],
			delay: 0
		}));
	});
}
finale.defaults = {
	crack: 1.1,
	rays: 9,
	pops: 6,
	implode: .35,
	size: 1,
	power: 2
};
//#endregion
//#region src/runtime/recipes/index.ts
var RECIPES = {
	projectile,
	lance,
	beam,
	explosion,
	pillar,
	meteor,
	nova,
	barrier: barrier$1,
	shockwave,
	summon,
	missiles,
	tornado,
	storm,
	drill,
	finale,
	heal,
	buff,
	warp,
	slash,
	swipe,
	rising,
	cleave,
	combo,
	wave,
	dash,
	flurry,
	thrust,
	spin,
	cross: cross$1,
	smash,
	iaido,
	strike,
	rush,
	uppercut,
	kick,
	heel,
	palm,
	tackle,
	pound
};
var MELEE = /* @__PURE__ */ new Set([
	"slash",
	"swipe",
	"rising",
	"cleave",
	"combo",
	"wave",
	"dash",
	"flurry",
	"thrust",
	"spin",
	"cross",
	"smash",
	"iaido",
	"strike",
	"rush",
	"uppercut",
	"kick",
	"heel",
	"palm",
	"tackle",
	"pound"
]);
var BLUNT = /* @__PURE__ */ new Set([
	"strike",
	"rush",
	"uppercut",
	"kick",
	"heel",
	"palm",
	"tackle",
	"pound"
]);
var SUPPORT = /* @__PURE__ */ new Set([
	"heal",
	"buff",
	"warp"
]);
var EVENT = /* @__PURE__ */ new Set(["finale"]);
var SELF = /* @__PURE__ */ new Set([
	"barrier",
	"nova",
	"buff",
	"warp"
]);
//#endregion
//#region src/runtime/loop-helpers.ts
var permute4 = Fn(([i]) => {
	const im = mod(i, vec4(289));
	return mod(im.mul(34).add(10).mul(im), vec4(289));
}).setLayout({
	name: "permute4",
	type: "vec4",
	inputs: [{
		name: "i",
		type: "vec4"
	}]
});
var toSimplex = (x) => vec3(x.y.add(x.z), x.x.add(x.z), x.x.add(x.y));
var fromSimplex = (i) => vec3(i.y.add(i.z).sub(i.x), i.x.add(i.z).sub(i.y), i.x.add(i.y).sub(i.z)).mul(.5);
var wrapPeriod = (v, period) => select(period.greaterThan(0), mod(v, vec4(period)), v);
var psrdnoise3 = Fn(([x, period, alpha]) => {
	const uvw = toSimplex(x);
	const i0 = floor(uvw).toVar();
	const f0 = fract(uvw);
	const gs = step(f0.xyx, f0.yzz);
	const ls = float(1).sub(gs);
	const g = vec3(ls.z, gs.x, gs.y);
	const l = vec3(ls.x, ls.y, gs.z);
	const i1 = i0.add(min(g, l)).toVar();
	const i2 = i0.add(max(g, l)).toVar();
	const i3 = i0.add(1).toVar();
	const v0 = fromSimplex(i0).toVar();
	const v1 = fromSimplex(i1).toVar();
	const v2 = fromSimplex(i2).toVar();
	const v3 = fromSimplex(i3).toVar();
	const x0 = x.sub(v0).toVar();
	const x1 = x.sub(v1).toVar();
	const x2 = x.sub(v2).toVar();
	const x3 = x.sub(v3).toVar();
	const vx = wrapPeriod(vec4(v0.x, v1.x, v2.x, v3.x), period.x).toVar();
	const vy = wrapPeriod(vec4(v0.y, v1.y, v2.y, v3.y), period.y).toVar();
	const vz = wrapPeriod(vec4(v0.z, v1.z, v2.z, v3.z), period.z).toVar();
	const w0 = floor(toSimplex(vec3(vx.x, vy.x, vz.x)).add(.5));
	const w1 = floor(toSimplex(vec3(vx.y, vy.y, vz.y)).add(.5));
	const w2 = floor(toSimplex(vec3(vx.z, vy.z, vz.z)).add(.5));
	const w3 = floor(toSimplex(vec3(vx.w, vy.w, vz.w)).add(.5));
	const h4 = permute4(permute4(permute4(vec4(w0.z, w1.z, w2.z, w3.z)).add(vec4(w0.y, w1.y, w2.y, w3.y))).add(vec4(w0.x, w1.x, w2.x, w3.x))).toVar();
	const theta = h4.mul(3.883222077);
	const sz = h4.mul(-.006920415).add(.996539792).toVar();
	const psi = h4.mul(.108705628).add(alpha);
	const ct = cos(theta).toVar();
	const st = sin(theta).toVar();
	const szPrime = sqrt(float(1).sub(sz.mul(sz)));
	const sa = sin(psi).toVar();
	const ca = cos(psi).toVar();
	const gx = ca.mul(sz.mul(ct).negate()).add(sa.mul(st)).toVar();
	const gy = ca.mul(sz.mul(st).negate()).sub(sa.mul(ct)).toVar();
	const gz = ca.mul(szPrime).toVar();
	const w = max(vec4(.5).sub(vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3))), vec4(0)).toVar();
	const gdotx = vec4(dot(vec3(gx.x, gy.x, gz.x), x0), dot(vec3(gx.y, gy.y, gz.y), x1), dot(vec3(gx.z, gy.z, gz.z), x2), dot(vec3(gx.w, gy.w, gz.w), x3));
	return dot(w.mul(w).mul(w), gdotx).mul(39.5);
}).setLayout({
	name: "psrdnoise3",
	type: "float",
	inputs: [
		{
			name: "x",
			type: "vec3"
		},
		{
			name: "period",
			type: "vec3"
		},
		{
			name: "alpha",
			type: "float"
		}
	]
});
function loopFbm(p, phase, octaves, cycles) {
	let sum = float(0);
	let amplitude = .5;
	let total = 0;
	for (let o = 0; o < octaves; o++) {
		const q = p.mul(2 ** o);
		sum = sum.add(psrdnoise3(q, vec3(0), phase.mul(TWO_PI).mul(cycles * (o + 1))).mul(amplitude));
		total += amplitude;
		amplitude *= .5;
	}
	return sum.div(total).mul(.5).add(.5);
}
function flowFbm(p, phase, direction, speed, octaves) {
	let sum = float(0);
	let amplitude = .5;
	let total = 0;
	for (let o = 0; o < octaves; o++) {
		const period = 8 * 2 ** o;
		const q = p.mul(2 ** o).add(direction.mul(phase.mul(period * speed)));
		sum = sum.add(psrdnoise3(q, abs(direction).mul(period), phase.mul(TWO_PI).mul(o + 1)).mul(amplitude));
		total += amplitude;
		amplitude *= .5;
	}
	return sum.div(total).mul(.5).add(.5);
}
function loopCells(p, phase, drift) {
	const offset = vec3(.61, .37, .23).mul(drift);
	const a = mx_worley_noise_float(p.add(offset.mul(phase))).sub(.5);
	const b = mx_worley_noise_float(p.add(offset.mul(phase.sub(1)))).sub(.5);
	const wa = oneMinus(phase);
	return a.mul(wa).add(b.mul(phase)).div(wa.mul(wa).add(phase.mul(phase)).sqrt()).add(.5);
}
function glint(p, phase, density, size, sharpness, cycles) {
	const q = p.mul(density);
	const cell = floor(q);
	const local = fract(q).sub(.5);
	const seed = mx_cell_noise_float(cell);
	const facet = normalize(vec3(mx_cell_noise_float(cell.add(17)), mx_cell_noise_float(cell.add(31)), mx_cell_noise_float(cell.add(47))).sub(.5));
	const view = normalize(cameraPosition.sub(positionWorld));
	const facing = pow(max(dot(normalize(normalWorld.add(facet.mul(.9))), view), 0), sharpness);
	const spot = oneMinus(smoothstep(0, size, length(local)));
	const twinkle = pow(sin(phase.mul(cycles).add(seed).mul(TWO_PI)).mul(.5).add(.5), 3);
	return spot.mul(facing).mul(twinkle);
}
function flameShape(q, noise, width, tip, sway, top) {
	const y = q.y;
	const x = q.x.sub(.5).add(noise.sub(.5).mul(sway).mul(y));
	const halfWidth = mix(width, mul(width, tip), y.pow(.8)).mul(.5);
	const fuel = oneMinus(smoothstep(.1, 1, abs(x).div(halfWidth))).mul(1.3).sub(y.div(top)).add(noise.sub(.5).mul(1.1));
	return smoothstep(0, .55, fuel).mul(smoothstep(0, .08, y));
}
function expandingRing(x, phase, cycles, offset, width) {
	const t = fract(phase.mul(cycles).add(offset));
	return oneMinus(smoothstep(0, width, abs(x.sub(t)))).mul(oneMinus(t)).mul(smoothstep(0, .1, t));
}
function twistCylinder(radius, top, height, flare, twist, spin, phase, offset, base) {
	const y = positionLocal.y.add(.5);
	const angle = atan(positionLocal.z, positionLocal.x).add(y.mul(twist)).add(phase.mul(TWO_PI).mul(spin));
	const bend = y.sub(.5);
	const r = max(mix(radius, mul(radius, top), y).add(mul(flare, bend).mul(bend)).add(offset), 0);
	const x = cos(angle).mul(r);
	const z = sin(angle).mul(r);
	return vec3(x, y.mul(height).add(base), z);
}
function puffShape(corner, seed, age) {
	const drift = seed.mul(37.1).add(age.mul(1.3));
	const coarse = mx_noise_float(vec3(corner.mul(1.5), drift));
	const fine = mx_noise_float(vec3(corner.mul(3.7), drift.add(11.3)));
	const body = oneMinus(length(corner)).add(coarse.mul(.45)).add(fine.mul(.18));
	const lifted = corner.add(vec2(.12, .22));
	const above = oneMinus(length(lifted)).add(mx_noise_float(vec3(lifted.mul(1.5), drift)).mul(.45));
	return {
		density: smoothstep(.04, .42, body),
		light: clamp(body.sub(above).mul(1.8).add(corner.y.mul(.2)).add(.62), .12, 1.3)
	};
}
function boltWalk(x, seed) {
	const cell = floor(x.add(64));
	return mix(hash(cell.add(seed)), hash(cell.add(1).add(seed)), fract(x)).sub(.5);
}
function boltLine(along, across, seed, width, jag) {
	const offset = boltWalk(along.mul(5), seed).mul(.6).add(boltWalk(along.mul(13), seed.add(101)).mul(.3)).add(boltWalk(along.mul(31), seed.add(211)).mul(.14)).mul(jag);
	const gap = abs(across.sub(offset));
	return oneMinus(smoothstep(0, width, gap)).add(pow(max(oneMinus(gap.div(width.mul(9))), 0), 3).mul(.5));
}
function boltField(uv, phase, count, width, jag, steps, mode, seed) {
	const c = uv.mul(2).sub(1);
	const tick = floor(fract(phase).mul(steps));
	let glow = float(0);
	for (let i = 0; i < count; i++) {
		const s = tick.mul(977).add(i * 131 + seed * 7919 + 17);
		if (mode === "burst") {
			const r = length(c.xy);
			const angle = atan(c.y, c.x);
			const aim = hash(s).add(i).div(count).mul(TWO_PI);
			const turn = angle.sub(aim).add(PI);
			const wrapped = turn.sub(floor(turn.div(TWO_PI)).mul(TWO_PI)).sub(PI);
			const fade = oneMinus(smoothstep(.55, 1, r)).mul(smoothstep(0, .06, r));
			const main = boltLine(r, wrapped.mul(r), s, width, jag.mul(r));
			const fork = boltLine(r, wrapped.mul(r).sub(r.sub(.35).mul(hash(s.add(7)).sub(.5).mul(.9))), s.add(53), width.mul(.6), jag.mul(r)).mul(smoothstep(.3, .4, r));
			glow = max(glow, max(main, fork.mul(.8)).mul(fade));
		} else if (mode === "beam") {
			const along = uv.x;
			const fade = smoothstep(0, .03, along).mul(oneMinus(smoothstep(.97, 1, along)));
			glow = max(glow, boltLine(along, c.y, s, width, jag).mul(fade));
		} else {
			const x = c.x.add(hash(s.add(3)).sub(.5).mul(.6));
			const along = c.y.mul(.5).add(.5);
			const fade = smoothstep(0, .05, along).mul(oneMinus(smoothstep(.92, 1, along)));
			const main = boltLine(along, x, s, width, jag);
			const start = hash(s.add(9)).mul(.4).add(.25);
			const slope = hash(s.add(11)).sub(.5).mul(1.6);
			const branch = boltWalk(start.mul(5), s).mul(.6).mul(jag);
			const fork = boltLine(along, x.sub(branch).sub(along.sub(start).mul(slope)), s.add(29), width.mul(.6), jag.mul(.6)).mul(smoothstep(start, start.add(.03), along)).mul(oneMinus(smoothstep(start.add(.2), start.add(.4), along)));
			glow = max(glow, max(main, fork).mul(fade));
		}
	}
	return glow;
}
function burstClock(phase, index, cycles, sync) {
	const t = phase.mul(cycles);
	const k = floor(t);
	const a0 = t.sub(k).add(hash(index).mul(oneMinus(sync))).add(mul(sync, .03));
	const carry = step(1, a0);
	const c = k.add(carry);
	return {
		age: a0.sub(carry),
		cycle: c.sub(step(cycles - .5, c).mul(cycles))
	};
}
function lifeClock(clock, life) {
	return {
		age: min(clock.age.div(max(life, .01)), 1),
		cycle: clock.cycle
	};
}
function circleLine(x, center, width) {
	return oneMinus(smoothstep(width * .5, width * .5 + .006, abs(x.sub(center))));
}
function circleRunes(angle, r, inner, outer, count, seed) {
	const u = angle.div(TWO_PI).mul(count);
	const cell = floor(u);
	const x = fract(u).sub(.5).mul(2);
	const y = r.sub((inner + outer) / 2).div((outer - inner) / 2);
	const h = hash(cell.add(seed * 131 + 7)).mul(64);
	const bit = (k) => step(.5, fract(h.div(2 ** k)));
	const w = .16;
	const stem = oneMinus(smoothstep(w, .24, abs(x.sub(bit(0).sub(.5).mul(.6)))));
	const bar = oneMinus(smoothstep(w, .24, abs(y.sub(bit(1).sub(.5).mul(.8))))).mul(bit(2));
	const slash = oneMinus(smoothstep(w, .24, abs(x.sub(y.mul(bit(3).mul(2).sub(1)).mul(.7))))).mul(bit(4));
	const blob = oneMinus(smoothstep(.18, .28, length(vec2(x.sub(bit(5).sub(.5).mul(.9)), y.add(.45))))).mul(bit(1).mul(bit(4)));
	const inside = step(abs(x), .62).mul(step(abs(y), .8));
	return max(max(stem, bar), max(slash, blob)).mul(inside);
}
function circlePolygon(angle, r, radius, sides, turn, width) {
	const sector = Math.PI * 2 / sides;
	const a = angle.add(turn).sub(floor(angle.add(turn).div(sector)).mul(sector)).sub(sector / 2);
	return circleLine(r.mul(cos(a)), radius * Math.cos(Math.PI / sides), width);
}
function magicCircle(uv, phase, spin, sides, reveal, seed) {
	const c = uv.mul(2).sub(1);
	const r = length(c);
	const base = atan(c.y, c.x);
	const outerTurn = fract(phase).mul(TWO_PI).mul(spin);
	const outer = base.add(outerTurn);
	const inner = base.sub(outerTurn.mul(2));
	const wrap = (a) => a.sub(floor(a.div(TWO_PI)).mul(TWO_PI));
	let lines = circleLine(r, .955, .03).add(circleLine(r, .86, .012)).add(circleLine(r, .835, .008));
	lines = lines.add(circleRunes(wrap(outer), r, .865, .95, 40, seed).mul(.9));
	const tickAt = wrap(outer).div(TWO_PI).mul(120);
	const tickCell = fract(tickAt);
	const tickLong = step(fract(floor(tickAt).div(5)), .1);
	const ticks = oneMinus(smoothstep(.1, .22, abs(tickCell.sub(.5)))).mul(step(r, .83)).mul(step(mix(.795, .765, tickLong), r));
	lines = lines.add(ticks.mul(.8));
	const star = .64;
	lines = lines.add(circleLine(r, star, .014));
	const turn = Math.PI / sides;
	lines = lines.add(circlePolygon(inner, r, star, sides, 0, .013).mul(step(r, star)));
	lines = lines.add(circlePolygon(inner, r, star, sides, turn, .013).mul(step(r, star)));
	const nodes = (() => {
		let best = float(9);
		for (let k = 0; k < sides * 2; k++) {
			const a = k / (sides * 2) * Math.PI * 2;
			const p = vec2(cos(inner.sub(base).negate().add(a)), sin(inner.sub(base).negate().add(a))).mul(star);
			best = min(best, length(c.sub(p)));
		}
		return best;
	})();
	lines = lines.add(circleLine(nodes, .075, .012));
	lines = lines.add(circleLine(r, .34, .012)).add(circleRunes(wrap(inner), r, .25, .33, 18, seed + 5).mul(.8)).add(circleLine(r, .24, .008));
	lines = lines.add(circleLine(r, .12, .012)).add(circleLine(r, .06, .01));
	const glow = pow(max(oneMinus(r), 0), 3).mul(.25).add(oneMinus(smoothstep(.9, 1, r)).mul(.06));
	let shape = clamp(lines, 0, 1).mul(step(r, 1)).add(glow);
	if (reveal) {
		const sweep = clamp(phase.mul(3), 0, 1);
		const drawn = step(wrap(base.add(Math.PI / 2)).div(TWO_PI), sweep.mul(1.02));
		shape = shape.mul(drawn).add(oneMinus(smoothstep(0, .05, abs(wrap(base.add(Math.PI / 2)).div(TWO_PI).sub(sweep)))).mul(step(sweep, .999)).mul(step(r, .97)).mul(step(.82, r)).mul(1.5));
	}
	return shape;
}
function facetShade(angle, height, sides, seed) {
	const u = fract(angle).mul(sides);
	const id = floor(u);
	const f = fract(u);
	const tone = hash(id.add(seed * 17 + 3)).mul(.6).add(.4);
	const edge = oneMinus(smoothstep(0, .07, min(f, oneMinus(f))));
	return tone.mul(mix(.65, 1.1, height)).add(edge.mul(.75)).add(smoothstep(.75, 1, height).mul(.35));
}
function clusterPlace(p, index, scatter) {
	const lead = step(.5, index);
	const turn = hash(index.add(3)).mul(TWO_PI);
	const reach = sqrt(hash(index.add(5))).mul(scatter).mul(lead);
	const shrink = mix(1, hash(index.add(7)).mul(.4).add(.45), lead);
	const dir = vec3(cos(turn), 0, sin(turn));
	const q = p.mul(shrink);
	return q.add(dir.mul(q.y.mul(reach.div(max(scatter, .001)).mul(.6)))).add(dir.mul(reach));
}
function particleClock(phase, index, cycles) {
	const t = phase.mul(cycles);
	const k = floor(t);
	const a0 = t.sub(k).add(hash(index));
	const carry = step(1, a0);
	const c = k.add(carry);
	return {
		age: a0.sub(carry),
		cycle: c.sub(step(cycles - .5, c).mul(cycles))
	};
}
function hexCell(uv, width, fill, phase, cycles) {
	const size = vec2(1, 1.7320508);
	const half = size.mul(.5);
	const a = mod(uv, size).sub(half);
	const b = mod(uv.sub(half), size).sub(half);
	const g = select(dot(a, a).lessThan(dot(b, b)), a, b);
	const edge = abs(g);
	const d = max(dot(edge, vec2(.5, .8660254)), edge.x);
	const line = smoothstep(sub(.5, width), .5, d);
	const seed = mx_cell_noise_float(vec3(uv.sub(g).mul(2).add(.25), 0));
	const blink = pow(sin(phase.mul(cycles).add(seed).mul(TWO_PI)).mul(.5).add(.5), 6);
	return max(line, blink.mul(fill).mul(oneMinus(d)));
}
function hexGrid(p, normal, planar, width, fill, phase, cycles) {
	if (planar) return hexCell(p.xy, width, fill, phase, cycles);
	const w0 = pow(abs(normal), vec3(4));
	const w = w0.div(w0.x.add(w0.y).add(w0.z));
	return hexCell(p.yz, width, fill, phase, cycles).mul(w.x).add(hexCell(p.zx, width, fill, phase, cycles).mul(w.y)).add(hexCell(p.xy, width, fill, phase, cycles).mul(w.z));
}
function starfield(p, phase, density, size, twinkle, cycles) {
	const q = p.mul(density);
	const cell = floor(q);
	const seed = mx_cell_noise_float(cell);
	const jitter = vec3(mx_cell_noise_float(cell.add(13)), mx_cell_noise_float(cell.add(29)), mx_cell_noise_float(cell.add(41))).sub(.5).mul(.5);
	const dist = length(fract(q).sub(.5).sub(jitter));
	const star = pow(oneMinus(smoothstep(0, size, dist)), 3);
	const blink = mix(1, sin(phase.mul(cycles).add(seed.mul(7)).mul(TWO_PI)).mul(.5).add(.5), twinkle);
	return star.mul(smoothstep(.25, 1, seed)).mul(blink);
}
function caustics(p, phase, sharpness, cycles) {
	const angle = phase.mul(TWO_PI).mul(cycles);
	const warp = vec3(psrdnoise3(p.mul(.5).add(vec3(3.1, 7.7, 1.3)), vec3(0), angle), psrdnoise3(p.mul(.5).add(vec3(8.2, 2.4, 5.9)), vec3(0), angle), 0).mul(.6);
	const a = oneMinus(abs(psrdnoise3(p.add(warp), vec3(0), angle)));
	const b = oneMinus(abs(psrdnoise3(p.mul(1.9).sub(warp), vec3(0), angle.negate())));
	return clamp(pow(a, sharpness).add(pow(b, sharpness).mul(.7)), 0, 1);
}
function loopCracks(p, phase, drift, width) {
	const offset = vec3(.61, .37, .23).mul(drift);
	const fa = mx_worley_noise_vec2(p.add(offset.mul(phase)));
	const fb = mx_worley_noise_vec2(p.add(offset.mul(phase.sub(1))));
	const ea = oneMinus(smoothstep(0, width, fa.y.sub(fa.x)));
	const eb = oneMinus(smoothstep(0, width, fb.y.sub(fb.x)));
	return mix(ea, eb, phase);
}
function warp3(p, scale, amount, angle) {
	const q = p.mul(scale);
	const offset = vec3(psrdnoise3(q, vec3(0), angle), psrdnoise3(q.add(vec3(5.2, 1.3, 7.1)), vec3(0), angle), psrdnoise3(q.add(vec3(2.8, 9.4, 3.6)), vec3(0), angle));
	return p.add(offset.mul(amount));
}
function swirl(p, twist, angle) {
	const turned = rotate(p.xz, length(p.xz).mul(twist).add(angle));
	return vec3(turned.x, p.y, turned.y);
}
function toonShade(steps, softness, wrap) {
	const light = dot(normalWorld, normalize(vec3(.45, .7, .55))).mul(oneMinus(wrap)).add(wrap);
	const x = clamp(light, 0, 1).mul(steps);
	return floor(x).add(smoothstep(oneMinus(softness), 1, fract(x))).div(steps);
}
function convertMaterial(source) {
	const base = source ?? {};
	const material = base.isMeshBasicMaterial ? new THREE.MeshBasicNodeMaterial() : new THREE.MeshStandardNodeMaterial();
	material.name = base.name ?? "";
	if (base.color) material.color.copy(base.color);
	material.map = base.map ?? null;
	material.alphaMap = base.alphaMap ?? null;
	material.alphaTest = base.alphaTest ?? 0;
	material.transparent = !!base.transparent;
	material.opacity = base.opacity ?? 1;
	material.vertexColors = !!base.vertexColors;
	material.side = base.side ?? THREE.FrontSide;
	if (material.isMeshStandardNodeMaterial) {
		material.normalMap = base.normalMap ?? null;
		if (base.normalScale) material.normalScale.copy(base.normalScale);
		material.roughness = base.roughness ?? (base.shininess !== void 0 ? Math.sqrt(2 / (base.shininess + 2)) : .8);
		material.metalness = base.metalness ?? 0;
		material.roughnessMap = base.roughnessMap ?? null;
		material.metalnessMap = base.metalnessMap ?? null;
		material.aoMap = base.aoMap ?? null;
	}
	return material;
}
function overlay(mesh, material) {
	const copy = mesh.isSkinnedMesh ? new THREE.SkinnedMesh(mesh.geometry, material) : new THREE.Mesh(mesh.geometry, material);
	if (mesh.isSkinnedMesh) {
		copy.bindMode = mesh.bindMode;
		copy.bind(mesh.skeleton, mesh.bindMatrix);
	}
	if (mesh.morphTargetInfluences) {
		copy.morphTargetInfluences = mesh.morphTargetInfluences;
		copy.morphTargetDictionary = mesh.morphTargetDictionary;
	}
	copy.frustumCulled = false;
	mesh.add(copy);
	return copy;
}
function surfacePoints(meshes, count, origin, scale) {
	const data = new Float32Array(count * 8);
	let state = 2654435769;
	const random = () => (state = Math.imul(state, 1664525) + 1013904223 >>> 0) / 4294967296;
	const usable = meshes.filter((mesh) => mesh.geometry.getAttribute("position"));
	const samplers = usable.map((mesh) => new MeshSurfaceSampler(mesh).setRandomGenerator(random).build());
	const areas = samplers.map((sampler, i) => sampler.distribution[sampler.distribution.length - 1] * usable[i].matrixWorld.getMaxScaleOnAxis() ** 2);
	const total = areas.reduce((sum, area) => sum + area, 0);
	const position = new THREE.Vector3();
	const normal = new THREE.Vector3();
	const normalMatrix = new THREE.Matrix3();
	for (let i = 0; i < count && total > 0; i++) {
		let pick = random() * total;
		let k = 0;
		while (k < areas.length - 1 && pick > areas[k]) pick -= areas[k++];
		samplers[k].sample(position, normal);
		position.applyMatrix4(usable[k].matrixWorld).sub(origin).divideScalar(scale);
		normal.applyMatrix3(normalMatrix.getNormalMatrix(usable[k].matrixWorld)).normalize();
		data.set([
			position.x,
			position.y,
			position.z,
			1
		], i * 4);
		data.set([
			normal.x,
			normal.y,
			normal.z,
			0
		], (count + i) * 4);
	}
	const texture = new THREE.DataTexture(data, count, 2, THREE.RGBAFormat, THREE.FloatType);
	texture.needsUpdate = true;
	return texture;
}
var helpers = {
	permute4,
	toSimplex,
	fromSimplex,
	wrapPeriod,
	psrdnoise3,
	loopFbm,
	flowFbm,
	loopCells,
	glint,
	flameShape,
	expandingRing,
	twistCylinder,
	puffShape,
	boltWalk,
	boltLine,
	boltField,
	burstClock,
	lifeClock,
	circleLine,
	circleRunes,
	circlePolygon,
	magicCircle,
	facetShade,
	clusterPlace,
	particleClock,
	hexCell,
	hexGrid,
	starfield,
	caustics,
	loopCracks,
	warp3,
	swirl,
	toonShade,
	convertMaterial,
	overlay,
	surfacePoints
};
//#endregion
//#region src/runtime/post.ts
var WAVES = 8;
var glowing = /* @__PURE__ */ new WeakSet();
var glowFlag = uniform(0).onObjectUpdate(({ object }) => {
	if (!object) return 0;
	for (let o = object; o; o = o.parent) if (glowing.has(o)) return 1;
	return object.userData.rollshadeStatus ? 2 : 0;
});
var glow = vec4(select(glowFlag.equal(1), output.rgb, select(glowFlag.equal(2), emissive, vec3(0))), output.a);
function scenePassOf(scene, camera, outputs) {
	const p = pass(scene, camera);
	if (Object.keys(outputs).length === 1) return p;
	const targets = mrt(outputs);
	if (outputs.glow) targets.setBlendMode("glow", new THREE.BlendMode(THREE.MaterialBlending));
	p.setMRT(targets);
	return p;
}
var FXPost = class {
	renderer;
	camera;
	pipeline;
	loopPipeline;
	bloom;
	loopSceneBloom;
	loopBloom;
	waves = [];
	waveData = Array.from({ length: WAVES }, () => new THREE.Vector4());
	waveU;
	aspect = uniform(1);
	zoomCenter = uniform(new THREE.Vector2(.5, .5));
	zoomAmount = uniform(0);
	chroma = uniform(0);
	frameMode = uniform(0);
	flashAmount = uniform(0);
	flashColor = uniform(new THREE.Color(1, 1, 1));
	time = uniform(0);
	vignette = uniform(.55);
	scope;
	loopBloomUsed = false;
	clean = false;
	zoom = 0;
	aberration = 0;
	flash = 0;
	blinkT = 0;
	blinkAmount = 0;
	impactFrames = 0;
	scenePass;
	loopScenePass;
	constructor(renderer, scene, camera, opts = {}) {
		this.renderer = renderer;
		this.camera = camera;
		this.waveU = uniformArray(this.waveData, "vec4");
		this.scope = opts.bloom ?? "fx";
		const fx = this.scope === "fx" ? { glow } : {};
		this.scenePass = scenePassOf(scene, camera, {
			output,
			...fx
		});
		this.loopScenePass = scenePassOf(scene, camera, {
			output,
			emissive,
			...fx
		});
		const plain = this.chain(this.scenePass, opts);
		const looped = this.chain(this.loopScenePass, opts);
		this.bloom = plain.bloom;
		this.loopSceneBloom = looped.bloom;
		for (const k of [
			"strength",
			"radius",
			"threshold",
			"smoothWidth"
		]) looped.bloom[k] = plain.bloom[k];
		this.loopBloom = bloom(this.loopScenePass.getTextureNode("emissive"), 0, .5, 0);
		this.pipeline = new THREE.RenderPipeline(renderer);
		this.pipeline.outputNode = this.finish(plain.compressed.rgb.add(plain.bloom.rgb));
		this.loopPipeline = new THREE.RenderPipeline(renderer);
		this.loopPipeline.outputNode = this.finish(looped.compressed.rgb.add(looped.bloom.rgb).add(this.loopBloom.rgb));
	}
	chain(scenePass, opts) {
		const warped = Fn(() => {
			const p = uv().toVar();
			const offset = vec2(0).toVar();
			for (let i = 0; i < WAVES; i++) {
				const w = this.waveU.element(i);
				const dv = p.sub(w.xy).mul(vec2(this.aspect, 1));
				const x = length(dv).sub(w.z).div(max(w.z.mul(.35), .01));
				offset.addAssign(normalize(dv.add(1e-5)).mul(exp(x.mul(x).negate())).mul(w.w).div(vec2(this.aspect, 1)));
			}
			return p.sub(offset);
		})();
		const look = (tex, chroma) => Fn(() => {
			const acc = vec3(0).toVar();
			If(this.zoomAmount.greaterThan(0), () => {
				const dir = warped.sub(this.zoomCenter);
				for (let i = 0; i < 8; i++) {
					const s = warped.sub(dir.mul(this.zoomAmount.mul(i / 7)));
					const ca = s.sub(.5).mul(chroma);
					acc.addAssign(vec3(tex.sample(s.add(ca)).r, tex.sample(s).g, tex.sample(s.sub(ca)).b));
				}
				acc.divAssign(8);
			}).Else(() => {
				const ca = warped.sub(.5).mul(chroma);
				acc.assign(vec3(tex.sample(warped.add(ca)).r, tex.sample(warped).g, tex.sample(warped.sub(ca)).b));
			});
			return acc;
		})();
		const compress = (zoomed) => Fn(() => {
			const c = zoomed.toVar();
			const l = max(max(c.r, c.g), c.b);
			const knee = 1.6;
			const e = max(l.sub(knee), 0);
			const target = float(knee).add(e.div(e.div(knee).add(1)));
			return vec4(c.mul(select(l.greaterThan(knee), target.div(max(l, 1e-4)), float(1))), 1);
		})();
		const compressed = compress(look(scenePass.getTextureNode("output"), this.chroma));
		const source = this.scope === "fx" ? compress(look(scenePass.getTextureNode("glow"), this.chroma)) : compressed;
		return {
			compressed,
			bloom: bloom(source, opts.strength ?? .8, opts.radius ?? .25, opts.threshold ?? .45)
		};
	}
	finish(sum) {
		return Fn(() => {
			const c = sum.toVar();
			c.addAssign(this.flashColor.mul(this.flashAmount));
			const lum = dot(c, vec3(.299, .587, .114));
			const neg = vec3(1).sub(clamp(c, 0, 1)).mul(1.4);
			const mono = vec3(smoothstep(.25, .4, lum)).mul(2.2);
			c.assign(mix(c, neg, this.frameMode.equal(1).select(1, 0)));
			c.assign(mix(c, mono, this.frameMode.equal(2).select(1, 0)));
			const q = uv().sub(.5);
			c.mulAssign(float(1).sub(dot(q, q).mul(this.vignette)));
			return vec4(c, 1);
		})();
	}
	setLoopBloom(b) {
		this.loopBloom.strength.value = b ? b.strength : 0;
		if (b) {
			this.loopBloom.radius.value = b.radius;
			this.loopBloom.threshold.value = b.threshold;
		}
	}
	setSamples(samples) {
		for (const p of [this.scenePass, this.loopScenePass]) {
			if (p.options.samples === samples) continue;
			p.options.samples = samples;
			p.renderTarget.samples = samples;
			p.renderTarget.dispose();
		}
	}
	setScale(scale) {
		this.scenePass.setResolutionScale(scale);
		this.loopScenePass.setResolutionScale(scale);
	}
	flashTint(c) {
		this.flashColor.value.copy(c);
	}
	wave(pos, radius, dur, strength) {
		if (this.waves.length >= WAVES) this.waves.shift();
		this.waves.push({
			pos: pos.clone(),
			radius,
			dur,
			age: 0,
			strength
		});
	}
	zoomAt(pos, amount) {
		const s = pos.clone().project(this.camera);
		this.zoomCenter.value.set(s.x * .5 + .5, s.y * .5 + .5);
		this.zoom = Math.max(this.zoom, amount);
	}
	update(dt, realDt) {
		const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
		this.aspect.value = size.x / Math.max(size.y, 1);
		this.time.value = (this.time.value + realDt) % 100;
		const cam = this.camera;
		const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
		for (const w of this.waves) w.age += dt;
		this.waves = this.waves.filter((w) => w.age < w.dur);
		for (let i = 0; i < WAVES; i++) {
			const w = this.waves[i];
			const v = this.waveData[i];
			if (!w) {
				v.set(0, 0, .5, 0);
				continue;
			}
			const k = w.age / w.dur;
			const r = w.radius * (1 - Math.pow(1 - k, 3));
			const c = w.pos.clone().project(cam);
			const edge = w.pos.clone().addScaledVector(right, Math.max(r, .001)).project(cam);
			const rs = Math.abs(edge.x - c.x) * .5 * this.aspect.value;
			v.set(c.x * .5 + .5, c.y * .5 + .5, Math.max(rs, .001), c.z < 1 ? w.strength * .02 * Math.pow(1 - k, 2) : 0);
		}
		this.zoomAmount.value = this.clean ? 0 : this.zoom * .18;
		this.chroma.value = this.clean ? 0 : .002 + this.aberration * .012;
		this.flashAmount.value = this.clean ? 0 : Math.max(Math.min(this.flash, .35), this.blinkT > 0 ? this.blinkAmount : 0);
		this.frameMode.value = this.clean ? 0 : this.impactFrames > .06 ? 1 : this.impactFrames > 0 ? 2 : 0;
		this.vignette.value = this.clean ? 0 : .55;
		if (this.clean) for (const v of this.waveData) v.w = 0;
		const decay = Math.exp(-realDt * 10);
		this.zoom *= decay;
		this.aberration *= decay;
		this.flash *= Math.exp(-realDt * 14);
		this.impactFrames = Math.max(this.impactFrames - realDt, 0);
		this.blinkT = Math.max(this.blinkT - realDt, 0);
	}
	render() {
		(this.loopBloomUsed ? this.loopPipeline : this.pipeline).render();
	}
	warm() {
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
	setCamera(camera) {
		this.camera = camera;
		this.scenePass.camera = camera;
		this.loopScenePass.camera = camera;
	}
	dispose() {
		this.bloom.dispose?.();
		this.loopSceneBloom.dispose?.();
		this.loopBloom.dispose?.();
		this.scenePass.dispose();
		this.loopScenePass.dispose();
		this.pipeline.dispose();
		this.loopPipeline.dispose();
	}
};
//#endregion
//#region src/runtime/status.ts
var TAG = "__rollshadeStatus";
var keepers = /* @__PURE__ */ new Map();
function keep(key, material) {
	if (!keepers.has(key)) keepers.set(key, material);
}
var bound = (o) => o.userData.rollshadeStatus;
var bind = (o, value) => Object.defineProperty(o.userData, "rollshadeStatus", {
	value,
	enumerable: false,
	configurable: true,
	writable: true
});
var tag = (o) => Object.defineProperty(o.userData, TAG, {
	value: true,
	enumerable: false,
	configurable: true
});
function perObject(get) {
	return uniform(0).onObjectUpdate(({ object }) => {
		const b = object ? bound(object) : void 0;
		return b ? get(b) : 0;
	});
}
function perObjectColor(get) {
	const none = new THREE.Color();
	return uniform(new THREE.Color()).onObjectUpdate(({ object }) => {
		const b = object ? bound(object) : void 0;
		return b ? get(b) : none;
	});
}
var black = new THREE.Color();
var L = {
	time: perObject((b) => b.layer.u.time.value),
	foot: perObject((b) => b.layer.u.foot.value),
	height: perObject((b) => b.layer.u.height.value),
	char: perObject((b) => b.layer.u.char.value),
	ember: perObjectColor((b) => b.layer.u.ember.value),
	ice: perObject((b) => b.layer.u.ice.value),
	iceTint: perObjectColor((b) => b.layer.u.iceTint.value),
	tint: perObjectColor((b) => b.layer.u.tint.value),
	tintAmt: perObject((b) => b.layer.u.tintAmt.value),
	blotch: perObject((b) => b.layer.u.blotch.value),
	rim: perObjectColor((b) => b.layer.u.rim.value),
	rimAmt: perObject((b) => b.layer.u.rimAmt.value),
	stone: perObject((b) => b.layer.u.stone.value),
	gone: perObject((b) => b.layer.u.gone.value),
	edge: perObjectColor((b) => b.layer.u.edge.value),
	unit: perObject((b) => b.unit)
};
var R = {
	amount: perObject((b) => b.run?.amount.value ?? 0),
	core: perObjectColor((b) => b.run?.pal.core ?? black),
	main: perObjectColor((b) => b.run?.pal.main ?? black),
	accent: perObjectColor((b) => b.run?.pal.accent ?? black),
	shade: perObjectColor((b) => b.run?.shade ?? black),
	thick: perObject((b) => (b.thick ?? .02) / b.unit)
};
var meshKind = (mesh) => `${mesh.isSkinnedMesh ? "skin" : "rigid"}|${Object.keys(mesh.geometry?.morphAttributes ?? {}).join(",")}`;
var surfaces = /* @__PURE__ */ new WeakMap();
var shells = /* @__PURE__ */ new Map();
var held = /* @__PURE__ */ new Set();
var shellKey = /* @__PURE__ */ new WeakMap();
function release(material) {
	for (const m of keepers.values()) if (m === material) return;
	material.dispose();
}
function tri(p, n, s) {
	const w = abs(n);
	const ws = w.div(w.x.add(w.y).add(w.z).add(1e-4));
	return tnoise(p.yz.mul(s)).mul(ws.x).add(tnoise(p.xz.mul(s)).mul(ws.y)).add(tnoise(p.xy.mul(s)).mul(ws.z));
}
function dissolveField(p, n, h) {
	return tri(p, n, .55).r.mul(.75).add(float(1).sub(h).mul(.25)).sub(L.gone.mul(1.12).sub(.06));
}
function perturb(dH) {
	const sx = positionView.dFdx().normalize();
	const sy = positionView.dFdy().normalize();
	const r1 = cross(sy, normalView);
	const r2 = cross(normalView, sx);
	const det = dot(sx, r1).mul(faceDirection);
	const grad = sign(det).mul(dH.x.mul(r1).add(dH.y.mul(r2)));
	return abs(det).mul(normalView).sub(grad).normalize();
}
function sweep(amount, h, jitter) {
	const front = amount.mul(1.25).sub(.12);
	return float(1).sub(smoothstep(front.sub(.03), front.add(.03), h.add(jitter.sub(.5).mul(.18))));
}
var Surface = class {
	items = [];
	total = 0;
	a = new THREE.Vector3();
	b = new THREE.Vector3();
	c = new THREE.Vector3();
	m3 = new THREE.Matrix3();
	constructor(meshes) {
		for (const mesh of meshes) {
			const pos = mesh.geometry.getAttribute("position");
			if (!pos) continue;
			const index = mesh.geometry.getIndex();
			const count = index ? index.count : pos.count;
			const n = Math.floor(count / 3);
			if (n === 0) continue;
			const tris = new Uint32Array(n * 3);
			const cdf = new Float32Array(n);
			let acc = 0;
			for (let t = 0; t < n; t++) {
				for (let k = 0; k < 3; k++) tris[t * 3 + k] = index ? index.getX(t * 3 + k) : t * 3 + k;
				this.a.fromBufferAttribute(pos, tris[t * 3]);
				this.b.fromBufferAttribute(pos, tris[t * 3 + 1]);
				this.c.fromBufferAttribute(pos, tris[t * 3 + 2]);
				acc += this.b.sub(this.a).cross(this.c.sub(this.a)).length() * .5;
				cdf[t] = acc;
			}
			const scale = mesh.matrixWorld.getMaxScaleOnAxis() || 1;
			const area = acc * scale * scale;
			this.items.push({
				mesh,
				tris,
				cdf,
				area
			});
			this.total += area;
		}
	}
	sample(out, nrm) {
		if (this.total <= 0) return false;
		let pick = Math.random() * this.total;
		let k = 0;
		while (k < this.items.length - 1 && pick > this.items[k].area) pick -= this.items[k++].area;
		const { mesh, tris, cdf } = this.items[k];
		const x = Math.random() * cdf[cdf.length - 1];
		let lo = 0;
		let hi = cdf.length - 1;
		while (lo < hi) {
			const mid = lo + hi >> 1;
			if (cdf[mid] < x) lo = mid + 1;
			else hi = mid;
		}
		mesh.getVertexPosition(tris[lo * 3], this.a);
		mesh.getVertexPosition(tris[lo * 3 + 1], this.b);
		mesh.getVertexPosition(tris[lo * 3 + 2], this.c);
		let u = Math.random();
		let v = Math.random();
		if (u + v > 1) {
			u = 1 - u;
			v = 1 - v;
		}
		out.copy(this.a).addScaledVector(this.b.sub(this.a), u).addScaledVector(this.c.sub(this.a), v);
		if (nrm) nrm.copy(this.b).cross(this.c).normalize().applyMatrix3(this.m3.getNormalMatrix(mesh.matrixWorld)).normalize();
		mesh.localToWorld(out);
		return true;
	}
	band(out, y0, y1, tries = 8, nrm) {
		for (let t = 0; t < tries; t++) {
			if (!this.sample(out, nrm)) return false;
			if (out.y >= y0 && out.y <= y1) return true;
		}
		return false;
	}
};
var slot = (value) => ({ value });
function buildSurface(source) {
	const m = helpers.convertMaterial(source);
	const from = source;
	const lit = !!m.isMeshStandardNodeMaterial;
	if (lit && from.emissive) {
		m.emissive.copy(from.emissive);
		m.emissiveMap = from.emissiveMap ?? null;
		m.emissiveIntensity = from.emissiveIntensity ?? 1;
	}
	if (lit && from.envMap) {
		m.envMap = from.envMap;
		m.envMapIntensity = from.envMapIntensity ?? 1;
	}
	const p = positionGeometry.mul(L.unit);
	const n = normalGeometry;
	const h = positionWorld.y.sub(L.foot).div(L.height);
	const fres = pow(float(1).sub(abs(dot(normalView, positionViewDirection))).max(0), 2);
	const nz = tri(p, n, .35);
	const fine = tri(p, n, 1.6);
	const base = materialColor.rgb;
	const lum = dot(base, vec3(.299, .587, .114));
	const cracks = smoothstep(.035, 0, abs(fine.r.sub(.5))).mul(smoothstep(.35, .65, nz.g));
	const charred = mix(base, base.mul(.18).add(vec3(.02, .015, .012)), L.char.mul(smoothstep(.25, .75, nz.r.add(.25))));
	const blot = smoothstep(.52, .68, nz.r.add(fine.g.mul(.3)).sub(.15)).mul(L.blotch);
	const tinted = mix(charred, mix(charred, L.tint.mul(lum.mul(.6).add(.4)), .75), clamp(L.tintAmt.add(blot), 0, 1));
	const iceMask = sweep(L.ice, h, nz.r);
	const stoneMask = sweep(L.stone, h, nz.g);
	const frost = smoothstep(.45, .8, fine.g).mul(.35);
	const iceCol = mix(base.mul(.25).add(L.iceTint.mul(.45)), vec3(.92, .97, 1), frost.add(fres.mul(.5)));
	const grain = tri(p, n, 4.5);
	const speck = tri(p, n, 13);
	const fissure = smoothstep(.018, .004, abs(fine.r.sub(.5))).mul(smoothstep(.62, .75, nz.g));
	const height = nz.r.mul(.3).add(grain.r.mul(.35)).add(speck.g.mul(.35)).sub(fissure.mul(.5));
	const tone = mix(vec3(.22, .215, .2), vec3(.4, .38, .34), smoothstep(.3, .7, nz.g.mul(.6).add(grain.b.mul(.4))));
	const dots = smoothstep(.7, .76, speck.r).mul(-.3).add(smoothstep(.76, .82, speck.g).mul(.2)).add(grain.g.sub(.5).mul(.25));
	const stoneCol = tone.mul(lum.mul(.2).add(.9)).mul(smoothstep(.2, .7, height).mul(.35).add(.7)).mul(dots.add(1)).mul(float(1).sub(fissure.mul(.55)));
	const d = dissolveField(p, n, h);
	const edge = smoothstep(.07, 0, d).mul(smoothstep(0, .02, L.gone));
	m.colorNode = mix(mix(tinted, iceCol, iceMask), stoneCol, stoneMask).mul(float(1).sub(edge.mul(.8)));
	m.maskNode = d.greaterThan(0);
	const glitter = smoothstep(.86, .9, tri(p.add(positionViewDirection.mul(.02)), n, 5).r).mul(iceMask);
	const flick = tnoise(p.xz.mul(.2).add(L.time.mul(.35))).r.mul(1.4).sub(.2);
	m.emissiveNode = (lit ? materialEmissive : vec3(0)).add(L.ember.mul(cracks.mul(L.char).mul(flick).mul(3))).add(L.iceTint.mul(fres.mul(.35).add(glitter.mul(2))).mul(iceMask)).add(L.rim.mul(fres.mul(L.rimAmt))).add(L.tint.mul(blot.mul(.35))).add(L.edge.mul(pow(edge, 1.5).mul(4))).mul(float(1).sub(stoneMask.mul(.85)).max(edge));
	if (!m.normalMap) m.normalNode = perturb(vec2(height.dFdx(), height.dFdy()).mul(stoneMask).mul(2.2));
	if (lit) {
		m.roughnessNode = mix(mix(materialRoughness, float(.12), iceMask), float(.95), stoneMask);
		m.metalnessNode = mix(materialMetalness, float(0), stoneMask);
	}
	return m;
}
var StatusLayer = class {
	target;
	u = {
		time: slot(0),
		foot: slot(0),
		height: slot(1.8),
		char: slot(0),
		ember: slot(new THREE.Color()),
		ice: slot(0),
		iceTint: slot(new THREE.Color()),
		tint: slot(new THREE.Color()),
		tintAmt: slot(0),
		blotch: slot(0),
		rim: slot(new THREE.Color()),
		rimAmt: slot(0),
		stone: slot(0),
		gone: slot(0),
		edge: slot(new THREE.Color())
	};
	meshes = [];
	surface;
	runs = /* @__PURE__ */ new Set();
	center = new THREE.Vector3();
	radius = .4;
	originals = /* @__PURE__ */ new Map();
	footOffset = 0;
	world = new THREE.Vector3();
	placed = false;
	constructor(target) {
		this.target = target;
		target.updateWorldMatrix(true, true);
		target.traverse((o) => {
			const m = o;
			if (m.isMesh && !m.userData[TAG] && m.geometry?.getAttribute("position")) this.meshes.push(m);
		});
		const box = new THREE.Box3().setFromObject(target);
		const size = box.getSize(new THREE.Vector3());
		target.getWorldPosition(this.world);
		this.footOffset = box.min.y - this.world.y;
		this.u.height.value = Math.max(size.y, .2);
		this.radius = Math.max(size.x, size.z) * .5;
		this.surface = new Surface(this.meshes);
		for (const mesh of this.meshes) this.convert(mesh);
		this.sync();
	}
	get foot() {
		return this.u.foot.value;
	}
	get height() {
		return this.u.height.value;
	}
	sync() {
		this.target.getWorldPosition(this.world);
		this.u.foot.value = this.world.y + this.footOffset;
		this.center.set(this.world.x, this.u.foot.value + this.u.height.value * .5, this.world.z);
	}
	orphaned(scene) {
		let inside = false;
		for (let o = this.target; o; o = o.parent) if (o === scene) inside = true;
		if (inside) this.placed = true;
		return this.placed && !inside;
	}
	unitOf(mesh) {
		return mesh.matrixWorld.getMaxScaleOnAxis() || 1;
	}
	convert(mesh) {
		bind(mesh, {
			layer: this,
			unit: this.unitOf(mesh)
		});
		const converted = (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map((source) => {
			let byKind = surfaces.get(source);
			if (!byKind) surfaces.set(source, byKind = /* @__PURE__ */ new Map());
			const kind = meshKind(mesh);
			let m = byKind.get(kind);
			if (!m) {
				const built = m = buildSurface(source);
				byKind.set(kind, built);
				const drop = () => {
					source.removeEventListener("dispose", drop);
					byKind.delete(kind);
					built.dispose();
				};
				source.addEventListener("dispose", drop);
			}
			return m;
		});
		this.originals.set(mesh, mesh.material);
		mesh.material = Array.isArray(mesh.material) ? converted : converted[0];
	}
	reset() {
		const u = this.u;
		u.char.value = 0;
		u.ice.value = 0;
		u.tintAmt.value = 0;
		u.blotch.value = 0;
		u.rimAmt.value = 0;
		u.stone.value = 0;
		u.gone.value = 0;
		u.rim.value.setRGB(0, 0, 0);
	}
	dispose() {
		for (const [mesh, mat] of this.originals) {
			mesh.material = mat;
			delete mesh.userData.rollshadeStatus;
		}
		this.originals.clear();
	}
};
var StatusRun = class {
	fx;
	layer;
	name;
	recipe;
	handle;
	value = 0;
	target = 1;
	rate = 1;
	amount = { value: 0 };
	shade;
	ctx;
	pal;
	overlays = [];
	listeners = /* @__PURE__ */ new Map();
	stopping = false;
	fullSent = false;
	left = Infinity;
	fade;
	alive = true;
	done;
	resolve;
	state = {};
	constructor(fx, layer, name, recipe, handle, opts) {
		this.fx = fx;
		this.layer = layer;
		this.name = name;
		this.recipe = recipe;
		this.handle = handle;
		this.done = new Promise((r) => this.resolve = r);
		const element = opts.element ?? recipe.element;
		this.pal = palette(element, opts.hue ?? 0, opts.color);
		this.shade = (this.pal.smoke ?? this.pal.accent).clone().lerp(this.pal.accent, .45);
		this.ctx = new Ctx(fx, handle, {
			id: `status-${name}`,
			recipe: "status",
			element,
			hue: opts.hue ?? 0
		}, this.pal, {
			from: layer.target,
			to: layer.target,
			scale: opts.scale ?? 1
		});
		this.ctx.params = {};
		this.value = recipe.initial ?? 0;
		this.fade = opts.fade ?? .4;
		if (opts.lasts !== void 0 && !recipe.autoEnd) this.lasts = opts.lasts;
		this.to(recipe.autoEnd ? recipe.goal ?? 0 : opts.progress ?? recipe.goal ?? 1, opts.duration ?? recipe.duration);
		if (recipe.shell) for (const mesh of layer.meshes) {
			const key = `${name}|${meshKind(mesh)}`;
			let mat = shells.get(key);
			if (!mat) {
				const built = recipe.shell();
				built.positionNode = positionLocal.add(normalLocal.mul(R.thick));
				built.maskNode = dissolveField(positionGeometry.mul(L.unit), normalGeometry, positionWorld.y.sub(L.foot).div(L.height)).greaterThan(0);
				shells.set(key, mat = built);
			}
			const copy = helpers.overlay(mesh, mat);
			tag(copy);
			glowing.add(copy);
			shellKey.set(copy, key);
			bind(copy, {
				layer,
				run: this,
				unit: layer.unitOf(mesh),
				thick: recipe.thickness
			});
			copy.renderOrder = 2;
			this.overlays.push(copy);
		}
		recipe.start?.(this);
	}
	get progress() {
		return this.target;
	}
	set progress(v) {
		this.to(v, 0);
	}
	get lasts() {
		return this.left;
	}
	set lasts(seconds) {
		this.left = Math.max(seconds, 0);
	}
	to(progress, seconds = .5) {
		this.target = clamp01(progress);
		const gap = Math.abs(this.target - this.value);
		this.rate = seconds > 0 ? gap / seconds : Infinity;
		if (this.target < 1) this.fullSent = false;
		return this;
	}
	on(event, fn) {
		if (!this.listeners.has(event)) this.listeners.set(event, /* @__PURE__ */ new Set());
		this.listeners.get(event).add(fn);
		return () => this.listeners.get(event)?.delete(fn);
	}
	emit(event) {
		for (const fn of [...this.listeners.get(event) ?? []]) try {
			fn();
		} catch (error) {
			queueMicrotask(() => {
				throw error;
			});
		}
	}
	impact(point) {
		if (this.alive && !this.stopping) this.recipe.impact?.(this, point);
	}
	stop(fade = this.fade) {
		if (this.stopping || !this.alive) return;
		this.stopping = true;
		this.recipe.stopped?.(this);
		this.to(this.recipe.initial ?? 0, fade);
	}
	step(dt) {
		if (!this.alive) return;
		if (this.left !== Infinity && !this.stopping && (this.left -= dt) <= 0) this.stop();
		const d = this.target - this.value;
		const move = this.rate === Infinity ? Math.abs(d) : this.rate * dt;
		this.value = Math.abs(d) <= move ? this.target : this.value + Math.sign(d) * move;
		this.amount.value = this.value;
		if (this.value >= 1 && !this.fullSent && !this.recipe.autoEnd) {
			this.fullSent = true;
			this.emit("full");
		}
		this.recipe.apply(this, this.value);
		if (this.value > .001) this.recipe.tick?.(this, this.value, dt);
		if (this.stopping && this.value === (this.recipe.initial ?? 0)) this.finish();
		else if (this.recipe.autoEnd && this.value === this.target) this.finish();
	}
	finish() {
		if (!this.alive) return;
		this.alive = false;
		this.recipe.end?.(this);
		this.handle.stop();
		for (const o of this.overlays) {
			o.removeFromParent();
			const key = shellKey.get(o);
			if (held.has(key)) o.dispose();
			else held.add(key);
		}
		this.layer.runs.delete(this);
		this.emit("end");
		this.resolve();
	}
};
var StatusManager = class {
	fx;
	layers = /* @__PURE__ */ new Map();
	constructor(fx) {
		this.fx = fx;
	}
	start(target, name, recipe, handle, opts) {
		let layer = this.layers.get(target);
		if (!layer) {
			layer = new StatusLayer(target);
			this.layers.set(target, layer);
		}
		for (const r of [...layer.runs]) if (r.name === name || name === "appear" && r.name === "dissolve") r.finish();
		const run = new StatusRun(this.fx, layer, name, recipe, handle, opts);
		layer.runs.add(run);
		return run;
	}
	of(target) {
		return [...this.layers.get(target)?.runs ?? []];
	}
	update(dt, time) {
		for (const [target, layer] of this.layers) {
			if (layer.orphaned(this.fx.scene)) for (const run of [...layer.runs]) run.finish();
			layer.sync();
			layer.u.time.value = time;
			layer.reset();
			for (const run of [...layer.runs]) run.step(dt);
			if (layer.runs.size === 0) {
				layer.dispose();
				this.layers.delete(target);
			}
		}
	}
	clear() {
		for (const layer of this.layers.values()) for (const run of [...layer.runs]) run.finish();
	}
	get count() {
		let n = 0;
		for (const l of this.layers.values()) n += l.runs.size;
		return n;
	}
};
//#endregion
//#region src/runtime/statuses.ts
var ADDITIVE$1 = {
	transparent: true,
	depthWrite: false,
	blending: THREE.CustomBlending,
	blendSrc: THREE.OneFactor,
	blendDst: THREE.OneFactor
};
var NORMAL = {
	transparent: true,
	depthWrite: false
};
function shellBase() {
	return {
		p: positionGeometry.mul(L.unit),
		n: normalGeometry,
		h: positionWorld.y.sub(L.foot).div(L.height),
		fres: pow(float(1).sub(abs(dot(normalView, positionViewDirection))).max(0), 1.5),
		t: L.time,
		core: R.core,
		main: R.main,
		accent: R.accent
	};
}
function additive(color, alpha) {
	const m = new THREE.MeshBasicNodeMaterial(ADDITIVE$1);
	m.colorNode = vec3(0);
	m.emissiveNode = color.mul(alpha);
	m.opacityNode = alpha;
	return m;
}
var up = (a, b, spread = .25) => () => new THREE.Vector3((Math.random() - .5) * spread, a + Math.random() * (b - a), (Math.random() - .5) * spread);
function point(run, out = new THREE.Vector3(), nrm) {
	return run.layer.surface.sample(out, nrm) ? out : null;
}
function heldLight(run, range) {
	if (!run.state.light) run.state.light = run.fx.lights.hold(run.pal.main, range);
	return run.state.light;
}
function releaseLight(run) {
	run.state.light?.release(.3);
	run.state.light = null;
}
var burn = {
	element: "fire",
	duration: .35,
	thickness: .025,
	shell() {
		const { p, n, h, fres, t, core, main, accent } = shellBase();
		const a = tri(p.mul(vec3(1, .55, 1)).sub(vec3(0, t.mul(1.3), 0)), n, .8);
		const b = tri(p.mul(vec3(1, .7, 1)).sub(vec3(0, t.mul(2.1), 0)), n, 2);
		const heat = a.r.mul(.65).add(b.g.mul(.55)).add(fres.mul(.25)).sub(h.mul(.15));
		const fire = smoothstep(.5, .82, heat).mul(R.amount);
		return additive(mix(accent, main, smoothstep(.55, .75, heat)).add(core.mul(pow(fire, 3))).mul(1.4), fire);
	},
	apply(run, v) {
		const u = run.layer.u;
		u.char.value = Math.max(u.char.value, v * .85);
		u.ember.value.copy(run.pal.main);
	},
	tick(run, v, dt) {
		const s = run.ctx.scale;
		const c = run.ctx;
		const B = c.B;
		const at = new THREE.Vector3();
		for (let i = poisson(70 * v * dt); i > 0; i--) {
			if (!point(run, at)) break;
			c.emit("flame", 1, {
				p: at.clone(),
				jitter: .03 * s,
				v: up(.5, 1.1, .25),
				life: [.25, .45],
				size: [.06 * s, .12 * s],
				grow: 1.5,
				gravity: -1.2,
				drag: 2.5,
				curl: 1.4,
				curlScale: 1.8,
				colors: c.cols("main", "accent", "accent"),
				bright: .7 * B,
				fadeIn: .05,
				fadePow: 1.1
			});
		}
		for (let i = poisson(14 * v * dt); i > 0; i--) {
			if (!point(run, at)) break;
			c.emit("spark", 1, {
				p: at.clone(),
				v: up(1, 2.4, 1.2),
				life: [.5, 1.1],
				size: [.008 * s, .016 * s],
				drag: 1.2,
				curl: 2,
				curlScale: 2,
				stretch: .03,
				colors: c.cols("core", "main"),
				bright: 2.2 * B,
				flicker: .5
			});
		}
		const L = run.layer;
		if (Math.random() < dt * 2.5 * v) c.smoke(new THREE.Vector3(L.center.x, L.foot + L.height * .95, L.center.z), 1, {
			jitter: .15 * s,
			speed: [.3, .6],
			size: [.25 * s, .4 * s],
			delay: 0
		});
		const flick = .75 + .25 * Math.sin(L.u.time.value * 23) * Math.sin(L.u.time.value * 7.3);
		heldLight(run, 5).set(L.center, 14 * v * flick);
	},
	end: releaseLight
};
var freeze = {
	element: "ice",
	duration: .9,
	thickness: .018,
	shell() {
		const { p, n, h, fres, core, main } = shellBase();
		const nz = tri(p, n, .35);
		const front = R.amount.mul(1.25).sub(.12);
		const mask = float(1).sub(smoothstep(front.sub(.03), front.add(.03), h.add(nz.r.sub(.5).mul(.18))));
		const facet = tri(p, n, .9).b;
		const m = new THREE.MeshBasicNodeMaterial(NORMAL);
		m.colorNode = mix(main, core, fres.add(facet.mul(.3)));
		m.opacityNode = mask.mul(fres.mul(.55).add(.12)).mul(smoothstep(0, .2, L.ice));
		return m;
	},
	apply(run, v) {
		const u = run.layer.u;
		u.ice.value = Math.max(u.ice.value, v);
		u.iceTint.value.copy(run.pal.main);
	},
	start(run) {
		run.state.last = 0;
	},
	tick(run, v, dt) {
		const c = run.ctx;
		const s = c.scale;
		const L = run.layer;
		const at = new THREE.Vector3();
		const frontY = L.foot + L.height * (v * 1.25 - .12);
		const forming = v < 1 && v > run.state.last;
		run.state.last = v;
		if (forming) for (let i = poisson(80 * dt); i > 0; i--) {
			if (!L.surface.band(at, frontY - .12, frontY + .05)) break;
			c.emit("shard", 1, {
				p: at.clone(),
				v: () => randomDir().multiplyScalar(.6).add(new THREE.Vector3(0, .4, 0)),
				life: [.3, .6],
				size: [.015 * s, .035 * s],
				gravity: 4,
				drag: 1,
				spin: [-8, 8],
				colors: c.cols("core", "main"),
				bright: 1.4 * c.B
			});
			c.emit("mist", 1, {
				p: at.clone(),
				jitter: .05,
				v: up(.05, .25, .3),
				life: [.4, .8],
				size: [.1 * s, .18 * s],
				grow: 1.6,
				colors: c.cols("core", "main"),
				bright: .5 * c.B,
				fadeIn: .1
			});
		}
		if (v >= 1 || v < run.state.peak) {
			for (let i = poisson(10 * v * dt); i > 0; i--) {
				if (!point(run, at)) break;
				c.emit("mist", 1, {
					p: at.clone(),
					v: up(-.25, -.05, .1),
					life: [.8, 1.4],
					size: [.12 * s, .22 * s],
					grow: 1.8,
					curl: .6,
					colors: c.cols("core", "main"),
					bright: .35 * c.B,
					fadeIn: .2
				});
			}
			if (Math.random() < dt * 5 * v && point(run, at)) c.emit("star", 1, {
				p: at.clone(),
				life: [.2, .35],
				size: [.04 * s, .07 * s],
				colors: c.cols("core"),
				bright: 2.2 * c.B,
				alphaCurve: "flash"
			});
		}
		run.state.peak = Math.max(run.state.peak ?? 0, v);
	},
	end(run) {
		const c = run.ctx;
		const at = new THREE.Vector3();
		for (let i = 0; i < 40; i++) {
			if (!point(run, at)) break;
			c.emit("shard", 1, {
				p: at.clone(),
				v: () => randomDir().multiplyScalar(1.2).add(new THREE.Vector3(0, .8, 0)),
				life: [.5, .9],
				size: [.02, .045],
				gravity: 9,
				drag: .5,
				spin: [-10, 10],
				bounce: .3,
				colors: c.cols("core", "main"),
				bright: 1.3 * c.B
			});
		}
	}
};
var shock = {
	element: "thunder",
	duration: .15,
	thickness: .03,
	shell() {
		const { p, n, fres, t, core, main } = shellBase();
		const jump = t.mul(12).floor().mul(.37);
		const r1 = tri(p.add(vec3(jump, jump.mul(.7), 0)), n, 1.1).r;
		const r2 = tri(p.add(vec3(0, jump.mul(1.3), jump)), n, 2.3).g;
		const line = float(1).sub(abs(r1.sub(.5)).mul(2)).max(float(1).sub(abs(r2.sub(.5)).mul(2)).mul(.8));
		const arcs = smoothstep(.9, .98, line);
		const flick = smoothstep(.35, .6, tnoise(vec3(t.mul(3.1), t.mul(1.7), 0).xy).r);
		const alpha = arcs.mul(flick.mul(.8).add(.2)).add(fres.mul(.25).mul(flick)).mul(R.amount);
		return additive(mix(main, core, arcs).mul(2.2), alpha);
	},
	apply(run, v) {
		const u = run.layer.u;
		const f = Math.sin(u.time.value * 37) > .2 ? 1 : .3;
		u.rim.value.add(run.pal.main.clone().multiplyScalar(v * f));
		u.rimAmt.value = Math.max(u.rimAmt.value, 1.6);
	},
	tick(run, v, dt) {
		const c = run.ctx;
		const s = c.scale;
		const L = run.layer;
		const a = new THREE.Vector3();
		const b = new THREE.Vector3();
		if (Math.random() < dt * 7 * v && point(run, a) && point(run, b) && a.distanceTo(b) > .25 * L.height) c.bolt(a.clone(), b.clone(), {
			dur: .12,
			width: .035 * s,
			jag: .12,
			branches: 1,
			flicker: true
		});
		if (Math.random() < dt * 2 * v && point(run, a)) {
			const out = a.clone().sub(L.center).setY(0).normalize().multiplyScalar(.35 + Math.random() * .3).add(new THREE.Vector3(0, (Math.random() - .3) * .3, 0));
			c.bolt(a.clone(), a.clone().add(out), {
				dur: .1,
				width: .025 * s,
				jag: .1,
				flicker: true
			});
		}
		for (let i = poisson(30 * v * dt); i > 0; i--) {
			if (!point(run, a)) break;
			c.emit("spark", 1, {
				p: a.clone(),
				v: () => randomDir().multiplyScalar(1.5 + Math.random() * 2),
				life: [.1, .25],
				size: [.006 * s, .012 * s],
				gravity: 6,
				stretch: .04,
				colors: c.cols("core", "main"),
				bright: 3 * c.B
			});
		}
		const on = Math.sin(L.u.time.value * 37) > .2 ? 1 : .25;
		heldLight(run, 4).set(L.center, 10 * v * on);
	},
	end: releaseLight
};
var poison = {
	element: "poison",
	duration: .6,
	thickness: .02,
	shell() {
		const { p, n, h, fres, t, core, main } = shellBase();
		const drift = tri(p.add(vec3(0, t.mul(.25), 0)), n, .9);
		const ooze = smoothstep(.55, .75, drift.r.add(float(.4).sub(h).mul(.25))).mul(.6).add(fres.mul(.3));
		return additive(mix(main, core, pow(ooze, 2)).mul(1.3), ooze.mul(R.amount));
	},
	apply(run, v) {
		const u = run.layer.u;
		u.tint.value.copy(run.pal.main);
		u.blotch.value = Math.max(u.blotch.value, v);
		u.tintAmt.value = Math.max(u.tintAmt.value, v * (.22 + .08 * Math.sin(u.time.value * 2.4)));
	},
	tick(run, v, dt) {
		const c = run.ctx;
		const s = c.scale;
		const L = run.layer;
		const at = new THREE.Vector3();
		for (let i = poisson(30 * v * dt); i > 0; i--) {
			if (!point(run, at)) break;
			c.emit("bubble", 1, {
				p: at.clone(),
				jitter: .02,
				v: up(.15, .45, .1),
				life: [.35, .8],
				size: [.025 * s, .05 * s],
				grow: 1.6,
				colors: c.cols("core", "main"),
				bright: 1 * c.B,
				fadePow: .4
			});
		}
		for (let i = poisson(5 * v * dt); i > 0; i--) {
			if (!point(run, at)) break;
			c.emit("mote", 1, {
				p: at.clone(),
				v: () => new THREE.Vector3(0, -.2, 0),
				life: [.6, 1],
				size: [.012 * s, .022 * s],
				gravity: 5,
				bounce: 0,
				stretch: .03,
				colors: c.cols("main", "accent"),
				bright: 1.2 * c.B
			});
		}
		if (Math.random() < dt * 6 * v) {
			const g = new THREE.Vector3(L.center.x, L.foot + .05, L.center.z);
			c.emit("haze", 1, {
				p: g,
				jitter: L.radius * .8,
				v: up(.05, .2, .2),
				life: [1.2, 2],
				size: [.4 * s, .7 * s],
				grow: 1.5,
				colors: c.cols("accent", "main"),
				bright: .5 * c.B,
				fadeIn: .3
			});
		}
		if (Math.random() < dt * .7 * v) {
			const head = new THREE.Vector3(L.center.x, L.foot + L.height * .9, L.center.z);
			c.emit("glyph", 1, {
				p: head,
				jitter: .15,
				v: up(.3, .5, .1),
				life: [1, 1.4],
				size: [.12 * s, .18 * s],
				grow: 1.3,
				colors: c.cols("core", "main"),
				bright: .9 * c.B,
				fadeIn: .2,
				variant: 1
			});
		}
	}
};
var grey = [new THREE.Color(.42, .39, .35), new THREE.Color(.3, .28, .25)];
var petrify = {
	element: "earth",
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
		const frontY = L.foot + L.height * (v * 1.25 - .12);
		const moving = Math.abs(v - run.state.last) > 1e-4;
		run.state.last = v;
		if (moving && v < 1) for (let i = poisson(60 * dt); i > 0; i--) {
			if (!L.surface.band(at, frontY - .1, frontY + .04)) break;
			c.emit("shard", 1, {
				p: at.clone(),
				v: () => randomDir().multiplyScalar(.3).add(new THREE.Vector3(0, .2, 0)),
				life: [.4, .8],
				size: [.008 * s, .018 * s],
				gravity: 9,
				drag: .5,
				spin: [-6, 6],
				bounce: .2,
				colors: grey,
				bright: .9
			});
			if (Math.random() < .35) c.emit("smoke", 1, {
				p: at.clone(),
				v: up(.05, .2, .3),
				life: [.6, 1.1],
				size: [.08 * s, .14 * s],
				grow: 2,
				drag: 2,
				colors: grey,
				fadeIn: .1,
				fadePow: 1.2
			});
		}
		if (v >= 1 && Math.random() < dt * 1.5 && point(run, at)) c.emit("shard", 1, {
			p: at.clone(),
			v: () => new THREE.Vector3(0, -.1, 0),
			life: [.6, 1],
			size: [.006 * s, .012 * s],
			gravity: 9,
			bounce: .2,
			colors: grey,
			bright: .8
		});
	},
	stopped(run) {
		if (run.value < .6) return;
		const c = run.ctx;
		const s = c.scale;
		const L = run.layer;
		const at = new THREE.Vector3();
		for (let i = 0; i < 10; i++) {
			if (!point(run, at)) break;
			c.rocks(at.clone(), 1, .6 * s, () => at.clone().sub(L.center).setY(0).normalize().multiplyScalar(.8 + Math.random()).add(new THREE.Vector3(0, 1 + Math.random() * 1.5, 0)));
		}
		for (let i = 0; i < 50; i++) {
			if (!point(run, at)) break;
			c.emit("shard", 1, {
				p: at.clone(),
				v: () => randomDir().multiplyScalar(.8).add(new THREE.Vector3(0, .6, 0)),
				life: [.5, 1],
				size: [.01 * s, .025 * s],
				gravity: 9,
				drag: .4,
				spin: [-8, 8],
				bounce: .3,
				colors: grey,
				bright: .9
			});
		}
		c.dust(new THREE.Vector3(L.center.x, L.foot, L.center.z), .8 * s);
	}
};
function dissolveTick(run, v, dt) {
	const c = run.ctx;
	const s = c.scale;
	const L = run.layer;
	const speed = Math.abs(v - (run.state.last ?? v)) / Math.max(dt, 1e-4);
	run.state.last = v;
	if (speed < .001 || v <= .02 || v >= .999) return;
	const at = new THREE.Vector3();
	const lo = L.foot + L.height * Math.max(1 - v * 1.35, 0);
	for (let i = poisson(260 * speed * dt); i > 0; i--) {
		if (!L.surface.band(at, lo, lo + L.height * .35)) break;
		c.emit("mote", 1, {
			p: at.clone(),
			v: up(.2, .7, .4),
			life: [.5, 1.1],
			size: [.012 * s, .028 * s],
			drag: 1.2,
			curl: 1.4,
			curlScale: 2,
			colors: c.cols("core", "main"),
			bright: 2.2 * c.B,
			fadeIn: .02
		});
		if (Math.random() < .3) c.emit("smoke", 1, {
			p: at.clone(),
			v: up(.15, .45, .3),
			life: [.7, 1.2],
			size: [.06 * s, .12 * s],
			grow: 2,
			drag: 1.5,
			curl: 1,
			colors: [new THREE.Color(.08, .07, .07)],
			fadeIn: .05
		});
	}
	heldLight(run, 4).set(L.center, 8 * Math.min(speed, 1.5) * (1 - v));
}
var dissolve = {
	element: "fire",
	duration: 1.6,
	apply(run, v) {
		const u = run.layer.u;
		u.gone.value = Math.max(u.gone.value, v);
		u.edge.value.copy(run.pal.main).lerp(run.pal.core, .3);
	},
	tick: dissolveTick,
	end: releaseLight
};
var appear = {
	element: "arcane",
	duration: 1.4,
	initial: 1,
	goal: 0,
	autoEnd: true,
	apply(run, v) {
		const u = run.layer.u;
		u.gone.value = Math.max(u.gone.value, v);
		u.edge.value.copy(run.pal.main).lerp(run.pal.core, .3);
	},
	tick: dissolveTick,
	end: releaseLight
};
function anchorFor(run, at) {
	if (run.state.anchor === void 0) run.state.anchor = claimAnchor(at);
	anchors[run.state.anchor].copy(at);
	return run.state.anchor;
}
function freeAnchor(run) {
	const id = run.state.anchor;
	if (id === void 0) return;
	run.state.anchor = void 0;
	run.fx.scheduler.after(2.5, () => releaseAnchor(id));
}
var STATUSES = {
	burn,
	freeze,
	shock,
	poison,
	petrify,
	dissolve,
	appear,
	bless: {
		element: "light",
		duration: .5,
		thickness: .03,
		shell() {
			const { p, n, h, fres, t, core, main } = shellBase();
			const rays = tri(p.mul(vec3(1, .25, 1)).sub(vec3(0, t.mul(.7), 0)), n, 1.4);
			const glow = smoothstep(.55, .8, rays.r).mul(fres.mul(.7).add(.3)).add(fres.mul(.35)).mul(smoothstep(1.1, .4, h));
			return additive(mix(main, core, glow).mul(1.3), glow.mul(R.amount));
		},
		apply(run, v) {
			const u = run.layer.u;
			u.rim.value.add(run.pal.main.clone().multiplyScalar(v));
			u.rimAmt.value = Math.max(u.rimAmt.value, 1.3);
		},
		tick(run, v, dt) {
			const c = run.ctx;
			const s = c.scale;
			const L = run.layer;
			const id = anchorFor(run, new THREE.Vector3(L.center.x, L.foot, L.center.z));
			const R = Math.max(L.radius, .25);
			c.emit("mote", poisson(30 * v * dt), {
				p: () => new THREE.Vector3(L.center.x, L.foot + .05, L.center.z).add(randomDir().setY(0).normalize().multiplyScalar(R * 1.2)),
				orbit: {
					w: 1.4,
					rise: .9,
					r0: R * 1.2,
					r1: R * .6,
					h: L.height * 1.1,
					pull: 2,
					anchor: id
				},
				life: [1.2, 1.8],
				size: [.015 * s, .03 * s],
				colors: c.cols("core", "main"),
				bright: 2.2 * c.B,
				fadeIn: .2,
				alphaCurve: "bell"
			});
			if (Math.random() < dt * 1.5 * v && point(run, run.state.at ?? (run.state.at = new THREE.Vector3()))) c.emit("glyph", 1, {
				p: run.state.at.clone(),
				v: up(.4, .7, .1),
				life: [.9, 1.3],
				size: [.1 * s, .15 * s],
				colors: c.cols("core", "main"),
				bright: 1.4 * c.B,
				fadeIn: .2,
				variant: 2
			});
			if (Math.random() < dt * 4 * v && point(run, run.state.at ?? (run.state.at = new THREE.Vector3()))) c.emit("star", 1, {
				p: run.state.at.clone(),
				life: [.2, .4],
				size: [.05 * s, .09 * s],
				colors: c.cols("core"),
				bright: 2 * c.B,
				alphaCurve: "flash"
			});
			heldLight(run, 4).set(L.center, 5 * v * (.85 + .15 * Math.sin(L.u.time.value * 3)));
		},
		end(run) {
			releaseLight(run);
			freeAnchor(run);
		}
	},
	curse: {
		element: "dark",
		duration: .6,
		thickness: .035,
		shell() {
			const { p, n, h, fres, t } = shellBase();
			const w = tri(p.mul(vec3(1, .6, 1)).sub(vec3(0, t.mul(.45), 0)), n, 1.1);
			const wisps = smoothstep(.42, .7, w.r.add(fres.mul(.35)).add(h.mul(.12)));
			const m = new THREE.MeshBasicNodeMaterial(NORMAL);
			m.colorNode = R.shade;
			m.opacityNode = wisps.mul(.92).mul(R.amount);
			return m;
		},
		apply(run, v) {
			const u = run.layer.u;
			const pulse = .5 + .5 * Math.sin(u.time.value * 3.2);
			u.tint.value.copy(run.pal.accent);
			u.tintAmt.value = Math.max(u.tintAmt.value, v * (.6 + .15 * pulse));
			u.rim.value.add(run.pal.main.clone().multiplyScalar(v * (.6 + .8 * pulse)));
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
				c.emit("smoke", 1, {
					p: at.clone(),
					v: up(.25, .6, .2),
					life: [.8, 1.4],
					size: [.16 * s, .3 * s],
					grow: 1.8,
					drag: 1.5,
					curl: 1.2,
					colors: [dark.clone(), dark.clone().lerp(run.pal.accent, .4)],
					fadeIn: .15
				});
			}
			const id = anchorFor(run, L.center);
			const R = Math.max(L.radius, .25);
			c.emit("mote", poisson(18 * v * dt), {
				p: () => L.center.clone().add(randomDir().multiplyScalar(R * 2.2)),
				orbit: {
					w: -2,
					rise: -.3,
					r0: R * 2,
					r1: R * .3,
					h: L.height * .6,
					pull: 1.5,
					anchor: id
				},
				life: [.9, 1.4],
				size: [.015 * s, .028 * s],
				colors: c.cols("core", "main"),
				bright: 1.8 * c.B,
				fadeIn: .2,
				alphaCurve: "bell"
			});
			if (Math.random() < dt * 5 * v) c.emit("haze", 1, {
				p: new THREE.Vector3(L.center.x, L.foot + .05, L.center.z),
				jitter: R,
				v: up(.02, .12, .2),
				life: [1.2, 2],
				size: [.5 * s, .8 * s],
				grow: 1.4,
				colors: [dark.clone(), dark.clone().lerp(run.pal.accent, .5)],
				bright: .8,
				fadeIn: .3
			});
			if (Math.random() < dt * .8 * v) c.emit("glyph", 1, {
				p: new THREE.Vector3(L.center.x, L.foot + L.height * .8, L.center.z),
				jitter: R,
				v: up(.2, .4, .1),
				life: [1, 1.5],
				size: [.12 * s, .18 * s],
				colors: c.cols("main", "accent"),
				bright: 1.2 * c.B,
				fadeIn: .25,
				variant: 0
			});
		},
		end: freeAnchor
	},
	shield: {
		element: "water",
		duration: .3,
		start(run) {
			const prim = run.fx.prims.acquire("shield");
			prim.u.core.value.copy(run.pal.core);
			prim.u.main.value.copy(run.pal.main);
			prim.u.accent.value.copy(run.pal.accent);
			prim.u.bright.value = 1.6 * run.ctx.B;
			prim.u.hitData.forEach((h) => h.set(0, 1, 0, 9));
			run.state.prim = prim;
			run.state.age = 0;
			run.state.slot = 0;
		},
		apply(run, v) {
			const u = run.layer.u;
			u.rim.value.add(run.pal.main.clone().multiplyScalar(v * .3));
			u.rimAmt.value = Math.max(u.rimAmt.value, .8);
		},
		tick(run, v, dt) {
			const prim = run.state.prim;
			if (!prim) return;
			const L = run.layer;
			run.state.age += dt;
			const age = run.state.age;
			const rx = Math.max(L.radius * 1.35, L.height * .42) * run.ctx.scale;
			const ry = L.height * .62 * run.ctx.scale;
			const pop = ease.outBack(Math.min(age / .3, 1));
			prim.mesh.position.copy(L.center);
			prim.mesh.scale.set(rx * (.85 + .15 * pop), ry * (.85 + .15 * pop), rx * (.85 + .15 * pop));
			prim.u.reveal.value = Math.min(age / .35, 1);
			prim.u.time.value = age;
			prim.u.fade.value = v;
			for (const h of prim.u.hitData) h.w += dt;
		},
		impact(run, point) {
			const prim = run.state.prim;
			if (!prim) return;
			const L = run.layer;
			const c = run.ctx;
			const dir = point.clone().sub(L.center).normalize();
			prim.u.hitData[run.state.slot].set(dir.x, dir.y, dir.z, 0);
			run.state.slot = (run.state.slot + 1) % prim.u.hitData.length;
			const at = L.center.clone().add(dir.clone().multiply(prim.mesh.scale));
			c.emit("spark", 24, {
				p: at,
				v: () => dir.clone().add(randomDir().multiplyScalar(.8)).multiplyScalar(3.5),
				life: [.15, .3],
				size: [.01, .02],
				drag: 3,
				stretch: .03,
				colors: c.cols("core", "main"),
				bright: 3 * c.B,
				fadeIn: 0
			});
			c.star(at, .5 * c.scale, .12, 2.5);
		},
		stopped(run) {
			const prim = run.state.prim;
			if (!prim) return;
			const c = run.ctx;
			const L = run.layer;
			const r = prim.mesh.scale.x;
			c.emit("shard", 70, {
				p: () => L.center.clone().add(randomDir().multiply(prim.mesh.scale)),
				v: () => randomDir().multiplyScalar(2 + Math.random() * 2),
				life: [.4, .7],
				size: [.03, .06],
				gravity: 6,
				drag: 1.5,
				stretch: .02,
				colors: c.cols("core", "main"),
				bright: 2 * c.B,
				fadeIn: 0
			});
			c.ring(L.center, r * 1.3, {
				normal: "camera",
				dur: .35,
				thick: .06
			});
		},
		end(run) {
			const prim = run.state.prim;
			if (prim) run.fx.prims.release(prim);
			run.state.prim = null;
		}
	},
	stun: {
		element: "light",
		duration: .2,
		tick(run, v, dt) {
			const c = run.ctx;
			const s = c.scale;
			const L = run.layer;
			const head = new THREE.Vector3(L.center.x, L.foot + L.height + .12 * s, L.center.z);
			const id = anchorFor(run, head);
			const R = .3 * s;
			run.state.acc = (run.state.acc ?? 0) + dt * v * 6;
			while (run.state.acc >= 1) {
				run.state.acc -= 1;
				run.state.turn = ((run.state.turn ?? 0) + 2.4) % (Math.PI * 2);
				const a = run.state.turn;
				const p = head.clone().add(new THREE.Vector3(Math.cos(a) * R, 0, Math.sin(a) * R));
				c.emit("star", 1, {
					p,
					orbit: {
						w: 5,
						rise: 0,
						r0: R,
						r1: R,
						h: 1,
						pull: 4,
						anchor: id
					},
					life: [.9, 1],
					size: [.09 * s, .12 * s],
					colors: c.cols("core", "main"),
					bright: 2.4 * c.B,
					fadeIn: .1,
					alphaCurve: "bell"
				});
				c.emit("mote", 3, {
					p,
					jitter: .02,
					orbit: {
						w: 5,
						rise: 0,
						r0: R,
						r1: R,
						h: 1,
						pull: 4,
						anchor: id
					},
					life: [.3, .5],
					size: [.012 * s, .02 * s],
					colors: c.cols("main"),
					bright: 1.6 * c.B,
					delay: [.02, .15]
				});
			}
		},
		apply() {},
		end: freeAnchor
	}
};
//#endregion
//#region src/runtime/fixtures.ts
var ADDITIVE = {
	transparent: true,
	depthWrite: false,
	blending: THREE.CustomBlending,
	blendSrc: THREE.OneFactor,
	blendDst: THREE.OneFactor
};
var cardGeometry = new THREE.PlaneGeometry(1, 1).translate(0, .5, 0);
var discGeometry = new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2);
var FixtureRun = class {
	fx;
	name;
	recipe;
	handle;
	at;
	group = new THREE.Group();
	ctx;
	pal;
	scale;
	amount = uniform(0);
	time = uniform(0);
	state = {};
	prop;
	lit;
	value = 0;
	target = 1;
	alive = true;
	done;
	resolve;
	rate = 2;
	stopping = false;
	listeners = /* @__PURE__ */ new Set();
	disposables = [];
	kept = 0;
	circles = [];
	tmpQ = new THREE.Quaternion();
	held = null;
	lightY = 0;
	lightPos = new THREE.Vector3();
	constructor(fx, name, recipe, handle, at, opts) {
		this.fx = fx;
		this.name = name;
		this.recipe = recipe;
		this.handle = handle;
		this.at = at;
		this.done = new Promise((r) => this.resolve = r);
		const element = opts.element ?? recipe.element;
		this.pal = palette(element, opts.hue ?? 0, opts.color);
		this.scale = opts.scale ?? 1;
		this.prop = opts.prop ?? true;
		this.lit = opts.light ?? true;
		this.target = opts.intensity ?? 1;
		this.ctx = new Ctx(fx, handle, {
			id: `loop-${name}`,
			recipe: "loop",
			element,
			hue: opts.hue ?? 0
		}, this.pal, {
			from: this.group,
			to: this.group,
			scale: this.scale
		});
		this.ctx.params = {};
		this.ctx.floorOf = () => opts.floorY ?? this.group.position.y;
		this.group.scale.setScalar(this.scale);
		this.group.rotation.y = opts.rotation ?? 0;
		fx.root.add(this.group);
		this.follow();
		recipe.build(this);
	}
	get intensity() {
		return this.target;
	}
	set intensity(v) {
		this.target = Math.max(v, 0);
	}
	get anchor() {
		return this.at;
	}
	impact(point) {
		if (this.alive && !this.stopping) this.recipe.impact?.(this, point);
	}
	moveTo(at) {
		this.at = at;
		this.follow();
	}
	on(event, fn) {
		if (event === "end") this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}
	stop(fade = .5) {
		if (this.stopping || !this.alive) return;
		this.stopping = true;
		this.target = 0;
		this.rate = fade > 0 ? 1 / fade : Infinity;
	}
	own(d) {
		if (d.isMaterial) keep(`loop:${this.name}:${this.kept++}`, d);
		this.disposables.push(d);
		return d;
	}
	world(x, y, z, out = new THREE.Vector3()) {
		return out.set(x, y, z).applyMatrix4(this.group.matrixWorld);
	}
	follow() {
		if (this.at instanceof THREE.Object3D) this.at.getWorldPosition(this.group.position);
		else this.group.position.copy(this.at);
		this.group.updateMatrixWorld(true);
	}
	step(dt, time) {
		if (!this.alive) return;
		this.follow();
		const d = this.target - this.value;
		const move = this.rate === Infinity ? Math.abs(d) : this.rate * dt;
		this.value = Math.abs(d) <= move ? this.target : this.value + Math.sign(d) * move;
		this.amount.value = this.value;
		this.time.value = time;
		for (const c of this.circles) {
			c.age += dt;
			c.turn += c.spin * dt;
			const m = c.prim.mesh;
			this.world(0, c.y, 0, m.position);
			if (c.forward) m.quaternion.copy(this.group.getWorldQuaternion(this.tmpQ));
			else m.quaternion.setFromAxisAngle(new THREE.Vector3(1, 0, 0), -Math.PI / 2).premultiply(this.group.getWorldQuaternion(this.tmpQ));
			m.scale.setScalar(c.size * this.scale * (.6 + .4 * ease.outBack(Math.min(c.age / .4, 1))));
			c.prim.u.turn.value = c.turn;
			c.prim.u.reveal.value = Math.min(c.age / .6, 1);
			c.prim.u.fade.value = this.value;
		}
		this.recipe.tick(this, this.value, dt);
		if (this.stopping && this.value <= 0) this.finish();
	}
	finish() {
		if (!this.alive) return;
		this.alive = false;
		this.recipe.end?.(this);
		this.handle.stop();
		this.held?.release(.2);
		this.held = null;
		for (const c of this.circles) this.fx.prims.release(c.prim);
		this.circles.length = 0;
		this.group.removeFromParent();
		for (const d of this.disposables) if (d.isMaterial) release(d);
		else d.dispose();
		for (const fn of this.listeners) fn();
		this.resolve();
	}
	flame(o) {
		const q = uv();
		const seed = uniform(o.seed);
		const t = this.time.mul(uniform(o.speed ?? 1));
		const n1 = tnoise(vec2(q.x.mul(.35).add(seed), q.y.mul(.45).sub(t.mul(.55)))).r;
		const n2 = tnoise(vec2(q.x.mul(.8).add(seed.mul(1.7)), q.y.mul(.9).sub(t.mul(1.1)))).g;
		const noise = n1.mul(.65).add(n2.mul(.35));
		const y = q.y;
		const sway = noise.sub(.5).mul(.32).mul(y).add(tnoise(vec2(t.mul(.08), seed)).r.sub(.5).mul(.18).mul(y.mul(y)));
		const x = q.x.sub(.5).add(sway);
		const half = mix(float(.62), float(.1), pow(y, .85)).mul(.5).mul(smoothstep(0, .22, y).mul(.55).add(.45));
		const fuel = float(1).sub(smoothstep(.15, 1, abs(x).div(half))).mul(1.5).sub(y.mul(1.05)).add(noise.sub(.5).mul(.75));
		const f = smoothstep(.05, .55, fuel).mul(smoothstep(0, .06, y)).mul(this.amount);
		const core = smoothstep(.35, .75, fuel).mul(float(1).sub(smoothstep(.2, .6, y)));
		const main = uniform(this.pal.main.clone());
		const accent = uniform(this.pal.accent.clone());
		const white = uniform(this.pal.core.clone());
		const m = this.own(new THREE.MeshBasicNodeMaterial(ADDITIVE));
		m.vertexNode = billboarding({ horizontalRotation: true });
		m.colorNode = vec3(0);
		m.emissiveNode = mix(accent, main, smoothstep(.1, .5, fuel)).add(white.mul(core.mul(.9))).mul(f).mul(1.15);
		m.opacityNode = f;
		const mesh = new THREE.Mesh(cardGeometry, m);
		mesh.position.set(o.x ?? 0, o.y ?? 0, o.z ?? 0);
		mesh.scale.set(o.w, o.h, 1);
		mesh.renderOrder = 3;
		mesh.frustumCulled = false;
		this.group.add(mesh);
		return mesh;
	}
	glowDisc(y, radius, strength) {
		const r = length(uv().sub(.5)).mul(2);
		const main = uniform(this.pal.main.clone());
		const flick = tnoise(vec2(this.time.mul(.9), .3)).r.mul(.5).add(.75);
		const a = pow(float(1).sub(smoothstep(0, 1, r)), 2).mul(uniform(strength)).mul(flick).mul(this.amount);
		const m = this.own(new THREE.MeshBasicNodeMaterial(ADDITIVE));
		m.colorNode = vec3(0);
		m.emissiveNode = main.mul(a);
		m.opacityNode = a;
		const mesh = new THREE.Mesh(discGeometry, m);
		mesh.position.y = y;
		mesh.scale.setScalar(radius);
		mesh.renderOrder = 1;
		this.group.add(mesh);
		return mesh;
	}
	circle(y, size, o = {}) {
		const prim = this.fx.prims.acquire("circle");
		this.fx.prims.pin(prim);
		prim.u.core.value.copy(this.pal.core);
		prim.u.main.value.copy(this.pal.main);
		prim.u.accent.value.copy(this.pal.accent);
		prim.u.bright.value = (o.bright ?? 1.4) * this.ctx.B;
		const look = CIRCLES[this.ctx.element] ?? CIRCLES.arcane;
		for (const [k, v] of Object.entries({
			sidesB: 0,
			skipB: 1,
			rotB: 0,
			spokes: 0,
			branch: 0,
			spiral: 0,
			waves: 0,
			dots: 0,
			petals: 0,
			runes: 3,
			ticks: 1,
			...look
		})) prim.u[k].value = v;
		prim.u.mode.value = o.style ?? 0;
		this.circles.push({
			prim,
			y,
			size,
			spin: o.spin ?? .3,
			turn: Math.random() * 6,
			forward: o.forward ?? false,
			age: 0
		});
	}
	column(y, radius, height, strength) {
		const q = uv();
		const main = uniform(this.pal.main.clone());
		const core = uniform(this.pal.core.clone());
		const flow = tnoise(vec2(q.x.mul(2), q.y.mul(.6).sub(this.time.mul(.25)))).r;
		const fade = smoothstep(0, .15, q.y).mul(pow(float(1).sub(q.y).max(0), 1.6));
		const rim = pow(float(1).sub(abs(dot(normalView, positionViewDirection))).max(0), 1.2);
		const a = fade.mul(flow.mul(.6).add(.4)).mul(rim.mul(.7).add(.3)).mul(uniform(strength)).mul(this.amount);
		const m = this.own(new THREE.MeshBasicNodeMaterial({
			...ADDITIVE,
			side: THREE.DoubleSide
		}));
		m.colorNode = vec3(0);
		m.emissiveNode = mix(main, core, fade.mul(.3)).mul(a);
		m.opacityNode = a;
		const g = this.own(new THREE.CylinderGeometry(radius, radius * .85, height, 32, 1, true).translate(0, height / 2, 0));
		const mesh = new THREE.Mesh(g, m);
		mesh.position.y = y;
		mesh.renderOrder = 2;
		this.group.add(mesh);
		return mesh;
	}
	pointLight(y, range) {
		if (!this.lit) return;
		this.held = this.fx.loopLights.tryHold(this.pal.main, range * this.scale);
		this.lightY = y;
	}
	shine(intensity) {
		if (!this.held) return;
		this.held.set(this.world(0, this.lightY, 0, this.lightPos), intensity);
	}
	lightAt(p, intensity) {
		this.held?.set(p, intensity);
	}
	solid(geometry, color, o = {}) {
		const m = this.own(new THREE.MeshStandardMaterial({
			color,
			roughness: o.roughness ?? .85,
			metalness: o.metalness ?? 0,
			emissive: o.emissive ?? 0
		}));
		this.own(geometry);
		const mesh = new THREE.Mesh(geometry, m);
		this.group.add(mesh);
		return mesh;
	}
};
function flicker(run, speed = 1) {
	const t = run.time.value * speed;
	return .82 + .1 * Math.sin(t * 13.1) * Math.sin(t * 7.7 + 1.3) + .08 * Math.sin(t * 29.3 + run.state.phase);
}
function embers(run, at, rate, spread, dt, rise = 1) {
	const c = run.ctx;
	const s = run.scale;
	c.emit("spark", poisson(rate * dt), {
		p: at,
		jitter: spread * s,
		v: () => new THREE.Vector3((Math.random() - .5) * .4, (.8 + Math.random() * 1.2) * rise, (Math.random() - .5) * .4).multiplyScalar(s),
		life: [.8, 1.8],
		size: [.006 * s, .013 * s],
		drag: .8,
		curl: 2.4,
		curlScale: 2.2,
		stretch: .02,
		colors: c.cols("core", "main"),
		bright: 2.2 * c.B,
		flicker: .6
	});
}
function flames(run, at, rate, spread, size, dt) {
	const c = run.ctx;
	const s = run.scale;
	c.emit("flame", poisson(rate * dt), {
		p: at,
		jitter: spread * s,
		v: () => new THREE.Vector3((Math.random() - .5) * .15, .5 + Math.random() * .6, (Math.random() - .5) * .15).multiplyScalar(s),
		life: [.25, .5],
		size: [size * .6 * s, size * s],
		grow: 1.3,
		gravity: -1.5,
		drag: 2,
		curl: 1.2,
		curlScale: 2,
		colors: c.cols("main", "accent", "accent"),
		bright: .8 * c.B,
		fadeIn: .05,
		fadePow: 1.2
	});
}
function smoke(run, at, rate, size, dt) {
	const c = run.ctx;
	const s = run.scale;
	const col = run.pal.smoke ?? new THREE.Color(.12, .11, .11);
	c.emit("smoke", poisson(rate * dt), {
		p: at,
		jitter: .03 * s,
		v: () => new THREE.Vector3((Math.random() - .5) * .1, .5 + Math.random() * .3, (Math.random() - .5) * .1).multiplyScalar(s),
		life: [1.4, 2.4],
		size: [size * .5 * s, size * s],
		grow: 2.6,
		drag: .6,
		curl: .9,
		curlScale: 1.2,
		colors: [col.clone(), col.clone().multiplyScalar(1.6)],
		fadeIn: .25,
		fadePow: 1.3
	});
}
var FIXTURES = {
	torch: {
		element: "fire",
		build(run) {
			run.state.phase = Math.random() * 10;
			if (run.prop) {
				const stick = run.solid(new THREE.CylinderGeometry(.022, .017, .52, 7).translate(0, .26, 0), 4863011);
				stick.castShadow = true;
				run.solid(new THREE.CylinderGeometry(.04, .03, .11, 8).translate(0, .54, 0), 2759956, { emissive: 3805700 });
			}
			run.state.top = run.prop ? .58 : 0;
			run.flame({
				y: run.state.top - .03,
				w: .24,
				h: .4,
				seed: Math.random() * 10,
				speed: 1.1
			});
			run.flame({
				y: run.state.top - .02,
				w: .13,
				h: .3,
				seed: Math.random() * 10,
				speed: 1.5
			});
			run.pointLight(run.state.top + .15, 7);
		},
		tick(run, v, dt) {
			const at = run.world(0, run.state.top + .04, 0);
			flames(run, at, 26 * v, .03, .09, dt);
			embers(run, at, 5 * v, .03, dt);
			smoke(run, run.world(0, run.state.top + .4, 0), 2.5 * v, .12, dt);
			run.shine(5 * v * flicker(run));
		}
	},
	campfire: {
		element: "fire",
		build(run) {
			run.state.phase = Math.random() * 10;
			if (run.prop) {
				const log = new THREE.CylinderGeometry(.045, .05, .5, 7);
				for (let i = 0; i < 5; i++) {
					const a = i / 5 * Math.PI * 2 + .3;
					const mesh = run.solid(log.clone(), i % 2 ? 4008476 : 4863011);
					mesh.position.set(Math.cos(a) * .2, .11, Math.sin(a) * .2);
					mesh.lookAt(run.world(0, .34, 0));
					mesh.rotateX(Math.PI / 2);
					mesh.castShadow = true;
				}
				log.dispose();
				const stone = new THREE.DodecahedronGeometry(.07, 0);
				for (let i = 0; i < 10; i++) {
					const a = i / 10 * Math.PI * 2;
					const mesh = run.solid(stone.clone(), 5591628, { roughness: .95 });
					mesh.position.set(Math.cos(a) * .42, .03, Math.sin(a) * .42);
					mesh.scale.set(1 + Math.random() * .4, .6 + Math.random() * .3, 1 + Math.random() * .3);
					mesh.rotation.set(Math.random(), Math.random() * 3, Math.random());
				}
				stone.dispose();
				const coals = run.solid(new THREE.CircleGeometry(.2, 12).rotateX(-Math.PI / 2).translate(0, .015, 0), 1313286, { emissive: 5904900 });
				coals.renderOrder = 0;
			}
			run.glowDisc(.02, 1.4, .35);
			run.flame({
				y: .06,
				w: .66,
				h: 1.05,
				seed: Math.random() * 10,
				speed: .9
			});
			run.flame({
				x: .09,
				y: .02,
				z: .05,
				w: .42,
				h: .6,
				seed: Math.random() * 10,
				speed: 1.2
			});
			run.flame({
				x: -.09,
				y: .02,
				z: -.04,
				w: .4,
				h: .55,
				seed: Math.random() * 10,
				speed: 1.3
			});
			run.pointLight(.5, 10);
		},
		tick(run, v, dt) {
			const c = run.ctx;
			const base = run.world(0, .08, 0);
			flames(run, base, 55 * v, .1, .16, dt);
			embers(run, base, 14 * v, .1, dt, 1.4);
			if (Math.random() < dt * .6 * v) c.emit("spark", 10, {
				p: run.world(0, .15, 0),
				v: () => randomDir().setY(Math.random() * 1.5 + .8).multiplyScalar(1.6 * run.scale),
				life: [.4, .9],
				size: [.006 * run.scale, .012 * run.scale],
				gravity: 3,
				drag: 1,
				stretch: .03,
				colors: c.cols("core", "main"),
				bright: 2.8 * c.B
			});
			smoke(run, run.world(0, .9, 0), 5 * v, .28, dt);
			run.shine(11 * v * flicker(run, .8));
		}
	},
	candles: {
		element: "fire",
		build(run) {
			run.state.phase = Math.random() * 10;
			const tops = [];
			const spots = [
				[
					0,
					.52,
					0
				],
				[
					-.16,
					.42,
					0
				],
				[
					.16,
					.42,
					0
				]
			];
			if (run.prop) {
				const metal = {
					roughness: .35,
					metalness: .8
				};
				run.solid(new THREE.CylinderGeometry(.1, .12, .03, 16).translate(0, .015, 0), 7035450, metal);
				run.solid(new THREE.CylinderGeometry(.014, .018, .4, 8).translate(0, .22, 0), 7035450, metal);
				run.solid(new THREE.TorusGeometry(.16, .008, 6, 24, Math.PI).rotateX(Math.PI).translate(0, .42, 0), 7035450, metal);
				for (const [x, y, z] of spots) {
					run.solid(new THREE.CylinderGeometry(.03, .025, .012, 10).translate(x, y - .1, z), 7035450, metal);
					run.solid(new THREE.CylinderGeometry(.018, .018, .1, 10).translate(x, y - .045, z), 15260864, { roughness: .6 });
				}
			}
			for (const [x, y, z] of spots) {
				const top = new THREE.Vector3(x, run.prop ? y + .01 : 0, z);
				tops.push(top);
				run.flame({
					x: top.x,
					y: top.y,
					z: top.z,
					w: .045,
					h: .11,
					seed: Math.random() * 10,
					speed: .8
				});
			}
			run.state.tops = tops;
			run.pointLight(.6, 5);
		},
		tick(run, v, dt) {
			const c = run.ctx;
			for (const top of run.state.tops) {
				const at = run.world(top.x, top.y + .03, top.z);
				c.emit("glow", poisson(6 * v * dt), {
					p: at,
					life: [.2, .3],
					size: [.06 * run.scale, .09 * run.scale],
					colors: c.cols("main", "accent"),
					bright: .6 * c.B,
					fadeIn: .1
				});
				if (Math.random() < dt * .4 * v) smoke(run, run.world(top.x, top.y + .14, top.z), 1 / dt, .03, dt);
			}
			run.shine(2.2 * v * flicker(run, .6));
		}
	},
	portal: {
		element: "arcane",
		build(run) {
			const H = 1.05;
			const W = .78;
			run.state.center = new THREE.Vector3(0, 1.1, 0);
			if (run.prop) {
				const stone = { roughness: .9 };
				const frame = run.solid(new THREE.TorusGeometry(1, .07, 8, 48), 4933714, stone);
				frame.scale.set(.86, 1.1300000000000001, 1);
				frame.position.copy(run.state.center);
				run.solid(new THREE.BoxGeometry(.5, .08, .34).translate(0, .04, 0), 4012610, stone);
			}
			const q = uv().sub(.5).mul(2);
			const r = length(q);
			const ang = atan(q.y, q.x);
			const t = run.time;
			const spiral = tnoise(vec2(ang.div(Math.PI * 2).mul(2).add(r.mul(.9)).sub(t.mul(.12)), r.mul(.5).sub(t.mul(.3)))).r;
			const arms = smoothstep(.55, .8, spiral.add(r.mul(.25)));
			const main = uniform(run.pal.main.clone());
			const core = uniform(run.pal.core.clone());
			const accent = uniform(run.pal.accent.clone());
			const edge = smoothstep(.7, .98, r);
			const inside = float(1).sub(smoothstep(.97, 1, r));
			const m = run.own(new THREE.MeshBasicNodeMaterial({
				transparent: true,
				depthWrite: false,
				side: THREE.DoubleSide
			}));
			m.colorNode = mix(accent.mul(.08), accent.mul(.35), spiral.mul(r));
			m.emissiveNode = mix(main, core, pow(edge, 3)).mul(arms.mul(r).mul(.9).add(edge.mul(.7))).mul(run.amount);
			m.opacityNode = inside.mul(run.amount).mul(.95);
			const disc = new THREE.Mesh(run.own(new THREE.PlaneGeometry(2, 2)), m);
			disc.scale.set(W, H, 1);
			disc.position.copy(run.state.center);
			disc.renderOrder = 2;
			run.group.add(disc);
			const rq = positionLocal;
			const rimFlow = tnoise(vec2(atan(rq.y, rq.x).div(Math.PI * 2).mul(3).sub(t.mul(.4)), .3)).r;
			const rm = run.own(new THREE.MeshBasicNodeMaterial(ADDITIVE));
			rm.colorNode = vec3(0);
			rm.emissiveNode = mix(main, core, rimFlow).mul(rimFlow.mul(1.2).add(.4)).mul(run.amount).mul(.8);
			rm.opacityNode = run.amount;
			const rim = new THREE.Mesh(run.own(new THREE.TorusGeometry(1, .025, 6, 64)), rm);
			rim.scale.set(W, H, 1);
			rim.position.copy(run.state.center);
			run.group.add(rim);
			run.state.W = W;
			run.state.H = H;
			run.glowDisc(.02, 1.3, .2);
			run.pointLight(run.state.center.y, 6);
		},
		tick(run, v, dt) {
			const c = run.ctx;
			const s = run.scale;
			const center = run.world(run.state.center.x, run.state.center.y, run.state.center.z);
			const fwd = new THREE.Vector3(0, 0, 1).applyQuaternion(run.group.quaternion);
			const right = new THREE.Vector3(1, 0, 0).applyQuaternion(run.group.quaternion);
			const W = run.state.W * s;
			const H = run.state.H * s;
			c.emit("mote", poisson(40 * v * dt), {
				p: () => {
					const a = Math.random() * Math.PI * 2;
					const k = 1.3 + Math.random() * .8;
					return center.clone().addScaledVector(right, Math.cos(a) * W * k).add(new THREE.Vector3(0, Math.sin(a) * H * k, 0)).addScaledVector(fwd, (Math.random() - .5) * .6);
				},
				hook: c.hook({ fields: [{
					kind: "attract",
					power: 5,
					at: center,
					max: 3
				}] }),
				v: () => new THREE.Vector3(),
				life: [.8, 1.2],
				size: [.012 * s, .025 * s],
				drag: 1.2,
				stretch: .03,
				colors: c.cols("core", "main"),
				bright: 2 * c.B,
				fadeIn: .2
			});
			c.emit("spark", poisson(18 * v * dt), {
				p: () => {
					const a = Math.random() * Math.PI * 2;
					return center.clone().addScaledVector(right, Math.cos(a) * W).add(new THREE.Vector3(0, Math.sin(a) * H, 0));
				},
				v: () => randomDir().multiplyScalar(.3),
				life: [.3, .6],
				size: [.006 * s, .012 * s],
				colors: c.cols("core", "main"),
				bright: 2.4 * c.B
			});
			if (Math.random() < dt * 3 * v) c.emit("mist", 1, {
				p: run.world(0, .05, 0),
				jitter: .4 * s,
				v: () => fwd.clone().multiplyScalar(.15 * (Math.random() > .5 ? 1 : -1)),
				life: [1.2, 2],
				size: [.3 * s, .5 * s],
				grow: 1.5,
				colors: c.cols("main", "accent"),
				bright: .35 * c.B,
				fadeIn: .3
			});
			run.shine(4 * v * (.85 + .15 * Math.sin(run.time.value * 2.3)));
		}
	},
	sigil: {
		element: "arcane",
		build(run) {
			run.circle(.02, 1.25, {
				spin: .25,
				bright: 1.5
			});
			run.circle(.03, .62, {
				spin: -.5,
				bright: 1.2,
				style: 1
			});
			run.column(.02, 1, 1.6, .35);
			run.glowDisc(.015, 1.6, .25);
			run.pointLight(.4, 5);
		},
		tick(run, v, dt) {
			const c = run.ctx;
			const s = run.scale;
			const g = run.world(0, .05, 0);
			c.emit("mote", poisson(26 * v * dt), {
				p: () => g.clone().add(randomDir().setY(0).normalize().multiplyScalar(Math.sqrt(Math.random()) * 1.1 * s)),
				v: () => new THREE.Vector3(0, .5 + Math.random() * .7, 0),
				life: [.9, 1.6],
				size: [.012 * s, .024 * s],
				drag: .3,
				curl: .5,
				colors: c.cols("core", "main"),
				bright: 2 * c.B,
				fadeIn: .2,
				alphaCurve: "bell"
			});
			if (Math.random() < dt * 1.2 * v) c.emit("glyph", 1, {
				p: g.clone().add(randomDir().setY(0).normalize().multiplyScalar(.8 * s)),
				v: () => new THREE.Vector3(0, .35, 0),
				life: [1.2, 1.8],
				size: [.1 * s, .14 * s],
				colors: c.cols("core", "main"),
				bright: 1.4 * c.B,
				fadeIn: .3,
				variant: 0
			});
			run.shine(3 * v * (.8 + .2 * Math.sin(run.time.value * 1.7)));
		}
	},
	savepoint: {
		element: "light",
		build(run) {
			if (run.prop) {
				const stone = { roughness: .85 };
				run.solid(new THREE.CylinderGeometry(.34, .4, .14, 8).translate(0, .07, 0), 4867920, stone);
				run.solid(new THREE.CylinderGeometry(.26, .3, .06, 8).translate(0, .17, 0), 5722974, stone);
			}
			const base = run.prop ? .2 : .02;
			run.state.base = base;
			run.circle(base + .01, .55, {
				spin: .4,
				bright: 1.3
			});
			run.column(base, .28, 1.9, .45);
			const pulse = sin(run.time.mul(2.2)).mul(.25).add(.75);
			const main = uniform(run.pal.main.clone());
			const core = uniform(run.pal.core.clone());
			const fres = pow(float(1).sub(abs(dot(normalView, positionViewDirection))).max(0), 2);
			const m = run.own(new THREE.MeshStandardNodeMaterial({
				roughness: .12,
				metalness: .1,
				transparent: true
			}));
			m.colorNode = main.mul(.35);
			m.emissiveNode = mix(main, core, fres).mul(fres.mul(1.2).add(.45)).mul(pulse).mul(run.amount).mul(1.3);
			m.opacityNode = run.amount.mul(.9);
			const crystal = new THREE.Mesh(run.own(new THREE.OctahedronGeometry(.14, 0)), m);
			crystal.scale.set(1, 1.7, 1);
			run.group.add(crystal);
			run.state.crystal = crystal;
			run.state.y = base + .95;
			run.pointLight(base + .9, 6);
		},
		tick(run, v, dt) {
			const c = run.ctx;
			const s = run.scale;
			const t = run.time.value;
			const crystal = run.state.crystal;
			crystal.position.y = run.state.y + Math.sin(t * 1.3) * .06;
			crystal.rotation.y = t * .8;
			const at = run.world(0, crystal.position.y, 0);
			const g = run.world(0, run.state.base, 0);
			c.emit("mote", poisson(20 * v * dt), {
				p: () => g.clone().add(randomDir().setY(0).normalize().multiplyScalar(.45 * s)),
				v: () => new THREE.Vector3(0, .45 + Math.random() * .3, 0),
				swirl: 2,
				center: g,
				life: [1.4, 2.2],
				size: [.012 * s, .022 * s],
				colors: c.cols("core", "main"),
				bright: 2 * c.B,
				fadeIn: .2,
				alphaCurve: "bell"
			});
			if (Math.random() < dt * 3 * v) c.emit("star", 1, {
				p: at.clone().add(randomDir().multiplyScalar(.25 * s)),
				life: [.25, .4],
				size: [.05 * s, .08 * s],
				colors: c.cols("core"),
				bright: 2.2 * c.B,
				alphaCurve: "flash"
			});
			run.shine(3.5 * v * (.8 + .2 * Math.sin(t * 2.2)));
		}
	},
	barrier: {
		element: "light",
		build(run) {
			const prim = run.fx.prims.acquire("shield");
			prim.u.core.value.copy(run.pal.core);
			prim.u.main.value.copy(run.pal.main);
			prim.u.accent.value.copy(run.pal.accent);
			prim.u.bright.value = 1.3 * run.ctx.B;
			prim.u.hitData.forEach((h) => h.set(0, 1, 0, 9));
			run.state.prim = prim;
			run.state.slot = 0;
			run.state.age = 0;
			run.state.R = 2.4;
			run.circle(.02, run.state.R * 1.04, {
				spin: .12,
				bright: 1.2
			});
			run.pointLight(.6, 7);
		},
		tick(run, v, dt) {
			const prim = run.state.prim;
			const c = run.ctx;
			const s = run.scale;
			const R = run.state.R * s;
			run.state.age += dt;
			const pop = ease.outBack(Math.min(run.state.age / .5, 1));
			run.world(0, 0, 0, prim.mesh.position);
			prim.mesh.scale.setScalar(R * (.8 + .2 * pop));
			prim.u.reveal.value = Math.min(run.state.age / .6, 1);
			prim.u.time.value = run.state.age;
			prim.u.fade.value = v;
			for (const h of prim.u.hitData) h.w += dt;
			const g = run.world(0, .05, 0);
			c.emit("mote", poisson(40 * v * dt), {
				p: () => g.clone().add(randomDir().setY(0).normalize().multiplyScalar(R)),
				v: () => new THREE.Vector3(0, .6 + Math.random() * .6, 0),
				life: [.8, 1.4],
				size: [.012 * s, .024 * s],
				colors: c.cols("core", "main"),
				bright: 2 * c.B,
				fadeIn: .15,
				alphaCurve: "bell"
			});
			run.shine(3 * v);
		},
		impact(run, point) {
			const prim = run.state.prim;
			const c = run.ctx;
			const center = run.world(0, 0, 0);
			const dir = point.clone().sub(center).normalize();
			prim.u.hitData[run.state.slot].set(dir.x, dir.y, dir.z, 0);
			run.state.slot = (run.state.slot + 1) % prim.u.hitData.length;
			const at = center.addScaledVector(dir, prim.mesh.scale.x);
			c.emit("spark", 30, {
				p: at,
				v: () => dir.clone().add(randomDir().multiplyScalar(.8)).multiplyScalar(4),
				life: [.15, .35],
				size: [.012, .022],
				drag: 3,
				stretch: .03,
				colors: c.cols("core", "main"),
				bright: 3 * c.B,
				fadeIn: 0
			});
			c.star(at, .7 * run.scale, .12, 2.5);
		},
		end(run) {
			const prim = run.state.prim;
			if (!prim) return;
			const c = run.ctx;
			const center = run.world(0, 0, 0);
			const r = prim.mesh.scale.x;
			c.emit("shard", 90, {
				p: () => center.clone().add(randomDir().setY(Math.abs(Math.random())).normalize().multiplyScalar(r)),
				v: () => randomDir().multiplyScalar(2),
				life: [.4, .8],
				size: [.04, .07],
				gravity: 5,
				drag: 1.5,
				colors: c.cols("core", "main"),
				bright: 1.8 * c.B,
				fadeIn: 0
			});
			run.fx.prims.release(prim);
			run.state.prim = null;
		}
	},
	aura: {
		element: "fire",
		build(run) {
			const at = run.anchor;
			let height = 1.8;
			let radius = .4;
			let foot = 0;
			if (at instanceof THREE.Object3D) {
				const box = new THREE.Box3().setFromObject(at);
				if (!box.isEmpty()) {
					const size = box.getSize(new THREE.Vector3());
					height = Math.max(size.y, .3);
					radius = Math.max(Math.max(size.x, size.z) * .5, .2);
					foot = box.min.y - at.getWorldPosition(new THREE.Vector3()).y;
				}
			}
			run.state.h = height;
			run.state.r = Math.min(radius, height * .3);
			run.state.foot = foot;
			const c = run.ctx;
			const g = () => run.world(0, run.state.foot / run.scale, 0);
			const r = run.state.r * 1.2;
			const h = height;
			const dark = c.element === "dark";
			const hold = 1e6;
			const pulse = () => 1 + .15 * Math.sin(run.time.value * 2 * Math.PI * .9);
			const fade = () => run.value * pulse();
			const opts = {
				at: g,
				dur: hold,
				fade,
				erode: () => 0,
				fadeLo: .02
			};
			c.lathe(g(), {
				...opts,
				profile: "cylinder",
				radius: 1.15 * r,
				top: .8 * r,
				height: h * 1.25,
				flow: 2.6,
				twist: 1.9,
				tiles: [6, 1.6],
				streak: .5,
				rim: .4,
				fadeHi: .6,
				wobble: .1,
				bright: dark ? .9 : 1,
				edge: .12,
				smoke: dark,
				colors: dark ? [
					"core",
					"smoke",
					"smoke"
				] : void 0
			});
			c.lathe(g(), {
				...opts,
				profile: "cylinder",
				radius: .9 * r,
				top: .5 * r,
				height: h * 1.4,
				flow: 3.3,
				twist: -1.2,
				tiles: [8, 2],
				streak: .7,
				rim: .2,
				fadeHi: .55,
				bright: 1,
				edge: .12,
				wobble: .12
			});
			c.lathe(g(), {
				...opts,
				profile: "dome",
				radius: 1.3 * r,
				height: .3,
				flow: 1.5,
				tiles: [6, 1],
				streak: .7,
				rim: .5,
				bright: .7
			});
			run.pointLight(h * .5, 5);
		},
		tick(run, v, dt) {
			const c = run.ctx;
			const s = run.scale;
			const g = run.world(0, run.state.foot / s, 0);
			const r = run.state.r * s;
			const h = run.state.h;
			c.emitShape("spark", poisson(40 * v * dt), {
				type: "body",
				at: g,
				r: r * 1.1,
				h: h * .6
			}, {
				v: () => new THREE.Vector3(0, 2 + Math.random() * 2, 0),
				life: [.4, .8],
				size: [.012 * s, .02 * s],
				stretch: .06,
				drag: .5,
				colors: c.cols("core", "main"),
				bright: 2.4 * c.B,
				fadeIn: 0
			});
			c.emit("mote", poisson(12 * v * dt), {
				p: () => g.clone().add(randomDir().setY(0).normalize().multiplyScalar(r * 1.3)),
				v: () => new THREE.Vector3(0, .8 + Math.random() * .6, 0),
				life: [.6, 1],
				size: [.015 * s, .03 * s],
				colors: c.cols("core", "main"),
				bright: 2 * c.B,
				fadeIn: .1,
				alphaCurve: "bell"
			});
			run.lightAt(g.clone().setY(g.y + h * .5), 4 * v);
		}
	},
	beacon: {
		element: "light",
		build(run) {
			run.column(0, .35, 14, .5);
			run.column(0, .12, 14, 1.1);
			run.circle(.02, .7, {
				spin: .6,
				bright: 1.4
			});
			run.glowDisc(.015, 1.2, .3);
			run.pointLight(.8, 6);
		},
		tick(run, v, dt) {
			const c = run.ctx;
			const s = run.scale;
			const g = run.world(0, .05, 0);
			c.emit("mote", poisson(30 * v * dt), {
				p: () => g.clone().add(randomDir().setY(0).normalize().multiplyScalar(Math.random() * .35 * s)),
				v: () => new THREE.Vector3(0, 1.2 + Math.random() * 1.6, 0),
				life: [1.5, 2.5],
				size: [.015 * s, .03 * s],
				drag: .1,
				colors: c.cols("core", "main"),
				bright: 2.2 * c.B,
				fadeIn: .2,
				alphaCurve: "bell"
			});
			if (Math.random() < dt * .8 * v) c.ring(g, .9 * s, {
				dur: 1.2,
				thick: .04,
				bright: 1.2
			});
			run.shine(3 * v * (.85 + .15 * Math.sin(run.time.value * 2)));
		}
	}
};
//#endregion
//#region src/core/rng/mulberry32.ts
function mulberry32(seed) {
	let a = seed >>> 0;
	return () => {
		a = a + 1831565813 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
//#endregion
//#region src/core/rng/hash.ts
function fnv1a(input) {
	let h = 2166136261;
	for (let i = 0; i < input.length; i++) {
		h ^= input.charCodeAt(i);
		h = Math.imul(h, 16777619);
	}
	return h >>> 0;
}
function hash32(seed, label) {
	return fnv1a(`${seed.toString(36)}:${label}`);
}
var SEED_RE = /^[0-9a-z]{1,7}$/;
function seedFromString(text) {
	const s = text.trim().toLowerCase();
	if (SEED_RE.test(s)) {
		const n = parseInt(s, 36);
		if (n <= 4294967295) return n >>> 0;
	}
	return fnv1a(s);
}
function seedToString(seed) {
	return (seed >>> 0).toString(36);
}
//#endregion
//#region src/core/rng/rng.ts
var Rng = class Rng {
	seed;
	next;
	constructor(seed) {
		this.seed = seed;
		this.next = mulberry32(seed);
	}
	float(min = 0, max = 1) {
		return min + (max - min) * this.next();
	}
	int(min, max) {
		return Math.floor(this.float(min, max + 1));
	}
	bool(probability = .5) {
		return this.next() < probability;
	}
	pick(items) {
		return items[Math.floor(this.next() * items.length)];
	}
	sign() {
		return this.next() < .5 ? -1 : 1;
	}
	fork(label) {
		return new Rng(hash32(this.seed, label));
	}
};
//#endregion
//#region src/core/fx/variation.ts
var RANGES = {
	projectile: {
		circleFeet: [
			-4,
			8,
			"int"
		],
		circleHand: [
			-4,
			8,
			"int"
		],
		circleTarget: [
			-8,
			8,
			"int"
		],
		charge: [.25, .5],
		speed: [9, 16],
		curve: [0, 1.4],
		size: [.8, 1.25],
		after: [
			1,
			5,
			"int"
		],
		power: [.9, 1.3],
		count: [
			1,
			3,
			"int"
		],
		anime: [
			0,
			0,
			"int"
		]
	},
	lance: {
		circleFeet: [
			-4,
			8,
			"int"
		],
		circleHand: [
			-4,
			8,
			"int"
		],
		circleTarget: [
			-8,
			8,
			"int"
		],
		charge: [.18, .35],
		speed: [26, 40],
		size: [.8, 1.2],
		power: [1.1, 1.6],
		anime: [
			0,
			0,
			"int"
		]
	},
	beam: {
		circleFeet: [
			-4,
			8,
			"int"
		],
		circleHand: [
			-4,
			8,
			"int"
		],
		circleTarget: [
			-8,
			8,
			"int"
		],
		charge: [.35, .65],
		dur: [.9, 1.6],
		radius: [.25, .45],
		tick: [.12, .2],
		anime: [
			0,
			0,
			"int"
		]
	},
	explosion: {
		circleFeet: [
			-4,
			8,
			"int"
		],
		circleHand: [
			-4,
			8,
			"int"
		],
		circleTarget: [
			-8,
			8,
			"int"
		],
		gather: [.4, .75],
		size: [1, 1.5],
		power: [1.6, 2],
		secondary: [
			3,
			8,
			"int"
		],
		anime: [
			0,
			0,
			"int"
		]
	},
	pillar: {
		circleFeet: [
			-4,
			8,
			"int"
		],
		circleHand: [
			-4,
			8,
			"int"
		],
		circleTarget: [
			-8,
			8,
			"int"
		],
		delay: [.25, .5],
		dur: [.8, 1.4],
		radius: [.55, .95],
		height: [4, 8],
		power: [1.2, 1.7],
		anime: [
			0,
			0,
			"int"
		]
	},
	meteor: {
		circleFeet: [
			-4,
			8,
			"int"
		],
		circleHand: [
			-4,
			8,
			"int"
		],
		circleTarget: [
			-8,
			8,
			"int"
		],
		count: [
			5,
			12,
			"int"
		],
		dur: [.9, 1.6],
		fall: [.4, .65],
		radius: [1.6, 2.8],
		size: [.85, 1.25],
		anime: [
			0,
			0,
			"int"
		]
	},
	nova: {
		circleFeet: [
			-4,
			8,
			"int"
		],
		circleHand: [
			-4,
			8,
			"int"
		],
		circleTarget: [
			-8,
			8,
			"int"
		],
		charge: [.45, .7],
		size: [.9, 1.25],
		power: [1.5, 1.9],
		anime: [
			0,
			0,
			"int"
		]
	},
	barrier: {
		circleFeet: [
			-4,
			8,
			"int"
		],
		dur: [1.8, 3],
		radius: [1.15, 1.6],
		poke: [.3, .7],
		anime: [
			0,
			0,
			"int"
		]
	},
	summon: {
		circleFeet: [
			-4,
			8,
			"int"
		],
		circleHand: [
			-4,
			8,
			"int"
		],
		gate: [
			0,
			2,
			"int"
		],
		radius: [.75, 1.1],
		charge: [.3, .55],
		speed: [12, 20],
		size: [.85, 1.2],
		power: [1.6, 2],
		anime: [
			0,
			0,
			"int"
		]
	},
	missiles: {
		circleFeet: [
			-4,
			8,
			"int"
		],
		circleHand: [
			-4,
			8,
			"int"
		],
		circleTarget: [
			-8,
			8,
			"int"
		],
		charge: [.25, .45],
		count: [
			8,
			18,
			"int"
		],
		launch: [-55, 10],
		fan: [140, 240],
		smoke: [.6, 1.4],
		stagger: [.03, .06],
		hang: [.1, .25],
		speed: [24, 36],
		size: [.85, 1.15],
		power: [1.2, 1.6],
		anime: [
			0,
			0,
			"int"
		]
	},
	warp: {
		circleFeet: [
			-4,
			8,
			"int"
		],
		charge: [.15, .35],
		offset: [.9, 1.8],
		travel: [.08, .2],
		size: [.9, 1.1]
	},
	tornado: {
		circleFeet: [
			-4,
			8,
			"int"
		],
		circleHand: [
			-4,
			8,
			"int"
		],
		circleTarget: [
			-8,
			8,
			"int"
		],
		charge: [.25, .45],
		dur: [2.2, 3.4],
		radius: [.9, 1.3],
		height: [3, 4.2],
		drift: [0, 1],
		size: [.9, 1.15],
		power: [1.3, 1.8],
		debris: [.7, 1.4],
		anime: [
			0,
			0,
			"int"
		]
	},
	storm: {
		circleFeet: [
			-4,
			8,
			"int"
		],
		circleTarget: [
			-4,
			8,
			"int"
		],
		charge: [.45, .8],
		dur: [2.4, 3.6],
		radius: [2.6, 3.8],
		slant: [.1, .5],
		density: [.8, 1.3],
		power: [1.3, 1.8],
		anime: [
			0,
			0,
			"int"
		]
	},
	drill: {
		circleFeet: [
			-4,
			8,
			"int"
		],
		circleHand: [
			-4,
			8,
			"int"
		],
		form: [.35, .6],
		speed: [11, 17],
		grind: [.4, .9],
		size: [.85, 1.2],
		power: [1.5, 2],
		anime: [
			0,
			0,
			"int"
		]
	},
	finale: {
		crack: [.8, 1.4],
		rays: [
			6,
			12,
			"int"
		],
		pops: [
			4,
			8,
			"int"
		],
		implode: [.25, .45],
		size: [.9, 1.2],
		power: [1.8, 2.2]
	},
	heal: {
		circleHand: [
			-4,
			8,
			"int"
		],
		circleTarget: [
			1,
			8,
			"int"
		],
		charge: [.22, .4],
		dur: [1.3, 1.9],
		radius: [.55, .8],
		turns: [1, 1.7],
		ribbons: [
			2,
			4,
			"int"
		],
		symbols: [.7, 1.4]
	},
	buff: {
		circleFeet: [
			-4,
			8,
			"int"
		],
		charge: [.22, .4],
		hold: [2, 3.5],
		radius: [.48, .65],
		height: [1.8, 2.4],
		rate: [.8, 1.3],
		pulse: [1.4, 2.2]
	},
	strike: {
		windup: [.12, .25],
		hits: [
			1,
			3,
			"int"
		],
		power: [1.2, 1.8],
		size: [.85, 1.2],
		cone: [.6, 1.2],
		anime: [
			0,
			0,
			"int"
		]
	},
	shockwave: {
		circleFeet: [
			-4,
			8,
			"int"
		],
		charge: [.18, .35],
		count: [
			1,
			3,
			"int"
		],
		speed: [10, 16],
		span: [100, 160],
		size: [.85, 1.25],
		power: [1.1, 1.6],
		anime: [
			0,
			0,
			"int"
		]
	},
	slash: {
		windup: [.08, .18],
		dur: [.14, .24],
		sweep: [150, 220],
		roll: [30, 80],
		mirror: [
			0,
			1,
			"int"
		],
		lag: [.45, .8],
		power: [.9, 1.6],
		sparks: [.6, 1.4],
		anime: [
			0,
			0,
			"int"
		]
	},
	swipe: {
		windup: [.07, .14],
		dur: [.12, .2],
		sweep: [150, 220],
		roll: [30, 80],
		mirror: [
			0,
			1,
			"int"
		],
		lag: [.45, .8],
		power: [.8, 1.3],
		sparks: [0, .6]
	},
	rising: {
		windup: [.1, .2],
		dur: [.14, .22],
		sweep: [150, 210],
		roll: [50, 85],
		mirror: [
			0,
			1,
			"int"
		],
		lag: [.45, .8],
		power: [1.1, 1.6],
		sparks: [.6, 1.4],
		anime: [
			0,
			0,
			"int"
		]
	},
	cleave: {
		windup: [.22, .4],
		dur: [.09, .15],
		split: [.12, .28],
		power: [1.6, 2.1],
		anime: [
			0,
			0,
			"int"
		]
	},
	combo: {
		windup: [.08, .14],
		dur: [.1, .16],
		gap: [.03, .1],
		power: [1.4, 1.9],
		anime: [
			0,
			0,
			"int"
		]
	},
	wave: {
		windup: [.08, .16],
		dur: [.1, .15],
		roll: [-30, 60],
		speed: [10, 18],
		size: [.8, 1.3],
		power: [1.1, 1.6],
		anime: [
			0,
			0,
			"int"
		]
	},
	dash: {
		charge: [.12, .28],
		dash: [.1, .18],
		over: [.8, 2],
		delay: [.18, .35],
		power: [1.5, 2],
		anime: [
			0,
			0,
			"int"
		]
	},
	flurry: {
		windup: [.08, .16],
		count: [
			6,
			12,
			"int"
		],
		dur: [.045, .075],
		gap: [.005, .03],
		power: [1.4, 1.9],
		anime: [
			0,
			0,
			"int"
		]
	},
	rush: {
		windup: [.1, .2],
		count: [
			6,
			14,
			"int"
		],
		gap: [.05, .08],
		size: [.85, 1.2],
		power: [1.5, 2],
		anime: [
			0,
			0,
			"int"
		]
	},
	uppercut: {
		windup: [.15, .28],
		rise: [.1, .18],
		size: [.85, 1.2],
		power: [1.5, 2],
		anime: [
			0,
			0,
			"int"
		]
	},
	kick: {
		windup: [.12, .22],
		dur: [.13, .2],
		height: [.8, 1.5],
		size: [.85, 1.2],
		power: [1.4, 1.9],
		anime: [
			0,
			0,
			"int"
		]
	},
	heel: {
		windup: [.25, .4],
		dur: [.09, .15],
		size: [.85, 1.2],
		power: [1.7, 2.1],
		anime: [
			0,
			0,
			"int"
		]
	},
	palm: {
		windup: [.14, .24],
		delay: [.06, .16],
		size: [.85, 1.2],
		power: [1.6, 2],
		anime: [
			0,
			0,
			"int"
		]
	},
	tackle: {
		charge: [.16, .3],
		dash: [.15, .26],
		size: [.85, 1.2],
		power: [1.6, 2],
		anime: [
			0,
			0,
			"int"
		]
	},
	pound: {
		windup: [.3, .46],
		speed: [7, 12],
		size: [.85, 1.25],
		power: [1.6, 2],
		anime: [
			0,
			0,
			"int"
		]
	},
	thrust: {
		windup: [.12, .22],
		dur: [.09, .15],
		power: [1.1, 1.6],
		anime: [
			0,
			0,
			"int"
		]
	},
	spin: {
		windup: [.06, .14],
		dur: [.3, .45],
		sweep: [380, 460],
		roll: [-10, 15],
		power: [.9, 1.3],
		anime: [
			0,
			0,
			"int"
		]
	},
	cross: {
		windup: [.1, .16],
		dur: [.12, .18],
		gap: [.15, .3],
		power: [1.4, 1.9],
		anime: [
			0,
			0,
			"int"
		]
	},
	smash: {
		windup: [.22, .34],
		dur: [.11, .17],
		power: [1.5, 2],
		fissure: [
			3,
			7,
			"int"
		],
		anime: [
			0,
			0,
			"int"
		]
	},
	iaido: {
		charge: [.45, .8],
		dur: [.05, .09],
		delay: [.3, .55],
		power: [1.7, 2.1],
		anime: [
			0,
			0,
			"int"
		]
	}
};
function variant(recipe, element, seed) {
	const rng = new Rng(seed).fork(`${recipe}:${element}`);
	const params = { ...RECIPES[recipe]?.defaults ?? {} };
	const side = new Rng(seed).fork(`${recipe}:${element}:extra`);
	for (const [key, [min, max, kind]] of Object.entries(RANGES[recipe] ?? {})) {
		const r = key === "anime" ? side : rng;
		let v = kind === "int" ? r.int(min, max) : r.float(min, max);
		if (key.startsWith("circle") || key === "anime") v = Math.max(v, 0);
		params[key] = kind === "int" ? v : Math.round(v * 1e3) / 1e3;
	}
	return {
		id: `${element}-${recipe}-${seedToString(seed)}`,
		recipe,
		element,
		hue: Math.round(rng.float(-.018, .018) * 1e3) / 1e3,
		params
	};
}
function clampParams(recipe, params) {
	const ranges = Object.hasOwn(RANGES, recipe) ? RANGES[recipe] : {};
	const out = {};
	for (const [key, value] of Object.entries(params)) {
		if (typeof value !== "number" || !Number.isFinite(value)) continue;
		const span = Object.hasOwn(ranges, key) ? ranges[key] : void 0;
		if (!span) {
			out[key] = value;
			continue;
		}
		const [min, max] = span;
		out[key] = Math.min(Math.max(value, min > 0 ? min / 4 : min), max > 0 ? max * 4 : max);
	}
	return out;
}
//#endregion
//#region src/runtime/scheduler.ts
var Scheduler = class {
	time = 0;
	part = "main";
	tasks = [];
	due = [];
	lives = [];
	stepping = false;
	after(delay, fn, owner = null) {
		this.tasks.push({
			at: this.time + Math.max(delay, 0),
			fn,
			owner,
			part: this.part
		});
	}
	add(live, owner = null) {
		this.lives.push({
			live,
			owner,
			part: this.part,
			dead: false
		});
		return live;
	}
	during(delay, dur, fn, end, owner = null) {
		this.after(delay, () => {
			let age = 0;
			fn(0, 0, 0);
			this.add({ update: (dt) => {
				age += dt;
				const k = Math.min(age / dur, 1);
				fn(k, dt, age);
				if (k >= 1) {
					end?.();
					return false;
				}
				return true;
			} }, owner);
		}, owner);
	}
	step(dt) {
		if (this.stepping) return;
		this.time += dt;
		this.stepping = true;
		let next = 0;
		try {
			for (let guard = 0; guard < 8; guard++) {
				const due = this.tasks.filter((t) => t.at <= this.time);
				if (due.length === 0) break;
				this.tasks = this.tasks.filter((t) => t.at > this.time);
				due.sort((a, b) => a.at - b.at);
				this.due = due;
				for (next = 0; next < due.length;) {
					const t = due[next++];
					if (t.dead) continue;
					this.part = t.part;
					t.fn();
				}
				this.due = [];
			}
			const lives = this.lives;
			for (let i = lives.length - 1; i >= 0; i--) {
				const entry = lives[i];
				if (entry.dead) continue;
				this.part = entry.part;
				let keep = false;
				try {
					keep = entry.live.update(dt);
				} finally {
					if (!keep && !entry.dead) {
						entry.dead = true;
						entry.live.dispose?.();
					}
				}
			}
		} finally {
			for (let i = next; i < this.due.length; i++) if (!this.due[i].dead) this.tasks.push(this.due[i]);
			this.due = [];
			this.stepping = false;
			this.part = "main";
			this.sweep();
		}
	}
	sweep() {
		const lives = this.lives;
		let n = 0;
		for (let i = 0; i < lives.length; i++) if (!lives[i].dead) lives[n++] = lives[i];
		lives.length = n;
	}
	busy(owner) {
		return this.tasks.some((t) => t.owner === owner) || this.lives.some((l) => !l.dead && l.owner === owner);
	}
	cancel(owner = null) {
		this.tasks = owner ? this.tasks.filter((t) => t.owner !== owner) : [];
		for (const t of this.due) if (!owner || t.owner === owner) t.dead = true;
		const lives = this.lives;
		for (let i = lives.length - 1; i >= 0; i--) {
			const entry = lives[i];
			if (entry.dead || owner && entry.owner !== owner) continue;
			entry.dead = true;
			entry.live.dispose?.();
		}
		if (!this.stepping) this.sweep();
	}
};
//#endregion
//#region src/runtime/solids.ts
var m4 = new THREE.Matrix4();
var s3 = new THREE.Vector3();
var dq = new THREE.Quaternion();
var outBack = (t) => 1 + 2.2 * Math.pow(t - 1, 3) + 1.2 * Math.pow(t - 1, 2);
var Solids = class {
	max;
	mesh;
	list = [];
	floorY = 0;
	constructor(geometry, material, max) {
		this.max = max;
		this.mesh = new THREE.InstancedMesh(geometry, material, max);
		this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
		this.mesh.setColorAt(0, new THREE.Color(1, 1, 1));
		this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
		this.mesh.count = 0;
		this.mesh.frustumCulled = false;
	}
	spawn(o) {
		if (this.list.length >= this.max) this.list.shift();
		const size = typeof o.size === "number" ? new THREE.Vector3(o.size, o.size, o.size) : o.size.clone();
		const solid = {
			p: o.p.clone(),
			v: o.v?.clone() ?? new THREE.Vector3(),
			size,
			q: o.quat?.clone() ?? new THREE.Quaternion().setFromEuler(new THREE.Euler(Math.random() * 6, Math.random() * 6, Math.random() * 6)),
			axis: new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).normalize(),
			spin: o.spin ?? 0,
			age: 0,
			life: o.life,
			grow: o.grow ?? 0,
			shrink: o.shrink ?? .25,
			gravity: o.gravity ?? 0,
			bounce: o.bounce ?? .3,
			onLand: o.onLand,
			drive: o.drive
		};
		this.list.push(solid);
		solid.color = o.color?.clone() ?? new THREE.Color(1, 1, 1);
	}
	update(dt) {
		let n = 0;
		this.list = this.list.filter((s) => (s.age += dt) < s.life);
		for (const s of this.list) {
			if (s.drive && !s.drive(s.p, s.v, s.age, dt)) s.drive = void 0;
			if (!s.drive && (s.gravity || s.v.lengthSq() > 0)) {
				s.v.y -= s.gravity * dt;
				s.p.addScaledVector(s.v, dt);
				const bottom = this.floorY + s.size.y * .3;
				if (s.gravity && s.p.y < bottom && s.v.y < 0) {
					const speed = -s.v.y;
					s.p.y = bottom;
					s.v.y = speed * s.bounce;
					s.v.x *= .6;
					s.v.z *= .6;
					s.spin *= .6;
					if (speed > 2.5) s.onLand?.(s.p, speed);
					if (speed < .8) s.v.set(0, 0, 0);
				}
			}
			if (s.spin) s.q.multiply(dq.setFromAxisAngle(s.axis, s.spin * dt));
			const k = s.age / s.life;
			let scale = 1;
			if (s.grow > 0 && s.age < s.grow) scale = Math.max(outBack(s.age / s.grow), .001);
			if (k > 1 - s.shrink) scale *= Math.max((1 - k) / s.shrink, .001);
			m4.compose(s.p, s.q, s3.copy(s.size).multiplyScalar(scale));
			this.mesh.setMatrixAt(n, m4);
			this.mesh.setColorAt(n, s.color);
			n++;
		}
		this.mesh.count = n;
		this.mesh.instanceMatrix.needsUpdate = true;
		this.mesh.instanceColor.needsUpdate = true;
	}
	primeForCompile(on) {
		this.mesh.count = on ? 1 : 0;
		if (on) {
			this.mesh.setMatrixAt(0, m4.makeTranslation(0, -1e3, 0));
			this.mesh.instanceMatrix.needsUpdate = true;
		}
	}
	clear() {
		this.list = [];
		this.mesh.count = 0;
	}
	get size() {
		return this.list.length;
	}
	dispose() {
		this.mesh.geometry.dispose();
		this.mesh.material.dispose();
	}
};
function rand(seed) {
	let a = seed >>> 0;
	return () => {
		a = a + 1831565813 | 0;
		let t = Math.imul(a ^ a >>> 15, 1 | a);
		t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
		return ((t ^ t >>> 14) >>> 0) / 4294967296;
	};
}
function finish(g) {
	const flat = g.index ? g.toNonIndexed() : g;
	flat.computeVertexNormals();
	return flat;
}
function column(rings, sides, tip, r, jag) {
	const pos = [];
	const ringPts = rings.map(({ y, r: rad }, j) => {
		const twist = r() * Math.PI * 2;
		return Array.from({ length: sides }, (_, i) => {
			const a = twist * (j ? .15 : 0) + i / sides * Math.PI * 2 + (r() - .5) * .5;
			const rr = rad * (1 - jag * .5 + r() * jag);
			return new THREE.Vector3(Math.cos(a) * rr, y + (r() - .5) * jag * .15, Math.sin(a) * rr);
		});
	});
	const tri = (a, b, c) => pos.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
	for (let j = 0; j < ringPts.length - 1; j++) {
		const lo = ringPts[j];
		const hi = ringPts[j + 1];
		for (let i = 0; i < sides; i++) {
			const i2 = (i + 1) % sides;
			tri(lo[i], hi[i], lo[i2]);
			tri(lo[i2], hi[i], hi[i2]);
		}
	}
	const top = ringPts[ringPts.length - 1];
	for (let i = 0; i < sides; i++) tri(top[i], tip, top[(i + 1) % sides]);
	const bottom = ringPts[0];
	const c = new THREE.Vector3(0, rings[0].y, 0);
	for (let i = 0; i < sides; i++) tri(bottom[(i + 1) % sides], c, bottom[i]);
	const g = new THREE.BufferGeometry();
	g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
	return finish(g);
}
function crystalGeometries(count = 6) {
	return Array.from({ length: count }, (_, k) => {
		const r = rand(1e3 + k * 77);
		const sides = 4 + Math.floor(r() * 4);
		const body = .45 + r() * .35;
		const w = .42 + r() * .16;
		return column([
			{
				y: 0,
				r: w * (.85 + r() * .2)
			},
			{
				y: body * (.5 + r() * .2),
				r: w * (.95 + r() * .15)
			},
			{
				y: body,
				r: w * (.8 + r() * .15)
			}
		], sides, new THREE.Vector3((r() - .5) * .25, 1, (r() - .5) * .25), r, .25);
	});
}
function rockSpikeGeometries(count = 6) {
	return Array.from({ length: count }, (_, k) => {
		const r = rand(2e3 + k * 131);
		const sides = 5 + Math.floor(r() * 3);
		return column([
			{
				y: -.1,
				r: .62 + r() * .1
			},
			{
				y: .25 + r() * .1,
				r: .46 + r() * .1
			},
			{
				y: .55 + r() * .1,
				r: .3 + r() * .08
			},
			{
				y: .8 + r() * .05,
				r: .14 + r() * .06
			}
		], sides, new THREE.Vector3((r() - .5) * .3, 1, (r() - .5) * .3), r, .4);
	});
}
function rockGeometries(count = 6) {
	return Array.from({ length: count }, (_, k) => {
		const r = rand(3e3 + k * 53);
		const g = k % 2 ? new THREE.IcosahedronGeometry(1, 0) : new THREE.DodecahedronGeometry(1, 0);
		const pos = g.getAttribute("position");
		const sx = .75 + r() * .5;
		const sy = .5 + r() * .45;
		const sz = .75 + r() * .5;
		const seen = /* @__PURE__ */ new Map();
		for (let i = 0; i < pos.count; i++) {
			const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
			if (!seen.has(key)) seen.set(key, .7 + r() * .55);
			const f = seen.get(key);
			pos.setXYZ(i, pos.getX(i) * f * sx, pos.getY(i) * f * sy, pos.getZ(i) * f * sz);
		}
		return finish(g);
	});
}
var SolidSet = class {
	sets;
	mask = () => false;
	constructor(geometries, material, max) {
		const per = Math.ceil(max / geometries.length);
		this.sets = geometries.map((g) => new Solids(g, material(), per));
	}
	set floorY(y) {
		for (const s of this.sets) s.floorY = y;
	}
	spawn(o, variant) {
		if (this.mask()) return;
		const i = variant ?? Math.floor(Math.random() * this.sets.length);
		this.sets[i % this.sets.length].spawn(o);
	}
	update(dt) {
		for (const s of this.sets) s.update(dt);
	}
	clear() {
		for (const s of this.sets) s.clear();
	}
	primeForCompile(on) {
		for (const s of this.sets) s.primeForCompile(on);
	}
	get size() {
		return this.sets.reduce((n, s) => n + s.size, 0);
	}
	get meshes() {
		return this.sets.map((s) => s.mesh);
	}
	dispose() {
		for (const s of this.sets) s.dispose();
	}
};
function rockMaterial() {
	const m = new THREE.MeshStandardNodeMaterial({
		roughness: .9,
		metalness: 0,
		flatShading: true
	});
	const shade = float(instanceIndex).mul(.137).fract().mul(.3).add(.85);
	m.colorNode = mix(float(.7), float(1), positionLocal.y.mul(.5).add(.5)).mul(shade);
	return m;
}
function crystalMaterial() {
	const m = new THREE.MeshStandardNodeMaterial({
		roughness: .15,
		metalness: .1,
		flatShading: true,
		transparent: true,
		opacity: .92
	});
	m.colorNode = float(.55);
	m.emissiveNode = positionLocal.y.mul(.9).add(.15).mul(.9).mul(instanceColor);
	return m;
}
//#endregion
//#region src/runtime/loops.ts
function defineLoop(def) {
	return {
		kind: "loop",
		...def
	};
}
var LoopHandle = class {
	id;
	def;
	instance;
	at;
	onStop;
	time = 0;
	playing = true;
	alive = true;
	constructor(id, def, instance, at, onStop) {
		this.id = id;
		this.def = def;
		this.instance = instance;
		this.at = at;
		this.onStop = onStop;
		this.follow();
	}
	get uniforms() {
		return this.instance.uniforms;
	}
	get object() {
		return this.instance.object;
	}
	pause() {
		this.playing = false;
	}
	resume() {
		this.playing = true;
	}
	moveTo(at) {
		this.at = at;
		this.follow();
	}
	follow() {
		const o = this.instance.object;
		if (!o || !this.at) return;
		if (this.at instanceof THREE.Object3D) this.at.getWorldPosition(o.position);
		else o.position.copy(this.at);
	}
	step(dt) {
		if (!this.alive) return;
		if (this.playing) this.time += dt;
		if (this.at instanceof THREE.Object3D) this.follow();
		this.instance.update(this.time);
	}
	stop() {
		if (!this.alive) return;
		this.alive = false;
		this.instance.dispose();
		this.onStop(this);
	}
};
//#endregion
//#region src/runtime/system.ts
var BUDGET = {
	glow: 3e3,
	mote: 3e3,
	spark: 6e3,
	star: 400,
	flare: 200,
	flame: 3e3,
	smoke: 2600,
	shard: 2e3,
	bubble: 1e3,
	glyph: 600,
	mist: 1500,
	haze: 700
};
var NEAR = nearFade.value.clone();
var FLOOR = sizeFloor.value;
var WARM_STEPS = 8;
var SETTLE = 2;
var RAISE_WAIT = 3;
var PRESETS = {
	high: [1, 1],
	medium: [.7, .75],
	low: [.45, .55]
};
var FXHandle = class {
	id;
	system;
	playing = true;
	blade = {
		base: new THREE.Vector3(),
		tip: new THREE.Vector3(),
		active: false
	};
	head = new THREE.Vector3();
	body = {
		offset: new THREE.Vector3(),
		lean: 0,
		turn: 0,
		limb: null
	};
	listeners = /* @__PURE__ */ new Map();
	done;
	resolve;
	constructor(id, system) {
		this.id = id;
		this.system = system;
		this.done = new Promise((r) => this.resolve = r);
	}
	on(event, fn) {
		if (!this.listeners.has(event)) this.listeners.set(event, /* @__PURE__ */ new Set());
		this.listeners.get(event).add(fn);
		return () => this.listeners.get(event)?.delete(fn);
	}
	emit(event, data) {
		if (event === "cast") {
			this.system.scheduler.after(0, () => this.send("cast"), this);
			return;
		}
		if (event !== "end") {
			this.send(event, data);
			return;
		}
		this.playing = false;
		this.blade.active = false;
		this.body.offset.set(0, 0, 0);
		this.body.lean = this.body.turn = 0;
		this.body.limb = null;
		try {
			this.send("end");
		} finally {
			this.resolve();
		}
	}
	send(event, data) {
		for (const fn of [...this.listeners.get(event) ?? []]) try {
			fn(data);
		} catch (error) {
			queueMicrotask(() => {
				throw error;
			});
		}
	}
	stop() {
		this.system.scheduler.cancel(this);
		if (this.playing) this.emit("end");
	}
};
var FXSystem = class {
	root = new THREE.Group();
	scheduler = new Scheduler();
	particles;
	prims;
	lights;
	loopLights;
	rocks;
	crystals;
	spikes;
	post;
	view;
	scene;
	renderer;
	timeScale = 1;
	floorY;
	feel;
	hitStopScale;
	photosensitive;
	impactFrames;
	only = null;
	defs = /* @__PURE__ */ new Map();
	loopDefs = /* @__PURE__ */ new Map();
	loops = /* @__PURE__ */ new Set();
	statuses = new StatusManager(this);
	fixtures = /* @__PURE__ */ new Set();
	handles = /* @__PURE__ */ new Set();
	stopT = 0;
	trauma = 0;
	shakeTime = 0;
	shakeSaved = null;
	autoQuality = false;
	level = 1;
	scale = 1;
	preset = "high";
	frameEma = 1 / 60;
	over = 0;
	under = 0;
	raiseWait = RAISE_WAIT;
	sinceRaise = 99;
	sinceDrop = 99;
	settle = SETTLE;
	resolution = null;
	frameBudget;
	disposed = false;
	screenSize;
	near;
	sizeMin = FLOOR;
	emissionScale = 1;
	constructor(opts) {
		this.scene = opts.scene;
		this.view = opts.camera;
		this.renderer = opts.renderer;
		this.floorY = opts.floorY ?? 0;
		this.feel = opts.feel ?? false;
		this.hitStopScale = opts.hitStopScale ?? 1;
		this.photosensitive = opts.photosensitive ?? false;
		this.impactFrames = opts.impactFrames ?? false;
		this.root.name = "rollshade-fx";
		glowing.add(this.root);
		this.scene.add(this.root);
		const budget = {
			...BUDGET,
			...opts.budget
		};
		this.particles = Object.fromEntries(Object.keys(BUDGET).map((k) => {
			const sys = new ParticleSystem(k, budget[k]);
			this.root.add(sys.mesh);
			return [k, sys];
		}));
		this.prims = new PrimPool(this.root, PRIM_FACTORIES);
		this.rocks = new SolidSet(rockGeometries(), rockMaterial, 900);
		this.crystals = new SolidSet(crystalGeometries(), crystalMaterial, 900);
		this.spikes = new SolidSet(rockSpikeGeometries(), rockMaterial, 360);
		this.root.add(...this.rocks.meshes, ...this.crystals.meshes, ...this.spikes.meshes);
		this.lights = new LightPool(this.root, opts.lights ?? 6, opts.lightScale ?? 1);
		this.loopLights = new LightPool(this.root, opts.loopLights ?? 4, opts.lightScale ?? 1);
		const hidden = () => this.only !== null && this.scheduler.part !== this.only;
		this.prims.mask = hidden;
		this.rocks.mask = this.crystals.mask = this.spikes.mask = hidden;
		this.lights.mute = hidden;
		this.post = opts.post ? new FXPost(opts.renderer, opts.scene, opts.camera, opts.post === true ? {} : opts.post) : null;
		this.screenSize = opts.maxScreenSize ?? .5;
		this.near = opts.nearFade ? new THREE.Vector2(opts.nearFade[0], opts.nearFade[1]) : NEAR.clone();
		this.frameBudget = opts.frameBudget ?? 1 / 58;
		if (typeof opts.quality === "number") {
			this.autoQuality = false;
			this.quality = opts.quality;
		} else this.setQuality(opts.quality ?? "high");
		if (opts.renderScale !== void 0) this.renderScale = opts.renderScale;
		if (opts.autoResolution) {
			const max = typeof opts.autoResolution === "object" && opts.autoResolution.max || opts.renderer.getPixelRatio();
			const min = typeof opts.autoResolution === "object" && opts.autoResolution.min || Math.min(1, max);
			this.resolution = {
				min,
				max
			};
		}
	}
	get camera() {
		return this.view;
	}
	set camera(camera) {
		this.restoreShake();
		this.view = camera;
		this.post?.setCamera(camera);
	}
	get quality() {
		return this.level;
	}
	get qualityPreset() {
		return this.preset;
	}
	get renderScale() {
		return this.scale;
	}
	set renderScale(v) {
		this.scale = Math.min(Math.max(v, .25), 1);
		this.post?.setScale(this.scale);
	}
	setQuality(preset) {
		this.preset = preset;
		if (preset === "auto") {
			this.autoQuality = true;
			this.calm();
			return;
		}
		this.autoQuality = false;
		const [particles, scale] = PRESETS[preset];
		this.quality = particles;
		this.renderScale = scale;
	}
	set quality(v) {
		this.level = Math.min(Math.max(v, .3), 1);
		this.emissionScale = emission.scale = .35 + .65 * this.level;
		if (this.autoQuality && this.post) this.renderScale = .5 + .5 * Math.min(Math.max((this.level - .3) / .5, 0), 1);
		if (this.resolution) {
			const { min, max } = this.resolution;
			const ratio = Math.round((min + (max - min) * Math.min(Math.max((this.level - .3) / .7, 0), 1)) * 8) / 8;
			if (Math.abs(this.renderer.getPixelRatio() - ratio) > .001) this.renderer.setPixelRatio(ratio);
		}
	}
	calm() {
		this.settle = SETTLE;
		this.frameEma = this.frameBudget;
		this.over = this.under = 0;
	}
	get maxScreenSize() {
		return this.screenSize;
	}
	set maxScreenSize(v) {
		this.screenSize = v;
	}
	get minParticleSize() {
		return this.sizeMin;
	}
	set minParticleSize(v) {
		this.sizeMin = v;
	}
	activate() {
		screenCap.value = this.screenSize;
		nearFade.value.copy(this.near);
		sizeFloor.value = this.sizeMin;
		emission.scale = this.emissionScale;
		const cam = this.view;
		if (cam.isPerspectiveCamera) {
			tanHalfFov.value = Math.tan(cam.fov * Math.PI / 360);
			orthoHalf.value = 0;
		} else if (cam.isOrthographicCamera) orthoHalf.value = (cam.top - cam.bottom) / (2 * cam.zoom);
	}
	adapt(frame) {
		if (this.settle > 0) {
			this.settle -= frame;
			return;
		}
		frame = Math.min(frame, this.frameBudget * 2);
		this.frameEma += (frame - this.frameEma) * .12;
		this.sinceRaise += frame;
		this.sinceDrop += frame;
		if (this.frameEma > this.frameBudget * 1.2) {
			this.over += frame;
			this.under = 0;
			if (this.over > 1 && this.level > .3) {
				if (this.sinceRaise < 5) this.raiseWait = Math.min(this.raiseWait * 2, 12);
				this.quality = this.level - .175;
				this.over = 0;
				this.sinceDrop = 0;
			}
		} else if (this.frameEma < this.frameBudget * 1.05) {
			this.under += frame;
			this.over = 0;
			if (this.sinceDrop > 15) this.raiseWait = RAISE_WAIT;
			if (this.under > this.raiseWait && this.level < 1) {
				this.quality = this.level + .175;
				this.under = 0;
				this.sinceRaise = 0;
			}
		}
	}
	add(...defs) {
		for (const d of defs) if (d.kind === "loop") {
			this.loopDefs.set(d.id, d);
			if (d.bloom && this.post) this.post.loopBloomUsed = true;
		} else this.defs.set(d.id, d);
		return this;
	}
	spawn(effect, opts = {}) {
		const def = typeof effect === "string" ? this.loopDefs.get(effect) : effect;
		if (!def) throw new Error(`rollshade: unknown loop "${effect}"`);
		if (def.bloom && this.post) this.post.loopBloomUsed = true;
		if (def.object && !opts.object) throw new Error(`rollshade: "${def.id}" needs { object }`);
		const instance = def.create({
			scene: this.scene,
			camera: this.camera,
			renderer: this.renderer,
			object: opts.object,
			period: opts.period ?? def.period
		});
		if (instance.object && opts.scale) instance.object.scale.multiplyScalar(opts.scale);
		if (instance.object && !def.object) glowing.add(instance.object);
		const handle = new LoopHandle(def.id, def, instance, def.object ? void 0 : opts.at, (h) => {
			this.loops.delete(h);
			this.syncLoopBloom();
		});
		this.loops.add(handle);
		this.syncLoopBloom();
		return handle;
	}
	syncLoopBloom() {
		let best = null;
		for (const h of this.loops) if (h.def.bloom && (!best || h.def.bloom.strength > best.strength)) best = h.def.bloom;
		this.post?.setLoopBloom(best);
	}
	play(effect, opts) {
		if (this.disposed) throw new Error("rollshade: this FXSystem was disposed. Create a new one");
		const def = typeof effect === "string" ? this.defs.get(effect) : effect;
		if (!def) throw new Error(`rollshade: unknown effect "${effect}". Added: ${[...this.defs.keys()].join(", ") || "none"}. Call fx.add(effect('meteor', 'fire')) first, or pass the definition itself to fx.play()`);
		const recipe = Object.hasOwn(RECIPES, def.recipe) ? RECIPES[def.recipe] : void 0;
		if (!recipe) throw new Error(`rollshade: unknown recipe "${def.recipe}". Use one of: ${Object.keys(RECIPES).join(", ")}`);
		if (!opts?.from) throw new Error(`rollshade: fx.play('${def.id}', { from, to }) needs from (a THREE.Vector3 or an Object3D)`);
		if (!opts.to) opts = {
			...opts,
			to: opts.from
		};
		this.activate();
		const handle = new FXHandle(def.id, this);
		this.handles.add(handle);
		handle.done.then(() => this.handles.delete(handle));
		const pal = palette(def.element, def.hue ?? 0, def.color);
		const ctx = new Ctx(this, handle, def, pal, opts);
		ctx.params = clampParams(def.recipe, {
			...recipeDefaults(def.recipe),
			...def.params
		});
		const outer = this.scheduler.part;
		this.scheduler.part = "main";
		recipe(ctx, ctx.params);
		ctx.finish();
		this.scheduler.part = outer;
		return handle;
	}
	status(target, name, options = {}) {
		const recipe = Object.hasOwn(STATUSES, name) ? STATUSES[name] : void 0;
		if (!recipe && Object.hasOwn(FIXTURES, name)) throw new Error(`rollshade: "${name}" is a placed loop, not a status. Use fx.loop('${name}', position)`);
		if (!recipe && Object.hasOwn(RECIPES, name)) throw new Error(`rollshade: "${name}" is a move, not a status. Use fx.play(effect('${name}', element), { from, to })`);
		if (!recipe) throw new Error(`rollshade: unknown status "${name}". Use one of: ${Object.keys(STATUSES).join(", ")}`);
		if (!target?.isObject3D) throw new Error("rollshade: fx.status() needs a THREE.Object3D (a character or its mesh)");
		let meshed = false;
		target.traverse((o) => {
			if (o.isMesh && o.geometry?.getAttribute("position")) meshed = true;
		});
		if (!meshed) throw new Error(`rollshade: fx.status(target, '${name}') needs a target that contains a mesh. Pass the character model, not an empty Object3D`);
		this.activate();
		return this.statuses.start(target, name, recipe, new FXHandle(`status-${name}`, this), options);
	}
	renderAll(roots, warm = false) {
		const culled = [];
		for (const root of roots) root.traverse((o) => {
			if (o.frustumCulled) {
				o.frustumCulled = false;
				culled.push(o);
			}
		});
		if (warm && this.post) this.post.warm();
		else if (this.post) this.post.render();
		else this.renderer.render(this.scene, this.camera);
		for (const o of culled) o.frustumCulled = true;
	}
	async compile(roots, onProgress) {
		if (!this.post) {
			await this.renderer.compileAsync(this.scene, this.camera, null, onProgress && ((e) => onProgress(.9 * e.loaded / Math.max(e.total, 1))));
			if (this.disposed) return;
			this.renderAll(roots);
			this.calm();
			onProgress?.(1);
			return;
		}
		const meshes = [];
		const leaf = (o) => {
			let inner = false;
			o.traverse((c) => inner ||= c !== o && c.isMesh);
			return !inner;
		};
		for (const root of roots) root.traverse((o) => o.isMesh && o.visible && leaf(o) && meshes.push(o));
		const steps = Math.max(Math.min(WARM_STEPS, meshes.length), 1);
		for (let step = 0; step < steps && !this.disposed; step++) {
			meshes.forEach((m, i) => m.visible = i % steps === step);
			this.renderAll(roots, true);
			onProgress?.((step + 1) / steps);
			if (step < steps - 1) await new Promise((r) => setTimeout(r, 0));
		}
		for (const m of meshes) m.visible = true;
		if (!this.disposed) this.post.render();
		this.calm();
	}
	async prewarmStatus(target, names = Object.keys(STATUSES), onProgress) {
		const parent = target.parent;
		const index = parent ? parent.children.indexOf(target) : -1;
		const visible = target.visible;
		let borrow = true;
		for (let o = parent; o; o = o.parent) {
			if (!o.visible) break;
			if (o === this.scene) borrow = false;
		}
		if (borrow) {
			this.scene.add(target);
			target.updateWorldMatrix(false, true);
		}
		target.visible = true;
		const runs = [];
		try {
			for (const name of names) runs.push(this.status(target, name, {
				progress: 0,
				duration: 0
			}));
			await this.compile([target], onProgress);
		} catch (error) {
			for (const run of runs) run.finish();
			throw error;
		} finally {
			target.visible = visible;
			if (borrow) {
				if (parent) {
					parent.add(target);
					parent.children.splice(parent.children.indexOf(target), 1);
					parent.children.splice(index, 0, target);
				} else target.removeFromParent();
				target.updateWorldMatrix(true, true);
			}
		}
		if (this.disposed) return;
		for (const run of runs) run.finish();
		this.statuses.update(0, this.scheduler.time);
	}
	loop(name, at, options = {}) {
		const recipe = Object.hasOwn(FIXTURES, name) ? FIXTURES[name] : void 0;
		if (!recipe && Object.hasOwn(STATUSES, name)) throw new Error(`rollshade: "${name}" is a status effect, not a loop. Use fx.status(target, '${name}')`);
		if (!recipe && Object.hasOwn(RECIPES, name)) throw new Error(`rollshade: "${name}" is a move, not a loop. Use fx.play(effect('${name}', element), { from, to })`);
		if (!recipe) throw new Error(`rollshade: unknown loop "${name}". Use one of: ${Object.keys(FIXTURES).join(", ")}`);
		if (!at) throw new Error("rollshade: fx.loop() needs a position (THREE.Vector3) or an Object3D to follow");
		this.activate();
		const run = new FixtureRun(this, name, recipe, new FXHandle(`loop-${name}`, this), at, options);
		this.fixtures.add(run);
		run.done.then(() => this.fixtures.delete(run));
		return run;
	}
	statusesOf(target) {
		return this.statuses.of(target);
	}
	stats() {
		let particles = 0;
		for (const sys of Object.values(this.particles)) particles += sys.alive;
		return {
			effects: this.handles.size,
			loops: this.loops.size + this.fixtures.size,
			statuses: this.statuses.count,
			particles,
			solids: this.rocks.size + this.crystals.size + this.spikes.size,
			created: this.prims.created,
			quality: this.level
		};
	}
	async prewarm(counts = {}, onProgress) {
		const want = {
			arc: 8,
			ribbon: 20,
			bolt: 48,
			beam: 12,
			shield: 3,
			void: 4,
			lathe: 8,
			latheSmoke: 3,
			helix: 8,
			...counts
		};
		const made = [];
		for (const [type, n] of Object.entries(want)) for (const prim of this.prims.fill(type, n ?? 0)) made.push({
			type,
			prim
		});
		const o = new THREE.Vector3();
		const x = new THREE.Vector3(1, 0, 0);
		const z = new THREE.Vector3(0, 0, 1);
		for (const { type, prim } of made) {
			if (type === "arc") arcGeometry(prim.mesh.geometry, o, x, z, 0, 1, .5, 1);
			else if (type === "ribbon") new RibbonTrail(prim, 20, .1);
			else if (type === "helix") helixGeometry(prim.mesh.geometry, {
				center: o,
				r0: 1,
				r1: 1,
				height: 1,
				turns: 1,
				width: .1
			});
			else if (type === "bolt") stripGeometry(prim.mesh.geometry, Array.from({ length: 33 }, (_, i) => new THREE.Vector3(i, 0, 0)), () => .1, this.camera);
			prim.mesh.position.set(0, -1e3, 0);
			prim.mesh.scale.setScalar(.001);
			this.root.add(prim.mesh);
		}
		this.activate();
		for (const sys of Object.values(this.particles)) sys.primeForCompile(true);
		this.rocks.primeForCompile(true);
		this.crystals.primeForCompile(true);
		this.spikes.primeForCompile(true);
		this.prims.prime(true);
		const hidden = new THREE.Vector3(0, -1e3, 0);
		const fixtures = Object.keys(FIXTURES).map((name) => this.loop(name, hidden));
		await this.compile([this.root, ...fixtures.map((f) => f.group)], onProgress);
		if (this.disposed) {
			for (const { prim } of made) {
				prim.mesh.removeFromParent();
				disposePrim(prim);
			}
			this.release();
			return;
		}
		for (const f of fixtures) f.finish();
		for (const sys of Object.values(this.particles)) sys.primeForCompile(false);
		this.rocks.primeForCompile(false);
		this.crystals.primeForCompile(false);
		this.spikes.primeForCompile(false);
		this.prims.prime(false);
		for (const { prim } of made) {
			prim.mesh.position.set(0, 0, 0);
			prim.mesh.scale.setScalar(1);
			this.prims.release(prim);
		}
	}
	get hitStopping() {
		return this.stopT > 0;
	}
	shake(amount) {
		this.trauma = Math.min(this.trauma + amount, 1);
	}
	hitStop(seconds) {
		this.stopT = Math.max(this.stopT, seconds);
	}
	update(dt) {
		if (!(dt > 0)) dt = 0;
		this.activate();
		if (this.autoQuality && dt > 0) this.adapt(Math.min(dt, .25));
		const real = Math.min(dt, .1);
		const sim = real * this.timeScale * (this.stopT > 0 ? .04 : 1);
		this.stopT = Math.max(this.stopT - real, 0);
		this.scheduler.step(sim);
		for (const h of this.loops) h.step(sim);
		this.statuses.update(sim, this.scheduler.time);
		for (const f of this.fixtures) f.step(sim, this.scheduler.time);
		this.prims.sync();
		const t = this.scheduler.time;
		for (const sys of Object.values(this.particles)) sys.update(sim, t);
		flushParticleEvents();
		this.rocks.floorY = this.crystals.floorY = this.spikes.floorY = this.floorY;
		this.rocks.update(sim);
		this.crystals.update(sim);
		this.spikes.update(sim);
		this.lights.update(sim);
		this.loopLights.update(sim);
		this.post?.update(sim, real);
		this.trauma = Math.max(this.trauma - real * 1.6, 0);
		this.shakeTime += real;
	}
	render() {
		this.activate();
		this.applyShake();
		if (this.post) this.post.render();
		else this.renderer.render(this.scene, this.camera);
		this.restoreShake();
	}
	applyShake() {
		if (this.trauma <= 0 || this.shakeSaved) return;
		const s = this.trauma * this.trauma;
		const t = this.shakeTime;
		const cam = this.camera;
		this.shakeSaved = {
			pos: cam.position.clone(),
			quat: cam.quaternion.clone()
		};
		const n = (f, o) => Math.sin(t * f + o) * .5 + Math.sin(t * f * 2.13 + o * 1.7) * .3 + Math.sin(t * f * 4.7 + o * .3) * .2;
		const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0);
		const up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1);
		cam.position.addScaledVector(right, n(47, 1) * .12 * s).addScaledVector(up, n(53, 4) * .1 * s);
		cam.rotateZ(n(41, 7) * .035 * s);
		cam.updateMatrixWorld();
	}
	restoreShake() {
		if (!this.shakeSaved) return;
		this.camera.position.copy(this.shakeSaved.pos);
		this.camera.quaternion.copy(this.shakeSaved.quat);
		this.camera.updateMatrixWorld();
		this.shakeSaved = null;
	}
	clear() {
		for (const h of [...this.handles]) h.stop();
		for (const h of [...this.loops]) h.stop();
		this.statuses.clear();
		for (const f of [...this.fixtures]) f.finish();
		this.statuses.update(0, this.scheduler.time);
		this.scheduler.cancel();
		for (const sys of Object.values(this.particles)) sys.clear();
		this.rocks.clear();
		this.crystals.clear();
		this.spikes.clear();
		this.lights.clear();
		this.loopLights.clear();
	}
	dispose() {
		if (this.disposed) return;
		this.disposed = true;
		this.restoreShake();
		this.clear();
		this.release();
	}
	release() {
		this.prims.dispose();
		for (const sys of Object.values(this.particles)) sys.dispose();
		this.rocks.dispose();
		this.crystals.dispose();
		this.spikes.dispose();
		this.post?.dispose();
		this.root.removeFromParent();
		this.root.clear();
	}
};
function recipeDefaults(name) {
	return RECIPES[name]?.defaults ?? {};
}
//#endregion
//#region src/runtime/effect.ts
function effect(recipe, element = "fire", options = {}) {
	if (!Object.hasOwn(RECIPES, recipe) && Object.hasOwn(STATUSES, recipe)) throw new Error(`rollshade: "${recipe}" is a status effect, not a move. Use fx.status(target, '${recipe}') instead of effect()`);
	if (!Object.hasOwn(RECIPES, recipe) && Object.hasOwn(FIXTURES, recipe)) throw new Error(`rollshade: "${recipe}" is a placed loop, not a move. Use fx.loop('${recipe}', position) instead of effect()`);
	if (!Object.hasOwn(RECIPES, recipe)) throw new Error(`rollshade: unknown recipe "${recipe}". Use one of: ${Object.keys(RECIPES).join(", ")}`);
	if (!Object.hasOwn(ELEMENTS, element)) throw new Error(`rollshade: unknown element "${element}". Use one of: ${Object.keys(ELEMENTS).join(", ")}`);
	const base = variant(recipe, element, options.seed === void 0 ? 0 : typeof options.seed === "string" ? seedFromString(options.seed) : options.seed >>> 0);
	return {
		...base,
		id: options.id ?? (options.seed === void 0 ? `${element}-${recipe}` : base.id),
		hue: options.hue ?? (options.color != null ? 0 : base.hue),
		...options.color != null ? { color: new Color(options.color).getHex() } : {},
		params: {
			...base.params,
			...options.params
		}
	};
}
//#endregion
//#region src/runtime/moves.ts
var MOVES = {
	projectile: {
		distance: 6,
		hits: 1,
		hitRange: [1, 1],
		power: 1.14,
		first: .86,
		last: .86,
		end: 1.54,
		perMetre: .07,
		lastPerMetre: .07,
		timeline: [[
			.86,
			1.14,
			"first"
		]]
	},
	lance: {
		distance: 6,
		hits: 1,
		hitRange: [1, 1],
		power: 1.01,
		first: .47,
		last: .47,
		end: .98,
		perMetre: .04,
		lastPerMetre: .04,
		timeline: [[
			.47,
			1.01,
			"first"
		]]
	},
	beam: {
		distance: 6,
		hits: 7,
		hitRange: [7, 7],
		power: 3.88,
		first: .4,
		last: 1.3,
		end: 1.8,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [
			[
				.4,
				.5,
				"tick"
			],
			[
				.56,
				.5,
				"tick"
			],
			[
				.72,
				.5,
				"tick"
			],
			[
				.89,
				.5,
				"tick"
			],
			[
				1.06,
				.5,
				"tick"
			],
			[
				1.22,
				.5,
				"tick"
			],
			[
				1.3,
				.88,
				"final"
			]
		]
	},
	explosion: {
		distance: 6,
		hits: 1,
		hitRange: [1, 1],
		power: 1.98,
		first: .45,
		last: .45,
		end: 1.45,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			.45,
			1.98,
			"first"
		]]
	},
	pillar: {
		distance: 6,
		hits: 1,
		hitRange: [1, 1],
		power: 1.58,
		first: .33,
		last: .33,
		end: 1.82,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			.33,
			1.58,
			"first"
		]]
	},
	meteor: {
		distance: 6,
		hits: 4,
		hitRange: [2, 5],
		power: 7.69,
		first: 1.24,
		last: 2.17,
		end: 3.17,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [
			[
				1.24,
				2.11,
				"first"
			],
			[
				1.74,
				1.66,
				"link"
			],
			[
				1.82,
				2.02,
				"link"
			],
			[
				2.17,
				1.9,
				"final"
			]
		]
	},
	nova: {
		distance: 6,
		hits: 1,
		hitRange: [1, 1],
		power: 1.37,
		first: .81,
		last: .81,
		end: 1.54,
		perMetre: .02,
		lastPerMetre: .02,
		timeline: [[
			.81,
			1.37,
			"first"
		]]
	},
	barrier: {
		distance: 6,
		hits: 0,
		hitRange: [0, 0],
		power: 0,
		first: null,
		last: null,
		end: 2.91,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: []
	},
	shockwave: {
		distance: 6,
		hits: 1,
		hitRange: [1, 1],
		power: 1.09,
		first: .85,
		last: .85,
		end: 1.35,
		perMetre: .1,
		lastPerMetre: .1,
		timeline: [[
			.85,
			1.09,
			"first"
		]]
	},
	summon: {
		distance: 6,
		hits: 1,
		hitRange: [1, 1],
		power: 2.22,
		first: 1.36,
		last: 1.36,
		end: 1.97,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			1.36,
			2.22,
			"first"
		]]
	},
	missiles: {
		distance: 6,
		hits: 16,
		hitRange: [16, 16],
		power: 4.3,
		first: 1.75,
		last: 2.66,
		end: 3.17,
		perMetre: .03,
		lastPerMetre: .05,
		timeline: [
			[
				1.75,
				.2,
				"first"
			],
			[
				1.85,
				.2,
				"link"
			],
			[
				1.86,
				.2,
				"link"
			],
			[
				1.86,
				.2,
				"link"
			],
			[
				2.04,
				.2,
				"link"
			],
			[
				2.06,
				.2,
				"link"
			],
			[
				2.09,
				.2,
				"link"
			],
			[
				2.14,
				.2,
				"link"
			],
			[
				2.24,
				.2,
				"link"
			],
			[
				2.25,
				.2,
				"link"
			],
			[
				2.26,
				.2,
				"link"
			],
			[
				2.38,
				.2,
				"link"
			],
			[
				2.57,
				.2,
				"link"
			],
			[
				2.58,
				.2,
				"link"
			],
			[
				2.64,
				.2,
				"link"
			],
			[
				2.66,
				1.23,
				"final"
			]
		]
	},
	tornado: {
		distance: 6,
		hits: 8,
		hitRange: [8, 8],
		power: 6.08,
		first: 1.11,
		last: 3.03,
		end: 3.63,
		perMetre: .04,
		lastPerMetre: 0,
		timeline: [
			[
				1.11,
				.67,
				"tick"
			],
			[
				1.42,
				.67,
				"tick"
			],
			[
				1.72,
				.67,
				"tick"
			],
			[
				2.02,
				.67,
				"tick"
			],
			[
				2.33,
				.67,
				"tick"
			],
			[
				2.63,
				.67,
				"tick"
			],
			[
				2.93,
				.67,
				"tick"
			],
			[
				3.03,
				1.39,
				"final"
			]
		]
	},
	storm: {
		distance: 6,
		hits: 4,
		hitRange: [2, 5],
		power: 4.63,
		first: .93,
		last: 3.93,
		end: 5.05,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [
			[
				.93,
				.86,
				"tick"
			],
			[
				1.16,
				.86,
				"tick"
			],
			[
				2.97,
				.86,
				"tick"
			],
			[
				3.93,
				2.06,
				"final"
			]
		]
	},
	drill: {
		distance: 6,
		hits: 12,
		hitRange: [12, 12],
		power: 9.27,
		first: .92,
		last: 1.76,
		end: 2.27,
		perMetre: .09,
		lastPerMetre: .09,
		timeline: [
			[
				.92,
				1.23,
				"first"
			],
			[
				.92,
				.61,
				"tick"
			],
			[
				1.01,
				.61,
				"tick"
			],
			[
				1.1,
				.61,
				"tick"
			],
			[
				1.2,
				.61,
				"tick"
			],
			[
				1.29,
				.61,
				"tick"
			],
			[
				1.38,
				.61,
				"tick"
			],
			[
				1.47,
				.61,
				"tick"
			],
			[
				1.56,
				.61,
				"tick"
			],
			[
				1.65,
				.61,
				"tick"
			],
			[
				1.75,
				.61,
				"tick"
			],
			[
				1.76,
				1.9,
				"final"
			]
		]
	},
	finale: {
		distance: 6,
		hits: 6,
		hitRange: [6, 6],
		power: 4.95,
		first: .25,
		last: 1.52,
		end: 3.03,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [
			[
				.25,
				.5,
				"first"
			],
			[
				.48,
				.5,
				"tick"
			],
			[
				.68,
				.5,
				"tick"
			],
			[
				.92,
				.5,
				"tick"
			],
			[
				1.13,
				.5,
				"tick"
			],
			[
				1.52,
				2.45,
				"final"
			]
		]
	},
	heal: {
		distance: 6,
		hits: 1,
		hitRange: [1, 1],
		power: 0,
		first: .62,
		last: .62,
		end: 2.93,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			.62,
			0,
			"final"
		]]
	},
	buff: {
		distance: 6,
		hits: 0,
		hitRange: [0, 0],
		power: 0,
		first: null,
		last: null,
		end: 3.74,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: []
	},
	warp: {
		distance: 6,
		hits: 0,
		hitRange: [0, 0],
		power: 0,
		first: null,
		last: null,
		end: .89,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: []
	},
	slash: {
		distance: 2,
		hits: 1,
		hitRange: [1, 1],
		power: 1.08,
		first: .15,
		last: .15,
		end: .75,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			.15,
			1.08,
			"first"
		]]
	},
	swipe: {
		distance: 2,
		hits: 1,
		hitRange: [1, 1],
		power: 1.25,
		first: .16,
		last: .16,
		end: .75,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			.16,
			1.25,
			"first"
		]]
	},
	rising: {
		distance: 2,
		hits: 1,
		hitRange: [1, 1],
		power: 1.18,
		first: .18,
		last: .18,
		end: .73,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			.18,
			1.18,
			"first"
		]]
	},
	cleave: {
		distance: 2,
		hits: 2,
		hitRange: [2, 2],
		power: 3.24,
		first: .4,
		last: .57,
		end: 1.07,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			.4,
			1.22,
			"first"
		], [
			.57,
			2.03,
			"final"
		]]
	},
	combo: {
		distance: 2,
		hits: 3,
		hitRange: [3, 3],
		power: 2.22,
		first: .17,
		last: .81,
		end: 1.32,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [
			[
				.17,
				.5,
				"first"
			],
			[
				.41,
				.5,
				"link"
			],
			[
				.81,
				1.22,
				"final"
			]
		]
	},
	wave: {
		distance: 2,
		hits: 1,
		hitRange: [1, 1],
		power: 1.28,
		first: .25,
		last: .25,
		end: .75,
		perMetre: .06,
		lastPerMetre: .06,
		timeline: [[
			.25,
			1.28,
			"first"
		]]
	},
	dash: {
		distance: 2,
		hits: 2,
		hitRange: [2, 2],
		power: 2.25,
		first: .23,
		last: .54,
		end: 1.04,
		perMetre: .01,
		lastPerMetre: 0,
		timeline: [[
			.23,
			.5,
			"first"
		], [
			.54,
			1.75,
			"final"
		]]
	},
	flurry: {
		distance: 2,
		hits: 11,
		hitRange: [11, 11],
		power: 4.83,
		first: .12,
		last: 1.45,
		end: 1.95,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [
			[
				.12,
				.35,
				"first"
			],
			[
				.22,
				.35,
				"tick"
			],
			[
				.33,
				.35,
				"tick"
			],
			[
				.43,
				.35,
				"tick"
			],
			[
				.54,
				.35,
				"tick"
			],
			[
				.65,
				.35,
				"tick"
			],
			[
				.75,
				.35,
				"tick"
			],
			[
				.86,
				.35,
				"tick"
			],
			[
				.96,
				.35,
				"tick"
			],
			[
				1.07,
				.35,
				"tick"
			],
			[
				1.45,
				1.33,
				"final"
			]
		]
	},
	thrust: {
		distance: 2,
		hits: 1,
		hitRange: [1, 1],
		power: 1.07,
		first: .21,
		last: .21,
		end: .72,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			.21,
			1.07,
			"first"
		]]
	},
	spin: {
		distance: 2,
		hits: 1,
		hitRange: [1, 1],
		power: .89,
		first: .27,
		last: .27,
		end: .91,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			.27,
			.89,
			"first"
		]]
	},
	cross: {
		distance: 2,
		hits: 3,
		hitRange: [3, 3],
		power: 2.81,
		first: .14,
		last: .63,
		end: 1.13,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [
			[
				.14,
				.5,
				"first"
			],
			[
				.31,
				.5,
				"link"
			],
			[
				.63,
				1.81,
				"final"
			]
		]
	},
	smash: {
		distance: 2,
		hits: 3,
		hitRange: [3, 3],
		power: 3.11,
		first: .48,
		last: .57,
		end: .98,
		perMetre: 0,
		lastPerMetre: .07,
		timeline: [
			[
				.48,
				1.91,
				"first"
			],
			[
				.53,
				.6,
				"tick"
			],
			[
				.57,
				.6,
				"tick"
			]
		]
	},
	iaido: {
		distance: 2,
		hits: 2,
		hitRange: [2, 2],
		power: 2.88,
		first: .52,
		last: .9,
		end: 1.4,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			.52,
			.4,
			"first"
		], [
			.9,
			2.48,
			"final"
		]]
	},
	strike: {
		distance: 2,
		hits: 2,
		hitRange: [2, 2],
		power: 1.89,
		first: .22,
		last: .39,
		end: .94,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			.22,
			.48,
			"first"
		], [
			.39,
			1.4,
			"final"
		]]
	},
	rush: {
		distance: 2,
		hits: 7,
		hitRange: [7, 7],
		power: 3.09,
		first: .2,
		last: .74,
		end: 1.32,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [
			[
				.2,
				.3,
				"first"
			],
			[
				.26,
				.3,
				"tick"
			],
			[
				.32,
				.3,
				"tick"
			],
			[
				.38,
				.3,
				"tick"
			],
			[
				.44,
				.3,
				"tick"
			],
			[
				.5,
				.3,
				"tick"
			],
			[
				.74,
				1.29,
				"final"
			]
		]
	},
	uppercut: {
		distance: 2,
		hits: 1,
		hitRange: [1, 1],
		power: 1.59,
		first: .25,
		last: .25,
		end: .96,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			.25,
			1.59,
			"final"
		]]
	},
	kick: {
		distance: 2,
		hits: 1,
		hitRange: [1, 1],
		power: 1.41,
		first: .26,
		last: .26,
		end: .9,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			.26,
			1.41,
			"final"
		]]
	},
	heel: {
		distance: 2,
		hits: 1,
		hitRange: [1, 1],
		power: 2.24,
		first: .48,
		last: .48,
		end: 1.13,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			.48,
			2.24,
			"final"
		]]
	},
	palm: {
		distance: 2,
		hits: 2,
		hitRange: [2, 2],
		power: 2.98,
		first: .22,
		last: .32,
		end: .99,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			.22,
			.99,
			"first"
		], [
			.32,
			1.99,
			"final"
		]]
	},
	tackle: {
		distance: 2,
		hits: 1,
		hitRange: [1, 1],
		power: 1.92,
		first: .37,
		last: .37,
		end: 1.02,
		perMetre: 0,
		lastPerMetre: 0,
		timeline: [[
			.37,
			1.92,
			"final"
		]]
	},
	pound: {
		distance: 2,
		hits: 1,
		hitRange: [1, 1],
		power: 1.5,
		first: .62,
		last: .62,
		end: 1.22,
		perMetre: .12,
		lastPerMetre: .12,
		timeline: [[
			.62,
			1.5,
			"final"
		]]
	}
};
//#endregion
//#region src/runtime/index.ts
var VERSION = "0.3.0";
function defineEffect(def) {
	return def;
}
//#endregion
export { BLUNT, ELEMENTS, EVENT, FIXTURES, FXHandle, FXSystem, FixtureRun, LoopHandle, MELEE, MOVES, RECIPES, SELF, STATUSES, SUPPORT, StatusRun, VERSION, defineEffect, defineLoop, effect, helpers };
