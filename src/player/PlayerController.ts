import type RAPIER from '@dimforge/rapier3d-compat';
import * as THREE from 'three';
import { PHYSICS, PLAYER, WORLD } from '../config';
import type { MoveInput } from '../game/InputManager';
import { GROUP, groups, type PhysicsWorld } from '../physics/PhysicsWorld';

const DEG = Math.PI / 180;
const CAPSULE_CENTER = PLAYER.capsuleHalfHeight + PLAYER.capsuleRadius;
const JUMP_VELOCITY = Math.sqrt(2 * PHYSICS.gravity * PLAYER.jumpHeight);
const SAFE_SAMPLE_INTERVAL = 0.4;
/** Spawned/teleported capsules start this far above the ground. Starting inside Rapier's
 *  skin offset lets the character controller slip through the surface. */
const TELEPORT_CLEARANCE = 0.12;
const GROUND_RAY_GROUPS = groups(0xffff, GROUP.terrain | GROUP.obstacle);

export interface SafeSpotTest {
  (x: number, feetY: number, z: number): boolean;
}

/**
 * Authoritative player movement: a kinematic capsule driven by Rapier's character controller.
 * Runs only inside the fixed physics step. Knows nothing about rendering.
 */
export class PlayerController {
  /** Capsule centre after the latest physics step. */
  readonly position = new THREE.Vector3();
  /** Capsule centre after the previous physics step (for render interpolation). */
  readonly previousPosition = new THREE.Vector3();
  /** Intended velocity (input + gravity). */
  readonly velocity = new THREE.Vector3();
  /** Velocity actually achieved in the last step, after collisions. Use for visuals. */
  readonly actualVelocity = new THREE.Vector3();

  grounded = false;
  /** Seconds since the controller was last grounded. */
  airTime = 0;
  /** Set for one step when the player lands; holds the downward impact speed. */
  landedImpact = 0;
  /** Set for one step when a jump starts. */
  justJumped = false;
  /** Increments on every respawn/teleport so cameras and visuals can snap instead of easing. */
  teleportCount = 0;
  jumpCount = 0;
  /** Longest time spent airborne before a jump was allowed (should never exceed coyote time). */
  maxJumpAirTime = 0;

  private readonly body: RAPIER.RigidBody;
  private readonly collider: RAPIER.Collider;
  private readonly kcc: RAPIER.KinematicCharacterController;
  private readonly collisionGroups: number;
  private jumpBuffer = 0;
  private jumpCutAvailable = false;
  private safeTimer = 0;
  private readonly lastSafe = new THREE.Vector3();
  private readonly spawn = new THREE.Vector3();
  private readonly desired = new THREE.Vector3();
  private readonly wish = new THREE.Vector3();

  constructor(
    private readonly physics: PhysicsWorld,
    spawnFeet: THREE.Vector3,
    private readonly isSafeSpot: SafeSpotTest = () => true,
  ) {
    const { rapier, world } = physics;
    this.spawn.copy(spawnFeet);
    this.position.set(spawnFeet.x, spawnFeet.y + CAPSULE_CENTER + TELEPORT_CLEARANCE, spawnFeet.z);
    this.previousPosition.copy(this.position);
    this.lastSafe.copy(this.position);

    this.body = world.createRigidBody(
      rapier.RigidBodyDesc.kinematicPositionBased().setTranslation(this.position.x, this.position.y, this.position.z),
    );
    this.collisionGroups = groups(GROUP.player, GROUP.terrain | GROUP.obstacle | GROUP.boundary);
    this.collider = world.createCollider(
      rapier.ColliderDesc.capsule(PLAYER.capsuleHalfHeight, PLAYER.capsuleRadius).setCollisionGroups(this.collisionGroups),
      this.body,
    );

    this.kcc = world.createCharacterController(PLAYER.skinOffset);
    this.kcc.setUp({ x: 0, y: 1, z: 0 });
    this.kcc.setSlideEnabled(true);
    this.kcc.setMaxSlopeClimbAngle(PLAYER.maxSlopeClimbDeg * DEG);
    this.kcc.setMinSlopeSlideAngle(PLAYER.minSlopeSlideDeg * DEG);
    this.kcc.enableAutostep(PLAYER.autostepHeight, PLAYER.autostepMinWidth, false);
    this.kcc.enableSnapToGround(PLAYER.snapToGround);
    this.kcc.setApplyImpulsesToDynamicBodies(false);
  }

  get feetY(): number {
    return this.position.y - CAPSULE_CENTER;
  }

  /** Achieved ground speed (zero when pushing against a wall). */
  get horizontalSpeed(): number {
    return Math.hypot(this.actualVelocity.x, this.actualVelocity.z);
  }

  get colliderHandle(): number {
    return this.collider.handle;
  }

  /** Queue a jump press; it stays valid for a short buffer window. */
  requestJump(): void {
    this.jumpBuffer = PLAYER.jumpBufferTime;
  }

  fixedUpdate(dt: number, input: MoveInput, cameraYaw: number): void {
    this.previousPosition.copy(this.position);
    this.landedImpact = 0;
    this.justJumped = false;

    // --- Horizontal: camera-relative wish direction, normalised so diagonals aren't faster.
    const sin = Math.sin(cameraYaw);
    const cos = Math.cos(cameraYaw);
    // Camera forward on the ground plane is (-sin, -cos); right is (cos, -sin).
    this.wish.set(input.x * cos - input.y * sin, 0, -input.x * sin - input.y * cos);
    const wishLen = this.wish.length();
    if (wishLen > 1) this.wish.divideScalar(wishLen);

    const maxSpeed = input.run ? PLAYER.runSpeed : PLAYER.walkSpeed;
    const targetX = this.wish.x * maxSpeed;
    const targetZ = this.wish.z * maxSpeed;
    const accelerating = wishLen > 0.01;
    const rate = this.grounded
      ? accelerating
        ? PLAYER.groundAcceleration
        : PLAYER.groundDeceleration
      : accelerating
        ? PLAYER.airAcceleration
        : PLAYER.airDeceleration;
    const dx = targetX - this.velocity.x;
    const dz = targetZ - this.velocity.z;
    const dLen = Math.hypot(dx, dz);
    const maxDelta = rate * dt;
    if (dLen <= maxDelta) {
      this.velocity.x = targetX;
      this.velocity.z = targetZ;
    } else {
      this.velocity.x += (dx / dLen) * maxDelta;
      this.velocity.z += (dz / dLen) * maxDelta;
    }

    // --- Vertical: coyote time + jump buffer, variable jump height, heavier fall.
    this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    const canJump = this.grounded || this.airTime < PLAYER.coyoteTime;
    if (this.jumpBuffer > 0 && canJump && this.velocity.y <= 0.01) {
      this.maxJumpAirTime = Math.max(this.maxJumpAirTime, this.grounded ? 0 : this.airTime);
      this.velocity.y = JUMP_VELOCITY;
      this.jumpBuffer = 0;
      this.grounded = false;
      this.airTime = PLAYER.coyoteTime; // consume coyote time: no second jump in the air
      this.jumpCutAvailable = true;
      this.justJumped = true;
      this.jumpCount++;
    }

    if (this.grounded && this.velocity.y <= 0) {
      // No downward push while grounded: snap-to-ground keeps contact (also downhill).
      // A constant push makes Rapier's controller sink into boxes and stall on trimeshes.
      this.velocity.y = 0;
    } else {
      if (this.jumpCutAvailable && !input.jumpHeld && this.velocity.y > 0) {
        this.velocity.y *= PLAYER.jumpCutMultiplier;
        this.jumpCutAvailable = false;
      }
      const g = PHYSICS.gravity * (this.velocity.y < 0 ? PLAYER.fallGravityMultiplier : 1);
      this.velocity.y = Math.max(-PLAYER.maxFallSpeed, this.velocity.y - g * dt);
    }
    if (this.velocity.y <= 0) this.jumpCutAvailable = false;

    // --- Move through the world.
    this.desired.set(this.velocity.x * dt, this.velocity.y * dt, this.velocity.z * dt);
    this.kcc.computeColliderMovement(this.collider, this.desired, undefined, this.collisionGroups);
    const moved = this.kcc.computedMovement();
    const wasGrounded = this.grounded;
    const fallSpeed = -this.velocity.y;
    this.grounded = this.kcc.computedGrounded();

    this.position.set(this.position.x + moved.x, this.position.y + moved.y, this.position.z + moved.z);
    this.depenetrate();
    this.body.setNextKinematicTranslation(this.position);

    // Actual motion this step (after sliding along walls, stepping, snapping). The intended
    // velocity above is deliberately not reduced on contact: Rapier already slides the motion
    // along obstacles, and zeroing velocity on contact defeats autostep on low ledges.
    this.actualVelocity.set(moved.x / dt, moved.y / dt, moved.z / dt);
    // Bumped a ceiling.
    if (this.velocity.y > 0 && moved.y < this.desired.y * 0.5) this.velocity.y = 0;

    if (this.grounded) {
      if (!wasGrounded && fallSpeed > 0) this.landedImpact = fallSpeed;
      this.airTime = 0;
      if (this.velocity.y < 0) this.velocity.y = 0;
    } else {
      this.airTime += dt;
    }

    // Recover first, so a fall can never be recorded as a "safe" spot in the same step.
    if (!this.checkFallRecovery()) this.trackSafeSpot(dt);
  }

  /**
   * Safety net: if the capsule ever ends up partly inside the ground (e.g. a trimesh edge case),
   * lift it back onto the surface. The ray starts inside the capsule, so only ground that
   * intrudes into the capsule can be hit above the feet.
   */
  private depenetrate(): void {
    const originY = this.position.y + PLAYER.capsuleHalfHeight;
    const reach = PLAYER.capsuleHalfHeight + CAPSULE_CENTER;
    const hit = this.physics.castRay(this.position.x, originY, this.position.z, 0, -1, 0, reach, GROUND_RAY_GROUPS);
    if (hit === null) return;
    const groundY = originY - hit;
    if (groundY > this.feetY + 0.06) {
      this.position.y = groundY + CAPSULE_CENTER + PLAYER.skinOffset;
      if (this.velocity.y < 0) this.velocity.y = 0;
    }
  }

  private trackSafeSpot(dt: number): void {
    this.safeTimer += dt;
    if (!this.grounded || this.safeTimer < SAFE_SAMPLE_INTERVAL) return;
    this.safeTimer = 0;
    const feet = this.feetY;
    const sane = feet > WORLD.waterLevel - PLAYER.drownDepth + 0.5 && feet > PLAYER.killPlaneY + 5;
    if (sane && this.isSafeSpot(this.position.x, feet, this.position.z)) this.lastSafe.copy(this.position);
  }

  /** Returns true if the player was rescued this step. */
  private checkFallRecovery(): boolean {
    const drowned = this.feetY < WORLD.waterLevel - PLAYER.drownDepth;
    if (drowned || this.position.y < PLAYER.killPlaneY) {
      this.teleportCenter(this.lastSafe.x, this.lastSafe.y + TELEPORT_CLEARANCE, this.lastSafe.z);
      return true;
    }
    return false;
  }

  /** Respawn at the start beach. */
  respawn(): void {
    this.teleportFeet(this.spawn.x, this.spawn.y, this.spawn.z);
    this.lastSafe.copy(this.position);
  }

  teleportFeet(x: number, feetY: number, z: number): void {
    this.teleportCenter(x, feetY + CAPSULE_CENTER + TELEPORT_CLEARANCE, z);
  }

  private teleportCenter(x: number, y: number, z: number): void {
    this.position.set(x, y, z);
    this.previousPosition.copy(this.position);
    this.velocity.set(0, 0, 0);
    this.actualVelocity.set(0, 0, 0);
    this.body.setTranslation(this.position, true);
    this.body.setNextKinematicTranslation(this.position);
    this.grounded = false;
    this.airTime = PLAYER.coyoteTime;
    this.jumpBuffer = 0;
    this.teleportCount++;
  }

  dispose(): void {
    this.physics.world.removeCharacterController(this.kcc);
    this.physics.world.removeRigidBody(this.body);
  }
}

export const PLAYER_CAPSULE_CENTER = CAPSULE_CENTER;
