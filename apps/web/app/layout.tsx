import type { Metadata } from "next"
import { GeistSans } from "geist/font/sans"
import { GeistMono } from "geist/font/mono"
import { Manrope, JetBrains_Mono, Sora } from "next/font/google"
import { ThemeProvider } from "next-themes"
import { NextIntlClientProvider } from "next-intl"
import { getLocale, getMessages } from "next-intl/server"
import { Toaster } from "@/components/ui/sonner"
import { isRtl, type Locale } from "@/lib/i18n/config"
import { PostHogProvider } from "@/components/providers/posthog-provider"
import { CookieConsent } from "@/components/cookie-consent"
import "./globals.css"

const manrope = Manrope({
  subsets: ["latin"],
  variable: "--font-manrope",
  display: "swap",
})

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
})

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
  weight: ["700", "800"],
  display: "swap",
})

export const metadata: Metadata = {
  title: "Aakd",
  description: "Open source, self-hostable contract management",
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  const locale = (await getLocale()) as Locale
  const messages = await getMessages()
  const dir = isRtl(locale) ? "rtl" : "ltr"

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${GeistSans.variable} ${GeistMono.variable} ${manrope.variable} ${jetbrainsMono.variable} ${sora.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem storageKey="aakd-theme">
            <PostHogProvider>
              {children}
              <Toaster richColors />
              <CookieConsent />
            </PostHogProvider>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  )
}
