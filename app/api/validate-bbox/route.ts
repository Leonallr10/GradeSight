import { NextResponse } from 'next/server'
import { z } from 'zod'
import { partitionByBbox } from '@/lib/bboxCheck'
import { extractedBlockSchema } from '@/lib/blockSchema'
import type { ExtractedBlock, PageImage } from '@/lib/types'

export const maxDuration = 300

const bodySchema = z.object({
  blocks: z.array(extractedBlockSchema),
  pages: z
    .array(
      z.object({
        pageIndex: z.number().int().min(0),
        imageBase64: z.string().min(1),
        mimeType: z.string().optional(),
      }),
    )
    .min(1)
    .max(1),
})

/** Validate bboxes from HF extract. Repair uses HF VL when needed (no Gemini). */
export async function POST(req: Request) {
  try {
    const json = await req.json()
    const body = bodySchema.parse(json)
    const blocks = body.blocks as ExtractedBlock[]
    const pages = body.pages as PageImage[]

    const { valid, invalid } = partitionByBbox(blocks)
    let repaired: ExtractedBlock[] = invalid

    if (invalid.length > 0 && process.env.HF_TOKEN) {
      try {
        const { repairBlocksWithHf } = await import('@/lib/hf-qwen')
        repaired = await repairBlocksWithHf(invalid, pages)
      } catch (err) {
        console.warn('HF bbox repair skipped:', err)
        repaired = invalid
      }
    }

    const byId = new Map<string, ExtractedBlock>()
    for (const b of valid) byId.set(b.id, b)
    for (const b of repaired) byId.set(b.id, b)

    const result = blocks.map((b) => byId.get(b.id) ?? b)

    return NextResponse.json({
      blocks: result,
      repairedCount: repaired.filter((b) => b.bbox && b.bboxSource === 'qwen').length,
      invalidCount: invalid.length,
    })
  } catch (err) {
    console.error('/api/validate-bbox error:', err)
    const message = err instanceof Error ? err.message : 'Bbox validation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
