// TipTap JSON → DOCX buffer.
// Also accepts legacy Slate array format (via slateToTiptap conversion).
// Uses the `docx` npm package for generation.

import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  Table,
  TableRow,
  TableCell,
  BorderStyle,
  UnderlineType,
  WidthType,
  AlignmentType,
  LevelFormat,
} from "docx"
import { slateToTiptap } from "./slate-to-tiptap"
import type { TipTapDoc, TipTapNode } from "./tiptap-types"

// Reference key for the custom numbered list
const ORDERED_LIST_REF = "cf-ordered-list"

function getFont(): string {
  return process.env.DOCX_EXPORT_FONT ?? "Times New Roman"
}

const HEADING_LEVEL_MAP: Record<number, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  1: HeadingLevel.HEADING_1,
  2: HeadingLevel.HEADING_2,
  3: HeadingLevel.HEADING_3,
}

// docx font sizes are half-points: 12pt = 24, 16pt = 32, 20pt = 40, 24pt = 48
const FONT_SIZES: Record<string, number> = {
  body: 24,
  h1: 48,
  h2: 40,
  h3: 32,
}

// ─── TipTap marks → TextRun properties ───────────────────────────────────────

interface TextRunOptions {
  text: string
  font: string
  bold?: true
  italics?: true
  underline?: { type: typeof UnderlineType[keyof typeof UnderlineType] }
  strike?: true
  color?: string
}

function marksToRunOptions(
  text: string,
  marks: TipTapNode["marks"],
  font: string,
): TextRunOptions {
  const opts: TextRunOptions = { text, font }
  if (!marks) return opts
  for (const mark of marks) {
    if (mark.type === "bold") opts.bold = true
    if (mark.type === "italic") opts.italics = true
    if (mark.type === "underline") opts.underline = { type: UnderlineType.SINGLE }
    if (mark.type === "strike") opts.strike = true
    if (mark.type === "textStyle" && mark.attrs?.color) {
      // docx TextRun color takes hex without #
      opts.color = (mark.attrs.color as string).replace(/^#/, "")
    }
  }
  return opts
}

// ─── Flatten TipTap inline content → docx TextRuns ───────────────────────────

function flattenInline(content: TipTapNode[] | undefined): TextRun[] {
  if (!Array.isArray(content) || content.length === 0) {
    return [new TextRun({ text: "", font: getFont() })]
  }
  const font = getFont()
  const runs: TextRun[] = []

  function walk(nodes: TipTapNode[]): void {
    for (const node of nodes) {
      if (node.type === "text") {
        runs.push(new TextRun(marksToRunOptions(node.text ?? "", node.marks, font)))
        continue
      }
      if (node.type === "templateVariable") {
        const variable = (node.attrs?.variable as string | undefined) ?? ""
        runs.push(new TextRun({ text: `{{${variable}}}`, font }))
        continue
      }
      // For any inline node that has content children, recurse
      if (Array.isArray(node.content)) {
        walk(node.content)
      }
    }
  }

  walk(content)
  if (runs.length === 0) runs.push(new TextRun({ text: "", font }))
  return runs
}

// ─── List item processing ─────────────────────────────────────────────────────

function listItemParagraphs(
  items: TipTapNode[],
  listType: "bulletList" | "orderedList",
  level: number,
): Paragraph[] {
  const paragraphs: Paragraph[] = []

  for (const item of items) {
    if (item.type !== "listItem") continue
    const itemContent = item.content ?? []

    for (const child of itemContent) {
      if (child.type === "paragraph") {
        if (listType === "orderedList") {
          paragraphs.push(new Paragraph({
            numbering: { reference: ORDERED_LIST_REF, level },
            children: flattenInline(child.content),
          }))
        } else {
          paragraphs.push(new Paragraph({
            bullet: { level },
            children: flattenInline(child.content),
          }))
        }
      } else if (child.type === "bulletList" || child.type === "orderedList") {
        // Nested list
        const nestedType = child.type as "bulletList" | "orderedList"
        paragraphs.push(...listItemParagraphs(child.content ?? [], nestedType, level + 1))
      }
    }
  }

  return paragraphs
}

// ─── Table processing ─────────────────────────────────────────────────────────

function tableFromNode(node: TipTapNode): Table {
  const rows: TableRow[] = []

  for (const rowNode of node.content ?? []) {
    if (rowNode.type !== "tableRow") continue
    const cells: TableCell[] = []

    for (const cellNode of rowNode.content ?? []) {
      if (cellNode.type !== "tableCell" && cellNode.type !== "tableHeader") continue
      const paragraphs: Paragraph[] = []

      for (const pNode of cellNode.content ?? []) {
        if (pNode.type === "paragraph") {
          paragraphs.push(new Paragraph({ children: flattenInline(pNode.content) }))
        }
      }

      if (paragraphs.length === 0) {
        paragraphs.push(new Paragraph({ children: [new TextRun({ text: "", font: getFont() })] }))
      }
      cells.push(new TableCell({ children: paragraphs }))
    }

    if (cells.length > 0) rows.push(new TableRow({ children: cells }))
  }

  if (rows.length === 0) {
    rows.push(new TableRow({
      children: [new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: "", font: getFont() })] })],
      })],
    }))
  }

  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } })
}

// ─── Convert a single TipTap node → docx blocks ───────────────────────────────

function nodeToDocxBlocks(node: TipTapNode): Array<Paragraph | Table> {
  const type = node.type ?? ""

  if (type === "heading") {
    const level = (node.attrs?.level as number | undefined) ?? 1
    return [new Paragraph({
      heading: HEADING_LEVEL_MAP[level] ?? HeadingLevel.HEADING_1,
      children: flattenInline(node.content),
    })]
  }

  if (type === "paragraph") {
    return [new Paragraph({ children: flattenInline(node.content) })]
  }

  if (type === "bulletList") {
    return listItemParagraphs(node.content ?? [], "bulletList", 0)
  }

  if (type === "orderedList") {
    return listItemParagraphs(node.content ?? [], "orderedList", 0)
  }

  if (type === "table") {
    return [tableFromNode(node)]
  }

  if (type === "horizontalRule") {
    return [new Paragraph({
      border: {
        bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: "auto" },
      },
      alignment: AlignmentType.LEFT,
      children: [new TextRun({ text: "", font: getFont() })],
    })]
  }

  if (type === "image") {
    // Images in DOCX require binary embedding which we skip; emit alt text instead.
    const alt = (node.attrs?.alt as string | undefined) ?? ""
    return [new Paragraph({ children: [new TextRun({ text: alt || "[image]", font: getFont() })] })]
  }

  // Fallback
  return [new Paragraph({ children: flattenInline(node.content) })]
}

// ─── Normalize input: accept TipTap doc OR legacy Slate array ─────────────────

function normalizeToTiptap(input: unknown): TipTapNode[] {
  if (!input) return []
  if (Array.isArray(input)) {
    // Legacy Slate array
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
 * Convert TipTap JSON (or legacy Slate array) to a DOCX buffer.
 * Export name kept as `plateToDocxBuffer` for backward compat.
 */
export async function plateToDocxBuffer(doc: unknown): Promise<Buffer> {
  const font = getFont()
  const nodes = normalizeToTiptap(doc)
  const blocks: Array<Paragraph | Table> = []

  for (const n of nodes) {
    blocks.push(...nodeToDocxBlocks(n))
  }

  if (blocks.length === 0) {
    blocks.push(new Paragraph({ children: [new TextRun({ text: "", font })] }))
  }

  const document = new Document({
    numbering: {
      config: [{
        reference: ORDERED_LIST_REF,
        levels: Array.from({ length: 9 }, (_, i) => ({
          level: i,
          format: LevelFormat.DECIMAL,
          text: `%${i + 1}.`,
          alignment: AlignmentType.LEFT,
          style: {
            paragraph: { indent: { left: 720 * (i + 1), hanging: 360 } },
            run: { font },
          },
        })),
      }],
    },
    styles: {
      default: {
        document: { run: { font, size: FONT_SIZES.body } },
        heading1: { run: { font, size: FONT_SIZES.h1, bold: true } },
        heading2: { run: { font, size: FONT_SIZES.h2, bold: true } },
        heading3: { run: { font, size: FONT_SIZES.h3, bold: true } },
      },
    },
    sections: [{
      properties: {
        page: { margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } },
      },
      children: blocks,
    }],
  })

  return Packer.toBuffer(document)
}

// Re-export type for external use
export type { TipTapDoc }
