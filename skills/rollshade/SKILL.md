---
name: rollshade
description: Add ready-made spell, attack, heal and warp effects, status effects on characters (burning, frozen, poisoned, petrified, dissolving, shielded, stunned) and placed effects (torches, campfires, portals, magic circles, save points, barriers, auras, beacons) to a three.js game with the rollshade package (WebGPURenderer + TSL). Use when the user wants magic, attacks, hits, explosions, status effects, death or spawn effects, torches or portals in a three.js or browser game, or asks to make a three.js game feel juicier.
---

# rollshade: combat effects for three.js

`rollshade` plays complete moves (charge-up, travel, impact, lingering smoke, lights, bloom, camera shake) with one call and tells the game when each hit lands. Do not hand-write particle systems or shaders for spells when this package is available.

## Three kinds of effects

| kind | names | how to use | never |
|---|---|---|---|
| Moves (one-shot attacks, heals, warps) | `projectile`, `meteor`, `slash`, … (table below) | `fx.add(effect('meteor', 'fire'))`, then `fx.play('fire-meteor', { from, to })` | |
| Status effects on a character | `burn`, `freeze`, `shock`, `poison`, `petrify`, `dissolve`, `appear`, `bless`, `curse`, `shield`, `stun` | `fx.status(character, 'burn')` returns a handle; `.stop()` removes it | do not pass these to `effect()` or `fx.add()` |
| Placed loops | `torch`, `campfire`, `candles`, `portal`, `sigil`, `savepoint`, `barrier`, `aura`, `beacon` | `fx.loop('torch', position)` returns a handle; `.stop()` removes it | do not pass these to `effect()` or `fx.add()` |

Note that `barrier` exists twice: the move `effect('barrier', element)` is a short shield cast, the loop `fx.loop('barrier', pos)` is a lasting dome.

## Setup

```sh
npm i rollshade three@0.186
```

three r186 (the peer range is pinned to one three release). The renderer must be `THREE.WebGPURenderer` from `three/webgpu` (it falls back to WebGL2 by itself). The classic `WebGLRenderer` cannot run it.

```js
import * as THREE from 'three/webgpu';
import { FXSystem, effect } from 'rollshade';

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.toneMapping = THREE.ACESFilmicToneMapping;
await renderer.init();

const fx = new FXSystem({ scene, camera, renderer, post: true, feel: true });
fx.add(effect('meteor', 'fire'), effect('slash', 'thunder'), effect('heal', 'light'));
await fx.prewarm();

const timer = new THREE.Timer();
renderer.setAnimationLoop((ms) => {
  timer.update(ms);
  const dt = Math.min(timer.getDelta(), 0.05);
  fx.update(dt);
  fx.render();
});
```

`effect(recipe, element)` returns a plain definition whose id is `` `${element}-${recipe}` `` (for example `fire-meteor`). Play it by id after `fx.add()`, or pass the definition itself to `fx.play()`.

## Casting and hits

```js
const h = fx.play('fire-meteor', { from: player.hand, to: enemy.chest });
h.on('hit', (e) => {
  enemy.hp -= Math.round(10 * e.power);
  if (e.role === 'final') enemy.knockback(e.dir); // unit vector: away from the attacker, up or down for launchers and slams
});
h.on('end', () => {});
```

- Put damage, sounds and knockback in the `hit` handler, not on a timer. Multi-hit moves send several hits; `role` is `'first'`, `'link'`, `'final'` or `'tick'`. `power` is about 1 per hit (ticks less, finishers up to about 2.7). For a fixed damage per cast, apply it once when `e.index === 0` (not every move has a `'final'` hit). For balancing, `MOVES[recipe]` (exported) gives each move's hit count, total power and hit times, measured on the default definition.
- `h.stop()` ends a move early and still fires `'end'`. `barrier`, `buff` and `warp` send no `hit`.
- `from` and `to` take a `Vector3` or an `Object3D`. Pass an `Object3D` (for example an empty child of the character at hand or chest height) so the effect follows moving characters (`explosion`, `pillar`, `meteor`, `summon`, `tornado` and `missiles` aim at where the target is when cast).
- `floorY` in the play options sets the ground under that move (for example a fight on a rooftop); otherwise `fx.floorY` is used. Loops use the height they are placed at.
- Units are metres and characters are about 1.8 m tall. Scale the whole move with `{ scale }` if your world is bigger or smaller.
- Several `fx.play()` calls can run at once, including the same move many times.

## Moves

`effect(recipe, element)` gives the id `` `${element}-${recipe}` ``, for example `fire-meteor`, also with `params` or `color`. With a `seed` the id gets the seed added, so pass your own `id` (`effect('nova', 'ice', { seed: 3, id: 'nova' })`) or play `def.id`. `from` and `to` take a `THREE.Vector3` or a `THREE.Object3D`. Both are read again every frame, so a moving object, or a vector you change in place (`v.copy(p)`), is followed (except that `explosion`, `pillar`, `meteor`, `summon`, `tornado` and `missiles` aim at where the target is when they are cast). Positions are in metres; characters are assumed to be about 1.8 m tall. For a spot on the ground with no one there (a mouse click), lift `to` to chest height (`y` ≈ 1); the `hit` events fire anyway, so test what is near `e.point` in the handler.

| recipe | kind | from | to | what happens |
|---|---|---|---|---|
| `projectile` | magic | caster's hand | target | Charge, a curved shot (1–3), impact and follow-up blasts |
| `lance` | magic | caster's hand | target | Fast straight spear that pierces and bursts behind the target |
| `beam` | magic | caster's hand | target | Sustained beam with ticking hits and a big final impact |
| `explosion` | magic | caster's hand | target | Light gathers on the target, then a blast with secondary explosions and a smoke column |
| `pillar` | magic | caster's hand | target | Warning circle under the target, then a pillar erupts from the ground |
| `meteor` | magic | caster's hand | target | Several meteors fall around the target; the last one hits hardest |
| `nova` | magic | caster's chest | target | 360° blast centred on the caster's feet; the ring reaches 1.2 m past `to` (at least 3.5 m, or set `params: { radius }`). One hit, at `to` |
| `barrier` | magic | caster's chest | direction | Hexagon shield that ripples where it is hit, then shatters |
| `shockwave` | magic | caster's hand | target | Crescent waves (1–3) thrown from an arm swing |
| `summon` | magic | caster's hand | target | A gate opens (behind, above or under the target) and fires a huge elemental mass |
| `missiles` | magic | caster's hand | target | Swarm of homing missiles with smoke trails |
| `tornado` | magic | caster's hand | target | Tornado drifts onto the target, ticks, then flings it |
| `storm` | magic | caster's hand | target | Elemental weather over an area: fire rain, blizzard, thunderstorm, sandstorm… |
| `drill` | magic | caster's hand | target | Spinning cone that grinds into the target, then pierces |
| `slash` | blade | attacker's chest | target | Diagonal downward cut; hits when the blade crosses the target |
| `swipe` | blade | attacker's chest | target | Just the swing trail and a few sparks, still with a hit event: the quietest blade move |
| `rising` | blade | attacker's chest | target | Upward cut that knocks the target up |
| `cleave` | blade | attacker's chest | target | Overhead vertical cut; the mark splits a moment later |
| `combo` | blade | attacker's chest | target | Three hits: horizontal, backhand, overhead finisher |
| `wave` | blade | attacker's chest | target | A swing throws a crescent blade wave at the target |
| `dash` | blade | attacker's chest | target | Dashes through the target with a low blade; the cut lands after a beat |
| `flurry` | blade | attacker's chest | target | A storm of short cuts from every angle, then a finisher |
| `thrust` | blade | attacker's chest | target | Pull back and thrust with a piercing burst |
| `spin` | blade | attacker's chest | target | Full spin slash with a ground ring and dust |
| `cross` | blade | attacker's chest | target | Two diagonal slashes that explode as a cross |
| `smash` | blade | attacker's chest | target | Overhead smash; a fissure runs to the target |
| `iaido` | blade | attacker's chest | target | Gather light, one instant cut, a delayed slash mark and big impact |
| `strike` | fist | attacker's chest | target | One-two: jabs and a heavy punch with a forward shock cone |
| `rush` | fist | attacker's chest | target | A barrage of alternating punches, then a straight |
| `uppercut` | fist | attacker's chest | target | Crouch and drive the fist up through the target, knocking it up |
| `kick` | kick | attacker's chest | target | Roundhouse kick sweeping at waist height |
| `heel` | kick | attacker's chest | target | Axe kick: the leg rises overhead and slams down, cracking the ground |
| `palm` | fist | attacker's chest | target | Short palm push; the shock passes through and bursts out of the target's back |
| `tackle` | body | attacker's chest | target | Shoulder charge across the gap with dust and speed lines |
| `pound` | fist | attacker's chest | target | Jump and punch the ground; a shockwave runs along the floor to the target |
| `heal` | support | caster's hand | ally | Light flies to the ally and rises around them (hit with power 0) |
| `buff` | support | caster's chest | (unused) | Burst and a lasting aura on the caster |
| `warp` | support | caster's chest | destination | Caster vanishes and reappears on the ground 0.9–1.8 m in front of `to`, on the caster's side (`vanish` / `appear` events carry ground points) |
| `finale` | event | (unused) | enemy's chest | Defeat: light rays, chained blasts, implosion and a flash |

Blade, fist and kick moves expect the attacker about 2 m from the target (`dash` and `tackle` cover the gap themselves). The blade path is written to `handle.blade.base` / `handle.blade.tip` every frame, so you can attach your own sword to it; fist and kick moves write the fist or foot to `handle.head` instead and set `handle.body.limb` to `'fist'` or `'foot'`. `handle.body` also carries hints for animating the attacker: `offset` (root movement since the move started, for steps, dashes and jumps), `lean` and `turn` in radians. `offset` returns to zero as the move settles; to keep the distance a `dash` or `tackle` covered, move your character by the furthest offset rather than following it back. Every `hit` event has `dir`, the direction to knock the target back (up for `rising` and `uppercut`, down for `cleave` and `heel`).

**Elements:** `plain`, `fire`, `ice`, `thunder`, `wind`, `earth`, `water`, `light`, `dark`, `poison`, `arcane`. `plain` has no magic: metal sparks, dust and scuffs, for games without spells. Any element takes your own colour: `effect('slash', 'plain', { color: 0xff3355 })`; statuses and loops take `color` too.

## Status effects on characters

```js
await fx.prewarmStatus(enemyTemplate);                 // once per kind of model while loading (it need not be in the scene); share materials between clones
const s = fx.status(enemy, 'freeze', { duration: 1 }); // burn, freeze, shock, poison, petrify, dissolve, appear, bless, curse, shield, stun
s.on('full', () => { enemy.userData.frozen = true; mixer.timeScale = 0; });
s.stop();                                              // remove (freeze shatters, petrify crumbles, shield breaks)
```

- Pass the character root (`Object3D`, it must contain a mesh); skinned and animated meshes work. Statuses end by themselves when the target is removed from the scene.
- `progress` 0–1 (`s.progress = x` or `s.to(x, seconds)`) drives how far freeze, petrify and dissolve have spread.
- Death: `fx.status(enemy, 'dissolve').on('full', () => scene.remove(enemy))`. Spawn: `fx.status(enemy, 'appear').on('end', () => enemy.userData.active = true)` (ends by itself after about 1.4 s; let the enemy move from `'end'`).
- Shield hits: `shield.impact(e.point)` from the attack's `hit` handler.
- Stopping gameplay (animations, movement) while frozen or petrified is the game's job.
- Same name again on the same target replaces the running status; to extend one, keep the run and set `s.lasts` while `s.alive` (true until its fade-out ends). `prewarmStatus(model)` without names compiles all statuses, `appear` included.
- Timed statuses: `fx.status(enemy, 'burn', { lasts: 4 })` ends by itself after 4 s (game time); `s.lasts = 4` restarts the countdown when it is applied again. Without `lasts` a status stays until `.stop()` (only `appear` ends itself). `duration` is the time to reach `progress`, not how long it lasts.

## Placed loops

```js
fx.loop('torch', new THREE.Vector3(x, 0, z));   // torch, campfire, candles, portal, sigil, savepoint, barrier, aura, beacon
fx.loop('aura', hero, { element: 'light' });    // follows an Object3D
fx.loop('portal', pos, { rotation: angle });    // portal faces +Z before rotation
const l = fx.loop('barrier', pos); l.impact(p); l.stop();
```

- `prop: false` removes the built-in low-poly stand when the effect goes on your own model.
- Only `loopLights` (default 4) loops light their surroundings; never add your own PointLight per torch (changing the light count recompiles every material).

## Game patterns

- **Enemy waves:** create one `FXSystem`, add every move once at load, and call `fx.play()` per cast. Never create a new `FXSystem` per cast. For definitions made per enemy or per placed object, pass the definition to `fx.play()` instead of calling `fx.add()` each time (`fx.remove(id)` forgets added ones).
- **Moving targets:** `from`, `to` and loop positions are read every frame, whether they are an `Object3D` or a `Vector3` you change in place.
- **Glow too strong or too weak:** `post: { strength: 0.2 }` at creation, or `fx.setBloom({ strength })` at any time (a brightness slider in the settings menu); the default strength is 0.3.
- **Effects too white:** lower `look: { core, hot }` (defaults 0.1, 0.2) or `limit` (default 1.5) in the options, or `fx.setLook()` at any time; `core` is the white of each element's centre colour, `hot` the white of the brightest parts, `limit` a brightness cap that keeps colour where effects overlap (needs `post`).
- **Too many or too few particles:** `look: { particles }` (default 0.25) scales flames, sparks, smoke and the rest; `look: { smoke }` (default 0.2, 0 = none) scales only smoke. Set them in the options, or with `fx.setLook()` at any time. `look: { core: 1, hot: 1, limit: 0, smoke: 1, particles: 1 }` brings back the look of 0.4 and earlier.
- **Glowing scenery:** bloom covers only rollshade's effects by default. `fx.glow(crystal)` adds your own bright or emissive object (and its children) to it.
- **Melee:** move the attacker to about 2 m from the target before `fx.play()`; `from` is the attacker's chest. Attach a sword mesh to `h.blade.base` / `h.blade.tip` if you want one; fist and kick moves put the fist or foot in `h.head` (`h.body.limb` says which). `h.body.offset`, `lean` and `turn` are hints for moving the attacker (`dash` and `tackle` run across the gap), and each hit's `e.dir` is the knockback direction.
- **No magic:** use the `plain` element (metal sparks and dust only); any element takes `{ color: 0xrrggbb }`.
- **Warp:** hide the player on `'vanish'`, then `h.on('appear', (e) => player.position.copy(e.point))`. The point is on the ground 0.9–1.8 m in front of `to`, on the caster's side, so pass the enemy as `to`, not a spot beside it.
- **Heal:** the single `hit` has power 0; restore health in that handler.
- **Defeat:** for ordinary enemies, `fx.status(enemy, 'dissolve').on('full', () => scene.remove(enemy))` (about 1.6 s, no camera shake). For a boss, `fx.play(effect('finale', 'light'), { from: enemy.chest, to: enemy.chest })` (3 s, 6 hits with shake and hit-stop), then remove it on `'end'`; too heavy for every kill in a swarm.
- **Area around the caster (ice nova, war cry):** `fx.play(effect('nova', 'ice'), { from: hero.chest, to: spot })` where `spot` is any point about 1.2 m inside your gameplay radius; or pass `params: { radius: 5 }` and any `to`. The ring is always 360° around the caster's feet. The single `hit` comes about 0.8 s after the cast (`MOVES.nova.first`); apply the area damage to everyone within the radius in that handler.
- **Click on the ground:** a `Vector3` target at chest height (`y` ≈ 1); hits fire even when no one is there, so look up who is near `e.point`.
- **Top-down cameras** (as in the demo arena) work as they are.
- **Shots that miss:** with `feel: true` every hit shakes the camera and pauses the effects, even on empty ground. To pause only on real hits, create the system with `hitStopScale: 0` and call `fx.hitStop(e.hitStop)` in the `hit` handler when something was struck (the small shake stays).
- **Ids:** `effect('nova', 'ice')` has the id `ice-nova` (also with `params` or `color`); with a `seed` pass your own `id`, or simply pass the definition to `fx.play()`.
- **Cooldowns and mana** are the game's job; the library only draws.
- **Variety:** `effect('projectile', 'ice', { seed: 3 })` gives a different variation; `{ params: { count: 3 } }` overrides one value.

## React Three Fiber

Use `rollshade/react`: wrap the scene in `<FX effects={[...]} feel>`, get the system with `useFX()` (null until ready), and use `<Status target={ref} name="burn" />` and `<Loop name="torch" position={[x, y, z]} />`. The `<Canvas gl>` prop must create a `THREE.WebGPURenderer` from `three/webgpu` and `await renderer.init()`.

## Rules

1. Import three only from `three/webgpu` (and TSL from `three/tsl`; a hand-written import map must also map `three/addons/`). Importing `three` as well loads a second copy and breaks materials.
2. `await renderer.init()` before the first frame and `await fx.prewarm()` while loading.
3. Every frame: `fx.update(seconds)` then `fx.render()`. `fx.render()` also works with `post: false` (it then calls `renderer.render(scene, camera)` for you), so keep calling it unless the game has its own render pipeline.
4. Clamp the frame delta (for example to 0.05 s) so a stalled tab does not jump effects forward.
5. Only use the recipe and element names listed above. Unknown names throw an error that lists the valid ones.
6. `feel: true` adds hit-stop and camera shake. The shake is applied only inside `fx.render()` and undone right after, so camera controllers and follow cameras keep working. If you render yourself instead of `fx.render()`, there is no shake; use `e.shake` from the hit event if you want one.
7. `fx.clear()` on scene changes, `fx.dispose()` when the game shuts down.
8. On resize, only `renderer.setSize()` and the camera aspect; `FXSystem` follows the renderer size by itself.

This skill covers everything needed to write a game. The package README (`node_modules/rollshade/README.md`, the same text as https://rollshade.tsuyatt.com/llms-full.txt) adds the hit table per move, every option, React details and the list of exports.
