import { describe, expect, it } from "vitest"
import { htmlToPlateNodes } from "@/lib/editor/html-to-plate"
import { plateToPlaintext, countWords } from "@/lib/editor/plate-to-plaintext"
import {
  findUsedVariableNames,
  substituteVariables,
  type TemplateVariable,
} from "@/lib/editor/template"

describe("htmlToPlateNodes", () => {
  it("returns an empty paragraph for empty input", () => {
    expect(htmlToPlateNodes("")).toEqual([{ type: "p", children: [{ text: "" }] }])
  })

  it("converts headings", () => {
    const out = htmlToPlateNodes("<h1>Title</h1><h2>Sub</h2><h3>Detail</h3>")
    expect(out.map((n) => (n as { type: string }).type)).toEqual(["h1", "h2", "h3"])
  })

  it("converts paragraphs with bold/italic/underline marks", () => {
    const out = htmlToPlateNodes("<p>Hello <strong>bold</strong> <em>italic</em> <u>under</u></p>")
    const p = out[0] as { type: string; children: Array<{ text: string; bold?: boolean; italic?: boolean; underline?: boolean }> }
    expect(p.type).toBe("p")
    const flat = p.children.map((c) => ({ text: c.text, bold: !!c.bold, italic: !!c.italic, underline: !!c.underline }))
    expect(flat).toContainEqual({ text: "bold", bold: true, italic: false, underline: false })
    expect(flat).toContainEqual({ text: "italic", bold: false, italic: true, underline: false })
    expect(flat).toContainEqual({ text: "under", bold: false, italic: false, underline: true })
  })

  it("converts ordered lists", () => {
    const out = htmlToPlateNodes("<ol><li>One</li><li>Two</li></ol>")
    // Each <li> produces one ol-wrapped li (flat list-of-lists style).
    expect(out.length).toBeGreaterThanOrEqual(1)
    const first = out[0] as { type: string; children: Array<{ type: string }> }
    expect(first.type).toBe("ol")
    expect(first.children[0].type).toBe("li")
  })

  it("converts horizontal rule", () => {
    const out = htmlToPlateNodes("<p>before</p><hr/><p>after</p>")
    expect(out.some((n) => (n as { type: string }).type === "hr")).toBe(true)
  })
})

describe("plateToPlaintext + countWords", () => {
  it("flattens text leaves", () => {
    const text = plateToPlaintext([
      { type: "p", children: [{ text: "Hello world" }] },
    ])
    expect(text).toBe("Hello world")
  })

  it("renders template_variable as literal {{name}}", () => {
    const text = plateToPlaintext([
      {
        type: "p",
        children: [
          { text: "Party: " },
          { type: "template_variable", variable: "party_name", children: [{ text: "" }] },
        ],
      },
    ])
    // The trailing whitespace and double-paragraph newlines are trimmed by plateToPlaintext.
    expect(text).toBe("Party: {{party_name}}")
  })

  it("counts words across multiple blocks", () => {
    const wc = countWords("Hello world\nthis is four words")
    expect(wc).toBe(6)
  })

  it("countWords returns 0 for empty input", () => {
    expect(countWords("")).toBe(0)
    expect(countWords("   ")).toBe(0)
  })
})

describe("findUsedVariableNames", () => {
  it("returns deduped variable names referenced anywhere in the document", () => {
    const used = findUsedVariableNames([
      {
        type: "p",
        children: [
          { type: "template_variable", variable: "party_a", children: [{ text: "" }] },
          { text: " and " },
          { type: "template_variable", variable: "party_b", children: [{ text: "" }] },
        ],
      },
      {
        type: "p",
        children: [
          { type: "template_variable", variable: "party_a", children: [{ text: "" }] },
        ],
      },
    ])
    expect(used.sort()).toEqual(["party_a", "party_b"])
  })
})

describe("substituteVariables", () => {
  it("replaces template_variable nodes with supplied text", () => {
    const declared: TemplateVariable[] = [
      { name: "party_name", label: "Party", type: "text", required: true },
      { name: "fee", label: "Fee", type: "number", required: false, defaultValue: "100" },
    ]
    const input = [
      {
        type: "p",
        children: [
          { text: "Buyer: " },
          { type: "template_variable", variable: "party_name", children: [{ text: "" }] },
          { text: " — Fee: " },
          { type: "template_variable", variable: "fee", children: [{ text: "" }] },
        ],
      },
    ]
    const out = substituteVariables(input, { party_name: "Acme Corp" }, declared)
    const para = out[0] as { children: Array<{ text?: string }> }
    const flat = para.children.map((c) => c.text).filter(Boolean).join("")
    expect(flat).toBe("Buyer: Acme Corp — Fee: 100")
  })

  it("uses empty string when no value or default present", () => {
    const declared: TemplateVariable[] = [
      { name: "x", label: "X", type: "text", required: false },
    ]
    const out = substituteVariables(
      [
        {
          type: "p",
          children: [{ type: "template_variable", variable: "x", children: [{ text: "" }] }],
        },
      ],
      {},
      declared,
    )
    const para = out[0] as { children: Array<{ text?: string }> }
    expect(para.children[0].text).toBe("")
  })
})
