import { InferenceClient } from '@huggingface/inference'
import { coerceBbox } from './bboxCheck'
import { EXTRACT_PROMPT, extractRoleHint, isProviderCreditError, isProviderPermissionError } from './extractPrompt'
import { filterExtractedBlocks } from './filterExamBlocks'
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

export async function extractDocument(
  pages: PageImage[],
  role: DocumentRole,
): Promise<ExtractedBlock[]> {
  const all: ExtractedBlock[] = []
  const prefix = role === 'question' ? 'q' : 'a'

  for (const page of pages) {
    const blocks = await extractPageWithQwen(page, role, prefix)
    all.push(...blocks)
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
): Promise<BBox | null> {
  const client = getClient()
  const model = getModel()
  const { mime, data } = stripDataUrl(page.imageBase64)

  const result = await client.chatCompletion({
    model,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'text',
            text: `Find the region on this page that contains this text (or the closest printed/handwritten match). Return ONLY JSON: {"x":0,"y":0,"w":0,"h":0} with values normalized 0–1, top-left origin. Do not re-extract the text.\n\nText:\n${text.slice(0, 800)}`,
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
      const bbox = await localizeBboxWithHf(page, block.text)
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
