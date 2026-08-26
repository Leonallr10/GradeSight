import { NextResponse } from 'next/server'
import { z } from 'zod'
import { extractDocument } from '@/lib/hf-qwen'
import type { PageImage } from '@/lib/types'

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

/** Extraction is HF vision model only (no Gemini multimodal extract). */
export async function POST(req: Request) {
  try {
    const json = await req.json()
    const body = bodySchema.parse(json)
    const pages = body.pages as PageImage[]
    const blocks = await extractDocument(pages, body.role)
    return NextResponse.json({ blocks })
  } catch (err) {
    console.error('/api/extract error:', err)
    const message = err instanceof Error ? err.message : 'Extraction failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
