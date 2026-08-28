import { coerceContentKind, inferContentKind } from './blockContent'
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
  content?: unknown
  label?: unknown
  labelNumber?: unknown
  labelWritten?: unknown
  label_written?: unknown
  number?: unknown
  question_number?: unknown
  bbox?: unknown
  bounding_box?: unknown
  bbox_2d?: unknown
  page?: unknown
  pageIndex?: unknown
  marks?: unknown
  maxScore?: unknown
  contentKind?: unknown
  content_kind?: unknown
  kind?: unknown
  type?: unknown
  mathLatex?: unknown
  math_latex?: unknown
  latex?: unknown
  formula?: unknown
  diagramDescription?: unknown
  diagram_description?: unknown
  diagram?: unknown
  figureDescription?: unknown
  isStrikethrough?: unknown
  is_strikethrough?: unknown
  strikethrough?: unknown
  crossedOut?: unknown
  crossed_out?: unknown
  tableData?: unknown
  table_data?: unknown
  continuesFrom?: unknown
  continues_from?: unknown
}

/**
 * Recover exam-style labels from text start:
 * "19. (a) …", "19(a)", "20 (b) (i)", or partial "(i)" / "(b)".
 */
export function inferLabelFromText(text: string): string | undefined {
  const t = text.trim()
  const patterns = [
    /^(?:q(?:uestion)?\.?\s*)?(\d{1,3})\s*[\.\)\-:]?\s*[\(\[]?\s*([a-z])\s*[\)\]]?\s*[\(\[]?\s*((?:i{1,3}|iv|v|vi{0,3}|ix|x))\s*[\)\]]?/i,
    /^(?:q(?:uestion)?\.?\s*)?(\d{1,3})\s*[\.\)\-:]?\s*[\(\[]\s*([a-z])\s*[\)\]]/i,
    /^q\s*(\d{1,3})\s*[\(\[]\s*([a-z])\s*[\)\]]/i,
    /^q\s*(\d{1,3})\s*[:.\-–—\s]/i,
    /^(?:q(?:uestion)?\.?\s*)?(\d{1,3})\s*[\.\)]\s*/i,
    /^(?:q(?:uestion)?\.?\s*)?(\d{1,3})\s*[\(\[]\s*([a-z])\s*[\)\]]/i,
    /^\(?\s*([a-z])\s*\)\s*[\(\[]?\s*((?:i{1,3}|iv|v|vi{0,3}|ix|x))\s*[\)\]]?/i,
    /^\(?\s*((?:i{1,3}|iv|v|vi{0,3}|ix|x))\s*\)/i,
    /^\(?\s*([a-z])\s*\)/i,
  ]

  for (const re of patterns) {
    const m = t.match(re)
    if (!m) continue
    if (m[1] && /^\d+$/.test(m[1])) {
      const num = m[1]
      const letter = m[2]?.toLowerCase()
      const roman = m[3]?.toLowerCase()
      if (num && letter && roman) return `${num}(${letter})(${roman})`
      if (num && letter) return `${num}(${letter})`
      if (num) return num
      continue
    }
    if (m[1] && m[2] && /^[a-z]$/i.test(m[1]) && /^(?:i{1,3}|iv|v|vi{0,3}|ix|x)$/i.test(m[2])) {
      return `(${m[1].toLowerCase()})(${m[2].toLowerCase()})`
    }
    if (m[1] && /^(?:i{1,3}|iv|v|vi{0,3}|ix|x)$/i.test(m[1]) && !m[2]) {
      return `(${m[1].toLowerCase()})`
    }
    if (m[1] && /^[a-z]$/i.test(m[1]) && !m[2]) {
      return `(${m[1].toLowerCase()})`
    }
  }
  return undefined
}

function pickLabel(item: RawBlock, text: string): string | undefined {
  const candidates = [
    item.labelWritten,
    item.label_written,
    item.labelNumber,
    item.label,
    item.number,
    item.question_number,
  ]
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

function pickString(...vals: unknown[]): string | undefined {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

function buildText(item: RawBlock): string {
  const base =
    pickString(item.text, item.content) ??
    pickString(item.mathLatex, item.math_latex, item.latex, item.formula) ??
    pickString(item.diagramDescription, item.diagram_description, item.diagram, item.figureDescription) ??
    ''
  return base
}

function pickBool(...vals: unknown[]): boolean {
  for (const v of vals) {
    if (typeof v === 'boolean') return v
    if (typeof v === 'string' && /^(true|yes|1)$/i.test(v.trim())) return true
  }
  return false
}

function pickTableData(raw: unknown): string[][] | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined
  const rows: string[][] = []
  for (const row of raw) {
    if (!Array.isArray(row)) continue
    const cells = row.map((c) => String(c ?? '').trim()).filter(Boolean)
    if (cells.length) rows.push(cells)
  }
  return rows.length ? rows : undefined
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
    const mathLatex = pickString(item.mathLatex, item.math_latex, item.latex, item.formula)
    const diagramDescription = pickString(
      item.diagramDescription,
      item.diagram_description,
      item.diagram,
      item.figureDescription,
    )
    const tableData = pickTableData(item.tableData ?? item.table_data)
    const continuesFrom = pickString(item.continuesFrom, item.continues_from)
    let text = buildText(item)
    if (tableData?.length) {
      const tableText = tableData.map((row) => row.join(' | ')).join('\n')
      text = text ? `${text}\n${tableText}` : tableText
    }
    if (mathLatex && !text.includes(mathLatex) && !/Math \(LaTeX\)/i.test(text)) {
      text = text ? `${text}\n${mathLatex}` : mathLatex
    }
    if (diagramDescription && !text.includes(diagramDescription)) {
      text = text
        ? `${text}\n[Diagram] ${diagramDescription}`
        : `[Diagram] ${diagramDescription}`
    }
    if (!text) continue

    const isStrikethrough = pickBool(
      item.isStrikethrough,
      item.is_strikethrough,
      item.strikethrough,
      item.crossedOut,
      item.crossed_out,
    )

    const contentKind =
      coerceContentKind(item.contentKind) ??
      coerceContentKind(item.content_kind) ??
      coerceContentKind(item.kind) ??
      coerceContentKind(item.type) ??
      inferContentKind({ text, mathLatex, diagramDescription })

    const bbox = pickBbox(item)
    const labelWritten = pickString(item.labelWritten, item.label_written)
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
      labelWritten,
      bbox,
      bboxSource: bbox ? 'qwen' : 'none',
      contentKind: tableData?.length && contentKind === 'text' ? 'table' : contentKind,
      mathLatex,
      diagramDescription,
      tableData,
      continuesFrom,
      isStrikethrough: isStrikethrough || undefined,
    })
    i += 1
  }

  return blocks
}
