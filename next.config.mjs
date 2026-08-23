/**
 * next.config.mjs — WebItUp24
 *
 * Concerns handled here, in order:
 *   1. Image pipeline (Sanity CDN + AVIF/WebP)
 *   2. WebGL / three.js ecosystem transpilation + raw GLSL imports
 *   3. Long-lived immutable caching for 3D assets (.glb / .ktx2 / .hdr)
 *   4. Security headers
 *   5. Bundle hygiene (tree-shaken barrel imports)
 */

/** Origins we legitimately talk to at runtime. Kept in one place so the CSP below stays honest. */
const SANITY_CDN = 'https://cdn.sanity.io';
const SANITY_API = 'https://*.api.sanity.io';
const SANITY_WS = 'wss://*.api.sanity.io';

/**
 * Security headers.
 *
 * NOTE ON CSP: a strict `script-src` breaks Next.js' inline bootstrap unless you wire a
 * nonce through middleware. We ship the non-script directives (which are pure win and
 * cannot break anything) and leave the full nonce-based CSP as an opt-in — see README.
 */
const securityHeaders = [
  // Stop MIME sniffing. Relevant because we serve binary .glb/.ktx2 blobs.
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  // SAMEORIGIN (not DENY): Sanity's Presentation tool iframes the site from /studio.
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'X-DNS-Prefetch-Control', value: 'on' },
  {
    key: 'Permissions-Policy',
    // We need none of these. Explicitly denying them shrinks the attack surface and
    // silences Lighthouse "best practices" nits.
    value: 'camera=(), microphone=(), geolocation=(), interest-cohort=(), payment=()',
  },
  // Only meaningful over HTTPS; Vercel terminates TLS so this is always applicable in prod.
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=63072000; includeSubDomains; preload',
  },
  // Lets the main thread hand off heavy decode work and enables high-res timers,
  // which we use in the perf HUD. Harmless when unused.
  { key: 'Cross-Origin-Opener-Policy', value: 'same-origin' },
  {
    key: 'Content-Security-Policy-Report-Only',
    value: [
      "default-src 'self'",
      `img-src 'self' data: blob: ${SANITY_CDN}`,
      `connect-src 'self' ${SANITY_API} ${SANITY_WS} ${SANITY_CDN}`,
      "media-src 'self' blob: " + SANITY_CDN,
      "worker-src 'self' blob:",
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self' data:",
      "frame-ancestors 'self'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,

  // Vercel serves brotli at the edge; leaving this on also covers self-hosting.
  compress: true,

  eslint: {
    // Never let a lint nit block a deploy — CI runs `pnpm lint` as its own gate.
    ignoreDuringBuilds: false,
  },

  // ---------------------------------------------------------------------------
  // 1. Images
  // ---------------------------------------------------------------------------
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'cdn.sanity.io', pathname: '/images/**' },
      // Sanity file assets (video posters, .glb previews) live under /files/**
      { protocol: 'https', hostname: 'cdn.sanity.io', pathname: '/files/**' },
      { protocol: 'https', hostname: 'source.unsplash.com' },
    ],
    formats: ['image/avif', 'image/webp'],
    // Matches the Tailwind breakpoints in tailwind.config.ts so `sizes` hints resolve
    // to a real generated width instead of the next one up.
    deviceSizes: [420, 640, 828, 1080, 1200, 1600, 1920, 2560, 3840],
    imageSizes: [16, 32, 64, 96, 128, 256, 384],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
    dangerouslyAllowSVG: false,
  },

  // ---------------------------------------------------------------------------
  // 2. WebGL ecosystem
  // ---------------------------------------------------------------------------
  /**
   * `three` ships untranspiled modern ESM in its examples/jsm folder. Transpiling it
   * lets us import addon loaders (DRACOLoader, KTX2Loader, MeshoptDecoder) without
   * "Unexpected token" failures in the server bundle during RSC prerender.
   *
   * Cost: ~3-5s of extra cold build time. Worth it for the correctness guarantee.
   */
  transpilePackages: ['three'],

  experimental: {
    /**
     * Barrel-file tree shaking. `drei` alone re-exports ~250 modules; without this a
     * single `import { useGLTF } from '@react-three/drei'` drags in the whole library
     * and adds ~400kb to the client bundle.
     */
    optimizePackageImports: [
      '@react-three/drei',
      '@react-three/postprocessing',
      'framer-motion',
      'lucide-react',
    ],
  },

  webpack: (config, { isServer }) => {
    /**
     * Raw GLSL imports: `import frag from './shader.frag.glsl'` → string.
     * `asset/source` is built into webpack 5, so this needs no extra loader package.
     *
     * The shaders in src/components/canvas/shaders/ are authored as `.glsl.ts`
     * template literals instead (zero build config, works under Turbopack, and gives
     * real TypeScript import safety). This rule exists so dropping in a third-party
     * `.glsl` file Just Works.
     */
    config.module.rules.push({
      test: /\.(glsl|vs|fs|vert|frag)$/,
      type: 'asset/source',
    });

    // three/examples/jsm ships .wasm decoders (meshopt, basis). Emit them as assets
    // rather than trying to parse them.
    config.module.rules.push({
      test: /\.wasm$/,
      type: 'asset/resource',
    });

    if (!isServer) {
      // `postprocessing` and drei reference `fs` in dev-only codepaths.
      config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false };
    }

    return config;
  },

  // ---------------------------------------------------------------------------
  // 3 + 4. Headers
  // ---------------------------------------------------------------------------
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
      {
        /**
         * 3D assets are content-hashed at export time (see scripts/gltf:optimize),
         * so they are safe to cache forever. This is the single biggest repeat-visit
         * win on a WebGL site — a 4MB .glb should never be re-downloaded.
         */
        source: '/:path*.(glb|gltf|ktx2|hdr|exr|bin|drc)',
        headers: [
          { key: 'Cache-Control', value: 'public, max-age=31536000, immutable' },
          // Required if you ever serve these from a different origin/CDN.
          { key: 'Access-Control-Allow-Origin', value: '*' },
        ],
      },
      {
        source: '/fonts/:path*',
        headers: [{ key: 'Cache-Control', value: 'public, max-age=31536000, immutable' }],
      },
      {
        // Never cache the Studio shell — it must always match the deployed schema.
        source: '/studio/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, must-revalidate' }],
      },
    ];
  },

  async redirects() {
    return [
      // Legacy WordPress-era URLs from the previous webitup24.com build.
      { source: '/portfolio', destination: '/work', permanent: true },
      { source: '/portfolio/:slug', destination: '/work/:slug', permanent: true },
      { source: '/about-us', destination: '/studio-info', permanent: true },
    ];
  },
};

export default nextConfig;
