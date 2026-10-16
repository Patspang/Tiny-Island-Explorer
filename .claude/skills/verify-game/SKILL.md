---
name: verify-game
description: Run the Tiny Island Explorer verification pass — type check, production build, and browser checks of movement, jumping, grounding, collision, camera, and respawn where automation exists — then report passed, failed, and untested items. Use after meaningful changes or before declaring a feature done.
---

# /verify-game

Goal: an honest account of what is verified, not a green checkmark. A successful build is never proof of correct gameplay.

## 1. Inspect

- Read `package.json` scripts and devDependencies. Note which of `tsc`, `build`, and e2e/browser test scripts exist.
- Check whether the dev debug handle (`window.__game` or equivalent, see `CLAUDE.md`) exists and what it exposes.
- If the project isn't scaffolded yet, say so and stop.

## 2. Static checks

Run and record exit status plus the first relevant errors:

```bash
npx tsc --noEmit
npm run build
```

If either fails, report it and stop — don't continue to runtime checks on a broken build.

## 3. Runtime checks (only with real tooling)

Browser automation is available only if the project has Playwright (or similar) installed **or** you can drive the preinstalled Chromium in this environment (cloud sessions: Playwright is preconfigured via `PLAYWRIGHT_BROWSERS_PATH=/opt/pw-browsers`; never run `playwright install`). Check before claiming either.

If available:

1. Start the app (`npm run dev` or `npm run preview` after build) in the background and wait for the port.
2. Load the page; capture console errors and a screenshot after the scene settles. WebGL in headless Chromium may need `--use-gl=swiftshader` / `--use-angle=swiftshader`.
3. Using the debug handle, assert rather than eyeball:
   - **Spawn/grounding:** player settles on terrain within ~2 s; grounded = true; vertical velocity ≈ 0; no drift over a few seconds.
   - **Movement:** holding forward for 1 s changes position in the camera-forward direction.
   - **Jump:** one jump press raises the player then returns to grounded; holding/spamming doesn't produce extra height in air.
   - **Collision:** walking into a known obstacle stops horizontal progress; player Y never goes below terrain height at its XZ.
   - **Slopes:** on a slope beyond the climb limit the player doesn't ascend.
   - **Recovery:** teleporting below the world triggers respawn.
   - **Camera:** camera stays above terrain height at its XZ and within distance limits while moving.
4. Stop the server when done.

Run only the checks the debug handle actually supports. For each one that can't be run, list it under "untested".

If no browser automation is available, skip to the report and list every runtime behaviour as requiring manual testing.

## 4. Report

```
Type check:   PASS/FAIL
Build:        PASS/FAIL
Browser:      ran / not available (why)

Passed (evidence):   ...
Failed (repro):      ...
Untested (manual):   ...
Defects/risks:       ...
```

Label evidence as static review, build check, or automated browser. Do not fix failures inside this skill unless the user asked; report them.
