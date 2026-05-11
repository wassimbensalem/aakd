// TipTap JSON → PDF buffer via @react-pdf/renderer.
// Also accepts legacy Slate array format (via slateToTiptap conversion).

import React from "react"
import { Document, Page, View, Text, StyleSheet, renderToBuffer } from "@react-pdf/renderer"
import { slateToTiptap } from "./slate-to-tiptap"
import type { TipTapNode } from "./tiptap-types"

// ─── Styles ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  page: {
    fontFamily: "Times-Roman",
    fontSize: 12,
    paddingTop: 72,
    paddingBottom: 72,
    paddingLeft: 72,
    paddingRight: 72,
  },
  paragraph: {
    fontSize: 12,
    fontFamily: "Times-Roman",
    marginBottom: 6,
  },
  h1: {
    fontSize: 24,
    fontFamily: "Times-Bold",
    marginBottom: 10,
  },
  h2: {
    fontSize: 20,
    fontFamily: "Times-Bold",
    marginBottom: 8,
  },
  h3: {
    fontSize: 16,
    fontFamily: "Times-Bold",
    marginBottom: 6,
  },
  hr: {
    borderBottomWidth: 1,
    borderBottomColor: "#000",
    marginVertical: 8,
  },
  listItem: {
    fontSize: 12,
    fontFamily: "Times-Roman",
    marginLeft: 20,
    marginBottom: 3,
  },
  table: {
    borderWidth: 1,
    borderColor: "#000",
    marginBottom: 8,
  },
  tableRow: {
    flexDirection: "row",
  },
  tableCell: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#000",
    padding: 4,
    fontSize: 12,
    fontFamily: "Times-Roman",
  },
})

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fontFamilyForMarks(bold: boolean, italic: boolean): string {
  if (bold && italic) return "Times-BoldItalic"
  if (bold) return "Times-Bold"
  if (italic) return "Times-Italic"
  return "Times-Roman"
}

// ─── Render inline TipTap text nodes → React PDF Text elements ───────────────

let _counter = 0
function nextKey(prefix: string): string {
  return `${prefix}_${_counter++}`
}

function renderInline(content: TipTapNode[] | undefined, keyPrefix: string): React.ReactNode[] {
  if (!Array.isArray(content)) return []
  const out: React.ReactNode[] = []

  for (const node of content) {
    if (node.type === "text") {
      const marks = node.marks ?? []
      const bold = marks.some((m) => m.type === "bold")
      const italic = marks.some((m) => m.type === "italic")
      const strikethrough = marks.some((m) => m.type === "strike")
      const underline = marks.some((m) => m.type === "underline")
      const family = fontFamilyForMarks(bold, italic)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const style: any = { fontFamily: family }
      if (strikethrough) style.textDecoration = "line-through"
      else if (underline) style.textDecoration = "underline"
      out.push(React.createElement(Text, { key: nextKey(keyPrefix), style }, node.text ?? ""))
      continue
    }

    if (node.type === "templateVariable") {
      const variable = (node.attrs?.variable as string | undefined) ?? ""
      out.push(
        React.createElement(
          Text,
          { key: nextKey(keyPrefix), style: { fontFamily: "Times-Roman" } },
          `{{${variable}}}`,
        ),
      )
      continue
    }

    // Link — render as text with underline
    if (node.type === "text" || Array.isArray(node.content)) {
      out.push(...renderInline(node.content, keyPrefix))
    }
  }

  return out
}

// ─── Render list items recursively ────────────────────────────────────────────

function renderListItems(
  items: TipTapNode[],
  listType: "bulletList" | "orderedList",
  keyPrefix: string,
): React.ReactNode[] {
  const out: React.ReactNode[] = []
  let counter = 1

  for (const item of items) {
    if (item.type !== "listItem") continue
    const prefix = listType === "orderedList" ? `${counter++}. ` : "• "
    const itemContent = item.content ?? []

    for (const child of itemContent) {
      if (child.type === "paragraph") {
        out.push(
          React.createElement(
            Text,
            { key: nextKey(keyPrefix), style: styles.listItem },
            prefix,
            ...renderInline(child.content, keyPrefix),
          ),
        )
      } else if (child.type === "bulletList" || child.type === "orderedList") {
        // Nested list — render with extra indent (via listItem style)
        out.push(...renderListItems(child.content ?? [], child.type, keyPrefix))
      }
    }
  }

  return out
}

// ─── Render a single TipTap block node → React node ──────────────────────────

function renderBlock(node: TipTapNode, idx: number): React.ReactNode | null {
  const key = `b_${idx}`
  const type = node.type

  if (type === "heading") {
    const level = (node.attrs?.level as number | undefined) ?? 1
    const headingStyle = level === 1 ? styles.h1 : level === 2 ? styles.h2 : styles.h3
    return React.createElement(Text, { key, style: headingStyle }, ...renderInline(node.content, key))
  }

  if (type === "paragraph") {
    return React.createElement(Text, { key, style: styles.paragraph }, ...renderInline(node.content, key))
  }

  if (type === "horizontalRule") {
    return React.createElement(View, { key, style: styles.hr })
  }

  if (type === "bulletList" || type === "orderedList") {
    return React.createElement(View, { key }, ...renderListItems(node.content ?? [], type, key))
  }

  if (type === "table") {
    const rows: React.ReactNode[] = []
    for (let r = 0; r < (node.content ?? []).length; r++) {
      const row = node.content![r]
      if (row.type !== "tableRow") continue
      const cells: React.ReactNode[] = []
      for (let c = 0; c < (row.content ?? []).length; c++) {
        const cell = row.content![c]
        if (cell.type !== "tableCell" && cell.type !== "tableHeader") continue
        // Flatten cell paragraph content into inline runs
        const inlineNodes: TipTapNode[] = []
        for (const pNode of cell.content ?? []) {
          if (Array.isArray(pNode.content)) inlineNodes.push(...pNode.content)
          else inlineNodes.push(pNode)
        }
        cells.push(
          React.createElement(
            Text,
            { key: `${key}_${r}_${c}`, style: styles.tableCell },
            ...renderInline(inlineNodes, `${key}_${r}_${c}`),
          ),
        )
      }
      rows.push(React.createElement(View, { key: `${key}_row_${r}`, style: styles.tableRow }, ...cells))
    }
    return React.createElement(View, { key, style: styles.table }, ...rows)
  }

  if (type === "image") {
    // @react-pdf/renderer requires registered fonts for images; skip rendering binary,
    // emit alt text as a paragraph instead.
    const alt = (node.attrs?.alt as string | undefined) ?? ""
    return React.createElement(Text, { key, style: styles.paragraph }, alt || "[image]")
  }

  // Fallback
  return React.createElement(Text, { key, style: styles.paragraph }, ...renderInline(node.content, key))
}

// ─── Normalize input: accept TipTap doc OR legacy Slate array ─────────────────

function normalizeToNodes(input: unknown): TipTapNode[] {
  if (!input) return []
  if (Array.isArray(input)) {
    return slateToTiptap(input).content
  }
  const doc = input as { type?: string; content?: TipTapNode[] }
  if (doc.type === "doc" && Array.isArray(doc.content)) {
    return doc.content
  }
  return []
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Convert TipTap JSON (or legacy Slate array) to a PDF buffer.
 * Export name kept as `plateToPdfBuffer` for backward compat.
 */
export async function plateToPdfBuffer(doc: unknown): Promise<Buffer> {
  _counter = 0
  const nodes = normalizeToNodes(doc)
  const blocks: React.ReactNode[] = []

  for (let i = 0; i < nodes.length; i++) {
    const block = renderBlock(nodes[i], i)
    if (block) blocks.push(block)
  }

  if (blocks.length === 0) {
    blocks.push(React.createElement(Text, { key: "empty", style: styles.paragraph }, ""))
  }

  const pdfDoc = React.createElement(
    Document,
    null,
    React.createElement(Page, { size: "A4", style: styles.page }, ...blocks),
  )

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return renderToBuffer(pdfDoc as any) as Promise<Buffer>
}
