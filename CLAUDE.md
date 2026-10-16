# Tiny Island Explorer

A third-person exploration game set on a small stylized island. This is a game, not a tech demo: it is judged by how it feels to walk, jump, and look around, and by whether the island looks art-directed.

**Visual target:** premium animated-film look — readable silhouettes, warm directional light, saturated-but-controlled palette, soft shadows, deliberate composition. Not "default Three.js scene with noise terrain".

## Scope

**Stage 1 (done):** one island; capsule player (walk/run/jump, slopes, collision); third-person camera; fall recovery.

**Stage 2 (current): lighthouse quest.** Five lens pieces (`QUEST_SPOTS` in `IslandShape.ts`, one on a ruin that needs a jump) → HUD counter → reach the lighthouse → lamp relights and the scene blends to dusk → finale screen. Logic in `src/quest/Quest.ts` (runs in the fixed step), presentation in `Lighthouse.setLight`, `Atmosphere.setDusk`, `Ocean.setDusk`, `ui/Overlays.ts`.

Not yet: saving progress, sound, animated (rigged) character, inventory, NPCs, multiple islands. If a request implies one of these, say so and ask.

## Stack

Three.js (rendering) · Rapier (`@dimforge/rapier3d-compat`, physics) · Vite (dev/build) · TypeScript (strict).

## Commands

- `npm run dev` — Vite dev server (debug handle always on)
- `npx tsc --noEmit` — type check
- `npm run build` — type check + production build
- `npm run test:e2e` — Playwright tests against the production build (~10 min with software WebGL). In cloud sessions prefix with `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`.

Debug: `?sandbox` loads the flat movement test level; `?debug` exposes `window.__game` (snapshot, teleport, setCameraYaw, viewFrom, physicsGround, obstacles, route, sceneStats) in production builds.

Known Rapier pitfalls (verified with @dimforge/rapier3d-compat 0.21): never push the capsule down while grounded (it sinks into boxes and stalls on trimeshes — rely on snap-to-ground), and never spawn/teleport the capsule within the skin offset of a surface (it slips through). See `PlayerController`.

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

## Git, CI, and deployment

The owner is not a developer. Claude owns branching, commits, PRs, CI, and deploys; explain outcomes in plain language, not git jargon.

- `main` is always playable and is what gets deployed. Never commit directly to `main`.
- Work happens on a short-lived branch (the session's `claude/*` branch), one coherent change per PR into `main`.
- Commits: small, each leaves the game building. Message style: `feat: ...`, `fix: ...`, `chore: ...`, `docs: ...` — imperative, says what and why.
- PRs: plain-language summary of what changed for the player, plus what was verified and how (per the honesty rules above).
- Merge only when CI (`Type check & build`) is green. Use squash merge. Delete the branch after.
- After merge, `deploy.yml` publishes `main` to GitHub Pages. A bad deploy is fixed by reverting the PR, not by hotfixing on `main`.
- Vite must use `base: './'` so the build works under the Pages sub-path.
- Tag milestones (e.g. `stage-1`) once verified.

## Specialists

- `gameplay-physics` agent — movement/collision/physics diagnosis.
- `world-builder` agent — terrain, materials, lighting, composition.
- `playtest-reviewer` agent — independent QA; reports defects, does not fix.
- `/verify-game` — repeatable check run. `/polish-island` — scoped visual pass.

The main session owns integration. Specialists diagnose and propose, or make bounded changes in their area; they do not rewrite each other's systems.
