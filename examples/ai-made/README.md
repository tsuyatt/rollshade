# AI-made game

A small game that an AI wrote from the rollshade docs alone. Play it at [rollshade.tsuyatt.com/demo/ai/](https://rollshade.tsuyatt.com/demo/ai/).

Claude Sonnet, with no prior knowledge of rollshade, got the request below and only the files inside `node_modules/rollshade` (README.md, index.d.ts and skills/rollshade/SKILL.md). It had no web access and no human edited the result. `tsc --noEmit` and `vite build` passed on the first try. `main.ts` is exactly what it wrote.

> Make me a tiny top-down three.js game: I move a capsule with WASD on a floor, enemies (simple capsules) walk toward me. Left click shoots a fire spell at the mouse position. Pressing 1 casts an ice nova around me that freezes nearby enemies for 3 seconds. Pressing 2 does a sword slash at the nearest enemy that knocks it back. Enemies spawn with an effect, die after a few hits with a nice effect. There should be torches at the corners of the floor. Use the rollshade package for all the effects, bloom and hit feedback.

To ask your own AI for something similar, point it at `node_modules/rollshade/skills/rollshade/SKILL.md` or at https://rollshade.tsuyatt.com/llms-full.txt.

```sh
npx degit tsuyatt/rollshade/examples/ai-made my-game
cd my-game
npm install
npm run dev
```

The code in this folder is CC0: copy it without credit.
