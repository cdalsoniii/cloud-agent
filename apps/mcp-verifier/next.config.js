/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  poweredByHeader: false,
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
  env: {
    MASTRA_API_URL: 'http://localhost:4111',
  },
  outputFileTracingRoot: __dirname,
};

module.exports = nextConfig;
