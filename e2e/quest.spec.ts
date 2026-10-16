import { expect, test, type Page } from '@playwright/test';
import { collectErrors, sampleSim, snapshot, startGame, teleport, waitSim } from './helpers';

// Stage 2: the lighthouse quest. Pieces are picked up by walking (or jumping) into them.

type Piece = { id: string; x: number; y: number; z: number; collected: boolean };

const pieces = (page: Page) => page.evaluate(() => window.__game!.questPieces() as Piece[]);
const questState = async (page: Page) => (await snapshot(page)).quest!;

async function holding(page: Page, keys: string[], seconds: number) {
  for (const k of keys) await page.keyboard.down(k);
  const s = await sampleSim(page, seconds);
  for (const k of keys) await page.keyboard.up(k);
  return s;
}

test.describe('lighthouse quest', () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = collectErrors(page);
    await startGame(page);
  });

  test.afterEach(() => {
    expect(errors, 'console errors/warnings').toEqual([]);
  });

  test('starts with five pieces to find and a visible counter', async ({ page }) => {
    const q = await questState(page);
    expect(q).toMatchObject({ state: 'collecting', collected: 0, total: 5 });
    await expect(page.locator('.quest-hud')).toBeVisible();
    await expect(page.locator('.quest-label')).toHaveText('Lens pieces 0 / 5');
    expect(await pieces(page)).toHaveLength(5);
  });

  test('walking into a piece collects it and updates the counter', async ({ page }) => {
    const cove = (await pieces(page)).find((p) => p.id === 'cove')!;
    const ground = (await page.evaluate(([x, z]) => window.__game!.physicsGround(x, z), [cove.x + 4, cove.z]))!;
    // Start 4 m inland and walk toward -X (camera yaw +90°).
    await teleport(page, cove.x + 4, ground + 0.1, cove.z, Math.PI / 2);
    await holding(page, ['KeyW'], 1.6);
    expect((await questState(page)).collected).toBe(1);
    await expect(page.locator('.quest-label')).toHaveText('Lens pieces 1 / 5');
    await expect(page.locator('.quest-toast')).toContainText('Lens piece found');
    expect((await pieces(page)).find((p) => p.id === 'cove')!.collected).toBe(true);
  });

  test('the piece on the ruin needs a jump', async ({ page }) => {
    const ruin = (await pieces(page)).find((p) => p.id === 'ruin')!;
    const sx = ruin.x;
    const sz = ruin.z + 4;
    const ground = (await page.evaluate(([x, z]) => window.__game!.physicsGround(x, z), [sx, sz]))!;
    await teleport(page, sx, ground + 0.1, sz, 0);
    // Walking alone runs into the plinth.
    await holding(page, ['KeyW'], 2);
    expect((await questState(page)).collected).toBe(0);
    // Jumping while walking gets on top and collects it.
    await page.keyboard.down('KeyW');
    await page.keyboard.down('Space');
    await sampleSim(page, 0.45);
    await page.keyboard.up('Space');
    await sampleSim(page, 0.5);
    await page.keyboard.up('KeyW');
    await waitSim(page, 0.3);
    expect((await questState(page)).collected).toBe(1);
  });

  test('collecting all pieces and reaching the lighthouse lights it at dusk', async ({ page }) => {
    for (const p of await pieces(page)) {
      // Place the capsule on the piece; pickup happens in the next physics step.
      const before = (await questState(page)).collected;
      await page.evaluate(([x, y, z]) => window.__game!.teleport(x, y, z), [p.x, p.y - 0.75, p.z]);
      await page.waitForFunction((b) => window.__game!.snapshot().quest!.collected > b, before);
    }
    expect((await questState(page)).state).toBe('complete');
    await expect(page.locator('.quest-label')).toContainText('to the lighthouse');

    // Walk the last few metres to the lighthouse door.
    const goal = (await page.evaluate(() => window.__game!.questGoal()))!;
    await teleport(page, goal.x, goal.y + 0.3, goal.z + 11, 0);
    await holding(page, ['KeyW'], 1.5);
    const lit = await questState(page);
    expect(['finale', 'done']).toContain(lit.state);

    await page.waitForFunction(() => window.__game!.snapshot().quest!.state === 'done', null, { timeout: 120_000 });
    await expect(page.locator('.finale')).not.toHaveClass(/hidden/);
    expect((await snapshot(page)).state).toBe('overlay');
    // Esc must not open the pause menu on top of the finale screen.
    await page.keyboard.press('Escape');
    await expect(page.locator('.pause-menu')).toHaveClass(/hidden/);

    await page.locator('button.continue').click();
    await expect(page.locator('.finale')).toHaveClass(/hidden/);
    await waitSim(page, 0.3);
    const after = await snapshot(page);
    expect(after.state).toBe('playing');
    expect(after.quest).toMatchObject({ state: 'done', lightLevel: 1, duskLevel: 1 });
    await expect(page.locator('.quest-label')).toHaveText('The lighthouse is lit');
  });
});
