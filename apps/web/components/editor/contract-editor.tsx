"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
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

// ─── Extended TextStyle — adds fontSize attribute ─────────────────────────────
const TextStyleExtended = TextStyle.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      fontSize: {
        default: null,
        parseHTML: (element) => (element as HTMLElement).style.fontSize || null,
        renderHTML: (attributes) => {
          if (!(attributes as { fontSize?: string }).fontSize) return {}
          return { style: `font-size: ${(attributes as { fontSize: string }).fontSize}` }
        },
      },
    }
  },
})
import Highlight from "@tiptap/extension-highlight"
import Placeholder from "@tiptap/extension-placeholder"
import CharacterCount from "@tiptap/extension-character-count"
import { Mark, Node, Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { ReplaceStep } from "@tiptap/pm/transform"
import { toast } from "sonner"
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Minus, Table as TableIcon, FileText,
  Heading1, Heading2, Heading3,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Indent, Outdent, LayoutTemplate, Image as ImageIcon,
  Undo, Redo, Link as LinkIcon,
  GitBranch, ChevronDown, Plus, Check, BookOpen, Search,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
  DropdownMenuCheckboxItem,
} from "@/components/ui/dropdown-menu"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Input } from "@/components/ui/input"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet"
import { slateToTiptap } from "@/lib/editor/slate-to-tiptap"
import type { TipTapDoc } from "@/lib/editor/tiptap-types"
import { SearchAndReplace } from "@/lib/editor/search-and-replace"
import { ClauseSnippetsPanel } from "./clause-snippets-panel"
import { FindReplacePanel } from "./find-replace-panel"
import { FloatingSelectionToolbar } from "./floating-selection-toolbar"

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

// ─── CommentMark extension ────────────────────────────────────────────────────

const CommentMark = Mark.create({
  name: "comment",
  addAttributes() {
    return {
      commentId: { default: null },
    }
  },
  parseHTML() {
    return [{ tag: "mark[data-comment-id]" }]
  },
  renderHTML({ HTMLAttributes }) {
    return [
      "mark",
      {
        "data-comment-id": HTMLAttributes.commentId as string,
        class: "bg-amber-100 border-b-2 border-amber-400 cursor-pointer rounded-sm",
      },
      0,
    ]
  },
})

// ─── InsertionMark extension ──────────────────────────────────────────────────

const InsertionMark = Mark.create({
  name: "insertion",
  addAttributes() {
    return {
      userId:    { default: null },
      createdAt: { default: null },
    }
  },
  parseHTML() { return [{ tag: "ins" }] },
  renderHTML() {
    return [
      "ins",
      {
        class: "no-underline",
        style: "color: hsl(var(--success, 142 71% 45%)); background: hsl(142 71% 45% / 0.08); border-bottom: 2px solid hsl(142 71% 45% / 0.35); text-decoration: none;",
      },
      0,
    ]
  },
})

// ─── DeletionMark extension ───────────────────────────────────────────────────

const DeletionMark = Mark.create({
  name: "deletion",
  addAttributes() {
    return {
      userId:    { default: null },
      createdAt: { default: null },
    }
  },
  parseHTML() { return [{ tag: "del" }] },
  renderHTML() {
    return [
      "del",
      {
        style: "color: hsl(var(--destructive, 0 84% 60%)); background: hsl(0 84% 60% / 0.06); text-decoration: line-through;",
      },
      0,
    ]
  },
})

// ─── Track Changes ProseMirror Plugin ────────────────────────────────────────

const TC_META = "trackChangesOp"
const tcKey = new PluginKey<boolean>("trackChanges")

function createTrackChangesPlugin(
  isEnabled: () => boolean,
  getUserId: () => string,
) {
  return new Plugin({
    key: tcKey,
    appendTransaction(transactions, oldState, newState) {
      if (!isEnabled()) return null
      const relevant = transactions.filter(
        (tr) => tr.docChanged && !tr.getMeta(TC_META),
      )
      if (relevant.length === 0) return null

      const userId = getUserId()
      const now = new Date().toISOString()
      const outTr = newState.tr.setMeta(TC_META, true)
      let dirty = false

      const insertionMarkType = newState.schema.marks["insertion"]
      const deletionMarkType  = newState.schema.marks["deletion"]

      for (const tr of relevant) {
        let offset = 0

        for (const step of tr.steps) {
          if (!(step instanceof ReplaceStep)) { offset += step.getMap().map(0) - 0; continue }

          const rs   = step as ReplaceStep
          const from = rs.from + offset
          const to   = rs.to   + offset
          const insertedSize = rs.slice.content.size

          // Deletions: re-insert removed text with deletion mark
          if (to > from && deletionMarkType) {
            const deletedFrag = oldState.doc.slice(rs.from, rs.to).content
            const mark = deletionMarkType.create({ userId, createdAt: now })
            outTr.insert(from, deletedFrag)
            outTr.addMark(from, from + (rs.to - rs.from), mark)
            dirty = true
          }

          // Insertions: mark newly inserted content
          if (insertedSize > 0 && insertionMarkType) {
            const mark = insertionMarkType.create({ userId, createdAt: now })
            const insertStart = from + (to > from ? (rs.to - rs.from) : 0)
            outTr.addMark(insertStart, insertStart + insertedSize, mark)
            dirty = true
          }

          offset += insertedSize - (rs.to - rs.from)
        }
      }

      return dirty ? outTr : null
    },
  })
}

// TrackChangesExtension is built inline inside ContractEditor (see useEditor extensions)
// so that its plugin closure can directly capture stable React refs.

// ─── Accept / Reject All helpers ─────────────────────────────────────────────

export function acceptAllChanges(editor: Editor) {
  const toDelete: { from: number; to: number }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.isText) {
      if (node.marks.some((m) => m.type.name === "deletion")) {
        toDelete.push({ from: pos, to: pos + node.nodeSize })
      }
    }
  })
  const tr = editor.state.tr
  for (const { from, to } of toDelete.reverse()) {
    tr.delete(from, to)
  }
  const deletionMark = editor.state.schema.marks["deletion"]
  const insertionMark = editor.state.schema.marks["insertion"]
  if (deletionMark) tr.removeMark(0, tr.doc.content.size, deletionMark)
  if (insertionMark) tr.removeMark(0, tr.doc.content.size, insertionMark)
  editor.view.dispatch(tr)
}

export function rejectAllChanges(editor: Editor) {
  const toDelete: { from: number; to: number }[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.isText) {
      if (node.marks.some((m) => m.type.name === "insertion")) {
        toDelete.push({ from: pos, to: pos + node.nodeSize })
      }
    }
  })
  const tr = editor.state.tr
  for (const { from, to } of toDelete.reverse()) {
    tr.delete(from, to)
  }
  const deletionMark = editor.state.schema.marks["deletion"]
  const insertionMark = editor.state.schema.marks["insertion"]
  if (deletionMark) tr.removeMark(0, tr.doc.content.size, deletionMark)
  if (insertionMark) tr.removeMark(0, tr.doc.content.size, insertionMark)
  editor.view.dispatch(tr)
}

// ── Individual track-change helpers ──────────────────────────────────────────

export type ChangeItem = {
  id: string          // unique: `${type}-${from}-${to}`
  type: "insertion" | "deletion"
  from: number        // ProseMirror position (absolute)
  to: number          // ProseMirror position (absolute)
  text: string        // the marked text
  userId: string | null
  createdAt: string | null
}

/**
 * Walk the ProseMirror document and collect all insertion/deletion marks
 * with their absolute positions. Returns changes in document order.
 */
export function collectChanges(editor: Editor): ChangeItem[] {
  const changes: ChangeItem[] = []
  editor.state.doc.descendants((node, pos) => {
    for (const mark of node.marks) {
      if (mark.type.name === "insertion" || mark.type.name === "deletion") {
        const from = pos
        const to = pos + node.nodeSize
        changes.push({
          id: `${mark.type.name}-${from}-${to}`,
          type: mark.type.name as "insertion" | "deletion",
          from,
          to,
          text: node.text ?? "",
          userId: (mark.attrs.userId as string) ?? null,
          createdAt: (mark.attrs.createdAt as string) ?? null,
        })
      }
    }
  })
  return changes
}

/**
 * Accept a single tracked change:
 * - insertion → remove the mark (keep the text)
 * - deletion → remove the node range entirely
 */
export function acceptChange(editor: Editor, change: ChangeItem): void {
  const { state, dispatch } = editor.view
  const { tr } = state
  if (change.type === "insertion") {
    // Remove only the insertion mark, keep the text
    tr.removeMark(change.from, change.to, state.schema.marks.insertion)
  } else {
    // deletion → delete the text
    tr.delete(change.from, change.to)
  }
  dispatch(tr)
}

/**
 * Reject a single tracked change:
 * - insertion → delete the node range (reject the addition)
 * - deletion → remove the mark (restore the text)
 */
export function rejectChange(editor: Editor, change: ChangeItem): void {
  const { state, dispatch } = editor.view
  const { tr } = state
  if (change.type === "insertion") {
    // Reject the insertion: delete the text
    tr.delete(change.from, change.to)
  } else {
    // Reject the deletion: restore by removing the deletion mark
    tr.removeMark(change.from, change.to, state.schema.marks.deletion)
  }
  dispatch(tr)
}

/**
 * Scroll a specific change into view in the editor.
 */
export function scrollToChange(editor: Editor, change: ChangeItem): void {
  editor.commands.setTextSelection({ from: change.from, to: change.to })
  editor.commands.scrollIntoView()
}

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
  // Feature: Comments
  onAddComment?: () => void
  // Feature: Track Changes
  currentUserId?: string
  currentUserName?: string
  onAcceptAllChanges?: () => void
  onRejectAllChanges?: () => void
  // Feature: Clause Navigation
  onSelectionChange?: (activeHeading: string | null) => void
  // Expose editor instance to parent
  onEditorReady?: (editor: Editor) => void
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
  onAddComment,
  currentUserId,
  currentUserName: _currentUserName,
  onAcceptAllChanges,
  onRejectAllChanges,
  onSelectionChange,
  onEditorReady,
}: ContractEditorProps): React.ReactElement {
  const initialDoc = normalizeContent(initialContent)

  const [version, setVersion] = useState<number>(initialVersion)
  const [isReadOnly, setIsReadOnly] = useState(readOnly)
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saved" | "unsaved" | "saving" | "conflict" | "error"
  >(initialVersion > 0 ? "saved" : "idle")
  const [pageLayout, setPageLayout] = useState(false)
  const [trackChanges, setTrackChanges] = useState(false)
  const [snippetsPanelOpen, setSnippetsPanelOpen] = useState(false)
  const [findReplaceOpen, setFindReplaceOpen] = useState(false)

  // ─── Link popover state (main toolbar) ────────────────────────────────────
  const [linkPopoverOpen, setLinkPopoverOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState("")

  // These refs are captured by the ProseMirror plugin closure at editor creation.
  // Mutating .current is synchronous and is always visible to the closure on the
  // next transaction — no useEffect needed, no TipTap storage indirection.
  const tcEnabledRef = useRef(false)
  const tcUserIdRef  = useRef(currentUserId ?? "")
  tcEnabledRef.current = trackChanges
  tcUserIdRef.current  = currentUserId ?? ""

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

  // IMPORTANT: extensions must be memoized with an empty deps array.
  // TipTap v2's useEditor calls editor.setOptions(options) after every render
  // (useEffect with no deps). If extensions array reference changes each render
  // (because Extension.create / StarterKit.configure produce new objects), TipTap
  // destroys and recreates the editor on every render → infinite loop → buttons
  // are never stably clickable.  Refs are stable objects so the plugin closures
  // always read the latest .current values even with a once-created array.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const extensions = useMemo(() => [
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
    TextStyleExtended,
    Highlight.configure({ multicolor: true }),
    Placeholder.configure({ placeholder: "Start writing…" }),
    CharacterCount,
    TemplateVariableExtension,
    CommentMark,
    InsertionMark,
    DeletionMark,
    SearchAndReplace,
    // Build the TrackChangesExtension inline so its ProseMirror plugin closure
    // captures tcEnabledRef / tcUserIdRef directly.  Mutating .current is
    // synchronous and visible to the plugin on the very next transaction —
    // no TipTap storage indirection that might break across versions.
    Extension.create({
      name: "trackChangesExtension",
      addProseMirrorPlugins: () => [
        createTrackChangesPlugin(
          () => tcEnabledRef.current,
          () => tcUserIdRef.current,
        ),
      ],
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], []) // empty deps — create once on mount; refs are stable

  const editor = useEditor({
    extensions,
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
    onSelectionUpdate: ({ editor: ed }) => {
      const pos = ed.state.selection.from
      let nearestHeading: string | null = null
      ed.state.doc.descendants((node, nodePos) => {
        if (node.type.name === "heading" && nodePos <= pos) {
          nearestHeading = node.textContent
        }
      })
      onSelectionChange?.(nearestHeading)
    },
  })

  // Sync readOnly to editor
  useEffect(() => {
    if (!editor) return
    editor.setEditable(!isReadOnly)
  }, [editor, isReadOnly])

  // Expose editor instance to parent
  useEffect(() => {
    if (editor) onEditorReady?.(editor)
  }, [editor, onEditorReady])

  // tcEnabledRef.current and tcUserIdRef.current are updated synchronously on
  // every render (lines above), so no useEffect is needed for track-changes sync.

  // Wire accept/reject all
  useEffect(() => {
    if (!editor || !onAcceptAllChanges) return
    // The parent calls this prop function; we replace it by calling our internal function
    // We expose the editor to the parent via a ref-like pattern via the effect
  }, [editor, onAcceptAllChanges])

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

  // ─── Find & Replace keyboard shortcut (Cmd+H / Ctrl+H) ───────────────────

  useEffect(() => {
    function handleFindReplaceShortcut(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === "h") {
        e.preventDefault()
        setFindReplaceOpen((prev) => !prev)
      }
      // Close on Escape when the panel is open
      if (e.key === "Escape" && findReplaceOpen) {
        setFindReplaceOpen(false)
        // Clear the search term from the extension
        if (editor) {
          editor.commands.setSearchTerm("")
        }
      }
    }
    window.addEventListener("keydown", handleFindReplaceShortcut)
    return () => window.removeEventListener("keydown", handleFindReplaceShortcut)
  }, [editor, findReplaceOpen])

  // ─── Keyboard shortcuts ────────────────────────────────────────────────────

  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      if (!editor) return
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (e.key === "s") { e.preventDefault(); void triggerSave(); return }
        if (e.key === "k") {
          e.preventDefault()
          // Open the link popover programmatically instead of window.prompt
          setLinkUrl(editor.getAttributes("link").href ?? "")
          setLinkPopoverOpen(true)
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

  // ─── Active alignment icon helper ─────────────────────────────────────────

  const activeAlignIcon = (() => {
    if (!editor) return <AlignLeft className="size-4" />
    if (editor.isActive({ textAlign: "center" })) return <AlignCenter className="size-4" />
    if (editor.isActive({ textAlign: "right" })) return <AlignRight className="size-4" />
    if (editor.isActive({ textAlign: "justify" })) return <AlignJustify className="size-4" />
    return <AlignLeft className="size-4" />
  })()

  // ─── Table helpers ─────────────────────────────────────────────────────────

  const isInTable = editor?.isActive("table") ?? false

  // ─── Selection preservation for toolbar dropdowns ─────────────────────────
  // Radix Select steals editor focus on open. Save selection before open,
  // restore it in onValueChange before running the TipTap command.

  const savedSelectionRef = useRef<{ from: number; to: number } | null>(null)

  const saveEditorSelection = useCallback(() => {
    if (!editor) return
    const { from, to } = editor.state.selection
    savedSelectionRef.current = { from, to }
  }, [editor])

  const restoreEditorSelection = useCallback(() => {
    if (!editor || !savedSelectionRef.current) return
    const { from, to } = savedSelectionRef.current
    editor.commands.setTextSelection({ from, to })
  }, [editor])

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

  // ─── Handle accept/reject all ──────────────────────────────────────────────

  function handleAcceptAll() {
    if (!editor) return
    acceptAllChanges(editor)
    onAcceptAllChanges?.()
  }

  function handleRejectAll() {
    if (!editor) return
    rejectAllChanges(editor)
    onRejectAllChanges?.()
  }

  // ─── Image input trigger ───────────────────────────────────────────────────

  function triggerImageInput() {
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
  }

  // ─── Render ───────────────────────────────────────────────────────────────

  return (
    <div className="flex flex-col gap-3">
      {isReadOnly && readOnlyReason && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded text-sm">
          {readOnlyReason}
        </div>
      )}

      {/* ── Main Toolbar ─────────────────────────────────────────────────── */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-zinc-200 pb-2">
        {!isReadOnly && editor && (
          <>
            {/* Group 1: Undo / Redo */}
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

            <ToolbarDivider />

            {/* Group 2: Text style — B I U S */}
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

            <ToolbarDivider />

            {/* Group 3: Paragraph — Heading dropdown + Font size + Align dropdown */}
            <Select
              value={headingValue}
              onOpenChange={(open) => { if (open) saveEditorSelection() }}
              onValueChange={(v) => { restoreEditorSelection(); setHeading(v ?? "p") }}
            >
              <SelectTrigger className="h-8 w-28 text-sm">
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

            <Select
              value={currentFontSize}
              onOpenChange={(open) => { if (open) saveEditorSelection() }}
              onValueChange={(v) => {
                restoreEditorSelection()
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

            {/* Align dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger
                title="Text alignment"
                onMouseDown={(e) => e.preventDefault()}
                className="h-8 px-1.5 inline-flex items-center gap-0.5 rounded text-zinc-700 hover:bg-zinc-100"
              >
                {activeAlignIcon}
                <ChevronDown className="size-3 text-zinc-400" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[140px]">
                <DropdownMenuItem
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setTextAlign("left").run() }}
                  className={cn("gap-2", editor.isActive({ textAlign: "left" }) && "text-indigo-600 bg-indigo-50")}
                >
                  <AlignLeft className="size-4" /> Align left
                </DropdownMenuItem>
                <DropdownMenuItem
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setTextAlign("center").run() }}
                  className={cn("gap-2", editor.isActive({ textAlign: "center" }) && "text-indigo-600 bg-indigo-50")}
                >
                  <AlignCenter className="size-4" /> Center
                </DropdownMenuItem>
                <DropdownMenuItem
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setTextAlign("right").run() }}
                  className={cn("gap-2", editor.isActive({ textAlign: "right" }) && "text-indigo-600 bg-indigo-50")}
                >
                  <AlignRight className="size-4" /> Align right
                </DropdownMenuItem>
                <DropdownMenuItem
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().setTextAlign("justify").run() }}
                  className={cn("gap-2", editor.isActive({ textAlign: "justify" }) && "text-indigo-600 bg-indigo-50")}
                >
                  <AlignJustify className="size-4" /> Justify
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <ToolbarDivider />

            {/* Group 4: Lists dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger
                title="Lists"
                onMouseDown={(e) => e.preventDefault()}
                className={cn(
                  "h-8 px-1.5 inline-flex items-center gap-0.5 rounded text-zinc-700 hover:bg-zinc-100",
                  (editor.isActive("bulletList") || editor.isActive("orderedList")) && "bg-zinc-100 text-indigo-600"
                )}
              >
                <List className="size-4" />
                <ChevronDown className="size-3 text-zinc-400" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[160px]">
                <DropdownMenuItem
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleBulletList().run() }}
                  className={cn("gap-2", editor.isActive("bulletList") && "text-indigo-600 bg-indigo-50")}
                >
                  <List className="size-4" /> Bullet list
                </DropdownMenuItem>
                <DropdownMenuItem
                  onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().toggleOrderedList().run() }}
                  className={cn("gap-2", editor.isActive("orderedList") && "text-indigo-600 bg-indigo-50")}
                >
                  <ListOrdered className="size-4" /> Numbered list
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            <ToolbarDivider />

            {/* Group 5: Insert dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger
                title="Insert"
                onMouseDown={(e) => e.preventDefault()}
                className="h-8 px-2 inline-flex items-center gap-1 rounded text-zinc-700 hover:bg-zinc-100 text-xs font-medium"
              >
                <Plus className="size-3.5" />
                Insert
                <ChevronDown className="size-3 text-zinc-400" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[180px]">
                <DropdownMenuItem
                  onSelect={() => setSnippetsPanelOpen(true)}
                  className="gap-2"
                >
                  <BookOpen className="size-4" /> Clause Snippets
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                {/* Link */}
                <DropdownMenuItem
                  onMouseDown={(e) => {
                    e.preventDefault()
                    setLinkUrl(editor.getAttributes("link").href ?? "")
                    setLinkPopoverOpen(true)
                  }}
                  className="gap-2"
                >
                  <LinkIcon className="size-4" /> Link
                </DropdownMenuItem>
                <DropdownMenuItem
                  onMouseDown={(e) => {
                    e.preventDefault()
                    editor.chain().focus().insertTable({ rows: 2, cols: 2, withHeaderRow: false }).run()
                  }}
                  className="gap-2"
                >
                  <TableIcon className="size-4" /> Table
                </DropdownMenuItem>
                <DropdownMenuItem
                  onMouseDown={(e) => {
                    e.preventDefault()
                    triggerImageInput()
                  }}
                  className="gap-2"
                >
                  <ImageIcon className="size-4" /> Image
                </DropdownMenuItem>
                <DropdownMenuItem
                  onMouseDown={(e) => {
                    e.preventDefault()
                    editor.chain().focus().setHorizontalRule().run()
                  }}
                  className="gap-2"
                >
                  <Minus className="size-4" /> Horizontal rule
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onMouseDown={(e) => {
                    e.preventDefault()
                    editor.chain().focus().sinkListItem("listItem").run()
                  }}
                  className="gap-2"
                >
                  <Indent className="size-4" /> Indent
                </DropdownMenuItem>
                <DropdownMenuItem
                  onMouseDown={(e) => {
                    e.preventDefault()
                    editor.chain().focus().liftListItem("listItem").run()
                  }}
                  className="gap-2"
                >
                  <Outdent className="size-4" /> Outdent
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Group 6: Track dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger
                title="Track changes"
                onMouseDown={(e) => e.preventDefault()}
                className={cn(
                  "h-8 px-2 inline-flex items-center gap-1 rounded text-xs font-medium transition-colors border",
                  trackChanges
                    ? "bg-amber-50 border-amber-300 text-amber-700 ring-1 ring-amber-300"
                    : "border-zinc-200 text-zinc-600 hover:bg-zinc-100 hover:border-zinc-300"
                )}
              >
                <GitBranch className="size-3.5" />
                Track
                <ChevronDown className="size-3 opacity-60" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="min-w-[180px]">
                <DropdownMenuCheckboxItem
                  checked={trackChanges}
                  onCheckedChange={(v) => setTrackChanges(Boolean(v))}
                  onMouseDown={(e) => e.preventDefault()}
                >
                  Enable track changes
                </DropdownMenuCheckboxItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onMouseDown={(e) => { e.preventDefault(); handleAcceptAll() }}
                  disabled={!trackChanges}
                  className="gap-2 text-green-700 focus:text-green-700 focus:bg-green-50"
                >
                  <Check className="size-4" /> Accept all
                </DropdownMenuItem>
                <DropdownMenuItem
                  onMouseDown={(e) => { e.preventDefault(); handleRejectAll() }}
                  disabled={!trackChanges}
                  className="gap-2 text-red-700 focus:text-red-700 focus:bg-red-50"
                >
                  <Minus className="size-4" /> Reject all
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Link popover (opened from Insert dropdown or Cmd+K) */}
            <Popover
              open={linkPopoverOpen}
              onOpenChange={(open) => {
                setLinkPopoverOpen(open)
                if (!open) setLinkUrl("")
              }}
            >
              {/* Hidden trigger — popover is opened programmatically via state */}
              <PopoverTrigger
                style={{ display: "none" }}
                tabIndex={-1}
                aria-hidden
              >
                link
              </PopoverTrigger>
              <PopoverContent className="w-72 p-3">
                <p className="text-xs font-medium text-zinc-700 mb-2">Insert link</p>
                <div className="flex gap-2">
                  <Input
                    value={linkUrl}
                    onChange={(e) => setLinkUrl(e.target.value)}
                    placeholder="https://..."
                    className="h-8 text-sm flex-1"
                    autoFocus
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault()
                        if (linkUrl) editor.chain().focus().setLink({ href: linkUrl }).run()
                        setLinkPopoverOpen(false)
                        setLinkUrl("")
                      }
                      if (e.key === "Escape") { setLinkPopoverOpen(false); setLinkUrl("") }
                    }}
                  />
                  <Button
                    size="sm"
                    className="h-8 px-3 text-xs"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      if (linkUrl) editor.chain().focus().setLink({ href: linkUrl }).run()
                      setLinkPopoverOpen(false)
                      setLinkUrl("")
                    }}
                  >
                    Set link
                  </Button>
                </div>
              </PopoverContent>
            </Popover>
          </>
        )}

        {/* Right side — always visible */}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-sm text-zinc-500 tabular-nums">
            {wordCount.toLocaleString()} words
          </span>
          <SaveStatusLabel status={saveStatus} />
          {!isReadOnly && (
            <button
              type="button"
              title="Find & Replace (Cmd+H)"
              onMouseDown={(e) => { e.preventDefault(); setFindReplaceOpen((v) => !v) }}
              className={cn(
                "rounded p-1.5 transition-colors",
                findReplaceOpen ? "bg-indigo-100 text-indigo-700" : "text-zinc-500 hover:bg-zinc-100"
              )}
            >
              <Search className="size-4" />
            </button>
          )}
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

      {/* ── Table tools contextual bar — appears only when inside a table ──── */}
      {!isReadOnly && editor && isInTable && (
        <div className="flex items-center gap-1.5 px-1 py-1 bg-zinc-50 border border-zinc-200 rounded-md text-xs">
          <span className="text-zinc-500 font-medium mr-1">Table:</span>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addRowAfter().run() }}
            className="rounded px-2 py-0.5 bg-white border border-zinc-200 hover:bg-zinc-100 text-zinc-700 h-7"
            title="Add row"
          >
            +Row
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteRow().run() }}
            className="rounded px-2 py-0.5 bg-white border border-zinc-200 hover:bg-zinc-100 text-zinc-700 h-7"
            title="Delete row"
          >
            -Row
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().addColumnAfter().run() }}
            className="rounded px-2 py-0.5 bg-white border border-zinc-200 hover:bg-zinc-100 text-zinc-700 h-7"
            title="Add column"
          >
            +Col
          </button>
          <button
            type="button"
            onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteColumn().run() }}
            className="rounded px-2 py-0.5 bg-white border border-zinc-200 hover:bg-zinc-100 text-zinc-700 h-7"
            title="Delete column"
          >
            -Col
          </button>
        </div>
      )}

      {/* Editor body */}
      <div className="grid grid-cols-12 gap-4">
        <div className={cn(
          showVariablesPanel ? "col-span-9" : "col-span-12",
          pageLayout && "flex justify-center bg-zinc-100 rounded-md p-6 min-h-[600px]"
        )}>
          <div
            className={cn(
              "bg-white",
              pageLayout
                ? "w-[794px] min-h-[1123px] shadow-lg p-[72px] border border-zinc-200"
                : "rounded-md border border-zinc-200 p-4 min-h-[400px]"
            )}
          >
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

            {/* ── Search highlight CSS ──────────────────────────────────── */}
            <style>{`
              .tiptap .search-result { background-color: rgba(251, 191, 36, 0.4); border-radius: 2px; }
              .tiptap .search-result-current { background-color: rgba(251, 191, 36, 0.8); border-radius: 2px; outline: 2px solid rgba(245, 158, 11, 0.6); }
            `}</style>

            {/* ── Find & Replace panel ──────────────────────────────────── */}
            {findReplaceOpen && editor && (
              <FindReplacePanel
                editor={editor}
                onClose={() => {
                  setFindReplaceOpen(false)
                  editor.commands.setSearchTerm("")
                }}
              />
            )}
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

      {/* ── Floating selection toolbar (fixed position, viewport-relative) ─── */}
      {!isReadOnly && editor && (
        <FloatingSelectionToolbar editor={editor} onAddComment={onAddComment} />
      )}

      {/* ── Clause Snippets Sheet ────────────────────────────────────────────── */}
      {editor && (
        <Sheet open={snippetsPanelOpen} onOpenChange={setSnippetsPanelOpen}>
          <SheetContent side="right" className="w-[380px] sm:w-[420px] p-0 flex flex-col">
            <SheetHeader className="px-4 pt-4 pb-2 border-b border-border shrink-0">
              <SheetTitle className="text-sm font-semibold">Clause Snippets</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto min-h-0">
              <ClauseSnippetsPanel
                editor={editor}
                contractId={contractId}
                onClose={() => setSnippetsPanelOpen(false)}
              />
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  )
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ToolbarButton({
  active,
  onMouseDown,
  title,
  children,
  disabled,
}: {
  active?: boolean
  onMouseDown: React.MouseEventHandler<HTMLButtonElement>
  title?: string
  children: React.ReactNode
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={onMouseDown}
      disabled={disabled}
      className={cn(
        "h-8 w-8 inline-flex items-center justify-center rounded text-zinc-700 hover:bg-zinc-100",
        active && "bg-zinc-100 text-indigo-600",
        disabled && "opacity-40 cursor-not-allowed hover:bg-transparent",
      )}
    >
      {children}
    </button>
  )
}

function ToolbarDivider() {
  return <span className="w-px h-5 bg-zinc-200 mx-0.5" />
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
