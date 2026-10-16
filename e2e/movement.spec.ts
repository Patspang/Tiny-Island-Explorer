import { expect, test } from '@playwright/test';
import {
  collectErrors,
  holdKeys,
  horizontal,
  maxOf,
  sampleSim,
  snapshot,
  startGame,
  teleport,
  waitSim,
  type Snapshot,
} from './helpers';

// Milestone A: controller behaviour on the flat sandbox (?sandbox), where every slope,
// step and wall has a known size. Speeds/heights come from src/config.ts.
const WALK = 4.6;
const RUN = 8.2;
const JUMP = 1.35;

test.describe('movement sandbox', () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = collectErrors(page);
    await startGame(page, 'sandbox');
  });

  test.afterEach(() => {
    expect(errors, 'console errors/warnings').toEqual([]);
  });

  test('spawns grounded and stays still', async ({ page }) => {
    const samples = await sampleSim(page, 2);
    const last = samples.at(-1)!;
    expect(last.grounded).toBe(true);
    expect(last.feet.y).toBeGreaterThanOrEqual(-0.01);
    expect(last.feet.y).toBeLessThan(0.08);
    // No drift or jitter while idle.
    expect(horizontal(samples[0].feet, last.feet)).toBeLessThan(0.01);
    expect(maxOf(samples, (s) => Math.abs(s.feet.y - last.feet.y))).toBeLessThan(0.01);
  });

  test('walks forward relative to the camera at walk speed', async ({ page }) => {
    await teleport(page, 0, 0, 0, 0);
    const before = await snapshot(page);
    const samples = await holdKeys(page, ['KeyW'], 1.2);
    const after = samples.at(-1)!;
    // Camera yaw 0 looks toward -Z.
    expect(after.feet.z - before.feet.z).toBeLessThan(-3.5);
    expect(Math.abs(after.feet.x - before.feet.x)).toBeLessThan(0.15);
    expect(maxOf(samples, (s) => s.horizontalSpeed)).toBeCloseTo(WALK, 1);
    expect(samples.every((s) => s.grounded)).toBe(true);
  });

  test('movement follows the camera after it rotates', async ({ page }) => {
    // Yaw +90°: camera sits on +X looking toward -X, so W must move toward -X.
    await teleport(page, 0, 0, 0, Math.PI / 2);
    const before = await snapshot(page);
    await holdKeys(page, ['KeyW'], 1);
    let after = await snapshot(page);
    expect(after.feet.x - before.feet.x).toBeLessThan(-2.5);
    expect(Math.abs(after.feet.z - before.feet.z)).toBeLessThan(0.15);

    // D strafes to the camera's right (-Z when looking toward -X).
    const mid = after;
    await holdKeys(page, ['KeyD'], 1);
    after = await snapshot(page);
    expect(after.feet.z - mid.feet.z).toBeLessThan(-2.5);
  });

  test('diagonal movement is not faster than straight movement', async ({ page }) => {
    // Average speed over the steady part of the run, plus the controller's intended speed.
    const steady = (samples: Snapshot[]) => {
      const tail = samples.filter((s) => s.simTime >= samples[0].simTime + 0.5);
      const a = tail[0];
      const b = tail.at(-1)!;
      return horizontal(a.feet, b.feet) / (b.simTime - a.simTime);
    };
    const intended = (s: Snapshot) => Math.hypot(s.intendedVelocity.x, s.intendedVelocity.z);

    // Open ground away from all fixtures.
    await teleport(page, -25, 0, 35, 0);
    const walkDiag = await holdKeys(page, ['KeyW', 'KeyD'], 1.4);
    expect(steady(walkDiag)).toBeLessThanOrEqual(WALK * 1.01);
    expect(steady(walkDiag)).toBeGreaterThan(WALK * 0.95);
    expect(maxOf(walkDiag, intended)).toBeLessThanOrEqual(WALK + 1e-6);

    await waitSim(page, 0.5);
    await teleport(page, 25, 0, 35, 0);
    const runDiag = await holdKeys(page, ['ShiftLeft', 'KeyW', 'KeyA'], 1.4);
    expect(steady(runDiag)).toBeLessThanOrEqual(RUN * 1.01);
    expect(steady(runDiag)).toBeGreaterThan(RUN * 0.95);
    expect(maxOf(runDiag, intended)).toBeLessThanOrEqual(RUN + 1e-6);
  });

  test('runs with Shift and decelerates to a stop', async ({ page }) => {
    await teleport(page, 0, 0, 0, 0);
    const samples = await holdKeys(page, ['ShiftLeft', 'KeyW'], 1);
    expect(maxOf(samples, (s) => s.horizontalSpeed)).toBeCloseTo(RUN, 1);
    await waitSim(page, 0.4);
    expect((await snapshot(page)).horizontalSpeed).toBeLessThan(0.05);
  });

  test('jumps to the configured height and lands', async ({ page }) => {
    await teleport(page, 0, 0, 0, 0);
    const base = (await snapshot(page)).feet.y;
    const samples = await holdKeys(page, ['Space'], 0.8);
    const peak = maxOf(samples, (s) => s.feet.y) - base;
    expect(peak).toBeGreaterThan(JUMP * 0.85);
    expect(peak).toBeLessThan(JUMP * 1.1);
    await waitSim(page, 0.6);
    const landed = await snapshot(page);
    expect(landed.grounded).toBe(true);
    expect(Math.abs(landed.feet.y - base)).toBeLessThan(0.02);
    expect(landed.jumpCount).toBe(1);
  });

  test('cannot jump again while airborne', async ({ page }) => {
    await teleport(page, 0, 0, 0, 0);
    const base = (await snapshot(page)).feet.y;
    const start = (await snapshot(page)).jumpCount;
    await page.keyboard.down('Space');
    const rising = await sampleSim(page, 0.3);
    await page.keyboard.up('Space');
    // Mash jump repeatedly in the air.
    const air: typeof rising = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press('Space');
      air.push(...(await sampleSim(page, 0.08)));
    }
    const all = [...rising, ...air];
    const peak = maxOf(all, (s) => s.feet.y) - base;
    expect(peak).toBeLessThan(JUMP * 1.1);
    // Every jump must start on the ground or within coyote time, never mid-air.
    // (A press just before landing may legitimately buffer into a jump on touchdown.)
    await waitSim(page, 1.2);
    const after = await snapshot(page);
    expect(after.maxJumpAirTime).toBeLessThanOrEqual(0.12 + 1e-6);
    expect(after.jumpCount - start).toBeLessThanOrEqual(2);
  });

  test('cannot walk through a wall, and is not stuck after hitting it', async ({ page }) => {
    // Wall front face is at z = -11.5; capsule radius is 0.34.
    await teleport(page, 0, 0, -8, 0);
    const samples = await holdKeys(page, ['KeyW'], 2);
    const minZ = Math.min(...samples.map((s) => s.feet.z));
    expect(minZ).toBeGreaterThan(-11.5 + 0.3);
    expect(minZ).toBeLessThan(-11.5 + 0.45);
    const back = await holdKeys(page, ['KeyS'], 0.8);
    expect(back.at(-1)!.feet.z - minZ).toBeGreaterThan(2);
  });

  test('slides around a round pillar instead of sticking', async ({ page }) => {
    // Pillar at (6, 2), radius 0.8. Approach slightly off-centre.
    await teleport(page, 6.3, 0, 7, 0);
    const samples = await holdKeys(page, ['KeyW'], 2.5);
    const end = samples.at(-1)!;
    for (const s of samples) expect(Math.hypot(s.feet.x - 6, s.feet.z - 2)).toBeGreaterThan(0.8 + 0.3);
    expect(end.feet.z).toBeLessThan(0);
  });

  test('climbs a gentle 25° ramp', async ({ page }) => {
    await teleport(page, -10, 0, -4.5, 0);
    const samples = await holdKeys(page, ['KeyW'], 2.2);
    expect(samples.at(-1)!.feet.y).toBeGreaterThan(2.5);
    expect(samples.at(-1)!.grounded).toBe(true);
  });

  test('cannot walk up a steep 58° ramp', async ({ page }) => {
    await teleport(page, 10, 0, -4.5, 0);
    const samples = await holdKeys(page, ['KeyW'], 2.5);
    expect(maxOf(samples, (s) => s.feet.y)).toBeLessThan(0.8);
  });

  test('steps up a low ledge automatically but not a high one', async ({ page }) => {
    // Low step (0.25 m) spans z 6..10 at x = -10. Walk onto it from +Z.
    await teleport(page, -10, 0, 12.5, 0);
    await holdKeys(page, ['KeyW'], 1);
    const low = await snapshot(page);
    expect(low.feet.y).toBeGreaterThan(0.2);
    expect(low.feet.z).toBeLessThan(10);

    // High step (0.9 m) at x = 10 blocks walking.
    await teleport(page, 10, 0, 12.5, 0);
    await holdKeys(page, ['KeyW'], 1.2);
    const high = await snapshot(page);
    expect(high.feet.y).toBeLessThan(0.2);
    expect(high.feet.z).toBeGreaterThan(10);

    // ...but can be jumped onto.
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    await sampleSim(page, 0.45);
    // Release forward mid-air so we land on the 4 m deep block rather than walk off it.
    await page.keyboard.up('KeyW');
    await page.keyboard.up('Space');
    await waitSim(page, 0.9);
    const onTop = await snapshot(page);
    expect(onTop.feet.y).toBeGreaterThan(0.85);
    expect(onTop.grounded).toBe(true);
  });

  test('recovers after falling out of the world, and R returns to spawn', async ({ page }) => {
    await teleport(page, 3, 0, 3, 0);
    await waitSim(page, 0.6); // let a safe spot register
    const before = (await snapshot(page)).teleportCount;
    await page.evaluate(() => window.__game!.teleport(0, -40, 0));
    await waitSim(page, 0.5);
    const recovered = await snapshot(page);
    expect(recovered.teleportCount).toBeGreaterThan(before + 1);
    expect(recovered.feet.y).toBeGreaterThan(-0.1);

    await teleport(page, 12, 0, -2, 0);
    await page.keyboard.press('KeyR');
    await waitSim(page, 0.5);
    const home = await snapshot(page);
    expect(horizontal(home.feet, { x: 0, z: 0 })).toBeLessThan(0.05);
    expect(home.grounded).toBe(true);
  });

  test('focus loss releases held keys', async ({ page }) => {
    await teleport(page, 0, 0, 0, 0);
    await page.keyboard.down('KeyW');
    await waitSim(page, 0.6);
    expect((await snapshot(page)).horizontalSpeed).toBeGreaterThan(4);
    await page.evaluate(() => window.dispatchEvent(new Event('blur')));
    await waitSim(page, 0.5);
    expect((await snapshot(page)).horizontalSpeed).toBeLessThan(0.05);
    await page.keyboard.up('KeyW');
  });

  test('pause freezes the simulation and Resume continues', async ({ page }) => {
    await page.keyboard.press('Escape');
    await expect(page.locator('.pause-menu')).not.toHaveClass(/hidden/);
    const t0 = (await snapshot(page)).simTime;
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(600);
    await page.keyboard.up('KeyW');
    const paused = await snapshot(page);
    expect(paused.state).toBe('paused');
    expect(paused.simTime).toBe(t0);
    await page.locator('button.resume').click();
    await expect(page.locator('.pause-menu')).toHaveClass(/hidden/);
    await waitSim(page, 0.2);
    expect((await snapshot(page)).state).toBe('playing');
  });

  test('camera orbits with mouse drag and zooms with the wheel', async ({ page }) => {
    const before = await snapshot(page);
    const canvas = page.locator('canvas');
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + 200, box.y + box.height / 2 + 40, { steps: 8 });
    await page.mouse.up();
    await waitSim(page, 0.5);
    const rotated = await snapshot(page);
    expect(Math.abs(rotated.camera.yaw - before.camera.yaw)).toBeGreaterThan(0.5);
    expect(rotated.camera.pitch).toBeGreaterThan(before.camera.pitch);

    await page.mouse.wheel(0, 600);
    await waitSim(page, 0.8);
    const zoomed = await snapshot(page);
    expect(zoomed.camera.distance).toBeGreaterThan(before.camera.distance + 1);
  });

  test('canvas follows browser resizing', async ({ page }) => {
    await page.setViewportSize({ width: 640, height: 800 });
    await waitSim(page, 0.2);
    const size = await page.evaluate(() => {
      const c = document.querySelector('canvas')!;
      return { w: c.clientWidth, h: c.clientHeight, aspect: c.width / c.height };
    });
    expect(size.w).toBe(640);
    expect(size.h).toBe(800);
    expect(size.aspect).toBeCloseTo(640 / 800, 2);
  });
});
