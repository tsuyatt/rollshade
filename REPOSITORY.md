# rollshade

Source of the [`rollshade`](https://www.npmjs.com/package/rollshade) npm package: ready-made spell, status and placed effects for three.js (WebGPURenderer + TSL). See [README.md](README.md) for how to use it, and [rollshade.tsuyatt.com](https://rollshade.tsuyatt.com/) to browse and tune effects.

## This repository

- `src/runtime/` is the runtime (`FXSystem`, moves, status effects, loops, particles, post processing). `src/core/` holds the seeded variation it uses. `src/react/` is the `rollshade/react` entry.
- `dist/` is what npm ships, built from the sources above.
- The sources are copied from the private repository that also holds the Rollshade site, so the history here is a series of release snapshots.

## Issues and pull requests

Bug reports and ideas are welcome as issues. Pull requests are not merged, because the code is maintained in the private repository; please describe the fix in an issue instead. Code you post in an issue is treated as offered under the MIT License.

## Security

Please report security problems privately with GitHub's "Report a vulnerability" button on the Security tab (or a DM to [@tsuyatsuyatt](https://x.com/tsuyatsuyatt) on X), not in a public issue.

## License

MIT © 2026 tsuyatt. See [LICENSE](LICENSE).
