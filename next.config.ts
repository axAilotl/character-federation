import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: '50mb',
    },
  },

  images: {
    remotePatterns: [],
    unoptimized: true,
  },

  async rewrites() {
    return [
      {
        source: '/uploads/:path*',
        destination: '/api/uploads/:path*',
      },
    ];
  },

  webpack: (config, { isServer }) => {
    // Exclude native modules on Cloudflare Workers
    if (process.env.CLOUDFLARE_PAGES === 'true' && isServer) {
      config.externals = config.externals || [];
      if (Array.isArray(config.externals)) {
        config.externals.push('better-sqlite3', 'sharp');
      }
    }

    return config;
  },

  ...(process.env.CLOUDFLARE_PAGES !== 'true' ? {
    serverExternalPackages: ['better-sqlite3', 'tiktoken'],
  } : {}),
};

export default nextConfig;
