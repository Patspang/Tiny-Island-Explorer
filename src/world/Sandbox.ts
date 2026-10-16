import * as THREE from 'three';
import { GROUP, groups, type PhysicsWorld } from '../physics/PhysicsWorld';
import type { GameWorld, ObstacleInfo } from './World';

/**
 * Flat movement test level (open with ?sandbox). Known slopes, steps and walls make
 * controller behaviour easy to check by hand and by automated tests.
 */
export class Sandbox implements GameWorld {
  readonly group = new THREE.Group();
  readonly spawn = new THREE.Vector3(0, 0, 0);
  readonly spawnYaw = 0;
  readonly obstacles: ObstacleInfo[] = [];
  readonly route = [];
  private readonly disposables: Array<{ dispose(): void }> = [];

  /** Test fixtures, in world coordinates. */
  static readonly FIXTURES = {
    wall: { x: 0, z: -12, halfWidth: 4, halfDepth: 0.5, height: 3 },
    rampGentle: { x: -10, z: -6, angleDeg: 25 },
    rampSteep: { x: 10, z: -6, angleDeg: 58 },
    stepLow: { x: -10, z: 8, height: 0.25 },
    stepHigh: { x: 10, z: 8, height: 0.9 },
    pillar: { x: 6, z: 2, radius: 0.8 },
  } as const;

  constructor(private readonly physics: PhysicsWorld) {
    const { rapier, world } = physics;
    const body = physics.createStaticBody();
    const solid = groups(GROUP.terrain, 0xffff);
    const obstacleGroups = groups(GROUP.obstacle, 0xffff);

    const groundMat = this.track(new THREE.MeshStandardMaterial({ color: '#7fb26a', roughness: 0.95 }));
    const blockMat = this.track(new THREE.MeshStandardMaterial({ color: '#d9c7a3', roughness: 0.85 }));
    const accentMat = this.track(new THREE.MeshStandardMaterial({ color: '#c46a4a', roughness: 0.8 }));

    // Ground slab, top at y = 0.
    this.box(80, 1, 80, 0, -0.5, 0, 0, groundMat, body, solid);
    const grid = new THREE.GridHelper(80, 40, '#5f8f4f', '#6f9f5c');
    grid.position.y = 0.01;
    this.group.add(grid);
    this.disposables.push(grid.geometry, grid.material as THREE.Material);

    const F = Sandbox.FIXTURES;
    this.box(F.wall.halfWidth * 2, F.wall.height, F.wall.halfDepth * 2, F.wall.x, F.wall.height / 2, F.wall.z, 0, accentMat, body, obstacleGroups);
    this.obstacles.push({ kind: 'wall', x: F.wall.x, y: 0, z: F.wall.z, radius: F.wall.halfDepth });

    for (const ramp of [F.rampGentle, F.rampSteep]) {
      const a = (ramp.angleDeg * Math.PI) / 180;
      const len = 10;
      // Rotated about X so it rises toward -Z.
      const cy = (Math.sin(a) * len) / 2 - Math.cos(a) * 0.25;
      this.box(4, 0.5, len, ramp.x, cy, ramp.z - (Math.cos(a) * len) / 2, a, blockMat, body, solid);
    }

    this.box(4, F.stepLow.height, 4, F.stepLow.x, F.stepLow.height / 2, F.stepLow.z, 0, blockMat, body, solid);
    this.box(4, F.stepHigh.height, 4, F.stepHigh.x, F.stepHigh.height / 2, F.stepHigh.z, 0, blockMat, body, solid);

    const p = F.pillar;
    const pillarGeo = this.track(new THREE.CylinderGeometry(p.radius, p.radius, 3, 24));
    const pillar = new THREE.Mesh(pillarGeo, accentMat);
    pillar.position.set(p.x, 1.5, p.z);
    pillar.castShadow = pillar.receiveShadow = true;
    this.group.add(pillar);
    world.createCollider(
      rapier.ColliderDesc.cylinder(1.5, p.radius).setTranslation(p.x, 1.5, p.z).setCollisionGroups(obstacleGroups),
      body,
    );
    this.obstacles.push({ kind: 'pillar', x: p.x, y: 0, z: p.z, radius: p.radius });
  }

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  private box(
    w: number,
    h: number,
    d: number,
    x: number,
    y: number,
    z: number,
    rotX: number,
    material: THREE.Material,
    body: ReturnType<PhysicsWorld['createStaticBody']>,
    collisionGroups: number,
  ): void {
    const mesh = new THREE.Mesh(this.track(new THREE.BoxGeometry(w, h, d)), material);
    mesh.position.set(x, y, z);
    mesh.rotation.x = rotX;
    mesh.castShadow = mesh.receiveShadow = true;
    this.group.add(mesh);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, 0, 0));
    this.physics.world.createCollider(
      this.physics.rapier.ColliderDesc.cuboid(w / 2, h / 2, d / 2)
        .setTranslation(x, y, z)
        .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
        .setCollisionGroups(collisionGroups),
      body,
    );
  }

  groundHeight(): number {
    return 0;
  }

  isSafeSpot(): boolean {
    return true;
  }

  update(): void {}

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
