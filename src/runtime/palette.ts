import { Color, type ColorRepresentation } from 'three/webgpu';

export interface Palette {
  core: Color;
  main: Color;
  accent: Color;
  smoke: Color | null;
}

type Hex = number;

export const ELEMENTS: Record<string, { core: Hex; main: Hex; accent: Hex; smoke: Hex | null }> = {
  plain: { core: 0xf2f6ff, main: 0xa9b8cc, accent: 0x4a5566, smoke: 0x2c2c30 },
  fire: { core: 0xfff4d6, main: 0xff7a1a, accent: 0xb3200a, smoke: 0x241a16 },
  ice: { core: 0xf2fbff, main: 0x5cc8ff, accent: 0x1a4fd1, smoke: null },
  thunder: { core: 0xf6f4ff, main: 0x8f7bff, accent: 0x3a2bd8, smoke: null },
  wind: { core: 0xf4fff8, main: 0x7dffc4, accent: 0x14a07a, smoke: null },
  earth: { core: 0xfff0d0, main: 0xd99a4e, accent: 0x6b3d17, smoke: 0x3a2d22 },
  water: { core: 0xeafcff, main: 0x3fb8ff, accent: 0x0b4fa0, smoke: null },
  light: { core: 0xffffff, main: 0xffe17a, accent: 0xd18a1f, smoke: null },
  dark: { core: 0xf0d8ff, main: 0x9b3dff, accent: 0x2a0850, smoke: 0x0d0612 },
  poison: { core: 0xd6f25a, main: 0x6fae12, accent: 0x3a0b4a, smoke: 0x11160a },
  arcane: { core: 0xfff0ff, main: 0xff5ce1, accent: 0x5b1fd6, smoke: null },
};

const WHITE = new Color(1, 1, 1);

export function palette(element: string, hueShift = 0, color?: ColorRepresentation): Palette {
  const e = ELEMENTS[element] ?? ELEMENTS.fire;
  const shift = (c: Color) => (hueShift ? c.offsetHSL(hueShift, 0, 0) : c);
  if (color != null) {
    const main = new Color(color);
    return { core: shift(main.clone().lerp(WHITE, 0.82)), main: shift(main.clone()), accent: shift(main.clone().multiplyScalar(0.3)), smoke: e.smoke == null ? null : shift(new Color(e.smoke)) };
  }
  return { core: shift(new Color(e.core)), main: shift(new Color(e.main)), accent: shift(new Color(e.accent)), smoke: e.smoke == null ? null : shift(new Color(e.smoke)) };
}
