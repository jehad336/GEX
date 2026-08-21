/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The API base is the only backend value the browser ever sees. API keys stay
  // on the server: the browser never talks to a market data vendor directly.
  env: {
    NEXT_PUBLIC_API_BASE: process.env.NEXT_PUBLIC_API_BASE ?? 'http://localhost:8000',
  },
};
export default nextConfig;
