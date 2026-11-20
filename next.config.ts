import type { NextConfig } from "next";
import path from "node:path";

// `npm run build:selfhost` should always emit the standalone server bundle.
// Keep the environment flag as a fallback for Docker and direct CLI builds.
const selfHosted =
  process.env.SELF_HOSTED === "true" ||
  process.env.npm_lifecycle_event === "build:selfhost";

function documentHeaders(preview: string, frameable: boolean) {
  const headers = [
    { key: "X-Content-Type-Options", value: "nosniff" },
    { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
    { key: "Cross-Origin-Opener-Policy", value: frameable ? "unsafe-none" : "same-origin" },
    { key: "Content-Security-Policy", value: `default-src 'self'; base-uri 'self'; frame-ancestors ${frameable ? "*" : "'none'"}; frame-src 'self' ${preview}; form-action 'self'; object-src 'none'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self';` },
  ];
  // Header rules all apply, and a later rule replaces the same field.
  // Public shares are listed after the catch-all so they can be embedded.
  // ALLOWALL is not a real X-Frame-Options value, so browsers ignore it.
  headers.push({ key: "X-Frame-Options", value: frameable ? "ALLOWALL" : "DENY" });
  return headers;
}

const nextConfig: NextConfig = {
  output: selfHosted ? "standalone" : undefined,
  async headers() {
    const preview = process.env.PROTOTYPE_PREVIEW_ORIGIN ? new URL(process.env.PROTOTYPE_PREVIEW_ORIGIN).origin : "";
    const locked = documentHeaders(preview, false);
    const frameable = documentHeaders(preview, true);
    return [
      { source: "/", headers: locked },
      { source: "/:path*", headers: locked },
      { source: "/s/:path*", headers: frameable },
      { source: "/prototype/s/:path*", headers: frameable },
    ];
  },
  webpack(config, { webpack }) {
    config.resolve.alias["@"] = path.resolve(process.cwd());
    if (selfHosted) {
      config.plugins.push(new webpack.NormalModuleReplacementPlugin(
        /lib[\\/]platform-env\.ts$/,
        path.resolve(process.cwd(), "lib/cloudflare-workers-selfhost.ts"),
      ));
    }
    return config;
  },
};

export default nextConfig;
