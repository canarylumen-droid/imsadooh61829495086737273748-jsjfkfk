import React from "react"
import type { Metadata, Viewport } from 'next'
import { Barlow, Barlow_Condensed, IBM_Plex_Mono } from 'next/font/google'
import './globals.css'

const barlow = Barlow({
  subsets: ["latin"],
  weight: ["300", "400", "500", "600", "700", "800", "900"],
  variable: '--font-barlow',
  display: 'swap',
})

const barlowCondensed = Barlow_Condensed({
  subsets: ["latin"],
  weight: ["600", "700", "800"],
  style: ["normal", "italic"],
  variable: '--font-barlow-condensed',
  display: 'swap',
})

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: '--font-ibm-plex-mono',
  display: 'swap',
})

export const metadata: Metadata = {
  title: 'AUDNIX AI — Sales & Email Automation Platform | Cold Email, Marketing Automation',
  description: 'Audnix AI automates cold email outreach, sales follow-ups, and lead recovery. The best email marketing automation and sales force automation platform for agencies and creators.',
  keywords: [
    'email marketing automation', 'email automation', 'sales automation',
    'cold email outreach', 'cold email', 'marketing automation',
    'email marketing software', 'email automation platform',
    'best email marketing automation', 'sales automation software',
    'sales force automation', 'sales automation tools',
    'sales automation platform', 'cold email software',
    'what is sales automation', 'marketing automation platforms',
    'email marketing campaigns', 'workflow automation',
    'sales and marketing automation', 'crm sales automation',
    'ai for sales automation', 'best sales automation software',
    'email automation software', 'email automation tools',
    'email automation services', 'email workflow automation',
    'what is email automation', 'crm email automation',
    'b2b cold email', 'cold email campaign', 'cold email prospecting',
    'cold email template', 'cold email agency',
    'lead generation', 'AI sales rep', 'email outreach',
    'Audnix AI', 'Audnix', 'pricing', 'start free trial',
    'agencies', 'creators', 'lead recovery',
    'objection handling', 'terms of service', 'sales teams',
  ],
  openGraph: {
    title: 'AUDNIX AI — Sales & Email Automation Platform | Cold Email, Marketing Automation',
    description: 'Automate cold email outreach, sales follow-ups, and lead recovery with AI. Best email marketing automation and sales force automation platform for agencies and creators.',
    type: 'website',
    locale: 'en_US',
    siteName: 'AUDNIX AI',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AUDNIX AI — Sales & Email Automation Platform | Cold Email, Marketing Automation',
    description: 'Automate cold email outreach, sales follow-ups, and lead recovery with AI. Best email marketing automation and sales force automation platform.',
  },
}

export const viewport: Viewport = {
  themeColor: '#050505',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const jsonLd = {
    '@context': 'https://schema.org',
    '@type': 'ItemList',
    itemListElement: [
      { '@type': 'SiteNavigationElement', position: 1, name: 'Home', url: 'https://audnixai.com' },
      { '@type': 'SiteNavigationElement', position: 2, name: 'Pricing', url: 'https://audnixai.com/pricing' },
      { '@type': 'SiteNavigationElement', position: 3, name: 'Start Free Trial', url: 'https://audnixai.com/signup' },
      { '@type': 'SiteNavigationElement', position: 4, name: 'For Agencies', url: 'https://audnixai.com/solutions/agencies' },
      { '@type': 'SiteNavigationElement', position: 5, name: 'Lead Recovery', url: 'https://audnixai.com/lead-recovery' },
      { '@type': 'SiteNavigationElement', position: 6, name: 'For Creators', url: 'https://audnixai.com/solutions/creators' },
      { '@type': 'SiteNavigationElement', position: 7, name: 'Terms of Service', url: 'https://audnixai.com/terms-of-service' },
      { '@type': 'SiteNavigationElement', position: 8, name: 'Objection Handling', url: 'https://audnixai.com/objection-handling' },
      { '@type': 'SiteNavigationElement', position: 9, name: 'For Sales Teams', url: 'https://audnixai.com/solutions/sales-teams' },
      { '@type': 'SiteNavigationElement', position: 10, name: 'Privacy Policy', url: 'https://audnixai.com/privacy-policy' },
    ],
  }

  return (
    <html lang="en">
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className={`${barlow.variable} ${barlowCondensed.variable} ${ibmPlexMono.variable} font-sans antialiased`}>
        {children}
      </body>
    </html>
  )
}
