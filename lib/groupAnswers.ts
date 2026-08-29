import { bboxesAreSpatiallySeparate } from './bboxRepair'
import { inferContentKind } from './blockContent'
import {
  looksLikeAmbedkar,
  looksLikeLargestPlanet,
  looksLikePlantCell,
  looksLikeProfitCalc,
  looksLikeSodiumPeriodic,
  looksLikeStandaloneShortAnswer,
  looksLikeTriangleArea,
} from './contentTopics'
import { findLabelAnywhere } from './findLabel'
import { normalizeLabel } from './normalizeLabel'
import type { BBox, ExtractedBlock } from './types'

function clean(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function normalizeForDedupe(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function textOverlapRatio(a: string, b: string): number {
  const na = normalizeForDedupe(a)
  const nb = normalizeForDedupe(b)
  if (!na || !nb) return 0
  if (na === nb) return 1
  if (na.includes(nb) || nb.includes(na)) {
    return Math.min(na.length, nb.length) / Math.max(na.length, nb.length)
  }
  const wa = new Set(na.split(' ').filter((w) => w.length > 2))
  const wb = new Set(nb.split(' ').filter((w) => w.length > 2))
  if (wa.size === 0 || wb.size === 0) return 0
  let inter = 0
  for (const w of wa) if (wb.has(w)) inter += 1
  return (2 * inter) / (wa.size + wb.size)
}

function unionBbox(a?: BBox, b?: BBox): BBox | undefined {
  if (!a) return b
  if (!b) return a
  const x1 = Math.min(a.x, b.x)
  const y1 = Math.min(a.y, b.y)
  const x2 = Math.max(a.x + a.w, b.x + b.w)
  const y2 = Math.max(a.y + a.h, b.y + b.h)
  return { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
}

function looksLikeDiagramLabel(text: string, target: ExtractedBlock): boolean {
  const t = clean(text)
  return (
    target.contentKind === 'diagram' ||
    /^(?:cap|anode|cathode|electrolyte|zinc|carbon|rod|metal|positive|negative|label)/i.test(t) ||
    (t.length < 60 && /diagram|cell|battery|figure/i.test(target.text))
  )
}

function mergeInto(target: ExtractedBlock, next: ExtractedBlock): ExtractedBlock {
  const nextText = next.text.trim()
  const already = target.text.includes(nextText)
  const text = already
    ? target.text
    : [target.text.trim(), nextText].filter(Boolean).join('\n')

  const mathLatex =
    [target.mathLatex, next.mathLatex]
      .filter((s): s is string => Boolean(s?.trim()))
      .filter((s, i, arr) => arr.indexOf(s) === i)
      .join('\n') || undefined

  let diagramDescription = target.diagramDescription
  if (looksLikeDiagramLabel(nextText, target) || next.contentKind === 'diagram') {
    const parts = [target.diagramDescription]
    if (next.diagramDescription) parts.push(next.diagramDescription)
    else if (nextText && !target.diagramDescription?.includes(nextText)) parts.push(nextText)
    diagramDescription = parts.filter(Boolean).join('; ') || undefined
  } else if (next.diagramDescription) {
    diagramDescription =
      [target.diagramDescription, next.diagramDescription].filter(Boolean).join('\n') ||
      undefined
  }

  const contentKind = inferContentKind({
    text,
    mathLatex,
    diagramDescription,
    contentKind:
      target.contentKind === 'diagram' || next.contentKind === 'diagram'
        ? 'diagram'
        : target.contentKind === next.contentKind
          ? target.contentKind
          : 'mixed',
  })

  const extraPages = [...(target.extraPages ?? [])]
  if (next.pageIndex !== target.pageIndex && next.bbox) {
    extraPages.push({ pageIndex: next.pageIndex, bbox: next.bbox })
  } else if (next.extraPages?.length) {
    extraPages.push(...next.extraPages)
  }

  return {
    ...target,
    text,
    mathLatex,
    diagramDescription,
    contentKind,
    bbox: unionBbox(target.bbox, next.bbox),
    bboxSource: target.bbox || next.bbox ? target.bboxSource || next.bboxSource : 'none',
    extraPages: extraPages.length ? extraPages : undefined,
    isStrikethrough: false,
    labelNumber: target.labelNumber || next.labelNumber,
    labelWritten: target.labelWritten || next.labelWritten,
  }
}

export function dedupeAnswerBlocks(blocks: ExtractedBlock[]): ExtractedBlock[] {
  const out: ExtractedBlock[] = []
  for (const block of blocks) {
    const nextNorm = normalizeLabel(block.labelNumber || block.labelWritten)
    const idx = out.findIndex((prev) => {
      const prevNorm = normalizeLabel(prev.labelNumber || prev.labelWritten)
      if (prevNorm && nextNorm && prevNorm !== nextNorm) return false
      return textOverlapRatio(prev.text, block.text) >= 0.82
    })
    if (idx < 0) {
      out.push(block)
      continue
    }
    const prev = out[idx]
    const prevLabeled = Boolean(prev.labelNumber || prev.labelWritten)
    const nextLabeled = Boolean(block.labelNumber || block.labelWritten)
    if ((!prevLabeled && nextLabeled) || block.text.length > prev.text.length * 1.1) {
      out[idx] = {
        ...block,
        labelNumber: block.labelNumber || prev.labelNumber,
        labelWritten: block.labelWritten || prev.labelWritten,
      }
    } else if (nextLabeled && !prev.labelNumber) {
      out[idx] = {
        ...prev,
        labelNumber: block.labelNumber || prev.labelNumber,
        labelWritten: block.labelWritten || prev.labelWritten,
      }
    }
  }
  return out
}

function topicsConflictForMerge(current: ExtractedBlock, next: ExtractedBlock): boolean {
  const ct = current.text || ''
  const nt = next.text || ''
  if (looksLikeStandaloneShortAnswer(nt)) return true
  if (looksLikeTriangleArea(nt) && !looksLikeTriangleArea(ct)) return true
  if (looksLikePlantCell(nt) && !looksLikePlantCell(ct)) return true
  if (looksLikeProfitCalc(nt) && !looksLikeProfitCalc(ct)) return true
  if (looksLikeTriangleArea(nt) && looksLikePlantCell(ct)) return true
  if (looksLikePlantCell(nt) && looksLikeTriangleArea(ct)) return true
  if (looksLikeLargestPlanet(nt) && !looksLikeLargestPlanet(ct)) return true
  if (looksLikeAmbedkar(nt) && !looksLikeAmbedkar(ct)) return true
  if (looksLikeSodiumPeriodic(nt) && !looksLikeSodiumPeriodic(ct)) return true
  return false
}

/**
 * Group consecutive answer lines under the last strong question label.
 * Does not assign labels from content — that happens at map time with the question paper.
 */
export function groupAnswersByLabel(blocks: ExtractedBlock[]): ExtractedBlock[] {
  const usable = blocks.filter((b) => !b.isStrikethrough && clean(b.text).length > 0)
  if (usable.length === 0) return []

  const groups: ExtractedBlock[] = []
  let current: ExtractedBlock | null = null

  for (const block of usable) {
    const strong =
      findLabelAnywhere(block.text, block.labelWritten || block.labelNumber) ||
      undefined

    if (strong) {
      if (current) groups.push(current)
      current = {
        ...block,
        labelNumber: strong,
        labelWritten: block.labelWritten || strong,
        isStrikethrough: false,
      }
      continue
    }

    if (
      current &&
      current.bbox &&
      block.bbox &&
      bboxesAreSpatiallySeparate(current.bbox, block.bbox)
    ) {
      groups.push(current)
      current = { ...block }
      continue
    }

    if (current && !topicsConflictForMerge(current, block)) {
      current = mergeInto(current, block)
      continue
    }

    if (current) {
      groups.push(current)
      current = null
    }
    groups.push({ ...block })
  }

  if (current) groups.push(current)

  const byLabel: ExtractedBlock[] = []
  for (const g of groups) {
    const prev = byLabel[byLabel.length - 1]
    const same =
      prev &&
      prev.labelNumber &&
      g.labelNumber &&
      prev.labelNumber.replace(/\s/g, '').toLowerCase() ===
        g.labelNumber.replace(/\s/g, '').toLowerCase()
    if (same && prev) {
      byLabel[byLabel.length - 1] = mergeInto(prev, g)
    } else {
      byLabel.push(g)
    }
  }

  return dedupeAnswerBlocks(byLabel)
}

export function extractStrongAnswerLabel(block: ExtractedBlock): string | undefined {
  return findLabelAnywhere(block.text, block.labelWritten || block.labelNumber)
}
