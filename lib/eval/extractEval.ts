import {
  labelSet,
  normLabel,
  pct,
  prf,
  round4,
  type ExpectedLabels,
  type ExtractedBlock,
  type StageEvalReport,
} from './types'

function hasLeafSubparts(labels: Array<string | null | undefined>): boolean {
  return labels.some((l) => {
    const n = normLabel(l)
    return Boolean(n && /[a-z]/.test(n))
  })
}

export function evaluateExtract(args: {
  questions: ExtractedBlock[]
  answers: ExtractedBlock[]
  expected?: ExpectedLabels | null
  pagesQuestion?: number
  pagesAnswer?: number
}): StageEvalReport {
  const { questions, answers, expected } = args
  const qLabels = questions.map((b) => b.labelNumber || b.labelWritten || null)
  const aLabels = answers.map((b) => b.labelNumber || b.labelWritten || null)

  const qPred = labelSet(questions)
  const aPred = labelSet(answers)
  const qGold = new Set((expected?.questions ?? []).map((l) => normLabel(l)!).filter(Boolean))
  const aGold = new Set((expected?.answers ?? []).map((l) => normLabel(l)!).filter(Boolean))

  const qPr = expected ? prf(qPred, qGold) : { precision: null, recall: null, f1: null }
  const aPr = expected ? prf(aPred, aGold) : { precision: null, recall: null, f1: null }

  const qBbox = questions.filter((b) => b.bbox).length
  const aBbox = answers.filter((b) => b.bbox).length
  const answerBboxCoverage = pct(aBbox, answers.length)
  const questionBboxCoverage = pct(qBbox, questions.length)

  const subpartOk = hasLeafSubparts(qLabels)
  const numberingOk = expected?.questions?.length
    ? true
    : qLabels.some((l) => {
        const n = normLabel(l)
        return Boolean(n && (n === '10' || n.startsWith('10')))
      })
  const enoughQuestions = expected?.questions?.length
    ? questions.length >= Math.min(10, expected.questions.length)
    : questions.length >= 10

  const checks = [
    {
      id: 'schema_blocks',
      pass: questions.every((b) => typeof b.text === 'string') && answers.every((b) => typeof b.text === 'string'),
      detail: `q=${questions.length} a=${answers.length}`,
    },
    {
      id: 'question_count',
      pass: enoughQuestions,
      detail: `${questions.length} questions (need ≥10)`,
    },
    {
      id: 'subpart_leaf_ok',
      pass: subpartOk,
      detail: subpartOk ? 'leaf lettered sub-parts present' : 'no lettered sub-parts',
    },
    {
      id: 'preserve_numbering',
      pass: numberingOk,
      detail: numberingOk ? 'includes question 10' : 'missing question 10',
    },
    {
      id: 'answer_bbox_coverage',
      pass: answers.length === 0 || answerBboxCoverage >= 0.8,
      detail: `${aBbox}/${answers.length} answers have bbox`,
    },
  ]

  const pass = checks.every((c) => c.pass)

  return {
    stage: 'extract',
    pass,
    checks,
    accuracy: {
      question_label_precision: qPr.precision != null ? round4(qPr.precision) : null,
      question_label_recall: qPr.recall != null ? round4(qPr.recall) : null,
      question_label_f1: qPr.f1 != null ? round4(qPr.f1) : null,
      answer_label_precision: aPr.precision != null ? round4(aPr.precision) : null,
      answer_label_recall: aPr.recall != null ? round4(aPr.recall) : null,
      answer_label_f1: aPr.f1 != null ? round4(aPr.f1) : null,
      answer_bbox_coverage: round4(answerBboxCoverage),
      question_bbox_coverage: round4(questionBboxCoverage),
      subpart_leaf_ok: subpartOk,
    },
    summary: `Extract accuracy — Q F1=${qPr.f1 != null ? (qPr.f1 * 100).toFixed(1) + '%' : 'n/a'}, A F1=${aPr.f1 != null ? (aPr.f1 * 100).toFixed(1) + '%' : 'n/a'}, answer bbox=${(answerBboxCoverage * 100).toFixed(1)}%`,
  }
}
