import { Activity, ActivityAction } from "@/lib/types"
import { RelativeTime } from "@/components/relative-time"
import {
  FileText, Upload, Pencil, RefreshCw, MessageSquare,
  CheckCircle, XCircle, Send, PenLine, Bell, Cpu,
  Download, Trash, Archive, Tag as TagIcon, Plus
} from "lucide-react"

const actionConfig: Record<ActivityAction, { label: string; Icon: React.ComponentType<{ className?: string }> }> = {
  CREATED: { label: "Created contract", Icon: Plus },
  UPLOADED: { label: "Uploaded file", Icon: Upload },
  UPDATED: { label: "Updated contract", Icon: Pencil },
  STATUS_CHANGED: { label: "Changed status", Icon: RefreshCw },
  COMMENTED: { label: "Commented", Icon: MessageSquare },
  APPROVAL_REQUESTED: { label: "Requested approval", Icon: Send },
  APPROVED: { label: "Approved", Icon: CheckCircle },
  REJECTED: { label: "Rejected", Icon: XCircle },
  SENT_FOR_SIGNATURE: { label: "Sent for signature", Icon: Send },
  SIGNED: { label: "Signed", Icon: PenLine },
  ALERT_FIRED: { label: "Alert fired", Icon: Bell },
  METADATA_EXTRACTED: { label: "Metadata extracted", Icon: Cpu },
  METADATA_UPDATED: { label: "Metadata updated", Icon: Cpu },
  DOWNLOADED: { label: "Downloaded file", Icon: Download },
  DELETED: { label: "Deleted", Icon: Trash },
  ARCHIVED: { label: "Archived", Icon: Archive },
  TAGGED: { label: "Tagged", Icon: TagIcon },
  APPROVAL_CANCELLED: { label: "Cancelled approval request", Icon: XCircle },
}

export function ActivityTimeline({ activities }: { activities: Activity[] }) {
  if (activities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">No activity yet.</p>
    )
  }

  return (
    <ol className="space-y-4">
      {activities.map((entry, i) => {
        const config = actionConfig[entry.action] ?? { label: entry.action, Icon: FileText }
        const { Icon } = config
        return (
          <li key={entry.id} className="flex gap-3">
            <div className="flex flex-col items-center">
              <div className="flex h-8 w-8 items-center justify-center rounded-full bg-muted shrink-0">
                <Icon className="h-3.5 w-3.5 text-muted-foreground" />
              </div>
              {i < activities.length - 1 && (
                <div className="mt-1 w-px flex-1 bg-border" />
              )}
            </div>
            <div className="pb-4 flex-1">
              <p className="text-sm">
                <span className="font-medium">{entry.user?.name ?? entry.actorLabel}</span>{" "}
                <span className="text-muted-foreground">{config.label}</span>
              </p>
              {entry.detail && (
                <p className="text-xs text-muted-foreground mt-0.5">{entry.detail}</p>
              )}
              <p className="text-xs text-muted-foreground mt-1">
                <RelativeTime date={entry.createdAt} />
              </p>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
