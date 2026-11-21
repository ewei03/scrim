import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Security headers on every page. The CSP doesn't limit scripts (that needs
  // per-request nonces, which rule out static pages); it stops other sites
  // framing Scrim (clickjacking) and blocks plugins, <base> hijacking and
  // forms posting elsewhere.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
        ],
      },
    ];
  },
  // Old paths, so invite links and bookmarks keep working.
  async redirects() {
    return [
      { source: "/c/:code", destination: "/crew/:code", permanent: true },
      { source: "/me", destination: "/profile", permanent: true },
    ];
  },
};

export default nextConfig;
