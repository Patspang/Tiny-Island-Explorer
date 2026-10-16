import * as THREE from 'three';
import { GROUP, groups, type PhysicsWorld } from '../physics/PhysicsWorld';
import { ISLET, type Pillar } from './IslandShape';
import { createRng } from './noise';
import type { ObstacleInfo } from './World';

const SEABED = -8;

/** Stepping stones out to a small sea rock off the western cove (a lens piece waits on top). */
export class Islet {
  readonly group = new THREE.Group();
  readonly obstacles: ObstacleInfo[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(physics: PhysicsWorld) {
    const rng = createRng(4711);
    const body = physics.createStaticBody();
    const solid = groups(GROUP.obstacle, 0xffff);
    const stone = this.track(new THREE.MeshStandardMaterial({ color: '#a59b8c', roughness: 0.95, flatShading: true }));
    const wet = this.track(new THREE.MeshStandardMaterial({ color: '#6f6a60', roughness: 0.6, flatShading: true }));
    const moss = this.track(new THREE.MeshStandardMaterial({ color: '#7aa24a', roughness: 1 }));

    const pillar = (p: Pillar, segments: number) => {
      const height = p.top - SEABED;
      const geo = this.track(new THREE.CylinderGeometry(p.radius * 0.92, p.radius * 1.25, height, segments, 4));
      // Irregular, eroded silhouette; the top stays flat so landing is predictable.
      const pos = geo.getAttribute('position');
      const seen = new Map<string, number>();
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y >= height / 2 - 1e-3) continue;
        const key = `${pos.getX(i).toFixed(3)},${y.toFixed(3)},${pos.getZ(i).toFixed(3)}`;
        let k = seen.get(key);
        if (k === undefined) {
          k = 1 + (rng() - 0.5) * 0.22;
          seen.set(key, k);
        }
        pos.setXYZ(i, pos.getX(i) * k, y, pos.getZ(i) * k);
      }
      geo.computeVertexNormals();
      const mesh = new THREE.Mesh(geo, stone);
      mesh.position.set(p.x, SEABED + height / 2, p.z);
      mesh.rotation.y = rng() * Math.PI;
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      // Dark wet band at the waterline.
      const band = new THREE.Mesh(this.track(new THREE.CylinderGeometry(p.radius * 1.06, p.radius * 1.12, 0.5, segments)), wet);
      band.position.set(p.x, 0, p.z);
      this.group.add(band);
      // Mossy cap.
      const cap = new THREE.Mesh(this.track(new THREE.CylinderGeometry(p.radius * 0.8, p.radius * 0.9, 0.06, segments)), moss);
      cap.position.set(p.x, p.top + 0.02, p.z);
      cap.receiveShadow = true;
      this.group.add(cap);

      physics.world.createCollider(
        physics.rapier.ColliderDesc.cylinder(height / 2, p.radius).setTranslation(p.x, SEABED + height / 2, p.z).setCollisionGroups(solid),
        body,
      );
      this.obstacles.push({ kind: 'stone', x: p.x, y: p.top, z: p.z, radius: p.radius });
    };

    for (const s of ISLET.stones) pillar(s, 9);
    pillar(ISLET.rock, 14);
  }

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}
