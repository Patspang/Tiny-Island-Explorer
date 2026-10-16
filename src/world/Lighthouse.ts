import * as THREE from 'three';
import type { PhysicsWorld } from '../physics/PhysicsWorld';
import type { ObstacleInfo } from './World';
export class Lighthouse {
  readonly group = new THREE.Group();
  readonly obstacles: ObstacleInfo[] = [];
  constructor(_p: PhysicsWorld) {}
  update(_dt: number, _t: number): void {}
  dispose(): void {}
}
