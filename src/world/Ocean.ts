import * as THREE from 'three';
export class Ocean {
  readonly mesh = new THREE.Mesh(new THREE.PlaneGeometry(1600, 1600).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#2a8fb0' }));
  update(_t: number, _c: THREE.Camera): void {}
  dispose(): void {}
}
