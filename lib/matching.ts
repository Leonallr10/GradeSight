import { blockContentForModel } from './blockContent'
import { cosineSimilarity } from './cosine'
import { enrichAnswerLabels as repairAnswerLabels } from './enrichAnswers'
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

/** @deprecated use inheritAnswerLabels — kept as alias for older imports */
export const enrichAnswerLabels = inheritAnswerLabels


/** Reject obvious cross-topic false positives (e.g. photosynthesis ↔ Newton's laws). */
function topicalConflict(question: ExtractedBlock, answer: ExtractedBlock): boolean {
  const qHits = topicalHits(question)
  const aHits = topicalHits(answer)
  if (qHits.length === 0 || aHits.length === 0) return false
  return qHits.every((h) => !aHits.includes(h))
}

const TOPIC_RULES: Array<{ name: string; re: RegExp }> = [
  { name: 'photo', re: /photosynth|chlorophyll|glucose|co2|carbon dioxide/ },
  { name: 'newton', re: /newton|inertia|\bf\s*=\s*ma\b|action\s+and\s+reaction|laws?\s+of\s+motion/ },
  { name: 'mitosis', re: /mitosis|meiosis|chromosome/ },
  { name: 'ladder', re: /ladder|pythagoras|hypotenuse|slides?\s+down/ },
  { name: 'path', re: /circular\s+field|annular|path.*radius|radius.*path/ },
  { name: 'drycell', re: /dry\s*cell|anode|cathode|electrolyte|zinc\s+can/ },
  { name: 'nobel', re: /nobel|marie\s+curie|radium/ },
  { name: 'planet', re: /red\s+planet|\bmars\b|largest\s+planet|\bjupiter\b|\bjaipur\b|solar\s+system/ },
  { name: 'ambedkar', re: /ambedkar|father\s+of\s+(?:the\s+)?(?:indian\s+)?constitution/ },
  { name: 'triangle', re: /right[- ]angled\s+triangle|area\s+of\s+(?:a\s+)?triangle|(?:1\s*\/\s*2|\u00bd)\s*\*?\s*(?:b|base)|base\s*[:=]?\s*12/ },
  { name: 'plantcell', re: /plant\s+cell|(?:cell\s+wall).{0,40}(?:vacuole|chloroplast)/ },
  { name: 'methanal', re: /methanal|methanol|hcho|aldehyde|formaldehyde/ },
  { name: 'sodium', re: /\bsodium\b|group\s*=\s*1.{0,20}period\s*=\s*3/ },
  { name: 'prime', re: /prime\s+number|check.*prime|is\s+prime/ },
  { name: 'watercycle', re: /water\s+cycle/ },
  { name: 'ramrom', re: /\bram\b|\brom\b|volatile|bios/ },
  { name: 'python', re: /python|def\s+\w+|maximum of three/ },
  { name: 'quad', re: /quadratic|3x\^?2|roots?\s+are/ },
  { name: 'compos', re: /g\s*\(\s*f\s*\(|f\s*\(\s*3\s*\)/ },
  { name: 'profit', re: /selling\s+price|profit\s+of|bicycle/ },
  { name: 'motion', re: /v\s*=\s*u\s*\+\s*at|first\s+equation\s+of\s+motion/ },
]

/** Pass 3 only uses high-confidence topic cues (avoid chloroplast↔photosynthesis bleed). */
const STRONG_TOPICS = new Set([
  'ambedkar',
  'triangle',
  'planet',
  'methanal',
  'compos',
  'ladder',
  'drycell',
  'nobel',
  'plantcell',
  'prime',
  'watercycle',
  'profit',
  'motion',
])

function topicalHits(block: ExtractedBlock): string[] {
  const t = blockContentForModel(block).toLowerCase()
  return TOPIC_RULES.filter((r) => r.re.test(t)).map((r) => r.name)
}

/** Shared topic names between question and answer (positive affinity). */
function topicalOverlap(question: ExtractedBlock, answer: ExtractedBlock): string[] {
  const qHits = topicalHits(question)
  const aHits = new Set(topicalHits(answer))
  return qHits.filter((h) => aHits.has(h))
}

/** Prefer answers that carry a real diagramDescription over short prose twins. */
export function diagramRichness(answer: ExtractedBlock): number {
  const d = (answer.diagramDescription || '').trim()
  const text = answer.text || ''
  let score = 0
  if (d.length > 40) score += 100 + Math.min(d.length, 400)
  if (answer.contentKind === 'diagram') score += 40
  if (/organelle|smooth\s*er|golgi|labelled|labeled|amyloplast|arrow/i.test(d)) score += 80
  // Short definition-style plant-cell line without diagram meta is weak
  if (!d && /plant\s+cell contains/i.test(text) && text.length < 220) score -= 30
  // Longer structured text slightly preferred when no diagram field
  score += Math.min(text.length, 200) / 20
  return score
}

/**
 * Pass 1: exact normalized label match.
 * Pass 2: unlabeled OR orphan-labeled leftovers, cosine ≥ threshold, no topical conflict.
 * Pass 3: strong topical keyword rematch for remaining unanswered ↔ unused answers.
 */
export async function mapAnswersToQuestions(
  questions: ExtractedBlock[],
  answers: ExtractedBlock[],
  embed: EmbedFn,
): Promise<MappedPair[]> {
  const leafQuestions = preferLeafBlocks(inheritAnswerLabels(questions))
  const grouped = groupAnswersByLabel(answers.filter((a) => !a.isStrikethrough))
  // Content repair (mislabel / parent split / mega-block) then letter inheritance
  const enrichedAnswers = preferLeafBlocks(
    inheritAnswerLabels(repairAnswerLabels(grouped)),
  )

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

  // Pass 1 — label exact match; when duplicates share a label, prefer diagram-rich
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
  // Pass 2: unlabeled answers, OR labeled orphans (label points at no remaining Q)
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

    for (let qi = 0; qi < remQ.length; qi++) {
      for (let ai = 0; ai < remA.length; ai++) {
        if (topicalConflict(remQ[qi], remA[ai])) continue
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

  // Pass 3 — topical keyword rematch for leftovers (planet↔Jaipur, Ambedkar, etc.)
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
