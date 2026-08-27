/**
 * Post-extract answer label repair:
 * - Parent label "9" with (a)/(b) sections in text → split into 9(a) / 9(b)
 * - Mislabelled blocks (e.g. "3(b)" that is clearly function composition → "1(b)")
 * - Mega-blocks that glued multiple topics (photosynthesis + dry cell + Newton;
 *   triangle area + plant cell; etc.)
 * - Content→label repair for short GK (largest planet → 4, Ambedkar → 10)
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

/** Right-triangle area calc (often mislabelled as Q2 when glued to plant cell). */
export function looksLikeTriangleArea(text: string): boolean {
  const t = text.toLowerCase().replace(/\\frac\s*\{\s*1\s*\}\s*\{\s*2\s*\}/g, '1/2')
  const hasDims =
    /base\s*[:=]?\s*\d+|height\s*[:=]?\s*\d+|b\s*=\s*\d+|h\s*=\s*\d+/.test(t) ||
    /\b12\s*cm\b/.test(t) ||
    (/12/.test(t) && /9/.test(t) && /54/.test(t))
  const hasFormula =
    /(?:1\s*\/\s*2|\u00bd|0\.5)\s*\*?\s*(?:b|base|\\times|\*|x)/i.test(t) ||
    (/(?:1\s*\/\s*2|\u00bd)/.test(t) && /12/.test(t) && /9/.test(t)) ||
    /a\s*=\s*\(?\s*1\s*\/\s*2/.test(t) ||
    /area\s+of\s+(?:a\s+)?(?:right[- ]angled\s+)?triangle/i.test(t) ||
    /\b54\s*(?:cm|\\text)/.test(t)
  return hasDims && hasFormula
}

/** Plant-cell diagram / organelle list (Q2 on Verna paper). */
export function looksLikePlantCell(text: string): boolean {
  const t = text.toLowerCase()
  // Photosynthesis essays often mention chloroplasts; require explicit plant-cell cue
  if (/photosynthesis/i.test(t) && !/plant\s+cell/i.test(t)) return false
  if (/dry\s*cell/i.test(t) && !/plant\s+cell/i.test(t)) return false
  return (
    /plant\s+cell/i.test(t) ||
    (/cell\s+wall/i.test(t) && /(?:chloroplast|vacuole|nucleus)/i.test(t) && t.length < 400)
  )
}

/** Largest-planet GK (Q4); includes common handwritten typo "Jaipur". */
export function looksLikeLargestPlanet(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim()
  if (t.length > 220) return false
  return (
    /largest\s+planet/i.test(t) ||
    /\bjupiter\b/i.test(t) ||
    /\bjaipur\b/i.test(t) ||
    (/solar\s+system/i.test(t) && /(?:planet|largest)/i.test(t))
  )
}

/** Bicycle / SP / profit calc (Q1 on Verna paper). */
export function looksLikeProfitCalc(text: string): boolean {
  const t = text.toLowerCase()
  return (
    (/profit|selling\s+price|\bsp\b|\bcp\b/i.test(t) &&
      /(?:2400|15\s*%|2760)/i.test(t)) ||
    (/profit/i.test(t) && /selling\s+price|sp\s*[:=]/i.test(t) && /\d{3,}/.test(t))
  )
}

/** Father of the Indian Constitution (Q10). */
export function looksLikeAmbedkar(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim()
  if (t.length > 220) return false
  return (
    /ambedkar/i.test(t) ||
    /father\s+of\s+(?:the\s+)?(?:indian\s+)?constitution/i.test(t)
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

/** True when text describes a drawn/labelled figure, not a one-line definition. */
export function looksLikeDrawnFigureDescription(text: string): boolean {
  const t = text.toLowerCase()
  if (t.length < 40) return false
  if (
    /diagram|labelled|labeled|organelle|smooth\s*er|rough\s*er|golgi|amyloplast|mitochondr|arrow|pointing|drawn|sketch|figure\s+of/i.test(
      t,
    )
  ) {
    return true
  }
  // Long multi-organelle caption (not a short "contains wall, nucleus, …" sentence)
  const organelleHits = [
    'nucleus',
    'chloroplast',
    'vacuole',
    'cell wall',
    'cell membrane',
    'cytoplasm',
    'mitochondrion',
    'golgi',
    'endoplasmic',
  ].filter((w) => t.includes(w)).length
  return organelleHits >= 5 && t.length > 180
}

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

/**
 * Assign diagram metadata for a split slice without inventing diagrams from short prose.
 * Plant-cell organelle descriptions on a parent block go to label "2", not photosynthesis.
 */
export function resolveDiagramMetaForSlice(
  label: string,
  slice: string,
  parentDiagram?: string,
): { contentKind: ExtractedBlock['contentKind']; diagramDescription?: string } {
  const parent = parentDiagram?.trim() || ''

  if (label === '2') {
    if (parent && looksLikePlantOrganelleDiagram(parent)) {
      return { contentKind: 'diagram', diagramDescription: parent }
    }
    if (looksLikeDrawnFigureDescription(slice)) {
      return { contentKind: 'diagram', diagramDescription: slice.slice(0, 800) }
    }
    return { contentKind: 'text', diagramDescription: undefined }
  }

  // Photosynthesis / other non-plant slices
  if (parent && looksLikePhotosynthesisDiagram(parent) && !looksLikePlantOrganelleDiagram(parent)) {
    return { contentKind: 'diagram', diagramDescription: parent }
  }
  if (parent && looksLikePlantOrganelleDiagram(parent)) {
    // Wrong figure glued onto photo answer — drop it
    return { contentKind: 'text', diagramDescription: undefined }
  }
  if (parent && !looksLikePlantOrganelleDiagram(parent)) {
    return { contentKind: 'diagram', diagramDescription: parent }
  }
  return { contentKind: 'text', diagramDescription: undefined }
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

/**
 * Split profit/SP calc (Q1) glued with triangle area (Q8) — common when VL
 * keeps scanning page 1 under a single "1" label.
 */
export function splitProfitTriangleBlocks(blocks: ExtractedBlock[]): ExtractedBlock[] {
  const out: ExtractedBlock[] = []

  for (const block of blocks) {
    const text = block.text || ''
    const hasProfit = looksLikeProfitCalc(text)
    const hasTri = looksLikeTriangleArea(text)
    if (!hasProfit || !hasTri) {
      out.push(block)
      continue
    }

    const profitIdx = Math.min(
      ...[
        text.search(/profit/i),
        text.search(/\bcp\b/i),
        text.search(/2400/),
        text.search(/selling\s+price/i),
      ].filter((i) => i >= 0),
      Number.POSITIVE_INFINITY,
    )
    const triIdx = Math.min(
      ...[
        text.search(/area\s+of\s+(?:a\s+)?(?:right[- ]angled\s+)?triangle/i),
        text.search(/base\s*[:=]?\s*\d+/i),
        text.search(/(?:1\s*\/\s*2|\u00bd)/),
        text.search(/height\s*[:=]?\s*\d+/i),
      ].filter((i) => i >= 0),
      Number.POSITIVE_INFINITY,
    )

    if (!Number.isFinite(profitIdx) || !Number.isFinite(triIdx)) {
      out.push(block)
      continue
    }

    type Section = { label: string; start: number }
    const sections: Section[] =
      (profitIdx as number) < (triIdx as number)
        ? [
            { label: '1', start: profitIdx as number },
            { label: '8', start: triIdx as number },
          ]
        : [
            { label: '8', start: triIdx as number },
            { label: '1', start: profitIdx as number },
          ]

    let emitted = 0
    for (let i = 0; i < sections.length; i++) {
      const start = sections[i].start
      const end = i + 1 < sections.length ? sections[i + 1].start : text.length
      const slice = text.slice(start, end).trim()
      if (slice.length < 12) continue
      emitted++
      out.push({
        ...block,
        id: `${block.id}-pt-${sections[i].label}`,
        text: slice,
        labelNumber: sections[i].label,
        labelWritten: sections[i].label,
        contentKind: 'text',
        diagramDescription: undefined,
        bbox: sliceBbox(block.bbox, i, sections.length),
        extraPages: undefined,
      })
    }
    if (emitted < 2) out.push(block)
  }

  return out.length > 0 ? out : blocks
}

/**
 * Split VL mega-blocks that glued triangle-area (Q8) with plant-cell (Q2).
 * Common on Verna sheets when both sit under a single misread label "2".
 */
export function splitTrianglePlantBlocks(blocks: ExtractedBlock[]): ExtractedBlock[] {
  const out: ExtractedBlock[] = []

  for (const block of blocks) {
    const text = block.text || ''
    const hasTri = looksLikeTriangleArea(text)
    const hasPlant = looksLikePlantCell(text)
    if (!hasTri || !hasPlant) {
      out.push(block)
      continue
    }

    const plantIdx = Math.min(
      ...[
        text.search(/plant\s+cell/i),
        text.search(/cell\s+wall/i),
        text.search(/chloroplasts?/i),
      ].filter((i) => i >= 0),
      Number.POSITIVE_INFINITY,
    )
    const triIdx = Math.min(
      ...[
        text.search(/base\s*[:=]?\s*\d+/i),
        text.search(/(?:1\s*\/\s*2|\u00bd)/),
        text.search(/area/i),
        text.search(/height\s*[:=]?\s*\d+/i),
      ].filter((i) => i >= 0),
      Number.POSITIVE_INFINITY,
    )

    if (!Number.isFinite(plantIdx) || !Number.isFinite(triIdx)) {
      out.push(block)
      continue
    }

    type Section = { label: string; start: number; kind?: ExtractedBlock['contentKind'] }
    const sections: Section[] =
      triIdx < plantIdx
        ? [
            { label: '8', start: triIdx as number },
            { label: '2', start: plantIdx as number, kind: 'diagram' },
          ]
        : [
            { label: '2', start: plantIdx as number, kind: 'diagram' },
            { label: '8', start: triIdx as number },
          ]

    let emitted = 0
    for (let i = 0; i < sections.length; i++) {
      const start = sections[i].start
      const end = i + 1 < sections.length ? sections[i + 1].start : text.length
      const slice = text.slice(start, end).trim()
      if (slice.length < 12) continue
      emitted++
      const meta = resolveDiagramMetaForSlice(
        sections[i].label,
        slice,
        block.diagramDescription,
      )
      out.push({
        ...block,
        id: `${block.id}-tp-${sections[i].label}`,
        text: slice,
        labelNumber: sections[i].label,
        labelWritten: sections[i].label,
        contentKind: meta.diagramDescription
          ? 'diagram'
          : sections[i].kind === 'diagram'
            ? 'text'
            : sections[i].kind || 'text',
        diagramDescription: meta.diagramDescription,
        bbox: sliceBbox(block.bbox, i, sections.length),
        extraPages: undefined,
      })
    }
    if (emitted < 2) out.push(block)
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

    // Verna / mixed papers: triangle area → always Q8 (never 8(a) / 2 / 1)
    if (
      looksLikeTriangleArea(text) &&
      !looksLikePlantCell(text) &&
      !looksLikeProfitCalc(text) &&
      current !== '8'
    ) {
      return { ...b, labelNumber: '8', labelWritten: '8' }
    }
    // Plant cell alone under wrong / missing label (not photosynthesis essays)
    if (
      looksLikePlantCell(text) &&
      !looksLikeTriangleArea(text) &&
      !looksLikePhotosynthesis(text) &&
      current !== '2' &&
      (current === '8' || current === '9' || !current)
    ) {
      return { ...b, labelNumber: '2', labelWritten: '2' }
    }
    // Short GK: largest planet (incl. "Jaipur" typo)
    if (
      looksLikeLargestPlanet(text) &&
      !looksLikePhotosynthesis(text) &&
      current !== '4' &&
      (current === '5' ||
        current === '5a' ||
        current === '3b' ||
        current === '8' ||
        current === '10' ||
        !current)
    ) {
      return { ...b, labelNumber: '4', labelWritten: '4' }
    }
    // Short GK: Ambedkar / Constitution
    if (
      looksLikeAmbedkar(text) &&
      current !== '10' &&
      (current === '4' ||
        current === '5' ||
        current === '5a' ||
        current === '8' ||
        current === '1' ||
        !current)
    ) {
      return { ...b, labelNumber: '10', labelWritten: '10' }
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

/**
 * Split blocks that glued photosynthesis (Q9 on Verna / Q4 on older papers)
 * with a plant-cell organelle dump (Q2).
 */
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

    const current = normalizeLabel(block.labelNumber || block.labelWritten)
    const photoLabel = current === '4' ? '4' : '9'

    type Section = { label: string; start: number; kind?: ExtractedBlock['contentKind'] }
    const sections: Section[] =
      photoIdx < plantIdx
        ? [
            { label: photoLabel, start: photoIdx },
            { label: '2', start: plantIdx, kind: 'diagram' },
          ]
        : [
            { label: '2', start: plantIdx, kind: 'diagram' },
            { label: photoLabel, start: photoIdx },
          ]

    let emitted = 0
    for (let i = 0; i < sections.length; i++) {
      const start = sections[i].start
      const end = i + 1 < sections.length ? sections[i + 1].start : text.length
      const slice = text.slice(start, end).trim()
      if (slice.length < 20) continue
      emitted++
      const meta = resolveDiagramMetaForSlice(
        sections[i].label,
        slice,
        block.diagramDescription,
      )
      out.push({
        ...block,
        id: `${block.id}-pp-${sections[i].label}`,
        text: slice,
        labelNumber: sections[i].label,
        labelWritten: sections[i].label,
        contentKind: meta.diagramDescription
          ? 'diagram'
          : sections[i].kind === 'diagram'
            ? 'text'
            : sections[i].kind || 'text',
        diagramDescription: meta.diagramDescription,
        bbox: sliceBbox(block.bbox, i, sections.length),
      })
    }
    if (emitted < 2) out.push(block)
  }

  return out.length > 0 ? out : blocks
}

export function enrichAnswerLabels(blocks: ExtractedBlock[]): ExtractedBlock[] {
  return correctMislabeledAnswers(
    expandParentAnswerLabels(
      splitPhotoPlantBlocks(
        splitTrianglePlantBlocks(
          splitProfitTriangleBlocks(splitMergedTopicBlocks(blocks)),
        ),
      ),
    ),
  )
}
