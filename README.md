# rollshade

Ready-made spell and attack effects for three.js (WebGPURenderer + TSL). Charge-up, travel, impact, hit events, bloom and camera shake, in one line per attack. Plus status effects on characters (burning, frozen, petrified, dissolving…) and effects you place in the world (torches, portals, save points…).

```js
fx.play(effect('meteor', 'fire'), { from: hero.hand, to: enemy });
```

[![Rollshade: a meteor, a frozen character, a portal and an iaido cut](https://rollshade.tsuyatt.com/og.png)](https://rollshade.tsuyatt.com/gallery/)

39 moves (14 magic, 13 blade, 8 fists and kicks, 4 support and event) × 11 elements, each with endless seeded variations, 11 status effects and 9 placeable loops. Browse, tune and export them at [rollshade.tsuyatt.com](https://rollshade.tsuyatt.com/), watch them all in the [gallery](https://rollshade.tsuyatt.com/gallery/), or play the [demo game](https://rollshade.tsuyatt.com/demo/) built with this package.

## Install

```sh
npm i rollshade three@0.186
```

Needs three r186. Each version of rollshade is tested against one three release, because three changes its TSL and WebGPU APIs often; the peer range follows when a new three release has been checked. It imports from `three/webgpu`, `three/tsl` and `three/addons/`; bundlers resolve these by themselves, a hand-written import map needs all three. With TypeScript, also `npm i -D @types/three`. Runs on WebGPU and falls back to WebGL2 automatically (the first `prewarm()` takes longer there).

## Quick start

```js
import * as THREE from 'three/webgpu';
import { FXSystem, effect } from 'rollshade';

const renderer = new THREE.WebGPURenderer({ antialias: true });
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
document.body.append(renderer.domElement);
await renderer.init();

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, innerWidth / innerHeight, 0.1, 200);
camera.position.set(0, 5, 12);
camera.lookAt(0, 1, 0);

const hero = new THREE.Object3D();
hero.position.set(-3, 1.2, 0);
const enemy = new THREE.Object3D();
enemy.position.set(3, 1.2, 0);
scene.add(hero, enemy);

const fx = new FXSystem({ scene, camera, renderer, post: true, feel: true });
fx.add(effect('meteor', 'fire'), effect('slash', 'thunder'), effect('heal', 'light'));
await fx.prewarm();

addEventListener('click', () => {
  const h = fx.play('fire-meteor', { from: hero, to: enemy });
  h.on('hit', (e) => console.log('damage', 10 * e.power));
});

const timer = new THREE.Timer();
renderer.setAnimationLoop((ms) => {
  timer.update(ms);
  fx.update(Math.min(timer.getDelta(), 0.05));
  fx.render();
});
```

## Moves

`effect(recipe, element)` gives the id `` `${element}-${recipe}` ``, for example `fire-meteor`. `from` and `to` take a `THREE.Vector3` or a `THREE.Object3D`. Both are read again every frame, so a moving object, or a vector you change in place (`v.copy(p)`), is followed (except that `explosion`, `pillar`, `meteor`, `summon`, `tornado` and `missiles` aim at where the target is when they are cast). Positions are in metres; characters are assumed to be about 1.8 m tall.

| recipe | kind | from | to | what happens |
|---|---|---|---|---|
| `projectile` | magic | caster's hand | target | Charge, a curved shot (1–3), impact and follow-up blasts |
| `lance` | magic | caster's hand | target | Fast straight spear that pierces and bursts behind the target |
| `beam` | magic | caster's hand | target | Sustained beam with ticking hits and a big final impact |
| `explosion` | magic | caster's hand | target | Light gathers on the target, then a blast with secondary explosions and a smoke column |
| `pillar` | magic | caster's hand | target | Warning circle under the target, then a pillar erupts from the ground |
| `meteor` | magic | caster's hand | target | Several meteors fall around the target; the last one hits hardest |
| `nova` | magic | caster's chest | target | Blast centred on the caster with an outward shockwave that reaches `to`; the hit lands there |
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

## Variations

```js
effect('meteor', 'fire', { seed: 'k3x9ab' });            // id: 'fire-meteor-k3x9ab'
effect('meteor', 'fire', { seed: 7, id: 'boss-rain' });  // your own id
effect('projectile', 'ice', { params: { count: 3 } });   // override one value
```

Overridden values are kept within a quarter of the smallest and four times the largest value the variations use (for example a projectile's `speed` of 0 becomes 2.25), so a typo cannot freeze or flood the game.

Each seed changes counts, sizes, timing, magic circles and a slight hue shift (with `color` the colours are yours exactly; the hue shift applies only if you pass `hue`). The simplest way to find one you like is the Motion mode on [rollshade.tsuyatt.com](https://rollshade.tsuyatt.com/): roll variations, tune the sliders, and copy the definition. A definition is plain data:

```js
{ id: 'fire-meteor-k3x9ab', recipe: 'meteor', element: 'fire', hue: 0.004, params: { count: 8, radius: 2.1 } }
```

## Handles and events

`fx.play()` returns a handle. Play as many as you like at the same time; they share one set of buffers and one post pass.

```js
const h = fx.play('ice-lance', { from: hand, to: enemy, power: 1, scale: 1, floorY: 0 }); // floorY: ground under this move, if not fx.floorY
h.on('cast', () => {});                  // charge starts
h.on('release', () => {});               // fired or swung
h.on('hit', (e) => enemy.damage(10 * e.power));
h.on('end', () => {});                   // the move is over (its last particles may still be fading)
await h.done;
h.stop();
```

A hit carries `point`, `power`, `index`, suggested `shake` and `hitStop` values, and a `role`: `'first'`, `'link'`, `'final'` or `'tick'` (beams and storms). Drive damage, sound and knockback from it.

- `power` is roughly 1 per hit: small ticks are lower, big finishing blows reach about 2.7. Heals send one hit with power 0.
- The number of hits depends on the move and its variation: a projectile hits 1–3 times, meteor and missiles many times, beams and storms tick. For a fixed damage per cast, apply it once when `e.index === 0` (every move's first hit has index 0; not every move has a `'final'` hit). `barrier`, `buff` and `warp` send no hit: use `'release'`, `'end'` or `'appear'` for them.
- `h.stop()` ends the move early and still fires `'end'`. It is safe to call from inside a handler.
- An error thrown by one of your handlers does not stop the effects; it is reported as an uncaught error.

## Hits per move

Measured on each move's default definition (no seed) with the target 6 m away for magic and 2 m for melee, without hit-stop. `MOVES` exports the same numbers for balancing in code, plus every hit's time, power and role in `timeline`:

```js
import { MOVES } from 'rollshade';
MOVES.combo.hits;      // 3
MOVES.combo.power;     // total power of those hits
MOVES.combo.timeline;  // [[seconds after fx.play(), power, role], …]
```

| recipe | hits | power | hit at (s) | per extra metre (s) | end (s) |
|---|---|---|---|---|---|
| `projectile` | 1 | 1.14 | 0.86 | +0.07 | 1.54 |
| `lance` | 1 | 1.01 | 0.47 | +0.04 | 0.98 |
| `beam` | 7 | 3.88 | 0.4 → 1.3 | — | 1.8 |
| `explosion` | 1 | 1.98 | 0.45 | — | 1.45 |
| `pillar` | 1 | 1.58 | 0.33 | — | 1.82 |
| `meteor` | 2–5 | 7.69 | 1.24 → 2.17 | — | 3.17 |
| `nova` | 1 | 1.37 | 0.81 | +0.02 | 1.54 |
| `barrier` | 0 | — | — | — | 2.91 |
| `shockwave` | 1 | 1.09 | 0.85 | +0.1 | 1.35 |
| `summon` | 1 | 2.22 | 1.36 | — | 1.97 |
| `missiles` | 16 | 4.3 | 1.75 → 2.66 | +0.03 → +0.05 | 3.17 |
| `tornado` | 8 | 6.08 | 1.11 → 3.03 | +0.04 → 0 | 3.63 |
| `storm` | 2–5 | 4.63 | 0.93 → 3.93 | — | 5.05 |
| `drill` | 12 | 9.27 | 0.92 → 1.76 | +0.09 | 2.27 |
| `finale` | 6 | 4.95 | 0.25 → 1.52 | — | 3.03 |
| `heal` | 1 | 0 | 0.62 | — | 2.93 |
| `buff` | 0 | — | — | — | 3.74 |
| `warp` | 0 | — | — | — | 0.89 |
| `slash` | 1 | 1.08 | 0.15 | — | 0.75 |
| `swipe` | 1 | 1.25 | 0.16 | — | 0.75 |
| `rising` | 1 | 1.18 | 0.18 | — | 0.73 |
| `cleave` | 2 | 3.24 | 0.4 → 0.57 | — | 1.07 |
| `combo` | 3 | 2.22 | 0.17 → 0.81 | — | 1.32 |
| `wave` | 1 | 1.28 | 0.25 | +0.06 | 0.75 |
| `dash` | 2 | 2.25 | 0.23 → 0.54 | +0.01 → 0 | 1.04 |
| `flurry` | 11 | 4.83 | 0.12 → 1.45 | — | 1.95 |
| `thrust` | 1 | 1.07 | 0.21 | — | 0.72 |
| `spin` | 1 | 0.89 | 0.27 | — | 0.91 |
| `cross` | 3 | 2.81 | 0.14 → 0.63 | — | 1.13 |
| `smash` | 3 | 3.11 | 0.48 → 0.57 | 0 → +0.07 | 0.98 |
| `iaido` | 2 | 2.88 | 0.52 → 0.9 | — | 1.4 |
| `strike` | 2 | 1.89 | 0.22 → 0.39 | — | 0.94 |
| `rush` | 7 | 3.09 | 0.2 → 0.74 | — | 1.32 |
| `uppercut` | 1 | 1.59 | 0.25 | — | 0.96 |
| `kick` | 1 | 1.41 | 0.26 | — | 0.9 |
| `heel` | 1 | 2.24 | 0.48 | — | 1.13 |
| `palm` | 2 | 2.98 | 0.22 → 0.32 | — | 0.99 |
| `tackle` | 1 | 1.92 | 0.37 | — | 1.02 |
| `pound` | 1 | 1.5 | 0.62 | +0.12 | 1.22 |

- `hit at` is the first and last hit in seconds after `fx.play()`. Moves that travel land later on a farther target: add `per extra metre` for each metre beyond 6 m (magic) or 2 m (melee). Two numbers are for the first and the last hit (`MOVES[recipe].perMetre` and `lastPerMetre`). They were measured between 4 and 8 m (melee: 2 and 4 m).
- `power` is the sum of `e.power` over the hits; `fx.play(…, { power })` multiplies it. `meteor` and `storm` place their strikes at random, so their count and power change from cast to cast (the table shows the range and a typical cast).
- Seeds and `params` change counts and timing (a `projectile` with `count: 3` hits three times). For your own definitions, the hit events are the exact source.
- With `feel: true`, or when you call `fx.hitStop()`, every hit pauses the effects for its `hitStop`, so later hits land that much later in real time.

## Status effects

Put a status on any mesh or character, including skinned and animated ones. The character keeps its textures; patterns stick to the surface while it animates, and the original materials come back when every status is gone.

```js
const frozen = fx.status(enemy, 'freeze', { duration: 1.2 });   // ice creeps up over 1.2 s
frozen.on('full', () => enemyMixer.timeScale = 0);             // fully frozen: stop the animation yourself
frozen.stop();                                                  // thaw: shards scatter

fx.status(enemy, 'burn', { lasts: 4 });                         // several statuses can stack; this one ends after 4 s
const shield = fx.status(player, 'shield');
enemyShot.on('hit', (e) => shield.impact(e.point));             // ripple where the shield is hit

fx.status(enemy, 'dissolve').on('full', () => scene.remove(enemy)); // death
fx.status(newEnemy, 'appear');                                  // spawn in; removes itself when done
```

| status | default element | what it looks like |
|---|---|---|
| `burn` | fire | Flames running up the body, charred glowing cracks, embers, smoke, flickering light |
| `freeze` | ice | Ice creeps up from the feet (follows `progress`), frosted shell and glitter; shatters when stopped |
| `shock` | thunder | Arcs crawling over the surface, bolts jumping across the body, sparks |
| `poison` | poison | Sickly blotches, oozing glow, bubbles, drips, miasma at the feet |
| `petrify` | earth | Stone creeps up from the feet (follows `progress`); crumbles into rocks and dust when stopped |
| `dissolve` | fire | Burns away from the head with a glowing edge; other statuses dissolve with it. `full` = gone |
| `appear` | arcane | Reverse dissolve from the feet up; ends by itself (`progress` is ignored) |
| `bless` | light | Golden rim, rising light, spiralling motes and crosses |
| `curse` | dark | Darkened body, pulsing purple rim, dark smoke, motes sucked in |
| `shield` | water | Hexagon bubble sized to the character; `impact(point)` ripples, shatters when stopped |
| `stun` | light | Stars circling the head |

- `progress` (0–1) drives how far freeze, petrify and dissolve have spread and how strong the others are. Set it directly (`s.progress = 0.5`) or animate it with `s.to(value, seconds)`.
- `lasts` is how long the status stays, in seconds from the start; then it fades out over `fade` seconds (default 0.4) and fires `end`, as if you had called `stop()`. Without `lasts`, statuses stay until you call `stop()` (only `appear` ends by itself). Set `s.lasts = 4` to restart the countdown, for example when the same attack burns the target again; reading `s.lasts` gives the seconds left (`Infinity` without a limit). It counts game time, so `fx.timeScale` and hit-stop slow it down.
- `duration` is how many seconds the status takes to reach `progress` when it starts (defaults: freeze 0.9, petrify 1.4, dissolve 1.6, appear 1.4, the others fade in within 0.6), not how long it lasts.
- `full` fires when `progress` reaches 1; `end` fires after `stop()` has faded it out. `fx.statusesOf(target)` lists a status until its fade-out has finished.
- `element` recolours any status (`{ element: 'dark' }` for black flames).
- The target must contain at least one mesh. When the target is removed from the scene, its statuses end by themselves. If you throw the character away for good, call `dispose()` on its objects or materials as usual in three.js so the renderer lets go of it.
- The first status on a model compiles a shader. Call `await fx.prewarmStatus(enemyModel)` once while loading to avoid a stutter (important on WebGL2). The model does not have to be in the scene or visible yet: `prewarmStatus` adds it for the moment it needs and puts it back. Once per kind of model is enough: status materials are shared by every character that uses the same source material, and each character's own values (how frozen, how burnt) are read per object at draw time. `SkeletonUtils.clone` shares materials; if you recolour clones, share one recoloured material per colour instead of cloning it per character.
- Each character gets one swapped material shared by all its statuses; after `prewarmStatus`, adding, stacking and removing statuses compiles nothing new, even on other characters that use the same model.

## Loops

Effects you place in the world and leave running.

```js
const torch = fx.loop('torch', new THREE.Vector3(2, 0, -3));
fx.loop('campfire', camp.position, { element: 'arcane' });  // pink magic fire
fx.loop('portal', gate.position, { rotation: Math.PI / 2 }); // facing +X
fx.loop('aura', hero);                                       // follows an Object3D
fx.loop('candles', table, { prop: false });                  // effect only, on your own model
const dome = fx.loop('barrier', base.position);
dome.impact(hitPoint);                                       // ripple
torch.intensity = 0.3;                                       // dim it
torch.stop();                                                // fade out and remove
```

| loop | default element | what it is |
|---|---|---|
| `torch` | fire | Torch with a flame, embers and a thin smoke trail |
| `campfire` | fire | Logs, stones and glowing coals with a big flame, popping embers and a smoke column |
| `candles` | fire | Three-candle candelabra with small flames |
| `portal` | arcane | Upright oval gate with a swirling vortex; motes are pulled in. Faces +Z, turn it with `rotation` |
| `sigil` | arcane | Two counter-rotating magic circles on the ground with a faint light column and rising runes |
| `savepoint` | light | Floating, spinning crystal over a pedestal with a light column |
| `barrier` | light | 2.4 m hexagon dome over a magic circle; `impact(point)` ripples, shatters when stopped |
| `aura` | fire | Flaming aura sized to the Object3D you pass as `at`; follows it. Bright at the outline and thin in front, so the character stays visible |
| `beacon` | light | 14 m pillar of light visible from far away, for quest markers |

- `at` is a `Vector3` or an `Object3D` to follow; both are read every frame, so changing the vector in place moves the loop. Positions are the ground point under the effect.
- The ground of a loop is the height you place it at, so a torch on a balcony or in a cellar behaves like one on the floor; `floorY` overrides it.
- `prop: false` removes the simple low-poly stands (torch stick, logs, candelabra, portal frame, pedestal) so you can put the effect on your own model.
- Loops share a fixed pool of point lights (`loopLights`, default 4). Changing the number of lights in three.js recompiles every material, so the pool never grows; loops beyond it glow but do not light their surroundings. `light: false` opts a loop out.
- `fx.prewarm()` already compiles every loop.

## React Three Fiber

```jsx
import { Canvas, extend } from '@react-three/fiber';
import * as THREE from 'three/webgpu';
import { effect } from 'rollshade';
import { FX, useFX, Status, Loop } from 'rollshade/react';

extend(THREE);
const effects = [effect('meteor', 'fire')];

<Canvas gl={async (props) => { const r = new THREE.WebGPURenderer(props); await r.init(); return r; }}>
  <FX effects={effects} feel>
    <mesh ref={enemy}>…</mesh>
    <Status target={enemy} name="burn" active={burning} />
    <Loop name="torch" position={[2, 0, -3]} element="ice" />
    <Caster />
  </FX>
</Canvas>

function Caster() {
  const fx = useFX(); // null until prewarm has finished
  // fx?.play('fire-meteor', { from: hand, to: enemy.current }).on('hit', …)
}
```

- `<FX>` creates the `FXSystem` from R3F's renderer, scene and camera, updates it every frame and, with `post` (default on), takes over rendering to add bloom and camera shake. Pass `post={false}` to keep R3F's own rendering or your postprocessing.
- `<Status>` and `<Loop>` start when mounted (and `active`), stop when unmounted. `<Status progress={x}>` animates the progress; `<Loop position>` moves the loop; `<Loop target={ref}>` follows an object.
- Needs React Three Fiber 9+ (React 19) with a `WebGPURenderer` passed to `gl` as above. In TypeScript write `extend(THREE as any)` and `new THREE.WebGPURenderer(props as any)`: R3F's types do not cover `three/webgpu` yet. In Next.js, put the canvas in a `'use client'` component loaded with `ssr: false`.

## Options

```js
new FXSystem({
  scene, camera, renderer,
  post: true,            // bloom + distortion; call fx.render() instead of renderer.render() (off by default)
                         // { bloom: 'scene' } blooms everything bright on screen, not only the effects
  feel: true,            // camera shake, hit-stop and chromatic aberration on hits (off by default)
  hitStopScale: 1,       // 0.5 halves the automatic hit-stop, 0 turns it off (then call fx.hitStop(e.hitStop) yourself)
  floorY: 0,             // height of the flat ground: debris, decals, dust and ground effects land on it
  quality: 'auto',       // 'high' (default) | 'medium' | 'low' | 'auto': auto lowers particles and render resolution while frames run slow
  loopLights: 4,         // point lights shared by placed loops
  photosensitive: false, // tone down screen flashes
});
```

- Heavy scenes: `fx.setQuality('low')` renders the scene at 55% resolution with fewer particles (`'medium'`: 75%), or set `fx.renderScale` (0.25–1) directly; `'auto'` does this only while frames run over budget and raises it again. Render scale works with `post: true`.
- High-DPI screens: with `post: true` the scene pass multisamples like your renderer. `new WebGPURenderer({ antialias: devicePixelRatio < 1.5 })` skips MSAA where the extra pixels already hide jagged edges, which saves about 48 bytes of GPU memory per pixel (about 250 MB on a 2880×1800 canvas) and some GPU time.
- Bloom touches only what rollshade draws: moves, loops, status shells and the glow of statuses on characters. Your models, floor and sky keep their brightness, however bright they are. `post: { bloom: 'scene' }` blooms the whole picture instead (the behaviour before 0.3.0); `strength`, `radius` and `threshold` tune it in both modes.
- Your own glowing parts (crystals, rings, glowing edges): `fx.glow(object)` adds the object and its children to the effects bloom, `fx.glow(object, false)` takes it out. Their whole colour goes into the bloom, so mark the bright, emissive or unlit parts rather than a whole lit model.
- `'auto'` quality waits 2 seconds after start and after `prewarm()` before it judges, ignores single long frames (shader compiles, a tab switch), and lowers only after frames stay over budget for a second.
- Have your own post processing? Pass `post: false` and render as usual; you lose the built-in bloom and camera shake, and can use `e.shake` from hit events instead.
- `fx.timeScale` for slow motion, `fx.shake(amount)` and `fx.hitStop(seconds)` to trigger them yourself. To freeze only when something is actually hit, set `hitStopScale: 0` and call `fx.hitStop(e.hitStop)` from your `hit` handler when the hit lands on a target.
- `fx.clear()` stops everything; `fx.dispose()` frees GPU resources. Create one `FXSystem` per scene and keep it: re-creating it is expensive. To switch cameras, set `fx.camera = otherCamera`; perspective and orthographic cameras both work.
- `maxScreenSize` (default 0.5) caps how much of the screen one particle may cover, `minParticleSize` keeps distant particles from vanishing.
- The package makes no network requests, stores nothing and has no install scripts.

## Rules that avoid most bugs

These are the mistakes AI assistants and people make most often:

1. Import three from `three/webgpu`, never from `three`, and TSL from `three/tsl`. Two copies of three in one page break node materials.
2. `await renderer.init()` before the first frame.
3. Call `fx.update(seconds)` and then `fx.render()` every frame (clamp the delta, for example to 0.05 s). `fx.render()` also works with `post: false`; it applies the camera shake only for that render and puts the camera back.
4. `fx.add()` a definition before calling `fx.play(id)` by its id, or pass the definition itself: `fx.play(effect('nova', 'ice'), { from, to })`. Passing it is simpler when definitions come and go (per enemy, per placed object): nothing piles up. `fx.has(id)` and `fx.remove(id)` manage the added ones.
5. Call `await fx.prewarm()` once while loading, otherwise the first cast of each move stutters. For a loading bar, pass a callback that gets 0–1: `fx.prewarm({}, (p) => (progress.value = p))`.
6. Use a `WebGPURenderer`. The classic `WebGLRenderer` cannot run TSL; `WebGPURenderer` falls back to WebGL2 on its own.

## For AI coding assistants

The package ships an agent skill at `skills/rollshade/SKILL.md`. Install it for Claude Code, Cursor, Codex and other agents with:

```sh
npx skills add ./node_modules/rollshade/skills/rollshade
```

or copy the folder into `.claude/skills/`. A compact reference for LLMs is at [rollshade.tsuyatt.com/llms.txt](https://rollshade.tsuyatt.com/llms.txt).

## Source and issues

The source is at [github.com/tsuyatt/rollshade](https://github.com/tsuyatt/rollshade). Bug reports and questions are welcome as [issues](https://github.com/tsuyatt/rollshade/issues). rollshade is an independent project, not affiliated with or endorsed by three.js or the other tools named here.

## License

MIT © 2026 tsuyatt. Includes `psrdnoise3` and `permute4` ported from [psrdnoise](https://github.com/stegu/psrdnoise) (MIT, Stefan Gustavson and Ian McEwan); see LICENSE. Effects you export from the site are CC0.
