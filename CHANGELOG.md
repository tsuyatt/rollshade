# Changelog

## 0.1.2 (2026-10-02)

- With `post` on, the scene is drawn into one colour target instead of two, unless a loop with bloom has been added or spawned: the second target (emissive, used only by the loop bloom) and the loop bloom's blur ran every frame for nothing. About 58 MB less texture memory at 2400×1600, plus its multisampled copy.
- The post pass reads the scene once instead of eight times while there is no camera zoom.
- README: on high-DPI screens, create the renderer with `antialias: devicePixelRatio < 1.5` to skip MSAA.

## 0.1.1 (2026-10-01)

- `prewarm()` and `prewarmStatus()` are faster with `post` on: they compile only the shaders the bloom pass draws with (they also compiled a plain version that was never used), about a third less work on WebGPU and up to two thirds on WebGL2.
- `prewarm(counts, onProgress)` and `prewarmStatus(target, names, onProgress)` report progress from 0 to 1 for a loading bar, and yield to the browser between steps so the page can repaint.

## 0.1.0 (2026-10-01)

First release: 25 moves in 10 elements with seeded variations, 11 status effects, 9 placed loops, the `rollshade/react` entry for React Three Fiber, and an agent skill. Tested with three r186.
