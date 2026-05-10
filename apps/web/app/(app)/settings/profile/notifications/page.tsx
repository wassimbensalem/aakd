"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import { Skeleton } from "@/components/ui/skeleton"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import {
  EVENT_LABELS,
  NOTIFICATION_EVENTS,
  isNotificationEventName,
  type NotificationEventName,
} from "@/lib/notifications/events"

interface Preference {
  eventName: NotificationEventName
  emailEnabled: boolean
}

export default function ProfileNotificationsPage() {
  const params = useSearchParams()
  const unsubscribed = params.get("unsubscribed")
  const eventParam = params.get("event")
  const toastShown = useRef(false)

  const [prefs, setPrefs] = useState<Preference[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  async function load() {
    try {
      const res = await fetch("/api/user/notification-preferences")
      if (!res.ok) throw new Error()
      const d = await res.json()
      const incoming: Preference[] = (d.preferences ?? []).filter(
        (p: { eventName: string }) => isNotificationEventName(p.eventName),
      )
      const byEvent = new Map(incoming.map((p) => [p.eventName, p]))
      setPrefs(
        NOTIFICATION_EVENTS.map(
          (e): Preference => byEvent.get(e) ?? { eventName: e, emailEnabled: false },
        ),
      )
    } catch {
      toast.error("Failed to load preferences")
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    if (toastShown.current) return
    if (unsubscribed === "1") {
      const label =
        eventParam && isNotificationEventName(eventParam)
          ? EVENT_LABELS[eventParam]
          : "these"
      toast.success(`You've been unsubscribed from ${label} emails.`)
      toastShown.current = true
    }
  }, [unsubscribed, eventParam])

  function toggle(eventName: NotificationEventName, value: boolean) {
    setPrefs((prev) =>
      prev.map((p) =>
        p.eventName === eventName ? { ...p, emailEnabled: value } : p,
      ),
    )
  }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch("/api/user/notification-preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: prefs }),
      })
      if (!res.ok) throw new Error()
      toast.success("Preferences saved.")
    } catch {
      toast.error("Failed to save preferences")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground">
          My email notifications
        </h1>
        <p className="text-sm text-muted-foreground">
          Choose which contract events trigger an email to you in this organization
        </p>
      </div>

      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Event</TableHead>
              <TableHead className="w-32 text-right pr-6">Email</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <TableRow key={i}>
                  <TableCell>
                    <Skeleton className="h-4 w-3/4" />
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <Skeleton className="h-4 w-4 ml-auto" />
                  </TableCell>
                </TableRow>
              ))
            ) : (
              prefs.map((p) => (
                <TableRow key={p.eventName}>
                  <TableCell>
                    <div className="font-medium text-foreground">
                      {EVENT_LABELS[p.eventName]}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {p.eventName}
                    </div>
                  </TableCell>
                  <TableCell className="text-right pr-6">
                    <Checkbox
                      checked={p.emailEnabled}
                      onCheckedChange={(v) => toggle(p.eventName, v === true)}
                    />
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <div>
        <Button onClick={save} disabled={loading || saving}>
          {saving ? "Saving..." : "Save preferences"}
        </Button>
      </div>
    </div>
  )
}
