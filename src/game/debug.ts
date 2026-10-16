import { PHYSICS, PLAYER } from '../config';
import type { Game } from './Game';

/**
 * Read-mostly handle for automated browser tests and manual debugging.
 * Exposed as window.__game in dev builds, or in any build with ?debug in the URL.
 */
export function createDebugHandle(game: Game, mode: string) {
  const v = (x: { x: number; y: number; z: number }) => ({ x: x.x, y: x.y, z: x.z });
  return {
    mode,
    config: { PHYSICS, PLAYER },
    get state() {
      return game.state;
    },
    snapshot() {
      const p = game.player;
      const cam = game.followCamera.camera.position;
      return {
        state: game.state,
        simTime: game.simulationTime,
        fps: game.fps,
        feet: { x: p.position.x, y: p.feetY, z: p.position.z },
        velocity: v(p.actualVelocity),
        intendedVelocity: v(p.velocity),
        horizontalSpeed: p.horizontalSpeed,
        grounded: p.grounded,
        jumpCount: p.jumpCount,
        maxJumpAirTime: p.maxJumpAirTime,
        teleportCount: p.teleportCount,
        camera: { ...v(cam), yaw: game.followCamera.yaw, pitch: game.followCamera.pitch, distance: game.followCamera.currentDistance },
        groundUnderCamera: game.world.groundHeight(cam.x, cam.z),
      };
    },
    groundHeight: (x: number, z: number) => game.world.groundHeight(x, z),
    /** Physics ground height under (x, z) via a downward ray; null if nothing below. */
    physicsGround(x: number, z: number, fromY = 60) {
      const hit = game.physics.castRay(x, fromY, z, 0, -1, 0, fromY + 30, 0xffff0003);
      return hit === null ? null : fromY - hit;
    },
    obstacles: () => game.world.obstacles.map((o) => ({ ...o })),
    spawn: () => v(game.world.spawn),
    teleport(x: number, feetY: number, z: number) {
      game.player.teleportFeet(x, feetY, z);
    },
    setCameraYaw(yaw: number, pitch?: number) {
      game.followCamera.snapTo(game.feetPosition, yaw, pitch);
    },
    play: () => game.play(),
    togglePause: () => game.togglePause(),
  };
}

export type DebugHandle = ReturnType<typeof createDebugHandle>;
