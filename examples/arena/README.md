# Rollshade Arena

The source of the [Rollshade Arena](https://rollshade.tsuyatt.com/demo/) demo: a small arena game with a mage, a swordsman and a brawler, built on [rollshade](https://www.npmjs.com/package/rollshade) and three.js WebGPU.

```sh
npx degit tsuyatt/rollshade/examples/arena my-arena
cd my-arena
npm install
npm run dev
```

Everything is in `main.ts`. Each move is one `fx.play()` call; press C in the game to see the code for the move you just used. For a shorter start, see [`examples/starter`](../starter).

The code in this folder is CC0: copy it into your own project without credit. The models in `public/models/` were made with [Rollpoly](https://rollpoly.tsuyatt.com/) and are CC0 1.0 as well; `public/models/NOTICE.txt` lists the URL that recreates each one.
