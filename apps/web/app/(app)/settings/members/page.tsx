"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { UserPlus, MoreHorizontal } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { OrgMember } from "@/lib/types"
import { useSession } from "@/lib/auth/client"

const ROLES = ["admin", "legal", "member", "viewer"]

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
}

export default function MembersPage() {
  const { data: session } = useSession()
  const [members, setMembers] = useState<OrgMember[]>([])
  const [loading, setLoading] = useState(true)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState("member")
  const [inviting, setInviting] = useState(false)

  const fetchMembers = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch("/api/org/members", { signal })
      if (!res.ok) throw new Error()
      const data = await res.json()
      setMembers(data.members ?? data ?? [])
    } catch (e) {
      if ((e as Error).name === "AbortError") return
      toast.error("Failed to load members")
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    fetchMembers(controller.signal)
    return () => controller.abort()
  }, [fetchMembers])

  const currentMember = members.find((m) => m.userId === session?.user?.id)
  const currentUserRole = currentMember?.role
  const canManageMembers = currentUserRole === "admin"

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    try {
      const res = await fetch("/api/org/members/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })
      if (!res.ok) throw new Error("Failed to invite")
      toast.success(`Invitation sent to ${inviteEmail}`)
      setInviteEmail("")
      setShowInviteModal(false)
    } catch {
      toast.error("Failed to send invitation")
    } finally {
      setInviting(false)
    }
  }

  async function changeRole(memberId: string, role: string) {
    try {
      const res = await fetch(`/api/org/members/${memberId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      })
      if (!res.ok) throw new Error()
      toast.success("Role updated")
      fetchMembers()
    } catch {
      toast.error("Failed to update role")
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-foreground">Team Members</h1>
          <p className="text-sm text-muted-foreground">Manage who has access to your organization</p>
        </div>
        {canManageMembers && (
          <Button onClick={() => setShowInviteModal(true)}>
            <UserPlus className="h-4 w-4 mr-2" />
            Invite Member
          </Button>
        )}
      </div>

      {/* Members table */}
      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 5 }).map((_, j) => (
                    <TableCell key={j}><Skeleton className="h-4 w-full" /></TableCell>
                  ))}
                </TableRow>
              ))
            ) : members.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <Avatar size="sm">
                      {m.user.image && <AvatarImage src={m.user.image} />}
                      <AvatarFallback className="bg-primary/10 text-primary text-xs">
                        {getInitials(m.user.name)}
                      </AvatarFallback>
                    </Avatar>
                    <div>
                      <p className="font-medium text-foreground">{m.user.name}</p>
                      <p className="text-xs text-muted-foreground">{m.user.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  {canManageMembers ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) => v != null && changeRole(m.id, v)}
                      disabled={m.userId === session?.user?.id}
                    >
                      <SelectTrigger className="h-7 w-28 text-xs">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {ROLES.map((r) => (
                          <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-xs text-foreground capitalize">{m.role}</span>
                  )}
                </TableCell>
                <TableCell>
                  <span className="inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium bg-green-100 text-green-700">
                    Active
                  </span>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {format(new Date(m.createdAt), "MMM d, yyyy")}
                </TableCell>
                <TableCell>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7 text-muted-foreground"
                  >
                    <MoreHorizontal className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Invite Member modal */}
      <Dialog open={showInviteModal} onOpenChange={setShowInviteModal}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite Member</DialogTitle>
          </DialogHeader>
          <form onSubmit={invite} className="space-y-4 mt-2">
            <div className="space-y-1.5">
              <Label htmlFor="inviteEmail" className="text-sm font-medium text-foreground">
                Email Address
              </Label>
              <Input
                id="inviteEmail"
                type="email"
                placeholder="colleague@example.com"
                value={inviteEmail}
                onChange={(e) => setInviteEmail(e.target.value)}
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inviteRole" className="text-sm font-medium text-foreground">
                Role
              </Label>
              <Select value={inviteRole} onValueChange={(v) => v != null && setInviteRole(v)}>
                <SelectTrigger id="inviteRole">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map((r) => (
                    <SelectItem key={r} value={r} className="capitalize">{r}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button
                type="button"
                variant="outline"
                onClick={() => setShowInviteModal(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={inviting}>
                {inviting ? "Sending..." : "Send Invite"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
