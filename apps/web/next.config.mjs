import path from "path"
import { fileURLToPath } from "url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // In a pnpm monorepo the root node_modules lives two levels up.
  // Setting this tells Next.js to trace dependencies from the monorepo
  // root so the standalone bundle includes packages like 'next' itself.
  experimental: {
    outputFileTracingRoot: path.join(__dirname, "../../"),
  },
}

export default nextConfig
