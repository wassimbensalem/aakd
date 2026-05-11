"use client"

import { useEffect, useRef, useState, useCallback } from "react"
import { useRouter } from "next/navigation"
import {
  Bell,
  CheckCircle2,
  XCircle,
  FileUp,
  PenLine,
  AlertTriangle,
  AlertCircle,
  Archive,
  Clock,
  UserPlus,
  ShieldCheck,
  ClipboardCheck,
  type LucideIcon,
} from "lucide-react"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { cn } from "@/lib/utils"

interface Notification {
  id: string
  contractId: string | null
  eventName: string
  title: string
  body: string
  read: boolean
  readAt: string | null
  createdAt: string
}

// ─── Event → icon + palette ────────────────────────────────────────────────

type EventMeta = {
  Icon: LucideIcon
  iconBg: string
  iconFg: string
}

function getEventMeta(eventName: string): EventMeta {
  const e = eventName.toLowerCase()

  if (e.includes("approval") && (e.includes("request") || e.includes("assigned")))
    return {
      Icon: ClipboardCheck,
      iconBg: "bg-amber-100 dark:bg-amber-900/30",
      iconFg: "text-amber-600 dark:text-amber-400",
    }
  if (e.includes("approval") && e.includes("approved"))
    return {
      Icon: CheckCircle2,
      iconBg: "bg-emerald-100 dark:bg-emerald-900/30",
      iconFg: "text-emerald-600 dark:text-emerald-400",
    }
  if (e.includes("rejected") || e.includes("declined"))
    return {
      Icon: XCircle,
      iconBg: "bg-red-100 dark:bg-red-900/30",
      iconFg: "text-red-500 dark:text-red-400",
    }
  if (e.includes("upload") || e.includes("created"))
    return {
      Icon: FileUp,
      iconBg: "bg-sky-100 dark:bg-sky-900/30",
      iconFg: "text-sky-500 dark:text-sky-400",
    }
  if (e.includes("sign"))
    return {
      Icon: PenLine,
      iconBg: "bg-emerald-100 dark:bg-emerald-900/30",
      iconFg: "text-emerald-600 dark:text-emerald-400",
    }
  if (e.includes("expiring"))
    return {
      Icon: AlertTriangle,
      iconBg: "bg-amber-100 dark:bg-amber-900/30",
      iconFg: "text-amber-600 dark:text-amber-400",
    }
  if (e.includes("expired") || e.includes("overdue"))
    return {
      Icon: AlertCircle,
      iconBg: "bg-red-100 dark:bg-red-900/30",
      iconFg: "text-red-500 dark:text-red-400",
    }
  if (e.includes("obligation") || e.includes("due"))
    return {
      Icon: Clock,
      iconBg: "bg-orange-100 dark:bg-orange-900/30",
      iconFg: "text-orange-500 dark:text-orange-400",
    }
  if (e.includes("archive"))
    return {
      Icon: Archive,
      iconBg: "bg-zinc-100 dark:bg-zinc-800",
      iconFg: "text-zinc-500 dark:text-zinc-400",
    }
  if (e.includes("joined"))
    return {
      Icon: UserPlus,
      iconBg: "bg-violet-100 dark:bg-violet-900/30",
      iconFg: "text-violet-500 dark:text-violet-400",
    }
  if (e.includes("role"))
    return {
      Icon: ShieldCheck,
      iconBg: "bg-sky-100 dark:bg-sky-900/30",
      iconFg: "text-sky-500 dark:text-sky-400",
    }

  return {
    Icon: Bell,
    iconBg: "bg-muted",
    iconFg: "text-muted-foreground",
  }
}

// ─── Relative time ──────────────────────────────────────────────────────────

function formatRelativeTime(dateString: string): string {
  const diffMs = Date.now() - new Date(dateString).getTime()
  const s = Math.floor(diffMs / 1000)
  const m = Math.floor(s / 60)
  const h = Math.floor(m / 60)
  const d = Math.floor(h / 24)

  if (s < 60) return "just now"
  if (m < 60) return `${m}m ago`
  if (h < 24) return `${h}h ago`
  if (d < 7) return `${d}d ago`
  return new Date(dateString).toLocaleDateString()
}

// ─── Component ──────────────────────────────────────────────────────────────

export function NotificationBell() {
  const router = useRouter()
  const [notifications, setNotifications] = useState<Notification[]>([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [open, setOpen] = useState(false)
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchNotifications = useCallback(async () => {
    try {
      const res = await fetch("/api/notifications")
      if (!res.ok) return
      const data = await res.json()
      setNotifications(data.notifications ?? [])
      setUnreadCount(data.unreadCount ?? 0)
    } catch {
      // silently ignore network errors
    }
  }, [])

  useEffect(() => {
    fetchNotifications()
    intervalRef.current = setInterval(fetchNotifications, 10_000)
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current)
    }
  }, [fetchNotifications])

  async function handleMarkAllRead() {
    try {
      await fetch("/api/notifications/read-all", { method: "POST" })
      await fetchNotifications()
    } catch {
      // silently ignore
    }
  }

  function handleOpenChange(next: boolean) {
    setOpen(next)
    if (next && unreadCount > 0) handleMarkAllRead()
    if (!next) fetchNotifications()
  }

  function handleNotificationClick(n: Notification) {
    setOpen(false)
    if (n.contractId) router.push(`/contracts/${n.contractId}`)
  }

  const badgeCount = unreadCount > 9 ? "9+" : unreadCount > 0 ? String(unreadCount) : null
  const hasUnread = unreadCount > 0

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      {/* ── Trigger ── */}
      <PopoverTrigger
        className="relative flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted/60 hover:text-foreground transition-colors outline-none"
        aria-label="Notifications"
      >
        {/* Pulse ring when unread */}
        {hasUnread && (
          <span className="absolute inset-0 rounded-lg animate-ping bg-primary/20 pointer-events-none" />
        )}
        <Bell className="h-4 w-4 relative" strokeWidth={1.8} />
        {badgeCount && (
          <span className="absolute -top-1 -right-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-primary px-1 text-[9px] font-bold leading-none text-primary-foreground shadow-sm">
            {badgeCount}
          </span>
        )}
      </PopoverTrigger>

      {/* ── Panel ── */}
      <PopoverContent
        side="bottom"
        align="end"
        sideOffset={10}
        className="w-[360px] p-0 overflow-hidden rounded-xl border border-border bg-background shadow-xl text-foreground"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-foreground">Notifications</span>
            {unreadCount > 0 && (
              <span className="inline-flex items-center justify-center h-5 min-w-5 rounded-full bg-primary/15 px-1.5 text-[10px] font-semibold text-primary">
                {unreadCount}
              </span>
            )}
          </div>
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={handleMarkAllRead}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              Mark all read
            </button>
          )}
        </div>

        {/* List */}
        <div className="max-h-[380px] overflow-y-auto">
          {notifications.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 px-6 gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                <Bell className="h-5 w-5 text-muted-foreground" strokeWidth={1.5} />
              </div>
              <div className="text-center">
                <p className="text-sm font-medium text-foreground">All caught up</p>
                <p className="text-[12px] text-muted-foreground mt-0.5">No notifications yet</p>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {notifications.map((n) => {
                const { Icon, iconBg, iconFg } = getEventMeta(n.eventName)
                return (
                  <button
                    key={n.id}
                    type="button"
                    onClick={() => handleNotificationClick(n)}
                    className={cn(
                      "w-full text-left flex items-start gap-3 px-4 py-3.5 transition-colors",
                      "hover:bg-muted/50",
                      !n.read && "bg-primary/[0.04]",
                      n.contractId ? "cursor-pointer" : "cursor-default",
                    )}
                  >
                    {/* Icon bubble */}
                    <div className={cn("mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full", iconBg)}>
                      <Icon className={cn("h-3.5 w-3.5", iconFg)} strokeWidth={2} />
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-start justify-between gap-2">
                        <p className={cn(
                          "text-[12.5px] leading-snug",
                          n.read ? "text-foreground/75 font-normal" : "text-foreground font-semibold",
                        )}>
                          {n.title}
                        </p>
                        <span className="shrink-0 text-[10.5px] text-muted-foreground/70 mt-px whitespace-nowrap">
                          {formatRelativeTime(n.createdAt)}
                        </span>
                      </div>
                      <p className="text-[11.5px] text-muted-foreground mt-0.5 leading-snug line-clamp-2">
                        {n.body}
                      </p>
                    </div>

                    {/* Unread dot */}
                    {!n.read && (
                      <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                    )}
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        {notifications.length > 0 && (
          <div className="border-t border-border bg-muted/20 px-4 py-2.5 flex items-center justify-center">
            <span className="text-[11px] text-muted-foreground">
              Showing last {notifications.length} notification{notifications.length !== 1 ? "s" : ""}
            </span>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
