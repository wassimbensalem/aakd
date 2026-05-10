import path from "path"
import { fileURLToPath } from "url"
import createNextIntlPlugin from "next-intl/plugin"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const withNextIntl = createNextIntlPlugin("./i18n.ts")

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // In a pnpm monorepo the root node_modules lives two levels up.
  // Setting this tells Next.js to trace dependencies from the monorepo
  // root so the standalone bundle includes packages like 'next' itself.
  experimental: {
    outputFileTracingRoot: path.join(__dirname, "../../"),
    // pdf-parse v1 runs a test file on import — keep it out of the Next.js
    // bundle so it loads at runtime via Node.js require, not at build time.
    serverComponentsExternalPackages: ["pdf-parse"],
  },
}

export default withNextIntl(nextConfig)
