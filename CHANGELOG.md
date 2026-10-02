# Changelog

## 0.2.0 (2026-10-02)

- 14 melee moves, 39 in all. Blade: `swipe` (only the swing trail and a few sparks, for the quietest cut), `rising`, `cleave`, `combo`, `wave` (a thrown crescent), `dash` (runs through the target), `flurry`. Fists and kicks: `rush`, `uppercut`, `kick`, `heel` (axe kick), `palm`, `tackle`, `pound` (ground shockwave). `BLUNT` lists the fist, kick and body moves.
- `plain` element: no magic flourishes, metal sparks, dust and scuffs, for games without spells.
- `color` on `effect()`, `fx.status()` and `fx.loop()` replaces the element's colours with your own (`0xrrggbb` or `'#rrggbb'`); the seed's hue shift is skipped unless you also pass `hue`.
- `handle.body` (`offset`, `lean`, `turn`, `limb`) gives hints for animating the attacker; fist and kick moves write the fist or foot to `handle.head`. Hit events carry `dir`, the knockback direction.
- `slash` always cuts downward now (it rose from below for half the seeds): its `roll` is 30–80° and `mirror` (0 or 1) picks the side. A negative `roll` in `params` (0.1 used −60–60°) is now raised to 7.5°; use `mirror: 1` for the other side.
- Slash marks curve along the swing around the attacker instead of bowing towards it, and a single cut draws one mark instead of two.
- Because of the two changes above, `slash`, `spin`, `cross` and `iaido` look a little different for the same seed.

## 0.1.2 (2026-10-02)

- With `post` on, the scene is drawn into one colour target instead of two, unless a loop with bloom has been added or spawned: the second target (emissive, used only by the loop bloom) and the loop bloom's blur ran every frame for nothing. About 58 MB less texture memory at 2400×1600, plus its multisampled copy.
- The post pass reads the scene once instead of eight times while there is no camera zoom.
- README: on high-DPI screens, create the renderer with `antialias: devicePixelRatio < 1.5` to skip MSAA.

## 0.1.1 (2026-10-01)

- `prewarm()` and `prewarmStatus()` are faster with `post` on: they compile only the shaders the bloom pass draws with (they also compiled a plain version that was never used), about a third less work on WebGPU and up to two thirds on WebGL2.
- `prewarm(counts, onProgress)` and `prewarmStatus(target, names, onProgress)` report progress from 0 to 1 for a loading bar, and yield to the browser between steps so the page can repaint.

## 0.1.0 (2026-10-01)

First release: 25 moves in 10 elements with seeded variations, 11 status effects, 9 placed loops, the `rollshade/react` entry for React Three Fiber, and an agent skill. Tested with three r186.
