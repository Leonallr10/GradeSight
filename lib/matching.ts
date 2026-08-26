import { cosineSimilarity } from './cosine'
import {
  formatLabel,
  isStrictParentLabel,
  normalizeLabel,
  parseNormalizedLabel,
  type LabelParts,
} from './normalizeLabel'
import { inferLabelFromText } from './parseExtract'
import type { ExtractedBlock, MappedPair } from './types'

export const SEMANTIC_MATCH_THRESHOLD = 0.55

export type EmbedFn = (texts: string[]) => Promise<number[][]>

/** Drop parent blocks when a child sub-part with the same stem exists (e.g. drop "19" if "19(a)" exists). */
export function preferLeafBlocks(blocks: ExtractedBlock[]): ExtractedBlock[] {
  const norms = blocks.map((b) => normalizeLabel(b.labelNumber))
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
  // Partial "(i)" → normalized "i"; "(b)" → "b"; "(b)(i)" → "bi"
  if (/^(i{1,3}|iv|v|vi{0,3}|ix|x)$/.test(n)) return { roman: n }
  if (/^[a-z]$/.test(n)) return { letter: n }
  if (/^[a-z](i{1,3}|iv|v|vi{0,3}|ix|x)$/.test(n)) {
    return { letter: n[0], roman: n.slice(1) }
  }
  return parseNormalizedLabel(n)
}

/**
 * Fill in missing answer labels from reading order:
 * after "20(b)" or "21.", a following "(i)" becomes "20(b)(i)" / "21(a)(i)" etc.
 */
export function enrichAnswerLabels(answers: ExtractedBlock[]): ExtractedBlock[] {
  let lastNum: string | undefined
  let lastLetter: string | undefined

  return answers.map((answer) => {
    const seed = answer.labelNumber || inferLabelFromText(answer.text)
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
    } else if (parts.num) {
      // fully resolved from this block; keep last* in sync only
    } else {
      // completely unlabeled — do not invent a parent label
      return answer
    }

    const labelNumber = formatLabel(parts) || answer.labelNumber || seed
    if (!labelNumber) return answer
    return labelNumber === answer.labelNumber ? answer : { ...answer, labelNumber }
  })
}

/**
 * Pass 1: exact normalized label match.
 * Pass 2: cosine similarity on leftover unlabeled answers vs remaining questions.
 */
export async function mapAnswersToQuestions(
  questions: ExtractedBlock[],
  answers: ExtractedBlock[],
  embed: EmbedFn,
): Promise<MappedPair[]> {
  const leafQuestions = preferLeafBlocks(questions)
  const enrichedAnswers = preferLeafBlocks(enrichAnswerLabels(answers))

  const pairs: MappedPair[] = []
  const usedAnswerIds = new Set<string>()
  const usedQuestionIds = new Set<string>()

  const questionByLabel = new Map<string, ExtractedBlock>()
  for (const q of leafQuestions) {
    const label = normalizeLabel(q.labelNumber)
    if (label && !questionByLabel.has(label)) {
      questionByLabel.set(label, q)
    }
  }

  // Pass 1 — label exact match
  for (const answer of enrichedAnswers) {
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

  const remainingQuestions = leafQuestions.filter((q) => !usedQuestionIds.has(q.id))
  const remainingAnswers = enrichedAnswers.filter((a) => !usedAnswerIds.has(a.id))

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

  // Pass 3 — zip leftover answers onto leftover questions that share one major number
  // (common when answer sheet omits "21(b)(i)" labels but keeps reading order).
  {
    const leftQ = leafQuestions.filter((q) => !usedQuestionIds.has(q.id))
    const leftA = enrichedAnswers.filter((a) => !usedAnswerIds.has(a.id))
    if (leftQ.length > 0 && leftQ.length === leftA.length) {
      const majors = leftQ.map((q) => {
        const n = normalizeLabel(q.labelNumber)
        return n ? parseNormalizedLabel(n).num : undefined
      })
      const allSame =
        majors.every((m) => m && m === majors[0]) && Boolean(majors[0])
      if (allSame) {
        for (let i = 0; i < leftQ.length; i++) {
          const question = leftQ[i]
          const answer = leftA[i]
          pairs.push({
            id: `pair-${question.id}-${answer.id}`,
            status: 'matched',
            question,
            answer,
            similarity: 0.5,
          })
          usedQuestionIds.add(question.id)
          usedAnswerIds.add(answer.id)
        }
      }
    }
  }

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

  // Keep question order: matched/unanswered by question order, then unmatched answers
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
