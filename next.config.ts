import type { NextConfig } from "next";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

    // For client-side: stub out Node.js modules and force ESM fflate
    if (!isServer) {
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...config.resolve.fallback,
        module: false,
        worker_threads: false,
        fs: false,
        path: false,
        crypto: false,
      };

      // Force fflate to use explicit browser export path
      // See: https://github.com/101arrowz/fflate/wiki/FAQ
      // The default export can resolve to node version with createRequire
      config.resolve.alias = {
        ...config.resolve.alias,
        'fflate': 'fflate/browser',
      };
    }

    return config;
  },

  ...(process.env.CLOUDFLARE_PAGES !== 'true' ? {
    serverExternalPackages: [
      'better-sqlite3',
      'tiktoken',
      '@character-foundry/voxta',
      '@character-foundry/loader',
      '@character-foundry/charx',
      '@character-foundry/png',
      '@character-foundry/core',
      '@character-foundry/federation',
      '@character-foundry/tokenizers',
      '@character-foundry/normalizer',
      '@character-foundry/exporter',
      '@character-foundry/schemas',
      '@character-foundry/media',
      '@character-foundry/lorebook',
    ],
  } : {}),
};

export default nextConfig;
