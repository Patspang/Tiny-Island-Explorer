import { expect, test, type Page } from '@playwright/test';
import { collectErrors, sampleSim, snapshot, startGame, teleport, waitSim } from './helpers';

// Stage 2: the lighthouse quest. Pieces are picked up by walking (or jumping) into them;
// the finale starts at the lighthouse door.

type Piece = { id: string; x: number; y: number; z: number; collected: boolean };
type Obstacle = { kind: string; x: number; y: number; z: number; radius: number };

const pieces = (page: Page) => page.evaluate(() => window.__game!.questPieces() as Piece[]);
const obstacles = (page: Page) => page.evaluate(() => window.__game!.obstacles() as Obstacle[]);
const questState = async (page: Page) => (await snapshot(page)).quest!;

async function holding(page: Page, keys: string[], seconds: number) {
  for (const k of keys) await page.keyboard.down(k);
  const s = await sampleSim(page, seconds);
  for (const k of keys) await page.keyboard.up(k);
  return s;
}

/**
 * One jump toward (x, z), steered step by step with the deterministic simulate hook, then
 * settle. Returns the landing snapshot. Uses the same physics and controller as real play.
 */
async function hop(page: Page, x: number, z: number) {
  return page.evaluate(
    ([tx, tz]) => {
      const g = window.__game!;
      let s = g.snapshot();
      g.setCameraYaw(Math.atan2(-(tx - s.feet.x), -(tz - s.feet.z)));
      const dt = 1 / 60;
      // A short run-up across the current footing, as a player would, then jump.
      if (s.grounded) g.simulate(0.12, { y: 1 });
      g.simulate(dt, { y: 1, jump: true, jumpHeld: true });
      for (let i = 0; i < 150; i++) {
        s = g.snapshot();
        const dx = tx - s.feet.x;
        const dz = tz - s.feet.z;
        const d = Math.hypot(dx, dz);
        // Velocity toward the target vs. what we'd like: ease in so we land on, not past, it.
        const toward = (s.velocity.x * dx + s.velocity.z * dz) / Math.max(d, 1e-6);
        const want = Math.min(4.6, d * 3);
        g.simulate(dt, { y: toward < want ? 1 : -1, jumpHeld: i < 20 });
        if (i > 15 && s.grounded) break;
      }
      g.simulate(0.4, {});
      return g.snapshot();
    },
    [x, z],
  );
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

  test('starts with five pieces to find, no beams, and a visible counter', async ({ page }) => {
    const q = await questState(page);
    expect(q).toMatchObject({ state: 'collecting', collected: 0, total: 5, hintIndex: -1 });
    await expect(page.locator('.quest-hud')).toBeVisible();
    await expect(page.locator('.quest-label')).toHaveText('Lens pieces 0 / 5');
    expect((await pieces(page)).map((p) => p.id).sort()).toEqual(['cliff', 'islet', 'roof', 'ruin', 'woods']);
  });

  test('walking into a piece collects it and updates the counter', async ({ page }) => {
    const cliff = (await pieces(page)).find((p) => p.id === 'cliff')!;
    // Approach from 4 m inland (toward the island centre).
    const len = Math.hypot(cliff.x, cliff.z);
    const sx = cliff.x - (cliff.x / len) * 4;
    const sz = cliff.z - (cliff.z / len) * 4;
    const ground = (await page.evaluate(([x, z]) => window.__game!.physicsGround(x, z), [sx, sz]))!;
    await teleport(page, sx, ground + 0.1, sz, Math.atan2(-(cliff.x - sx), -(cliff.z - sz)));
    await holding(page, ['KeyW'], 1.4);
    expect((await questState(page)).collected).toBe(1);
    await expect(page.locator('.quest-label')).toHaveText('Lens pieces 1 / 5');
    await expect(page.locator('.quest-toast')).toContainText('Lens piece found');
  });

  test('the piece on the ruin needs a jump', async ({ page }) => {
    const ruin = (await pieces(page)).find((p) => p.id === 'ruin')!;
    const sx = ruin.x;
    const sz = ruin.z + 4;
    const ground = (await page.evaluate(([x, z]) => window.__game!.physicsGround(x, z), [sx, sz]))!;
    await teleport(page, sx, ground + 0.1, sz, 0);
    await holding(page, ['KeyW'], 2);
    expect((await questState(page)).collected).toBe(0);
    await hop(page, ruin.x, ruin.z);
    expect((await questState(page)).collected).toBe(1);
  });

  test('stepping stones lead out to the sea-rock piece', async ({ page }) => {

    const stones = (await obstacles(page))
      .filter((o) => o.kind === 'stone')
      .sort((a, b) => Math.hypot(a.x, a.z) - Math.hypot(b.x, b.z));
    expect(stones.length).toBe(4); // three stepping stones + the rock
    // Start on the beach in front of the first stone.
    const first = stones[0];
    const len = Math.hypot(first.x, first.z);
    const sx = first.x - (first.x / len) * 2.2;
    const sz = first.z - (first.z / len) * 2.2;
    const ground = (await page.evaluate(([x, z]) => window.__game!.physicsGround(x, z), [sx, sz]))!;
    await teleport(page, sx, ground + 0.1, sz);

    // Walking into the first stone doesn't climb it.
    await page.evaluate(([fx, fz, x, z]) => window.__game!.setCameraYaw(Math.atan2(-(fx - x), -(fz - z))), [first.x, first.z, sx, sz]);
    await holding(page, ['KeyW'], 1);
    expect((await snapshot(page)).feet.y).toBeLessThan(first.y - 0.2);
    await teleport(page, sx, ground + 0.1, sz);

    for (const stone of stones) {
      const landed = await hop(page, stone.x, stone.z);
      expect(landed.feet.y, `landed on stone at ${stone.x.toFixed(1)},${stone.z.toFixed(1)}`).toBeGreaterThan(stone.y - 0.1);
    }
    await page.evaluate(() => window.__game!.simulate(0.1, {}));
    expect((await pieces(page)).find((p) => p.id === 'islet')!.collected).toBe(true);
  });

  test('crates lead up onto the hut roof for the roof piece', async ({ page }) => {
    const roof = (await pieces(page)).find((p) => p.id === 'roof')!;
    const crates = (await obstacles(page)).filter((o) => o.kind === 'crate').sort((a, b) => a.y - b.y);
    const low = crates[0];
    const high = crates.at(-1)!;
    // Start on the ground a couple of metres from the low crate, on the side away from the hut.
    const ax = low.x + (low.x - roof.x) * 0.6;
    const az = low.z + (low.z - roof.z) * 0.6;
    const ground = (await page.evaluate(([x, z]) => window.__game!.physicsGround(x, z), [ax, az]))!;
    await teleport(page, ax, ground + 0.1, az);
    // From the ground the piece is out of reach.
    expect((await questState(page)).collected).toBe(0);

    const onLow = await hop(page, low.x, low.z);
    expect(onLow.feet.y).toBeGreaterThan(low.y - 0.1);
    const onHigh = await hop(page, high.x, high.z);
    expect(onHigh.feet.y).toBeGreaterThan(high.y - 0.1);
    await hop(page, roof.x, roof.z);
    // Walk up the slope to the ridge if the hop landed low on the roof.
    await page.evaluate(([x, z]) => {
      const g = window.__game!;
      for (let i = 0; i < 90; i++) {
        const s = g.snapshot();
        if (s.quest!.collected > 0) break;
        g.setCameraYaw(Math.atan2(-(x - s.feet.x), -(z - s.feet.z)));
        g.simulate(1 / 60, { y: 1 });
      }
    }, [roof.x, roof.z]);
    expect((await pieces(page)).find((p) => p.id === 'roof')!.collected).toBe(true);
  });

  test('a hint beam appears after a while without progress', async ({ page }) => {
    await page.evaluate(() => window.__game!.setHintDelay(1));
    await waitSim(page, 1.5);
    expect((await questState(page)).hintIndex).toBeGreaterThanOrEqual(0);
    await expect(page.locator('.quest-toast')).toContainText('beam of light');
  });

  test('reaching the door early says how many pieces are missing', async ({ page }) => {
    const goal = (await page.evaluate(() => window.__game!.questGoal()))!;
    await teleport(page, goal.x, goal.y + 0.2, goal.z, 0);
    await waitSim(page, 0.3);
    await expect(page.locator('.quest-toast')).toContainText('5 pieces still missing');
    expect((await questState(page)).state).toBe('collecting');
  });

  test('with the full lens, walking to the door lights the lighthouse at dusk', async ({ page }) => {
    for (const p of await pieces(page)) {
      const before = (await questState(page)).collected;
      await page.evaluate(([x, y, z]) => window.__game!.teleport(x, y, z), [p.x, p.y - 0.75, p.z]);
      await page.waitForFunction((b) => window.__game!.snapshot().quest!.collected > b, before);
    }
    expect((await questState(page)).state).toBe('complete');
    await expect(page.locator('.quest-label')).toContainText('to the lighthouse door');

    // Near the lighthouse but not at the door: nothing happens yet.
    const goal = (await page.evaluate(() => window.__game!.questGoal()))!;
    const lh = (await obstacles(page)).find((o) => o.kind === 'lighthouse')!;
    const out = { x: goal.x - lh.x, z: goal.z - lh.z };
    const len = Math.hypot(out.x, out.z);
    out.x /= len;
    out.z /= len;
    const sx = goal.x + out.x * 5;
    const sz = goal.z + out.z * 5;
    const ground = (await page.evaluate(([x, z]) => window.__game!.physicsGround(x, z), [sx, sz]))!;
    await teleport(page, sx, ground + 0.1, sz, Math.atan2(out.x, out.z));
    await waitSim(page, 0.5);
    expect((await questState(page)).state).toBe('complete');

    // Walk up to the door.
    await holding(page, ['KeyW'], 1.3);
    expect(['finale', 'done']).toContain((await questState(page)).state);

    await page.waitForFunction(() => window.__game!.snapshot().quest!.state === 'done', null, { timeout: 120_000 });
    await expect(page.locator('.finale')).not.toHaveClass(/hidden/);
    expect((await snapshot(page)).state).toBe('overlay');
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
