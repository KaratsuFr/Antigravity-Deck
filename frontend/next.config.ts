import type { NextConfig } from "next";

const isExport = process.env.NEXT_EXPORT === 'true' || process.env.NODE_ENV === 'production';
const BE_PORT = process.env.BACKEND_PORT || '3500';
const BE_HOST = `http://localhost:${BE_PORT}`;

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: isExport ? 'export' : undefined,
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
  ...(isExport ? {} : {
    experimental: {
      proxyTimeout: 60_000,
    },
    httpAgentOptions: {
      keepAlive: true,
    },
    async rewrites() {
      return [
        {
          source: '/api/:path*',
          destination: `${BE_HOST}/api/:path*`,
        },
      ];
    },
  }),
};

export default nextConfig;
