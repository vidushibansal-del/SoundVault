import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SoundVault',
  description: 'Search your sound library',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
