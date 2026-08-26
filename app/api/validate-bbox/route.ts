import { NextResponse } from 'next/server'
import { z } from 'zod'
import { partitionByBbox } from '@/lib/bboxCheck'
import { repairBlocksWithGemini } from '@/lib/gemini'
import type { ExtractedBlock, PageImage } from '@/lib/types'

export const maxDuration = 300

const bboxSchema = z
  .object({
    x: z.number(),
    y: z.number(),
    w: z.number(),
    h: z.number(),
  })
  .optional()

const bodySchema = z.object({
  blocks: z.array(
    z.object({
      id: z.string(),
      pageIndex: z.number().int().min(0),
      text: z.string(),
      labelNumber: z.string().optional(),
      bbox: bboxSchema,
      bboxSource: z.enum(['qwen', 'gemini', 'none']),
      extraPages: z
        .array(
          z.object({
            pageIndex: z.number(),
            bbox: z.object({
              x: z.number(),
              y: z.number(),
              w: z.number(),
              h: z.number(),
            }),
          }),
        )
        .optional(),
    }),
  ),
  pages: z.array(
    z.object({
      pageIndex: z.number().int().min(0),
      imageBase64: z.string().min(1),
      mimeType: z.string().optional(),
    }),
  ),
})

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const body = bodySchema.parse(json)
    const blocks = body.blocks as ExtractedBlock[]
    const pages = body.pages as PageImage[]

    const { valid, invalid } = partitionByBbox(blocks)
    const repaired = invalid.length > 0 ? await repairBlocksWithGemini(invalid, pages) : []

    const byId = new Map<string, ExtractedBlock>()
    for (const b of valid) byId.set(b.id, b)
    for (const b of repaired) byId.set(b.id, b)

    // Preserve original order
    const result = blocks.map((b) => byId.get(b.id) ?? b)

    return NextResponse.json({
      blocks: result,
      repairedCount: repaired.filter((b) => b.bboxSource === 'gemini').length,
      invalidCount: invalid.length,
    })
  } catch (err) {
    console.error('/api/validate-bbox error:', err)
    const message = err instanceof Error ? err.message : 'Bbox validation failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
