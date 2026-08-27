import { formatLabel, normalizeLabel, parseNormalizedLabel, type LabelParts } from './normalizeLabel'
import { inferLabelFromText } from './parseExtract'

function partsFromRaw(raw?: string | null): LabelParts {
  if (!raw) return {}
  const n = normalizeLabel(raw)
  if (!n) return {}
  if (/^(i{1,3}|iv|v|vi{0,3}|ix|x)$/.test(n)) return { roman: n }
  if (/^[a-z]$/.test(n)) return { letter: n }
  if (/^[a-z](i{1,3}|iv|v|vi{0,3}|ix|x)$/.test(n)) {
    return { letter: n[0], roman: n.slice(1) }
  }
  return parseNormalizedLabel(n)
}

function formatFromMatch(num: string, letter?: string, roman?: string): string | undefined {
  return formatLabel({
    num,
    letter: letter?.toLowerCase(),
    roman: roman?.toLowerCase(),
  })
}

/**
 * Find a strong question label anywhere in the block text / dedicated fields
 * (headers like "Q7: Newton's Laws" mid-block or on their own line).
 */
export function findLabelAnywhere(
  text: string,
  explicit?: string | null,
): string | undefined {
  if (explicit) {
    const fromExplicit = partsFromRaw(explicit)
    if (fromExplicit.num) return formatLabel(fromExplicit)
  }

  const atStart = inferLabelFromText(text)
  if (atStart) {
    const p = partsFromRaw(atStart)
    if (p.num) return formatLabel(p)
  }

  const patterns: RegExp[] = [
    /\bQ\s*\.?\s*(\d{1,3})\s*[\(\[]\s*([a-z])\s*[\)\]]\s*[\(\[]?\s*((?:i{1,3}|iv|v|vi{0,3}|ix|x))?/gi,
    /\bQ\s*\.?\s*(\d{1,3})\s*[\(\[]\s*([a-z])\s*[\)\]]/gi,
    /\b(?:question|ans(?:wer)?)\s*\.?\s*(\d{1,3})\s*[\(\[]\s*([a-z])\s*[\)\]]/gi,
    /\bQ\s*\.?\s*(\d{1,3})\b/gi,
    /\b(?:question|ans(?:wer)?)\s*\.?\s*(\d{1,3})\b/gi,
  ]

  for (const re of patterns) {
    re.lastIndex = 0
    const m = re.exec(text)
    if (!m?.[1]) continue
    const formatted = formatFromMatch(m[1], m[2], m[3])
    if (formatted) return formatted
  }

  return undefined
}

export function hasStrongLabel(text: string, explicit?: string | null): boolean {
  return Boolean(findLabelAnywhere(text, explicit))
}
