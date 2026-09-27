# Smoke rebuild

This branch is the Three.js armillary rebuild of Cymatic Cosmos. `main` is unchanged. The original single-file instrument is still here as `index.html`.

The running app is a Vite + TanStack Start project: a GPU Navier-Stokes dye field with the twelve original voices drawn as orbits.

```bash
npm install
npm run dev
```

Open the printed local URL. The smoke drifts on its own. The orbs stay still until you press Play.

## Flat smoke pass (Claude)

Branched from `rebuild/smoke-cosmos`. What changed and why:

- **The orbits are flat in the smoke plane again.** The tilted 3D armillary scrambled the six curves and put the orbs in a different space from the fluid they stir. The score is drawn exactly as the original, turned upright on tall phones.
- **The orbs are the dye sources.** Each voice leaves a thin comet of its own color (small gaussian, sub-stepped along the path) instead of a screen-wide blob every frame. That blob was the white wash.
- **Dye can't wash white.** Splats saturate as a cell fills, dye is capped, and the display tone map keeps hue as smoke thickens.
- **No per-frame vortices.** The background current is a divergence-free stream function that speeds with tempo, so nothing fights the pressure solve. The checkerboard mode behind the cellular tear is damped each step. Velocity is clamped at 150 texels/s, which is safe now.
- **Every note is cymatic.** Crossing the center presses a Chladni plate figure for that note into the smoke (the current carries it off) and flashes it briefly at the gate, with a ring and the note name.
- **Original polyrhythm restored.** All voices share one playhead measured in beats, so they converge on the downbeat and tempo changes are smooth. The crossing test is unchanged in spirit (segment closest-point, re-arm at 96px).
- **Stir brush reaches about two inches**, ink follows distance dragged, and a **Fade** slider sets how fast smoke disappears (default is noticeably quick).
- **Voice:** autocorrelation pitch, the sung note drawn as a live plate at the gate; Prayer answers a held pitch with root, fifth, octave.
- The controls moved to a bottom dock so the field has the screen.

## Publishing

`npm run build:standalone` compiles the instrument into one self-contained
`dist-standalone/index.html` (no server needed). That file is copied to the
root `index.html` on `main`, which is what GitHub Pages serves. The original
2D instrument lives on at `classic/index.html`.
