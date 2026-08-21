import type { NextConfig } from "next";

const isPagesBuild = process.env.GITHUB_PAGES === "true";
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? "";

const nextConfig: NextConfig = {
  output: isPagesBuild ? "export" : "standalone",
  basePath,
  assetPrefix: basePath || undefined,
  images: { unoptimized: isPagesBuild },
  trailingSlash: isPagesBuild,
};

export default nextConfig;
