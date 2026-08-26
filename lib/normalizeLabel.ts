/**
 * Normalize question/answer labels for exact matching.
 * e.g. "11 (a)" / "11(A)" / "Q.11-a" / "20(b)(i)" → "11a" / "20bi"
 */
export function normalizeLabel(raw?: string | null): string | null {
  if (!raw) return null
  const cleaned = raw
    .toLowerCase()
    .replace(/^q(uestion)?\.?\s*/i, '')
    .replace(/[^a-z0-9]/g, '')
  return cleaned.length > 0 ? cleaned : null
}

/** Infer max marks from question wording like "[2]", "(3 marks)", "2 marks". */
export function inferMaxScore(questionText: string, fallback = 2): number {
  const patterns = [
    /[\[(]\s*(\d+)\s*marks?\s*[\])]/i,
    /[\[(]\s*(\d+)\s*[\])]/,
    /\b(\d+)\s*marks?\b/i,
  ]
  for (const re of patterns) {
    const m = questionText.match(re)
    if (m?.[1]) {
      const n = Number(m[1])
      if (n > 0 && n <= 20) return n
    }
  }
  return fallback
}
