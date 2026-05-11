// Shared TipTap / ProseMirror JSON types used across lib/editor and components/editor.

export interface TipTapDoc {
  type: "doc"
  content: TipTapNode[]
}

export interface TipTapNode {
  type: string
  attrs?: Record<string, unknown>
  content?: TipTapNode[]
  marks?: TipTapMark[]
  text?: string
}

export interface TipTapMark {
  type: string
  attrs?: Record<string, unknown>
}
