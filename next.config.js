/** @type {import('next').NextConfig} */
const nextConfig = {
  // TravelMap manages its Leaflet instance manually with a proper map.remove()
  // cleanup, so Strict Mode's dev double-mount is safe to keep enabled.
  reactStrictMode: true,
  // Allow an alternate build directory (e.g. for isolated verification builds
  // that must not clobber a running dev server's .next). Defaults to ".next".
  distDir: process.env.NEXT_DIST_DIR || ".next",
  // Produce a self-contained server bundle (.next/standalone) so the Docker
  // runner image only needs Node.js + the traced dependencies.
  output: "standalone",
  // The travel-tick and chat handlers reach out to Postgres, the local Ollama
  // daemon, and the public Overpass API. Keep them on the Node.js runtime (not
  // Edge) where pg + long-lived fetch + AbortController behave predictably, and
  // let Next trace the native `pg` package instead of trying to bundle it.
  experimental: {
    serverComponentsExternalPackages: ["pg", "web-push"],
  },
};

module.exports = nextConfig;
