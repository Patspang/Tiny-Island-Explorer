import { expect, test, type Page } from '@playwright/test';
import { collectErrors, horizontal, sampleSim, snapshot, startGame, teleport, waitSim, type Snapshot } from './helpers';

// Milestone B/D: behaviour on the real island. These tests drive the player with real
// keyboard input; positions are checked against the physics world via the debug handle.

/** Steer along waypoints by aiming the camera and holding forward (+ run). */
async function followRoute(page: Page, points: Array<{ x: number; z: number }>, maxSimSeconds: number) {
  const samples: Snapshot[] = [];
  const start = (await snapshot(page)).simTime;
  let i = 0;
  await page.keyboard.down('ShiftLeft');
  await page.keyboard.down('KeyW');
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
    await page.evaluate((y) => window.__game!.setCameraYaw(y, 0.3), yaw);
    await page.waitForTimeout(60);
  }
  await page.keyboard.up('KeyW');
  await page.keyboard.up('ShiftLeft');
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
    const samples = await sampleSimWhileHolding(page, ['KeyW'], 5);
    const end = samples.at(-1)!;
    expect(end.teleportCount).toBeGreaterThan(before);
    await waitSim(page, 0.5);
    const after = await snapshot(page);
    expect(after.feet.y).toBeGreaterThan(0.3);
    expect(after.grounded).toBe(true);
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
