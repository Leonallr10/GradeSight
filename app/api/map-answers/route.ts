import { NextResponse } from 'next/server'
import { z } from 'zod'
import { extractedBlockSchema } from '@/lib/blockSchema'
import { enrichAnswerLabels } from '@/lib/enrichAnswers'
import { lexicalEmbedTexts } from '@/lib/lexicalEmbed'
import { mapAnswersToQuestions } from '@/lib/matching'
import type { ExtractedBlock } from '@/lib/types'

export const maxDuration = 120

const bodySchema = z.object({
  questions: z.array(extractedBlockSchema),
  answers: z.array(extractedBlockSchema),
})

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const body = bodySchema.parse(json)
    // Map-time content enrich so cached/raw extracts still get label repair
    const answers = enrichAnswerLabels(body.answers as ExtractedBlock[])
    const pairs = await mapAnswersToQuestions(
      body.questions as ExtractedBlock[],
      answers,
      lexicalEmbedTexts,
    )
    return NextResponse.json({ pairs })
  } catch (err) {
    console.error('/api/map-answers error:', err)
    const message = err instanceof Error ? err.message : 'Mapping failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
