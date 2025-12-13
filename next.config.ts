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

      // Force browser conditions for package.json exports resolution
      // This prevents fflate from resolving to the "node" conditional export
      config.resolve.conditionNames = ['browser', 'import', 'default'];

      // Force fflate to use the browser-compatible ESM version
      // The node version uses createRequire which doesn't exist in browsers
      const fflateBasePath = path.resolve(__dirname, 'node_modules/fflate');
      config.resolve.alias = {
        ...config.resolve.alias,
        // Match all fflate import variations
        'fflate$': path.join(fflateBasePath, 'esm/browser.js'),
        'fflate/esm/index.mjs': path.join(fflateBasePath, 'esm/browser.js'),
        'fflate/esm/index.js': path.join(fflateBasePath, 'esm/browser.js'),
        'fflate/lib/node.cjs': path.join(fflateBasePath, 'esm/browser.js'),
        'fflate': path.join(fflateBasePath, 'esm/browser.js'),
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
