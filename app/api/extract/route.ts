import { NextResponse } from 'next/server'
import { z } from 'zod'
import { extractDocument, shouldUseGeminiExtractFallback } from '@/lib/hf-qwen'
import { extractPageWithGemini } from '@/lib/gemini'
import type { ExtractedBlock, PageImage } from '@/lib/types'

export const maxDuration = 300

const bodySchema = z.object({
  role: z.enum(['question', 'answer']),
  pages: z
    .array(
      z.object({
        pageIndex: z.number().int().min(0),
        imageBase64: z.string().min(1),
        mimeType: z.string().optional(),
      }),
    )
    .min(1)
    .max(20),
})

async function extractWithGemini(
  pages: PageImage[],
  role: 'question' | 'answer',
): Promise<ExtractedBlock[]> {
  const blocks: ExtractedBlock[] = []
  const prefix = role === 'question' ? 'q' : 'a'
  for (const page of pages) {
    const pageBlocks = await extractPageWithGemini(page, role, prefix)
    blocks.push(...pageBlocks)
  }
  return blocks
}

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const body = bodySchema.parse(json)
    const pages = body.pages as PageImage[]

    let blocks: ExtractedBlock[]

    // Printed question papers: Gemini is far more reliable for full labels (19a not 9a).
    // Answer sheets: try HF Qwen first unless EXTRACT_FALLBACK=gemini.
    const forceGemini =
      body.role === 'question' || (await shouldUseGeminiExtractFallback())

    if (forceGemini) {
      blocks = await extractWithGemini(pages, body.role)
    } else {
      try {
        blocks = await extractDocument(pages, body.role)
        if (blocks.length === 0) {
          console.warn('HF returned 0 blocks; falling back to Gemini')
          blocks = await extractWithGemini(pages, body.role)
        }
      } catch (hfErr) {
        console.error('HF extract failed, falling back to Gemini:', hfErr)
        blocks = await extractWithGemini(pages, body.role)
      }
    }

    return NextResponse.json({ blocks })
  } catch (err) {
    console.error('/api/extract error:', err)
    const message = err instanceof Error ? err.message : 'Extraction failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
