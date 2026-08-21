/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: process.env.GITHUB_PAGES === 'true' ? 'export' : undefined,
  basePath: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  assetPrefix: process.env.NEXT_PUBLIC_BASE_PATH ?? '',
  images: { unoptimized: process.env.GITHUB_PAGES === 'true' },
  trailingSlash: process.env.GITHUB_PAGES === 'true',
  // The API base is the only backend value the browser ever sees. API keys stay
  // on the server: the browser never talks to a market data vendor directly.
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000',
  },
};
export default nextConfig;
