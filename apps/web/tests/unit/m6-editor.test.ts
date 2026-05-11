import { describe, expect, it } from "vitest"
import { htmlToPlateNodes } from "@/lib/editor/html-to-plate"
import { plateToPlaintext, countWords } from "@/lib/editor/plate-to-plaintext"
import {
  findUsedVariableNames,
  substituteVariables,
  type TemplateVariable,
} from "@/lib/editor/template"
import type { TipTapDoc, TipTapNode } from "@/lib/editor/tiptap-types"

// ─── htmlToPlateNodes (now returns TipTapDoc) ─────────────────────────────────

describe("htmlToPlateNodes", () => {
  it("returns an empty paragraph for empty input", () => {
    const doc = htmlToPlateNodes("")
    expect(doc.type).toBe("doc")
    expect(doc.content).toHaveLength(1)
    expect(doc.content[0].type).toBe("paragraph")
  })

  it("converts headings", () => {
    const doc = htmlToPlateNodes("<h1>Title</h1><h2>Sub</h2><h3>Detail</h3>")
    const types = doc.content.map((n) => n.type)
    expect(types).toEqual(["heading", "heading", "heading"])
    expect(doc.content[0].attrs?.level).toBe(1)
    expect(doc.content[1].attrs?.level).toBe(2)
    expect(doc.content[2].attrs?.level).toBe(3)
  })

  it("converts paragraphs with bold/italic/underline marks", () => {
    const doc = htmlToPlateNodes("<p>Hello <strong>bold</strong> <em>italic</em> <u>under</u></p>")
    expect(doc.content[0].type).toBe("paragraph")
    const content = doc.content[0].content ?? []
    const boldNode = content.find((n) => n.marks?.some((m) => m.type === "bold"))
    const italicNode = content.find((n) => n.marks?.some((m) => m.type === "italic"))
    const underlineNode = content.find((n) => n.marks?.some((m) => m.type === "underline"))
    expect(boldNode?.text).toBe("bold")
    expect(italicNode?.text).toBe("italic")
    expect(underlineNode?.text).toBe("under")
  })

  it("converts ordered lists", () => {
    const doc = htmlToPlateNodes("<ol><li>One</li><li>Two</li></ol>")
    expect(doc.content.length).toBeGreaterThanOrEqual(1)
    const list = doc.content[0]
    expect(list.type).toBe("orderedList")
    expect(list.content?.[0].type).toBe("listItem")
  })

  it("converts horizontal rule", () => {
    const doc = htmlToPlateNodes("<p>before</p><hr/><p>after</p>")
    expect(doc.content.some((n) => n.type === "horizontalRule")).toBe(true)
  })
})

// ─── plateToPlaintext ─────────────────────────────────────────────────────────

describe("plateToPlaintext + countWords", () => {
  it("flattens text leaves from legacy Slate array", () => {
    const text = plateToPlaintext([
      { type: "p", children: [{ text: "Hello world" }] },
    ])
    expect(text).toBe("Hello world")
  })

  it("flattens text from TipTap doc", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        { type: "paragraph", content: [{ type: "text", text: "Hello world" }] },
      ],
    }
    expect(plateToPlaintext(doc)).toBe("Hello world")
  })

  it("renders legacy template_variable as literal {{name}}", () => {
    const text = plateToPlaintext([
      {
        type: "p",
        children: [
          { text: "Party: " },
          { type: "template_variable", variable: "party_name", children: [{ text: "" }] },
        ],
      },
    ])
    expect(text).toBe("Party: {{party_name}}")
  })

  it("renders TipTap templateVariable as literal {{name}}", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Party: " },
            { type: "templateVariable", attrs: { variable: "party_name" } },
          ],
        },
      ],
    }
    expect(plateToPlaintext(doc)).toBe("Party: {{party_name}}")
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

// ─── findUsedVariableNames ────────────────────────────────────────────────────

describe("findUsedVariableNames", () => {
  it("finds legacy Slate template_variable nodes", () => {
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

  it("finds TipTap templateVariable nodes in a doc", () => {
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "templateVariable", attrs: { variable: "buyer" } },
            { type: "text", text: " and " },
            { type: "templateVariable", attrs: { variable: "seller" } },
            { type: "templateVariable", attrs: { variable: "buyer" } },
          ],
        },
      ],
    }
    expect(findUsedVariableNames(doc).sort()).toEqual(["buyer", "seller"])
  })
})

// ─── substituteVariables ──────────────────────────────────────────────────────

describe("substituteVariables", () => {
  it("replaces legacy Slate template_variable nodes with supplied text", () => {
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
    const out = substituteVariables(input, { party_name: "Acme Corp" }, declared) as Array<{ children: Array<{ text?: string }> }>
    const para = out[0]
    const flat = para.children.map((c) => c.text).filter(Boolean).join("")
    expect(flat).toBe("Buyer: Acme Corp — Fee: 100")
  })

  it("replaces TipTap templateVariable nodes with text nodes", () => {
    const declared: TemplateVariable[] = [
      { name: "buyer", label: "Buyer", type: "text", required: true },
    ]
    const doc: TipTapDoc = {
      type: "doc",
      content: [
        {
          type: "paragraph",
          content: [
            { type: "text", text: "Party: " },
            { type: "templateVariable", attrs: { variable: "buyer" } },
          ],
        },
      ],
    }
    const out = substituteVariables(doc, { buyer: "Acme Corp" }, declared) as TipTapDoc
    const paraContent = out.content[0].content ?? []
    expect(paraContent[1]).toEqual({ type: "text", text: "Acme Corp" })
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
    ) as Array<{ children: Array<{ text?: string }> }>
    const para = out[0]
    expect(para.children[0].text).toBe("")
  })
})
