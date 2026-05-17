export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { initOtel } = await import("./lib/otel")
    initOtel("clauseflow-web")
  }
}
