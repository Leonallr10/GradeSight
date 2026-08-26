import { InferenceClient } from '@huggingface/inference'
import { parseExtractedBlocks } from './parseExtract'
import type { DocumentRole, ExtractedBlock, PageImage } from './types'

/** Default VL model that works on Hugging Face Inference Providers for most accounts.
 *  Qwen2.5-VL often needs Hyperbolic (or similar) enabled in HF settings — if you
 *  have that, set HF_QWEN_MODEL=Qwen/Qwen2.5-VL-7B-Instruct */
const DEFAULT_VL_MODEL = 'meta-llama/Llama-4-Scout-17B-16E-Instruct'

const EXTRACT_PROMPT = `You extract structured blocks from an exam page image (any board / school / subject).

Read ONLY what appears on this page. Do not invent questions, answers, numbers, or topics.

Rules:
- Emit one JSON object per distinct LEAF item (smallest answerable unit): each numbered item and each lettered / roman sub-part gets its own entry.
- If sub-parts exist, do NOT also emit a parent entry that repeats the same child text.
- If the paper offers an OR choice between branches, emit every leaf under each branch that is present on the page.
- Copy labels exactly as printed (full digits and letters). Never truncate or guess a different number.
- Keep visual top-to-bottom (then left-to-right) order.
- labelNumber: the printed marker for that block, or omit if none is visible.
- bbox: [x, y, w, h] with values normalized to 0–1 from the top-left of this page image.
- text: the full wording of that block only.

Return ONLY a JSON array (no markdown):
[{"text":"<exact text from page>","labelNumber":"<printed label or omit>","bbox":[x,y,w,h]}]
`

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

export async function extractPageWithQwen(
  page: PageImage,
  role: DocumentRole,
  idPrefix: string,
): Promise<ExtractedBlock[]> {
  const client = getClient()
  const model = getModel()
  const { mime, data } = stripDataUrl(page.imageBase64)

  const roleHint =
    role === 'question'
      ? 'Document role: QUESTION PAPER (usually printed). Extract every question / sub-part visible on this page.'
      : 'Document role: ANSWER SHEET (often handwritten or a key). Extract each answer block; preserve any visible label; read handwriting carefully.'

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
      max_tokens: 2048,
      temperature: 0.1,
    })
    raw = result.choices?.[0]?.message?.content ?? ''
    if (typeof raw !== 'string') {
      raw = JSON.stringify(raw)
    }
  } catch (err) {
    const detail = hfErrorMessage(err)
    console.error('HF chatCompletion failed:', detail)
    throw new Error(
      `${detail} (model=${model}). Enable a VL provider for this model in Hugging Face settings, or set HF_QWEN_MODEL to a vision model your account supports (e.g. meta-llama/Llama-4-Scout-17B-16E-Instruct).`,
    )
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

  return all
}
