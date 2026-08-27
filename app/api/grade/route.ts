import { NextResponse } from 'next/server'
import { z } from 'zod'
import { extractedBlockSchemaNullable } from '@/lib/blockSchema'
import { gradeAllPairs } from '@/lib/groq'
import type { MappedPair } from '@/lib/types'

export const maxDuration = 300

const bodySchema = z.object({
  pairs: z.array(
    z.object({
      id: z.string(),
      status: z.enum(['matched', 'unanswered', 'unmatched_answer']),
      question: extractedBlockSchemaNullable,
      answer: extractedBlockSchemaNullable,
      similarity: z.number().optional(),
    }),
  ),
})

export async function POST(req: Request) {
  try {
    const json = await req.json()
    const body = bodySchema.parse(json)
    const pairs = body.pairs as MappedPair[]
    const { grades, overallFeedback } = await gradeAllPairs(pairs)

    const answered = pairs.filter((p) => p.status === 'matched').length
    const unanswered = pairs.filter((p) => p.status === 'unanswered').length
    const unmatched = pairs.filter((p) => p.status === 'unmatched_answer').length
    const totalScore = grades.reduce((s, g) => s + g.score, 0)
    const maxScore = grades.reduce((s, g) => s + g.maxScore, 0)

    return NextResponse.json({
      summary: {
        totalScore,
        maxScore,
        answered,
        unanswered,
        unmatched,
        overallFeedback,
        grades,
      },
    })
  } catch (err) {
    console.error('/api/grade error:', err)
    const message = err instanceof Error ? err.message : 'Grading failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
