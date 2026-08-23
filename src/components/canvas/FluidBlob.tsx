'use client';

import { useMemo, useRef } from 'react';
import { useFrame, useThree } from '@react-three/fiber';
import * as THREE from 'three';

import { frameState, clampDelta } from '@/lib/store/frameState';
import { getUIState } from '@/lib/store/useUIStore';
import { TIER_SETTINGS } from '@/lib/hooks/useCapabilities';
import { dampHalf, dampColor, dampVec2, remap } from '@/lib/three/damp';
import {
  applyPaletteToScene,
  resolveScene,
  sceneColors,
  type PaletteToken,
} from './registry';
import { FluidMaterialImpl, type FluidMaterialInstance } from './shaders/FluidMaterial';

/**
 * FluidBlob — the interactive displaced icosphere that is the hero of the site.
 *
 * =========================================================================
 * THE ONE RULE IN THIS FILE
 * =========================================================================
 * Nothing in `useFrame` may allocate. Not a Vector3, not an array, not a closure, not a string.
 * At 60fps a single `new THREE.Vector3()` per frame is 3,600 objects a minute; the allocations
 * themselves are trivial but the GC pauses they eventually force are not, and they land as a
 * dropped frame at an unpredictable moment. Every temporary in this component is hoisted to
 * module scope or a ref and mutated in place.
 *
 * =========================================================================
 * HOW THE CURSOR REACHES THE SHADER
 * =========================================================================
 * The vertex shader compares `normalize(uPointer)` against `normalize(position)` to find which
 * part of the surface the cursor is over. So `uPointer` must be a direction in the mesh's
 * *object* space — not screen space, not world space.
 *
 *   1. `frameState.pointerSmooth` holds the cursor in NDC (written by PointerProvider).
 *   2. A raycaster fires that through the camera.
 *   3. The ray is intersected with the blob's bounding sphere.
 *   4. If it misses — the cursor is beside the blob, which is most of the time on a wide
 *      viewport — we fall back to the point on the sphere closest to the ray. This is what
 *      makes the highlight slide continuously around the silhouette instead of vanishing the
 *      instant the cursor leaves the blob. A hit test alone produces a highlight that pops in
 *      and out, and it looks broken.
 *   5. `worldToLocal` converts to object space, which correctly undoes the mesh's own rotation.
 *      Skipping this step is the classic bug where the bulge drifts as the blob spins.
 *
 * =========================================================================
 * PERFORMANCE SHAPE
 * =========================================================================
 * The vertex shader evaluates the noise field three times per vertex (the position plus two
 * tangent neighbours, for normal reconstruction) and each evaluation is FBM_OCTAVES simplex
 * calls plus one ridged pass. At high tier — detail 40, ~9,600 vertices — that is roughly
 * 9,600 × 3 × 4 ≈ 115k simplex evaluations per frame. Comfortable on a discrete GPU, which is
 * exactly why `blobDetail` drops to 12 on the low tier: the same shader, one-tenth the work.
 */

/* ---------------------------------------------------------------------------
 * Module-scope temporaries. Reused every frame, never allocated in the loop.
 * ------------------------------------------------------------------------- */
const _raycaster = new THREE.Raycaster();
const _sphere = new THREE.Sphere(new THREE.Vector3(0, 0, 0), 1);
const _hit = new THREE.Vector3();
const _pointerTarget = new THREE.Vector3(0, 0, -1);
const _ndc = new THREE.Vector2();

/** Base radius of the blob before per-scene scaling. */
const BASE_RADIUS = 1;

/**
 * The displaced surface extends past the geometry's radius, so the raycast sphere is inflated.
 * Matching it to the undisplaced radius makes the highlight lag behind the visible surface at
 * the crests.
 */
const RAYCAST_RADIUS_PAD = 1.25;

export interface FluidBlobProps {
  /** Scene preset id from Sanity (`project.sceneId`). Unknown values fall back safely. */
  sceneId?: string | null;
  /** `colorPalette.tokens` from Sanity — overrides shaderA/B/C on the preset. */
  paletteTokens?: PaletteToken[] | null;
  /**
   * Per-instance noise offset. Two projects sharing a preset otherwise render the identical
   * surface, which is immediately obvious when navigating between them.
   */
  seed?: number;
  /** Global intensity multiplier, from `siteSettings.motionDefaults.shaderIntensity`. */
  intensity?: number;
  /** Set false to hold the blob collapsed — used by the preloader hand-off. */
  revealed?: boolean;
}

export function FluidBlob({
  sceneId,
  paletteTokens,
  seed = 0,
  intensity = 1,
  revealed = true,
}: FluidBlobProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<FluidMaterialInstance>(null);

  const camera = useThree((s) => s.camera);
  const size = useThree((s) => s.size);
  const viewport = useThree((s) => s.viewport);

  /**
   * Tier is read non-reactively at mount and then baked into geometry + defines. It is
   * deliberately NOT a subscription: a tier change mid-session (which only happens via
   * PerformanceMonitor) should not rebuild the geometry and recompile the shader mid-scroll.
   * The adaptive response to a slow GPU is DPR, handled in PerfGuard.
   */
  const tier = useMemo(() => getUIState().tier, []);
  const settings = TIER_SETTINGS[tier];

  const preset = useMemo(() => resolveScene(sceneId), [sceneId]);

  /** Icosphere subdivision, rounded — a fractional detail arg throws in three.js. */
  const detail = Math.max(4, Math.round(settings.blobDetail * preset.detailMultiplier));
  const octaves = settings.fbmOctaves;

  /**
   * Target colours: preset palette with the project's Sanity overrides applied.
   *
   * These are the *targets*; `useFrame` damps the live uniforms toward them. That single
   * indirection is what makes navigating between two projects cross-fade the hero palette
   * instead of hard-cutting it.
   */
  const targetColors = useMemo(
    () => applyPaletteToScene(sceneColors(sceneId), paletteTokens),
    [sceneId, paletteTokens]
  );

  /** Mutable per-frame accumulators. A ref, so HMR and remounts reset them cleanly. */
  const local = useRef({
    /** Shader time. Accumulated from clamped deltas rather than read from state.clock. */
    time: 0,
    /** Current damped reveal, 0..1. */
    reveal: 0,
    /** Smoothed |cursor velocity|. */
    velocity: 0,
    /** Smoothed pointer presence, gates the bulge. */
    presence: 0,
    /** Smoothed scroll velocity. */
    scrollVel: 0,
    /** Ambient rotation angle. */
    spin: 0,
  });

  useFrame((state, rawDelta) => {
    const material = materialRef.current;
    const mesh = meshRef.current;
    if (!material || !mesh) return;

    /**
     * Clamp the delta before it touches anything. R3F's raw delta after a backgrounded tab or a
     * long main-thread block can be several seconds; multiplied into a rotation it spins the
     * blob a dozen turns in one frame, and fed to a damp it snaps every value instantly.
     */
    const dt = clampDelta(rawDelta);
    const L = local.current;

    /* ------------------------------------------------------------------
     * 1. Time
     *
     * Accumulated locally rather than taken from `state.clock.elapsedTime`, for two reasons:
     * the clock keeps advancing while the frameloop is paused for an off-screen canvas (so the
     * blob teleports forward in its animation when you scroll back), and it is not clamped.
     * ---------------------------------------------------------------- */
    L.time += dt;
    material.uTime = L.time;

    /* ------------------------------------------------------------------
     * 2. Reveal
     *
     * Drives displacement amplitude *and* geometry scale in the vertex shader, so the blob
     * grows into existence rather than fading in. A ~420ms half-life reads as substantial
     * without gating the hero headline behind it.
     * ---------------------------------------------------------------- */
    L.reveal = dampHalf(L.reveal, revealed ? 1 : 0, 0.42, dt);
    material.uReveal = L.reveal;
    // Skip the draw call entirely while fully collapsed. One less program bind, and it prevents
    // a single degenerate frame at reveal 0 where every vertex sits at the origin.
    mesh.visible = L.reveal > 0.002;

    /* ------------------------------------------------------------------
     * 3. Cursor → object-space direction
     * ---------------------------------------------------------------- */
    // On touch there is no hover, and a finger's last tap position frozen into the surface as a
    // permanent bulge looks like a rendering fault. Gate presence to zero instead.
    const wantPresence = frameState.isTouch ? 0 : frameState.pointerPresence;
    L.presence = dampHalf(L.presence, wantPresence, 0.18, dt);

    if (L.presence > 0.001) {
      _ndc.set(frameState.pointerSmooth.x, frameState.pointerSmooth.y);
      _raycaster.setFromCamera(_ndc, camera);

      // The sphere lives at the mesh's world position, inflated to cover displacement crests.
      mesh.getWorldPosition(_sphere.center);
      _sphere.radius = BASE_RADIUS * preset.scale * RAYCAST_RADIUS_PAD;

      const intersected = _raycaster.ray.intersectSphere(_sphere, _hit);
      if (!intersected) {
        // Miss: nearest point on the ray to the sphere centre, then pushed out to the surface.
        // Keeps the highlight sliding around the silhouette continuously (see header note 4).
        _raycaster.ray.closestPointToPoint(_sphere.center, _hit);
        _hit.sub(_sphere.center).normalize().multiplyScalar(_sphere.radius).add(_sphere.center);
      }

      // World → object space. Undoes the mesh's rotation and scale, which is what keeps the
      // bulge pinned to the cursor while the blob spins underneath it.
      mesh.worldToLocal(_hit);
      const len = _hit.length();
      // A zero-length vector would make `normalize()` in the shader produce NaN, and one NaN
      // vertex blanks the whole draw call.
      if (len > 1e-5) _pointerTarget.copy(_hit).divideScalar(len);
    }

    // Damped so a fast cursor flick sweeps the highlight across the surface rather than
    // teleporting it. 90ms is the shortest half-life that still reads as a physical drag.
    material.uPointer.lerp(_pointerTarget, 1 - Math.exp(-(Math.LN2 / 0.09) * dt));
    material.uPointerStrength = L.presence * preset.pointerStrength * intensity;
    material.uPointerRadius = preset.pointerRadius;
    material.uPointerPush = preset.pointerPush * intensity;

    /* ------------------------------------------------------------------
     * 4. Cursor velocity → turbulence
     *
     * The brief's "responds to cursor velocity": moving the cursor fast injects extra
     * high-frequency noise and shears the surface along the direction of travel. Damped hard
     * (240ms) on the way down so the turbulence *decays* after a gesture instead of snapping
     * off the moment the cursor stops — the decay is the part that reads as fluid.
     * ---------------------------------------------------------------- */
    L.velocity = dampHalf(L.velocity, frameState.velocityMagnitude, 0.24, dt);
    material.uVelocity = L.velocity * intensity;
    dampVec2(
      material.uVelocityVec,
      frameState.velocityDirection.x,
      frameState.velocityDirection.y,
      0.3,
      dt
    );

    /* ------------------------------------------------------------------
     * 5. Scroll → shape
     *
     * Read straight from frameState, which SmoothScrollProvider wrote earlier in this same
     * frame (gsap.ticker → lenis.raf → ScrollTrigger.update, then R3F's useFrame). That
     * ordering is the entire reason the canvas never lags the DOM by a frame.
     * ---------------------------------------------------------------- */
    const scroll = frameState.scrollProgress;
    material.uScroll = scroll;

    L.scrollVel = dampHalf(L.scrollVel, frameState.scrollVelocity, 0.15, dt);
    material.uScrollVelocity = L.scrollVel;

    /**
     * Displacement eases off as the hero scrolls away. Two reasons, one aesthetic and one
     * mechanical: a churning blob behind body copy is unreadable, and the noise is the most
     * expensive thing on the page — quietening it reclaims GPU time exactly when the content
     * sections need it for their own reveals.
     */
    const scrollCalm = remap(scroll, 0, 0.35, 1, 0.55);
    material.uDistort = preset.distort * scrollCalm * intensity;
    material.uFrequency = preset.frequency;
    material.uRidgeMix = preset.ridgeMix;
    material.uSpeed = preset.speed;
    // Twist grows with scroll — the blob visibly wrings itself out as you descend.
    material.uTwist = preset.twist * (1 + scroll * 1.4) * intensity;

    /* ------------------------------------------------------------------
     * 6. Surface
     * ---------------------------------------------------------------- */
    material.uFresnelPower = preset.fresnelPower;
    material.uFresnelIntensity = preset.fresnelIntensity;
    material.uIridescence = preset.iridescence;
    material.uRoughness = preset.roughness;
    material.uEnvIntensity = preset.envIntensity;
    material.uGrain = preset.grain;

    // Colours damped rather than assigned: cross-fades the palette on navigation. 300ms is
    // slow enough to perceive as a transition, fast enough not to look like a bug.
    const [ca, cb, cc] = targetColors;
    dampColor(material.uColorA, ca, 0.3, dt);
    dampColor(material.uColorB, cb, 0.3, dt);
    dampColor(material.uColorC, cc, 0.3, dt);

    /* ------------------------------------------------------------------
     * 7. Resolution
     *
     * In device pixels — the fragment shader uses it for grain in gl_FragCoord space, and
     * gl_FragCoord is in device pixels. Passing CSS pixels makes the grain scale change
     * between a retina and a non-retina display.
     * ---------------------------------------------------------------- */
    material.uResolution.set(size.width * viewport.dpr, size.height * viewport.dpr);

    /* ------------------------------------------------------------------
     * 8. Ambient rotation
     *
     * Slow, and slowed further by scroll velocity so a fast flick momentarily stalls the spin —
     * a small inertia cue that makes the object feel like it has mass.
     * ---------------------------------------------------------------- */
    L.spin += dt * 0.055 * (1 - Math.min(Math.abs(L.scrollVel), 0.8));
    mesh.rotation.y = L.spin;
    // A fixed lean, not animated: it stops the silhouette being a perfect circle, which is what
    // makes the displacement legible as a 3D surface rather than a flat noise texture.
    mesh.rotation.z = -0.18;

    /* ------------------------------------------------------------------
     * 9. Parallax drift
     *
     * A few percent of viewport, opposite the cursor. Deliberately tiny: the blob is the
     * subject, and a subject that swims around under the cursor is exhausting to look at.
     * ---------------------------------------------------------------- */
    const driftX = -frameState.pointerSmooth.x * 0.12 * L.presence;
    const driftY = -frameState.pointerSmooth.y * 0.08 * L.presence;
    mesh.position.x = dampHalf(mesh.position.x, driftX, 0.35, dt);
    mesh.position.y = dampHalf(mesh.position.y, driftY - scroll * 0.6, 0.35, dt);
  });

  return (
    <mesh
      ref={meshRef}
      scale={preset.scale}
      /**
       * Frustum culling off. The vertex shader displaces the surface well outside the
       * geometry's computed bounding sphere, so three.js culls the mesh while parts of it are
       * still on screen — it pops out at the viewport edge. There is exactly one mesh here, so
       * culling was never buying us anything to begin with.
       */
      frustumCulled={false}
    >
      {/**
       * Icosahedron rather than a UV sphere: near-uniform triangle area, so noise displacement
       * is evenly resolved everywhere. A UV sphere's poles have vertices packed hundreds of
       * times denser than its equator, which shows up as a pinched, over-detailed artefact at
       * the top and bottom the moment you displace it.
       *
       * `key` on the detail level: R3F recreates on args change, but being explicit documents
       * that a tier switch is a geometry rebuild, not a mutation.
       */}
      <icosahedronGeometry key={`ico-${detail}`} args={[BASE_RADIUS, detail]} />
      <fluidMaterial
        /**
         * Composite key. `FluidMaterialImpl.key` is drei's HMR handle — it changes when the
         * GLSL modules are edited, forcing a fresh material and a shader recompile instead of
         * silently keeping the stale program. The octave count is appended because
         * FBM_OCTAVES is a preprocessor define: changing it requires a recompile, and a
         * remount is the honest way to get one.
         */
        key={`${FluidMaterialImpl.key}-${octaves}`}
        ref={materialRef}
        /**
         * Compile-time octave count. A `for (i < uOctaves)` uniform loop is illegal in
         * GLSL ES 1.0 (loop bounds must be constant) and would be a dynamic branch even where
         * legal, so the octave count is baked into the program.
         */
        defines={{ FBM_OCTAVES: String(octaves) }}
        uSeed={seed}
        // Initial values so frame 1 is already correct. Without these the first painted frame
        // shows the material's constructor defaults, which is a visible one-frame flash of the
        // wrong palette on a project page.
        uColorA={targetColors[0]}
        uColorB={targetColors[1]}
        uColorC={targetColors[2]}
        uDistort={0}
        uReveal={0}
      />
    </mesh>
  );
}
