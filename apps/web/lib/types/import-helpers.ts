import { FIELD_ALIASES } from "./import"

const ZIP_MAGIC = [0x50, 0x4b, 0x03, 0x04]

export function isZipBuffer(buf: Buffer): boolean {
  if (buf.length < 4) return false
  for (let i = 0; i < 4; i++) {
    if (buf[i] !== ZIP_MAGIC[i]) return false
  }
  return true
}

export function sanitizeFilename(name: string): string {
  const stripped = name.replace(/^.*[\\/]/, "")
  return stripped.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 255) || "file"
}

// Minimal CSV parser for the preview path. Handles quoted fields with embedded
// commas, doubled quotes for escapes, and CR/LF line endings. The worker uses
// a stricter parser; this is just enough for header detection + first 5 rows.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = []
  let current: string[] = []
  let field = ""
  let inQuotes = false
  let i = 0

  while (i < text.length) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"'
          i += 2
          continue
        }
        inQuotes = false
        i++
        continue
      }
      field += ch
      i++
      continue
    }

    if (ch === '"') {
      inQuotes = true
      i++
      continue
    }
    if (ch === ",") {
      current.push(field)
      field = ""
      i++
      continue
    }
    if (ch === "\r") {
      i++
      continue
    }
    if (ch === "\n") {
      current.push(field)
      rows.push(current)
      current = []
      field = ""
      i++
      continue
    }
    field += ch
    i++
  }

  if (field.length > 0 || current.length > 0) {
    current.push(field)
    rows.push(current)
  }

  return rows
}

export function suggestColumnMapping(headers: string[]): Record<string, string | null> {
  const mapping: Record<string, string | null> = {}
  const used = new Set<string>()

  for (const header of headers) {
    const normalized = header.trim().toLowerCase()
    let match: string | null = null

    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (used.has(field)) continue
      if (aliases.some((a) => a.toLowerCase() === normalized)) {
        match = field
        break
      }
    }

    if (!match) {
      for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
        if (used.has(field)) continue
        if (aliases.some((a) => normalized.includes(a.toLowerCase()))) {
          match = field
          break
        }
      }
    }

    if (match) used.add(match)
    mapping[header] = match
  }

  return mapping
}
