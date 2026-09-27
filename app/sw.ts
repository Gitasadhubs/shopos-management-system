/// <reference lib="webworker" />

import {
  CacheFirst,
  ExpirationPlugin,
  NetworkFirst,
  NetworkOnly,
  Serwist,
  StaleWhileRevalidate,
} from "serwist"

declare const self: ServiceWorkerGlobalScope & {
  __SW_MANIFEST: Array<string | { url: string; revision?: string | null }>
}

const apiData = new NetworkFirst({
  cacheName: "api-data",
  networkTimeoutSeconds: 5,
  plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 })],
})

const reports = new NetworkFirst({
  cacheName: "report-data",
  networkTimeoutSeconds: 3,
  plugins: [new ExpirationPlugin({ maxEntries: 50, maxAgeSeconds: 60 * 60 })],
})

const staticAssets = new StaleWhileRevalidate({
  cacheName: "static-assets",
  plugins: [new ExpirationPlugin({ maxEntries: 200, maxAgeSeconds: 60 * 60 * 24 * 30 })],
})

const images = new CacheFirst({
  cacheName: "image-assets",
  plugins: [new ExpirationPlugin({ maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 })],
})

const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  runtimeCaching: [
    {
      matcher: ({ url }: { url: URL }) => ["/api/products", "/api/customers", "/api/suppliers", "/api/settings"].includes(url.pathname),
      handler: apiData,
    },
    {
      matcher: ({ url }: { url: URL }) => ["/api/sales", "/api/purchases"].includes(url.pathname),
      handler: new NetworkOnly(),
    },
    {
      matcher: ({ url }: { url: URL }) => url.pathname.startsWith("/api/reports/"),
      handler: reports,
    },
    {
      matcher: ({ request }: { request: Request }) => ["script", "style", "font"].includes(request.destination),
      handler: staticAssets,
    },
    {
      matcher: ({ request }: { request: Request }) => request.destination === "image",
      handler: images,
    },
  ],
  navigateFallback: "/offline",
  navigateFallbackDenylist: [/^\/api\//, /^\/auth\//, /^\/login/, /^\/signup/],
  skipWaiting: true,
  clientsClaim: true,
  reloadOnOnline: true,
} as unknown as ConstructorParameters<typeof Serwist>[0])

serwist.addEventListeners()
