import { blockContentForModel } from './blockContent'
import { cosineSimilarity } from './cosine'
import { findLabelAnywhere } from './findLabel'
import { groupAnswersByLabel } from './groupAnswers'
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

export function enrichAnswerLabels(answers: ExtractedBlock[]): ExtractedBlock[] {
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

/** Reject obvious cross-topic false positives (e.g. photosynthesis ↔ Newton's laws). */
function topicalConflict(question: ExtractedBlock, answer: ExtractedBlock): boolean {
  const q = blockContentForModel(question).toLowerCase()
  const a = blockContentForModel(answer).toLowerCase()
  const topics: Array<{ name: string; re: RegExp }> = [
    { name: 'photo', re: /photosynth|chlorophyll|glucose|co2|carbon dioxide/ },
    { name: 'newton', re: /newton|inertia|\bf\s*=\s*ma\b|action\s+and\s+reaction|laws?\s+of\s+motion/ },
    { name: 'mitosis', re: /mitosis|meiosis|chromosome/ },
    { name: 'ladder', re: /ladder|pythagoras|hypotenuse|slides?\s+down/ },
    { name: 'path', re: /circular\s+field|annular|path.*radius|radius.*path/ },
    { name: 'drycell', re: /dry\s*cell|anode|cathode|electrolyte|zinc\s+can/ },
    { name: 'nobel', re: /nobel|marie\s+curie|radium/ },
    { name: 'planet', re: /red\s+planet|mars|solar\s+system/ },
    { name: 'ramrom', re: /\bram\b|\brom\b|volatile|bios/ },
    { name: 'python', re: /python|def\s+\w+|maximum of three/ },
    { name: 'quad', re: /quadratic|3x\^?2|roots?\s+are/ },
    { name: 'compos', re: /g\s*\(\s*f\s*\(|f\s*\(\s*3\s*\)/ },
  ]
  const qHits = topics.filter((t) => t.re.test(q)).map((t) => t.name)
  const aHits = topics.filter((t) => t.re.test(a)).map((t) => t.name)
  if (qHits.length === 0 || aHits.length === 0) return false
  return qHits.every((h) => !aHits.includes(h))
}

/**
 * Pass 1: exact normalized label match.
 * Pass 2: unlabeled leftovers only, cosine ≥ threshold, no topical conflict.
 * Labeled answers that miss Pass 1 stay unmatched (never fuzzy-remapped).
 */
export async function mapAnswersToQuestions(
  questions: ExtractedBlock[],
  answers: ExtractedBlock[],
  embed: EmbedFn,
): Promise<MappedPair[]> {
  const leafQuestions = preferLeafBlocks(questions)
  const grouped = groupAnswersByLabel(answers.filter((a) => !a.isStrikethrough))
  const enrichedAnswers = preferLeafBlocks(enrichAnswerLabels(grouped))

  const pairs: MappedPair[] = []
  const usedAnswerIds = new Set<string>()
  const usedQuestionIds = new Set<string>()

  const questionByLabel = new Map<string, ExtractedBlock>()
  for (const q of leafQuestions) {
    const label = normalizeLabel(q.labelNumber || q.labelWritten)
    if (label && !questionByLabel.has(label)) {
      questionByLabel.set(label, q)
    }
  }

  // Pass 1 — label exact match
  for (const answer of enrichedAnswers) {
    const label = normalizeLabel(
      findLabelAnywhere(answer.text, answer.labelWritten || answer.labelNumber) ||
        answer.labelNumber ||
        answer.labelWritten,
    )
    if (!label) continue
    const question = questionByLabel.get(label)
    if (!question || usedQuestionIds.has(question.id)) continue

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

  const remainingQuestions = leafQuestions.filter((q) => !usedQuestionIds.has(q.id))
  // Only unlabeled answers may enter Pass 2 — labeled misses stay unmatched
  const remainingAnswers = enrichedAnswers.filter((a) => {
    if (usedAnswerIds.has(a.id)) return false
    const label = normalizeLabel(
      findLabelAnywhere(a.text, a.labelWritten || a.labelNumber) ||
        a.labelNumber ||
        a.labelWritten,
    )
    return !label
  })

  if (remainingQuestions.length > 0 && remainingAnswers.length > 0) {
    const qTexts = remainingQuestions.map((q) => blockContentForModel(q))
    const aTexts = remainingAnswers.map((a) => blockContentForModel(a))
    const [qEmb, aEmb] = await Promise.all([embed(qTexts), embed(aTexts)])

    type Candidate = { qi: number; ai: number; score: number }
    const candidates: Candidate[] = []

    for (let qi = 0; qi < remainingQuestions.length; qi++) {
      for (let ai = 0; ai < remainingAnswers.length; ai++) {
        if (topicalConflict(remainingQuestions[qi], remainingAnswers[ai])) continue
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
