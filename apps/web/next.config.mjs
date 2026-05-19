import path from "path"
import { fileURLToPath } from "url"
import createNextIntlPlugin from "next-intl/plugin"
import { withSentryConfig } from "@sentry/nextjs"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const withNextIntl = createNextIntlPlugin("./i18n.ts")

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Expose signing feature flag to the client — derived from DOCUSEAL_API_KEY
  // so users never need to set a separate toggle. No key = signing hidden.
  env: {
    NEXT_PUBLIC_SIGNING_ENABLED: process.env.DOCUSEAL_API_KEY ? "true" : "false",
  },
  output: "standalone",
  // In a pnpm monorepo the root node_modules lives two levels up.
  // Setting this tells Next.js to trace dependencies from the monorepo
  // root so the standalone bundle includes packages like 'next' itself.
  experimental: {
    // Required for the instrumentation.ts hook (OpenTelemetry bootstrap)
    instrumentationHook: true,
    outputFileTracingRoot: path.join(__dirname, "../../"),
    // pdf-parse v1 runs a test file on import — keep it out of the Next.js
    // bundle so it loads at runtime via Node.js require, not at build time.
    serverComponentsExternalPackages: ["pdf-parse"],
    // Never serve a stale RSC payload for dynamic pages (those that use
    // cookies/headers or cache:'no-store').  Without this, the client-side
    // Router Cache re-uses the last render for ~30 s, so the dashboard shows
    // outdated contract counts even though the server always fetches fresh data.
    // Static pages keep the default 5-minute cache (300 s).
    staleTimes: {
      dynamic: 0,
      static: 300,
    },
  },
}

export default withSentryConfig(
  withNextIntl(nextConfig),
  {
    org: "aaked",
    project: "aaked-web",
    silent: true,
    widenClientFileUpload: true,
    tunnelRoute: "/monitoring",
    hideSourceMaps: true,
    disableLogger: true,
    automaticVercelMonitors: true,
  },
)
