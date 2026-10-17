import * as THREE from 'three';
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
        quest: game.quest
          ? {
              state: game.quest.state,
              collected: game.quest.collectedCount,
              total: game.quest.total,
              lightLevel: game.quest.lightLevel,
              duskLevel: game.quest.duskLevel,
              hintIndex: game.quest.hintIndex,
            }
          : null,
        render: { calls: game.renderer.info.render.calls, triangles: game.renderer.info.render.triangles },
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
    questPieces: () =>
      game.quest
        ? game.quest.spots.map((s, i) => ({ id: s.id, ...v(s.position), collected: game.quest!.isCollected(i) }))
        : [],
    /** Shorten the hint timer (tests). */
    setHintDelay(seconds: number) {
      if (game.quest) game.quest.hintDelay = seconds;
    },
    questGoal: () => (game.quest ? { ...game.quest.goal } : null),
    route: () => game.world.route.map((p) => ({ x: p.x, z: p.z })),
    teleport(x: number, feetY: number, z: number) {
      game.player.teleportFeet(x, feetY, z);
    },
    setCameraYaw(yaw: number, pitch?: number) {
      game.followCamera.snapTo(game.feetPosition, yaw, pitch);
    },
    /** Pin the camera for screenshots; call with no arguments to release it. */
    viewFrom(position?: [number, number, number], target?: [number, number, number]) {
      game.cameraOverride =
        position && target
          ? { position: new THREE.Vector3(...position), target: new THREE.Vector3(...target) }
          : null;
    },
    /** Where the ambient wildlife is right now (screenshots, checks). */
    wildlife() {
      const w = game.wildlife.snapshot();
      return { butterflies: w.butterflies.map(v), gulls: w.gulls.map(v), fireflies: w.fireflies };
    },
    /** Triangle budget per mesh (instanced meshes multiplied out), largest first. */
    sceneStats() {
      const rows: Array<{ name: string; triangles: number; instances: number }> = [];
      game.scene.traverse((o) => {
        const mesh = o as THREE.Mesh;
        if (!mesh.isMesh) return;
        const g = mesh.geometry;
        const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
        const inst = (mesh as THREE.InstancedMesh).isInstancedMesh ? (mesh as THREE.InstancedMesh).count : 1;
        rows.push({ name: mesh.name || mesh.parent?.name || mesh.type, triangles: tris * inst, instances: inst });
      });
      return rows.sort((a, b) => b.triangles - a.triangles).slice(0, 15);
    },
    /** Run `seconds` of simulation right now with the given input (deterministic tests). */
    simulate(seconds: number, input: { x?: number; y?: number; run?: boolean; jumpHeld?: boolean; jump?: boolean }) {
      const steps = Math.max(1, Math.round(seconds / PHYSICS.step));
      game.simulateSteps(
        steps,
        { x: input.x ?? 0, y: input.y ?? 0, run: input.run ?? false, jumpHeld: input.jumpHeld ?? false },
        input.jump ?? false,
      );
    },
    play: () => game.play(),
    togglePause: () => game.togglePause(),
  };
}

export type DebugHandle = ReturnType<typeof createDebugHandle>;
