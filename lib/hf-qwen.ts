import { InferenceClient } from '@huggingface/inference'
import { parseExtractedBlocks } from './parseExtract'
import type { DocumentRole, ExtractedBlock, PageImage } from './types'

const EXTRACT_PROMPT = `You are extracting exam content from a document page image (CBSE / board-style).

Extract EVERY distinct question or answer text block on this page.
- Sub-parts are SEPARATE blocks: "19(a)", "19(b)", "20(b)(i)", "20(b)(ii)" each get their own entry.
- Preserve FULL numbering — never drop digits ("19(a)" not "9(a)").
- Keep printed order top→bottom.
- For each block return: text, labelNumber (e.g. "19(a)", "20(b)(i)"), and bbox as [x, y, w, h] normalized 0–1 (top-left origin).

Return ONLY a JSON array, no markdown:
[{"text":"...","labelNumber":"19(a)","bbox":[0.1,0.2,0.8,0.15]}]
`

function getClient() {
  const token = process.env.HF_TOKEN
  if (!token) {
    throw new Error('HF_TOKEN is not set')
  }
  return new InferenceClient(token)
}

function getModel() {
  return process.env.HF_QWEN_MODEL || 'Qwen/Qwen2.5-VL-7B-Instruct'
}

function stripDataUrl(imageBase64: string): { mime: string; data: string } {
  const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (match) {
    return { mime: match[1], data: match[2] }
  }
  return { mime: 'image/png', data: imageBase64.replace(/^data:[^;]+;base64,/, '') }
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
      ? 'This is a QUESTION PAPER page. Extract questions only.'
      : 'This is a STUDENT ANSWER SHEET page (may be handwritten). Extract answer blocks only.'

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
    // Fallback: some providers use textGeneration-style APIs
    console.error('HF chatCompletion failed, trying alternative:', err)
    throw err
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

/** Optional Gemini multimodal extract when EXTRACT_FALLBACK=gemini */
export async function shouldUseGeminiExtractFallback(): boolean {
  return process.env.EXTRACT_FALLBACK === 'gemini'
}
