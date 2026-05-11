"use client"

import { useTranslations } from "next-intl"
import { Activity, ActivityAction } from "@/lib/types"
import { RelativeTime } from "@/components/relative-time"
import {
  FileText, Upload, Pencil, RefreshCw, MessageSquare,
  CheckCircle, XCircle, Send, PenLine, Bell, Cpu,
  Download, Trash, Archive, Tag as TagIcon, Plus
} from "lucide-react"

const ACTION_ICON: Record<ActivityAction, React.ComponentType<{ className?: string }>> = {
  CREATED:            Plus,
  UPLOADED:           Upload,
  UPDATED:            Pencil,
  STATUS_CHANGED:     RefreshCw,
  COMMENTED:          MessageSquare,
  APPROVAL_REQUESTED: Send,
  APPROVED:           CheckCircle,
  REJECTED:           XCircle,
  SENT_FOR_SIGNATURE: Send,
  SIGNED:             PenLine,
  ALERT_FIRED:        Bell,
  METADATA_EXTRACTED: Cpu,
  METADATA_UPDATED:   Cpu,
  DOWNLOADED:         Download,
  DELETED:            Trash,
  ARCHIVED:           Archive,
  TAGGED:             TagIcon,
  APPROVAL_CANCELLED: XCircle,
}

export function ActivityTimeline({ activities }: { activities: Activity[] }) {
  const t = useTranslations("activity")

  if (activities.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center">{t("noActivity")}</p>
    )
  }

  return (
    <ol className="space-y-4">
      {activities.map((entry, i) => {
        const Icon = ACTION_ICON[entry.action] ?? FileText
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
                <span className="text-muted-foreground">
                  {entry.action in ACTION_ICON ? t(entry.action as ActivityAction) : entry.action}
                </span>
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
