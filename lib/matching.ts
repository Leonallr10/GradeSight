import { blockContentForModel } from './blockContent'
import {
  diagramRichness,
  STRONG_TOPICS,
  topicalConflict,
  topicalOverlap,
} from './contentTopics'
import { cosineSimilarity } from './cosine'
import { enrichAnswerLabels as repairAnswerLabels } from './enrichAnswers'
import { findLabelAnywhere } from './findLabel'
import { groupAnswersByLabel } from './groupAnswers'
import {
  answerQuestionFit,
  buildQuestionIndex,
  preferLeafQuestions,
} from './questionIndex'
import {
  formatLabel,
  isStrictParentLabel,
  normalizeLabel,
  parseNormalizedLabel,
  type LabelParts,
} from './normalizeLabel'
import { inferLabelFromText } from './parseExtract'
import type { ExtractedBlock, MappedPair } from './types'

/** Fail safe: below this, leave unmatched rather than force a wrong grade. */
export const SEMANTIC_MATCH_THRESHOLD = 0.72

export type EmbedFn = (texts: string[]) => Promise<number[][]>

export function preferLeafBlocks(blocks: ExtractedBlock[]): ExtractedBlock[] {
  const norms = blocks.map((b) => normalizeLabel(b.labelNumber || b.labelWritten))
  return blocks.filter((b, idx) => {
    const n = norms[idx]
    if (!n) return true
    return !norms.some((other) => other && isStrictParentLabel(n, other))
  })
}

function partsFromRaw(raw?: string | null): LabelParts {
  if (!raw) return {}
  const n = normalizeLabel(raw)
  if (!n) return {}
  if (/^(i{1,3}|iv|v|vi{0,3}|ix|x)$/.test(n)) return { roman: n }
  if (/^[a-z]$/.test(n)) return { letter: n }
  if (/^[a-z](i{1,3}|iv|v|vi{0,3}|ix|x)$/.test(n)) {
    return { letter: n[0], roman: n.slice(1) }
  }
  return parseNormalizedLabel(n)
}

export function inheritAnswerLabels(answers: ExtractedBlock[]): ExtractedBlock[] {
  let lastNum: string | undefined
  let lastLetter: string | undefined

  return answers.map((answer) => {
    if (answer.isStrikethrough) return answer
    const seed =
      findLabelAnywhere(answer.text, answer.labelWritten || answer.labelNumber) ||
      answer.labelNumber ||
      inferLabelFromText(answer.text)
    let parts = partsFromRaw(seed)

    if (parts.num) lastNum = parts.num
    if (parts.letter) lastLetter = parts.letter

    if (!parts.num && lastNum && (parts.letter || parts.roman)) {
      parts = {
        num: lastNum,
        letter: parts.letter ?? lastLetter,
        roman: parts.roman,
      }
      if (parts.letter) lastLetter = parts.letter
    } else if (!parts.num) {
      return answer
    }

    const labelNumber = formatLabel(parts) || answer.labelNumber || seed
    if (!labelNumber) return answer
    return {
      ...answer,
      labelNumber,
      labelWritten: answer.labelWritten || labelNumber,
    }
  })
}

/** @deprecated use inheritAnswerLabels */
export const enrichAnswerLabels = inheritAnswerLabels

export { diagramRichness }

/** Pass 4: match short orphan answers to unanswered questions by question text + content. */
function rematchOrphanAnswers(
  leafQuestions: ExtractedBlock[],
  enrichedAnswers: ExtractedBlock[],
  usedQuestionIds: Set<string>,
  usedAnswerIds: Set<string>,
  pairs: MappedPair[],
): void {
  const leftQ = leafQuestions.filter((q) => !usedQuestionIds.has(q.id))
  const leftA = enrichedAnswers.filter((a) => !usedAnswerIds.has(a.id))
  if (leftQ.length === 0 || leftA.length === 0) return

  type Cand = { qi: number; ai: number; score: number }
  const cands: Cand[] = []

  for (let qi = 0; qi < leftQ.length; qi++) {
    for (let ai = 0; ai < leftA.length; ai++) {
      const score = answerQuestionFit(leftQ[qi], leftA[ai])
      if (score < 2) continue
      cands.push({ qi, ai, score })
    }
  }

  cands.sort((a, b) => b.score - a.score)
  const takenQ = new Set<number>()
  const takenA = new Set<number>()

  for (const c of cands) {
    if (takenQ.has(c.qi) || takenA.has(c.ai)) continue
    const question = leftQ[c.qi]
    const answer = leftA[c.ai]
    pairs.push({
      id: `pair-${question.id}-${answer.id}`,
      status: 'matched',
      question,
      answer: {
        ...answer,
        labelNumber: answer.labelNumber || question.labelNumber,
      },
      similarity: Math.min(0.95, 0.85 + 0.02 * c.score),
    })
    usedQuestionIds.add(question.id)
    usedAnswerIds.add(answer.id)
    takenQ.add(c.qi)
    takenA.add(c.ai)
  }
}

/**
 * Pass 1: exact normalized label match.
 * Pass 2: unlabeled / orphan-labeled, cosine ≥ threshold.
 * Pass 3: strong topical keyword rematch.
 * Pass 4: question-content fit for short orphans.
 */
export async function mapAnswersToQuestions(
  questions: ExtractedBlock[],
  answers: ExtractedBlock[],
  embed: EmbedFn,
): Promise<MappedPair[]> {
  const leafQuestions = preferLeafQuestions(inheritAnswerLabels(questions))
  const questionIndex = buildQuestionIndex(leafQuestions)
  const grouped = groupAnswersByLabel(answers.filter((a) => !a.isStrikethrough))
  const enrichedAnswers = preferLeafBlocks(
    inheritAnswerLabels(repairAnswerLabels(grouped, leafQuestions)),
  )

  const pairs: MappedPair[] = []
  const usedAnswerIds = new Set<string>()
  const usedQuestionIds = new Set<string>()

  const questionByLabel = questionIndex.questionByLabel

  const answersByLabel = new Map<string, ExtractedBlock[]>()
  for (const answer of enrichedAnswers) {
    const label = normalizeLabel(
      answer.labelNumber ||
        findLabelAnywhere(answer.text, answer.labelWritten || answer.labelNumber) ||
        answer.labelWritten,
    )
    if (!label) continue
    const list = answersByLabel.get(label)
    if (list) list.push(answer)
    else answersByLabel.set(label, [answer])
  }

  for (const [label, candidates] of answersByLabel) {
    const question = questionByLabel.get(label)
    if (!question || usedQuestionIds.has(question.id)) continue

    const ranked = [...candidates]
      .filter((a) => !topicalConflict(question, a))
      .sort((a, b) => diagramRichness(b) - diagramRichness(a))
    const answer = ranked[0]
    if (!answer) continue

    pairs.push({
      id: `pair-${question.id}-${answer.id}`,
      status: 'matched',
      question,
      answer: { ...answer, labelNumber: answer.labelNumber || label },
      similarity: 1,
    })
    usedAnswerIds.add(answer.id)
    usedQuestionIds.add(question.id)
  }

  const remainingQuestions = () => leafQuestions.filter((q) => !usedQuestionIds.has(q.id))
  const remainingAnswersForPass2 = () =>
    enrichedAnswers.filter((a) => {
      if (usedAnswerIds.has(a.id)) return false
      const label = normalizeLabel(
        a.labelNumber ||
          findLabelAnywhere(a.text, a.labelWritten || a.labelNumber) ||
          a.labelWritten,
      )
      if (!label) return true
      const q = questionByLabel.get(label)
      return !q || usedQuestionIds.has(q.id)
    })

  const remQ = remainingQuestions()
  const remA = remainingAnswersForPass2()

  if (remQ.length > 0 && remA.length > 0) {
    const qTexts = remQ.map((q) => blockContentForModel(q))
    const aTexts = remA.map((a) => blockContentForModel(a))
    const [qEmb, aEmb] = await Promise.all([embed(qTexts), embed(aTexts)])

    type Candidate = { qi: number; ai: number; score: number }
    const candidates: Candidate[] = []

    if (qEmb.length === remQ.length && aEmb.length === remA.length) {
      for (let qi = 0; qi < remQ.length; qi++) {
        for (let ai = 0; ai < remA.length; ai++) {
          if (topicalConflict(remQ[qi], remA[ai])) continue
          const score = cosineSimilarity(qEmb[qi], aEmb[ai])
          if (score >= SEMANTIC_MATCH_THRESHOLD) {
            candidates.push({ qi, ai, score })
          }
        }
      }
    }

    candidates.sort((a, b) => b.score - a.score)
    const takenQ = new Set<number>()
    const takenA = new Set<number>()

    for (const c of candidates) {
      if (takenQ.has(c.qi) || takenA.has(c.ai)) continue
      const question = remQ[c.qi]
      const answer = remA[c.ai]
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

  {
    const leftQ = remainingQuestions()
    const leftA = enrichedAnswers.filter((a) => !usedAnswerIds.has(a.id))
    type Cand = { qi: number; ai: number; score: number }
    const cands: Cand[] = []
    for (let qi = 0; qi < leftQ.length; qi++) {
      for (let ai = 0; ai < leftA.length; ai++) {
        const overlap = topicalOverlap(leftQ[qi], leftA[ai]).filter((h) =>
          STRONG_TOPICS.has(h),
        )
        if (overlap.length === 0) continue
        if (topicalConflict(leftQ[qi], leftA[ai])) continue
        cands.push({ qi, ai, score: overlap.length })
      }
    }
    cands.sort((a, b) => b.score - a.score)
    const takenQ = new Set<number>()
    const takenA = new Set<number>()
    for (const c of cands) {
      if (takenQ.has(c.qi) || takenA.has(c.ai)) continue
      const question = leftQ[c.qi]
      const answer = leftA[c.ai]
      pairs.push({
        id: `pair-${question.id}-${answer.id}`,
        status: 'matched',
        question,
        answer: {
          ...answer,
          labelNumber: answer.labelNumber || question.labelNumber,
        },
        similarity: Math.min(0.95, 0.8 + 0.05 * c.score),
      })
      usedQuestionIds.add(question.id)
      usedAnswerIds.add(answer.id)
      takenQ.add(c.qi)
      takenA.add(c.ai)
    }
  }

  rematchOrphanAnswers(
    leafQuestions,
    enrichedAnswers,
    usedQuestionIds,
    usedAnswerIds,
    pairs,
  )

  for (const question of leafQuestions) {
    if (usedQuestionIds.has(question.id)) continue
    pairs.push({
      id: `unanswered-${question.id}`,
      status: 'unanswered',
      question,
      answer: null,
    })
  }

  for (const answer of enrichedAnswers) {
    if (usedAnswerIds.has(answer.id)) continue
    pairs.push({
      id: `unmatched-${answer.id}`,
      status: 'unmatched_answer',
      question: null,
      answer,
    })
  }

  const questionOrder = new Map(leafQuestions.map((q, i) => [q.id, i]))
  pairs.sort((a, b) => {
    if (a.status === 'unmatched_answer' && b.status !== 'unmatched_answer') return 1
    if (b.status === 'unmatched_answer' && a.status !== 'unmatched_answer') return -1
    const ai = a.question ? (questionOrder.get(a.question.id) ?? 9999) : 9999
    const bi = b.question ? (questionOrder.get(b.question.id) ?? 9999) : 9999
    return ai - bi
  })

  return pairs
}
