# Tiny Island Explorer

A small third-person exploration game: walk, run and jump across a stylised island and climb the hill to the old lighthouse. Built with Three.js, Rapier physics, Vite and TypeScript. Everything is procedural; no external assets or network calls at runtime.

**Play online:** https://patspang.github.io/Tiny-Island-Explorer/ (published automatically from `main`).

## Run it locally

Requires Node.js 20.19+ or 22.12+.

```bash
npm install
npm run dev
```

Open the URL Vite prints (usually http://localhost:5173) and press **Play**.

| Control | Action |
| --- | --- |
| W A S D / arrow keys | Move (relative to the camera) |
| Shift | Run |
| Space | Jump |
| Drag mouse | Orbit the camera |
| Mouse wheel | Zoom |
| R | Return to the beach |
| Esc / P | Pause |

## Checks

```bash
npx tsc --noEmit     # type check
npm run build        # production build (also type checks)
npm run test:e2e     # browser tests (Playwright, Chromium)
```

Browser tests run against the production build with `?debug`, which exposes `window.__game` for inspecting player and camera state.

## Debug URLs

- `/?sandbox` — flat movement test level with known ramps (25° / 58°), steps (0.25 m / 0.9 m), a wall and a pillar.
- `/?debug` — exposes `window.__game` in production builds (always on in `npm run dev`).

## Layout

```
src/
  config.ts              all tunable values (speeds, jump, camera, world size, lighting)
  game/                  Game loop (fixed timestep), input, debug handle
  physics/               Rapier world wrapper and collision groups
  player/                PlayerController (physics) and PlayerVisual (model + animation)
  camera/                FollowCamera (orbit, zoom, collision)
  world/                 IslandShape (height function), Terrain, Ocean, Lighthouse,
                         Environment (vegetation/rocks), props, Atmosphere, Sandbox
  ui/                    Start screen, pause menu, hint
e2e/                     Playwright tests
```
