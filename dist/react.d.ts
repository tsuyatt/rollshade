import type { ReactNode, RefObject } from 'react';
import type * as THREE from 'three/webgpu';
import type { EffectDef, ElementName, FXOptions, FXSystem, LoopDef, LoopName, LoopOptions, StatusName, StatusOptions } from './index.js';

/** Props of `<FX>`: the `FXSystem` options without `scene`, `camera` and `renderer`, which come from React Three Fiber. */
export interface FXProps extends Omit<FXOptions, 'scene' | 'camera' | 'renderer'> {
  effects?: (EffectDef | LoopDef)[];
  prewarm?: boolean;
  onReady?: (fx: FXSystem) => void;
  children?: ReactNode;
}

/** Creates one `FXSystem` for the canvas, updates it every frame and, with `post` (default on), renders the scene. */
export declare function FX(props: FXProps): ReactNode;

/** The `FXSystem` of the surrounding `<FX>`, or null until `prewarm` has finished. */
export declare function useFX(): FXSystem | null;

type Target = RefObject<THREE.Object3D | null> | THREE.Object3D | null | undefined;

export interface StatusProps extends StatusOptions {
  target: Target;
  name: StatusName;
  element?: ElementName | (string & {});
  active?: boolean;
  fade?: number;
  onFull?: () => void;
  onEnd?: () => void;
}

/** Puts a status on `target` while mounted and `active`. */
export declare function Status(props: StatusProps): null;

export interface LoopProps extends LoopOptions {
  name: LoopName;
  position?: [number, number, number] | THREE.Vector3;
  target?: Target;
  active?: boolean;
  fade?: number;
}

/** Places a loop at `position`, or on `target`, while mounted and `active`. */
export declare function Loop(props: LoopProps): null;
