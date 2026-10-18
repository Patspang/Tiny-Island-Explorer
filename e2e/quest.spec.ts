import { expect, test, type Page } from '@playwright/test';
import { collectErrors, sampleSim, snapshot, startGame, teleport, waitSim } from './helpers';

// The lighthouse quest. Pieces are picked up by walking (or jumping) into them; three of them
// first have to be uncovered by a puzzle (bells, shells + chest, the X). The finale starts at
// the lighthouse door. Puzzle steps are driven by teleporting onto things and letting the real
// fixed-step quest code run.

type Piece = { id: string; x: number; y: number; z: number; available: boolean; collected: boolean };
type Sites = NonNullable<ReturnType<NonNullable<typeof window.__game>['questSites']>>;
type Obstacle = { kind: string; x: number; y: number; z: number; radius: number };

const pieces = (page: Page) => page.evaluate(() => window.__game!.questPieces() as Piece[]);
const obstacles = (page: Page) => page.evaluate(() => window.__game!.obstacles() as Obstacle[]);
const questState = async (page: Page) => (await snapshot(page)).quest!;
const sites = (page: Page) => page.evaluate(() => window.__game!.questSites()!) as Promise<Sites>;
const piece = async (page: Page, id: string) => (await pieces(page)).find((p) => p.id === id)!;

/** Stand on a ground spot (feet just above it) and let the simulation run a moment. */
async function standOn(page: Page, at: { x: number; y: number; z: number }, seconds = 0.4) {
  await page.evaluate(([x, y, z]) => window.__game!.teleport(x, y + 0.1, z), [at.x, at.y, at.z]);
  await waitSim(page, seconds);
}

async function playBells(page: Page, s: Sites, notes: number[]) {
  for (const bell of notes) await standOn(page, s.bells.plates[bell]);
}

async function collectShells(page: Page, s: Sites) {
  for (const shell of s.shells) await standOn(page, shell);
}

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

  test('starts with the bottle to find, five pieces (two out in the open) and a visible counter', async ({ page }) => {
    const q = await questState(page);
    expect(q).toMatchObject({ state: 'collecting', collected: 0, total: 5, hint: null, bottleRead: false, shellsFound: 0 });
    await expect(page.locator('.quest-hud')).toBeVisible();
    await expect(page.locator('.quest-label')).toHaveText('Lens pieces 0 / 5');
    await expect(page.locator('.quest-journal li')).toHaveCount(1);
    const all = await pieces(page);
    expect(all.map((p) => p.id).sort()).toEqual(['cliff', 'islet', 'roof', 'ruin', 'woods']);
    expect(all.filter((p) => p.available).map((p) => p.id).sort()).toEqual(['islet', 'roof']);
  });

  test('the message in a bottle opens the letter, then the map, then play resumes', async ({ page }) => {
    const s = await sites(page);
    // Walk into the bottle from a couple of metres away.
    const sx = s.bottle.x + 2;
    const ground = (await page.evaluate(([x, z]) => window.__game!.physicsGround(x, z), [sx, s.bottle.z]))!;
    await teleport(page, sx, ground + 0.1, s.bottle.z, Math.atan2(2, 0));
    await page.keyboard.down('KeyW');
    await expect(page.locator('.letter')).not.toHaveClass(/hidden/);
    await page.keyboard.up('KeyW');
    expect((await snapshot(page)).state).toBe('overlay');
    expect((await questState(page)).bottleRead).toBe(true);

    await page.locator('.letter button.continue').click();
    await expect(page.locator('.letter')).toHaveClass(/hidden/);
    await expect(page.locator('.map-view')).not.toHaveClass(/hidden/);
    expect((await snapshot(page)).state).toBe('overlay');
    await page.keyboard.press('KeyJ');
    await expect(page.locator('.map-view')).toHaveClass(/hidden/);
    expect((await snapshot(page)).state).toBe('playing');
    await expect(page.locator('.quest-journal li')).toHaveCount(5);

    // J opens the map again while playing, Escape closes it.
    await page.keyboard.press('KeyJ');
    await expect(page.locator('.map-view')).not.toHaveClass(/hidden/);
    await page.keyboard.press('Escape');
    await expect(page.locator('.map-view')).toHaveClass(/hidden/);
    await expect(page.locator('.pause-menu')).toHaveClass(/hidden/);
    expect((await snapshot(page)).state).toBe('playing');
  });

  test('playing the bells song reveals the ruin piece, which still needs a jump', async ({ page }) => {
    const s = await sites(page);
    const ruin = await piece(page, 'ruin');
    expect(ruin.available).toBe(false);
    // A wrong note first: nothing happens except a gentle "try again".
    const wrong = [0, 1, 2].find((b) => b !== s.bells.song[0])!;
    await standOn(page, s.bells.plates[wrong]);
    await expect(page.locator('.quest-toast')).toContainText('not the song');
    expect((await questState(page)).songProgress).toBe(0);
    // Listening stone, then the song itself.
    await standOn(page, s.bells.listen, 0.3);
    await playBells(page, s, s.bells.song);
    expect((await questState(page)).bellsSolved).toBe(true);
    await waitSim(page, 1.2);
    expect((await piece(page, 'ruin')).available).toBe(true);

    // From the ground beside the ruin the piece is out of reach; a jump gets it.
    const sx = ruin.x;
    const sz = ruin.z + 4;
    const ground = (await page.evaluate(([x, z]) => window.__game!.physicsGround(x, z), [sx, sz]))!;
    await teleport(page, sx, ground + 0.1, sz, 0);
    await holding(page, ['KeyW'], 2);
    expect((await questState(page)).collected).toBe(0);
    await hop(page, ruin.x, ruin.z);
    expect((await questState(page)).collected).toBe(1);
  });

  test("five golden shells open Wren's chest and free the woods piece", async ({ page }) => {
    const s = await sites(page);
    const woods = await piece(page, 'woods');
    // Walking up to where the piece will be does nothing while the chest is shut.
    const ground = (await page.evaluate(([x, z]) => window.__game!.physicsGround(x, z), [woods.x, woods.z + 3]))!;
    await teleport(page, woods.x, ground + 0.1, woods.z + 3, 0);
    await holding(page, ['KeyW'], 1);
    expect((await questState(page)).collected).toBe(0);

    await collectShells(page, s);
    const q = await questState(page);
    expect(q).toMatchObject({ shellsFound: 5, chestOpen: true });
    await expect(page.locator('.quest-toast')).toContainText('chest');
    await waitSim(page, 1.2);
    await teleport(page, woods.x, ground + 0.1, woods.z + 3, 0);
    await holding(page, ['KeyW'], 1.2);
    expect((await piece(page, 'woods')).collected).toBe(true);
  });

  test('standing on the X digs up the cliff piece', async ({ page }) => {
    const s = await sites(page);
    expect((await piece(page, 'cliff')).available).toBe(false);
    await standOn(page, s.dig, 1.5);
    expect((await questState(page)).dug).toBe(true);
    expect((await piece(page, 'cliff')).collected).toBe(true);
    await expect(page.locator('.quest-label')).toHaveText('Lens pieces 1 / 5');
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
    expect((await piece(page, 'islet')).collected).toBe(true);
  });

  test('crates lead up onto the hut roof for the roof piece', async ({ page }) => {
    const roof = await piece(page, 'roof');
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
    expect((await piece(page, 'roof')).collected).toBe(true);
  });

  test('a hint beam points at the bottle first, and at a real task after that', async ({ page }) => {
    await page.evaluate(() => window.__game!.setHintDelay(1));
    await waitSim(page, 1.5);
    expect((await questState(page)).hint).toBe('bottle');
    await expect(page.locator('.quest-toast')).toContainText('beam of light');

    // Reading the bottle is progress: that beam goes, and the next one points at a real task.
    const s = await sites(page);
    await page.evaluate(([x, y, z]) => window.__game!.teleport(x, y + 0.1, z), [s.bottle.x, s.bottle.y, s.bottle.z]);
    await page.locator('.letter button.continue').click();
    await expect(page.locator('.map-view')).not.toHaveClass(/hidden/);
    expect((await questState(page)).hint).toBeNull();
    await page.locator('.map-view button.continue').click();
    await waitSim(page, 1.5);
    const hint = (await questState(page)).hint;
    expect(hint).not.toBeNull();
    expect(hint).not.toBe('bottle');
  });

  test('reaching the door early says how many pieces are missing', async ({ page }) => {
    const goal = (await page.evaluate(() => window.__game!.questGoal()))!;
    await teleport(page, goal.x, goal.y + 0.2, goal.z, 0);
    await waitSim(page, 0.3);
    await expect(page.locator('.quest-toast')).toContainText('5 pieces still missing');
    expect((await questState(page)).state).toBe('collecting');
  });

  test('with the full lens, walking to the door lights the lighthouse at dusk', async ({ page }) => {
    const s = await sites(page);
    await playBells(page, s, s.bells.song);
    await collectShells(page, s);
    await standOn(page, s.dig, 0.3);
    await waitSim(page, 1.2);
    for (const p of await pieces(page)) {
      if (p.collected) continue;
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

    await page.locator('.finale button.continue').click();
    await expect(page.locator('.finale')).toHaveClass(/hidden/);
    await waitSim(page, 0.3);
    const after = await snapshot(page);
    expect(after.state).toBe('playing');
    expect(after.quest).toMatchObject({ state: 'done', lightLevel: 1, duskLevel: 1 });
    await expect(page.locator('.quest-label')).toHaveText('The lighthouse is lit');
  });
});
