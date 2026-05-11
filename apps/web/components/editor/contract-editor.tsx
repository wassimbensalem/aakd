"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createEditor, Editor, Element as SlateElement, Node, Range, Text, Transforms, type Descendant, type BaseEditor, type NodeEntry } from "slate"
import { Slate, Editable, withReact, type ReactEditor, type RenderElementProps, type RenderLeafProps } from "slate-react"
import { withHistory, type HistoryEditor } from "slate-history"
import { toast } from "sonner"
import {
  Bold, Italic, Underline as UnderlineIcon, Strikethrough,
  List, ListOrdered, Minus, Table as TableIcon, FileText, Heading1, Heading2, Heading3,
  AlignLeft, AlignCenter, AlignRight, AlignJustify,
  Indent, Outdent, LayoutTemplate, Image as ImageIcon,
} from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select"

type CustomEditor = BaseEditor & ReactEditor & HistoryEditor

// We do not augment Slate's module declaration globally to avoid colliding with
// future editors. Instead, we cast as needed at the call site.
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
  fontSize?: string        // e.g. "12px", "14px", "18px", "24px"
  color?: string           // e.g. "#ef4444", "#3b82f6"
}
type CustomDescendant = CustomElement | CustomText

// Slate editor defaults to a single empty paragraph if no content provided
export const EMPTY_DOC: Descendant[] = [
  { type: "p", children: [{ text: "" }] } as unknown as Descendant,
]

type FormatKey = "bold" | "italic" | "underline" | "strikethrough"

function isMarkActive(editor: Editor, format: FormatKey): boolean {
  const marks = Editor.marks(editor) as Partial<Record<FormatKey, boolean>> | null
  return marks ? !!marks[format] : false
}

function toggleMark(editor: Editor, format: FormatKey): void {
  const isActive = isMarkActive(editor, format)
  if (isActive) Editor.removeMark(editor, format)
  else Editor.addMark(editor, format, true)
}

const FONT_SIZES = ["12px", "14px", "16px", "18px", "20px", "24px", "32px"] as const

function getCurrentFontSize(editor: Editor): string {
  const marks = Editor.marks(editor) as Partial<CustomText> | null
  return marks?.fontSize ?? "14px"
}

function setFontSize(editor: Editor, size: string): void {
  Editor.addMark(editor, "fontSize", size)
}

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

function getCurrentColor(editor: Editor): string {
  const marks = Editor.marks(editor) as Partial<CustomText> | null
  return marks?.color ?? ""
}

function setColor(editor: Editor, color: string): void {
  if (color === "") {
    Editor.removeMark(editor, "color")
  } else {
    Editor.addMark(editor, "color", color)
  }
}

function isBlockActive(editor: Editor, type: string): boolean {
  const { selection } = editor
  if (!selection) return false
  const [match] = Array.from(
    Editor.nodes(editor, {
      at: Editor.unhangRange(editor, selection),
      match: (n) => SlateElement.isElement(n) && (n as CustomElement).type === type,
    }),
  )
  return !!match
}

const LIST_TYPES = new Set(["ol", "ul"])

function toggleBlock(editor: Editor, type: string): void {
  const isActive = isBlockActive(editor, type)
  const isList = LIST_TYPES.has(type)

  Transforms.unwrapNodes(editor, {
    match: (n) => SlateElement.isElement(n) && LIST_TYPES.has((n as CustomElement).type),
    split: true,
  })

  const newType = isActive ? "p" : isList ? "li" : type
  Transforms.setNodes(editor, { type: newType } as Partial<SlateElement>, {
    match: (n) => SlateElement.isElement(n),
  })

  if (!isActive && isList) {
    Transforms.wrapNodes(editor, { type, children: [] } as unknown as SlateElement)
  }
}

function getCurrentAlignment(editor: Editor): string {
  const { selection } = editor
  if (!selection) return "left"
  const [match] = Array.from(
    Editor.nodes(editor, {
      at: Editor.unhangRange(editor, selection),
      match: (n) => SlateElement.isElement(n),
    }),
  )
  return (match?.[0] as unknown as CustomElement)?.align ?? "left"
}

function setAlignment(editor: Editor, align: "left" | "center" | "right" | "justify"): void {
  const current = getCurrentAlignment(editor)
  Transforms.setNodes(
    editor,
    { align: current === align ? undefined : align } as Partial<SlateElement>,
    { match: (n) => SlateElement.isElement(n) },
  )
}

const TABLE_TYPES = new Set(["table", "tr", "td", "th"])

function indentBlock(editor: Editor): void {
  const { selection } = editor
  if (!selection) return
  const [match] = Array.from(Editor.nodes(editor, {
    match: (n) => SlateElement.isElement(n) && !TABLE_TYPES.has((n as unknown as CustomElement).type),
  }))
  if (!match) return
  const cur = (match[0] as unknown as CustomElement).indent ?? 0
  Transforms.setNodes(editor, { indent: Math.min(cur + 1, 8) } as Partial<SlateElement>, {
    match: (n) => SlateElement.isElement(n) && !TABLE_TYPES.has((n as unknown as CustomElement).type),
  })
}

function outdentBlock(editor: Editor): void {
  const { selection } = editor
  if (!selection) return
  const [match] = Array.from(Editor.nodes(editor, {
    match: (n) => SlateElement.isElement(n) && !TABLE_TYPES.has((n as unknown as CustomElement).type),
  }))
  if (!match) return
  const cur = (match[0] as unknown as CustomElement).indent ?? 0
  if (cur <= 0) return
  const next = cur <= 1 ? undefined : cur - 1
  Transforms.setNodes(editor, { indent: next } as Partial<SlateElement>, {
    match: (n) => SlateElement.isElement(n) && !TABLE_TYPES.has((n as unknown as CustomElement).type),
  })
}

function insertHorizontalRule(editor: Editor): void {
  Transforms.insertNodes(editor, [
    { type: "hr", children: [{ text: "" }] } as unknown as SlateElement,
    { type: "p", children: [{ text: "" }] } as unknown as SlateElement,
  ])
}

function insertSimpleTable(editor: Editor): void {
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
  Transforms.insertNodes(editor, table)
}

function addTableRow(editor: Editor, tablePath: number[]): void {
  const table = Node.get(editor, tablePath) as unknown as CustomElement
  const colCount = (table.children[0] as unknown as CustomElement).children.length
  const newRow: SlateElement = {
    type: "tr",
    children: Array.from({ length: colCount }, () => ({
      type: "td",
      children: [{ type: "p", children: [{ text: "" }] }],
    })),
  } as unknown as SlateElement
  Transforms.insertNodes(editor, newRow, { at: [...tablePath, table.children.length] })
}

function removeTableRow(editor: Editor, tablePath: number[]): void {
  const table = Node.get(editor, tablePath) as unknown as CustomElement
  if (table.children.length <= 1) return
  Transforms.removeNodes(editor, { at: [...tablePath, table.children.length - 1] })
}

function addTableCol(editor: Editor, tablePath: number[]): void {
  const table = Node.get(editor, tablePath) as unknown as CustomElement
  table.children.forEach((_, rowIdx) => {
    Transforms.insertNodes(
      editor,
      { type: "td", children: [{ type: "p", children: [{ text: "" }] }] } as unknown as SlateElement,
      { at: [...tablePath, rowIdx, (table.children[rowIdx] as unknown as CustomElement).children.length] },
    )
  })
}

function removeTableCol(editor: Editor, tablePath: number[]): void {
  const table = Node.get(editor, tablePath) as unknown as CustomElement
  const colCount = (table.children[0] as unknown as CustomElement).children.length
  if (colCount <= 1) return
  ;[...table.children].reverse().forEach((_, i) => {
    const rowIdx = table.children.length - 1 - i
    Transforms.removeNodes(editor, { at: [...tablePath, rowIdx, colCount - 1] })
  })
}

function insertVariableNode(editor: Editor, name: string): void {
  if (!name) return
  const node: SlateElement = {
    type: "template_variable",
    variable: name,
    children: [{ text: "" }],
  } as unknown as SlateElement
  Transforms.insertNodes(editor, node)
  // Move past the inserted void inline.
  Transforms.move(editor, { unit: "offset" })
}

async function insertImageNode(editor: Editor, contractId: string, file: File): Promise<void> {
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
  Transforms.insertNodes(editor, node)
  Transforms.insertNodes(editor, { type: "p", children: [{ text: "" }] } as unknown as SlateElement)
}

// ─── Renderers ────────────────────────────────────────────────────────────────

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

function renderElement(props: RenderElementProps): React.ReactElement {
  const { attributes, children, element } = props
  const el = element as unknown as CustomElement
  const indentStyle = el.indent ? { marginLeft: `${(el.indent - 1) * 24}px` } : undefined
  const alignStyle = el.align ? { textAlign: el.align as React.CSSProperties["textAlign"] } : undefined
  switch (el.type) {
    case "h1":
      return (
        <h1 {...attributes} className="text-2xl font-bold mt-4 mb-2" style={alignStyle}>
          {children}
        </h1>
      )
    case "h2":
      return (
        <h2 {...attributes} className="text-xl font-bold mt-3 mb-2" style={alignStyle}>
          {children}
        </h2>
      )
    case "h3":
      return (
        <h3 {...attributes} className="text-lg font-bold mt-3 mb-1.5" style={alignStyle}>
          {children}
        </h3>
      )
    case "ol":
      return (
        <ol {...attributes} className="list-decimal pl-6 my-2" style={{ ...indentStyle, ...alignStyle }}>
          {children}
        </ol>
      )
    case "ul":
      return (
        <ul {...attributes} className="list-disc pl-6 my-2" style={{ ...indentStyle, ...alignStyle }}>
          {children}
        </ul>
      )
    case "li":
      return (
        <li {...attributes} className="my-1" style={alignStyle}>
          {children}
        </li>
      )
    case "table":
      return (
        <table {...attributes} className="border border-zinc-300 my-3 w-full">
          <tbody>{children}</tbody>
        </table>
      )
    case "tr":
      return <tr {...attributes}>{children}</tr>
    case "td":
      return (
        <td {...attributes} className="border border-zinc-300 px-2 py-1.5 align-top">
          {children}
        </td>
      )
    case "th":
      return (
        <th {...attributes} className="border border-zinc-300 px-2 py-1.5 align-top font-semibold bg-zinc-50">
          {children}
        </th>
      )
    case "hr":
      return (
        <div {...attributes} contentEditable={false} className="my-4 border-t border-zinc-300">
          {children}
        </div>
      )
    case "template_variable":
      return (
        <span {...attributes}>
          <VariableChip name={el.variable ?? ""} />
          {children}
        </span>
      )
    case "p":
    default:
      return (
        <p {...attributes} className="my-2 leading-6" style={alignStyle}>
          {children}
        </p>
      )
  }
}

function renderLeaf(props: RenderLeafProps): React.ReactElement {
  const { attributes, children, leaf } = props
  let el: React.ReactNode = children
  const t = leaf as unknown as CustomText
  if (t.bold) el = <strong>{el}</strong>
  if (t.italic) el = <em>{el}</em>
  if (t.underline) el = <u>{el}</u>
  if (t.strikethrough) el = <s>{el}</s>
  const style: React.CSSProperties = {}
  if (t.fontSize) style.fontSize = t.fontSize
  if (t.color) style.color = t.color
  return <span {...attributes} style={Object.keys(style).length ? style : undefined}>{el}</span>
}

// ─── Component ────────────────────────────────────────────────────────────────

export interface ContractEditorProps {
  contractId?: string                    // required for non-template usage
  initialContent: Descendant[]
  initialVersion: number
  readOnly?: boolean
  readOnlyReason?: string
  showVariablesPanel?: boolean
  variables?: { name: string; label?: string; required?: boolean }[]
  onChange?: (value: Descendant[], wordCount: number) => void
  rightActions?: React.ReactNode        // extra toolbar actions
  // Auto-save mode: only enabled when contractId is provided
  enableAutoSave?: boolean
}

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
  const editor = useMemo<CustomEditor>(() => {
    const e = withTemplateVariableInline(withHistory(withReact(createEditor() as unknown as ReactEditor)))
    return e as unknown as CustomEditor
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
    // "idle" = no edits yet and no document on server (version 0)
    // "saved" = document exists and is in sync
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

  const handleChange = useCallback(
    (next: Descendant[]) => {
      setValue(next)
      onChange?.(next, countDescendantWords(next))

      // Detect content vs selection-only change
      const isAstChange = editor.operations.some((op) => op.type !== "set_selection")
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
    [editor, onChange, isReadOnly, enableAutoSave, contractId, triggerSave],
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
      }
      if ((e.metaKey || e.ctrlKey) && e.shiftKey) {
        if (e.key === "s" || e.key === "S") { e.preventDefault(); toggleMark(editor, "strikethrough"); return }
      }
    },
    [editor, triggerSave],
  )

  const renderElementFn = useCallback((props: RenderElementProps): React.ReactElement => {
    const { attributes, children, element } = props
    const el = element as unknown as CustomElement
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
  }, [editor, activeTablePath])

  // Recomputes only when document content or selection changes, not on every render.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const headingValue = useMemo(() => {
    if (isBlockActive(editor, "h1")) return "h1"
    if (isBlockActive(editor, "h2")) return "h2"
    if (isBlockActive(editor, "h3")) return "h3"
    return "p"
  // editor.selection is a plain object; including `value` ensures we re-check
  // when the document structure changes too.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor.selection, value])

  return (
    <div className="flex flex-col gap-3">
      {isReadOnly && readOnlyReason && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded text-sm">
          {readOnlyReason}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 border-b border-zinc-200 pb-2">
        {!isReadOnly && (
          <>
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

            <span className="w-px h-5 bg-zinc-200 mx-1" />

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

            <ToolbarButton
              onMouseDown={(e) => { e.preventDefault(); indentBlock(editor) }}
              title="Indent"
            ><Indent className="size-4" /></ToolbarButton>
            <ToolbarButton
              onMouseDown={(e) => { e.preventDefault(); outdentBlock(editor) }}
              title="Outdent"
            ><Outdent className="size-4" /></ToolbarButton>

            <span className="w-px h-5 bg-zinc-200 mx-1" />

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

      <div className="grid grid-cols-12 gap-4">
        <div className={cn(showVariablesPanel ? "col-span-9" : "col-span-12", pageLayout && "flex justify-center bg-zinc-100 rounded-md p-6 min-h-[600px]")}>
          <div className={cn(
            "bg-white",
            pageLayout
              ? "w-[794px] min-h-[1123px] shadow-lg p-[72px] border border-zinc-200"
              : "rounded-md border border-zinc-200 p-4 min-h-[400px]"
          )}>
          {(() => {
            if (value.length === 0 && !isReadOnly) {
              return (
                <div className="flex flex-col items-center justify-center py-12 gap-3">
                  <FileText className="size-10 text-zinc-300" />
                  <p className="text-sm text-zinc-500">
                    Start writing your contract, or import a Word document.
                  </p>
                </div>
              )
            }
            return null
          })()}
          <Slate editor={editor as unknown as ReactEditor} initialValue={value} onChange={handleChange}>
            <Editable
              readOnly={isReadOnly}
              renderElement={renderElementFn}
              renderLeaf={renderLeaf}
              onKeyDown={onKeyDown}
              onBlur={handleBlur}
              onClick={() => {
                const { selection } = editor
                if (!selection) { setActiveTablePath(null); return }
                const [tableEntry] = Array.from(Editor.nodes(editor, {
                  match: (n) => SlateElement.isElement(n) && (n as unknown as CustomElement).type === "table",
                }))
                setActiveTablePath(tableEntry ? [...tableEntry[1]] : null)
              }}
              spellCheck
              placeholder={isReadOnly ? undefined : "Start writing…"}
              className="outline-none min-h-[400px] text-sm text-zinc-900"
            />
          </Slate>
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
    </div>
  )
}

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

// Plugin: mark `template_variable` as inline + void
function withTemplateVariableInline<T extends ReactEditor>(editor: T): T {
  const { isInline, isVoid } = editor
  editor.isInline = (el) => {
    if (SlateElement.isElement(el) && (el as unknown as CustomElement).type === "template_variable") {
      return true
    }
    return isInline(el)
  }
  editor.isVoid = (el) => {
    const type = (el as unknown as CustomElement).type
    if (type === "template_variable" || type === "image") return true
    return isVoid(el)
  }
  return editor
}

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

// Helper to surface NodeEntry type used elsewhere — avoids import-level error
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _NodeEntry = NodeEntry

// Range used by Slate selection — ensure we're exporting the import so tsc keeps it.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type _Range = Range
