"use client"

import { useEffect, useRef, useState } from "react"
import {
  Bold, Italic, Underline, Link as LinkIcon,
  MessageSquare,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import type { Editor } from "@tiptap/react"

// ─── Color constants (shared with main toolbar) ────────────────────────────────

const COLOR_NONE = "__none__"

const TEXT_COLORS = [
  { label: "Default", value: COLOR_NONE },
  { label: "Red",    value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Amber",  value: "#f59e0b" },
  { label: "Green",  value: "#22c55e" },
  { label: "Blue",   value: "#3b82f6" },
  { label: "Indigo", value: "#6366f1" },
  { label: "Purple", value: "#a855f7" },
  { label: "Gray",   value: "#6b7280" },
] as const

const HIGHLIGHT_COLORS = [
  { label: "None",   value: COLOR_NONE },
  { label: "Yellow", value: "#fef08a" },
  { label: "Green",  value: "#bbf7d0" },
  { label: "Blue",   value: "#bfdbfe" },
  { label: "Pink",   value: "#fbcfe8" },
  { label: "Orange", value: "#fed7aa" },
] as const

// ─── Inline link popover inside floating bar ───────────────────────────────────

function FloatingLinkButton({ editor }: { editor: Editor }) {
  const [open, setOpen] = useState(false)
  const [url, setUrl]   = useState("")
  const isActive = editor.isActive("link")

  const apply = () => {
    if (url) {
      editor.chain().focus().setLink({ href: url }).run()
    } else {
      editor.chain().focus().unsetLink().run()
    }
    setOpen(false)
    setUrl("")
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        title="Insert / edit link"
        onMouseDown={(e) => {
          e.preventDefault()
          if (isActive) {
            setUrl(editor.getAttributes("link").href ?? "")
          } else {
            setUrl("")
          }
          setOpen(true)
        }}
        className={cn(
          "h-7 w-7 inline-flex items-center justify-center rounded text-zinc-700 hover:bg-zinc-100",
          isActive && "bg-zinc-100 text-indigo-600",
        )}
      >
        <LinkIcon className="size-3.5" />
      </PopoverTrigger>
      <PopoverContent className="w-64 p-3" align="start" side="bottom">
        <p className="text-xs font-medium text-zinc-700 mb-2">Insert link</p>
        <div className="flex gap-2">
          <Input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://..."
            className="h-7 text-xs flex-1"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") { e.preventDefault(); apply() }
              if (e.key === "Escape") { setOpen(false); setUrl("") }
            }}
          />
          <Button
            size="sm"
            className="h-7 px-2 text-xs"
            onMouseDown={(e) => { e.preventDefault(); apply() }}
          >
            {isActive ? "Update" : "Set"}
          </Button>
        </div>
        {isActive && (
          <button
            type="button"
            className="mt-2 text-xs text-red-500 hover:text-red-700"
            onMouseDown={(e) => {
              e.preventDefault()
              editor.chain().focus().unsetLink().run()
              setOpen(false)
            }}
          >
            Remove link
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ─── Inline color-swatch picker ────────────────────────────────────────────────

function FloatingColorPicker({
  colors,
  currentValue,
  title,
  onSelect,
  trigger,
}: {
  colors: ReadonlyArray<{ label: string; value: string }>
  currentValue: string
  title: string
  onSelect: (value: string) => void
  trigger: React.ReactNode
}) {
  const [open, setOpen] = useState(false)

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger
        title={title}
        onMouseDown={(e) => { e.preventDefault(); setOpen(true) }}
        className="h-7 w-7 inline-flex items-center justify-center rounded text-zinc-700 hover:bg-zinc-100"
      >
        {trigger}
      </PopoverTrigger>
      <PopoverContent className="p-2 w-auto" align="start" side="bottom">
        <div className="flex flex-col gap-1">
          {colors.map((c) => (
            <button
              key={c.value}
              type="button"
              className={cn(
                "flex items-center gap-2 px-2 py-1 rounded text-xs hover:bg-zinc-100 w-full text-left",
                currentValue === c.value && "bg-zinc-100 font-medium",
              )}
              onMouseDown={(e) => {
                e.preventDefault()
                onSelect(c.value)
                setOpen(false)
              }}
            >
              <span
                className="size-3.5 rounded-sm border border-zinc-300 inline-block shrink-0"
                style={{
                  backgroundColor:
                    c.value === COLOR_NONE ? "transparent" : c.value,
                }}
              />
              {c.label}
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  )
}

// ─── Main export ───────────────────────────────────────────────────────────────

export interface FloatingSelectionToolbarProps {
  editor: Editor
  onAddComment?: () => void
}

export function FloatingSelectionToolbar({
  editor,
  onAddComment,
}: FloatingSelectionToolbarProps) {
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)

  // Current color states — derived from editor on each render
  const currentColor = (editor.getAttributes("textStyle").color as string | undefined) || COLOR_NONE
  const currentHighlight =
    (editor.getAttributes("highlight").color as string | undefined) || COLOR_NONE

  useEffect(() => {
    const updatePos = () => {
      const { from, to } = editor.state.selection
      if (from === to) { setPos(null); return }

      const domSel = window.getSelection()
      if (!domSel || domSel.rangeCount === 0) { setPos(null); return }

      const range = domSel.getRangeAt(0)
      const rect  = range.getBoundingClientRect()
      if (rect.width === 0 && rect.height === 0) { setPos(null); return }

      const toolbarW  = toolbarRef.current?.offsetWidth ?? 280
      const rawLeft   = rect.left + rect.width / 2 - toolbarW / 2
      const clampLeft = Math.max(8, Math.min(rawLeft, window.innerWidth - toolbarW - 8))

      setPos({
        top:  rect.top + window.scrollY - 48,
        left: clampLeft,
      })
    }

    const clearPos = () => setPos(null)

    editor.on("selectionUpdate", updatePos)
    editor.on("blur", clearPos)
    return () => {
      editor.off("selectionUpdate", updatePos)
      editor.off("blur", clearPos)
    }
  }, [editor])

  if (!pos) return null

  return (
    <div
      ref={toolbarRef}
      // fixed so it follows the browser viewport, not a scrollable container
      className="fixed z-50 flex items-center gap-0.5 rounded-lg border border-border bg-popover shadow-lg p-1"
      style={{ top: pos.top, left: pos.left }}
      // Prevent blur from clearing the selection
      onMouseDown={(e) => e.preventDefault()}
    >
      {/* Bold */}
      <button
        type="button"
        title="Bold (Cmd+B)"
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run() }}
        className={cn(
          "h-7 w-7 inline-flex items-center justify-center rounded text-zinc-700 hover:bg-zinc-100",
          editor.isActive("bold") && "bg-zinc-100 text-indigo-600",
        )}
      >
        <Bold className="size-3.5" />
      </button>

      {/* Italic */}
      <button
        type="button"
        title="Italic (Cmd+I)"
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run() }}
        className={cn(
          "h-7 w-7 inline-flex items-center justify-center rounded text-zinc-700 hover:bg-zinc-100",
          editor.isActive("italic") && "bg-zinc-100 text-indigo-600",
        )}
      >
        <Italic className="size-3.5" />
      </button>

      {/* Underline */}
      <button
        type="button"
        title="Underline (Cmd+U)"
        onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleUnderline().run() }}
        className={cn(
          "h-7 w-7 inline-flex items-center justify-center rounded text-zinc-700 hover:bg-zinc-100",
          editor.isActive("underline") && "bg-zinc-100 text-indigo-600",
        )}
      >
        <Underline className="size-3.5" />
      </button>

      <span className="w-px h-4 bg-zinc-200 mx-0.5" />

      {/* Link popover */}
      <FloatingLinkButton editor={editor} />

      <span className="w-px h-4 bg-zinc-200 mx-0.5" />

      {/* Text color picker */}
      <FloatingColorPicker
        colors={TEXT_COLORS}
        currentValue={currentColor}
        title="Text color"
        onSelect={(v) => {
          if (!v || v === COLOR_NONE) {
            editor.chain().focus().unsetColor().run()
          } else {
            editor.chain().focus().setColor(v).run()
          }
        }}
        trigger={
          <span className="relative inline-flex items-center justify-center">
            <span className="text-xs font-bold text-zinc-700">A</span>
            <span
              className="absolute bottom-0 left-0.5 right-0.5 h-0.5 rounded-full"
              style={{
                backgroundColor:
                  currentColor === COLOR_NONE ? "#000" : currentColor,
              }}
            />
          </span>
        }
      />

      {/* Highlight color picker */}
      <FloatingColorPicker
        colors={HIGHLIGHT_COLORS}
        currentValue={currentHighlight}
        title="Highlight color"
        onSelect={(v) => {
          if (!v || v === COLOR_NONE) {
            editor.chain().focus().unsetHighlight().run()
          } else {
            editor.chain().focus().setHighlight({ color: v }).run()
          }
        }}
        trigger={
          <span
            className="size-3.5 rounded-sm border border-zinc-400 inline-block"
            style={{
              backgroundColor:
                currentHighlight === COLOR_NONE ? "transparent" : currentHighlight,
              backgroundImage:
                currentHighlight === COLOR_NONE
                  ? "repeating-linear-gradient(45deg, #d4d4d8 0, #d4d4d8 1px, transparent 0, transparent 50%)"
                  : undefined,
              backgroundSize: "4px 4px",
            }}
          />
        }
      />

      {/* Comment — only if callback is wired */}
      {onAddComment && (
        <>
          <span className="w-px h-4 bg-zinc-200 mx-0.5" />
          <button
            type="button"
            title="Add comment"
            onMouseDown={(e) => { e.preventDefault(); onAddComment() }}
            className="h-7 w-7 inline-flex items-center justify-center rounded text-zinc-700 hover:bg-zinc-100"
          >
            <MessageSquare className="size-3.5" />
          </button>
        </>
      )}
    </div>
  )
}
