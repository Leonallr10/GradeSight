import { NextResponse } from 'next/server'
import { z } from 'zod'
import { extractedBlockSchema } from '@/lib/blockSchema'
import { lexicalEmbedTexts } from '@/lib/lexicalEmbed'
import { mapAnswersToQuestions } from '@/lib/matching'
import { validateExtractPair } from '@/lib/validateExtract'
import type { ExtractedBlock } from '@/lib/types'

export const maxDuration = 300

const bodySchema = z.object({
  questions: z.array(extractedBlockSchema),
  answers: z.array(extractedBlockSchema),
})

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const body = bodySchema.parse(json)
    // Matching already groups then enriches — pass raw answers through
    const questions = body.questions as ExtractedBlock[]
    const answers = body.answers as ExtractedBlock[]
    const validation = validateExtractPair(questions, answers)
    const pairs = await mapAnswersToQuestions(questions, answers, lexicalEmbedTexts)
    return NextResponse.json({ pairs, validation })
  } catch (err) {
    console.error('/api/map-answers error:', err)
    const message = err instanceof Error ? err.message : 'Mapping failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
