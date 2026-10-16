import * as THREE from 'three';
import { WORLD } from '../config';
import { SKY, SUN_DIRECTION } from './Atmosphere';
import { heightAt } from './IslandShape';

const DEPTH_TEX_SIZE = 256;
/** Water depth (m) that maps to the top of the depth texture's range. */
const DEPTH_RANGE = 8;

/**
 * Stylised animated sea. Colour comes from a baked depth texture (turquoise shallows,
 * deep blue offshore, foam at the waterline). Purely visual: it has no collider.
 */
export class Ocean {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;
  private readonly depthTexture: THREE.DataTexture;

  constructor() {
    this.depthTexture = Ocean.bakeDepth();

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uDepth: { value: null },
          uTerrainSize: { value: WORLD.terrainSize },
          uDepthRange: { value: DEPTH_RANGE },
          uShallow: { value: new THREE.Color('#5fe0cf') },
          uMid: { value: new THREE.Color('#1fa3b5') },
          uDeep: { value: new THREE.Color('#14608e') },
          uFar: { value: new THREE.Color('#0f4a78') },
          uFoam: { value: new THREE.Color('#f4fbf8') },
          uSky: { value: SKY.horizon.clone() },
          uSunDir: { value: SUN_DIRECTION.clone() },
          uCameraPos: { value: new THREE.Vector3() },
        },
      ]),
      vertexShader: /* glsl */ `
        uniform float uTime;
        varying vec3 vWorld;
        varying vec3 vNormal;
        #include <fog_pars_vertex>

        // Sum of a few directional sine waves; returns height and its gradient.
        vec3 waves(vec2 p) {
          float h = 0.0; vec2 g = vec2(0.0);
          vec4 w[4];
          w[0] = vec4(normalize(vec2(1.0, 0.35)), 0.11, 0.090);
          w[1] = vec4(normalize(vec2(-0.6, 1.0)), 0.17, 0.060);
          w[2] = vec4(normalize(vec2(0.3, -1.0)), 0.29, 0.035);
          w[3] = vec4(normalize(vec2(-1.0, -0.4)), 0.47, 0.020);
          for (int i = 0; i < 4; i++) {
            float k = w[i].z; float a = w[i].w;
            float ph = dot(w[i].xy, p) * k + uTime * (0.9 + k * 2.2);
            h += a * sin(ph);
            g += a * k * cos(ph) * w[i].xy;
          }
          return vec3(h, g);
        }

        void main() {
          vec3 p = (modelMatrix * vec4(position, 1.0)).xyz;
          // Calm the swell close to the island so it doesn't clip through the beach.
          float calm = smoothstep(40.0, 90.0, length(p.xz));
          vec3 wv = waves(p.xz) * mix(0.45, 1.0, calm);
          p.y += wv.x;
          vNormal = normalize(vec3(-wv.y, 1.0, -wv.z));
          vWorld = p;
          vec4 mvPosition = viewMatrix * vec4(p, 1.0);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }`,
      fragmentShader: /* glsl */ `
        uniform float uTime;
        uniform sampler2D uDepth;
        uniform float uTerrainSize;
        uniform float uDepthRange;
        uniform vec3 uShallow, uMid, uDeep, uFar, uFoam, uSky, uSunDir, uCameraPos;
        varying vec3 vWorld;
        varying vec3 vNormal;
        #include <fog_pars_fragment>

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
        }

        void main() {
          vec2 uv = vWorld.xz / uTerrainSize + 0.5;
          float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
          float depth = mix(uDepthRange, texture2D(uDepth, uv).r * uDepthRange, inside);

          // Ripple detail on top of the vertex waves.
          vec2 rp = vWorld.xz * 0.35;
          float r1 = vnoise(rp + vec2(uTime * 0.35, uTime * 0.2));
          float r2 = vnoise(rp * 1.9 - vec2(uTime * 0.25, -uTime * 0.3));
          vec3 n = normalize(vNormal + vec3(r1 - 0.5, 0.0, r2 - 0.5) * 0.22);

          vec3 col = mix(uShallow, uMid, smoothstep(0.1, 2.2, depth));
          col = mix(col, uDeep, smoothstep(2.0, 7.0, depth));
          col = mix(col, uFar, smoothstep(120.0, 400.0, length(vWorld.xz)));

          vec3 viewDir = normalize(uCameraPos - vWorld);
          float fresnel = pow(1.0 - max(dot(n, viewDir), 0.0), 4.0);
          col = mix(col, uSky, fresnel * 0.55);

          // Sun glints and soft sheen.
          vec3 h = normalize(uSunDir + viewDir);
          float spec = pow(max(dot(n, h), 0.0), 180.0);
          col += vec3(1.0, 0.95, 0.85) * spec * 1.6;
          col += vec3(1.0, 0.9, 0.7) * pow(max(dot(n, h), 0.0), 12.0) * 0.06;

          // Foam: a lapping band at the waterline plus a few broken streaks.
          float lap = 0.5 + 0.5 * sin(depth * 18.0 - uTime * 1.6 + vnoise(vWorld.xz * 0.5) * 3.0);
          float foamBand = smoothstep(0.45, 0.0, depth) * (0.55 + 0.45 * lap);
          float streaks = smoothstep(0.62, 0.8, vnoise(vWorld.xz * 0.9 + uTime * 0.15)) * smoothstep(1.4, 0.3, depth);
          float foam = clamp(foamBand + streaks * 0.5, 0.0, 1.0) * inside;
          col = mix(col, uFoam, foam * 0.85);

          // Shallows are clear enough to see the sand; deep water is opaque.
          float alpha = mix(0.5, 0.94, smoothstep(0.05, 2.5, depth));
          alpha = max(alpha, foam * 0.9);

          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }`,
    });
    this.material.uniforms.uDepth.value = this.depthTexture;

    const geometry = new THREE.PlaneGeometry(WORLD.oceanSize, WORLD.oceanSize, 320, 320);
    geometry.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geometry, this.material);
    this.mesh.position.y = WORLD.waterLevel;
    this.mesh.renderOrder = 2;
    this.mesh.name = 'ocean';
  }

  /** Water depth below sea level, sampled from the island height function. */
  private static bakeDepth(): THREE.DataTexture {
    const n = DEPTH_TEX_SIZE;
    const data = new Uint8Array(n * n * 4);
    const size = WORLD.terrainSize;
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const x = -size / 2 + ((i + 0.5) / n) * size;
        const z = -size / 2 + ((j + 0.5) / n) * size;
        const depth = Math.min(DEPTH_RANGE, Math.max(0, WORLD.waterLevel - heightAt(x, z)));
        const k = (j * n + i) * 4;
        data[k] = Math.round((depth / DEPTH_RANGE) * 255);
        data[k + 3] = 255;
      }
    }
    const tex = new THREE.DataTexture(data, n, n, THREE.RGBAFormat);
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  }

  update(time: number, camera: THREE.Camera): void {
    this.material.uniforms.uTime.value = time;
    (this.material.uniforms.uCameraPos.value as THREE.Vector3).copy(camera.position);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.depthTexture.dispose();
  }
}
