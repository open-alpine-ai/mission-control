import type { Metadata, Viewport } from 'next'
import { ThemeProvider } from 'next-themes'
import './globals.css'

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Mission Control',
  description: 'OpenClaw Agent Orchestration Dashboard',
  icons: {
    icon: [
      { url: '/icon.png', type: 'image/png', sizes: '256x256' },
      { url: '/brand/mc-logo-128.png', type: 'image/png', sizes: '128x128' },
    ],
    apple: [{ url: '/apple-icon.png', sizes: '180x180', type: 'image/png' }],
    shortcut: ['/icon.png'],
  },
  openGraph: {
    title: 'Mission Control',
    description: 'OpenClaw Agent Orchestration Dashboard',
    images: [{ url: '/brand/mc-logo-512.png', width: 512, height: 512, alt: 'Mission Control logo' }],
  },
  twitter: {
    card: 'summary',
    title: 'Mission Control',
    description: 'OpenClaw Agent Orchestration Dashboard',
    images: ['/brand/mc-logo-512.png'],
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: 'black-translucent',
    title: 'Mission Control',
  },
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <ThemeProvider
          attribute="class"
          defaultTheme="dark"
          enableSystem={false}
          disableTransitionOnChange
        >
          <div className="h-screen overflow-hidden bg-background text-foreground">
            {children}
          </div>
        </ThemeProvider>
      </body>
    </html>
  )
}
