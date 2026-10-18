import { expect, test, type Page } from '@playwright/test';
import { collectErrors, maxOf, sampleSim, snapshot, startGame, waitSim } from './helpers';

// Phones and tablets: the on-screen stick, jump and pause buttons, and pinch zoom. `?touch`
// forces the touch layout on a desktop browser; the stick and buttons take any pointer, so the
// mouse drives them here. Pinch is driven with synthetic touch pointer events on the canvas.

const WALK = 4.6;
const RUN = 8.2;

async function stickCentre(page: Page) {
  const box = (await page.locator('.touch-stick-zone').boundingBox())!;
  return { x: box.x + box.width * 0.4, y: box.y + box.height * 0.6 };
}

test.describe('touch controls', () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = collectErrors(page);
  });

  test.afterEach(() => {
    expect(errors, 'console errors/warnings').toEqual([]);
  });

  test('the start screen explains touch controls, and the buttons appear only while playing', async ({ page }) => {
    await page.goto('/?debug&touch');
    await expect(page.locator('.start-screen .controls')).toContainText('Linkerduim');
    await expect(page.locator('.touch-controls')).toHaveClass(/hidden/);
    await page.locator('button.play').click();
    await expect(page.locator('.touch-controls')).not.toHaveClass(/hidden/);
    await expect(page.locator('.touch-jump')).toBeVisible();
    await expect(page.locator('.touch-pause')).toBeVisible();
  });

  test('the thumb stick walks, and pushing it all the way runs', async ({ page }) => {
    await startGame(page, 'touch');
    const c = await stickCentre(page);
    await page.mouse.move(c.x, c.y);
    await page.mouse.down();
    // Half-way forward: a walk, not a run.
    await page.mouse.move(c.x, c.y - 30, { steps: 3 });
    const walk = await sampleSim(page, 1.2);
    const walkTop = maxOf(walk.slice(-5), (s) => s.horizontalSpeed);
    expect(walkTop).toBeGreaterThan(1);
    expect(walkTop).toBeLessThan(WALK + 0.2);
    // All the way: run speed.
    await page.mouse.move(c.x, c.y - 80, { steps: 3 });
    const run = await sampleSim(page, 1.2);
    expect(maxOf(run.slice(-5), (s) => s.horizontalSpeed)).toBeGreaterThan(RUN - 0.6);
    // Let go: the explorer stops.
    await page.mouse.up();
    await waitSim(page, 1);
    expect((await snapshot(page)).horizontalSpeed).toBeLessThan(0.2);
  });

  test('the jump button jumps; pause offers a way back to the beach', async ({ page }) => {
    await startGame(page, 'touch');
    const before = await snapshot(page);
    await page.locator('.touch-jump').click();
    await waitSim(page, 1.2);
    const after = await snapshot(page);
    expect(after.jumpCount).toBe(before.jumpCount + 1);
    expect(after.grounded).toBe(true);

    await page.locator('.touch-pause').click();
    await expect(page.locator('.pause-menu')).not.toHaveClass(/hidden/);
    await expect(page.locator('.touch-controls')).toHaveClass(/hidden/);
    expect((await snapshot(page)).state).toBe('paused');
    await page.locator('button.back-to-beach').click();
    await expect(page.locator('.pause-menu')).toHaveClass(/hidden/);
    const back = await snapshot(page);
    expect(back.state).toBe('playing');
    expect(back.teleportCount).toBeGreaterThan(after.teleportCount);
  });

  test('two fingers pinch to zoom the camera', async ({ page }) => {
    await startGame(page, 'touch');
    await waitSim(page, 0.5);
    const { distance: start, yaw: startYaw } = (await snapshot(page)).camera;
    // Fingers move apart on the right half of the screen (away from the stick): zoom in.
    await page.evaluate(() => {
      const canvas = document.querySelector('canvas.game-canvas')!;
      const ev = (type: string, id: number, x: number, y: number) =>
        new PointerEvent(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, bubbles: true, isPrimary: id === 11 });
      canvas.dispatchEvent(ev('pointerdown', 11, 700, 250));
      canvas.dispatchEvent(ev('pointerdown', 12, 760, 250));
      for (let i = 1; i <= 10; i++) {
        window.dispatchEvent(ev('pointermove', 11, 700 - i * 8, 250));
        window.dispatchEvent(ev('pointermove', 12, 760 + i * 8, 250));
      }
      window.dispatchEvent(ev('pointerup', 11, 620, 250));
      window.dispatchEvent(ev('pointerup', 12, 840, 250));
    });
    await waitSim(page, 1);
    const zoomed = await snapshot(page);
    expect(zoomed.camera.distance).toBeLessThan(start - 1);
    // Pinching must not also have spun the camera around.
    expect(Math.abs(zoomed.camera.yaw - startYaw)).toBeLessThan(0.01);
  });

  // An iPhone held upright, minus Safari's bars, and a small iPhone SE.
  for (const [w, h] of [[390, 664], [375, 560]] as const) {
    test(`the letter and its button fit on a ${w}×${h} phone screen`, async ({ page }) => {
      await page.setViewportSize({ width: w, height: h });
      await startGame(page, 'touch');
      const bottle = (await page.evaluate(() => window.__game!.questSites()!.bottle));
      await page.evaluate(([x, y, z]) => window.__game!.teleport(x, y + 0.1, z), [bottle.x, bottle.y, bottle.z]);
      const button = page.locator('.letter button.continue');
      await expect(button).toBeVisible();
      await expect(button).toBeInViewport({ ratio: 1 });
      await expect(page.locator('.letter .panel')).toContainText('Tik op de knop Kaart');
      await expect(page.locator('.sound-toggle')).toBeHidden();
      await button.click();
      await expect(page.locator('.map-view button.continue')).toBeInViewport({ ratio: 1 });
    });
  }
});
