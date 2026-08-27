import { InferenceClient } from '@huggingface/inference'
import { coerceBbox } from './bboxCheck'
import { filterExtractedBlocks } from './filterExamBlocks'
import { extractJsonPayload, parseExtractedBlocks } from './parseExtract'
import type { BBox, DocumentRole, ExtractedBlock, PageImage } from './types'

/** Default VL model that works on Hugging Face Inference Providers for most accounts.
 *  Qwen2.5-VL often needs Hyperbolic (or similar) enabled in HF settings — if you
 *  have that, set HF_QWEN_MODEL=Qwen/Qwen2.5-VL-7B-Instruct */
const DEFAULT_VL_MODEL = 'meta-llama/Llama-4-Scout-17B-16E-Instruct'

const EXTRACT_PROMPT = `You extract ONLY gradeable exam items from a page image (any board / school / subject).

Read ONLY what appears on this page. Do not invent content.

INCLUDE (each as its own JSON object — leaf sub-parts only):
- Numbered questions and lettered / roman sub-parts that a student must answer.
- If sub-parts exist, emit separate leaves; do NOT also emit a parent that duplicates those children.
- OR choices: emit each leaf under each branch that appears on the page.

EXCLUDE completely (do NOT emit JSON for these):
- Exam title, school/board name, subject line, date, class, duration, max marks banners
- "Instructions" / general instructions / "write answers in the booklet" admin lines
- Section / Part headers alone (e.g. "SECTION A: MATHEMATICS")
- Page numbers, watermarks, decorative lines
- Student name / roll / ID fields on answer sheets (those are not answers)

ANSWER SHEETS — grouping (critical):
- Group ALL lines that belong to the same question label into ONE block, even if they span multiple sentences, formula lines, calculation steps, or diagram labels.
- Only start a NEW block when a NEW question label appears (e.g. "Q4", "Q3(b)", "1(a)", "Q7:") or there is a clear large visual gap to a different answer.
- Do NOT emit one JSON object per formula line or per diagram label.
- Strikethrough / crossed-out draft text: set isStrikethrough=true on that content (or omit it). Prefer the corrected final writing for the same label.
- Diagrams: one block with contentKind="diagram". Put every visible label (Cap, Anode, Cathode, electrolyte, etc.) inside diagramDescription AND summarize them in text. Never emit only the heading "Q8: …" without the diagram content.

Fields:
- labelWritten: REQUIRED whenever a question number/label is visible anywhere above, beside, or inside the block (e.g. "Q4", "Q7: Newton's Laws", "1(a)"). Never omit it when readable.
- labelNumber: same marker normalized if possible
- bbox: [x, y, w, h] normalized 0–1, top-left origin (union of the whole answer region)
- text: full answer/question wording for that leaf
- contentKind: "text" | "formula" | "derivative" | "diagram" | "mixed"
- mathLatex: LaTeX for equations / derivatives / chemical formulae when present
- diagramDescription: full structured description of drawn/printed figures including all labels
- isStrikethrough: true only for crossed-out draft text

Return ONLY a JSON array (no markdown). If this page has no gradeable items, return [].
[{"text":"...","labelWritten":"Q7","labelNumber":"7","bbox":[x,y,w,h],"contentKind":"diagram","mathLatex":"...","diagramDescription":"...","isStrikethrough":false}]
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
      ? 'Document role: QUESTION PAPER. Extract ONLY answerable questions and sub-parts. Skip titles, section headers, duration/marks banners, and instructions.'
      : 'Document role: ANSWER SHEET. ONE JSON object per question label covering the FULL answer. Always set labelWritten when Q# / question number is visible anywhere near the block. Never split one labelled answer into many fragments. Tag crossed-out drafts with isStrikethrough=true. For diagrams, bundle figure + all labels into diagramDescription.'

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

  for (const block of blocks) {
    const page = pageMap.get(block.pageIndex)
    if (!page) {
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
      console.error('HF bbox repair failed:', err)
      repaired.push(block)
    }
  }

  return repaired
}
