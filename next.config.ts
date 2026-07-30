import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  reactStrictMode: true,
  serverExternalPackages: ["@napi-rs/canvas", "pdf-parse", "pdfjs-dist"]
};

export default nextConfig;
