import type { BBox, ExtractedBlock } from './types'

export function isValidBbox(bbox: unknown): bbox is BBox {
  if (!bbox || typeof bbox !== 'object') return false
  const b = bbox as Record<string, unknown>
  const { x, y, w, h } = b
  if (
    typeof x !== 'number' ||
    typeof y !== 'number' ||
    typeof w !== 'number' ||
    typeof h !== 'number'
  ) {
    return false
  }
  if ([x, y, w, h].some((n) => Number.isNaN(n) || !Number.isFinite(n))) return false
  if (x < 0 || y < 0 || w <= 0 || h <= 0) return false
  if (x > 1 || y > 1 || w > 1 || h > 1) return false
  if (x + w > 1.05 || y + h > 1.05) return false
  return true
}

/** Normalize common model bbox shapes into {x,y,w,h} in 0–1 space. */
export function coerceBbox(raw: unknown): BBox | null {
  if (!raw) return null

  if (Array.isArray(raw) && raw.length >= 4) {
    const nums = raw.slice(0, 4).map(Number)
    if (nums.some((n) => Number.isNaN(n))) return null

    // [x1,y1,x2,y2] if x2>x1 and looks like corners
    const [a, b, c, d] = nums
    if (c > a && d > b && c <= 1.05 && d <= 1.05) {
      const box = { x: a, y: b, w: c - a, h: d - b }
      return isValidBbox(box) ? box : null
    }
    // [x,y,w,h]
    const box = { x: a, y: b, w: c, h: d }
    return isValidBbox(box) ? box : null
  }

  if (typeof raw === 'object') {
    const o = raw as Record<string, unknown>
    if ('bbox_2d' in o) return coerceBbox(o.bbox_2d)
    if ('x' in o && 'y' in o && 'w' in o && 'h' in o) {
      const box = {
        x: Number(o.x),
        y: Number(o.y),
        w: Number(o.w),
        h: Number(o.h),
      }
      return isValidBbox(box) ? box : null
    }
    if ('x1' in o && 'y1' in o && 'x2' in o && 'y2' in o) {
      const x1 = Number(o.x1)
      const y1 = Number(o.y1)
      const x2 = Number(o.x2)
      const y2 = Number(o.y2)
      const box = { x: x1, y: y1, w: x2 - x1, h: y2 - y1 }
      return isValidBbox(box) ? box : null
    }
  }

  return null
}

export type BboxCheckResult = {
  valid: ExtractedBlock[]
  invalid: ExtractedBlock[]
}

/** Split blocks into those with valid bboxes and those needing repair.
 *  Preserves STEM fields (mathLatex, diagramDescription, contentKind). */
export function partitionByBbox(blocks: ExtractedBlock[]): BboxCheckResult {
  const valid: ExtractedBlock[] = []
  const invalid: ExtractedBlock[] = []

  for (const block of blocks) {
    const coerced = coerceBbox(block.bbox)
    if (coerced) {
      valid.push({ ...block, bbox: coerced })
    } else {
      invalid.push({ ...block, bbox: undefined, bboxSource: 'none' })
    }
  }

  return { valid, invalid }
}
