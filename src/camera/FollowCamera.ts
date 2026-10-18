import * as THREE from 'three';
import { CAMERA, WORLD } from '../config';
import { CAMERA_RAY_GROUPS, type PhysicsWorld } from '../physics/PhysicsWorld';

export type GroundHeightFn = (x: number, z: number) => number;

const damp = (rate: number, dt: number) => 1 - Math.exp(-rate * dt);

function wrapAngle(a: number): number {
  return Math.atan2(Math.sin(a), Math.cos(a));
}

/**
 * Third-person orbit camera. Mouse drag orbits, wheel zooms, raycasts keep it out of
 * terrain and rocks. Orientation is independent of the player model's rotation.
 */
export class FollowCamera {
  readonly camera: THREE.PerspectiveCamera;

  /** Orbit angles. yaw=0 places the camera on +Z looking toward -Z. */
  yaw = 0;
  pitch: number = CAMERA.defaultPitch;
  private targetYaw = 0;
  private targetPitch: number = CAMERA.defaultPitch;
  private distance: number = CAMERA.distance;
  private targetDistance: number = CAMERA.distance;
  /** Distance actually used after collision; recovers outward slowly. */
  private effectiveDistance: number = CAMERA.distance;

  private readonly focus = new THREE.Vector3();
  private readonly dir = new THREE.Vector3();
  private dragging = false;
  /** Fingers currently on the canvas, for two-finger pinch zoom. */
  private readonly touches = new Map<number, { x: number; y: number }>();
  private pinchDistance = 0;
  private lastPointer = { x: 0, y: 0 };
  private activePointer: number | null = null;
  enabled = false;

  constructor(
    private readonly dom: HTMLElement,
    private readonly physics: PhysicsWorld,
    private readonly groundHeight: GroundHeightFn,
  ) {
    this.camera = new THREE.PerspectiveCamera(CAMERA.fov, 1, CAMERA.near, CAMERA.far);
    dom.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    window.addEventListener('pointercancel', this.onPointerUp);
    dom.addEventListener('wheel', this.onWheel, { passive: false });
    dom.addEventListener('contextmenu', this.onContextMenu);
  }

  /** Horizontal yaw used for camera-relative movement. */
  get movementYaw(): number {
    return this.yaw;
  }

  get currentDistance(): number {
    return this.effectiveDistance;
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Jump straight to a view without easing (spawn, respawn, tests). */
  snapTo(target: THREE.Vector3, yaw = this.targetYaw, pitch = this.targetPitch): void {
    this.targetYaw = this.yaw = wrapAngle(yaw);
    this.targetPitch = this.pitch = THREE.MathUtils.clamp(pitch, CAMERA.minPitch, CAMERA.maxPitch);
    this.distance = this.targetDistance;
    this.effectiveDistance = this.distance;
    this.focus.set(target.x, target.y + CAMERA.targetHeight, target.z);
    this.place(1, true);
  }

  setTargetYaw(yaw: number): void {
    this.targetYaw = yaw;
  }

  update(dt: number, playerFeet: THREE.Vector3): void {
    // Rotation: ease along the shortest arc.
    const dy = wrapAngle(this.targetYaw - this.yaw);
    this.yaw = wrapAngle(this.yaw + dy * damp(CAMERA.rotationRate, dt));
    this.targetYaw = this.yaw + wrapAngle(this.targetYaw - this.yaw);
    this.pitch += (this.targetPitch - this.pitch) * damp(CAMERA.rotationRate, dt);
    this.distance += (this.targetDistance - this.distance) * damp(CAMERA.zoomRate, dt);

    // Follow the player's upper body with light smoothing (no lag spikes).
    const fx = playerFeet.x;
    const fy = playerFeet.y + CAMERA.targetHeight;
    const fz = playerFeet.z;
    const f = damp(CAMERA.followRate, dt);
    this.focus.x += (fx - this.focus.x) * f;
    this.focus.y += (fy - this.focus.y) * f;
    this.focus.z += (fz - this.focus.z) * f;
    // Never let the focus trail far behind (e.g. fast falls).
    const lagSq = (fx - this.focus.x) ** 2 + (fy - this.focus.y) ** 2 + (fz - this.focus.z) ** 2;
    if (lagSq > 4) this.focus.set(fx, fy, fz);

    this.place(dt, false);
  }

  private place(dt: number, snap: boolean): void {
    const cp = Math.cos(this.pitch);
    this.dir.set(Math.sin(this.yaw) * cp, Math.sin(this.pitch), Math.cos(this.yaw) * cp);

    // Pull in toward the player when solid scenery is between player and camera.
    let allowed = this.distance;
    const hit = this.physics.castRay(
      this.focus.x,
      this.focus.y,
      this.focus.z,
      this.dir.x,
      this.dir.y,
      this.dir.z,
      this.distance + CAMERA.collisionPadding,
      CAMERA_RAY_GROUPS,
    );
    if (hit !== null) allowed = Math.max(CAMERA.minCollisionDistance, hit - CAMERA.collisionPadding);

    // Move in immediately (never clip), ease back out once clear.
    if (snap || allowed < this.effectiveDistance) this.effectiveDistance = allowed;
    else this.effectiveDistance += (allowed - this.effectiveDistance) * damp(CAMERA.obstructionRecoverRate, dt);

    const cam = this.camera.position;
    cam.copy(this.focus).addScaledVector(this.dir, this.effectiveDistance);

    // Keep clear of the ground and the water surface even between ray hits.
    const minY = Math.max(this.groundHeight(cam.x, cam.z), WORLD.waterLevel) + CAMERA.groundClearance;
    if (cam.y < minY) cam.y = minY;

    this.camera.lookAt(this.focus);
  }

  // --- Pointer input -------------------------------------------------------------------------

  private onPointerDown = (e: PointerEvent) => {
    if (!this.enabled || (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 2)) return;
    if (e.pointerType === 'touch') {
      this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (this.touches.size === 2) {
        // A second finger turns the drag into a pinch.
        this.dragging = false;
        this.activePointer = null;
        this.pinchDistance = this.touchSpread();
        return;
      }
      if (this.touches.size > 2) return;
    }
    this.dragging = true;
    this.activePointer = e.pointerId;
    this.lastPointer = { x: e.clientX, y: e.clientY };
  };

  private onPointerMove = (e: PointerEvent) => {
    const finger = this.touches.get(e.pointerId);
    if (finger) {
      finger.x = e.clientX;
      finger.y = e.clientY;
      if (this.touches.size >= 2 && this.pinchDistance > 0) {
        const d = this.touchSpread();
        // Fingers apart = closer, together = further away.
        this.targetDistance = THREE.MathUtils.clamp(
          (this.targetDistance * this.pinchDistance) / Math.max(d, 1),
          CAMERA.minDistance,
          CAMERA.maxDistance,
        );
        this.pinchDistance = d;
        return;
      }
    }
    if (!this.dragging || e.pointerId !== this.activePointer) return;
    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    this.lastPointer = { x: e.clientX, y: e.clientY };
    this.targetYaw -= dx * CAMERA.dragSensitivity;
    this.targetPitch = THREE.MathUtils.clamp(
      this.targetPitch + dy * CAMERA.dragSensitivity,
      CAMERA.minPitch,
      CAMERA.maxPitch,
    );
  };

  private touchSpread(): number {
    const [a, b] = [...this.touches.values()];
    return Math.hypot(a.x - b.x, a.y - b.y);
  }

  private onPointerUp = (e: PointerEvent) => {
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinchDistance = 0;
    if (e.pointerId === this.activePointer) {
      this.dragging = false;
      this.activePointer = null;
    }
  };

  private onWheel = (e: WheelEvent) => {
    if (!this.enabled) return;
    e.preventDefault();
    this.targetDistance = THREE.MathUtils.clamp(
      this.targetDistance * Math.exp(e.deltaY * CAMERA.wheelSensitivity * 0.25),
      CAMERA.minDistance,
      CAMERA.maxDistance,
    );
  };

  private onContextMenu = (e: Event) => e.preventDefault();

  /** Stop any drag in progress (focus loss, pause). */
  cancelDrag(): void {
    this.dragging = false;
    this.touches.clear();
    this.pinchDistance = 0;
    this.activePointer = null;
  }

  get zoomTarget(): number {
    return this.targetDistance;
  }

  dispose(): void {
    this.dom.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    window.removeEventListener('pointercancel', this.onPointerUp);
    this.dom.removeEventListener('wheel', this.onWheel);
    this.dom.removeEventListener('contextmenu', this.onContextMenu);
  }
}
