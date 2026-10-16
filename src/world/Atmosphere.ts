import * as THREE from 'three';
import { RENDER } from '../config';

export const SKY = {
  zenith: new THREE.Color('#3f86d6'),
  horizon: new THREE.Color('#bfe0ee'),
  haze: new THREE.Color('#ffe2b5'),
  fog: new THREE.Color('#b9dbe8'),
};

/** Direction the sunlight comes *from* (warm late-morning sun). */
export const SUN_DIRECTION = new THREE.Vector3(0.55, 0.62, 0.42).normalize();

/**
 * Sun, sky fill, sky dome and fog. The sun's shadow camera follows the player so a modest
 * shadow map stays sharp around them.
 */
export class Atmosphere {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  private readonly sky: THREE.Mesh;
  private readonly hemi: THREE.HemisphereLight;
  private readonly shadowTexel: number;
  /** Light-space basis used to snap the shadow camera to whole texels. */
  private readonly lightRight = new THREE.Vector3();
  private readonly lightUp = new THREE.Vector3();
  private readonly lightFwd = SUN_DIRECTION.clone().negate();
  private readonly snapped = new THREE.Vector3();

  constructor(scene: THREE.Scene) {
    scene.fog = new THREE.Fog(SKY.fog, 90, 520);
    scene.background = SKY.horizon.clone();

    this.hemi = new THREE.HemisphereLight('#cde6ff', '#8f8a62', 1.15);
    this.group.add(this.hemi);

    this.sun = new THREE.DirectionalLight('#ffe9c7', 2.9);
    this.sun.castShadow = true;
    const ext = RENDER.shadowExtent;
    const cam = this.sun.shadow.camera;
    cam.left = -ext;
    cam.right = ext;
    cam.top = ext;
    cam.bottom = -ext;
    cam.near = 1;
    cam.far = 220;
    this.sun.shadow.mapSize.set(RENDER.shadowMapSize, RENDER.shadowMapSize);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.035;
    this.sun.shadow.radius = 3;
    this.group.add(this.sun);
    this.group.add(this.sun.target);
    this.shadowTexel = (ext * 2) / RENDER.shadowMapSize;
    this.lightRight.crossVectors(this.lightFwd, new THREE.Vector3(0, 1, 0)).normalize();
    this.lightUp.crossVectors(this.lightRight, this.lightFwd).normalize();

    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(800, 32, 16),
      new THREE.ShaderMaterial({
        side: THREE.BackSide,
        depthWrite: false,
        fog: false,
        uniforms: {
          zenith: { value: SKY.zenith },
          horizon: { value: SKY.horizon },
          haze: { value: SKY.haze },
          sunDir: { value: SUN_DIRECTION },
        },
        vertexShader: /* glsl */ `
          varying vec3 vDir;
          void main() {
            vDir = normalize(position);
            vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            gl_Position = p.xyww;
          }`,
        fragmentShader: /* glsl */ `
          uniform vec3 zenith; uniform vec3 horizon; uniform vec3 haze; uniform vec3 sunDir;
          varying vec3 vDir;
          void main() {
            vec3 d = normalize(vDir);
            float h = clamp(d.y, -1.0, 1.0);
            float up = pow(smoothstep(-0.02, 0.6, h), 0.6);
            vec3 col = mix(horizon, zenith, up);
            float s = max(dot(d, sunDir), 0.0);
            col = mix(col, haze, pow(s, 6.0) * 0.45 * (1.0 - up * 0.6));
            col += vec3(1.0, 0.92, 0.75) * pow(s, 400.0) * 3.0;
            col = mix(col, horizon * 0.95, smoothstep(0.02, -0.1, h));
            gl_FragColor = vec4(col, 1.0);
            #include <tonemapping_fragment>
            #include <colorspace_fragment>
          }`,
      }),
    );
    this.sky.renderOrder = -1;
    this.sky.frustumCulled = false;
    this.group.add(this.sky);

    scene.add(this.group);
  }

  /** Keep the shadow box centred on the player, snapped to texels to avoid shimmering. */
  update(focus: THREE.Vector3, cameraPosition: THREE.Vector3): void {
    const t = this.shadowTexel;
    const a = Math.round(focus.dot(this.lightRight) / t) * t;
    const b = Math.round(focus.dot(this.lightUp) / t) * t;
    const c = focus.dot(this.lightFwd);
    this.snapped
      .copy(this.lightRight)
      .multiplyScalar(a)
      .addScaledVector(this.lightUp, b)
      .addScaledVector(this.lightFwd, c);
    this.sun.target.position.copy(this.snapped);
    this.sun.position.copy(this.snapped).addScaledVector(SUN_DIRECTION, 100);
    this.sky.position.copy(cameraPosition);
  }

  dispose(): void {
    this.sky.geometry.dispose();
    (this.sky.material as THREE.Material).dispose();
    this.sun.shadow.map?.dispose();
  }
}
