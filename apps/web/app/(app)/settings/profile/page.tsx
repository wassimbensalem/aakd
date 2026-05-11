"use client"

import { useState, useEffect, useRef } from "react"
import { toast } from "sonner"
import { Lock, Monitor, Upload } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { authClient, useSession } from "@/lib/auth/client"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog"

// ─── Constants ────────────────────────────────────────────────────────────────

const DICEBEAR_SEEDS = [
  "Biscuit", "Noodle", "Mochi", "Boba",
  "Waffles", "Dumpling", "Cookie", "Pretzel",
  "Nacho", "Croissant", "Tapioca", "Pancake",
]

function dicebearUrl(seed: string): string {
  return `https://api.dicebear.com/9.x/adventurer-neutral/svg?seed=${encodeURIComponent(seed)}&backgroundColor=b6e3f4,c0aede,d1d4f9,ffdfbf`
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name
    .split(" ")
    .map((n) => n[0])
    .join("")
    .toUpperCase()
    .slice(0, 2)
}

function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/)
  const first = parts[0] ?? ""
  const last = parts.slice(1).join(" ")
  return { first, last }
}

// ─── Section card ─────────────────────────────────────────────────────────────

function SectionCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-[var(--radius)] border border-border bg-card overflow-hidden">
      <div className="px-5 py-3.5 border-b border-border bg-muted/40">
        <h2 className="text-sm font-semibold text-foreground">{title}</h2>
      </div>
      <div className="p-5">{children}</div>
    </div>
  )
}

// ─── Avatar display ───────────────────────────────────────────────────────────

function AvatarDisplay({
  imageUrl,
  initials,
  isPending,
}: {
  imageUrl: string | null | undefined
  initials: string
  isPending: boolean
}) {
  if (!isPending && imageUrl) {
    return (
      <img
        src={imageUrl}
        alt="Avatar"
        className="w-20 h-20 rounded-full object-cover"
      />
    )
  }
  return (
    <div className="w-20 h-20 rounded-full bg-primary/10 text-primary flex items-center justify-center text-2xl font-bold select-none">
      {isPending ? "?" : initials}
    </div>
  )
}

// ─── Avatar picker modal ──────────────────────────────────────────────────────

function AvatarPickerDialog({
  open,
  onOpenChange,
  currentImage,
  onApply,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  currentImage: string | null | undefined
  onApply: (url: string) => Promise<void>
}) {
  const [pendingImage, setPendingImage] = useState<string | null>(currentImage ?? null)
  const [uploading, setUploading] = useState(false)
  const [applying, setApplying] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  // Sync when dialog opens
  useEffect(() => {
    if (open) setPendingImage(currentImage ?? null)
  }, [open, currentImage])

  async function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    setUploading(true)
    try {
      const form = new FormData()
      form.append("file", file)
      const res = await fetch("/api/user/avatar", { method: "POST", body: form })
      if (!res.ok) {
        const data = (await res.json()) as { error?: string }
        toast.error(data.error ?? "Upload failed")
        return
      }
      const data = (await res.json()) as { url: string }
      setPendingImage(data.url)
    } catch {
      toast.error("Upload failed")
    } finally {
      setUploading(false)
      // Reset so the same file can be re-selected if needed
      if (fileInputRef.current) fileInputRef.current.value = ""
    }
  }

  async function handleApply() {
    if (!pendingImage) return
    setApplying(true)
    try {
      await onApply(pendingImage)
      onOpenChange(false)
    } finally {
      setApplying(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Choose Avatar</DialogTitle>
        </DialogHeader>

        {/* Section A: Presets */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Presets</p>
          <div className="grid grid-cols-6 gap-2">
            {DICEBEAR_SEEDS.map((seed) => {
              const url = dicebearUrl(seed)
              const isSelected = pendingImage === url
              return (
                <button
                  key={seed}
                  type="button"
                  onClick={() => setPendingImage(url)}
                  className={`w-10 h-10 rounded-full overflow-hidden border-2 transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                    isSelected
                      ? "ring-2 ring-primary border-primary"
                      : "border-transparent hover:border-muted-foreground/30"
                  }`}
                  title={seed}
                >
                  <img src={url} alt={seed} className="w-full h-full" />
                </button>
              )
            })}
          </div>
        </div>

        {/* Section B: Upload */}
        <div className="space-y-2">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Upload your own</p>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={handleFileChange}
          />
          <Button
            variant="outline"
            size="sm"
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            className="gap-2"
          >
            <Upload className="h-3.5 w-3.5" />
            {uploading ? "Uploading…" : "Choose file"}
          </Button>
          <p className="text-[11px] text-muted-foreground">JPEG, PNG, WebP, GIF — max 5 MB</p>
          {pendingImage && !DICEBEAR_SEEDS.map(dicebearUrl).includes(pendingImage) && (
            <div className="flex items-center gap-2 mt-1">
              <img
                src={pendingImage}
                alt="Preview"
                className="w-10 h-10 rounded-full object-cover ring-2 ring-primary"
              />
              <span className="text-xs text-muted-foreground">Custom upload</span>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button
            size="sm"
            disabled={!pendingImage || applying}
            onClick={handleApply}
          >
            {applying ? "Applying…" : "Apply"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ProfilePage() {
  const { data: session, isPending } = useSession()

  const [firstName, setFirstName] = useState("")
  const [lastName, setLastName] = useState("")
  const [email, setEmail] = useState("")
  const [phone, setPhone] = useState("")
  const [jobTitle, setJobTitle] = useState("")
  const [department, setDepartment] = useState("")
  const [saving, setSaving] = useState(false)

  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false)

  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")

  useEffect(() => {
    if (!session?.user) return
    const { first, last } = splitName(session.user.name ?? "")
    setFirstName(first)
    setLastName(last)
    setEmail(session.user.email ?? "")
  }, [session])

  async function handleSave() {
    setSaving(true)
    try {
      const name = `${firstName} ${lastName}`.trim()
      const result = await authClient.updateUser({ name })
      if (result.error) {
        toast.error(result.error.message ?? "Failed to save changes")
      } else {
        toast.success("Profile saved")
      }
    } catch {
      toast.error("Failed to save changes")
    } finally {
      setSaving(false)
    }
  }

  async function handleApplyAvatar(imageUrl: string) {
    const result = await authClient.updateUser({ image: imageUrl })
    if (result.error) {
      toast.error(result.error.message ?? "Failed to update avatar")
    } else {
      toast.success("Avatar updated")
    }
  }

  function handleUpdatePassword(e: React.FormEvent) {
    e.preventDefault()
    toast.info("Coming soon")
    setCurrentPassword("")
    setNewPassword("")
    setConfirmPassword("")
    setShowPasswordForm(false)
  }

  const initials = session?.user?.name ? getInitials(session.user.name) : "?"
  const displayName = session?.user?.name ?? "—"
  const displayEmail = session?.user?.email ?? "—"
  const currentImage = session?.user?.image

  return (
    <div className="flex flex-col h-full">
      {/* Page header */}
      <div className="flex items-center justify-between px-7 py-4 border-b border-border shrink-0">
        <div>
          <h1 className="text-xl font-semibold text-foreground">My Profile</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage your personal account settings
          </p>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-7 py-5 space-y-5 max-w-2xl">
        {/* Profile header */}
        <div className="flex items-center gap-5">
          <div className="relative">
            <AvatarDisplay
              imageUrl={currentImage}
              initials={isPending ? "?" : initials}
              isPending={isPending}
            />
            <div className="mt-2">
              <Button
                variant="outline"
                size="sm"
                className="text-xs"
                onClick={() => setAvatarPickerOpen(true)}
              >
                Change Avatar
              </Button>
            </div>
          </div>
          <div>
            <h2 className="text-xl font-semibold text-foreground">{displayName}</h2>
            <p className="text-sm text-muted-foreground">{displayEmail}</p>
            <p className="text-sm text-muted-foreground">Member</p>
          </div>
        </div>

        {/* Personal information */}
        <SectionCard title="Personal Information">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">First Name</label>
              <Input
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="First name"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Last Name</label>
              <Input
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Last name"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Email</label>
              <div className="relative">
                <Input
                  type="email"
                  value={email}
                  disabled
                  readOnly
                  className="pr-9 opacity-70"
                />
                <Lock className="absolute right-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
              </div>
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Phone</label>
              <Input
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+1 (555) 000-0000"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Job Title</label>
              <Input
                value={jobTitle}
                onChange={(e) => setJobTitle(e.target.value)}
                placeholder="e.g. Legal Counsel"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground">Department</label>
              <Input
                value={department}
                onChange={(e) => setDepartment(e.target.value)}
                placeholder="e.g. Legal"
              />
            </div>
          </div>
          <div className="flex justify-end mt-5">
            <Button onClick={handleSave} size="sm" disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </div>
        </SectionCard>

        {/* Security */}
        <SectionCard title="Security">
          <div className="space-y-4">
            {/* Change password row */}
            <div className="flex items-center justify-between">
              <div>
                <p className="text-[13px] font-medium text-foreground">Change Password</p>
                <p className="text-xs text-muted-foreground mt-0.5">Update your account password</p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowPasswordForm((v) => !v)}
              >
                {showPasswordForm ? "Cancel" : "Change"}
              </Button>
            </div>

            {showPasswordForm && (
              <form onSubmit={handleUpdatePassword} className="space-y-3 pt-1">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Current Password</label>
                  <Input
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="current-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">New Password</label>
                  <Input
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs font-medium text-muted-foreground">Confirm Password</label>
                  <Input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    autoComplete="new-password"
                  />
                </div>
                <div className="flex justify-end">
                  <Button type="submit" size="sm">
                    Update Password
                  </Button>
                </div>
              </form>
            )}

            <div className="border-t border-border" />

            {/* 2FA row */}
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-[13px] font-medium text-foreground">Two-Factor Authentication</p>
                  <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground border border-border">
                    Soon
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">Add an extra layer of security</p>
              </div>
              <Switch disabled checked={false} />
            </div>
          </div>
        </SectionCard>

        {/* Active sessions */}
        <SectionCard title="Active Sessions">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-muted border border-border text-muted-foreground">
                <Monitor className="h-4 w-4" />
              </div>
              <div>
                <p className="text-[13px] font-medium text-foreground">
                  MacBook Pro · Chrome · San Francisco, CA
                </p>
                <span className="inline-flex items-center rounded-full bg-emerald-100 text-emerald-700 px-2 py-0.5 text-[10px] font-semibold mt-0.5">
                  Current session
                </span>
              </div>
            </div>
            <Button variant="outline" size="sm" disabled className="opacity-50">
              Revoke
            </Button>
          </div>
        </SectionCard>
      </div>

      {/* Avatar picker dialog */}
      <AvatarPickerDialog
        open={avatarPickerOpen}
        onOpenChange={setAvatarPickerOpen}
        currentImage={currentImage}
        onApply={handleApplyAvatar}
      />
    </div>
  )
}
