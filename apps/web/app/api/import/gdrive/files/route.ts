import { resolveAuth, requireWriteScope } from "@/lib/auth/middleware"
import { requestContext } from "@/lib/context"
import { prisma } from "@/lib/db/client"

export async function GET(req: Request) {
  if (!process.env.GOOGLE_CLIENT_ID) {
    return Response.json({ error: "google_drive_not_configured" }, { status: 503 })
  }

  const ctx = await resolveAuth(req)
  if (!ctx) return Response.json({ error: "Unauthorized" }, { status: 401 })
  const scopeError = requireWriteScope(ctx)
  if (scopeError) return scopeError

  return requestContext.run(ctx, async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const integrationModel = prisma.googleDriveIntegration
    if (!integrationModel) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    const integration = await integrationModel.findUnique({
      where: { organizationId: ctx.organizationId },
    })
    if (!integration) {
      return Response.json({ error: "Not Found" }, { status: 404 })
    }

    const url = new URL(req.url)
    const folderId = url.searchParams.get("folderId") ?? "root"

    // The Drive API client (refresh + list) lives in lib/import/gdrive-client
    // which the m10-core branch owns. Resolve it dynamically so this route
    // typechecks before that branch lands.
    let listDriveFiles:
      | ((integration: unknown, folderId: string) => Promise<{ files: unknown[]; truncated: boolean }>)
      | undefined
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const mod = (await import("@/lib/import/gdrive-client" as any)) as {
        listDriveFiles?: typeof listDriveFiles
      }
      listDriveFiles = mod.listDriveFiles
    } catch {
      // Module not present yet — m10-core branch will provide it.
    }

    if (!listDriveFiles) {
      return Response.json({ error: "drive_client_unavailable" }, { status: 503 })
    }

    try {
      const result = await listDriveFiles(integration, folderId)
      return Response.json({
        folderId,
        files: result.files,
        truncated: result.truncated,
      })
    } catch (err) {
      console.error("[gdrive.files] list failed:", err)
      return Response.json({ error: "drive_list_failed" }, { status: 502 })
    }
  })
}
