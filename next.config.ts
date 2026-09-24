import type { NextConfig } from "next";
import { readFileSync } from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";

const configDir = dirname(fileURLToPath(import.meta.url));
const { version } = JSON.parse(readFileSync(join(configDir, "package.json"), "utf8")) as { version: string };
let piVersion = "unknown";
try {
  const piPkgPath = join(configDir, "node_modules/@earendil-works/pi-coding-agent/package.json");
  piVersion = (JSON.parse(readFileSync(piPkgPath, "utf8")) as { version: string }).version;
} catch { /* package not found, use default */ }

const nextConfig: NextConfig = {
  outputFileTracingRoot: configDir,
  experimental: {
    // proxy.ts matches /api/:path*, and Next buffers the request body whenever
    // a proxy is present, capped at 10 MB by default. The upload route accepts
    // up to 100 MB per request, so raise the buffer above that or large uploads
    // are truncated and fail with "Failed to parse body as FormData."
    proxyClientMaxBodySize: "128mb",
  },
  // next/image is only used for the static logo, so the /_next/image optimizer
  // (and its sharp/libheif attack surface, see GHSA-2xp9-vwfh-vxw4) is not needed.
  images: { unoptimized: true },
  serverExternalPackages: [
    "better-sqlite3",
    "node-pty",
    "undici",
    "web-push",
    "@earendil-works/pi-coding-agent",
    "@earendil-works/pi-agent-core",
    "@earendil-works/pi-ai",
    "@earendil-works/pi-tui",
  ],
  // Next 16 blocks cross-origin access to dev resources by default. Allow the
  // loopback and the RFC1918 LAN ranges so the dev server stays reachable
  // from other machines on the same LAN. Also include the Tailscale CGNAT
  // range (100.64.0.0/10) so the dev server is reachable from Tailscale IPs
  // (e.g. homelab at 100.100.11.0, Mac/iPhone on Tailscale).
  allowedDevOrigins: [
    "127.0.0.1",
    "10.*.*.*",
    // 172.16.0.0/12
    "172.16.*.*",
    "172.17.*.*",
    "172.18.*.*",
    "172.19.*.*",
    "172.20.*.*",
    "172.21.*.*",
    "172.22.*.*",
    "172.23.*.*",
    "172.24.*.*",
    "172.25.*.*",
    "172.26.*.*",
    "172.27.*.*",
    "172.28.*.*",
    "172.29.*.*",
    "172.30.*.*",
    "172.31.*.*",
    "192.168.*.*",
    // Tailscale CGNAT (100.64.0.0/10)
    "100.64.*.*",
    "100.65.*.*",
    "100.66.*.*",
    "100.67.*.*",
    "100.68.*.*",
    "100.69.*.*",
    "100.70.*.*",
    "100.71.*.*",
    "100.72.*.*",
    "100.73.*.*",
    "100.74.*.*",
    "100.75.*.*",
    "100.76.*.*",
    "100.77.*.*",
    "100.78.*.*",
    "100.79.*.*",
    "100.80.*.*",
    "100.81.*.*",
    "100.82.*.*",
    "100.83.*.*",
    "100.84.*.*",
    "100.85.*.*",
    "100.86.*.*",
    "100.87.*.*",
    "100.88.*.*",
    "100.89.*.*",
    "100.90.*.*",
    "100.91.*.*",
    "100.92.*.*",
    "100.93.*.*",
    "100.94.*.*",
    "100.95.*.*",
    "100.96.*.*",
    "100.97.*.*",
    "100.98.*.*",
    "100.99.*.*",
    "100.100.*.*",
    "100.101.*.*",
    "100.102.*.*",
    "100.103.*.*",
    "100.104.*.*",
    "100.105.*.*",
    "100.106.*.*",
    "100.107.*.*",
    "100.108.*.*",
    "100.109.*.*",
    "100.110.*.*",
    "100.111.*.*",
    "100.112.*.*",
    "100.113.*.*",
    "100.114.*.*",
    "100.115.*.*",
    "100.116.*.*",
    "100.117.*.*",
    "100.118.*.*",
    "100.119.*.*",
    "100.120.*.*",
    "100.121.*.*",
    "100.122.*.*",
    "100.123.*.*",
    "100.124.*.*",
    "100.125.*.*",
    "100.126.*.*",
    "100.127.*.*",
  ],
  async headers() {
    return [
      {
        source: "/",
        headers: [
          { key: "Cache-Control", value: "private, no-cache, max-age=0, must-revalidate" },
        ],
      },
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Cache-Control", value: "public, max-age=0, must-revalidate" },
        ],
      },
    ];
  },
  env: {
    NEXT_PUBLIC_APP_VERSION: version,
    NEXT_PUBLIC_PI_VERSION: piVersion,
  },
};

export default nextConfig;
