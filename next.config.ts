import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 开发模式允许 127.0.0.1 访问：Next 16 默认拦截非 localhost 的 dev 源，
  // 会导致经 127.0.0.1 打开的页面客户端不完成 hydration（仅影响开发模式）。
  allowedDevOrigins: ["127.0.0.1"],
  // Repository downloads are delivered separately from the website runtime.
  outputFileTracingExcludes: { "/*": ["./releases/**/*"] },
};

export default nextConfig;
