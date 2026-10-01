import { createContext, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import { FXSystem, type EffectDef, type FXOptions, type FixtureOptions, type LoopDef, type StatusOptions, type StatusRun, type FixtureRun } from 'rollshade';

const Context = createContext<FXSystem | null>(null);

export interface FXProps extends Omit<FXOptions, 'scene' | 'camera' | 'renderer'> {
  effects?: (EffectDef | LoopDef)[];
  prewarm?: boolean;
  onReady?: (fx: FXSystem) => void;
  children?: ReactNode;
}

export function FX({ effects = [], prewarm = true, onReady, children, ...options }: FXProps) {
  const gl = useThree((s) => s.gl) as unknown as THREE.WebGPURenderer;
  const scene = useThree((s) => s.scene) as unknown as THREE.Scene;
  const camera = useThree((s) => s.camera) as unknown as THREE.Camera;
  const post = options.post ?? true;
  const postKey = typeof post === 'object' ? JSON.stringify(post) : String(post);
  const latest = useRef({ options, post, camera, effects, prewarm, onReady });
  latest.current = { options, post, camera, effects, prewarm, onReady };
  const [fx, setFx] = useState<FXSystem | null>(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const now = latest.current;
    const system = new FXSystem({ ...now.options, post: now.post, scene, camera: now.camera, renderer: gl });
    setFx(system);
    return () => {
      system.dispose();
      setFx(null);
      setReady(false);
    };
  }, [gl, scene, postKey]);
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
  }, [fx, effects.map((e) => e.id).join('|')]);
  useEffect(() => {
    if (!fx) return;
    if (options.feel !== undefined) fx.feel = options.feel;
    if (options.photosensitive !== undefined) fx.photosensitive = options.photosensitive;
  }, [fx, options.feel, options.photosensitive]);
  useFrame((_, delta) => fx?.update(Math.min(delta, 0.05)), -1);
  useFrame(post ? () => (fx ? fx.render() : gl.render(scene, camera)) : () => {}, post ? 1 : 0);
  return <Context.Provider value={ready ? fx : null}>{children}</Context.Provider>;
}

export function useFX(): FXSystem | null {
  return useContext(Context);
}

type Target = RefObject<THREE.Object3D | null> | THREE.Object3D | null | undefined;

const resolve = (t: Target): THREE.Object3D | null => (t && 'current' in (t as object) ? (t as RefObject<THREE.Object3D | null>).current : (t as THREE.Object3D | null)) ?? null;

export interface StatusProps extends StatusOptions {
  target: Target;
  name: string;
  active?: boolean;
  fade?: number;
  onFull?: () => void;
  onEnd?: () => void;
}

export function Status({ target, name, active = true, fade, onFull, onEnd, progress, duration, ...options }: StatusProps) {
  const fx = useFX();
  const run = useRef<StatusRun | null>(null);
  const handlers = useRef({ onFull, onEnd });
  handlers.current = { onFull, onEnd };
  useEffect(() => {
    const object = resolve(target);
    if (!fx || !object || !active) return;
    const r = fx.status(object, name as never, { ...options, progress, duration });
    r.on('full', () => handlers.current.onFull?.());
    r.on('end', () => handlers.current.onEnd?.());
    run.current = r;
    return () => {
      r.stop(fade);
      run.current = null;
    };
  }, [fx, target, name, active, options.element, options.hue, options.scale]);
  useEffect(() => {
    if (run.current && progress !== undefined) run.current.to(progress, duration ?? 0.3);
  }, [progress]);
  return null;
}

export interface LoopProps extends FixtureOptions {
  name: string;
  position?: [number, number, number] | THREE.Vector3;
  target?: Target;
  active?: boolean;
  fade?: number;
}

export function Loop({ name, position, target, active = true, fade, intensity, ...options }: LoopProps) {
  const fx = useFX();
  const run = useRef<FixtureRun | null>(null);
  const at = useMemo(() => new THREE.Vector3(), []);
  if (position) Array.isArray(position) ? at.set(position[0], position[1], position[2]) : at.copy(position);
  useLayoutEffect(() => {
    if (!fx || !active) return;
    const r = fx.loop(name as never, resolve(target) ?? at, { ...options, intensity });
    run.current = r;
    return () => {
      r.stop(fade);
      run.current = null;
    };
  }, [fx, name, active, target, options.element, options.hue, options.scale, options.prop, options.light, options.rotation]);
  useEffect(() => {
    if (run.current && !target) run.current.moveTo(at);
  }, [at.x, at.y, at.z]);
  useEffect(() => {
    if (run.current && intensity !== undefined) run.current.intensity = intensity;
  }, [intensity]);
  return null;
}
