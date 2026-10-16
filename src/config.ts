// Central place for every tunable value. Units are metres, seconds, radians.

export const PHYSICS = {
  /** Fixed simulation step. */
  step: 1 / 60,
  /** Longest frame we will try to simulate; anything longer (tab switch, hitch) is dropped. */
  maxFrameTime: 0.15,
  /** Upper bound on physics steps per rendered frame. */
  maxStepsPerFrame: 9,
  gravity: 24,
} as const;

export const PLAYER = {
  /** Capsule: total height = 2 * (halfHeight + radius). */
  capsuleHalfHeight: 0.5,
  capsuleRadius: 0.34,
  /** Gap Rapier keeps between the capsule and the world. */
  skinOffset: 0.03,

  walkSpeed: 4.6,
  runSpeed: 8.2,
  groundAcceleration: 38,
  groundDeceleration: 46,
  airAcceleration: 12,
  airDeceleration: 4,

  jumpHeight: 1.35,
  /** Gravity multiplier while falling, for a less floaty arc. */
  fallGravityMultiplier: 1.35,
  /** Releasing jump early cuts upward velocity by this factor. */
  jumpCutMultiplier: 0.55,
  maxFallSpeed: 30,
  coyoteTime: 0.12,
  jumpBufferTime: 0.14,

  maxSlopeClimbDeg: 46,
  minSlopeSlideDeg: 52,
  autostepHeight: 0.32,
  autostepMinWidth: 0.18,
  snapToGround: 0.35,

  /** Feet this far below water level count as "fell in the sea". */
  drownDepth: 1.1,
  /** Any position below this is out of the world. */
  killPlaneY: -25,
} as const;

export const CAMERA = {
  fov: 55,
  near: 0.1,
  far: 900,
  /** Point the camera looks at, relative to the player's feet. */
  targetHeight: 1.45,
  distance: 7.5,
  minDistance: 2.8,
  maxDistance: 15,
  minPitch: -0.25,
  maxPitch: 1.15,
  defaultPitch: 0.22,
  dragSensitivity: 0.0055,
  wheelSensitivity: 0.0045,
  /** Exponential smoothing rates (higher = snappier). */
  followRate: 14,
  rotationRate: 22,
  zoomRate: 10,
  /** How fast the camera moves back out after an obstruction clears. */
  obstructionRecoverRate: 4,
  collisionPadding: 0.35,
  minCollisionDistance: 1.1,
  /** Minimum clearance above the terrain surface. */
  groundClearance: 0.45,
} as const;

export const WORLD = {
  waterLevel: 0,
  /** Terrain grid covers [-size/2, size/2] on X and Z. */
  terrainSize: 210,
  terrainSegments: 280,
  /** Ocean plane extent. */
  oceanSize: 1600,
  seed: 1337,
} as const;

export const RENDER = {
  maxPixelRatio: 2,
  shadowMapSize: 2048,
  /** Half-size of the sun's shadow box, centred on the player. */
  shadowExtent: 38,
  exposure: 1.0,
} as const;
