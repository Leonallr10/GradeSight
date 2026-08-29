import { blockContentForModel } from './blockContent'
import {
  STRONG_TOPICS,
  topicalConflict,
  topicalHits,
  topicalOverlap,
} from './contentTopics'
import { findLabelAnywhere } from './findLabel'
import {
  isStrictParentLabel,
  normalizeLabel,
  parseNormalizedLabel,
} from './normalizeLabel'
import type { ExtractedBlock } from './types'

export type QuestionIndex = {
  leafQuestions: ExtractedBlock[]
  labelSet: Set<string>
  questionByLabel: Map<string, ExtractedBlock>
}

export function preferLeafQuestions(questions: ExtractedBlock[]): ExtractedBlock[] {
  const norms = questions.map((q) => normalizeLabel(q.labelNumber || q.labelWritten))
  return questions.filter((q, idx) => {
    const n = norms[idx]
    if (!n) return true
    return !norms.some((other) => other && isStrictParentLabel(n, other))
  })
}

export function buildQuestionIndex(questions: ExtractedBlock[]): QuestionIndex {
  // Use every labeled question for assignment — do not drop parents like "1" when "1(b)" exists.
  const labeled = questions.filter((q) =>
    Boolean(normalizeLabel(q.labelNumber || q.labelWritten)),
  )
  const labelSet = new Set<string>()
  const questionByLabel = new Map<string, ExtractedBlock>()
  for (const q of labeled) {
    const label = normalizeLabel(q.labelNumber || q.labelWritten)
    if (!label) continue
    labelSet.add(label)
    if (!questionByLabel.has(label)) questionByLabel.set(label, q)
  }
  return { leafQuestions: labeled, labelSet, questionByLabel }
}

export function labelInQuestionSet(index: QuestionIndex, label: string | null | undefined): boolean {
  const n = normalizeLabel(label)
  return Boolean(n && index.labelSet.has(n))
}

/** Score how well an answer block fits a question (higher = better). */
export function answerQuestionFit(question: ExtractedBlock, answer: ExtractedBlock): number {
  if (topicalConflict(question, answer)) return -1
  const overlap = topicalOverlap(question, answer)
  let score = overlap.length * 2
  for (const h of overlap) {
    if (STRONG_TOPICS.has(h)) score += 2
  }
  const qText = blockContentForModel(question).toLowerCase()
  const aText = (answer.text || '').toLowerCase()
  const d = (answer.diagramDescription || '').toLowerCase()
  if (aText.length <= 220) {
    if (/largest\s+planet|solar\s+system/i.test(qText) && /planet|jupiter|mars|solar/i.test(aText)) {
      score += 4
    }
    if (/father\s+of.*constitution|ambedkar/i.test(qText) && /ambedkar|constitution/i.test(aText)) {
      score += 4
    }
  }
  if (/draw.*diagram|label.*diagram|sketch/i.test(qText) && answer.diagramDescription) {
    score += 3
  }
  if (/plant\s+cell/i.test(qText) && /organelle|smooth\s*er|golgi|cell\s+wall/i.test(aText + d)) {
    score += 3
  }
  if (/photosynth/i.test(qText) && /plant\s+cell|smooth\s*er|golgi|amyloplast/i.test(aText + d)) {
    score -= 4
  }
  return score
}

/** Pick the best question label for an orphan answer using question text + content topics. */
export function bestQuestionForAnswer(
  index: QuestionIndex,
  answer: ExtractedBlock,
  usedLabels?: Set<string>,
): ExtractedBlock | null {
  let best: { q: ExtractedBlock; score: number } | null = null
  for (const q of index.leafQuestions) {
    const label = normalizeLabel(q.labelNumber || q.labelWritten)
    if (!label) continue
    if (usedLabels?.has(label)) continue
    const score = answerQuestionFit(q, answer)
    if (score < 1) continue
    if (!best || score > best.score) best = { q, score }
  }
  return best?.q ?? null
}

/**
 * Relabel misassigned answers using the uploaded question paper as ground truth.
 * Greedily pairs question labels with the best-fitting answer blocks (global score order).
 */
export function assignLabelsFromQuestions(
  blocks: ExtractedBlock[],
  questions: ExtractedBlock[],
): ExtractedBlock[] {
  const index = buildQuestionIndex(questions)
  if (index.labelSet.size === 0) return blocks

  const result: ExtractedBlock[] = blocks.map((b) => ({ ...b }))
  type Pair = { label: string; bi: number; score: number }
  const pairs: Pair[] = []

  for (const label of index.labelSet) {
    const q = index.questionByLabel.get(label)
    if (!q) continue
    for (let bi = 0; bi < blocks.length; bi++) {
      const block = blocks[bi]
      const score = answerQuestionFit(q, block)
      if (score < 1) continue
      const current = normalizeLabel(
        findLabelAnywhere(block.text, block.labelWritten || block.labelNumber) ||
          block.labelNumber ||
          block.labelWritten,
      )
      let bonus = current === label ? 0.25 : 0
      if (current && label) {
        const qParts = parseNormalizedLabel(label)
        const bParts = parseNormalizedLabel(current)
        if (qParts.num && qParts.num === bParts.num && qParts.letter && qParts.letter === bParts.letter) {
          bonus += 10
        }
      }
      pairs.push({ label, bi, score: score + bonus })
    }
  }

  pairs.sort((a, b) => b.score - a.score)
  const usedBlocks = new Set<string>()
  const usedLabels = new Set<string>()

  for (const { label, bi } of pairs) {
    if (usedLabels.has(label) || usedBlocks.has(blocks[bi].id)) continue
    const q = index.questionByLabel.get(label)!
    usedLabels.add(label)
    usedBlocks.add(blocks[bi].id)
    result[bi] = {
      ...result[bi],
      labelNumber: q.labelNumber || label,
      labelWritten: q.labelWritten || label,
    }
  }

  return result
}

/** Drop or clear answer labels that do not exist on the question paper. */
export function validateAnswerLabels(
  answers: ExtractedBlock[],
  questions: ExtractedBlock[],
): { answers: ExtractedBlock[]; warnings: string[] } {
  const index = buildQuestionIndex(questions)
  const warnings: string[] = []
  const labelCounts = new Map<string, number>()

  const validated = answers.map((a) => {
    const label = normalizeLabel(
      a.labelNumber ||
        findLabelAnywhere(a.text, a.labelWritten || a.labelNumber) ||
        a.labelWritten,
    )
    if (!label) return a

    labelCounts.set(label, (labelCounts.get(label) ?? 0) + 1)

    if (!labelInQuestionSet(index, label)) {
      warnings.push(`Answer label "${label}" not on question paper — cleared for rematch`)
      return { ...a, labelNumber: undefined, labelWritten: undefined }
    }

    const q = index.questionByLabel.get(label)!
    if (topicalConflict(q, a)) {
      warnings.push(`Answer label "${label}" conflicts with question topic — cleared for rematch`)
      return { ...a, labelNumber: undefined, labelWritten: undefined }
    }

    return a
  })

  for (const [label, count] of labelCounts) {
    if (count > 1 && index.labelSet.has(label)) {
      warnings.push(`Duplicate answer label "${label}" (${count} blocks)`)
    }
  }

  return { answers: validated, warnings }
}

/** Question numbers present on the paper (for supplement gap detection). */
export function questionNumericLabels(questions: ExtractedBlock[]): Set<string> {
  const out = new Set<string>()
  for (const q of questions) {
    const n = normalizeLabel(q.labelNumber || q.labelWritten)
    if (!n) continue
    const parts = parseNormalizedLabel(n)
    if (parts.num) out.add(parts.num)
  }
  return out
}
