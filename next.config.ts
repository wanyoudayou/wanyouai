import type { NextConfig } from "next";

/**
 * Site-wide response hardening. Pages are never meant to be framed (owner
 * actions under /admin must not be clickjacked); the camera stays available to
 * same-origin pages for check-in scanning.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=(), payment=()" },
];

const nextConfig: NextConfig = {
  // 开发模式允许 127.0.0.1 访问：Next 16 默认拦截非 localhost 的 dev 源，
  // 会导致经 127.0.0.1 打开的页面客户端不完成 hydration（仅影响开发模式）。
  allowedDevOrigins: ["127.0.0.1"],
  // Repository downloads are delivered separately from the website runtime.
  outputFileTracingExcludes: { "/*": ["./releases/**/*"] },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
