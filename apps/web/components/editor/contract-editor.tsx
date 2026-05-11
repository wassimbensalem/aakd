"use client"

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Editor,
  Element as SlateElement,
  Node,
  Text,
  Transforms,
  type Descendant,
} from "slate"
import { HistoryEditor } from "slate-history"
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
// Plate v40 — imports from umbrella react entry
import {
  createPlateEditor,
  createPlatePlugin,
  Plate,
  PlateContent,
  type PlateEditor,
} from "@udecode/plate-common/react"
import {
  BoldPlugin,
  ItalicPlugin,
  UnderlinePlugin,
  StrikethroughPlugin,
} from "@udecode/plate-basic-marks/react"
import { HeadingPlugin } from "@udecode/plate-heading/react"
import {
  ListPlugin,
  BulletedListPlugin,
  NumberedListPlugin,
} from "@udecode/plate-list/react"
import { HorizontalRulePlugin } from "@udecode/plate-horizontal-rule/react"
import { TablePlugin } from "@udecode/plate-table/react"

// ─── Plate → Slate cast helper ────────────────────────────────────────────────
// PlateEditor wraps @udecode/slate's SlateEditor which has a stricter `apply`
// signature than Slate's BaseEditor. Cast is safe at runtime — PlateEditor IS
// a fully functional Slate editor.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function asSlate(e: PlateEditor): any { return e }

// ─── Node / leaf types ────────────────────────────────────────────────────────

type CustomElement = {
  type: string
  children: CustomDescendant[]
  variable?: string
  indent?: number
  align?: "left" | "center" | "right" | "justify"
  url?: string
  alt?: string
}
type CustomText = {
  text: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  fontSize?: string        // e.g. "12px", "14px"
  color?: string           // e.g. "#ef4444"
  highlight?: string       // background-color for text highlight
}
type CustomDescendant = CustomElement | CustomText

// ─── Empty doc ────────────────────────────────────────────────────────────────

export const EMPTY_DOC: Descendant[] = [
  { type: "p", children: [{ text: "" }] } as unknown as Descendant,
]

// ─── Mark helpers ─────────────────────────────────────────────────────────────

type FormatKey = "bold" | "italic" | "underline" | "strikethrough"

function isMarkActive(editor: PlateEditor, format: FormatKey): boolean {
  const marks = Editor.marks(asSlate(editor)) as Partial<Record<FormatKey, boolean>> | null
  return marks ? !!marks[format] : false
}

function toggleMark(editor: PlateEditor, format: FormatKey): void {
  const isActive = isMarkActive(editor, format)
  if (isActive) Editor.removeMark(asSlate(editor), format)
  else Editor.addMark(asSlate(editor), format, true)
}

// ─── Font size ────────────────────────────────────────────────────────────────

const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "32px"] as const

function getCurrentFontSize(editor: PlateEditor): string {
  const marks = Editor.marks(asSlate(editor)) as Partial<CustomText> | null
  return marks?.fontSize ?? "14px"
}

function setFontSize(editor: PlateEditor, size: string): void {
  Editor.addMark(asSlate(editor), "fontSize", size)
}

// ─── Text color ───────────────────────────────────────────────────────────────

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

function getCurrentColor(editor: PlateEditor): string {
  const marks = Editor.marks(asSlate(editor)) as Partial<CustomText> | null
  return marks?.color ?? ""
}

function setColor(editor: PlateEditor, color: string): void {
  if (color === "") Editor.removeMark(asSlate(editor), "color")
  else Editor.addMark(asSlate(editor), "color", color)
}

// ─── Highlight ────────────────────────────────────────────────────────────────

const HIGHLIGHT_COLORS = [
  { label: "None", value: "" },
  { label: "Yellow", value: "#fef08a" },
  { label: "Green", value: "#bbf7d0" },
  { label: "Blue", value: "#bfdbfe" },
  { label: "Pink", value: "#fbcfe8" },
  { label: "Orange", value: "#fed7aa" },
] as const

function getCurrentHighlight(editor: PlateEditor): string {
  const marks = Editor.marks(asSlate(editor)) as Partial<CustomText> | null
  return marks?.highlight ?? ""
}

function setHighlight(editor: PlateEditor, color: string): void {
  if (color === "") Editor.removeMark(asSlate(editor), "highlight")
  else Editor.addMark(asSlate(editor), "highlight", color)
}

// ─── Block helpers ────────────────────────────────────────────────────────────

function isBlockActive(editor: PlateEditor, type: string): boolean {
  const { selection } = editor
  if (!selection) return false
  const [match] = Array.from(
    Editor.nodes(asSlate(editor), {
      at: Editor.unhangRange(asSlate(editor), selection),
      match: (n) => SlateElement.isElement(n) && (n as unknown as CustomElement).type === type,
    }),
  )
  return !!match
}

const LIST_TYPES = new Set(["ol", "ul"])

function toggleBlock(editor: PlateEditor, type: string): void {
  const isActive = isBlockActive(editor, type)
  const isList = LIST_TYPES.has(type)

  Transforms.unwrapNodes(asSlate(editor), {
    match: (n) => SlateElement.isElement(n) && LIST_TYPES.has((n as unknown as CustomElement).type),
    split: true,
  })

  const newType = isActive ? "p" : isList ? "li" : type
  Transforms.setNodes(asSlate(editor), { type: newType } as Partial<SlateElement>, {
    match: (n) => SlateElement.isElement(n),
  })

  if (!isActive && isList) {
    Transforms.wrapNodes(asSlate(editor), { type, children: [] } as unknown as SlateElement)
  }
}

// ─── Alignment ────────────────────────────────────────────────────────────────

function getCurrentAlignment(editor: PlateEditor): string {
  const { selection } = editor
  if (!selection) return "left"
  const [match] = Array.from(
    Editor.nodes(asSlate(editor), {
      at: Editor.unhangRange(asSlate(editor), selection),
      match: (n) => SlateElement.isElement(n),
    }),
  )
  return (match?.[0] as unknown as CustomElement)?.align ?? "left"
}

function setAlignment(editor: PlateEditor, align: "left" | "center" | "right" | "justify"): void {
  const current = getCurrentAlignment(editor)
  Transforms.setNodes(
    asSlate(editor),
    { align: current === align ? undefined : align } as Partial<SlateElement>,
    { match: (n) => SlateElement.isElement(n) },
  )
}

// ─── Indent ───────────────────────────────────────────────────────────────────

const TABLE_TYPES = new Set(["table", "tr", "td", "th"])

function indentBlock(editor: PlateEditor): void {
  const { selection } = editor
  if (!selection) return
  const [match] = Array.from(Editor.nodes(asSlate(editor), {
    match: (n) => SlateElement.isElement(n) && !TABLE_TYPES.has((n as unknown as CustomElement).type),
  }))
  if (!match) return
  const cur = (match[0] as unknown as CustomElement).indent ?? 0
  Transforms.setNodes(asSlate(editor), { indent: Math.min(cur + 1, 8) } as Partial<SlateElement>, {
    match: (n) => SlateElement.isElement(n) && !TABLE_TYPES.has((n as unknown as CustomElement).type),
  })
}

function outdentBlock(editor: PlateEditor): void {
  const { selection } = editor
  if (!selection) return
  const [match] = Array.from(Editor.nodes(asSlate(editor), {
    match: (n) => SlateElement.isElement(n) && !TABLE_TYPES.has((n as unknown as CustomElement).type),
  }))
  if (!match) return
  const cur = (match[0] as unknown as CustomElement).indent ?? 0
  if (cur <= 0) return
  const next = cur <= 1 ? undefined : cur - 1
  Transforms.setNodes(asSlate(editor), { indent: next } as Partial<SlateElement>, {
    match: (n) => SlateElement.isElement(n) && !TABLE_TYPES.has((n as unknown as CustomElement).type),
  })
}

// ─── Table helpers ────────────────────────────────────────────────────────────

function insertHorizontalRule(editor: PlateEditor): void {
  Transforms.insertNodes(asSlate(editor), [
    { type: "hr", children: [{ text: "" }] } as unknown as SlateElement,
    { type: "p", children: [{ text: "" }] } as unknown as SlateElement,
  ])
}

function insertSimpleTable(editor: PlateEditor): void {
  const cell = (text = ""): SlateElement =>
    ({
      type: "td",
      children: [{ type: "p", children: [{ text }] }],
    }) as unknown as SlateElement
  const row = (): SlateElement =>
    ({
      type: "tr",
      children: [cell(), cell()],
    }) as unknown as SlateElement
  const table: SlateElement = {
    type: "table",
    children: [row(), row()],
  } as unknown as SlateElement
  Transforms.insertNodes(asSlate(editor), table)
}

function addTableRow(editor: PlateEditor, tablePath: number[]): void {
  const table = Node.get(asSlate(editor), tablePath) as unknown as CustomElement
  const colCount = (table.children[0] as unknown as CustomElement).children.length
  const newRow: SlateElement = {
    type: "tr",
    children: Array.from({ length: colCount }, () => ({
      type: "td",
      children: [{ type: "p", children: [{ text: "" }] }],
    })),
  } as unknown as SlateElement
  Transforms.insertNodes(asSlate(editor), newRow, { at: [...tablePath, table.children.length] })
}

function removeTableRow(editor: PlateEditor, tablePath: number[]): void {
  const table = Node.get(asSlate(editor), tablePath) as unknown as CustomElement
  if (table.children.length <= 1) return
  Transforms.removeNodes(asSlate(editor), { at: [...tablePath, table.children.length - 1] })
}

function addTableCol(editor: PlateEditor, tablePath: number[]): void {
  const table = Node.get(asSlate(editor), tablePath) as unknown as CustomElement
  table.children.forEach((_, rowIdx) => {
    Transforms.insertNodes(
      asSlate(editor),
      { type: "td", children: [{ type: "p", children: [{ text: "" }] }] } as unknown as SlateElement,
      { at: [...tablePath, rowIdx, (table.children[rowIdx] as unknown as CustomElement).children.length] },
    )
  })
}

function removeTableCol(editor: PlateEditor, tablePath: number[]): void {
  const table = Node.get(asSlate(editor), tablePath) as unknown as CustomElement
  const colCount = (table.children[0] as unknown as CustomElement).children.length
  if (colCount <= 1) return
  ;[...table.children].reverse().forEach((_, i) => {
    const rowIdx = table.children.length - 1 - i
    Transforms.removeNodes(asSlate(editor), { at: [...tablePath, rowIdx, colCount - 1] })
  })
}

// ─── Variable / image helpers ─────────────────────────────────────────────────

function insertVariableNode(editor: PlateEditor, name: string): void {
  if (!name) return
  const node: SlateElement = {
    type: "template_variable",
    variable: name,
    children: [{ text: "" }],
  } as unknown as SlateElement
  Transforms.insertNodes(asSlate(editor), node)
  Transforms.move(asSlate(editor), { unit: "offset" })
}

async function insertImageNode(editor: PlateEditor, contractId: string, file: File): Promise<void> {
  const fd = new FormData()
  fd.append("file", file)
  const res = await fetch(`/api/contracts/${contractId}/document/image`, { method: "POST", body: fd })
  if (!res.ok) throw new Error("Upload failed")
  const { url } = await res.json()
  const node: SlateElement = {
    type: "image",
    url,
    alt: file.name,
    children: [{ text: "" }],
  } as unknown as SlateElement
  Transforms.insertNodes(asSlate(editor), node)
  Transforms.insertNodes(asSlate(editor), { type: "p", children: [{ text: "" }] } as unknown as SlateElement)
}

// ─── Link helper ──────────────────────────────────────────────────────────────

function insertOrWrapLink(editor: PlateEditor): void {
  const { selection } = editor
  if (!selection) return
  const url = window.prompt("Enter URL:")
  if (!url) return
  const isCollapsed = selection && selection.anchor.offset === selection.focus.offset
    && selection.anchor.path.toString() === selection.focus.path.toString()
  if (isCollapsed) {
    Transforms.insertNodes(asSlate(editor), {
      type: "a",
      url,
      children: [{ text: url }],
    } as unknown as SlateElement)
  } else {
    Transforms.wrapNodes(
      asSlate(editor),
      { type: "a", url, children: [] } as unknown as SlateElement,
      { split: true },
    )
    Transforms.collapse(asSlate(editor), { edge: "end" })
  }
}

// ─── Undo / Redo ──────────────────────────────────────────────────────────────

// createPlateEditor always includes HistoryPlugin — undo/redo are available.
function undoEditor(editor: PlateEditor): void {
  HistoryEditor.undo(editor as unknown as HistoryEditor)
}

function redoEditor(editor: PlateEditor): void {
  HistoryEditor.redo(editor as unknown as HistoryEditor)
}

// ─── Render functions ─────────────────────────────────────────────────────────

function VariableChip({ name }: { name: string }) {
  return (
    <span
      contentEditable={false}
      className="bg-indigo-100 text-indigo-800 text-sm font-medium px-2 py-0.5 rounded inline-flex items-center"
    >
      {`{{${name}}}`}
    </span>
  )
}

function renderElement(
  props: { attributes: React.HTMLAttributes<HTMLElement>; children: React.ReactNode; element: unknown },
  editor: PlateEditor,
  activeTablePath: number[] | null,
): React.ReactElement {
  const { attributes, children, element } = props
  const el = element as CustomElement
  const indentStyle = el.indent ? { marginLeft: `${(el.indent - 1) * 24}px` } : undefined
  const alignStyle = el.align ? { textAlign: el.align as React.CSSProperties["textAlign"] } : undefined

  switch (el.type) {
    case "h1":
      return <h1 {...attributes} className="text-2xl font-bold mt-4 mb-2" style={alignStyle}>{children}</h1>
    case "h2":
      return <h2 {...attributes} className="text-xl font-bold mt-3 mb-2" style={alignStyle}>{children}</h2>
    case "h3":
      return <h3 {...attributes} className="text-lg font-bold mt-3 mb-1.5" style={alignStyle}>{children}</h3>
    case "ol":
      return <ol {...attributes} className="list-decimal pl-6 my-2" style={{ ...indentStyle, ...alignStyle }}>{children}</ol>
    case "ul":
      return <ul {...attributes} className="list-disc pl-6 my-2" style={{ ...indentStyle, ...alignStyle }}>{children}</ul>
    case "li":
      return <li {...attributes} className="my-1" style={alignStyle}>{children}</li>
    case "table":
      return (
        <div {...attributes} className="my-3">
          {activeTablePath && (
            <div contentEditable={false} className="flex items-center gap-1 mb-1">
              <button type="button" onClick={() => addTableRow(editor, activeTablePath)}
                className="rounded px-2 py-0.5 text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-700">+ Row</button>
              <button type="button" onClick={() => removeTableRow(editor, activeTablePath)}
                className="rounded px-2 py-0.5 text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-700">− Row</button>
              <button type="button" onClick={() => addTableCol(editor, activeTablePath)}
                className="rounded px-2 py-0.5 text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-700">+ Col</button>
              <button type="button" onClick={() => removeTableCol(editor, activeTablePath)}
                className="rounded px-2 py-0.5 text-xs bg-zinc-100 hover:bg-zinc-200 text-zinc-700">− Col</button>
            </div>
          )}
          <table className="border border-zinc-300 w-full">
            <tbody>{children}</tbody>
          </table>
        </div>
      )
    case "tr":
      return <tr {...attributes}>{children}</tr>
    case "td":
      return <td {...attributes} className="border border-zinc-300 px-2 py-1.5 align-top">{children}</td>
    case "th":
      return <th {...attributes} className="border border-zinc-300 px-2 py-1.5 align-top font-semibold bg-zinc-50">{children}</th>
    case "hr":
      return <div {...attributes} contentEditable={false} className="my-4 border-t border-zinc-300">{children}</div>
    case "a": {
      const href = el.url ?? "#"
      return (
        <a
          {...attributes}
          href={href}
          className="text-indigo-600 underline hover:text-indigo-800"
          onClick={(e) => {
            if (e.metaKey || e.ctrlKey) {
              window.open(href, "_blank", "noopener,noreferrer")
            }
          }}
        >
          {children}
        </a>
      )
    }
    case "image": {
      const src = el.url ?? ""
      const alt = el.alt ?? ""
      return (
        <div {...attributes} contentEditable={false} className="my-3 flex justify-start">
          {children}
          {src
            ? <img src={src} alt={alt} className="max-w-full rounded border border-zinc-200" style={{ maxHeight: 400 }} />
            : <div className="flex items-center justify-center w-full h-24 bg-zinc-50 border border-dashed border-zinc-300 rounded text-sm text-zinc-400">Image not found</div>
          }
        </div>
      )
    }
    case "template_variable":
      return (
        <span {...attributes}>
          <VariableChip name={el.variable ?? ""} />
          {children}
        </span>
      )
    case "p":
    default:
      return <p {...attributes} className="my-2 leading-6" style={alignStyle}>{children}</p>
  }
}

function renderLeaf(
  props: { attributes: React.HTMLAttributes<HTMLElement>; children: React.ReactNode; leaf: unknown },
): React.ReactElement {
  const { attributes, children, leaf } = props
  let el: React.ReactNode = children
  const t = leaf as CustomText
  if (t.bold) el = <strong>{el}</strong>
  if (t.italic) el = <em>{el}</em>
  if (t.underline) el = <u>{el}</u>
  if (t.strikethrough) el = <s>{el}</s>
  const style: React.CSSProperties = {}
  if (t.fontSize) style.fontSize = t.fontSize
  if (t.color) style.color = t.color
  if (t.highlight) style.backgroundColor = t.highlight
  return <span {...attributes} style={Object.keys(style).length ? style : undefined}>{el}</span>
}

// ─── Word count ───────────────────────────────────────────────────────────────

function countDescendantWords(nodes: Descendant[]): number {
  let buf = ""
  function walk(n: Descendant): void {
    if (Text.isText(n)) {
      buf += " " + n.text
      return
    }
    if (SlateElement.isElement(n)) {
      const el = n as unknown as CustomElement
      if (el.type === "template_variable") {
        buf += ` {{${el.variable ?? ""}}} `
        return
      }
      for (const c of el.children) walk(c as Descendant)
    }
  }
  for (const n of nodes) walk(n)
  return buf.split(/\s+/).filter(Boolean).length
}

// ─── Plugin that marks template_variable + image as inline/void ───────────────

const TemplateVariablePlugin = createPlatePlugin({
  key: "template_variable",
  node: { isElement: true, isInline: true, isVoid: true },
})

const ImagePlugin = createPlatePlugin({
  key: "image",
  node: { isElement: true, isVoid: true },
})

const LinkNodePlugin = createPlatePlugin({
  key: "a",
  node: { isElement: true, isInline: true },
})

// ─── Props interface ──────────────────────────────────────────────────────────

export interface ContractEditorProps {
  contractId?: string
  initialContent: Descendant[]
  initialVersion: number
  readOnly?: boolean
  readOnlyReason?: string
  showVariablesPanel?: boolean
  variables?: { name: string; label?: string; required?: boolean }[]
  onChange?: (value: Descendant[], wordCount: number) => void
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
  const editor = useMemo<PlateEditor>(() => {
    return createPlateEditor({
      plugins: [
        // Basic marks
        BoldPlugin,
        ItalicPlugin,
        UnderlinePlugin,
        StrikethroughPlugin,
        // Block elements
        HeadingPlugin.configure({ options: { levels: [1, 2, 3] } }),
        ListPlugin,
        BulletedListPlugin,
        NumberedListPlugin,
        HorizontalRulePlugin,
        TablePlugin,
        // Custom inline / void nodes
        TemplateVariablePlugin,
        ImagePlugin,
        LinkNodePlugin,
      ],
      value: (initialContent.length > 0 ? initialContent : EMPTY_DOC) as never,
    })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const [value, setValue] = useState<Descendant[]>(
    initialContent.length > 0 ? initialContent : EMPTY_DOC,
  )
  const [version, setVersion] = useState<number>(initialVersion)
  const pendingSaveRef = useRef(false)
  const pendingRetryRef = useRef(false)
  const [isReadOnly, setIsReadOnly] = useState(readOnly)
  const [saveStatus, setSaveStatus] = useState<
    "idle" | "saved" | "unsaved" | "saving" | "conflict" | "error"
  >(initialVersion > 0 ? "saved" : "idle")
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const valueRef = useRef<Descendant[]>(value)
  valueRef.current = value
  const versionRef = useRef<number>(version)
  versionRef.current = version
  const [activeTablePath, setActiveTablePath] = useState<number[] | null>(null)
  const [pageLayout, setPageLayout] = useState(false)

  useEffect(() => {
    setIsReadOnly(readOnly)
  }, [readOnly])

  const wordCount = useMemo(() => countDescendantWords(value), [value])

  const triggerSave = useCallback(async () => {
    if (!contractId || !enableAutoSave) return
    if (pendingSaveRef.current) { pendingRetryRef.current = true; return }
    if (isReadOnly) return
    pendingSaveRef.current = true
    setSaveStatus("saving")
    try {
      const res = await fetch(`/api/contracts/${contractId}/document`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: valueRef.current,
          wordCount: countDescendantWords(valueRef.current),
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
        if (body.error === "read_only_status") {
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
      if (body.document?.version) {
        setVersion(body.document.version)
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
        triggerSave()
      }
    }
  }, [contractId, enableAutoSave, isReadOnly])

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current)
    }
  }, [])

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

  // Plate v40 onChange receives { editor, value } — we extract the value.
  const handleChange = useCallback(
    ({ editor: _ed, value: next }: { editor: PlateEditor; value: Descendant[] }) => {
      setValue(next)
      onChange?.(next, countDescendantWords(next))

      const isAstChange = _ed.operations.some((op) => op.type !== "set_selection")
      if (!isAstChange) return
      if (isReadOnly) return

      setSaveStatus("unsaved")
      if (saveTimer.current) clearTimeout(saveTimer.current)
      if (enableAutoSave && contractId) {
        saveTimer.current = setTimeout(() => {
          triggerSave()
        }, 3_000)
      }
    },
    [onChange, isReadOnly, enableAutoSave, contractId, triggerSave],
  )

  const handleBlur = useCallback(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current)
    if (enableAutoSave && contractId && !isReadOnly && saveStatus === "unsaved") {
      triggerSave()
    }
  }, [enableAutoSave, contractId, isReadOnly, saveStatus, triggerSave])

  const onKeyDown: React.KeyboardEventHandler<HTMLDivElement> = useCallback(
    (e) => {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey) {
        if (e.key === "b") { e.preventDefault(); toggleMark(editor, "bold"); return }
        if (e.key === "i") { e.preventDefault(); toggleMark(editor, "italic"); return }
        if (e.key === "u") { e.preventDefault(); toggleMark(editor, "underline"); return }
        if (e.key === "s") { e.preventDefault(); triggerSave(); return }
        if (e.key === "z") { e.preventDefault(); undoEditor(editor); return }
        if (e.key === "k") { e.preventDefault(); insertOrWrapLink(editor); return }
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        if (e.key === "s" || e.key === "S") { e.preventDefault(); toggleMark(editor, "strikethrough"); return }
        if (e.key === "z" || e.key === "Z") { e.preventDefault(); redoEditor(editor); return }
      }
    },
    [editor, triggerSave],
  )

  const renderElementFn = useCallback(
    (props: { attributes: React.HTMLAttributes<HTMLElement>; children: React.ReactNode; element: unknown }) =>
      renderElement(props, editor, activeTablePath),
    [editor, activeTablePath],
  )

  const renderLeafFn = useCallback(
    (props: { attributes: React.HTMLAttributes<HTMLElement>; children: React.ReactNode; leaf: unknown }) =>
      renderLeaf(props),
    [],
  )

  // Heading value for the select dropdown — recomputed on selection/value change
  const headingValue = useMemo(() => {
    if (isBlockActive(editor, "h1")) return "h1"
    if (isBlockActive(editor, "h2")) return "h2"
    if (isBlockActive(editor, "h3")) return "h3"
    return "p"
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.selection, value])

  return (
    <div className="flex flex-col gap-3">
      {isReadOnly && readOnlyReason && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded text-sm">
          {readOnlyReason}
        </div>
      )}

      <Plate
        editor={editor}
        onChange={handleChange}
        readOnly={isReadOnly}
      >
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 pb-2">
          {!isReadOnly && (
            <>
              {/* Undo / Redo */}
              <ToolbarButton
                onMouseDown={(e) => { e.preventDefault(); undoEditor(editor) }}
                title="Undo (Cmd+Z)"
              >
                <Undo className="size-4" />
              </ToolbarButton>
              <ToolbarButton
                onMouseDown={(e) => { e.preventDefault(); redoEditor(editor) }}
                title="Redo (Cmd+Shift+Z)"
              >
                <Redo className="size-4" />
              </ToolbarButton>

              <span className="w-px h-5 bg-zinc-200 mx-1" />

              {/* Heading */}
              <Select
                value={headingValue}
                onValueChange={(v) => v && toggleBlock(editor, v)}
              >
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
                value={getCurrentFontSize(editor)}
                onValueChange={(v) => { if (v) setFontSize(editor, v) }}
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
                value={getCurrentColor(editor)}
                onValueChange={(v) => setColor(editor, v ?? "")}
              >
                <SelectTrigger className="h-8 w-8 p-0 flex items-center justify-center border-zinc-200">
                  <div
                    className="size-4 rounded-sm border border-zinc-300"
                    style={{ backgroundColor: getCurrentColor(editor) || "#000000" }}
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
                value={getCurrentHighlight(editor)}
                onValueChange={(v) => setHighlight(editor, v ?? "")}
              >
                <SelectTrigger className="h-8 w-8 p-0 flex items-center justify-center border-zinc-200">
                  <div
                    className="size-4 rounded-sm border border-zinc-300 flex items-center justify-center"
                    style={{ backgroundColor: getCurrentHighlight(editor) || "transparent" }}
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
                active={isMarkActive(editor, "bold")}
                onMouseDown={(e) => { e.preventDefault(); toggleMark(editor, "bold") }}
                title="Bold (Cmd+B)"
              >
                <Bold className="size-4" />
              </ToolbarButton>
              <ToolbarButton
                active={isMarkActive(editor, "italic")}
                onMouseDown={(e) => { e.preventDefault(); toggleMark(editor, "italic") }}
                title="Italic (Cmd+I)"
              >
                <Italic className="size-4" />
              </ToolbarButton>
              <ToolbarButton
                active={isMarkActive(editor, "underline")}
                onMouseDown={(e) => { e.preventDefault(); toggleMark(editor, "underline") }}
                title="Underline (Cmd+U)"
              >
                <UnderlineIcon className="size-4" />
              </ToolbarButton>
              <ToolbarButton
                active={isMarkActive(editor, "strikethrough")}
                onMouseDown={(e) => { e.preventDefault(); toggleMark(editor, "strikethrough") }}
                title="Strikethrough (Cmd+Shift+S)"
              >
                <Strikethrough className="size-4" />
              </ToolbarButton>

              <span className="w-px h-5 bg-zinc-200 mx-1" />

              {/* Link */}
              <ToolbarButton
                onMouseDown={(e) => { e.preventDefault(); insertOrWrapLink(editor) }}
                title="Insert link (Cmd+K)"
              >
                <LinkIcon className="size-4" />
              </ToolbarButton>

              <span className="w-px h-5 bg-zinc-200 mx-1" />

              {/* Alignment */}
              <ToolbarButton
                active={getCurrentAlignment(editor) === "left"}
                onMouseDown={(e) => { e.preventDefault(); setAlignment(editor, "left") }}
                title="Align left"
              ><AlignLeft className="size-4" /></ToolbarButton>
              <ToolbarButton
                active={getCurrentAlignment(editor) === "center"}
                onMouseDown={(e) => { e.preventDefault(); setAlignment(editor, "center") }}
                title="Align center"
              ><AlignCenter className="size-4" /></ToolbarButton>
              <ToolbarButton
                active={getCurrentAlignment(editor) === "right"}
                onMouseDown={(e) => { e.preventDefault(); setAlignment(editor, "right") }}
                title="Align right"
              ><AlignRight className="size-4" /></ToolbarButton>
              <ToolbarButton
                active={getCurrentAlignment(editor) === "justify"}
                onMouseDown={(e) => { e.preventDefault(); setAlignment(editor, "justify") }}
                title="Justify"
              ><AlignJustify className="size-4" /></ToolbarButton>

              <span className="w-px h-5 bg-zinc-200 mx-1" />

              {/* Indent */}
              <ToolbarButton
                onMouseDown={(e) => { e.preventDefault(); indentBlock(editor) }}
                title="Indent"
              ><Indent className="size-4" /></ToolbarButton>
              <ToolbarButton
                onMouseDown={(e) => { e.preventDefault(); outdentBlock(editor) }}
                title="Outdent"
              ><Outdent className="size-4" /></ToolbarButton>

              <span className="w-px h-5 bg-zinc-200 mx-1" />

              {/* Lists */}
              <ToolbarButton
                active={isBlockActive(editor, "ol")}
                onMouseDown={(e) => { e.preventDefault(); toggleBlock(editor, "ol") }}
                title="Ordered list"
              >
                <ListOrdered className="size-4" />
              </ToolbarButton>
              <ToolbarButton
                active={isBlockActive(editor, "ul")}
                onMouseDown={(e) => { e.preventDefault(); toggleBlock(editor, "ul") }}
                title="Bulleted list"
              >
                <List className="size-4" />
              </ToolbarButton>

              <span className="w-px h-5 bg-zinc-200 mx-1" />

              {/* Table / HR / Image */}
              <ToolbarButton
                onMouseDown={(e) => { e.preventDefault(); insertSimpleTable(editor) }}
                title="Insert table"
              >
                <TableIcon className="size-4" />
              </ToolbarButton>
              <ToolbarButton
                onMouseDown={(e) => { e.preventDefault(); insertHorizontalRule(editor) }}
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
                      await insertImageNode(editor, contractId, file)
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

          {/* Right side */}
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
              {value.length === 0 && !isReadOnly && (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <FileText className="size-10 text-zinc-300" />
                  <p className="text-sm text-zinc-500">
                    Start writing your contract, or import a Word document.
                  </p>
                </div>
              )}
              <PlateContent
                readOnly={isReadOnly}
                renderElement={renderElementFn as never}
                renderLeaf={renderLeafFn as never}
                onKeyDown={onKeyDown}
                onBlur={handleBlur}
                onClick={() => {
                  const { selection } = editor
                  if (!selection) { setActiveTablePath(null); return }
                  const [tableEntry] = Array.from(Editor.nodes(asSlate(editor), {
                    match: (n) => SlateElement.isElement(n) && (n as unknown as CustomElement).type === "table",
                  }))
                  setActiveTablePath(tableEntry ? [...tableEntry[1]] : null)
                }}
                spellCheck
                placeholder={isReadOnly ? undefined : "Start writing…"}
                className="outline-none min-h-[400px] text-sm text-zinc-900"
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
                      insertVariableNode(editor, v.name)
                    }}
                  >
                    Insert
                  </Button>
                </div>
              ))}
            </div>
          )}
        </div>
      </Plate>
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
