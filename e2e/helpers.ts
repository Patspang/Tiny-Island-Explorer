import { expect, type Page } from '@playwright/test';
import type { DebugHandle } from '../src/game/debug';

export type Snapshot = ReturnType<DebugHandle['snapshot']>;

declare global {
  interface Window {
    __game?: DebugHandle;
  }
}

/** Console errors and uncaught exceptions collected during a test. */
export function collectErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m) => {
    if (m.type() === 'error' || m.type() === 'warning') errors.push(`${m.type()}: ${m.text()}`);
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

/** Load the game, wait until it is ready and press Play. */
export async function startGame(page: Page, query = ''): Promise<void> {
  const sep = query ? '&' : '';
  await page.goto(`/?debug${sep}${query}`);
  await page.waitForFunction(() => !!window.__game, null, { timeout: 60_000 });
  const play = page.locator('button.play');
  await expect(play).toBeEnabled();
  await play.click();
  await expect(page.locator('.start-screen')).toHaveClass(/hidden/);
  await waitSim(page, 0.5);
}

export function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => window.__game!.snapshot());
}

/** Wait until the simulation has advanced by `seconds` of game time (independent of FPS). */
export async function waitSim(page: Page, seconds: number): Promise<void> {
  const start = (await snapshot(page)).simTime;
  await page.waitForFunction((target) => window.__game!.snapshot().simTime >= target, start + seconds, {
    timeout: 120_000,
    polling: 50,
  });
}

/** Sample snapshots every ~poll ms of wall time until `seconds` of game time have passed. */
export async function sampleSim(page: Page, seconds: number): Promise<Snapshot[]> {
  const out: Snapshot[] = [];
  const start = (await snapshot(page)).simTime;
  for (;;) {
    const s = await snapshot(page);
    out.push(s);
    if (s.simTime >= start + seconds) return out;
    await page.waitForTimeout(40);
  }
}

export async function holdKeys(page: Page, keys: string[], seconds: number): Promise<Snapshot[]> {
  for (const k of keys) await page.keyboard.down(k);
  const samples = await sampleSim(page, seconds);
  for (const k of [...keys].reverse()) await page.keyboard.up(k);
  return samples;
}

export async function teleport(page: Page, x: number, feetY: number, z: number, yaw?: number): Promise<void> {
  await page.evaluate(
    ([x, y, z, yaw]) => {
      window.__game!.teleport(x, y, z);
      if (yaw !== null) window.__game!.setCameraYaw(yaw);
    },
    [x, feetY, z, yaw ?? null] as const,
  );
  await waitSim(page, 0.6);
}

export function horizontal(a: { x: number; z: number }, b: { x: number; z: number }) {
  return Math.hypot(b.x - a.x, b.z - a.z);
}

export function maxOf<T>(items: T[], f: (t: T) => number): number {
  return items.reduce((m, t) => Math.max(m, f(t)), -Infinity);
}
