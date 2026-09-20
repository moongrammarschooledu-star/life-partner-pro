import type { NextConfig } from "next";
import { readFileSync } from "fs";

const pkg = JSON.parse(readFileSync("./package.json", "utf8")) as { version: string };
const isProd = process.env.NODE_ENV === "production";

// Content-Security-Policy (spec §20). Ships REPORT-ONLY by default: an
// enforced CSP that has not been click-tested across every authenticated
// admin/applicant page could break required functionality, so enforcement is
// an explicit opt-in (CSP_MODE=enforce) after violations have been reviewed.
// 'unsafe-inline' scripts/styles are required by Next's inline bootstrap
// scripts and Tailwind/next-font styles (a nonce-based policy would force
// every page dynamic); 'unsafe-eval' is dev-only (React refresh).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isProd ? "" : " 'unsafe-eval'"}`,
  "style-src 'self' 'unsafe-inline'",
  "font-src 'self' data:",
  "img-src 'self' data: blob:",
  "connect-src 'self'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  ...(isProd ? ["upgrade-insecure-requests"] : []),
].join("; ");

const cspHeader = process.env.CSP_MODE === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";

const securityHeaders = [
  { key: cspHeader, value: csp },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  // HSTS only in production — never pin HTTPS for localhost/preview hosts.
  ...(isProd ? [{ key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" }] : []),
];

const nextConfig: NextConfig = {
  serverExternalPackages: ["sharp", "bcryptjs"],
  poweredByHeader: false,
  env: { APP_VERSION: pkg.version },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
