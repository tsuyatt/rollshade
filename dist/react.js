// Rollshade React Three Fiber entry 0.5.1 — https://rollshade.tsuyatt.com/
// Copyright (c) 2026 tsuyatt. MIT License.
import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three/webgpu";
import { FXSystem } from "./index.js";
import { jsx } from "react/jsx-runtime";
//#region src/react/index.tsx
var Context = createContext(null);
function FX({ effects = [], prewarm = true, onReady, children, ...options }) {
	const gl = useThree((s) => s.gl);
	const scene = useThree((s) => s.scene);
	const camera = useThree((s) => s.camera);
	const post = options.post ?? true;
	const postKey = typeof post === "object" ? JSON.stringify(post) : String(post);
	const latest = useRef({
		options,
		post,
		camera,
		effects,
		prewarm,
		onReady
	});
	latest.current = {
		options,
		post,
		camera,
		effects,
		prewarm,
		onReady
	};
	const [fx, setFx] = useState(null);
	const [ready, setReady] = useState(false);
	useEffect(() => {
		const now = latest.current;
		const system = new FXSystem({
			...now.options,
			post: now.post,
			scene,
			camera: now.camera,
			renderer: gl
		});
		setFx(system);
		return () => {
			system.dispose();
			setFx(null);
			setReady(false);
		};
	}, [
		gl,
		scene,
		postKey
	]);
	useEffect(() => {
		if (fx) fx.camera = camera;
	}, [fx, camera]);
	useEffect(() => {
		if (!fx) return;
		fx.add(...latest.current.effects);
		let live = true;
		(latest.current.prewarm ? fx.prewarm() : Promise.resolve()).then(() => {
			if (!live) return;
			setReady(true);
			latest.current.onReady?.(fx);
		});
		return () => {
			live = false;
		};
	}, [fx, effects.map((e) => e.id).join("|")]);
	useEffect(() => {
		if (!fx) return;
		if (options.feel !== void 0) fx.feel = options.feel;
		if (options.photosensitive !== void 0) fx.photosensitive = options.photosensitive;
	}, [
		fx,
		options.feel,
		options.photosensitive
	]);
	useFrame((_, delta) => fx?.update(Math.min(delta, .05)), -1);
	useFrame(post ? () => fx ? fx.render() : gl.render(scene, camera) : () => {}, post ? 1 : 0);
	return /* @__PURE__ */ jsx(Context.Provider, {
		value: ready ? fx : null,
		children
	});
}
function useFX() {
	return useContext(Context);
}
var resolve = (t) => (t && "current" in t ? t.current : t) ?? null;
function Status({ target, name, active = true, fade, onFull, onEnd, progress, duration, ...options }) {
	const fx = useFX();
	const run = useRef(null);
	const handlers = useRef({
		onFull,
		onEnd
	});
	handlers.current = {
		onFull,
		onEnd
	};
	useEffect(() => {
		const object = resolve(target);
		if (!fx || !object || !active) return;
		const r = fx.status(object, name, {
			...options,
			progress,
			duration
		});
		r.on("full", () => handlers.current.onFull?.());
		r.on("end", () => handlers.current.onEnd?.());
		run.current = r;
		return () => {
			r.stop(fade);
			run.current = null;
		};
	}, [
		fx,
		target,
		name,
		active,
		options.element,
		options.hue,
		options.color,
		options.scale
	]);
	useEffect(() => {
		if (run.current && progress !== void 0) run.current.to(progress, duration ?? .3);
	}, [progress]);
	return null;
}
function Loop({ name, position, target, active = true, fade, intensity, ...options }) {
	const fx = useFX();
	const run = useRef(null);
	const at = useMemo(() => new THREE.Vector3(), []);
	if (position) Array.isArray(position) ? at.set(position[0], position[1], position[2]) : at.copy(position);
	useLayoutEffect(() => {
		if (!fx || !active) return;
		const r = fx.loop(name, resolve(target) ?? at, {
			...options,
			intensity
		});
		run.current = r;
		return () => {
			r.stop(fade);
			run.current = null;
		};
	}, [
		fx,
		name,
		active,
		target,
		options.element,
		options.hue,
		options.color,
		options.scale,
		options.prop,
		options.light,
		options.rotation
	]);
	useEffect(() => {
		if (run.current && !target) run.current.moveTo(at);
	}, [
		at.x,
		at.y,
		at.z
	]);
	useEffect(() => {
		if (run.current && intensity !== void 0) run.current.intensity = intensity;
	}, [intensity]);
	return null;
}
//#endregion
export { FX, Loop, Status, useFX };
