import { blockContentForModel } from './blockContent'
import { isValidBbox } from './bboxCheck'
import type { BBox, ExtractedBlock, MappedPair, PageImage } from './types'

const DEFAULT_PAD = 0.012

/** Expand bbox slightly so highlights do not clip handwriting at edges. */
export function padBbox(bbox: BBox, pad = DEFAULT_PAD): BBox {
  const x = Math.max(0, bbox.x - pad)
  const y = Math.max(0, bbox.y - pad)
  const w = Math.min(1 - x, bbox.w + pad * 2)
  const h = Math.min(1 - y, bbox.h + pad * 2)
  return { x, y, w, h }
}

/** Slice parent bbox proportionally to a character range within combined text. */
export function sliceBboxByTextRange(
  bbox: BBox | undefined,
  start: number,
  end: number,
  totalLen: number,
): BBox | undefined {
  if (!bbox || totalLen <= 0 || end <= start) return bbox
  const startFrac = Math.max(0, Math.min(1, start / totalLen))
  const endFrac = Math.max(startFrac, Math.min(1, end / totalLen))
  const span = Math.max(0.02, endFrac - startFrac)
  return {
    x: bbox.x,
    y: Math.min(0.98, bbox.y + bbox.h * startFrac),
    w: bbox.w,
    h: Math.min(0.98, bbox.h * span),
  }
}

/** Equal vertical slices — prefer sliceBboxByTextRange when char offsets are known. */
export function sliceBboxEqual(
  bbox: BBox | undefined,
  index: number,
  total: number,
): BBox | undefined {
  if (!bbox || total <= 1) return bbox
  const h = Math.max(0.02, bbox.h / total)
  return {
    x: bbox.x,
    y: Math.min(0.98, bbox.y + h * index),
    w: bbox.w,
    h,
  }
}

export function bboxesAreSpatiallySeparate(a: BBox, b: BBox, minGap = 0.04): boolean {
  const aBottom = a.y + a.h
  const bBottom = b.y + b.h
  if (b.y >= aBottom + minGap) return true
  if (a.y >= bBottom + minGap) return true
  return false
}

/** Blocks created by structural enrich splits — bbox needs re-localization. */
export function isSplitDerivedBlockId(id: string): boolean {
  return /-(?:inline|short|topic|split|peel|sub|plant|tri|profit|photo)-/i.test(id)
}

export function blockNeedsBboxRelocalize(block: ExtractedBlock): boolean {
  if (!block.bbox || !isValidBbox(block.bbox)) return true
  if (isSplitDerivedBlockId(block.id)) return true
  if (block.bboxSource === 'none') return true
  const content = blockContentForModel(block)
  const short = content.length < 280
  if (short && block.bbox.h > 0.35) return true
  if (block.contentKind === 'text' && block.bbox.h > 0.55 && content.length < 600) return true
  return false
}

/** Page indices that need HF re-localize after mapping (for per-page repair calls). */
export function pageIndicesForPairBboxRepair(pairs: MappedPair[]): number[] {
  const indices = new Set<number>()
  for (const pair of pairs) {
    if (pair.status !== 'matched' || !pair.answer) continue
    if (blockNeedsBboxRelocalize(pair.answer)) indices.add(pair.answer.pageIndex)
  }
  return [...indices].sort((a, b) => a - b)
}

/** Re-localize answer bboxes in matched pairs after map-time splits. */
export async function repairMappedPairBboxes(
  pairs: MappedPair[],
  pages: PageImage[],
): Promise<MappedPair[]> {
  if (!pages.length || !process.env.HF_TOKEN) return pairs

  const toRepair: ExtractedBlock[] = []
  const seen = new Set<string>()

  const pageIndexSet = new Set(pages.map((p) => p.pageIndex))

  for (const pair of pairs) {
    if (pair.status !== 'matched' || !pair.answer) continue
    const answer = pair.answer
    if (!pageIndexSet.has(answer.pageIndex)) continue
    if (!blockNeedsBboxRelocalize(answer)) continue
    if (seen.has(answer.id)) continue
    seen.add(answer.id)
    toRepair.push(answer)
  }

  if (toRepair.length === 0) return pairs

  try {
    const { repairBlocksWithHf } = await import('./hf-qwen')
    const repaired = await repairBlocksWithHf(toRepair, pages)
    const byId = new Map(repaired.map((b) => [b.id, b]))
    return pairs.map((pair) => {
      if (!pair.answer) return pair
      const fixed = byId.get(pair.answer.id)
      if (!fixed?.bbox) return pair
      return { ...pair, answer: fixed }
    })
  } catch (err) {
    console.warn('[bbox] post-map repair skipped:', err)
    return pairs
  }
}

/** Apply display padding to a block bbox (non-destructive for storage). */
export function displayBbox(block: ExtractedBlock | null | undefined): BBox | null {
  if (!block?.bbox || !isValidBbox(block.bbox)) return null
  return padBbox(block.bbox)
}
