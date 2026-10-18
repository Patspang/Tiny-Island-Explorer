import { expect, test, type Page } from '@playwright/test';
import { collectErrors, horizontal, sampleSim, snapshot, startGame, teleport, waitSim, type Snapshot } from './helpers';

// Milestone B/D: behaviour on the real island. Most tests drive the player with real keyboard
// input; the long route walk uses the deterministic simulate hook (same physics and controller)
// so it doesn't depend on how fast software WebGL renders. Positions are checked against the
// physics world via the debug handle.

/** Steer along waypoints: aim the camera at the next one and run forward in short slices. */
async function followRoute(page: Page, points: Array<{ x: number; z: number }>, maxSimSeconds: number) {
  const samples: Snapshot[] = [];
  const start = (await snapshot(page)).simTime;
  let i = 0;
  while (i < points.length) {
    const s = await snapshot(page);
    samples.push(s);
    if (s.simTime - start > maxSimSeconds) break;
    const p = points[i];
    if (horizontal(s.feet, p) < 2.2) {
      i++;
      continue;
    }
    // Camera yaw whose forward vector (-sin, -cos) points at the waypoint.
    const yaw = Math.atan2(-(p.x - s.feet.x), -(p.z - s.feet.z));
    await page.evaluate((y) => {
      window.__game!.setCameraYaw(y, 0.3);
      window.__game!.simulate(0.2, { y: 1, run: true });
    }, yaw);
    // Let a frame render so the follow camera (checked below) keeps up.
    await page.waitForTimeout(20);
  }
  return { samples, reached: i >= points.length };
}

test.describe('island', () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = collectErrors(page);
    await startGame(page);
  });

  test.afterEach(() => {
    expect(errors, 'console errors/warnings').toEqual([]);
  });

  test('spawns standing on the beach', async ({ page }) => {
    await waitSim(page, 1);
    const s = await snapshot(page);
    const ground = await page.evaluate(([x, z]) => window.__game!.physicsGround(x, z), [s.feet.x, s.feet.z]);
    expect(s.grounded).toBe(true);
    expect(ground).not.toBeNull();
    expect(Math.abs(s.feet.y - ground!)).toBeLessThan(0.08);
    expect(s.feet.y).toBeGreaterThan(0.5); // above the waterline
  });

  test('walks the path from the beach to the lighthouse without sinking', async ({ page }) => {
    const route = await page.evaluate(() => window.__game!.route());
    const target = route.at(-1)!;
    const { samples, reached } = await followRoute(page, route, 60);
    expect(reached).toBe(true);

    const end = samples.at(-1)!;
    expect(horizontal(end.feet, target)).toBeLessThan(3);
    expect(end.feet.y).toBeGreaterThan(12); // up on the lighthouse hill

    // Never below the physics ground, and never with the camera under the terrain.
    for (const s of samples.filter((_, i) => i % 3 === 0)) {
      const ground = await page.evaluate(([x, z, y]) => window.__game!.physicsGround(x, z, y), [s.feet.x, s.feet.z, s.feet.y + 3]);
      if (ground !== null) expect(s.feet.y).toBeGreaterThan(ground - 0.06);
      expect(s.camera.y).toBeGreaterThan(s.groundUnderCamera + 0.3);
    }
    // Stayed on the ground most of the way (no bouncing or unexplained falls).
    const groundedRatio = samples.filter((s) => s.grounded).length / samples.length;
    expect(groundedRatio).toBeGreaterThan(0.85);
  });

  test('cannot walk through the lighthouse', async ({ page }) => {
    const lh = (await page.evaluate(() => window.__game!.obstacles())).find((o) => o.kind === 'lighthouse')!;
    // Start 6 m away on the pad and walk straight at the tower.
    await teleport(page, lh.x, lh.y + 0.4, lh.z + 6, 0);
    const samples = await sampleSimWhileHolding(page, ['KeyW'], 2.5);
    for (const s of samples) expect(Math.hypot(s.feet.x - lh.x, s.feet.z - lh.z)).toBeGreaterThan(lh.radius + 0.25);
  });

  for (const kind of ['rock', 'tree'] as const) {
    test(`cannot walk through a ${kind}`, async ({ page }) => {
      const all = await page.evaluate(() => window.__game!.obstacles());
      // Pick a sizeable one on fairly open ground, nearest the island centre.
      const candidates = all
        .filter((o) => o.kind === kind && (kind === 'tree' || o.radius > 0.9))
        .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
      const target = candidates[0];
      expect(target, `a ${kind} to test against`).toBeTruthy();
      // Approach from the island-centre side, 5 m out.
      const len = Math.hypot(target.x, target.z) || 1;
      const sx = target.x - (target.x / len) * 5;
      const sz = target.z - (target.z / len) * 5;
      const ground = (await page.evaluate(([x, z]) => window.__game!.physicsGround(x, z), [sx, sz]))!;
      const yaw = Math.atan2(-(target.x - sx), -(target.z - sz));
      await teleport(page, sx, ground + 0.2, sz, yaw);
      const samples = await sampleSimWhileHolding(page, ['KeyW'], 2.5);
      const minDist = Math.min(...samples.map((s) => Math.hypot(s.feet.x - target.x, s.feet.z - target.z)));
      // Capsule radius is 0.34; rock hulls are irregular so allow some slack inside the estimate.
      const limit = kind === 'tree' ? target.radius + 0.3 : target.radius * 0.6;
      expect(minDist).toBeGreaterThan(limit);
      // ...and not by walking up and over it either: feet stay on the terrain itself.
      for (const s of samples) {
        const terrain = await page.evaluate(([x, z]) => window.__game!.groundHeight(x, z), [s.feet.x, s.feet.z]);
        expect(s.feet.y - terrain).toBeLessThan(0.45);
      }
    });
  }

  test('walking into the sea is stopped or recovered onto land', async ({ page }) => {
    const spawn = await page.evaluate(() => window.__game!.spawn());
    // Face the open sea (+Z from the spawn beach) and keep walking.
    await teleport(page, spawn.x, spawn.y, spawn.z, Math.PI);
    const samples = await sampleSimWhileHolding(page, ['KeyW'], 6);
    const end = samples.at(-1)!;
    // Either held at the boundary in shallow water or returned to land: never drowned out at sea.
    expect(end.feet.y).toBeGreaterThan(-1.2);
    expect(Math.hypot(end.feet.x, end.feet.z)).toBeLessThan(80);
  });

  test('falling off a cliff into the sea returns the player to safe ground', async ({ page }) => {
    // A cliff-top point on the north-east coast (from IslandShape: theta -0.6, d 0.9).
    const theta = -0.6;
    const r = 56.2 * 0.9;
    const x = Math.cos(theta) * r;
    const z = Math.sin(theta) * r;
    const top = (await page.evaluate(([x, z]) => window.__game!.physicsGround(x, z), [x, z]))!;
    // Camera looking outward (forward = away from the island centre).
    await teleport(page, x, top + 0.2, z, Math.atan2(-Math.cos(theta), -Math.sin(theta)));
    await waitSim(page, 0.6);
    const before = (await snapshot(page)).teleportCount;
    // Walk off the edge; let go as soon as we're rescued so we don't walk straight off again.
    await page.keyboard.down('KeyW');
    await page.waitForFunction((b) => window.__game!.snapshot().teleportCount > b, before, { timeout: 120_000 });
    await page.keyboard.up('KeyW');
    await waitSim(page, 0.8);
    const after = await snapshot(page);
    expect(after.feet.y).toBeGreaterThan(0.3);
    expect(after.grounded).toBe(true);
  });

  test('orbiting the camera around the lighthouse never snaps, clips or loses the player', async ({ page }) => {
    const lh = (await page.evaluate(() => window.__game!.obstacles())).find((o) => o.kind === 'lighthouse')!;
    // Stand on the pad right next to the tower.
    await teleport(page, lh.x, lh.y + 0.4, lh.z + lh.radius + 1.2, 0);
    const canvas = page.locator('canvas.game-canvas');
    const box = (await canvas.boundingBox())!;
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const samples: Snapshot[] = [];
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    // Drag a full turn (~1140 px at 0.0055 rad/px) in small steps.
    for (let i = 1; i <= 24; i++) {
      await page.mouse.move(cx + i * 48, cy + Math.sin(i / 3) * 30, { steps: 2 });
      await page.waitForTimeout(40);
      samples.push(await snapshot(page));
    }
    await page.mouse.up();
    samples.push(...(await sampleSim(page, 1)));
    for (const s of samples) {
      // Outside the tower, above the ground, and still near the player.
      expect(Math.hypot(s.camera.x - lh.x, s.camera.z - lh.z)).toBeGreaterThan(lh.radius - 0.05);
      expect(s.camera.y).toBeGreaterThan(s.groundUnderCamera + 0.3);
      expect(Math.hypot(s.camera.x - s.feet.x, s.camera.y - s.feet.y, s.camera.z - s.feet.z)).toBeLessThan(16);
    }
    // No teleport-like jumps between consecutive samples (allowing for slow frames).
    for (let i = 1; i < samples.length; i++) {
      const a = samples[i - 1].camera;
      const b = samples[i].camera;
      expect(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z)).toBeLessThan(6);
    }
  });

  test('camera pulls in instead of clipping into the hill', async ({ page }) => {
    // Stand at the foot of the lighthouse hill and put the camera on the uphill side.
    const lh = (await page.evaluate(() => window.__game!.obstacles())).find((o) => o.kind === 'lighthouse')!;
    const fx = lh.x + 0.55 * 22;
    const fz = lh.z + 0.55 * 22;
    const ground = (await page.evaluate(([x, z]) => window.__game!.physicsGround(x, z), [fx, fz]))!;
    const towardHill = Math.atan2(lh.x - fx, lh.z - fz); // camera offset direction (sin, cos)
    await teleport(page, fx, ground + 0.2, fz, towardHill);
    await page.evaluate((y) => window.__game!.setCameraYaw(y, 0.05), towardHill);
    const samples = await sampleSim(page, 1.5);
    for (const s of samples) expect(s.camera.y).toBeGreaterThan(s.groundUnderCamera + 0.3);
    expect(samples.at(-1)!.camera.distance).toBeLessThan(7.5);
  });
});

async function sampleSimWhileHolding(page: Page, keys: string[], seconds: number) {
  for (const k of keys) await page.keyboard.down(k);
  const samples = await sampleSim(page, seconds);
  for (const k of keys) await page.keyboard.up(k);
  return samples;
}
