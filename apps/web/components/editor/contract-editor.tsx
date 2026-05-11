"use client"

import React, { useCallback, useEffect, useRef, useState } from "react"
import { useEditor, EditorContent, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Underline from "@tiptap/extension-underline"
import TextAlign from "@tiptap/extension-text-align"
import Link from "@tiptap/extension-link"
import Image from "@tiptap/extension-image"
import { Table } from "@tiptap/extension-table"
import { TableRow } from "@tiptap/extension-table-row"
import { TableCell } from "@tiptap/extension-table-cell"
import { TableHeader } from "@tiptap/extension-table-header"
import Color from "@tiptap/extension-color"
import TextStyle from "@tiptap/extension-text-style"
import Highlight from "@tiptap/extension-highlight"
import Placeholder from "@tiptap/extension-placeholder"
import CharacterCount from "@tiptap/extension-character-count"
import { Node } from "@tiptap/core"
import { toast } from "sonner"
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Minus, Table as TableIcon, FileText,
  Heading1, Heading2, Heading3,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Indent, Outdent, LayoutTemplate, Image as ImageIcon,
  Undo, Redo, Link as LinkIcon, Highlighter,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import { slateToTiptap } from "@/lib/editor/slate-to-tiptap"
import type { TipTapDoc } from "@/lib/editor/tiptap-types"

// ─── Custom TemplateVariable extension ───────────────────────────────────────

const TemplateVariableExtension = Node.create({
  name: "templateVariable",
  group: "inline",
  inline: true,
  atom: true,

  addAttributes() {
    return {
      variable: { default: null },
    }
  },

  parseHTML() {
    return [{ tag: "span[data-template-variable]" }]
  },

  renderHTML({ node }) {
    return [
      "span",
      {
        "data-template-variable": node.attrs.variable as string,
        "contenteditable": "false",
        "class": "bg-indigo-100 text-indigo-800 text-sm font-medium px-2 py-0.5 rounded inline-flex items-center select-none",
      },
      `{{${node.attrs.variable as string}}}`,
    ]
  },
})

// ─── Empty doc constant ────────────────────────────────────────────────────────

export const EMPTY_DOC: TipTapDoc = {
  type: "doc",
  content: [{ type: "paragraph" }],
}

// ─── Content normalizer ────────────────────────────────────────────────────────

function normalizeContent(raw: unknown): TipTapDoc {
  if (!raw) return EMPTY_DOC
  // Legacy Slate array → convert on the fly
  if (Array.isArray(raw)) {
    if (raw.length === 0) return EMPTY_DOC
    return slateToTiptap(raw)
  }
  // TipTap doc object
  if (typeof raw === "object" && (raw as { type?: string }).type === "doc") {
    return raw as TipTapDoc
  }
  return EMPTY_DOC
}

// ─── Font sizes ────────────────────────────────────────────────────────────────

const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "32px"] as const

// ─── Text colors ───────────────────────────────────────────────────────────────

const TEXT_COLORS = [
  { label: "Default", value: "" },
  { label: "Red", value: "#ef4444" },
  { label: "Orange", value: "#f97316" },
  { label: "Amber", value: "#f59e0b" },
  { label: "Green", value: "#22c55e" },
  { label: "Blue", value: "#3b82f6" },
  { label: "Indigo", value: "#6366f1" },
  { label: "Purple", value: "#a855f7" },
  { label: "Gray", value: "#6b7280" },
] as const

// ─── Highlight colors ──────────────────────────────────────────────────────────

const HIGHLIGHT_COLORS = [
  { label: "None", value: "" },
  { label: "Yellow", value: "#fef08a" },
  { label: "Green", value: "#bbf7d0" },
  { label: "Blue", value: "#bfdbfe" },
  { label: "Pink", value: "#fbcfe8" },
  { label: "Orange", value: "#fed7aa" },
] as const

// ─── Props interface ──────────────────────────────────────────────────────────

export interface ContractEditorProps {
  contractId?: string
  initialContent: unknown  // accepts both old Slate array and new TipTap doc
  initialVersion: number
  readOnly?: boolean
  readOnlyReason?: string
  showVariablesPanel?: boolean
  variables?: { name: string; label?: string; required?: boolean }[]
  onChange?: (value: unknown, wordCount: number) => void
  rightActions?: React.ReactNode
  enableAutoSave?: boolean
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ContractEditor({
  contractId,
  initialContent,
  initialVersion,
  readOnly = false,
  readOnlyReason,
  showVariablesPanel,
  variables = [],
  onChange,
  rightActions,
  enableAutoSave = true,
}: ContractEditorProps): React.ReactElement {
  const initialDoc = normalizeContent(initialContent)

  const [version, setVersion] = useState<number>(initialVersion)
  const [isReadOnly, setIsReadOnly] = useState(readOnly)
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saved" | "unsaved" | "saving" | "conflict" | "error"
  >(initialVersion > 0 ? "saved" : "idle")
  const [pageLayout, setPageLayout] = useState(false)

  const pendingSaveRef = useRef(false)
  const pendingRetryRef = useRef(false)
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const versionRef = useRef<number>(version)
  versionRef.current = version
  const saveStatusRef = useRef(saveStatus)
  saveStatusRef.current = saveStatus

  useEffect(() => {
    setIsReadOnly(readOnly)
  }, [readOnly])

  // ─── TipTap editor instance ────────────────────────────────────────────────

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        // StarterKit includes: blockquote, bold, bulletList, code, codeBlock,
        // document, dropcursor, gapcursor, hardBreak, heading, history,
        // horizontalRule, italic, listItem, orderedList, paragraph, strike, text
      }),
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Link.configure({ openOnClick: false }),
      Image,
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Color,
      TextStyle,
      Highlight.configure({ multicolor: true }),
      Placeholder.configure({ placeholder: "Start writing…" }),
      CharacterCount,
      TemplateVariableExtension,
    ],
    content: initialDoc,
    editable: !isReadOnly,
    onUpdate: ({ editor: ed }) => {
      const json = ed.getJSON()
      const wc = ed.storage.characterCount?.words() ?? 0
      onChange?.(json, wc)

      if (isReadOnly) return
      setSaveStatus("unsaved")
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (enableAutoSave && contractId) {
        saveTimer.current = setTimeout(() => triggerSave(ed), 3_000)
      }
    },
  })

  // Sync readOnly to editor
  useEffect(() => {
    if (!editor) return
    editor.setEditable(!isReadOnly)
  }, [editor, isReadOnly])

  // ─── Word count ────────────────────────────────────────────────────────────

  const wordCount = editor?.storage.characterCount?.words() ?? 0

  // ─── Save logic ────────────────────────────────────────────────────────────

  const triggerSave = useCallback(async (ed?: Editor) => {
    const activeEditor = ed ?? editor
    if (!contractId || !enableAutoSave || !activeEditor) return
    if (pendingSaveRef.current) { pendingRetryRef.current = true; return }
    if (isReadOnly) return

    pendingSaveRef.current = true
    setSaveStatus("saving")

    try {
      const json = activeEditor.getJSON()
      const wc = activeEditor.storage.characterCount?.words() ?? 0

      const res = await fetch(`/api/contracts/${contractId}/document`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: json,
          wordCount: wc,
          clientVersion: versionRef.current,
        }),
      })

      if (res.status === 409) {
        setSaveStatus("conflict")
        toast.error("Document updated elsewhere — reload to see the latest version.")
        return
      }
      if (res.status === 422) {
        const body = await res.json().catch(() => ({}))
        if ((body as { error?: string }).error === "read_only_status") {
          setIsReadOnly(true)
          toast.error("This contract is now read-only.")
        } else {
          setSaveStatus("error")
          toast.error("Auto-save failed.")
        }
        return
      }
      if (!res.ok) {
        setSaveStatus("error")
        toast.error("Auto-save failed. Your changes are not saved.")
        return
      }
      const body = await res.json()
      if ((body as { document?: { version?: number } }).document?.version) {
        const newVersion = (body as { document: { version: number } }).document.version
        setVersion(newVersion)
      }
      setSaveStatus("saved")
    } catch (err) {
      console.error("[editor] save failed:", err)
      setSaveStatus("error")
      toast.error("Auto-save failed. Your changes are not saved.")
    } finally {
      pendingSaveRef.current = false
      if (pendingRetryRef.current) {
        pendingRetryRef.current = false
        void triggerSave()
      }
    }
  }, [contractId, enableAutoSave, isReadOnly, editor])

  // Save on blur
  const handleBlur = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (enableAutoSave && contractId && !isReadOnly && saveStatusRef.current === "unsaved") {
      void triggerSave()
    }
  }, [enableAutoSave, contractId, isReadOnly, triggerSave])

  // Beforeunload guard
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (saveStatus === "unsaved" || saveStatus === "saving") {
        e.preventDefault()
        e.returnValue = ""
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload)
    return () => window.removeEventListener("beforeunload", handleBeforeUnload)
  }, [saveStatus])

  // Cleanup timers
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

  // ─── Keyboard shortcuts ────────────────────────────────────────────────────

  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      if (!editor) return
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (e.key === "s") { e.preventDefault(); void triggerSave(); return }
        if (e.key === "k") {
          e.preventDefault()
          const url = window.prompt("Enter URL:")
          if (url) editor.chain().focus().setLink({ href: url }).run()
          return
        }
        // b, i, u, z are handled natively by TipTap StarterKit + Underline
      }
    },
    [editor, triggerSave],
  )

  // ─── Active state helpers ──────────────────────────────────────────────────

  const headingValue = (() => {
    if (!editor) return "p"
    if (editor.isActive("heading", { level: 1 })) return "h1"
    if (editor.isActive("heading", { level: 2 })) return "h2"
    if (editor.isActive("heading", { level: 3 })) return "h3"
    return "p"
  })()

  const currentFontSize = (() => {
    if (!editor) return "14px"
    return (editor.getAttributes("textStyle").fontSize as string | undefined) ?? "14px"
  })()

  const currentColor = (() => {
    if (!editor) return ""
    return (editor.getAttributes("textStyle").color as string | undefined) ?? ""
  })()

  const currentHighlight = (() => {
    if (!editor) return ""
    const attrs = editor.getAttributes("highlight")
    return (attrs.color as string | undefined) ?? ""
  })()

  // ─── Table helpers ─────────────────────────────────────────────────────────

  const isInTable = editor?.isActive("table") ?? false

  // ─── Image upload ──────────────────────────────────────────────────────────

  async function handleImageUpload(file: File) {
    if (!contractId) { toast.error("Save the contract before inserting images."); return }
    if (!editor) return
    const fd = new FormData()
    fd.append("file", file)
    const res = await fetch(`/api/contracts/${contractId}/document/image`, { method: "POST", body: fd })
    if (!res.ok) { toast.error("Image upload failed."); return }
    const { url } = await res.json() as { url: string }
    editor.chain().focus().setImage({ src: url, alt: file.name }).run()
  }

  // ─── Heading toggle ────────────────────────────────────────────────────────

  function setHeading(value: string) {
    if (!editor) return
    if (value === "p") {
      editor.chain().focus().setParagraph().run()
    } else if (value === "h1") {
      editor.chain().focus().setHeading({ level: 1 }).run()
    } else if (value === "h2") {
      editor.chain().focus().setHeading({ level: 2 }).run()
    } else if (value === "h3") {
      editor.chain().focus().setHeading({ level: 3 }).run()
    }
  }

  // ─── Variable insertion ────────────────────────────────────────────────────

  function insertVariable(name: string) {
    if (!editor || !name) return
    editor.chain().focus().insertContent({
      type: "templateVariable",
      attrs: { variable: name },
    }).run()
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">
      {isReadOnly && readOnlyReason && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded text-sm">
          {readOnlyReason}
        </div>
      )}

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 pb-2">
        {!isReadOnly && editor && (
          <>
            {/* Undo / Redo */}
            <ToolbarButton
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().undo().run() }}
              title="Undo (Cmd+Z)"
            >
              <Undo className="size-4" />
            </ToolbarButton>
            <ToolbarButton
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().redo().run() }}
              title="Redo (Cmd+Shift+Z)"
            >
              <Redo className="size-4" />
            </ToolbarButton>

            <span className="w-px h-5 bg-zinc-200 mx-1" />

            {/* Heading */}
            <Select value={headingValue} onValueChange={(v) => setHeading(v ?? "p")}>
              <SelectTrigger className="h-8 w-32 text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="p">Normal</SelectItem>
                <SelectItem value="h1">
                  <span className="inline-flex items-center gap-1.5"><Heading1 className="size-3.5" /> H1</span>
                </SelectItem>
                <SelectItem value="h2">
                  <span className="inline-flex items-center gap-1.5"><Heading2 className="size-3.5" /> H2</span>
                </SelectItem>
                <SelectItem value="h3">
                  <span className="inline-flex items-center gap-1.5"><Heading3 className="size-3.5" /> H3</span>
                </SelectItem>
              </SelectContent>
            </Select>

            {/* Font size */}
            <Select
              value={currentFontSize}
              onValueChange={(v) => {
                if (v) editor.chain().focus().setMark("textStyle", { fontSize: v }).run()
              }}
            >
              <SelectTrigger className="h-8 w-20 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_SIZES.map((s) => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Text color */}
            <Select
              value={currentColor}
              onValueChange={(v) => {
                const color = v ?? ""
                if (color === "") {
                  editor.chain().focus().unsetColor().run()
                } else {
                  editor.chain().focus().setColor(color).run()
                }
              }}
            >
              <SelectTrigger className="h-8 w-8 p-0 flex items-center justify-center border-zinc-200">
                <div
                  className="size-4 rounded-sm border border-zinc-300"
                  style={{ backgroundColor: currentColor || "#000000" }}
                />
              </SelectTrigger>
              <SelectContent>
                {TEXT_COLORS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="size-3 rounded-sm border border-zinc-200 inline-block"
                        style={{ backgroundColor: c.value || "#000000" }}
                      />
                      {c.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            {/* Highlight color */}
            <Select
              value={currentHighlight}
              onValueChange={(v) => {
                const color = v ?? ""
                if (color === "") {
                  editor.chain().focus().unsetHighlight().run()
                } else {
                  editor.chain().focus().setHighlight({ color }).run()
                }
              }}
            >
              <SelectTrigger className="h-8 w-8 p-0 flex items-center justify-center border-zinc-200">
                <div
                  className="size-4 rounded-sm border border-zinc-300 flex items-center justify-center"
                  style={{ backgroundColor: currentHighlight || "transparent" }}
                >
                  <Highlighter className="size-2.5 text-zinc-600" />
                </div>
              </SelectTrigger>
              <SelectContent>
                {HIGHLIGHT_COLORS.map((c) => (
                  <SelectItem key={c.value} value={c.value}>
                    <span className="inline-flex items-center gap-2">
                      <span
                        className="size-3 rounded-sm border border-zinc-200 inline-block"
                        style={{ backgroundColor: c.value || "transparent" }}
                      />
                      {c.label}
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <span className="w-px h-5 bg-zinc-200 mx-1" />

            {/* Marks */}
            <ToolbarButton
              active={editor.isActive("bold")}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBold().run() }}
              title="Bold (Cmd+B)"
            >
              <Bold className="size-4" />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive("italic")}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleItalic().run() }}
              title="Italic (Cmd+I)"
            >
              <Italic className="size-4" />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive("underline")}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleUnderline().run() }}
              title="Underline (Cmd+U)"
            >
              <UnderlineIcon className="size-4" />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive("strike")}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleStrike().run() }}
              title="Strikethrough (Cmd+Shift+S)"
            >
              <Strikethrough className="size-4" />
            </ToolbarButton>

            <span className="w-px h-5 bg-zinc-200 mx-1" />

            {/* Link */}
            <ToolbarButton
              active={editor.isActive("link")}
              onMouseDown={(e) => {
                e.preventDefault()
                if (editor.isActive("link")) {
                  editor.chain().focus().unsetLink().run()
                } else {
                  const url = window.prompt("Enter URL:")
                  if (url) editor.chain().focus().setLink({ href: url }).run()
                }
              }}
              title="Insert link (Cmd+K)"
            >
              <LinkIcon className="size-4" />
            </ToolbarButton>

            <span className="w-px h-5 bg-zinc-200 mx-1" />

            {/* Alignment */}
            <ToolbarButton
              active={editor.isActive({ textAlign: "left" })}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setTextAlign("left").run() }}
              title="Align left"
            ><AlignLeft className="size-4" /></ToolbarButton>
            <ToolbarButton
              active={editor.isActive({ textAlign: "center" })}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setTextAlign("center").run() }}
              title="Align center"
            ><AlignCenter className="size-4" /></ToolbarButton>
            <ToolbarButton
              active={editor.isActive({ textAlign: "right" })}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setTextAlign("right").run() }}
              title="Align right"
            ><AlignRight className="size-4" /></ToolbarButton>
            <ToolbarButton
              active={editor.isActive({ textAlign: "justify" })}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setTextAlign("justify").run() }}
              title="Justify"
            ><AlignJustify className="size-4" /></ToolbarButton>

            <span className="w-px h-5 bg-zinc-200 mx-1" />

            {/* Indent / Outdent — implemented via list manipulation for non-list nodes */}
            <ToolbarButton
              onMouseDown={(e) => {
                e.preventDefault()
                // For list items, sink (indent); for others, wrap in blockquote as visual indent
                editor.chain().focus().sinkListItem("listItem").run()
              }}
              title="Indent"
            ><Indent className="size-4" /></ToolbarButton>
            <ToolbarButton
              onMouseDown={(e) => {
                e.preventDefault()
                editor.chain().focus().liftListItem("listItem").run()
              }}
              title="Outdent"
            ><Outdent className="size-4" /></ToolbarButton>

            <span className="w-px h-5 bg-zinc-200 mx-1" />

            {/* Lists */}
            <ToolbarButton
              active={editor.isActive("orderedList")}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run() }}
              title="Ordered list"
            >
              <ListOrdered className="size-4" />
            </ToolbarButton>
            <ToolbarButton
              active={editor.isActive("bulletList")}
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBulletList().run() }}
              title="Bulleted list"
            >
              <List className="size-4" />
            </ToolbarButton>

            <span className="w-px h-5 bg-zinc-200 mx-1" />

            {/* Table / HR / Image */}
            <ToolbarButton
              active={isInTable}
              onMouseDown={(e) => {
                e.preventDefault()
                if (isInTable) {
                  // Show table actions inline when inside a table
                } else {
                  editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run()
                }
              }}
              title="Insert table"
            >
              <TableIcon className="size-4" />
            </ToolbarButton>

            {/* Table row/col controls — shown when inside a table */}
            {isInTable && (
              <>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addRowAfter().run() }}
                  className="rounded px-2 py-0.5 text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-700 h-8"
                  title="Add row"
                >+Row</button>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteRow().run() }}
                  className="rounded px-2 py-0.5 text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-700 h-8"
                  title="Delete row"
                >-Row</button>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addColumnAfter().run() }}
                  className="rounded px-2 py-0.5 text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-700 h-8"
                  title="Add column"
                >+Col</button>
                <button
                  type="button"
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteColumn().run() }}
                  className="rounded px-2 py-0.5 text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-700 h-8"
                  title="Delete column"
                >-Col</button>
              </>
            )}

            <ToolbarButton
              onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setHorizontalRule().run() }}
              title="Horizontal rule"
            >
              <Minus className="size-4" />
            </ToolbarButton>
            <ToolbarButton
              onMouseDown={(e) => {
                e.preventDefault()
                if (!contractId) { toast.error("Save the contract before inserting images."); return }
                const input = document.createElement("input")
                input.type = "file"
                input.accept = "image/jpeg,image/png,image/gif,image/webp"
                input.onchange = async () => {
                  const file = input.files?.[0]
                  if (!file) return
                  try {
                    await handleImageUpload(file)
                  } catch {
                    toast.error("Image upload failed.")
                  }
                }
                input.click()
              }}
              title="Insert image"
            >
              <ImageIcon className="size-4" />
            </ToolbarButton>
          </>
        )}

        {/* Right side — always visible */}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-zinc-500 tabular-nums">
            {wordCount.toLocaleString()} words
          </span>
          <SaveStatusLabel status={saveStatus} />
          <button
            type="button"
            onClick={() => setPageLayout((v) => !v)}
            className={cn(
              "rounded p-1.5 transition-colors",
              pageLayout ? "bg-indigo-100 text-indigo-700" : "text-zinc-500 hover:bg-zinc-100"
            )}
            title="Toggle page layout"
          >
            <LayoutTemplate className="size-4" />
          </button>
          {rightActions}
        </div>
      </div>

      {/* Editor body */}
      <div className="grid grid-cols-12 gap-4">
        <div className={cn(
          showVariablesPanel ? "col-span-9" : "col-span-12",
          pageLayout && "flex justify-center bg-zinc-100 rounded-md p-6 min-h-[600px]"
        )}>
          <div className={cn(
            "bg-white",
            pageLayout
              ? "w-[794px] min-h-[1123px] shadow-lg p-[72px] border border-zinc-200"
              : "rounded-md border border-zinc-200 p-4 min-h-[400px]"
          )}>
            {!editor && (
              <div className="flex flex-col items-center justify-center py-12 gap-3">
                <FileText className="size-10 text-zinc-300" />
                <p className="text-sm text-zinc-500">Loading editor…</p>
              </div>
            )}
            <EditorContent
              editor={editor}
              onKeyDown={onKeyDown}
              onBlur={handleBlur}
              className={cn(
                "outline-none min-h-[400px] text-sm text-zinc-900",
                "[&_.ProseMirror]:outline-none [&_.ProseMirror]:min-h-[400px]",
                // Headings
                "[&_.ProseMirror_h1]:text-2xl [&_.ProseMirror_h1]:font-bold [&_.ProseMirror_h1]:mt-4 [&_.ProseMirror_h1]:mb-2",
                "[&_.ProseMirror_h2]:text-xl [&_.ProseMirror_h2]:font-bold [&_.ProseMirror_h2]:mt-3 [&_.ProseMirror_h2]:mb-2",
                "[&_.ProseMirror_h3]:text-lg [&_.ProseMirror_h3]:font-bold [&_.ProseMirror_h3]:mt-3 [&_.ProseMirror_h3]:mb-1.5",
                // Paragraph
                "[&_.ProseMirror_p]:my-2 [&_.ProseMirror_p]:leading-6",
                // Lists
                "[&_.ProseMirror_ul]:list-disc [&_.ProseMirror_ul]:pl-6 [&_.ProseMirror_ul]:my-2",
                "[&_.ProseMirror_ol]:list-decimal [&_.ProseMirror_ol]:pl-6 [&_.ProseMirror_ol]:my-2",
                "[&_.ProseMirror_li]:my-1",
                // Table
                "[&_.ProseMirror_table]:border [&_.ProseMirror_table]:border-zinc-300 [&_.ProseMirror_table]:w-full [&_.ProseMirror_table]:my-3",
                "[&_.ProseMirror_td]:border [&_.ProseMirror_td]:border-zinc-300 [&_.ProseMirror_td]:px-2 [&_.ProseMirror_td]:py-1.5 [&_.ProseMirror_td]:align-top",
                "[&_.ProseMirror_th]:border [&_.ProseMirror_th]:border-zinc-300 [&_.ProseMirror_th]:px-2 [&_.ProseMirror_th]:py-1.5 [&_.ProseMirror_th]:align-top [&_.ProseMirror_th]:font-semibold [&_.ProseMirror_th]:bg-zinc-50",
                // Horizontal rule
                "[&_.ProseMirror_hr]:my-4 [&_.ProseMirror_hr]:border-t [&_.ProseMirror_hr]:border-zinc-300",
                // Link
                "[&_.ProseMirror_a]:text-indigo-600 [&_.ProseMirror_a]:underline [&_.ProseMirror_a:hover]:text-indigo-800",
                // Blockquote
                "[&_.ProseMirror_blockquote]:border-l-4 [&_.ProseMirror_blockquote]:border-zinc-300 [&_.ProseMirror_blockquote]:pl-4 [&_.ProseMirror_blockquote]:my-2 [&_.ProseMirror_blockquote]:italic",
                // Image
                "[&_.ProseMirror_img]:max-w-full [&_.ProseMirror_img]:rounded [&_.ProseMirror_img]:border [&_.ProseMirror_img]:border-zinc-200",
                // Placeholder
                "[&_.ProseMirror_p.is-editor-empty:first-child::before]:text-zinc-400 [&_.ProseMirror_p.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.ProseMirror_p.is-editor-empty:first-child::before]:float-left [&_.ProseMirror_p.is-editor-empty:first-child::before]:pointer-events-none",
              )}
            />
          </div>
        </div>

        {showVariablesPanel && (
          <div className="col-span-3 rounded-md border border-zinc-200 bg-white p-3 space-y-2 max-h-[600px] overflow-y-auto">
            <p className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Variables</p>
            {variables.length === 0 && (
              <p className="text-xs text-zinc-500">No variables declared yet.</p>
            )}
            {variables.map((v) => (
              <div key={v.name} className="rounded border border-zinc-200 px-2 py-1.5 text-xs flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="font-medium text-zinc-900 truncate">{v.label ?? v.name}</p>
                  <p className="text-zinc-500 truncate">{v.name}{v.required ? " *" : ""}</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-6 text-xs px-2 shrink-0"
                  onMouseDown={(e) => {
                    e.preventDefault()
                    insertVariable(v.name)
                  }}
                >
                  Insert
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToolbarButton({
  active,
  onMouseDown,
  title,
  children,
}: {
  active?: boolean
  onMouseDown: React.MouseEventHandler<HTMLButtonElement>
  title?: string
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={onMouseDown}
      className={cn(
        "h-8 w-8 inline-flex items-center justify-center rounded text-zinc-700 hover:bg-zinc-100",
        active && "bg-zinc-100 text-indigo-600",
      )}
    >
      {children}
    </button>
  )
}

function SaveStatusLabel({ status }: { status: string }) {
  if (status === "idle") return null
  if (status === "saved") return <span className="text-sm text-zinc-400">Saved</span>
  if (status === "unsaved") return <span className="text-sm text-amber-600">Unsaved changes</span>
  if (status === "saving") return <span className="text-sm text-zinc-400">Saving…</span>
  if (status === "conflict") return <span className="text-sm text-red-600">Conflict — reload to sync</span>
  if (status === "error") return <span className="text-sm text-red-600">Save failed</span>
  return null
}
