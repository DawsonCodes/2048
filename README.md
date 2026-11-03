# 2048 Remix

**Dawson’s first GitHub repository. Still just for fun.**

This repo started in November 2024 as a tiny 2048 experiment—the first repo on the DawsonCodes account. It’s now a modern little browser game with a few new twists. A place to play around, learn things, and say “one more try” a few too many times.

[**Play 2048 Remix →**](https://dawsoncodes.github.io/2048/)

![2048 Remix in Gray Dark, during a real game](docs/preview.jpg)

## Three ways to play

| Mode | The idea |
| --- | --- |
| **Classic** | The familiar 4×4 board. Merge your way to 2048, then keep going if you want. |
| **Daily** | A 4×4 challenge seeded by the UTC date. Everyone starts with the same board and random sequence. Restarting replays that day’s seed. |
| **Zen** | A roomy 5×5 board. Reach 2048 and carry straight on. |

Daily is a casual challenge with hints and undo, not a ranked competition. Different moves can lead to different boards even with the same seed.

## The good stuff

- Smooth tile slides, merge pops, milestone progress, and a little celebration at 2048.
- Up to **32 moves of undo**, including after reloading.
- A local, look-ahead hint when you need a nudge.
- Keyboard, swipe, and on-screen controls.
- Separate saved runs and personal bests for each mode.
- Optional synthesized merge sounds, off by default.
- **Gray Dark, Light, and MS Paint**, adapted from [AppWatch](https://github.com/DawsonCodes/AppWatch)’s theme system and picker.
- A circular theme reveal, a less-motion option, and support for the system’s reduced-motion preference.
- A responsive layout, keyboard-accessible menus, screen-reader board labels, and clear focus states.

Theme, sound, and progress use their own `2048-remix:` storage keys. They do not change AppWatch’s preferences or files. On your first visit, the theme follows your system’s light/dark preference; MS Paint is always an explicit choice.

## Controls

| Action | Controls |
| --- | --- |
| Move | Arrow keys, WASD, swipe, or direction buttons |
| Undo | **U** |
| Hint | **H** |
| New game | **R** (asks before replacing a run you’ve started) |
| How to play | **?** or the help button |

Matching tiles merge once per move. Only a move that changes the board adds a new tile. The score increases by the value of each merged tile.

## Run it

Open `index.html` in a modern browser, or serve the repository with any static server. There’s no build step and nothing to install for the game.

For example, with Python installed:

```sh
python3 -m http.server 8000
```

Then open `http://localhost:8000`.

With Node.js installed, run the checks without installing packages:

```sh
npm test
npm run check
```

The tests cover merging in all directions, scoring, invalid moves, win/loss states, seeded replay, saved-state validation, hints, and randomized board invariants.

## Repo layout

| File | Purpose |
| --- | --- |
| `index.html` | The page, accessible controls, menus, and dialogs |
| `engine.js` | Pure game rules, seeded randomness, save validation, and hints |
| `script.js` | Browser input, animation, audio, storage, and UI |
| `themes.css` | AppWatch’s theme tokens |
| `theme-init.js` | Applies the saved theme before the page paints |
| `styles.css` | Responsive layout, tile colors, and motion |
| `tests/engine.test.cjs` | Dependency-free engine tests |
| `THIRD_PARTY_NOTICES.md` | Theme attribution and its original license |

## Hosting & privacy

The game stays at **[dawsoncodes.github.io/2048/](https://dawsoncodes.github.io/2048/)** using the existing GitHub Pages setup. The repo name stays `2048`; **2048 Remix** is the game’s display name.

The game runs entirely in the browser. No account, backend, analytics, API keys, external fonts, or CDN scripts. The game itself makes no network requests after its own static assets load. GitHub Pages still serves those assets under its normal hosting policies.

Your saves stay in this browser. Clearing site data clears them; blocked or full storage falls back to in-memory play. Scores do not sync between devices. Daily changes at midnight UTC, and the latest Daily run replaces the previous date’s saved Daily. Your personal best is retained for each mode.

## A little credit

The original [2048](https://github.com/gabrielecirulli/2048) was created by Gabriele Cirulli. This is an independent implementation of the game, with theme tokens and picker behavior adapted from Dawson’s AppWatch. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) for the AppWatch notice.

Made for fun. The original commits are still in the Git history.
