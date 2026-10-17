import { Analytics } from '@vercel/analytics/next'
import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'ShopOS — POS for small shops',
  description: 'Point of sale, stock, customer credit and daily profit for small shops.',
  // The app (sign-in, the shop itself) stays out of search results; getshopos.online is the public site.
  robots: { index: false, follow: false },
  manifest: '/manifest.webmanifest',
  icons: {
    icon: [
      {
        url: '/icons/icon-192.png',
        sizes: '192x192',
        type: 'image/png',
      },
      {
        url: '/icons/icon-512.png',
        sizes: '512x512',
        type: 'image/png',
      },
    ],
    apple: '/icons/apple-touch.png',
  },
}

export const viewport: Viewport = {
  colorScheme: 'light',
  themeColor: '#f8fafc',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
        {/* Vercel Analytics only exists on Vercel; self-hosted builds would request a missing script. */}
        {process.env.VERCEL && <Analytics />}
      </body>
    </html>
  )
}
