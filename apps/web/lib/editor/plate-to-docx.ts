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

// Reference key for the custom numbered list (ordered); unordered lists use
// docx's built-in `bullet` shorthand and need no explicit reference.
const ORDERED_LIST_REF = "cf-ordered-list"

interface AnyNode {
  type?: string
  text?: string
  children?: unknown[]
  variable?: string
  bold?: boolean
  italic?: boolean
  underline?: boolean
  strikethrough?: boolean
  indent?: number
}

function getFont(): string {
  return process.env.DOCX_EXPORT_FONT || "Times New Roman"
}

const HEADING_LEVEL: Record<string, (typeof HeadingLevel)[keyof typeof HeadingLevel]> = {
  h1: HeadingLevel.HEADING_1,
  h2: HeadingLevel.HEADING_2,
  h3: HeadingLevel.HEADING_3,
}

// docx font sizes are half-points: 12pt = 24, 16pt = 32, 20pt = 40, 24pt = 48
const FONT_SIZES: Record<string, number> = {
  body: 24,
  h1: 48,
  h2: 40,
  h3: 32,
}

function flattenInline(children: unknown[] | undefined): TextRun[] {
  if (!Array.isArray(children)) return []
  const runs: TextRun[] = []
  const font = getFont()
  walk(children, runs, font)
  if (runs.length === 0) runs.push(new TextRun({ text: "", font }))
  return runs
}

function walk(children: unknown[], runs: TextRun[], font: string): void {
  for (const child of children) {
    if (!child || typeof child !== "object") continue
    const n = child as AnyNode
    if (typeof n.text === "string") {
      runs.push(new TextRun({
        text: n.text,
        font,
        ...(n.bold ? { bold: true } : {}),
        ...(n.italic ? { italics: true } : {}),
        ...(n.underline ? { underline: { type: UnderlineType.SINGLE } } : {}),
        ...(n.strikethrough ? { strike: true } : {}),
      }))
      continue
    }
    if (n.type === "template_variable" && typeof n.variable === "string") {
      runs.push(new TextRun({ text: `{{${n.variable}}}`, font }))
      continue
    }
    if (Array.isArray(n.children)) {
      walk(n.children, runs, font)
    }
  }
}

function listItemParagraphs(
  node: AnyNode,
  listType: "ol" | "ul",
  level: number,
): Paragraph[] {
  const paragraphs: Paragraph[] = []
  if (Array.isArray(node.children)) {
    for (const child of node.children) {
      if (!child || typeof child !== "object") continue
      const li = child as AnyNode
      if (li.type === "li") {
        const indentLevel = li.indent ? Math.max(0, Math.min(li.indent - 1, 5)) : level
        if (listType === "ol") {
          paragraphs.push(
            new Paragraph({
              numbering: { reference: ORDERED_LIST_REF, level: indentLevel },
              children: flattenInline(li.children),
            }),
          )
        } else {
          paragraphs.push(
            new Paragraph({
              bullet: { level: indentLevel },
              children: flattenInline(li.children),
            }),
          )
        }
      }
    }
  }
  return paragraphs
}

function tableFromNode(node: AnyNode): Table {
  const rows: TableRow[] = []
  if (Array.isArray(node.children)) {
    for (const trNode of node.children) {
      if (!trNode || typeof trNode !== "object") continue
      const tr = trNode as AnyNode
      if (tr.type !== "tr") continue
      const cells: TableCell[] = []
      if (Array.isArray(tr.children)) {
        for (const cellNode of tr.children) {
          if (!cellNode || typeof cellNode !== "object") continue
          const cell = cellNode as AnyNode
          if (cell.type !== "td" && cell.type !== "th") continue
          const paragraphs: Paragraph[] = []
          if (Array.isArray(cell.children)) {
            for (const c of cell.children) {
              if (!c || typeof c !== "object") continue
              const p = c as AnyNode
              if (p.type === "p" || !p.type) {
                paragraphs.push(
                  new Paragraph({
                    children: flattenInline(p.children),
                  }),
                )
              }
            }
          }
          if (paragraphs.length === 0) {
            paragraphs.push(new Paragraph({ children: [new TextRun({ text: "", font: getFont() })] }))
          }
          cells.push(new TableCell({ children: paragraphs }))
        }
      }
      if (cells.length > 0) rows.push(new TableRow({ children: cells }))
    }
  }
  if (rows.length === 0) {
    rows.push(
      new TableRow({
        children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: "", font: getFont() })] })],
          }),
        ],
      }),
    )
  }
  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
  })
}

function nodeToDocxBlocks(node: unknown): Array<Paragraph | Table> {
  if (!node || typeof node !== "object") return []
  const n = node as AnyNode
  const type = n.type ?? ""

  if (type === "h1" || type === "h2" || type === "h3") {
    return [
      new Paragraph({
        heading: HEADING_LEVEL[type],
        children: flattenInline(n.children).map((run) => {
          // Re-create with appropriate size + bold for heading style.
          // (docx's HEADING_LEVEL handles styling but TextRun font/size apply too.)
          return run
        }),
      }),
    ]
  }

  if (type === "p" || !type) {
    return [
      new Paragraph({
        children: flattenInline(n.children),
      }),
    ]
  }

  if (type === "ol" || type === "ul") {
    return listItemParagraphs(n, type, 0)
  }

  if (type === "li") {
    // Standalone li without parent context — treat as unordered bullet
    return [
      new Paragraph({
        bullet: { level: 0 },
        children: flattenInline(n.children),
      }),
    ]
  }

  if (type === "table") {
    return [tableFromNode(n)]
  }

  if (type === "hr") {
    return [
      new Paragraph({
        border: {
          bottom: { style: BorderStyle.SINGLE, size: 6, space: 1, color: "auto" },
        },
        alignment: AlignmentType.LEFT,
        children: [new TextRun({ text: "", font: getFont() })],
      }),
    ]
  }

  // Fallback: treat as paragraph
  return [
    new Paragraph({
      children: flattenInline(n.children),
    }),
  ]
}

export async function plateToDocxBuffer(nodes: unknown[]): Promise<Buffer> {
  const font = getFont()
  const blocks: Array<Paragraph | Table> = []
  for (const n of nodes) {
    blocks.push(...nodeToDocxBlocks(n))
  }
  if (blocks.length === 0) {
    blocks.push(new Paragraph({ children: [new TextRun({ text: "", font })] }))
  }

  const doc = new Document({
    numbering: {
      config: [
        {
          reference: ORDERED_LIST_REF,
          levels: Array.from({ length: 9 }, (_, i) => ({
            level: i,
            format: LevelFormat.DECIMAL,
            text: `%${i + 1}.`,
            alignment: AlignmentType.LEFT,
            style: {
              paragraph: {
                indent: { left: 720 * (i + 1), hanging: 360 },
              },
              run: { font },
            },
          })),
        },
      ],
    },
    styles: {
      default: {
        document: {
          run: {
            font,
            size: FONT_SIZES.body,
          },
        },
        heading1: {
          run: { font, size: FONT_SIZES.h1, bold: true },
        },
        heading2: {
          run: { font, size: FONT_SIZES.h2, bold: true },
        },
        heading3: {
          run: { font, size: FONT_SIZES.h3, bold: true },
        },
      },
    },
    sections: [
      {
        properties: {
          page: {
            margin: {
              top: 1440,
              right: 1440,
              bottom: 1440,
              left: 1440,
            },
          },
        },
        children: blocks,
      },
    ],
  })

  return Packer.toBuffer(doc)
}
