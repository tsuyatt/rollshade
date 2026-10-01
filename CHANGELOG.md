# Changelog

## 0.1.1 (2026-10-01)

- `prewarm()` and `prewarmStatus()` are faster with `post` on: they compile only the shaders the bloom pass draws with (they also compiled a plain version that was never used), about a third less work on WebGPU and up to two thirds on WebGL2.
- `prewarm(counts, onProgress)` and `prewarmStatus(target, names, onProgress)` report progress from 0 to 1 for a loading bar, and yield to the browser between steps so the page can repaint.

## 0.1.0 (2026-10-01)

First release: 25 moves in 10 elements with seeded variations, 11 status effects, 9 placed loops, the `rollshade/react` entry for React Three Fiber, and an agent skill. Tested with three r186.
