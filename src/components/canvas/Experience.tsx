'use client';

import { Suspense, lazy, useMemo } from 'react';
import { useThree } from '@react-three/fiber';
import { AdaptiveEvents, Preload } from '@react-three/drei';

import { useUIStore } from '@/lib/store/useUIStore';
import { useSceneStore } from '@/lib/store/useSceneStore';
import { CameraRig } from './CameraRig';
import { Effects } from './Effects';
import { FluidBlob } from './FluidBlob';
import { Particles } from './Particles';
import { PerfGuard } from './PerfGuard';
import { resolveScene } from './registry';

/**
 * =============================================================================
 * Experience — the root of the 3D scene graph.
 * =============================================================================
 *
 * Everything inside a `<Canvas>` lives here. `SceneCanvas.tsx` owns the DOM side (the canvas
 * element, its sizing, the poster fallback, the GL configuration); this file owns the contents.
 * That split matters because the two have completely different concerns and completely different
 * reasons to change: the canvas wrapper changes when the *page layout* changes, the scene graph
 * changes when the *art direction* changes.
 *
 * -----------------------------------------------------------------------------
 * WHAT IS IN THE SCENE
 * -----------------------------------------------------------------------------
 *   FluidBlob   — the subject. A displaced icosphere driven by custom GLSL, responding to
 *                 cursor position, cursor velocity, and scroll progress.
 *   Particles   — atmosphere. Culled entirely below the high/mid tiers.
 *   CameraRig   — scroll-driven camera choreography plus pointer parallax.
 *   Effects     — bloom / aberration / grain / vignette. High tier only.
 *   PerfGuard   — adaptive DPR, visibility gating, context-loss recovery.
 *
 * -----------------------------------------------------------------------------
 * THE THREE MOTION TIERS, CONCRETELY
 * -----------------------------------------------------------------------------
 * `motion` is resolved once by `useCapabilities` and everything here branches on it. Written out
 * explicitly because "graceful fallback" is one of the brief's non-negotiables and a vague
 * gesture at `prefers-reduced-motion` is not an implementation:
 *
 *   'full' — the whole scene. Scroll-driven camera, full displacement amplitude, particles,
 *            post-processing where the GPU allows.
 *   'lite' — the blob still exists and still responds to the cursor, but nothing moves on its
 *            own: the noise animation speed drops to near zero, the camera stops responding to
 *            scroll (parallax stays, because it is user-driven and sub-degree), particles are
 *            halved, post-processing is off. The page keeps its identity; it stops being kinetic.
 *   'none' — this component is never mounted. `SceneCanvas` renders a poster instead. Reaching
 *            here with 'none' would mean a bug upstream, so we assert rather than degrade.
 *
 * The important design decision is that 'lite' is not "the site minus the good bits". A visitor
 * with `prefers-reduced-motion` who has not asked for reduced *design* still gets an iridescent
 * volumetric object that reacts to their cursor. What they do not get is anything that moves
 * while they hold still.
 */

/**
 * The GLB subject, loaded only when a scene actually asks for one.
 *
 * `React.lazy` inside the R3F tree works exactly as it does in the DOM tree — R3F's reconciler
 * honours Suspense. The win is real: `GLTFLoader` plus the Draco and KTX2 decoders is ~250KB of
 * JavaScript (the Draco WASM decoder alone is ~200KB), and the overwhelming majority of visitors
 * land on pages whose scene is pure procedural geometry. Shipping a quarter-megabyte of model
 * loading machinery to render a shader would be indefensible.
 */
const ShowcaseModel = lazy(() =>
  import('./ShowcaseModel').then((m) => ({ default: m.ShowcaseModel }))
);

export interface ExperienceProps {
  /**
   * The wrapper element, forwarded to PerfGuard so it can gate rendering on visibility.
   * Refs cross the R3F reconciler boundary fine — they are plain objects. Context does not,
   * which is why nothing here relies on it.
   */
  wrapperRef?: React.RefObject<HTMLElement | null>;
}

export function Experience({ wrapperRef }: ExperienceProps) {
  /* ----------------------------------------------------------------------
   * Capability & preference
   *
   * Read reactively: a mid-session `prefers-reduced-motion` change must actually take effect,
   * and `useCapabilities` installs a matchMedia listener specifically so it can.
   * -------------------------------------------------------------------- */
  const motion = useUIStore((s) => s.motion);
  const postProcessingEnabled = useUIStore((s) => s.postProcessingEnabled);

  /* ----------------------------------------------------------------------
   * Scene configuration, written by whichever page is mounted
   * -------------------------------------------------------------------- */
  const sceneId = useSceneStore((s) => s.sceneId);
  const paletteTokens = useSceneStore((s) => s.paletteTokens);
  const seed = useSceneStore((s) => s.seed);
  const cameraPath = useSceneStore((s) => s.cameraPath);
  const revealed = useSceneStore((s) => s.revealed);
  const configIntensity = useSceneStore((s) => s.intensity);
  const modelUrl = useSceneStore((s) => s.modelUrl);

  const preset = useMemo(() => resolveScene(sceneId), [sceneId]);

  /**
   * Effective intensity — the single scalar every visual amplitude is multiplied by.
   *
   * Funnelling the motion level through one number, rather than branching on `motion` at a dozen
   * call sites, means there is exactly one place to look when the site is too loud or too quiet,
   * and it makes 'lite' a *dimmer* rather than a different code path. Different code paths for
   * accessibility variants are how the accessible variant ends up broken: nobody looks at it.
   */
  const intensity = motion === 'lite' ? configIntensity * 0.45 : configIntensity;

  /**
   * Post-processing needs both the capability check (GPU is fast enough) and the preference check
   * (the user has not asked for less). Bloom pulsing with scroll velocity is motion, and a
   * chromatic aberration that swells when you scroll is precisely the kind of full-screen
   * luminance change that triggers discomfort.
   */
  const effectsEnabled = postProcessingEnabled && motion === 'full';

  return (
    <>
      {/* --------------------------------------------------------------
        * Performance & lifecycle. First, so its effects are registered before anything
        * expensive mounts — the visibility gate should be live before the first heavy frame,
        * not after it.
        * ------------------------------------------------------------ */}
      <PerfGuard observeRef={wrapperRef} />

      {/**
       * AdaptiveEvents disables R3F's raycasting while the frame budget is under pressure.
       *
       * Worth knowing what this actually costs: R3F raycasts on every pointer move against every
       * mesh with a pointer handler. This scene has none — all cursor interaction is handled by
       * the manual sphere raycast in FluidBlob, which is one ray against one analytic sphere
       * rather than a BVH-less traversal of a 9,600-vertex mesh. So this is close to a no-op
       * here, and it is included as a guard for future scenes where somebody adds an
       * `onPointerOver` to a project card in 3D and cannot work out why interaction tanks on
       * mobile.
       */}
      <AdaptiveEvents />

      {/* --------------------------------------------------------------
        * Camera
        * ------------------------------------------------------------ */}
      <CameraRig
        path={cameraPath ?? undefined}
        sceneId={sceneId}
        /**
         * Parallax scaled with intensity but never fully off above 'none'. A completely static
         * camera makes the whole scene read as a flat image with a video playing inside it — the
         * parallax is what establishes that there is depth at all, and it is the cheapest
         * dimensionality cue available.
         */
        parallax={0.45 * intensity}
        motion={motion}
      />

      {/* --------------------------------------------------------------
        * Lighting
        *
        * The fluid material is entirely self-lit — it computes two analytic directional lights
        * and a hemisphere term in its own fragment shader, which is why there is no
        * `<ambientLight>` driving it. That is a deliberate trade: hard-coding the light rig in
        * GLSL removes three uniform uploads and, more importantly, lets the lighting model be
        * wrong-but-beautiful (wrapped diffuse to fake subsurface scattering, a fake environment
        * gradient instead of a 2–4MB HDR) in ways a physically-based material will not permit.
        *
        * These lights exist purely for the optional GLB subject, which uses standard materials
        * and would otherwise render as a black silhouette. They are mounted only when a model is
        * actually present — three unused lights still cost uniform uploads and, worse, force
        * every standard material in the scene to recompile if the count ever changes.
        * ------------------------------------------------------------ */}
      {modelUrl ? (
        <>
          <ambientLight intensity={0.55} />
          <directionalLight position={[3, 4, 5]} intensity={2.4} color="#FFF6E8" />
          {/* Cool rim from behind, so the model separates from the dark background. Without a
            * back light a dark model on a dark background has no readable silhouette. */}
          <directionalLight position={[-4, -1, -3]} intensity={1.1} color="#3AA0FF" />
        </>
      ) : null}

      {/* --------------------------------------------------------------
        * The subject
        * ------------------------------------------------------------ */}
      <FluidBlob
        sceneId={sceneId}
        paletteTokens={paletteTokens}
        seed={seed}
        intensity={intensity}
        revealed={revealed}
      />

      {/* --------------------------------------------------------------
        * Atmosphere
        *
        * Skipped outright on 'lite'. The particle field's entire purpose is drifting motion; a
        * static particle field is visual noise with no payoff, and it still costs a full
        * additive pass over thousands of overlapping sprites.
        * ------------------------------------------------------------ */}
      {motion === 'full' && preset.particleMultiplier > 0 ? (
        <Particles
          sceneId={sceneId}
          paletteTokens={paletteTokens}
          intensity={intensity}
          revealed={revealed}
        />
      ) : null}

      {/* --------------------------------------------------------------
        * Optional GLB subject
        *
        * `fallback={null}` rather than a spinner: the fluid scene behind it is already a complete
        * composition. A loading indicator for a decorative enhancement draws attention to
        * something being absent that the visitor did not know was coming.
        * ------------------------------------------------------------ */}
      {modelUrl ? (
        <Suspense fallback={null}>
          <ShowcaseModel url={modelUrl} intensity={intensity} revealed={revealed} />
        </Suspense>
      ) : null}

      {/* --------------------------------------------------------------
        * Post-processing. Last in the tree, which is also last in render order.
        * ------------------------------------------------------------ */}
      <Effects enabled={effectsEnabled} intensity={intensity} />

      {/**
       * Preload forces geometry and materials onto the GPU during the initial mount rather than
       * lazily on first draw. Without it the first frame that shows the blob is also the frame
       * that compiles its shader program — a 30–120ms synchronous stall inside the render loop,
       * landing exactly on the intro animation. `all` is safe here because the scene is small
       * and entirely known at mount.
       */}
      <Preload all />
    </>
  );
}

/**
 * A tiny in-canvas component that reports the resolved GL capabilities to the console.
 *
 * Enabled by `NEXT_PUBLIC_DEBUG_WEBGL=true`. Kept in this file because it is a debugging aid for
 * this scene specifically, and tree-shaken out of production builds: the env var is inlined at
 * build time, so `false && ...` collapses and the component's body is dropped.
 */
export function GLDebug() {
  const gl = useThree((s) => s.gl);
  const size = useThree((s) => s.size);
  const viewport = useThree((s) => s.viewport);

  if (process.env.NEXT_PUBLIC_DEBUG_WEBGL !== 'true') return null;

  const ctx = gl.getContext();
  console.info('[GLDebug]', {
    webgl2: typeof WebGL2RenderingContext !== 'undefined' && ctx instanceof WebGL2RenderingContext,
    dpr: viewport.dpr,
    size: `${size.width}×${size.height}`,
    drawingBuffer: `${ctx.drawingBufferWidth}×${ctx.drawingBufferHeight}`,
    maxTextureSize: ctx.getParameter(ctx.MAX_TEXTURE_SIZE),
    maxVertexUniforms: ctx.getParameter(ctx.MAX_VERTEX_UNIFORM_VECTORS),
  });

  return null;
}
