"use client"

import { useState, useEffect, useCallback } from "react"
import { toast } from "sonner"
import { format } from "date-fns"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Skeleton } from "@/components/ui/skeleton"
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
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

  async function removeMember(memberId: string) {
    if (!confirm("Remove this member?")) return
    try {
      const res = await fetch(`/api/org/members/${memberId}`, { method: "DELETE" })
      if (!res.ok) throw new Error()
      toast.success("Member removed")
      fetchMembers()
    } catch {
      toast.error("Failed to remove member")
    }
  }

  return (
    <div className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-xl font-semibold text-foreground">Members</h1>
        <p className="text-sm text-muted-foreground">Manage who has access to your organization</p>
      </div>

      {/* Invite form — admins only */}
      {canManageMembers && (
        <div className="rounded-[var(--radius)] border border-border bg-card p-6 space-y-4">
          <h2 className="text-sm font-semibold text-foreground">Invite Member</h2>
          <form onSubmit={invite} className="flex gap-2">
            <Input
              type="email"
              placeholder="colleague@example.com"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              className="flex-1"
            />
            <Select value={inviteRole} onValueChange={(v) => v != null && setInviteRole(v)}>
              <SelectTrigger className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
              </SelectContent>
            </Select>
            <Button type="submit" size="sm" disabled={inviting}>
              {inviting ? "Sending..." : "Invite"}
            </Button>
          </form>
        </div>
      )}

      {/* Members table */}
      <div className="overflow-hidden rounded-[var(--radius)] border border-border bg-card">
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead>Member</TableHead>
              <TableHead>Role</TableHead>
              <TableHead>Joined</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              Array.from({ length: 3 }).map((_, i) => (
                <TableRow key={i}>
                  {Array.from({ length: 4 }).map((_, j) => (
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
                      <AvatarFallback>{getInitials(m.user.name)}</AvatarFallback>
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
                        {ROLES.map((r) => <SelectItem key={r} value={r}>{r}</SelectItem>)}
                      </SelectContent>
                    </Select>
                  ) : (
                    <span className="text-xs text-foreground">{m.role}</span>
                  )}
                </TableCell>
                <TableCell className="text-muted-foreground">
                  {format(new Date(m.createdAt), "MMM d, yyyy")}
                </TableCell>
                <TableCell>
                  {canManageMembers && m.userId !== session?.user?.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive"
                      onClick={() => removeMember(m.id)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
