---
name: polish-island
description: Scoped visual polish pass on the Tiny Island Explorer scene — review silhouette, terrain, lighting, palette, water, vegetation, landmarks, and camera framing, propose a short prioritized list, then make small improvements without touching physics or gameplay. Use when the island looks generic or unbalanced.
disable-model-invocation: true
---

# /polish-island

Goal: make the island read as an art-directed animated-film set, through a few small coherent changes — not a rewrite.

## 1. Inspect

- Read the terrain generation, materials, lighting/sky, water, vegetation scatter, and camera setup code.
- Note where terrain height data feeds the collider; that path must keep matching the render mesh.

## 2. Capture the "before"

If browser automation is available (see `/verify-game` step 3), start the app and capture screenshots from 3–4 fixed viewpoints: spawn view, a wide establishing shot of the whole island, a shoreline view, and the main landmark. Use fixed camera positions via the debug handle so after-shots are comparable. Save them to a scratch directory, not the repo.

If screenshots aren't possible, say so — the review will be code-based and visual results unverified.

## 3. Review

Judge against the art direction in `CLAUDE.md`:

- **Silhouette:** does the island have a memorable shape from the wide shot, or is it a noise blob?
- **Terrain:** varied elevation, readable plateaus/paths/cliffs, natural beach falloff?
- **Lighting:** clear key direction, warm/cool contrast, shadows that define form, sane tone mapping and color space?
- **Palette:** cohesive and controlled, value separation between sand/grass/rock/water?
- **Water:** reads as water, clean shoreline transition?
- **Vegetation/rocks:** clustered with intent and negative space, not uniform scatter; scale variation?
- **Landmark & framing:** is there a focal point visible from spawn; does the default camera compose it well?

## 4. Propose

Write a prioritized list of at most five improvements, each with expected impact and any physics/performance risk. Pick the top two or three to do now.

## 5. Implement

- Small changes, one area at a time.
- Don't change collider generation, player/camera controllers, or input. If a terrain shape change is needed, update render and collider from the same data and note it.
- No new dependencies or systems.
- Keep instanced props instanced; note draw-call impact.

## 6. Verify

- `npx tsc --noEmit` and `npm run build`.
- Re-capture the same viewpoints and compare before/after.
- Confirm the player still spawns grounded and landmarks/routes are still reachable (via `/verify-game` checks if available; otherwise flag as needing manual play).
- Report: changes made, before/after (or "unverified visually"), and any risks.
