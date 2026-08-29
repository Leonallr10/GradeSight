import { NextResponse } from 'next/server'
import { z } from 'zod'
import { repairMappedPairBboxes } from '@/lib/bboxRepair'
import { extractedBlockSchema } from '@/lib/blockSchema'
import type { MappedPair, PageImage } from '@/lib/types'

export const maxDuration = 300

const pairSchema = z.object({
  id: z.string(),
  status: z.enum(['matched', 'unanswered', 'unmatched_answer']),
  question: extractedBlockSchema.nullable(),
  answer: extractedBlockSchema.nullable(),
  similarity: z.number().optional(),
})

const bodySchema = z.object({
  pairs: z.array(pairSchema),
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

/** Post-map bbox repair — one page per request to stay under Vercel ~4.5MB body limit. */
export async function POST(req: Request) {
  try {
    const json = await req.json()
    const body = bodySchema.parse(json)
    const pairs = (await repairMappedPairBboxes(
      body.pairs as MappedPair[],
      body.pages as PageImage[],
    )) as MappedPair[]
    return NextResponse.json({ pairs })
  } catch (err) {
    console.error('/api/repair-map-bboxes error:', err)
    const message = err instanceof Error ? err.message : 'Bbox repair failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
