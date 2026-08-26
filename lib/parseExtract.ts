import { coerceBbox } from './bboxCheck'
import type { BBox, ExtractedBlock } from './types'

/** Pull a JSON array/object out of messy LLM text. */
export function extractJsonPayload(raw: string): unknown {
  const trimmed = raw.trim()

  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  if (fence?.[1]) {
    try {
      return JSON.parse(fence[1].trim())
    } catch {
      /* fall through */
    }
  }

  try {
    return JSON.parse(trimmed)
  } catch {
    /* fall through */
  }

  const startArr = trimmed.indexOf('[')
  const endArr = trimmed.lastIndexOf(']')
  if (startArr !== -1 && endArr > startArr) {
    try {
      return JSON.parse(trimmed.slice(startArr, endArr + 1))
    } catch {
      /* fall through */
    }
  }

  const startObj = trimmed.indexOf('{')
  const endObj = trimmed.lastIndexOf('}')
  if (startObj !== -1 && endObj > startObj) {
    try {
      return JSON.parse(trimmed.slice(startObj, endObj + 1))
    } catch {
      /* fall through */
    }
  }

  return null
}

type RawBlock = {
  text?: unknown
  label?: unknown
  labelNumber?: unknown
  number?: unknown
  question_number?: unknown
  bbox?: unknown
  bounding_box?: unknown
  bbox_2d?: unknown
  page?: unknown
  pageIndex?: unknown
  marks?: unknown
  maxScore?: unknown
}

/**
 * Recover CBSE-style labels from text start:
 * "19. (a) …", "19(a)", "20 (b) (i)", "Q.21(a)(ii)"
 */
export function inferLabelFromText(text: string): string | undefined {
  const t = text.trim()
  const patterns = [
    /^(?:q(?:uestion)?\.?\s*)?(\d{1,3})\s*[\.\)\-:]?\s*[\(\[]?\s*([a-z])\s*[\)\]]?\s*[\(\[]?\s*((?:i{1,3}|iv|v|vi{0,3}|ix|x))\s*[\)\]]?/i,
    /^(?:q(?:uestion)?\.?\s*)?(\d{1,3})\s*[\.\)\-:]?\s*[\(\[]\s*([a-z])\s*[\)\]]/i,
    /^(?:q(?:uestion)?\.?\s*)?(\d{1,3})\s*[\.\)]\s*/i,
    /^(?:q(?:uestion)?\.?\s*)?(\d{1,3})\s*[\(\[]\s*([a-z])\s*[\)\]]/i,
  ]

  for (const re of patterns) {
    const m = t.match(re)
    if (!m) continue
    const num = m[1]
    const letter = m[2]?.toLowerCase()
    const roman = m[3]?.toLowerCase()
    if (num && letter && roman) return `${num}(${letter})(${roman})`
    if (num && letter) return `${num}(${letter})`
    if (num) return num
  }
  return undefined
}

function pickLabel(item: RawBlock, text: string): string | undefined {
  const candidates = [item.labelNumber, item.label, item.number, item.question_number]
  for (const c of candidates) {
    if (typeof c === 'string' && c.trim()) return c.trim()
    if (typeof c === 'number') return String(c)
  }
  return inferLabelFromText(text)
}

function pickBbox(item: RawBlock): BBox | undefined {
  return (
    coerceBbox(item.bbox) ??
    coerceBbox(item.bounding_box) ??
    coerceBbox(item.bbox_2d) ??
    undefined
  )
}

export function parseExtractedBlocks(
  rawText: string,
  pageIndex: number,
  idPrefix: string,
): ExtractedBlock[] {
  const payload = extractJsonPayload(rawText)
  if (!payload) return []

  let items: RawBlock[] = []
  if (Array.isArray(payload)) {
    items = payload as RawBlock[]
  } else if (typeof payload === 'object' && payload !== null) {
    const obj = payload as Record<string, unknown>
    const nested =
      obj.blocks ?? obj.questions ?? obj.answers ?? obj.items ?? obj.results
    if (Array.isArray(nested)) items = nested as RawBlock[]
    else items = [payload as RawBlock]
  }

  const blocks: ExtractedBlock[] = []
  let i = 0
  for (const item of items) {
    const text =
      typeof item.text === 'string'
        ? item.text.trim()
        : typeof (item as { content?: unknown }).content === 'string'
          ? String((item as { content: string }).content).trim()
          : ''
    if (!text) continue

    const bbox = pickBbox(item)
    const labelNumber = pickLabel(item, text)
    const page =
      typeof item.pageIndex === 'number'
        ? item.pageIndex
        : typeof item.page === 'number'
          ? item.page
          : pageIndex

    blocks.push({
      id: `${idPrefix}-p${page}-${i}`,
      pageIndex: page,
      text,
      labelNumber,
      bbox,
      bboxSource: bbox ? 'qwen' : 'none',
    })
    i += 1
  }

  return blocks
}
