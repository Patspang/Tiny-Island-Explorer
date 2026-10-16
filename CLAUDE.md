# Tiny Island Explorer

A third-person exploration game set on a small stylized island. This is a game, not a tech demo: it is judged by how it feels to walk, jump, and look around, and by whether the island looks art-directed.

**Visual target:** premium animated-film look — readable silhouettes, warm directional light, saturated-but-controlled palette, soft shadows, deliberate composition. Not "default Three.js scene with noise terrain".

## Stage 1 scope (current)

1. One island: terrain, coastline, water, a few landmarks, sparse deliberate vegetation.
2. Player capsule with walk/run, jump, gravity, grounding, slope limits, terrain + obstacle collision.
3. Third-person follow camera with smoothing and no terrain clipping; camera-relative movement.
4. Fall/out-of-bounds recovery (respawn).

Nothing else. No inventory, NPCs, quests, audio systems, save games, or multiplayer until Stage 1 is stable and verified. If a request implies a new system, say so and ask.

## Stack

Three.js (rendering) · Rapier (`@dimforge/rapier3d-compat`, physics) · Vite (dev/build) · TypeScript (strict).

## Commands

The project is not scaffolded yet. Once it is, these are the expected scripts — update this section if they differ:

- `npm run dev` — Vite dev server
- `npx tsc --noEmit` — type check
- `npm run build` — production build
- `npm run test:e2e` — browser tests (if/when added)

## Architecture rules

- Keep **physics**, **rendering**, and **input** separate. Gameplay state lives in physics/game code; Three.js objects read from it, never the other way round.
- Physics runs on a **fixed timestep** with an accumulator; rendering interpolates. Never step Rapier with raw frame delta.
- Render meshes and collider geometry for terrain must come from the **same height data**. Any terrain change must update both.
- In dev builds, expose a small read-only debug handle (e.g. `window.__game` with player position, velocity, grounded flag, camera position, and a way to inject input). Browser tests depend on this; screenshots alone cannot verify collision.
- No new dependencies without a stated, concrete benefit.

## Gameplay quality bar

- Movement, collision, and camera quality outrank new features and new visuals.
- Player must not tunnel through terrain, stick to walls, jitter when grounded, slide on walkable slopes, or double-jump by accident.
- Camera must not clip into terrain, snap, or make movement direction ambiguous.
- Target 60 fps on a mid-range laptop. Instance repeated props; watch draw calls and shadow cost.

## Working rules

- Read the relevant existing code before changing it. Make small, incremental changes that keep the game runnable.
- Run the type check and build after meaningful changes.
- **Never claim something works without testing it.** Report what was verified and how: static review, type check/build, automated browser test, or actual play. A passing build is not gameplay verification.
- Fix root causes. Do not tune constants at random to make a symptom disappear.

## Specialists

- `gameplay-physics` agent — movement/collision/physics diagnosis.
- `world-builder` agent — terrain, materials, lighting, composition.
- `playtest-reviewer` agent — independent QA; reports defects, does not fix.
- `/verify-game` — repeatable check run. `/polish-island` — scoped visual pass.

The main session owns integration. Specialists diagnose and propose, or make bounded changes in their area; they do not rewrite each other's systems.
