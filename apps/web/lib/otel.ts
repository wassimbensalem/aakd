/**
 * OpenTelemetry SDK bootstrap.
 * Imported by both the Next.js instrumentation hook and the BullMQ worker.
 * Safe to call multiple times — only initialises once.
 */

import { NodeSDK } from "@opentelemetry/sdk-node"
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { resourceFromAttributes } from "@opentelemetry/resources"
import {
  SEMRESATTRS_SERVICE_NAME,
  SEMRESATTRS_SERVICE_VERSION,
} from "@opentelemetry/semantic-conventions"

let _sdk: NodeSDK | null = null

export function initOtel(serviceName: string): void {
  if (_sdk) return // already initialised
  if (process.env.OTEL_ENABLED !== "true") return

  const exporterUrl =
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318"

  const exporter = new OTLPTraceExporter({
    url: `${exporterUrl}/v1/traces`,
  })

  _sdk = new NodeSDK({
    resource: resourceFromAttributes({
      [SEMRESATTRS_SERVICE_NAME]:
        process.env.OTEL_SERVICE_NAME ?? serviceName,
      [SEMRESATTRS_SERVICE_VERSION]:
        process.env.npm_package_version ?? "0.0.0",
    }),
    traceExporter: exporter,
    instrumentations: [
      getNodeAutoInstrumentations({
        // Disable noisy filesystem instrumentation
        "@opentelemetry/instrumentation-fs": { enabled: false },
      }),
    ],
  })

  _sdk.start()

  // Flush and shutdown cleanly on process exit
  process.on("SIGTERM", () => {
    _sdk?.shutdown().catch(() => {})
  })
}
