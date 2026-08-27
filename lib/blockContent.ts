import type { ContentKind, ExtractedBlock } from './types'

const KIND_SET = new Set<ContentKind>([
  'text',
  'formula',
  'derivative',
  'diagram',
  'mixed',
])

export function coerceContentKind(raw: unknown): ContentKind | undefined {
  if (typeof raw !== 'string') return undefined
  const k = raw.trim().toLowerCase() as ContentKind
  return KIND_SET.has(k) ? k : undefined
}

/** Infer kind from extracted fields when the model omits contentKind. */
export function inferContentKind(block: {
  text?: string
  mathLatex?: string
  diagramDescription?: string
  contentKind?: ContentKind
}): ContentKind {
  if (block.contentKind) return block.contentKind
  const hasMath = Boolean(block.mathLatex?.trim())
  const hasDiagram = Boolean(block.diagramDescription?.trim())
  if (hasMath && hasDiagram) return 'mixed'
  if (hasDiagram) return 'diagram'
  if (hasMath) {
    const latex = block.mathLatex ?? ''
    if (/\\(?:frac|partial|mathrm\{d\})|d[a-zA-Z]\s*\/\s*d|′|''/.test(latex)) {
      return 'derivative'
    }
    return 'formula'
  }
  const t = block.text ?? ''
  if (/diagram|figure|graph|sketch|labelled|labeled draw/i.test(t)) return 'diagram'
  if (/\\frac|∑|∫|√|≤|≥|≠|→|d\/dx|dy\/dx|∂/.test(t)) return 'formula'
  return 'text'
}

/**
 * Flatten a block for matching / grading so formulas and diagrams are not lost
 * when only `text` was filled incompletely.
 */
export function blockContentForModel(block: ExtractedBlock | null | undefined): string {
  if (!block || block.isStrikethrough) return ''
  const parts: string[] = []
  if (block.text?.trim()) parts.push(block.text.trim())
  if (block.mathLatex?.trim()) {
    parts.push(`Math (LaTeX): ${block.mathLatex.trim()}`)
  }
  if (block.diagramDescription?.trim()) {
    parts.push(`Diagram: ${block.diagramDescription.trim()}`)
  }
  return parts.join('\n\n')
}

export function contentKindLabel(kind?: ContentKind): string | null {
  switch (kind) {
    case 'formula':
      return 'Formula'
    case 'derivative':
      return 'Derivative'
    case 'diagram':
      return 'Diagram'
    case 'mixed':
      return 'Mixed'
    default:
      return null
  }
}
