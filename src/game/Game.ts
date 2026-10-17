import * as THREE from 'three';
import { AudioEngine } from '../audio/AudioEngine';
import { Sparkles } from '../fx/Sparkles';
import { Wildlife } from '../fx/Wildlife';
import { CAMERA, PHYSICS, PLAYER, RENDER } from '../config';
import { FollowCamera } from '../camera/FollowCamera';
import { GROUP, groups, PhysicsWorld } from '../physics/PhysicsWorld';
import { PlayerController, PLAYER_CAPSULE_CENTER } from '../player/PlayerController';
import { GroundEffects } from '../player/GroundEffects';
import { PlayerVisual, type PlayerVisualState } from '../player/PlayerVisual';
import { Quest } from '../quest/Quest';
import { Atmosphere } from '../world/Atmosphere';
import type { GameWorld } from '../world/World';
import { InputManager, type MoveInput } from './InputManager';

/** 'overlay' = gameplay suspended behind a story screen (no pause menu). */
export type GameState = 'title' | 'playing' | 'paused' | 'overlay';

export type QuestUiEvent =
  | { type: 'collect'; collected: number; total: number; label: string }
  | { type: 'complete' }
  | { type: 'finaleStart' }
  | { type: 'hint'; label: string }
  | { type: 'doorLocked'; missing: number }
  | { type: 'done' };
export type WorldFactory = (physics: PhysicsWorld, scene: THREE.Scene) => GameWorld;

const SHADOW_RAY_GROUPS = groups(0xffff, GROUP.terrain | GROUP.obstacle);

/**
 * Owns the renderer, the fixed-timestep loop and the wiring between input, physics,
 * the player, the camera and the world. Gameplay rules live in the systems themselves.
 */
export class Game {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly input: InputManager;
  readonly followCamera: FollowCamera;
  readonly player: PlayerController;
  readonly visual: PlayerVisual;
  readonly audio = new AudioEngine();
  private readonly sparkles = new Sparkles();
  readonly wildlife: Wildlife;
  private readonly effects = new GroundEffects({
    footstep: (surface, strength) => this.audio.footstep(surface, strength),
    jump: () => this.audio.jump(),
    land: (impact, surface) => this.audio.land(impact, surface),
  });
  private readonly drawingSize = new THREE.Vector2();
  readonly world: GameWorld;
  readonly atmosphere: Atmosphere;
  readonly quest: Quest | null;
  onQuest: (e: QuestUiEvent) => void = () => {};
  private questDoneSent = false;
  private readonly sparkled: boolean[] = [];

  state: GameState = 'title';
  onStateChange: (state: GameState) => void = () => {};

  private readonly timer = new THREE.Timer();
  private accumulator = 0;
  private simTime = 0;
  private renderTime = 0;
  private frameHandle = 0;
  private lastTeleportSeen = 0;
  private readonly moveInput: MoveInput = { x: 0, y: 0, run: false, jumpHeld: false };
  private readonly renderFeet = new THREE.Vector3();
  private fpsFrames = 0;
  private fpsTime = 0;
  fps = 0;
  stepsLastFrame = 0;
  /** Debug-only fixed camera (screenshots). */
  cameraOverride: { position: THREE.Vector3; target: THREE.Vector3 } | null = null;

  constructor(
    private readonly container: HTMLElement,
    readonly physics: PhysicsWorld,
    worldFactory: WorldFactory,
  ) {
    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = RENDER.exposure;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.domElement.classList.add('game-canvas');
    container.appendChild(this.renderer.domElement);

    this.atmosphere = new Atmosphere(this.scene);
    this.world = worldFactory(physics, this.scene);
    this.scene.add(this.world.group);

    this.input = new InputManager();
    this.followCamera = new FollowCamera(this.renderer.domElement, physics, (x, z) => this.world.groundHeight(x, z));
    this.player = new PlayerController(physics, this.world.spawn, (x, y, z) => this.world.isSafeSpot(x, y, z));
    this.visual = new PlayerVisual();
    this.wildlife = new Wildlife(this.world.habitats ?? { meadows: [], woods: [], coast: [] }, (x, z) => this.world.groundHeight(x, z));
    this.scene.add(this.wildlife.group);
    this.scene.add(this.visual.root, this.visual.shadowMesh, this.effects.group, this.sparkles.points);

    const layout = this.world.quest;
    this.quest = layout
      ? new Quest(layout.spots, layout.goal, {
          onCollect: (collected, total, label) => {
            this.world.setQuestProgress?.(collected, total);
            this.audio.collect(collected - 1, total);
            this.burstNewlyCollected();
            this.onQuest({ type: 'collect', collected, total, label });
          },
          onHint: (label) => {
            this.audio.hint();
            this.onQuest({ type: 'hint', label });
          },
          onDoorLocked: (missing) => {
            this.audio.doorLocked();
            this.onQuest({ type: 'doorLocked', missing });
          },
          onComplete: () => {
            this.audio.complete();
            this.onQuest({ type: 'complete' });
          },
          onFinaleStart: () => {
            this.audio.finale();
            const lamp = this.world.lampPosition?.();
            if (lamp) this.sparkles.shower(lamp);
            this.onQuest({ type: 'finaleStart' });
          },
        })
      : null;
    if (this.quest) {
      this.scene.add(this.quest.group);
      this.world.setQuestProgress?.(0, this.quest.total);
    }

    // Rapier's scene queries need one step before colliders are visible to the character controller.
    physics.step();

    this.input.onAction('KeyR', () => {
      if (this.state === 'playing') this.player.respawn();
    });
    this.input.onAction('KeyM', () => this.audio.toggleMute());
    this.input.onAction('Escape', () => this.togglePause());
    this.input.onAction('KeyP', () => this.togglePause());
    window.addEventListener('blur', this.onBlur);
    window.addEventListener('resize', this.onResize);
    this.onResize();

    this.renderFeet.copy(this.world.spawn);
    this.followCamera.snapTo(this.renderFeet, this.world.spawnYaw, CAMERA.defaultPitch);
  }

  start(): void {
    this.timer.connect(document);
    const frame = (timestamp: number) => {
      this.frameHandle = requestAnimationFrame(frame);
      this.timer.update(timestamp);
      this.tick();
    };
    this.frameHandle = requestAnimationFrame(frame);
  }

  play(): void {
    if (this.state === 'title') {
      this.player.respawn();
      this.followCamera.snapTo(this.world.spawn, this.world.spawnYaw, CAMERA.defaultPitch);
    }
    this.setState('playing');
  }

  /** Suspend play behind a story overlay (e.g. the finale screen). */
  showOverlay(): void {
    if (this.state === 'playing') this.setState('overlay');
  }

  resume(): void {
    if (this.state === 'paused' || this.state === 'overlay') this.setState('playing');
  }

  togglePause(): void {
    if (this.state === 'playing') this.setState('paused');
    else if (this.state === 'paused') this.setState('playing');
  }

  private setState(state: GameState): void {
    this.state = state;
    const active = state === 'playing';
    this.input.enabled = active;
    this.followCamera.enabled = active;
    this.audio.setPaused(state === 'paused' || state === 'overlay');
    if (!active) {
      this.input.clear();
      this.followCamera.cancelDrag();
    }
    this.onStateChange(state);
  }

  private onBlur = () => {
    this.input.clear();
    this.followCamera.cancelDrag();
  };

  private onResize = () => {
    const w = this.container.clientWidth || window.innerWidth;
    const h = this.container.clientHeight || window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDER.maxPixelRatio, this.pixelRatioCap));
    this.renderer.setSize(w, h, false);
    this.followCamera.setAspect(w / h);
  };

  private tick(): void {
    const frameDt = Math.min(this.timer.getDelta(), PHYSICS.maxFrameTime);
    this.renderTime += frameDt;
    this.trackFps(frameDt);

    // --- Fixed-step simulation.
    let steps = 0;
    if (this.state === 'playing') {
      this.accumulator += frameDt;
      const presses = this.input.consumeJumpPresses();
      if (presses > 0) this.player.requestJump();
      while (this.accumulator >= PHYSICS.step && steps < PHYSICS.maxStepsPerFrame) {
        this.input.read(this.moveInput);
        this.player.fixedUpdate(PHYSICS.step, this.moveInput, this.followCamera.movementYaw);
        this.quest?.fixedUpdate(PHYSICS.step, this.player.position);
        this.physics.step();
        this.accumulator -= PHYSICS.step;
        this.simTime += PHYSICS.step;
        steps++;
        this.syncVisualEvents();
      }
      // Too far behind: drop the backlog rather than spiral.
      if (steps === PHYSICS.maxStepsPerFrame) this.accumulator = 0;
    } else {
      this.accumulator = 0;
    }
    this.stepsLastFrame = steps;

    // --- Interpolated render state.
    const alpha = this.state === 'playing' ? this.accumulator / PHYSICS.step : 1;
    const p = this.player;
    this.renderFeet.lerpVectors(p.previousPosition, p.position, alpha);
    // Drop the controller's skin gap so boots touch the ground.
    this.renderFeet.y -= PLAYER_CAPSULE_CENTER + PLAYER.skinOffset;

    const snap = p.teleportCount !== this.lastTeleportSeen;
    if (snap) {
      this.lastTeleportSeen = p.teleportCount;
      this.followCamera.snapTo(this.renderFeet);
    }

    if (this.state === 'title') {
      // Slow attract orbit behind the title screen.
      this.followCamera.setTargetYaw(this.followCamera.yaw + frameDt * 0.12);
    }
    this.followCamera.update(frameDt, this.renderFeet);
    if (this.cameraOverride) {
      this.followCamera.camera.position.copy(this.cameraOverride.position);
      this.followCamera.camera.lookAt(this.cameraOverride.target);
    }

    const groundY = this.groundBelow(p.position);
    const visualState: PlayerVisualState = {
      feet: this.renderFeet,
      velocity: p.actualVelocity,
      grounded: p.grounded,
      landedImpact: this.pendingImpact,
      justJumped: this.pendingJump,
      snap,
    };
    this.visual.update(frameDt, visualState, groundY);
    this.renderer.getDrawingBufferSize(this.drawingSize);
    this.effects.update(frameDt, visualState, this.world, this.followCamera.camera, this.drawingSize.y);
    this.wildlife.update(frameDt, this.renderTime, this.quest?.duskLevel ?? 0, this.renderFeet, this.followCamera.camera, this.drawingSize.y);
    this.audio.update(frameDt, {
      coast: this.world.coastProximity?.(this.renderFeet.x, this.renderFeet.z) ?? 0.5,
      height: THREE.MathUtils.clamp(this.renderFeet.y / 15, 0, 1),
      dusk: this.quest?.duskLevel ?? 0,
      rustle: this.effects.rustle,
    });
    this.pendingImpact = 0;
    this.pendingJump = false;

    this.updateQuestPresentation(frameDt);
    this.atmosphere.update(this.renderFeet, this.followCamera.camera.position, this.renderTime);
    this.world.update(frameDt, this.renderTime, this.followCamera.camera, this.renderFeet);
    this.renderer.render(this.scene, this.followCamera.camera);
  }

  /** Sparkle burst at whichever piece was just picked up. */
  private burstNewlyCollected(): void {
    const q = this.quest;
    if (!q) return;
    q.spots.forEach((spot, i) => {
      if (q.isCollected(i) && !this.sparkled[i]) {
        this.sparkled[i] = true;
        this.sparkles.burst(spot.position);
      }
    });
  }

  private updateQuestPresentation(dt: number): void {
    const q = this.quest;
    this.renderer.getDrawingBufferSize(this.drawingSize);
    this.sparkles.update(dt, this.followCamera.camera, this.drawingSize.y);
    if (!q) return;
    q.update(dt, this.renderTime, this.followCamera.camera.position);
    const cam = this.followCamera.camera.position;
    q.spots.forEach((spot, i) => {
      if (!q.isCollected(i) && spot.position.distanceToSquared(cam) < 60 * 60) this.sparkles.glint(spot.position, dt);
    });
    this.world.setLighthouseLight?.(q.lightLevel);
    this.atmosphere.setDusk(q.duskLevel);
    this.world.setDusk?.(q.duskLevel, this.atmosphere.horizon);
    if (q.state === 'done' && !this.questDoneSent) {
      this.questDoneSent = true;
      this.onQuest({ type: 'done' });
    }
  }

  /**
   * Advance the simulation synchronously with a given input (debug/tests only). Uses the same
   * fixed-step player, quest and physics code as the frame loop; only the keyboard is bypassed.
   */
  simulateSteps(steps: number, input: MoveInput, jumpPressed = false): void {
    if (this.state !== 'playing') return;
    if (jumpPressed) this.player.requestJump();
    for (let i = 0; i < steps; i++) {
      this.player.fixedUpdate(PHYSICS.step, input, this.followCamera.movementYaw);
      this.quest?.fixedUpdate(PHYSICS.step, this.player.position);
      this.physics.step();
      this.simTime += PHYSICS.step;
      this.syncVisualEvents();
    }
  }

  // One-step events from physics, latched until the next rendered frame.
  private pendingImpact = 0;
  private pendingJump = false;
  private syncVisualEvents(): void {
    if (this.player.landedImpact > 0) this.pendingImpact = Math.max(this.pendingImpact, this.player.landedImpact);
    if (this.player.justJumped) this.pendingJump = true;
  }

  private groundBelow(center: THREE.Vector3): number | null {
    const hit = this.physics.castRay(center.x, center.y, center.z, 0, -1, 0, 12, SHADOW_RAY_GROUPS);
    return hit === null ? null : center.y - hit;
  }

  private trackFps(dt: number): void {
    this.fpsFrames++;
    this.fpsTime += dt;
    if (this.fpsTime >= 0.5) {
      this.fps = this.fpsFrames / this.fpsTime;
      this.fpsFrames = 0;
      this.fpsTime = 0;
      this.adaptResolution();
    }
  }

  /**
   * Safety net for slower GPUs: if play stays below ~45 fps for a few seconds on a high-density
   * screen, render at a lower pixel ratio. One-way and stepwise, so it never oscillates.
   */
  private slowSamples = 0;
  private pixelRatioCap = Infinity;
  private adaptResolution(): void {
    if (this.state !== 'playing') return;
    this.slowSamples = this.fps < 45 ? this.slowSamples + 1 : 0;
    const ratio = this.renderer.getPixelRatio();
    if (this.slowSamples >= 8 && ratio > 1) {
      this.slowSamples = 0;
      this.pixelRatioCap = Math.max(1, ratio - 0.5);
      this.onResize();
    }
  }

  get simulationTime(): number {
    return this.simTime;
  }

  get feetPosition(): THREE.Vector3 {
    return this.renderFeet;
  }

  dispose(): void {
    cancelAnimationFrame(this.frameHandle);
    window.removeEventListener('blur', this.onBlur);
    window.removeEventListener('resize', this.onResize);
    this.input.dispose();
    this.followCamera.dispose();
    this.player.dispose();
    this.visual.dispose();
    this.effects.dispose();
    this.audio.dispose();
    this.sparkles.dispose();
    this.wildlife.dispose();
    this.world.dispose();
    this.quest?.dispose();
    this.atmosphere.dispose();
    this.timer.dispose();
    this.renderer.dispose();
    this.physics.dispose();
    this.renderer.domElement.remove();
  }
}
