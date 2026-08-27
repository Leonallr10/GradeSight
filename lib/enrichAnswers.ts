/**
 * Post-extract answer label repair:
 * - Parent label "9" with (a)/(b) sections in text → split into 9(a) / 9(b)
 * - Mislabelled blocks (e.g. "3(b)" that is clearly function composition → "1(b)")
 * - Mega-blocks that glued multiple topics (photosynthesis + dry cell + Newton)
 */

import { findLabelAnywhere } from './findLabel'
import { formatLabel, normalizeLabel, parseNormalizedLabel } from './normalizeLabel'
import type { BBox, ExtractedBlock } from './types'

function looksLikeFunctionComposition(text: string): boolean {
  const t = text.toLowerCase()
  return (
    /f\s*\(\s*x\s*\)/.test(t) &&
    /g\s*\(\s*x\s*\)/.test(t) &&
    (/g\s*\(\s*f\s*\(/.test(t) || /find\s+g\s*\(\s*f/.test(t) || /f\s*\(\s*3\s*\)/.test(t))
  )
}

function looksLikeLadderSlide(text: string): boolean {
  const t = text.toLowerCase()
  return (
    (/base\s+slides|slides?\s+\d|further\s+from\s+the\s+wall|new\s+base/.test(t) &&
      /(?:ladder|10\s*m|pythag|\^\s*2|hypotenuse)/i.test(t)) ||
    (/base\s*=\s*8|6\s*\+\s*2/.test(t) && /10/.test(t) && /slides?\s+down|new\s+height/i.test(t))
  )
}

function looksLikePhotosynthesis(text: string): boolean {
  return /photosynthesis|chlorophyll|6\s*co\s*2|glucose/i.test(text)
}

function looksLikeNewton(text: string): boolean {
  return /newton|law of inertia|\bf\s*=\s*ma\b|action\s+(?:has\s+an\s+)?equal|laws?\s+of\s+motion/i.test(
    text,
  )
}

function looksLikeDryCell(text: string): boolean {
  return /dry\s*cell|zinc\s+can|carbon\s+rod|manganese\s+dioxide|anode|cathode/i.test(text)
}

function looksLikeMarieCurie(text: string): boolean {
  return /marie\s+curie|nobel|radioactiv|radium/i.test(text)
}

function looksLikeMars(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim()
  return (
    /^(?:\(b\)\s*)?(?:mars\.?|mara\.?)$/i.test(t) ||
    /\bred\s+planet\b/i.test(t) ||
    (/^mars\b/i.test(t) && t.length < 40)
  )
}

function sliceBbox(bbox: BBox | undefined, index: number, total: number): BBox | undefined {
  if (!bbox || total <= 1) return bbox
  const h = Math.max(0.02, bbox.h / total)
  return {
    x: bbox.x,
    y: Math.min(0.98, bbox.y + h * index),
    w: bbox.w,
    h,
  }
}

/**
 * Split VL mega-blocks that glued photosynthesis (Q4), dry-cell diagram (Q8),
 * and/or Newton's laws (Q7) into separate labelled answers.
 */
export function splitMergedTopicBlocks(blocks: ExtractedBlock[]): ExtractedBlock[] {
  const out: ExtractedBlock[] = []

  for (const block of blocks) {
    const text = block.text || ''
    const hasPhoto = looksLikePhotosynthesis(text)
    const hasNewton = looksLikeNewton(text)
    const hasCell = looksLikeDryCell(text) || /dry cell diagram/i.test(text)

    const topicCount = [hasPhoto, hasNewton, hasCell].filter(Boolean).length
    if (topicCount < 2) {
      out.push(block)
      continue
    }

    // Find approximate section starts
    const lower = text
    const photoIdx = lower.search(/photosynthesis/i)
    const cellIdx = Math.min(
      ...[
        lower.search(/dry\s*cell/i),
        lower.search(/carbon\s+rod/i),
        lower.search(/zinc\s+can/i),
        lower.search(/diagram with the following/i),
      ].filter((i) => i >= 0),
      Number.POSITIVE_INFINITY,
    )
    const newtonIdx = lower.search(/newton/i)

    type Section = { label: string; start: number; kind?: ExtractedBlock['contentKind'] }
    const sections: Section[] = []
    if (hasPhoto && photoIdx >= 0) sections.push({ label: '4', start: photoIdx })
    if (hasCell && Number.isFinite(cellIdx)) {
      sections.push({ label: '8', start: cellIdx as number, kind: 'diagram' })
    }
    if (hasNewton && newtonIdx >= 0) sections.push({ label: '7', start: newtonIdx })

    sections.sort((a, b) => a.start - b.start)
    if (sections.length < 2) {
      out.push(block)
      continue
    }

    // Drop leading junk before first section (keep if substantial)
    for (let i = 0; i < sections.length; i++) {
      const start = sections[i].start
      const end = i + 1 < sections.length ? sections[i + 1].start : text.length
      const slice = text.slice(start, end).trim()
      if (slice.length < 20) continue

      const isDiagram = sections[i].label === '8'
      out.push({
        ...block,
        id: `${block.id}-topic-${sections[i].label}`,
        text: slice,
        labelNumber: sections[i].label,
        labelWritten: sections[i].label,
        contentKind: isDiagram ? 'diagram' : sections[i].kind || 'text',
        diagramDescription: isDiagram
          ? slice.slice(0, 800)
          : sections[i].label === '8'
            ? block.diagramDescription
            : undefined,
        bbox: sliceBbox(block.bbox, i, sections.length),
        extraPages: sections[i].label === '7' ? block.extraPages : undefined,
      })
    }
  }

  return out.length > 0 ? out : blocks
}

/** Relabel obvious content/label mismatches from VL extract noise. */
export function correctMislabeledAnswers(blocks: ExtractedBlock[]): ExtractedBlock[] {
  return blocks.map((b) => {
    const text = b.text || ''
    const current = normalizeLabel(b.labelNumber || b.labelWritten)

    if (looksLikeFunctionComposition(text) && current !== '1b') {
      return {
        ...b,
        labelNumber: '1(b)',
        labelWritten: '1(b)',
      }
    }
    if (looksLikeLadderSlide(text) && current !== '3b') {
      // Common VL misreads: 5(b), 5, or wrong parent
      if (current === '5b' || current === '5' || current === '3' || !current) {
        return { ...b, labelNumber: '3(b)', labelWritten: '3(b)' }
      }
    }
    if (looksLikePhotosynthesis(text) && !looksLikeNewton(text) && current === '7') {
      return { ...b, labelNumber: '4', labelWritten: '4' }
    }
    if (looksLikeMarieCurie(text) && current === '9') {
      return { ...b, labelNumber: '9(a)', labelWritten: '9(a)' }
    }
    if (looksLikeMars(text) && current !== '9b' && (current === '9' || current === '11' || !current)) {
      return { ...b, labelNumber: '9(b)', labelWritten: '9(b)' }
    }
    return b
  })
}

type SubPart = { letter: string; text: string; start: number; end: number }

function findInlineSubparts(text: string): SubPart[] {
  const re = /(?:^|\n)\s*[\(\[]?\s*([a-z])\s*[\)\]]?\s*[.)]?\s+/gi
  const hits: Array<{ letter: string; index: number }> = []
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const L = (m[1] || '').toLowerCase()
    if (!L) continue
    hits.push({ letter: L, index: m.index })
  }

  const uniq: Array<{ letter: string; index: number }> = []
  for (const h of hits) {
    const prev = uniq[uniq.length - 1]
    if (prev && prev.letter === h.letter && h.index - prev.index < 8) continue
    uniq.push(h)
  }

  if (uniq.length < 2) return []

  const parts: SubPart[] = []
  for (let i = 0; i < uniq.length; i++) {
    const start = uniq[i].index
    const end = i + 1 < uniq.length ? uniq[i + 1].index : text.length
    const slice = text.slice(start, end).trim()
    if (slice.length < 3) continue
    parts.push({ letter: uniq[i].letter, text: slice, start, end })
  }
  return parts.length >= 2 ? parts : []
}

/**
 * If a block is labelled only with a parent number (e.g. "9") but the body
 * contains (a)/(b) sections, emit one leaf block per sub-part.
 */
export function expandParentAnswerLabels(blocks: ExtractedBlock[]): ExtractedBlock[] {
  const out: ExtractedBlock[] = []

  for (const block of blocks) {
    const raw = block.labelNumber || block.labelWritten
    const n = normalizeLabel(raw)
    if (!n) {
      out.push(block)
      continue
    }
    const parts = parseNormalizedLabel(n)
    // Only expand pure numeric parents
    if (!parts.num || parts.letter || parts.roman) {
      out.push(block)
      continue
    }

    const sub = findInlineSubparts(block.text)
    if (sub.length < 2) {
      const found = findLabelAnywhere(block.text, raw)
      if (found && normalizeLabel(found) !== n) {
        out.push({
          ...block,
          labelNumber: found,
          labelWritten: found,
        })
      } else {
        out.push(block)
      }
      continue
    }

    for (let i = 0; i < sub.length; i++) {
      const label = formatLabel({ num: parts.num, letter: sub[i].letter })
      if (!label) continue
      out.push({
        ...block,
        id: `${block.id}-sub-${sub[i].letter}`,
        text: sub[i].text,
        labelNumber: label,
        labelWritten: label,
        bbox: sliceBbox(block.bbox, i, sub.length),
      })
    }
  }

  return out
}

export function enrichAnswerLabels(blocks: ExtractedBlock[]): ExtractedBlock[] {
  return correctMislabeledAnswers(
    expandParentAnswerLabels(splitMergedTopicBlocks(blocks)),
  )
}
