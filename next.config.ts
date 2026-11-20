import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Old paths, so invite links and bookmarks keep working.
  async redirects() {
    return [
      { source: "/c/:code", destination: "/crew/:code", permanent: true },
      { source: "/me", destination: "/profile", permanent: true },
    ];
  },
};

export default nextConfig;
