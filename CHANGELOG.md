# Changelog

## 0.6.0 (2026-10-10)

- 7 magic moves, 46 in all: `torrent` (a widening cone of energy from the palm), `pillars` (five slabs fall around the target and are joined by a star of light), `nine` (nine dark orbs spiral in and seal the target, then burst; `space` sets the ring size), `chain` (a chain coils around the target and cinches tight), `bind` (six light plates on one tilted plane pierce the target, then shatter like glass), `prison` (a box builds its edges from the bottom up around the target, spears break out, then it shatters), `pyramid` (a pyramid ward around the caster, built edges-first). `pillars`, `nine`, `chain`, `bind` and `prison` wrap around `to`; pass the target's centre, or `params: { depth }` to move them behind a surface point.
- `prewarm()` also prepares the parts of the new moves by default.

## 0.5.2 (2026-10-08)

- `fx.play()` takes only the end a move uses: `fx.play('fire-finale', { to: enemy })`, `fx.play('light-buff', { from: hero })`. `from` can now be left out and defaults to `to` (`to` already defaulted to `from`); calls with neither throw a clear error, and existing calls with both keep working.
- "Coming from WebGLRenderer" in the README: what changes when a WebGLRenderer game moves to WebGPURenderer for rollshade (imports, `init()`, `ShaderMaterial` and `onBeforeCompile` to TSL with examples, node versions of `Sky`, `Water` and others, `EffectComposer` and bloom, shadows, renames), checked by having an AI assistant migrate a WebGL scene with sky, shadows, custom shaders and bloom from these docs alone.
- The README says which three releases have been checked and how (0.186.0 and 0.186.1).
- Docs: the status section explains that a custom material look (a `colorNode` of your own) pauses while a status runs and comes back afterwards, and that props work too.

## 0.5.1 (2026-10-07)

Docs only, from watching an AI assistant build a small game with nothing but these docs:

- `nova`: the ring is always 360° around the caster's feet and reaches 1.2 m past `to` (at least 3.5 m), or `params: { radius }`; how to use it as an area attack around the caster.
- Deaths: `dissolve` for ordinary enemies, `finale` for bosses (it shakes the camera six times).
- Ground clicks: lift a `Vector3` target to chest height; `hit` fires even when no one is there.
- Statuses: the same name on the same target replaces the running one; `alive` stays true until the fade-out ends; `prewarmStatus` without names compiles all of them.
- Resizing needs nothing on `FXSystem`.
- Ids: `effect()` keeps `${element}-${recipe}` with `params` or `color`; with a `seed`, pass your own `id`.
- Spawning: let an enemy move from the `'end'` of `appear`. Hit-stop only on real hits: `hitStopScale: 0` and `fx.hitStop()` in the handler.
- Examples in the repository: a starter project (`npx degit tsuyatt/rollshade/examples/starter my-game`), the source of the Rollshade Arena demo with its CC0 models (`examples/arena`), and the game an AI built from these docs, with its request (`examples/ai-made`, playable at https://rollshade.tsuyatt.com/demo/ai/).
- Which file to read: llms.txt is an overview, llms-full.txt (the same text as the README and the skill in the package) is the full reference.

## 0.5.0 (2026-10-06)

- Softer bloom by default: `strength` 0.8 → 0.3. Pass `post: { strength: 0.8 }` for the old look.
- Less white by default: `look: { core, hot, limit }` and `fx.setLook()` control how white the effects look: the centre colour of each element, the white of the brightest parts, and a brightness cap that keeps colour where effects overlap instead of turning white (with `post`). The defaults are now `{ core: 0.1, hot: 0.2, limit: 1.5 }`; pass `look: { core: 1, hot: 1, limit: 0 }` for the old look. The Motion mode has sliders for them and writes them into the code.
- Fewer particles and less smoke by default: `look: { particles }` scales the number of particles of every kind (default 0.25) and `look: { smoke }` the smoke (default 0.2, 0 = none), in the options or with `fx.setLook()`. Pass `look: { smoke: 1, particles: 1 }` for the old amount. The Motion mode has sliders for both.
- Fixed: the smoke from fire and plain impacts grew with the square of `scale`; it now grows in step with it.
- `fx.getLook()` reads the current look settings and `LOOK` holds the defaults.
- `fx.setBloom({ strength, radius, threshold })` changes the bloom while running, for example from a settings menu; `fx.getBloom()` reads it and `BLOOM` holds the defaults. Loops made with `defineLoop` that bring their own bloom scale with `strength`.

## 0.4.0 (2026-10-05)

- Fixed: the screen ripple from impacts (`fx.post.wave()`) and the zoom blur centre appeared mirrored top to bottom. A hit in the upper left warped the lower left of the screen. Both backends are fixed.
- `fx.glow(object)` adds your own objects (and their children) to the effects bloom, for glowing crystals, rings and edges; `fx.glow(object, false)` takes them out. Their whole colour goes into the bloom.
- `fx.has(id)` and `fx.remove(...ids)` for definitions added with `fx.add()`.
- `aura` is brighter at the outline and thinner in front, so the character inside stays visible with the camera close.
- Docs: `from`, `to` and loop positions are read every frame, also when they are a `Vector3`, so changing the vector in place moves the effect.

## 0.3.0 (2026-10-05)

- Bloom now applies only to what rollshade draws (moves, loops, status shells and the glow of statuses on characters). Bright models, floors and skies no longer blow out. `post: { bloom: 'scene' }` brings back bloom on the whole picture. The scene pass writes one more half-float colour target for this, the size of the canvas.
- `MOVES` gives each move's hit count, total power and hit times (first, last, every hit with its role), plus how much later the hits land per extra metre. The README has the same numbers as a table under "Hits per move".
- `fx.status(target, name, { lasts: 4 })` ends a status by itself after 4 seconds of game time. `fade` sets the fade-out, and `run.lasts = 4` restarts the countdown.
- `prewarmStatus()` works on a model that is not in the scene yet, or is hidden: it adds the model while compiling and puts it back.
- Fixed: with `post` on, `prewarm()` and `prewarmStatus()` skipped most of their work once frames were being drawn. The scene pass draws once per frame, so the extra draws in the same frame did nothing. On WebGPU, 6 pipelines were still created during play after `prewarm()`, and `prewarmStatus()` compiled none of the status materials. Both now compile everything they cover.
- Fixed: status shells (freeze, shock, burn, poison, bless, curse) freed their pipeline when the last character with that status lost it, so applying the status again compiled it again and stuttered. One shell of each kind is now kept.
- `quality: 'auto'` no longer drops to the lowest level because of stutters at start: it waits 2 seconds after start and after `prewarm()`, counts a long frame as at most two frame budgets, and lowers quality only after a second of slow frames. The wait before raising quality again is capped at 12 seconds and resets after 15 seconds without slowdowns (it could reach 20 seconds per step and never reset).

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
