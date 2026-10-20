import { randomUUID } from "node:crypto"
import withSerwist from "@serwist/next"

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  turbopack: {},
  // Dev only: the Playwright container reaches the test server by its compose hostname.
  allowedDevOrigins: ["shopos-test"],
}

export default withSerwist({
  swSrc: "app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development",
  // No reload when the browser reports the network back: on a flaky line that reloaded the till in the
  // middle of a sale (emptying the cart). Pages recover on their own (lib/connectivity.ts).
  reloadOnOnline: false,
  // app/sw.ts falls back to /offline when a page cannot load, so it must be cached up front.
  // A new revision per build makes tills pick up the latest version.
  additionalPrecacheEntries: [{ url: "/offline", revision: randomUUID() }],
})(nextConfig)
