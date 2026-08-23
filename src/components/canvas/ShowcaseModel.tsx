'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

import { clampDelta, frameState } from '@/lib/store/frameState';
import { dampHalf } from '@/lib/three/damp';
import {
  cloneModel,
  countTriangles,
  disposeCreated,
  useConfiguredGLTF,
} from '@/lib/three/loaders';

/**
 * ShowcaseModel — an optional client-supplied GLB as the scene's subject.
 *
 * Lazily imported by `Experience`, so none of this code (nor the ~250KB of Draco/KTX2 decoding
 * machinery it pulls in) reaches a visitor whose page has no model.
 *
 * Suspends while loading. The Suspense boundary lives in `Experience`.
 */

/** Material treatments offered by the Sanity `model3d.material` field. */
export type ModelTreatment = 'original' | 'chrome' | 'glass' | 'clay' | 'wireframe';

export interface ShowcaseModelProps {
  url: string;
  intensity?: number;
  revealed?: boolean;
  /** Override the GLB's own materials. `original` respects what the artist authored. */
  treatment?: ModelTreatment;
  /** Uniform scale from `model3d.scale`. */
  scale?: number;
  /** Euler offsets in DEGREES, matching the Studio field. Converted here. */
  rotationOffset?: [number, number, number];
  /** From `model3d.autoRotate`. */
  autoRotate?: boolean;
  /**
   * Whether transmission (real refraction) is affordable. Passed down from `TIER_SETTINGS`
   * rather than read here, so the tier lookup stays in one place.
   */
  allowTransmission?: boolean;
}

export function ShowcaseModel({
  url,
  intensity = 1,
  revealed = true,
  treatment = 'original',
  scale = 1,
  rotationOffset = [0, 0, 0],
  autoRotate = true,
  allowTransmission = false,
}: ShowcaseModelProps) {
  const { scene } = useConfiguredGLTF(url);
  const groupRef = useRef<THREE.Group>(null);

  /**
   * Materials this component allocated. Tracked explicitly so cleanup disposes exactly these and
   * nothing else — the loaded scene's own geometries and materials belong to drei's cache and
   * must not be touched. See the long note in `lib/three/loaders.ts`.
   */
  const createdRef = useRef<THREE.Material[]>([]);

  /* ------------------------------------------------------------------------
   * Clone and prepare
   * ---------------------------------------------------------------------- */
  const model = useMemo(() => {
    const clone = cloneModel(scene);
    const created: THREE.Material[] = [];

    /**
     * Recentre and normalise scale.
     *
     * Client-supplied GLBs arrive in whatever units and at whatever origin the artist worked in:
     * centimetres, inches, Z-up, pivot at the floor, pivot 40 units off in X. Dropping one into a
     * scene built around a unit sphere gives either an invisible speck or a wall of geometry
     * filling the frame.
     *
     * Fitting the bounding box to a known size makes any asset usable without an artist round
     * trip — which matters because the person uploading it is an account manager, not the artist.
     */
    const box = new THREE.Box3().setFromObject(clone);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const maxAxis = Math.max(size.x, size.y, size.z);

    if (maxAxis > 1e-4) {
      // Target ~2.2 world units on the longest axis: slightly larger than the blob's diameter,
      // so a model reads as the subject when one is present.
      const fit = 2.2 / maxAxis;
      clone.scale.setScalar(fit);
      // Offset must be scaled too — `center` was measured in the model's original units.
      clone.position.sub(center.multiplyScalar(fit));
    }

    if (treatment !== 'original') {
      clone.traverse((child) => {
        const mesh = child as THREE.Mesh;
        if (!mesh.isMesh) return;

        const replacement = buildTreatmentMaterial(treatment, allowTransmission);
        if (!replacement) return;

        created.push(replacement);
        // The original material is NOT disposed — it belongs to the cache and other consumers.
        mesh.material = replacement;
      });
    }

    /**
     * Shadows are off across every tier (see TIER_SETTINGS), so `castShadow`/`receiveShadow` are
     * deliberately not set. Setting them anyway is not free: three.js adds the mesh to the shadow
     * render list and, if a shadow-casting light ever appears, silently starts a depth pass.
     */

    createdRef.current = created;
    if (process.env.NODE_ENV === 'development') {
      const tris = countTriangles(clone);
      if (tris > 250_000) {
        console.warn(
          `[ShowcaseModel] ${url} is ${tris.toLocaleString()} triangles. ` +
            `Above ~250k this will cost frames on mid-tier hardware — decimate or add LODs.`
        );
      }
    }

    return clone;
  }, [scene, treatment, allowTransmission, url]);

  /** Dispose only what we created, when the treatment or model changes. */
  useEffect(() => {
    const created = createdRef.current;
    return () => {
      disposeCreated(created);
    };
  }, [model]);

  const local = useRef({ reveal: 0, spin: 0, presence: 0 });

  useFrame((_state, rawDelta) => {
    const group = groupRef.current;
    if (!group) return;

    const dt = clampDelta(rawDelta);
    const L = local.current;

    // Reveal drives scale, not opacity: fading a model in requires making every material
    // transparent, which reorders it against the blob and produces sorting artefacts. Scaling
    // from zero has no such cost and reads as more deliberate anyway.
    L.reveal = dampHalf(L.reveal, revealed ? 1 : 0, 0.5, dt);
    group.scale.setScalar(scale * L.reveal);
    group.visible = L.reveal > 0.004;

    if (autoRotate) {
      L.spin += dt * 0.16 * intensity;
    }

    L.presence = dampHalf(L.presence, frameState.isTouch ? 0 : frameState.pointerPresence, 0.25, dt);

    // Degrees → radians once per frame is a trivial cost and keeps the prop in the unit the
    // Studio field uses, which is the unit the person setting it thinks in.
    const [rx, ry, rz] = rotationOffset;
    const toRad = Math.PI / 180;

    // Pointer tilt. Bounded to ~±0.35rad (20°) — enough to feel responsive, small enough that
    // the model never turns far enough to show an unlit or unfinished back face.
    const tiltX = -frameState.pointerSmooth.y * 0.35 * L.presence * intensity;
    const tiltY = frameState.pointerSmooth.x * 0.35 * L.presence * intensity;

    group.rotation.x = dampHalf(group.rotation.x, rx * toRad + tiltX, 0.28, dt);
    group.rotation.y = dampHalf(group.rotation.y, ry * toRad + tiltY + L.spin, 0.28, dt);
    group.rotation.z = rz * toRad;

    // Scroll lift, matching the blob's so the two layers move together rather than shearing.
    group.position.y = dampHalf(group.position.y, -frameState.scrollProgress * 0.6, 0.3, dt);
  });

  return (
    <group ref={groupRef} frustumCulled={false}>
      <primitive object={model} />
    </group>
  );
}

/* ---------------------------------------------------------------------------
 * Material treatments
 * ------------------------------------------------------------------------- */

/**
 * Build a substitute material for the chosen treatment.
 *
 * These exist because clients supply models with whatever materials their 3D artist happened to
 * bake — frequently untextured grey Lambert, or a PBR setup tuned for a completely different
 * lighting environment. Offering four opinionated treatments in the Studio means an editor can
 * make an arbitrary GLB look intentional in this scene without opening Blender.
 */
function buildTreatmentMaterial(
  treatment: ModelTreatment,
  allowTransmission: boolean
): THREE.Material | null {
  switch (treatment) {
    case 'chrome':
      return new THREE.MeshStandardMaterial({
        color: '#C8CCD8',
        metalness: 1,
        roughness: 0.08,
        // No env map is assigned. A metal with no environment to reflect renders near-black,
        // so `envMapIntensity` is raised and the scene's directional lights do the work through
        // specular highlights alone. Not physically right; reads as polished metal, which is
        // the actual requirement.
        envMapIntensity: 1.6,
      });

    case 'glass':
      /**
       * Transmission is genuinely expensive: `MeshPhysicalMaterial` with `transmission > 0`
       * forces three.js to render the scene to an extra render target every frame so the
       * material has something to refract. That is a second full scene pass — roughly a
       * doubling of draw cost — which is why it is gated on the tier.
       *
       * The fallback is not a lesser glass, it is a *different* idea: a thin, bright,
       * high-fresnel surface that reads as glass from the silhouette rather than from
       * refraction. Trying to fake transmission with opacity produces grey plastic.
       */
      if (allowTransmission) {
        return new THREE.MeshPhysicalMaterial({
          color: '#FFFFFF',
          metalness: 0,
          roughness: 0.06,
          transmission: 0.92,
          thickness: 1.4,
          ior: 1.5,
          // A little dispersion sells it as glass rather than as a hole in the image.
          dispersion: 0.35,
          transparent: true,
        });
      }
      return new THREE.MeshStandardMaterial({
        color: '#DDE6FF',
        metalness: 0.25,
        roughness: 0.12,
        transparent: true,
        opacity: 0.42,
        // Never write depth from a transparent surface: it would occlude the particles and the
        // blob behind it, which is the opposite of what "glass" should do.
        depthWrite: false,
        side: THREE.DoubleSide,
      });

    case 'clay':
      // Matte, unlit-looking, no specular. Reads as a physical maquette, which flatters models
      // whose textures are missing or wrong.
      return new THREE.MeshStandardMaterial({
        color: '#E8E2D9',
        metalness: 0,
        roughness: 0.95,
      });

    case 'wireframe':
      return new THREE.MeshBasicMaterial({
        color: '#C8FF3D',
        wireframe: true,
        transparent: true,
        opacity: 0.72,
      });

    case 'original':
    default:
      // Signals "leave the material alone" — the caller skips assignment entirely rather than
      // substituting a copy, so the artist's authored material survives untouched.
      return null;
  }
}
