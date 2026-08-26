import { cosineSimilarity } from './cosine'
import { normalizeLabel } from './normalizeLabel'
import type { ExtractedBlock, MappedPair } from './types'

export const SEMANTIC_MATCH_THRESHOLD = 0.72

export type EmbedFn = (texts: string[]) => Promise<number[][]>

/**
 * Pass 1: exact normalized label match.
 * Pass 2: cosine similarity on leftover unlabeled answers vs remaining questions.
 */
export async function mapAnswersToQuestions(
  questions: ExtractedBlock[],
  answers: ExtractedBlock[],
  embed: EmbedFn,
): Promise<MappedPair[]> {
  const pairs: MappedPair[] = []
  const usedAnswerIds = new Set<string>()
  const usedQuestionIds = new Set<string>()

  const questionByLabel = new Map<string, ExtractedBlock>()
  for (const q of questions) {
    const label = normalizeLabel(q.labelNumber)
    if (label && !questionByLabel.has(label)) {
      questionByLabel.set(label, q)
    }
  }

  // Pass 1 — label exact match
  for (const answer of answers) {
    const label = normalizeLabel(answer.labelNumber)
    if (!label) continue
    const question = questionByLabel.get(label)
    if (!question || usedQuestionIds.has(question.id)) continue

    pairs.push({
      id: `pair-${question.id}-${answer.id}`,
      status: 'matched',
      question,
      answer,
      similarity: 1,
    })
    usedAnswerIds.add(answer.id)
    usedQuestionIds.add(question.id)
  }

  const remainingQuestions = questions.filter((q) => !usedQuestionIds.has(q.id))
  const remainingAnswers = answers.filter((a) => !usedAnswerIds.has(a.id))

  // Pass 2 — semantic similarity for leftovers
  if (remainingQuestions.length > 0 && remainingAnswers.length > 0) {
    const qTexts = remainingQuestions.map((q) => q.text)
    const aTexts = remainingAnswers.map((a) => a.text)
    const [qEmb, aEmb] = await Promise.all([embed(qTexts), embed(aTexts)])

    type Candidate = { qi: number; ai: number; score: number }
    const candidates: Candidate[] = []

    for (let qi = 0; qi < remainingQuestions.length; qi++) {
      for (let ai = 0; ai < remainingAnswers.length; ai++) {
        const score = cosineSimilarity(qEmb[qi], aEmb[ai])
        if (score >= SEMANTIC_MATCH_THRESHOLD) {
          candidates.push({ qi, ai, score })
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score)
    const takenQ = new Set<number>()
    const takenA = new Set<number>()

    for (const c of candidates) {
      if (takenQ.has(c.qi) || takenA.has(c.ai)) continue
      const question = remainingQuestions[c.qi]
      const answer = remainingAnswers[c.ai]
      pairs.push({
        id: `pair-${question.id}-${answer.id}`,
        status: 'matched',
        question,
        answer,
        similarity: c.score,
      })
      usedQuestionIds.add(question.id)
      usedAnswerIds.add(answer.id)
      takenQ.add(c.qi)
      takenA.add(c.ai)
    }
  }

  for (const question of questions) {
    if (usedQuestionIds.has(question.id)) continue
    pairs.push({
      id: `unanswered-${question.id}`,
      status: 'unanswered',
      question,
      answer: null,
    })
  }

  for (const answer of answers) {
    if (usedAnswerIds.has(answer.id)) continue
    pairs.push({
      id: `unmatched-${answer.id}`,
      status: 'unmatched_answer',
      question: null,
      answer,
    })
  }

  // Keep question order: matched/unanswered by question order, then unmatched answers
  const questionOrder = new Map(questions.map((q, i) => [q.id, i]))
  pairs.sort((a, b) => {
    if (a.status === 'unmatched_answer' && b.status !== 'unmatched_answer') return 1
    if (b.status === 'unmatched_answer' && a.status !== 'unmatched_answer') return -1
    const ai = a.question ? (questionOrder.get(a.question.id) ?? 9999) : 9999
    const bi = b.question ? (questionOrder.get(b.question.id) ?? 9999) : 9999
    return ai - bi
  })

  return pairs
}
