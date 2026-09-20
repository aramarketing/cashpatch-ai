import './globals.css'

export const metadata = {
  title: 'CashPatch — Recover lost revenue',
  description: 'Find money leaks across leads, quotes, invoices and recurring costs.'
}

export default function RootLayout({ children }: Readonly<{children: React.ReactNode}>) {
  return <html lang="en"><body>{children}</body></html>
}
