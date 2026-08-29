/**
 * Post-extract answer repair (paper-agnostic):
 * - Split glued blocks by visible inline labels or topic boundaries
 * - Expand parent labels with (a)/(b) sub-parts
 * - When question paper is available, assign/repair labels from question content
 */

import {
  diagramRichness,
  looksLikeDrawnFigureDescription,
  looksLikeDryCell,
  looksLikeNewton,
  looksLikePhotosynthesis,
  looksLikePlantCell,
  looksLikeStandaloneShortAnswer,
  looksLikeTriangleArea,
  looksLikeProfitCalc,
  topicsConflictText,
} from './contentTopics'
import { findLabelAnywhere } from './findLabel'
import { assignLabelsFromQuestions, validateAnswerLabels } from './questionIndex'
import { formatLabel, normalizeLabel, parseNormalizedLabel } from './normalizeLabel'
import { sliceBboxByTextRange, sliceBboxEqual } from './bboxRepair'
import type { ExtractedBlock } from './types'

// Re-export content detectors for backward-compatible imports
export {
  looksLikeAmbedkar,
  looksLikeDrawnFigureDescription,
  looksLikeLargestPlanet,
  looksLikePlantCell,
  looksLikeProfitCalc,
  looksLikeSodiumPeriodic,
  looksLikeTriangleArea,
} from './contentTopics'

type InlineLabelHit = { label: string; start: number }

function blockLabelSource(block: ExtractedBlock): string {
  return [block.text, block.diagramDescription].filter(Boolean).join('\n')
}

/** Find mid-block answer labels from visible numbering on the sheet. */
function findInlineAnswerLabels(text: string): InlineLabelHit[] {
  const hits: InlineLabelHit[] = []
  const seenStarts = new Set<number>()

  const push = (label: string, start: number) => {
    if (seenStarts.has(start)) return
    seenStarts.add(start)
    hits.push({ label, start })
  }

  let m: RegExpExecArray | null

  const subRe = /(?:^|\n)\s*(?:Q\s*)?(\d{1,2})\s*[\(\[]\s*([a-z])\s*[\)\]]\s*/gi
  while ((m = subRe.exec(text)) !== null) {
    push(`${m[1]}(${m[2].toLowerCase()})`, m.index)
  }

  const parenRe = /(?:^|\n)\s*(?:Q\s*)?(\d{1,2})\s*\)\s*/gi
  while ((m = parenRe.exec(text)) !== null) {
    push(m[1], m.index)
  }

  const dotRe = /(?:^|\n)\s*(?:Q\s*)?(\d{1,2})\s*\.\s+(?=[A-Za-z])/gi
  while ((m = dotRe.exec(text)) !== null) {
    push(m[1], m.index)
  }

  const bareRe = /(?:^|\n)\s*(10)\s+(?=[A-Za-z])/gi
  while ((m = bareRe.exec(text)) !== null) {
    push('10', m.index)
  }

  const spacedSubRe = /(?:^|\n)\s*(\d{1,2})\s+([a-z])\s*[\):.]/gi
  while ((m = spacedSubRe.exec(text)) !== null) {
    push(`${m[1]}(${m[2].toLowerCase()})`, m.index)
  }

  hits.sort((a, b) => a.start - b.start)
  return hits
}

export function splitInlineLabeledAnswerBlocks(blocks: ExtractedBlock[]): ExtractedBlock[] {
  const out: ExtractedBlock[] = []

  for (const block of blocks) {
    const source = blockLabelSource(block)
    const hits = findInlineAnswerLabels(source)
    if (hits.length < 2) {
      out.push(block)
      continue
    }

    // Prefer parent (a)/(b) expansion over numeric inline splits when both present
    if (/\(\s*[a-z]\s*\)/i.test(source) && hits.every((h) => /^\d+$/.test(h.label))) {
      out.push(block)
      continue
    }

    let emitted = 0
    for (let i = 0; i < hits.length; i++) {
      const start = hits[i].start
      const end = i + 1 < hits.length ? hits[i + 1].start : source.length
      const slice = source.slice(start, end).trim()
      if (slice.length < 6) continue
      emitted++
      out.push({
        ...block,
        id: `${block.id}-inline-${hits[i].label}-${i}`,
        text: slice,
        labelNumber: hits[i].label,
        labelWritten: hits[i].label,
        bbox: sliceBboxByTextRange(block.bbox, start, end, source.length),
        extraPages: undefined,
      })
    }
    if (emitted < 2) out.push(block)
  }

  return out.length > 0 ? out : blocks
}

/**
 * Peel short standalone answer lines out of a longer glued block (unlabeled slices).
 */
export function splitEmbeddedShortLines(blocks: ExtractedBlock[]): ExtractedBlock[] {
  const out: ExtractedBlock[] = []

  for (const block of blocks) {
    const lines = (block.text || '').split(/\n+/).map((l) => l.trim()).filter(Boolean)
    if (lines.length < 2) {
      out.push(block)
      continue
    }

    const peeled: string[] = []
    const rest: string[] = []
    const restJoined = () => rest.join('\n')

    for (const line of lines) {
      const isShort =
        line.length <= 180 &&
        looksLikeStandaloneShortAnswer(line) &&
        !looksLikeDrawnFigureDescription(line) &&
        !/^(?:check|def |import |print |for |if )/i.test(line)

      if (isShort && restJoined().length >= 8 && topicsConflictText(restJoined(), line)) {
        peeled.push(line)
        continue
      }
      if (isShort && rest.length === 0 && lines.length > 1) {
        const other = lines.slice(1).join('\n')
        if (topicsConflictText(other, line)) {
          peeled.push(line)
          continue
        }
      }
      rest.push(line)
    }

    if (peeled.length === 0 || (rest.length === 0 && peeled.length > 0)) {
      out.push(block)
      continue
    }

    if (rest.join('\n').trim().length >= 8) {
      out.push({ ...block, text: rest.join('\n') })
    }

    for (let i = 0; i < peeled.length; i++) {
      out.push({
        ...block,
        id: `${block.id}-short-${i}`,
        text: peeled[i],
        labelNumber: undefined,
        labelWritten: undefined,
        bbox: sliceBboxEqual(block.bbox, i, peeled.length + 1),
        diagramDescription: undefined,
        mathLatex: undefined,
        contentKind: 'text',
        extraPages: undefined,
      })
    }
  }

  return out.length > 0 ? out : blocks
}

/** @deprecated alias */
export const splitEmbeddedShortGkAnswers = splitEmbeddedShortLines

export function dedupeSameLabelRichBlocks(blocks: ExtractedBlock[]): ExtractedBlock[] {
  const byLabel = new Map<string, ExtractedBlock[]>()
  for (const block of blocks) {
    const label = normalizeLabel(block.labelNumber || block.labelWritten)
    if (!label) continue
    const list = byLabel.get(label) ?? []
    list.push(block)
    byLabel.set(label, list)
  }

  const dropIds = new Set<string>()
  for (const [, group] of byLabel) {
    if (group.length < 2) continue
    const ranked = [...group].sort((a, b) => diagramRichness(b) - diagramRichness(a))
    for (let i = 1; i < ranked.length; i++) dropIds.add(ranked[i].id)
  }

  return dropIds.size > 0 ? blocks.filter((b) => !dropIds.has(b.id)) : blocks
}

/** @deprecated alias */
export const dedupeSameLabelPlantBlocks = dedupeSameLabelRichBlocks

function looksLikePlantOrganelleDiagram(desc: string): boolean {
  const t = desc.toLowerCase()
  if (!t.trim()) return false
  const plantish =
    /plant\s+cell|organelle|smooth\s*er|rough\s*er|golgi|amyloplast|chloroplast|vacuole|cell\s+wall|cell\s+membrane/i.test(
      t,
    )
  const photoProcess =
    /sunlight|glucose|6\s*co|inputs?\s+and\s+outputs?|photosynthesis\s+process/i.test(t)
  return plantish && !photoProcess
}

function looksLikePhotosynthesisDiagram(desc: string): boolean {
  const t = desc.toLowerCase()
  return /sunlight|glucose|6\s*co|inputs?\s+and\s+outputs?|o\s*2|water\s+in|photosynthesis/i.test(t)
}

export function resolveDiagramMetaForSlice(
  slice: string,
  parentDiagram?: string,
): { contentKind: ExtractedBlock['contentKind']; diagramDescription?: string } {
  const parent = parentDiagram?.trim() || ''

  if (looksLikePlantCell(slice)) {
    if (parent && looksLikePlantOrganelleDiagram(parent)) {
      return { contentKind: 'diagram', diagramDescription: parent }
    }
    if (looksLikeDrawnFigureDescription(slice)) {
      return { contentKind: 'diagram', diagramDescription: slice.slice(0, 800) }
    }
    return { contentKind: 'text', diagramDescription: undefined }
  }

  if (looksLikePhotosynthesis(slice)) {
    if (parent && looksLikePhotosynthesisDiagram(parent) && !looksLikePlantOrganelleDiagram(parent)) {
      return { contentKind: 'diagram', diagramDescription: parent }
    }
    return { contentKind: 'text', diagramDescription: undefined }
  }

  if (parent && !looksLikePlantOrganelleDiagram(parent)) {
    return { contentKind: 'diagram', diagramDescription: parent }
  }
  return { contentKind: 'text', diagramDescription: undefined }
}

function splitAtTopicBoundaries(
  block: ExtractedBlock,
  sections: Array<{ start: number; kind?: ExtractedBlock['contentKind'] }>,
  idPrefix: string,
): ExtractedBlock[] {
  if (sections.length < 2) return [block]

  const text = block.text || ''
  sections.sort((a, b) => a.start - b.start)
  const out: ExtractedBlock[] = []
  let emitted = 0

  for (let i = 0; i < sections.length; i++) {
    const start = sections[i].start
    const end = i + 1 < sections.length ? sections[i + 1].start : text.length
    const slice = text.slice(start, end).trim()
    if (slice.length < 12) continue
    emitted++
    const meta = resolveDiagramMetaForSlice(slice, block.diagramDescription)
    out.push({
      ...block,
      id: `${block.id}-${idPrefix}-${i}`,
      text: slice,
      labelNumber: undefined,
      labelWritten: undefined,
      contentKind: meta.diagramDescription ? 'diagram' : sections[i].kind || meta.contentKind,
      diagramDescription: meta.diagramDescription,
      bbox: sliceBboxByTextRange(block.bbox, start, end, text.length),
      extraPages: undefined,
    })
  }

  return emitted >= 2 ? out : [block]
}

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

    const lower = text
    const sections: Array<{ start: number; kind?: ExtractedBlock['contentKind'] }> = []
    const photoIdx = lower.search(/photosynthesis/i)
    const cellIdx = Math.min(
      ...[
        lower.search(/dry\s*cell/i),
        lower.search(/carbon\s+rod/i),
        lower.search(/zinc\s+can/i),
      ].filter((i) => i >= 0),
      Number.POSITIVE_INFINITY,
    )
    const newtonIdx = lower.search(/newton/i)
    if (hasPhoto && photoIdx >= 0) sections.push({ start: photoIdx })
    if (hasCell && Number.isFinite(cellIdx)) sections.push({ start: cellIdx as number, kind: 'diagram' })
    if (hasNewton && newtonIdx >= 0) sections.push({ start: newtonIdx })

    out.push(...splitAtTopicBoundaries(block, sections, 'topic'))
  }

  return out.length > 0 ? out : blocks
}

export function splitProfitTriangleBlocks(blocks: ExtractedBlock[]): ExtractedBlock[] {
  const out: ExtractedBlock[] = []

  for (const block of blocks) {
    const text = block.text || ''
    if (!looksLikeProfitCalc(text) || !looksLikeTriangleArea(text)) {
      out.push(block)
      continue
    }

    const profitIdx = Math.min(
      ...[text.search(/profit/i), text.search(/\bcp\b/i), text.search(/selling\s+price/i)].filter(
        (i) => i >= 0,
      ),
      Number.POSITIVE_INFINITY,
    )
    const triIdx = Math.min(
      ...[
        text.search(/area\s+of\s+(?:a\s+)?(?:right[- ]angled\s+)?triangle/i),
        text.search(/base\s*[:=]?\s*\d+/i),
        text.search(/(?:1\s*\/\s*2|\u00bd)/),
      ].filter((i) => i >= 0),
      Number.POSITIVE_INFINITY,
    )

    if (!Number.isFinite(profitIdx) || !Number.isFinite(triIdx)) {
      out.push(block)
      continue
    }

    const sections =
      (profitIdx as number) < (triIdx as number)
        ? [{ start: profitIdx as number }, { start: triIdx as number }]
        : [{ start: triIdx as number }, { start: profitIdx as number }]

    out.push(...splitAtTopicBoundaries(block, sections, 'pt'))
  }

  return out.length > 0 ? out : blocks
}

export function splitTrianglePlantBlocks(blocks: ExtractedBlock[]): ExtractedBlock[] {
  const out: ExtractedBlock[] = []

  for (const block of blocks) {
    const text = block.text || ''
    if (!looksLikeTriangleArea(text) || !looksLikePlantCell(text)) {
      out.push(block)
      continue
    }

    const plantIdx = Math.min(
      ...[text.search(/plant\s+cell/i), text.search(/cell\s+wall/i)].filter((i) => i >= 0),
      Number.POSITIVE_INFINITY,
    )
    const triIdx = Math.min(
      ...[
        text.search(/base\s*[:=]?\s*\d+/i),
        text.search(/(?:1\s*\/\s*2|\u00bd)/),
        text.search(/area/i),
      ].filter((i) => i >= 0),
      Number.POSITIVE_INFINITY,
    )

    if (!Number.isFinite(plantIdx) || !Number.isFinite(triIdx)) {
      out.push(block)
      continue
    }

    const sections =
      triIdx < plantIdx
        ? [{ start: triIdx as number }, { start: plantIdx as number, kind: 'diagram' as const }]
        : [{ start: plantIdx as number, kind: 'diagram' as const }, { start: triIdx as number }]

    out.push(...splitAtTopicBoundaries(block, sections, 'tp'))
  }

  return out.length > 0 ? out : blocks
}

export function splitPhotoPlantBlocks(blocks: ExtractedBlock[]): ExtractedBlock[] {
  const out: ExtractedBlock[] = []

  for (const block of blocks) {
    const text = block.text || ''
    const hasPhoto = looksLikePhotosynthesis(text)
    const hasPlant = /plant\s+cell/i.test(text)
    if (!hasPhoto || !hasPlant) {
      out.push(block)
      continue
    }

    const photoIdx = text.search(/photosynthesis/i)
    const plantIdx = text.search(/plant\s+cell/i)
    if (photoIdx < 0 || plantIdx < 0 || Math.abs(photoIdx - plantIdx) < 20) {
      out.push(block)
      continue
    }

    const sections =
      photoIdx < plantIdx
        ? [{ start: photoIdx }, { start: plantIdx, kind: 'diagram' as const }]
        : [{ start: plantIdx, kind: 'diagram' as const }, { start: photoIdx }]

    out.push(...splitAtTopicBoundaries(block, sections, 'pp'))
  }

  return out.length > 0 ? out : blocks
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
    if (!parts.num || parts.letter || parts.roman) {
      out.push(block)
      continue
    }
    if (!/\(\s*[a-z]\s*\)/i.test(block.text || '')) {
      out.push(block)
      continue
    }

    const sub = findInlineSubparts(block.text)
    if (sub.length < 2) {
      const found = findLabelAnywhere(block.text, raw)
      if (found && normalizeLabel(found) !== n) {
        out.push({ ...block, labelNumber: found, labelWritten: found })
      } else {
        out.push(block)
      }
      continue
    }

    for (let i = 0; i < sub.length; i++) {
      const label = formatLabel({ num: parts.num, letter: sub[i].letter })
      if (!label) continue
      const start = block.text.indexOf(sub[i].text)
      const end = start >= 0 ? start + sub[i].text.length : block.text.length
      out.push({
        ...block,
        id: `${block.id}-sub-${sub[i].letter}`,
        text: sub[i].text,
        labelNumber: label,
        labelWritten: label,
        bbox:
          start >= 0
            ? sliceBboxByTextRange(block.bbox, start, end, block.text.length)
            : sliceBboxEqual(block.bbox, i, sub.length),
      })
    }
  }

  return out
}

/** Structural repair only — no question-paper-specific label assignment. */
export function structuralEnrichAnswers(blocks: ExtractedBlock[]): ExtractedBlock[] {
  return dedupeSameLabelRichBlocks(
    splitEmbeddedShortLines(
      expandParentAnswerLabels(
        splitInlineLabeledAnswerBlocks(
          splitPhotoPlantBlocks(
            splitTrianglePlantBlocks(
              splitProfitTriangleBlocks(splitMergedTopicBlocks(blocks)),
            ),
          ),
        ),
      ),
    ),
  )
}

/**
 * Full answer enrich: structural splits, then question-driven label assignment when
 * the question paper is available (map stage).
 */
export function enrichAnswerLabels(
  blocks: ExtractedBlock[],
  questions?: ExtractedBlock[],
): ExtractedBlock[] {
  let result = structuralEnrichAnswers(blocks)
  if (questions?.length) {
    result = assignLabelsFromQuestions(result, questions)
    result = validateAnswerLabels(result, questions).answers
  }
  return result
}

/** @deprecated — use assignLabelsFromQuestions via enrichAnswerLabels(answers, questions) */
export function correctMislabeledAnswers(blocks: ExtractedBlock[]): ExtractedBlock[] {
  return blocks
}
