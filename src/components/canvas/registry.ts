import * as THREE from 'three';

/**
 * components/canvas/registry.ts
 *
 * The contract between Sanity and the WebGL layer.
 *
 * Editors pick a scene from a dropdown in the Studio (`project.sceneId`,
 * `service.elementId`). Those values are plain strings by the time they reach the browser, so
 * something has to turn a string into a render configuration — and that something has to be
 * unable to fail, because it runs inside the render loop where a thrown error unmounts the
 * canvas and takes the whole page's hero with it.
 *
 * Hence: a frozen lookup table plus resolvers that fall back rather than throw. The Studio's
 * enum prevents invalid values being *authored*; this file prevents them from *mattering* if
 * one arrives anyway (a renamed key, a stale draft, a hand-edited dataset).
 *
 * WHY DATA AND NOT COMPONENTS:
 * The obvious design is `SCENE_REGISTRY[id] = SomeSceneComponent`. That means every scene's
 * code is in the bundle even though a given page renders one, and it makes scene selection a
 * component swap — which remounts geometry, reallocates buffers and recompiles shaders on
 * every navigation. Instead each entry is a *uniform preset* over the same material. Switching
 * scenes then becomes tweening numbers, which is both free and animatable: the transition
 * between two projects' scenes can be a GSAP tween across their presets.
 */

/* ---------------------------------------------------------------------------
 * Scene presets
 * ------------------------------------------------------------------------- */

/**
 * The tunable surface of the fluid material, as plain data.
 *
 * Every field maps 1:1 to a uniform in `shaders/fluid/`. Keeping the shapes identical means the
 * apply step is a loop, not a hand-written mapping that drifts out of date.
 */
export interface ScenePreset {
  /** Human label, shown in the Studio dropdown and in dev overlays. */
  label: string;
  /** One-line description of the visual intent, for editors choosing between them. */
  description: string;

  /* --- Geometry --- */
  /** Multiplier on the base blob radius. */
  scale: number;
  /** Multiplies the tier's `blobDetail`. Lets a coarse look stay coarse on a fast GPU. */
  detailMultiplier: number;

  /* --- Displacement --- */
  distort: number;
  frequency: number;
  speed: number;
  /** 0 = billowing FBM, 1 = sharp ridged crests. */
  ridgeMix: number;
  twist: number;

  /* --- Pointer response --- */
  pointerStrength: number;
  pointerRadius: number;
  /** Negative pushes the surface away from the cursor (a dent), positive pulls it out. */
  pointerPush: number;

  /* --- Surface --- */
  fresnelPower: number;
  fresnelIntensity: number;
  iridescence: number;
  roughness: number;
  envIntensity: number;
  grain: number;

  /* --- Palette: hex strings, converted once at module init --- */
  colorA: string;
  colorB: string;
  colorC: string;

  /* --- Companions --- */
  /** Particle field density multiplier against the tier's `particleCount`. */
  particleMultiplier: number;
  /** Camera distance along +Z at scroll progress 0. */
  cameraZ: number;
}

/**
 * Every scene an editor can select.
 *
 * Keys MUST stay in sync with the `sceneId` options list in
 * `src/sanity/schemas/documents/project.ts`. They are duplicated rather than imported because
 * importing this module into the Studio schema would pull `three` into the Studio bundle for
 * the sake of one string list — a poor trade. The two lists are small, adjacent in review, and
 * a mismatch degrades to the fallback rather than breaking.
 */
export const SCENE_REGISTRY = {
  'fluid-default': {
    label: 'Fluid — Signature',
    description: 'The house look. Slow-breathing organic mass with violet/acid iridescence.',
    scale: 1,
    detailMultiplier: 1,
    distort: 0.42,
    frequency: 1.15,
    speed: 0.28,
    ridgeMix: 0.25,
    twist: 0.35,
    pointerStrength: 1,
    pointerRadius: 0.85,
    pointerPush: 0.32,
    fresnelPower: 3.4,
    fresnelIntensity: 1.15,
    iridescence: 0.55,
    roughness: 0.28,
    envIntensity: 0.85,
    grain: 0.045,
    colorA: '#0A0A0F',
    colorB: '#5B2BE8',
    colorC: '#C8FF3D',
    particleMultiplier: 1,
    cameraZ: 4.2,
  },

  'fluid-turbulent': {
    label: 'Fluid — Turbulent',
    description: 'Aggressive, high-frequency crests. For energetic or sports-adjacent brands.',
    scale: 0.95,
    detailMultiplier: 1.15, // Ridges need vertices; under-tessellated ridges read as spikes.
    distort: 0.58,
    frequency: 1.9,
    speed: 0.46,
    ridgeMix: 0.72,
    twist: 0.6,
    pointerStrength: 1.35,
    pointerRadius: 0.7,
    pointerPush: 0.45,
    fresnelPower: 2.6,
    fresnelIntensity: 1.4,
    iridescence: 0.7,
    roughness: 0.18,
    envIntensity: 1,
    grain: 0.06,
    colorA: '#0B0709',
    colorB: '#FF4D2E',
    colorC: '#FFD84D',
    particleMultiplier: 1.4,
    cameraZ: 4.4,
  },

  'fluid-chrome': {
    label: 'Fluid — Chrome',
    description: 'Liquid metal. Minimal colour, maximum specular. Reads luxury / editorial.',
    scale: 1.05,
    detailMultiplier: 1.2, // Sharp speculars expose faceting far more than diffuse surfaces do.
    distort: 0.3,
    frequency: 0.85,
    speed: 0.18,
    ridgeMix: 0.1,
    twist: 0.2,
    pointerStrength: 0.85,
    pointerRadius: 1,
    pointerPush: 0.22,
    fresnelPower: 5, // Tight rim — the visual signature of polished metal
    fresnelIntensity: 1.8,
    iridescence: 0.22,
    roughness: 0.04,
    envIntensity: 1.35,
    grain: 0.025,
    colorA: '#08080A',
    colorB: '#8C93A8',
    colorC: '#EFF2FF',
    particleMultiplier: 0.5,
    cameraZ: 4,
  },

  'grid-terrain': {
    label: 'Grid Terrain',
    description: 'Low-frequency landscape swell. Technical, data-adjacent, calm.',
    scale: 1.15,
    detailMultiplier: 1,
    distort: 0.22,
    frequency: 0.6,
    speed: 0.12,
    ridgeMix: 0.55,
    twist: 0,
    pointerStrength: 0.6,
    pointerRadius: 1.2,
    pointerPush: 0.15,
    fresnelPower: 2.2,
    fresnelIntensity: 0.85,
    iridescence: 0.15,
    roughness: 0.55,
    envIntensity: 0.6,
    grain: 0.05,
    colorA: '#06090C',
    colorB: '#1E5C8A',
    colorC: '#7FE3D4',
    particleMultiplier: 0.7,
    cameraZ: 4.8,
  },

  'particles-nebula': {
    label: 'Particles — Nebula',
    description: 'Blob recedes; the particle field leads. Atmospheric, quiet, spacious.',
    scale: 0.7,
    detailMultiplier: 0.8, // The mesh is background here — spend the budget on particles.
    distort: 0.35,
    frequency: 1.3,
    speed: 0.2,
    ridgeMix: 0.3,
    twist: 0.5,
    pointerStrength: 0.7,
    pointerRadius: 1.1,
    pointerPush: 0.2,
    fresnelPower: 4,
    fresnelIntensity: 1.6,
    iridescence: 0.8,
    roughness: 0.35,
    envIntensity: 0.7,
    grain: 0.07,
    colorA: '#07060E',
    colorB: '#3B2BE8',
    colorC: '#E85BC8',
    particleMultiplier: 2,
    cameraZ: 5,
  },

  'model-showcase': {
    label: 'Model Showcase',
    description: 'A client GLB is the subject; the fluid becomes a backdrop. Needs a 3D asset.',
    scale: 1.4,
    detailMultiplier: 0.6, // Pushed back and out of focus — detail is wasted here.
    distort: 0.5,
    frequency: 0.75,
    speed: 0.14,
    ridgeMix: 0.2,
    twist: 0.15,
    pointerStrength: 0.4,
    pointerRadius: 1.3,
    pointerPush: 0.1,
    fresnelPower: 3,
    fresnelIntensity: 0.7,
    iridescence: 0.35,
    roughness: 0.6,
    envIntensity: 0.5,
    grain: 0.04,
    colorA: '#0A0A0F',
    colorB: '#2A2A3E',
    colorC: '#5B2BE8',
    particleMultiplier: 0.4,
    cameraZ: 5.5,
  },
} as const satisfies Record<string, ScenePreset>;

export type SceneId = keyof typeof SCENE_REGISTRY;

/** The preset used when nothing is specified, or when an unknown id arrives. */
export const DEFAULT_SCENE_ID: SceneId = 'fluid-default';

/**
 * String → preset, total and non-throwing.
 *
 * Accepts `null | undefined` because that is what an unset Sanity field actually is, and
 * forcing every call site to write `?? 'fluid-default'` would just move the default somewhere
 * it can be forgotten.
 */
export function resolveScene(id: string | null | undefined): ScenePreset {
  if (id && id in SCENE_REGISTRY) {
    return SCENE_REGISTRY[id as SceneId];
  }
  if (process.env.NODE_ENV === 'development' && id) {
    // Loud in dev, silent in production: a mismatch is a content bug worth fixing, but not
    // worth spamming a visitor's console over.
    console.warn(
      `[canvas/registry] Unknown sceneId "${id}" — falling back to "${DEFAULT_SCENE_ID}". ` +
        `Check that the sceneId options in project.ts match the keys in SCENE_REGISTRY.`
    );
  }
  return SCENE_REGISTRY[DEFAULT_SCENE_ID];
}

/* ---------------------------------------------------------------------------
 * Colour conversion
 * ------------------------------------------------------------------------- */

/**
 * Pre-converted THREE.Color instances, one set per scene, built once at module init.
 *
 * `new THREE.Color(hex)` parses a string and runs an sRGB→linear conversion. Cheap in
 * isolation; done inside `useFrame` while tweening between two presets it is three string
 * parses per frame, and the allocation churn shows up as GC sawtooth in a profile.
 *
 * Colours are cloned on read because callers `.lerp()` into them, and mutating the cache would
 * corrupt the preset for every subsequent consumer — the kind of bug that only appears once a
 * second project uses the same scene.
 */
const COLOR_CACHE = new Map<SceneId, readonly [THREE.Color, THREE.Color, THREE.Color]>();

for (const key of Object.keys(SCENE_REGISTRY) as SceneId[]) {
  const p = SCENE_REGISTRY[key];
  COLOR_CACHE.set(key, [
    new THREE.Color(p.colorA),
    new THREE.Color(p.colorB),
    new THREE.Color(p.colorC),
  ] as const);
}

/** Fresh, mutable copies of a scene's three palette colours. */
export function sceneColors(id: string | null | undefined): [THREE.Color, THREE.Color, THREE.Color] {
  const key: SceneId = id && id in SCENE_REGISTRY ? (id as SceneId) : DEFAULT_SCENE_ID;
  const cached = COLOR_CACHE.get(key) ?? COLOR_CACHE.get(DEFAULT_SCENE_ID);
  // `noUncheckedIndexedAccess` makes this defensive branch mandatory rather than optional.
  // It is unreachable — the loop above populates every key — but the compiler cannot know that.
  if (!cached) {
    return [new THREE.Color('#0A0A0F'), new THREE.Color('#5B2BE8'), new THREE.Color('#C8FF3D')];
  }
  return [cached[0].clone(), cached[1].clone(), cached[2].clone()];
}

/* ---------------------------------------------------------------------------
 * Sanity palette override
 * ------------------------------------------------------------------------- */

/** A `colorToken` as it arrives from GROQ. */
export interface PaletteToken {
  name?: string | null;
  hex?: string | null;
}

/**
 * Overlay a project's authored palette onto a scene preset's colours.
 *
 * The Studio exposes `shaderA/shaderB/shaderC` tokens precisely so a client's brand colours can
 * drive the hero without a code change. Tokens are optional and partial: overriding only
 * `shaderB` is a legitimate, common edit.
 *
 * Hex values are validated in the schema, but validated-at-write is not the same as
 * valid-at-read (datasets get imported, migrated, hand-edited), and `new THREE.Color('nope')`
 * throws. So we re-check the format here. This is the boundary; it is the right place to be
 * paranoid.
 */
const HEX_RE = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

export function applyPaletteToScene(
  base: [THREE.Color, THREE.Color, THREE.Color],
  tokens: PaletteToken[] | null | undefined
): [THREE.Color, THREE.Color, THREE.Color] {
  if (!tokens?.length) return base;

  const slot: Record<string, 0 | 1 | 2> = { shaderA: 0, shaderB: 1, shaderC: 2 };

  for (const token of tokens) {
    if (!token?.name || !token.hex) continue;
    const index = slot[token.name];
    if (index === undefined) continue;
    if (!HEX_RE.test(token.hex)) continue;
    base[index].set(token.hex);
  }

  return base;
}

/* ---------------------------------------------------------------------------
 * Service elements
 * ------------------------------------------------------------------------- */

/**
 * The small 3D object that accompanies each service.
 *
 * Referenced by `service.elementId` in the Studio. Same reasoning as the scene registry: an
 * enum in the schema plus a non-throwing resolver here means an editor renaming a service can
 * never produce a blank slot in the services list.
 *
 * `geometry` names a primitive built in `ServiceElement.tsx` rather than a loaded asset. Seven
 * procedural primitives cost zero bytes over the network; seven GLBs would be ~2MB for
 * decoration nobody scrolls back up to look at.
 */
export interface ServiceElement {
  label: string;
  /** Which procedural geometry to build. */
  geometry:
    | 'torusKnot'
    | 'lattice'
    | 'nodeGraph'
    | 'prism'
    | 'particleStream'
    | 'neuralMesh'
    | 'blob';
  /** Rotations per second on each axis, at rest. */
  spin: [number, number, number];
  /** How strongly the element leans toward the cursor. 0 disables. */
  tilt: number;
  /** Uniform scale. */
  scale: number;
  /** Draw as wireframe — cheap, and reads as "technical" for the engineering services. */
  wireframe: boolean;
}

export const SERVICE_ELEMENTS = {
  'torus-knot': {
    label: 'Torus Knot',
    geometry: 'torusKnot',
    spin: [0.05, 0.12, 0],
    tilt: 0.3,
    scale: 1,
    wireframe: false,
  },
  lattice: {
    label: 'Lattice',
    geometry: 'lattice',
    spin: [0.04, 0.08, 0.02],
    tilt: 0.4,
    scale: 1.1,
    wireframe: true,
  },
  'node-graph': {
    label: 'Node Graph',
    geometry: 'nodeGraph',
    spin: [0, 0.1, 0],
    tilt: 0.5,
    scale: 1.2,
    wireframe: true,
  },
  prism: {
    label: 'Prism',
    geometry: 'prism',
    spin: [0.02, 0.16, 0.02],
    tilt: 0.35,
    scale: 0.95,
    wireframe: false,
  },
  'particle-stream': {
    label: 'Particle Stream',
    geometry: 'particleStream',
    spin: [0, 0.06, 0],
    tilt: 0.6,
    scale: 1.3,
    wireframe: false,
  },
  'neural-mesh': {
    label: 'Neural Mesh',
    geometry: 'neuralMesh',
    spin: [0.03, 0.07, 0.01],
    tilt: 0.45,
    scale: 1.15,
    wireframe: true,
  },
  blob: {
    label: 'Blob',
    geometry: 'blob',
    spin: [0.02, 0.05, 0],
    tilt: 0.5,
    scale: 1,
    wireframe: false,
  },
} as const satisfies Record<string, ServiceElement>;

export type ServiceElementId = keyof typeof SERVICE_ELEMENTS;

export const DEFAULT_SERVICE_ELEMENT: ServiceElementId = 'torus-knot';

/** String → element config, total and non-throwing. Documented in `service.elementId`. */
export function resolveServiceElement(id: string | null | undefined): ServiceElement {
  if (id && id in SERVICE_ELEMENTS) {
    return SERVICE_ELEMENTS[id as ServiceElementId];
  }
  return SERVICE_ELEMENTS[DEFAULT_SERVICE_ELEMENT];
}
