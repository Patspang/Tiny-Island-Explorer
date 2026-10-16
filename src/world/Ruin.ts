import * as THREE from 'three';
import { GROUP, groups, type PhysicsWorld } from '../physics/PhysicsWorld';
import { heightAt, RUIN } from './IslandShape';
import { createRng } from './noise';
import type { ObstacleInfo } from './World';

/**
 * A weathered stone plinth with a few fallen blocks. Its top (1 m) is above auto-step
 * height, so reaching it takes a jump; the fallen blocks make a friendlier two-hop route.
 */
export class Ruin {
  readonly group = new THREE.Group();
  readonly obstacles: ObstacleInfo[] = [];
  private readonly disposables: Array<{ dispose(): void }> = [];

  constructor(physics: PhysicsWorld) {
    const rng = createRng(909);
    const groundY = heightAt(RUIN.x, RUIN.z);
    const body = physics.createStaticBody();
    const solid = groups(GROUP.obstacle, 0xffff);
    const stone = this.track(new THREE.MeshStandardMaterial({ color: '#b5aa96', roughness: 0.95, flatShading: true }));
    const moss = this.track(new THREE.MeshStandardMaterial({ color: '#6f9a45', roughness: 1 }));

    const block = (w: number, h: number, d: number, x: number, z: number, rotY: number, sink = 0.25) => {
      // Sink each block into the ground so slopes never leave a gap underneath.
      const baseY = Math.min(heightAt(x - w / 2, z - d / 2), heightAt(x + w / 2, z + d / 2), heightAt(x, z)) - sink;
      const top = heightAt(x, z) + h;
      const fullH = top - baseY;
      const geo = this.track(new THREE.BoxGeometry(w, fullH, d, 2, 2, 2));
      roughen(geo, 0.05, rng);
      const mesh = new THREE.Mesh(geo, stone);
      mesh.position.set(x, baseY + fullH / 2, z);
      mesh.rotation.y = rotY;
      mesh.castShadow = mesh.receiveShadow = true;
      this.group.add(mesh);
      // Moss cap on top.
      const cap = new THREE.Mesh(this.track(new THREE.BoxGeometry(w * 0.85, 0.06, d * 0.7)), moss);
      cap.position.set(x, top + 0.02, z);
      cap.rotation.y = rotY + 0.2;
      cap.receiveShadow = true;
      this.group.add(cap);
      const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
      physics.world.createCollider(
        physics.rapier.ColliderDesc.cuboid(w / 2, fullH / 2, d / 2)
          .setTranslation(x, baseY + fullH / 2, z)
          .setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
          .setCollisionGroups(solid),
        body,
      );
      this.obstacles.push({ kind: 'ruin', x, y: groundY, z, radius: Math.min(w, d) / 2 });
    };

    const s = RUIN.halfSize * 2;
    block(s, RUIN.height, s, RUIN.x, RUIN.z, 0.3);
    // A broken column stub on one corner, and fallen blocks as stepping stones.
    block(0.45, RUIN.height + 0.7, 0.45, RUIN.x - 0.55, RUIN.z - 0.5, 0.5, 0.1);
    block(0.9, 0.5, 0.7, RUIN.x + 1.7, RUIN.z + 0.6, 0.8);
    block(0.7, 0.42, 0.6, RUIN.x - 1.2, RUIN.z + 1.9, -0.4);
  }

  private track<T extends { dispose(): void }>(d: T): T {
    this.disposables.push(d);
    return d;
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
  }
}

function roughen(geo: THREE.BufferGeometry, amount: number, rng: () => number): void {
  const pos = geo.getAttribute('position');
  const offsets = new Map<string, number[]>();
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(3)},${pos.getY(i).toFixed(3)},${pos.getZ(i).toFixed(3)}`;
    let o = offsets.get(key);
    if (!o) {
      o = [(rng() - 0.5) * amount, (rng() - 0.5) * amount, (rng() - 0.5) * amount];
      offsets.set(key, o);
    }
    pos.setXYZ(i, pos.getX(i) + o[0], pos.getY(i) + o[1], pos.getZ(i) + o[2]);
  }
  geo.computeVertexNormals();
}
