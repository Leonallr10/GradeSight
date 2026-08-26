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

export type LabelParts = {
  num?: string
  letter?: string
  roman?: string
}

/** Parse normalized label "20bi" / "21aii" / "19a" / "19". */
export function parseNormalizedLabel(normalized: string): LabelParts {
  const m = normalized.match(/^(\d+)([a-z])?(i{1,3}|iv|v|vi{0,3}|ix|x)?$/)
  if (!m) return {}
  return {
    num: m[1],
    letter: m[2],
    roman: m[3],
  }
}

/**
 * True if `parent` is a strict hierarchical parent of `child`
 * (e.g. "19"→"19a", "20b"→"20bi"), but not "2"→"20" or "20bi"→"20bii".
 */
export function isStrictParentLabel(parent: string, child: string): boolean {
  const p = parseNormalizedLabel(parent)
  const c = parseNormalizedLabel(child)
  if (!p.num || !c.num || p.num !== c.num) return false

  // "19" → "19(a)" / "19(a)(i)"
  if (!p.letter && !p.roman && c.letter) return true

  // "20(b)" → "20(b)(i)" (same letter; parent has no roman)
  if (p.letter && p.letter === c.letter && !p.roman && Boolean(c.roman)) return true

  return false
}

/** Format parts back to display label like "20(b)(i)". */
export function formatLabel(parts: LabelParts): string | undefined {
  if (!parts.num) return undefined
  let out = parts.num
  if (parts.letter) out += `(${parts.letter})`
  if (parts.roman) out += `(${parts.roman})`
  return out
}
