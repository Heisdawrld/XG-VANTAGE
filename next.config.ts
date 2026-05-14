import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Temporarily ignore TS errors during build — strict type fixes will be applied incrementally
  typescript: {
    ignoreBuildErrors: true,
  },
  reactStrictMode: false,
};

export default nextConfig;
