import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    optimizeCss: false, // lightningcss kapalı
  },
};

export default nextConfig;
