"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { UserPlus, UserMinus, RefreshCw, X } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
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

const ROLES = ["admin", "legal", "member", "viewer"] as const

const ROLE_INFO: Record<string, { label: string; description: string; permissions: string[] }> = {
  admin: {
    label: "Admin",
    description: "Full access except ownership transfer.",
    permissions: ["Invite & remove members", "Change roles", "Create & edit contracts", "Request & decide approvals", "Manage org settings"],
  },
  legal: {
    label: "Legal",
    description: "Handles contract workflows end-to-end.",
    permissions: ["Create & edit contracts", "Request & decide approvals", "Send for signing", "View all contracts"],
  },
  member: {
    label: "Member",
    description: "Day-to-day contributor with limited write access.",
    permissions: ["Create contracts", "Upload files", "View all contracts", "Cannot approve or manage members"],
  },
  viewer: {
    label: "Viewer",
    description: "Read-only access — cannot make any changes.",
    permissions: ["View all contracts", "View approvals & obligations", "No create, edit, or approve actions"],
  },
}

const ROLE_RANK: Record<string, number> = {
  owner: 5, admin: 4, legal: 3, member: 2, viewer: 1,
}

interface PendingInvitation {
  id: string
  email: string
  role: string | null
  expiresAt: string
}

function getInitials(name: string) {
  return name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
}

function RoleBadge({ role }: { role: string }) {
  const colors: Record<string, string> = {
    owner:  "bg-purple-100 text-purple-700",
    admin:  "bg-blue-100 text-blue-700",
    legal:  "bg-amber-100 text-amber-700",
    member: "bg-green-100 text-green-700",
    viewer: "bg-gray-100 text-gray-600",
  }
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium capitalize ${colors[role] ?? colors.viewer}`}>
      {role}
    </span>
  )
}

export default function MembersPage() {
  const { data: session } = useSession()
  const [members, setMembers] = useState<OrgMember[]>([])
  const [invitations, setInvitations] = useState<PendingInvitation[]>([])
  const [loading, setLoading] = useState(true)
  const [showInviteModal, setShowInviteModal] = useState(false)
  const [inviteEmail, setInviteEmail] = useState("")
  const [inviteRole, setInviteRole] = useState("member")
  const [inviting, setInviting] = useState(false)
  const [resendingId, setResendingId] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<{ id: string; name: string } | null>(null)
  const [confirmCancelInvite, setConfirmCancelInvite] = useState<{ id: string; email: string } | null>(null)

  const fetchMembers = useCallback(async (signal?: AbortSignal) => {
    try {
      const [membersRes, invitesRes] = await Promise.all([
        fetch("/api/org/members", { signal }),
        fetch("/api/org/members/invite", { signal }),
      ])
      if (membersRes.ok) {
        const data = await membersRes.json()
        setMembers(data.members ?? data ?? [])
      }
      if (invitesRes.ok) {
        setInvitations(await invitesRes.json())
      }
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
  const currentUserRole = currentMember?.role ?? "viewer"
  const myRank = ROLE_RANK[currentUserRole] ?? 0
  const canManageMembers = myRank >= ROLE_RANK.admin

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setInviting(true)
    try {
      const res = await fetch("/api/org/members/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: inviteEmail, role: inviteRole }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        const msg: Record<string, string> = {
          already_member: "This person is already a member.",
          already_invited: "An active invitation already exists for this email.",
          cannot_invite_higher_role: "You can't invite someone to a higher role than your own.",
        }
        toast.error(msg[body?.error] ?? body?.error ?? "Failed to send invitation")
        return
      }
      toast.success(`Invitation sent to ${inviteEmail}`)
      setInviteEmail("")
      setShowInviteModal(false)
      fetchMembers()
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
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error === "cannot_demote_last_admin"
          ? "Can't change — this is the last admin"
          : body?.error ?? "Failed to update role")
        return
      }
      toast.success("Role updated")
      fetchMembers()
    } catch {
      toast.error("Failed to update role")
    }
  }

  async function removeMember(memberId: string, memberName: string) {
    setConfirmRemove({ id: memberId, name: memberName })
  }

  async function doRemoveMember(memberId: string, memberName: string) {
    setConfirmRemove(null)
    try {
      const res = await fetch(`/api/org/members/${memberId}`, { method: "DELETE" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? "Failed to remove member")
        return
      }
      toast.success(`${memberName} removed`)
      fetchMembers()
    } catch {
      toast.error("Failed to remove member")
    }
  }

  async function resendInvitation(invitationId: string, email: string) {
    setResendingId(invitationId)
    try {
      const res = await fetch(`/api/org/invitations/${invitationId}`, { method: "POST" })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        toast.error(body?.error ?? "Failed to resend")
        return
      }
      toast.success(`Invitation resent to ${email}`)
      fetchMembers()
    } catch {
      toast.error("Failed to resend invitation")
    } finally {
      setResendingId(null)
    }
  }

  async function cancelInvitation(invitationId: string, email: string) {
    setConfirmCancelInvite({ id: invitationId, email })
  }

  async function doCancelInvitation(invitationId: string) {
    setConfirmCancelInvite(null)
    try {
      const res = await fetch(`/api/org/invitations/${invitationId}`, { method: "DELETE" })
      if (!res.ok) return
      toast.success("Invitation cancelled")
      fetchMembers()
    } catch {
      toast.error("Failed to cancel invitation")
    }
  }

  // Can I act on this member? Rank must strictly exceed theirs.
  function canActOn(target: OrgMember): boolean {
    if (target.userId === session?.user?.id) return false
    return myRank > (ROLE_RANK[target.role] ?? 0)
  }

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Header */}
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

      {/* Active members */}
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
            ) : members.map((m) => {
              const actable = canActOn(m)
              return (
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
                    {canManageMembers && actable ? (
                      <Select
                        value={m.role}
                        onValueChange={(v) => v != null && changeRole(m.id, v)}
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
                      <RoleBadge role={m.role} />
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
                    {canManageMembers && actable ? (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                        title="Remove member"
                        onClick={() => removeMember(m.id, m.user.name)}
                      >
                        <UserMinus className="h-4 w-4" />
                      </Button>
                    ) : (
                      <div className="h-7 w-7" />
                    )}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </div>

      {/* Pending invitations */}
      {canManageMembers && invitations.length > 0 && (
        <div>
          <h2 className="text-sm font-semibold text-foreground mb-2">
            Pending Invitations
            <span className="ml-2 text-xs font-normal text-muted-foreground">
              ({invitations.length})
            </span>
          </h2>
          <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
            <Table>
              <TableHeader>
                <TableRow className="hover:bg-transparent">
                  <TableHead>Email</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Expires</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invitations.map((inv) => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <div className="flex items-center gap-2.5">
                        <div className="h-7 w-7 rounded-full bg-muted flex items-center justify-center shrink-0">
                          <span className="text-[10px] font-semibold text-muted-foreground">
                            {inv.email[0].toUpperCase()}
                          </span>
                        </div>
                        <p className="text-sm text-foreground">{inv.email}</p>
                      </div>
                    </TableCell>
                    <TableCell>
                      <RoleBadge role={inv.role ?? "member"} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {format(new Date(inv.expiresAt), "MMM d, yyyy")}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-primary"
                          title="Resend invitation"
                          disabled={resendingId === inv.id}
                          onClick={() => resendInvitation(inv.id, inv.email)}
                        >
                          <RefreshCw className={`h-3.5 w-3.5 ${resendingId === inv.id ? "animate-spin" : ""}`} />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-red-600 hover:bg-red-50"
                          title="Cancel invitation"
                          onClick={() => cancelInvitation(inv.id, inv.email)}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>
      )}

      {/* Remove member confirmation */}
      <Dialog open={!!confirmRemove} onOpenChange={(open) => { if (!open) setConfirmRemove(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Remove member</DialogTitle>
            <DialogDescription>
              Remove <span className="font-medium text-foreground">{confirmRemove?.name}</span> from the organization? They will lose all access immediately.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmRemove(null)}>Cancel</Button>
            <Button
              variant="destructive"
              onClick={() => confirmRemove && doRemoveMember(confirmRemove.id, confirmRemove.name)}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Cancel invitation confirmation */}
      <Dialog open={!!confirmCancelInvite} onOpenChange={(open) => { if (!open) setConfirmCancelInvite(null) }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Cancel invitation</DialogTitle>
            <DialogDescription>
              Cancel the invitation for <span className="font-medium text-foreground">{confirmCancelInvite?.email}</span>? The invite link will stop working.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmCancelInvite(null)}>Keep</Button>
            <Button
              variant="destructive"
              onClick={() => confirmCancelInvite && doCancelInvitation(confirmCancelInvite.id)}
            >
              Cancel invitation
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Invite modal */}
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
                    <SelectItem key={r} value={r}>
                      <div className="flex flex-col py-0.5">
                        <span className="font-medium capitalize">{r}</span>
                        <span className="text-xs text-muted-foreground">{ROLE_INFO[r]?.description}</span>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>

              {/* Dynamic role description card */}
              {ROLE_INFO[inviteRole] && (
                <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 space-y-1.5">
                  <p className="text-xs font-semibold text-foreground">{ROLE_INFO[inviteRole].label} — what they can do</p>
                  <ul className="space-y-0.5">
                    {ROLE_INFO[inviteRole].permissions.map((p) => (
                      <li key={p} className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <span className="mt-0.5 text-[10px]">•</span>
                        {p}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <p className="text-xs text-muted-foreground">
                The invitation link will be valid for 30 days.
              </p>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button type="button" variant="outline" onClick={() => setShowInviteModal(false)}>
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
