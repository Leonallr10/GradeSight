import { InferenceClient } from '@huggingface/inference'
import { coerceBbox } from './bboxCheck'
import { blockContentForModel } from './blockContent'
import { EXTRACT_PROMPT, extractRoleHint, isProviderCreditError, isProviderPermissionError, SUPPLEMENT_MISSED_ANSWERS_HINT } from './extractPrompt'
import { filterExtractedBlocks } from './filterExamBlocks'
import { normalizeLabel } from './normalizeLabel'
import { extractJsonPayload, parseExtractedBlocks } from './parseExtract'
import type { BBox, DocumentRole, ExtractedBlock, PageImage } from './types'

/** Default VL model — append `:provider` (e.g. `:novita`) per HF Inference Providers settings. */
const DEFAULT_VL_MODEL = 'meta-llama/Llama-4-Scout-17B-16E-Instruct:novita'

function getClient() {
  const token = process.env.HF_TOKEN
  if (!token) {
    throw new Error('HF_TOKEN is not set')
  }
  return new InferenceClient(token)
}

function getModel() {
  return process.env.HF_QWEN_MODEL || DEFAULT_VL_MODEL
}

function stripDataUrl(imageBase64: string): { mime: string; data: string } {
  const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (match) {
    return { mime: match[1], data: match[2] }
  }
  return { mime: 'image/png', data: imageBase64.replace(/^data:[^;]+;base64,/, '') }
}

function hfErrorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return String(err)
  const e = err as {
    message?: string
    httpResponse?: { status?: number; body?: { error?: { message?: string } | string } }
  }
  const body = e.httpResponse?.body
  const nested =
    typeof body?.error === 'string'
      ? body.error
      : body?.error && typeof body.error === 'object'
        ? body.error.message
        : undefined
  if (nested) {
    const status = e.httpResponse?.status
    return status ? `HF ${status}: ${nested}` : nested
  }
  return e.message || String(err)
}

function formatHfExtractError(detail: string, model: string): string {
  if (isProviderPermissionError(detail)) {
    return `${detail} (model=${model}). Create a fine-grained token at huggingface.co/settings/tokens with "Make calls to Inference Providers" enabled, then update HF_TOKEN in .env.local.`
  }
  if (isProviderCreditError(detail)) {
    return `${detail} (model=${model}). Hugging Face Inference credits are exhausted — add credits at huggingface.co/settings/billing, or enable legacy local extract (USE_LEGACY_LOCAL_EXTRACT=1 + LOCAL_EXTRACT_URL).`
  }
  return `${detail} (model=${model}). Check HF_TOKEN and HF_QWEN_MODEL, or enable a VL provider for this model in Hugging Face settings.`
}

export async function extractPageWithQwen(
  page: PageImage,
  role: DocumentRole,
  idPrefix: string,
): Promise<ExtractedBlock[]> {
  const client = getClient()
  const model = getModel()
  const { mime, data } = stripDataUrl(page.imageBase64)

  const roleHint = extractRoleHint(role)

  let raw = ''
  try {
    const result = await client.chatCompletion({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${EXTRACT_PROMPT}\n\n${roleHint}\nPage index: ${page.pageIndex}`,
            },
            {
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${data}` },
            },
          ],
        },
      ],
      max_tokens: 4096,
      temperature: 0.1,
    })
    raw = result.choices?.[0]?.message?.content ?? ''
    if (typeof raw !== 'string') {
      raw = JSON.stringify(raw)
    }
  } catch (err) {
    const detail = hfErrorMessage(err)
    console.error('HF chatCompletion failed:', detail)
    throw new Error(formatHfExtractError(detail, model))
  }

  return parseExtractedBlocks(raw, page.pageIndex, idPrefix)
}

const SUPPLEMENT_SHORT_ANSWERS_HINT = SUPPLEMENT_MISSED_ANSWERS_HINT

function numericLabelParts(label: string): { num: number; letter?: string } | null {
  const m = label.match(/^(\d+)([a-z])?$/)
  if (!m) return null
  return { num: Number(m[1]), letter: m[2] }
}

function labelsOnPage(blocks: ExtractedBlock[], pageIndex: number): Set<string> {
  const labels = new Set<string>()
  for (const block of blocks) {
    if (block.pageIndex !== pageIndex) continue
    const n = normalizeLabel(block.labelNumber || block.labelWritten)
    if (n) labels.add(n)
  }
  return labels
}

/** Re-scan pages where VL likely skipped short labelled answers. */
function pageNeedsShortAnswerSupplement(
  pageLabels: Set<string>,
  blocks: ExtractedBlock[],
  pageIndex: number,
): boolean {
  if (pageLabels.size === 0) return false

  const nums = [...pageLabels]
    .map((l) => numericLabelParts(l))
    .filter((p): p is { num: number; letter?: string } => p != null)
  if (nums.length === 0) return false

  const byNum = new Map<number, Set<string | undefined>>()
  for (const p of nums) {
    const letters = byNum.get(p.num) ?? new Set<string | undefined>()
    letters.add(p.letter)
    byNum.set(p.num, letters)
  }

  // Missing lettered sibling when another sub-part of same number exists (e.g. 5(a) but no 5(b))
  for (const letters of byNum.values()) {
    if (letters.has('a') && !letters.has('b')) return true
    if (letters.has('b') && !letters.has('a')) return true
  }

  // Gap in main question numbers on a dense answer page
  const mainNums = [...byNum.keys()].sort((a, b) => a - b)
  if (mainNums.length >= 2) {
    for (let i = 0; i < mainNums.length - 1; i++) {
      const gap = mainNums[i + 1] - mainNums[i]
      if (gap > 1 && gap <= 8) return true
    }
  }

  // Page has long answers but very few labels — likely missed short lines
  const pageBlocks = blocks.filter((b) => b.pageIndex === pageIndex)
  const avgLen =
    pageBlocks.reduce((s, b) => s + (b.text?.length ?? 0), 0) / Math.max(pageBlocks.length, 1)
  if (pageBlocks.length >= 2 && pageLabels.size <= pageBlocks.length && avgLen > 120) {
    return true
  }

  return false
}

async function supplementPageShortAnswers(
  page: PageImage,
  existingOnPage: ExtractedBlock[],
  idPrefix: string,
): Promise<ExtractedBlock[]> {
  const pageLabels = labelsOnPage(existingOnPage, page.pageIndex)
  if (!pageNeedsShortAnswerSupplement(pageLabels, existingOnPage, page.pageIndex)) {
    return []
  }

  const client = getClient()
  const model = getModel()
  const { mime, data } = stripDataUrl(page.imageBase64)
  const have = [...pageLabels].sort().join(', ') || 'none'

  let raw = ''
  try {
    const result = await client.chatCompletion({
      model,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${EXTRACT_PROMPT}\n\n${extractRoleHint('answer')}\n\n${SUPPLEMENT_SHORT_ANSWERS_HINT}\n\nLabels already captured on this page: ${have}\nPage index: ${page.pageIndex}`,
            },
            {
              type: 'image_url',
              image_url: { url: `data:${mime};base64,${data}` },
            },
          ],
        },
      ],
      max_tokens: 2048,
      temperature: 0,
    })
    raw = result.choices?.[0]?.message?.content ?? ''
    if (typeof raw !== 'string') raw = JSON.stringify(raw)
  } catch (err) {
    const detail = hfErrorMessage(err)
    if (isProviderCreditError(err)) {
      console.warn('HF supplement extract skipped (credits exhausted)')
      return []
    }
    console.warn('HF supplement extract failed:', detail)
    return []
  }

  const extra = parseExtractedBlocks(raw, page.pageIndex, `${idPrefix}-sup`)
  return extra.filter((block) => {
    const n = normalizeLabel(block.labelNumber || block.labelWritten)
    return Boolean(n && !pageLabels.has(n))
  })
}

export async function extractDocument(
  pages: PageImage[],
  role: DocumentRole,
): Promise<ExtractedBlock[]> {
  const all: ExtractedBlock[] = []
  const prefix = role === 'question' ? 'q' : 'a'
  const supplement = role === 'answer' && process.env.EXTRACT_SUPPLEMENT !== '0'

  for (const page of pages) {
    const blocks = await extractPageWithQwen(page, role, prefix)
    all.push(...blocks)
    if (supplement) {
      const extra = await supplementPageShortAnswers(page, all, prefix)
      if (extra.length) {
        console.info(
          `[extract] supplement page ${page.pageIndex}: +${extra.length} (${extra.map((b) => b.labelNumber || b.labelWritten).join(', ')})`,
        )
        all.push(...extra)
      }
    }
  }

  return filterExtractedBlocks(all, role)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Localize one text span on a page image (bbox repair — HF vision, not Gemini). */
export async function localizeBboxWithHf(
  page: PageImage,
  text: string,
  labelHint?: string,
): Promise<BBox | null> {
  const client = getClient()
  const model = getModel()
  const { mime, data } = stripDataUrl(page.imageBase64)

  const labelLine = labelHint ? `Question label on sheet: ${labelHint}\n` : ''

  const result = await client.chatCompletion({
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `${labelLine}Find the tight bounding region on this page that fully contains this student answer (all lines, diagram strokes, and label text). Add a small margin so nothing is clipped. Return ONLY JSON: {"x":0,"y":0,"w":0,"h":0} with values normalized 0–1, top-left origin.\n\nAnswer content:\n${text.slice(0, 900)}`,
          },
          {
            type: 'image_url',
            image_url: { url: `data:${mime};base64,${data}` },
          },
        ],
      },
    ],
    max_tokens: 128,
    temperature: 0,
  })

  const raw = result.choices?.[0]?.message?.content ?? ''
  const content = typeof raw === 'string' ? raw : JSON.stringify(raw)
  return coerceBbox(extractJsonPayload(content))
}

export async function repairBlocksWithHf(
  blocks: ExtractedBlock[],
  pages: PageImage[],
): Promise<ExtractedBlock[]> {
  const pageMap = new Map(pages.map((p) => [p.pageIndex, p]))
  const repaired: ExtractedBlock[] = []
  let creditsExhausted = false

  for (const block of blocks) {
    const page = pageMap.get(block.pageIndex)
    if (!page || creditsExhausted) {
      repaired.push(block)
      continue
    }
    try {
      const content = blockContentForModel(block) || block.text
      const labelHint = block.labelNumber || block.labelWritten
      const bbox = await localizeBboxWithHf(page, content, labelHint)
      if (bbox) {
        repaired.push({ ...block, bbox, bboxSource: 'qwen' })
      } else {
        repaired.push(block)
      }
      await sleep(200)
    } catch (err) {
      if (isProviderCreditError(err)) {
        console.warn('HF bbox repair aborted (credits exhausted)')
        creditsExhausted = true
      } else {
        console.error('HF bbox repair failed:', err)
      }
      repaired.push(block)
    }
  }

  return repaired
}
