export interface TextChunk {
  index: number
  text: string
}

const DEFAULT_CHUNK_SIZE = 6000
const DEFAULT_OVERLAP = 800

export function chunkText(
  text: string,
  chunkSize = DEFAULT_CHUNK_SIZE,
  overlap = DEFAULT_OVERLAP,
): TextChunk[] {
  const clean = text.replace(/\r\n/g, "\n").trim()
  if (!clean) return []

  const chunks: TextChunk[] = []
  let start = 0

  while (start < clean.length) {
    const hardEnd = Math.min(start + chunkSize, clean.length)
    let end = hardEnd

    if (hardEnd < clean.length) {
      const paragraphBreak = clean.lastIndexOf("\n\n", hardEnd)
      const sentenceBreak = clean.lastIndexOf(". ", hardEnd)
      const softBreak = Math.max(paragraphBreak, sentenceBreak)
      if (softBreak > start + chunkSize * 0.6) {
        end = softBreak + (softBreak === sentenceBreak ? 1 : 0)
      }
    }

    const chunk = clean.slice(start, end).trim()
    if (chunk) chunks.push({ index: chunks.length, text: chunk })

    if (end >= clean.length) break
    start = Math.max(end - overlap, start + 1)
  }

  return chunks
}
