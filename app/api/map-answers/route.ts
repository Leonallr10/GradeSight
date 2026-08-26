import { NextResponse } from 'next/server'
import { z } from 'zod'
import { embedTexts } from '@/lib/gemini'
import { mapAnswersToQuestions } from '@/lib/matching'
import type { ExtractedBlock } from '@/lib/types'

export const maxDuration = 120

const blockSchema = z.object({
  id: z.string(),
  pageIndex: z.number(),
  text: z.string(),
  labelNumber: z.string().optional(),
  bbox: z
    .object({
      x: z.number(),
      y: z.number(),
      w: z.number(),
      h: z.number(),
    })
    .optional(),
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
})

const bodySchema = z.object({
  questions: z.array(blockSchema),
  answers: z.array(blockSchema),
})

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const body = bodySchema.parse(json)
    const pairs = await mapAnswersToQuestions(
      body.questions as ExtractedBlock[],
      body.answers as ExtractedBlock[],
      embedTexts,
    )
    return NextResponse.json({ pairs })
  } catch (err) {
    console.error('/api/map-answers error:', err)
    const message = err instanceof Error ? err.message : 'Mapping failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
