"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import {
  LayoutDashboard, FileText, Settings, Plus, LogOut,
  Search
} from "lucide-react"
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command"
import { signOut } from "@/lib/auth/client"

export function CmdK() {
  const [open, setOpen] = useState(false)
  const router = useRouter()

  useEffect(() => {
    function down(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    document.addEventListener("keydown", down)
    return () => document.removeEventListener("keydown", down)
  }, [])

  function run(fn: () => void) {
    setOpen(false)
    fn()
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search commands..." />
      <CommandList>
        <CommandEmpty>No results found.</CommandEmpty>
        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => run(() => router.push("/dashboard"))}>
            <LayoutDashboard className="mr-2 h-4 w-4" />
            Go to Dashboard
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/contracts"))}>
            <FileText className="mr-2 h-4 w-4" />
            Go to Contracts
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/settings/org"))}>
            <Settings className="mr-2 h-4 w-4" />
            Go to Settings
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(() => router.push("/contracts/new"))}>
            <Plus className="mr-2 h-4 w-4" />
            New Contract
          </CommandItem>
          <CommandItem onSelect={() => run(() => router.push("/contracts"))}>
            <Search className="mr-2 h-4 w-4" />
            Search Contracts
          </CommandItem>
        </CommandGroup>
        <CommandSeparator />
        <CommandGroup heading="Account">
          <CommandItem
            onSelect={() => run(() => signOut({ fetchOptions: { onSuccess: () => router.push("/login") } }))}
          >
            <LogOut className="mr-2 h-4 w-4" />
            Sign out
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  )
}
