import { buildQuestionIndex, validateAnswerLabels } from './questionIndex'
import { normalizeLabel } from './normalizeLabel'
import type { ExtractedBlock } from './types'

export type ExtractValidation = {
  valid: boolean
  warnings: string[]
  questionCount: number
  answerCount: number
  matchedLabelCount: number
}

/**
 * Cross-check extracted answers against the question paper label universe.
 * Clears orphan labels and flags duplicates so mapping can recover via semantics.
 */
export function validateExtractPair(
  questions: ExtractedBlock[],
  answers: ExtractedBlock[],
): ExtractValidation {
  const index = buildQuestionIndex(questions)
  const { answers: validated, warnings } = validateAnswerLabels(answers, questions)

  const matchedLabelCount = validated.filter((a) => {
    const label = normalizeLabel(a.labelNumber || a.labelWritten)
    return Boolean(label && index.labelSet.has(label))
  }).length

  return {
    valid: questions.length > 0 && answers.length > 0,
    warnings,
    questionCount: index.leafQuestions.length,
    answerCount: validated.length,
    matchedLabelCount,
  }
}

export { validateAnswerLabels }
