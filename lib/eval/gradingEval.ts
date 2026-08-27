import {
  normLabel,
  pct,
  round4,
  type ExpectedGrades,
  type GradingSummary,
  type MappedPair,
  type StageEvalReport,
} from './types'

export function evaluateGrading(args: {
  summary: GradingSummary
  pairs: MappedPair[]
  expected?: ExpectedGrades | null
}): StageEvalReport {
  const { summary, pairs, expected } = args
  const needRows = pairs.filter(
    (p) => p.status === 'matched' || p.status === 'unanswered',
  )
  const grades = summary.grades ?? []
  const coverage = pct(grades.length, needRows.length)

  const boundsOk = grades.filter(
    (g) =>
      typeof g.score === 'number' &&
      typeof g.maxScore === 'number' &&
      g.score >= 0 &&
      g.score <= g.maxScore,
  )
  const boundsRate = pct(boundsOk.length, grades.length || 1)

  const unansweredPairs = pairs.filter((p) => p.status === 'unanswered')
  const unansweredIds = new Set(
    unansweredPairs.map((p) => p.id),
  )
  // Also match grades that reference unanswered via pairId patterns
  const unansweredGrades = grades.filter(
    (g) => unansweredIds.has(g.pairId) || g.pairId.startsWith('unanswered'),
  )
  const unansweredZero = unansweredGrades.filter((g) => g.score === 0)
  const unansweredZeroRate =
    unansweredGrades.length > 0
      ? pct(unansweredZero.length, unansweredGrades.length)
      : unansweredPairs.length === 0
        ? 1
        : 0

  const withFeedback = grades.filter((g) => Boolean(g.feedback?.trim()))
  const feedbackRate = pct(withFeedback.length, grades.length || 1)

  const sumScores = grades.reduce((s, g) => s + (g.score || 0), 0)
  const totalsOk = Math.abs(sumScores - (summary.totalScore || 0)) < 0.01
  const overallOk = Boolean(summary.overallFeedback?.trim())

  let gradingAgreement: number | null = null
  if (expected?.grades?.length) {
    const byQ = new Map(
      expected.grades.map((g) => [normLabel(g.q), g] as const),
    )
    let agree = 0
    let n = 0
    for (const p of pairs.filter((x) => x.status === 'matched')) {
      const qn = normLabel(p.question?.labelNumber || p.question?.labelWritten)
      if (!qn || !byQ.has(qn)) continue
      const gold = byQ.get(qn)!
      const grade = grades.find((g) => g.pairId === p.id)
      if (!grade) continue
      n += 1
      if (grade.score === gold.score && grade.maxScore === gold.maxScore) agree += 1
    }
    gradingAgreement = n > 0 ? agree / n : null
  }

  const checks = [
    {
      id: 'grade_row_coverage',
      pass: grades.length >= needRows.length && needRows.length > 0,
      detail: `${grades.length} rows for ${needRows.length} matched+unanswered`,
    },
    {
      id: 'score_bounds',
      pass: boundsRate >= 1,
      detail: `${boundsOk.length}/${grades.length} within bounds`,
    },
    {
      id: 'unanswered_zero',
      pass: unansweredZeroRate >= 1 || unansweredPairs.length === 0,
      detail: `${unansweredZero.length}/${unansweredGrades.length || unansweredPairs.length} unanswered scored 0`,
    },
    {
      id: 'feedback_present',
      pass: feedbackRate >= 0.9 && overallOk,
      detail: `row feedback ${(feedbackRate * 100).toFixed(0)}%; overall=${overallOk}`,
    },
    {
      id: 'totals_consistent',
      pass: totalsOk,
      detail: `sum=${sumScores} totalScore=${summary.totalScore}`,
    },
  ]

  const pass = checks.every((c) => c.pass)

  return {
    stage: 'grading',
    pass,
    checks,
    accuracy: {
      grade_row_coverage: round4(coverage),
      score_bounds_ok: round4(boundsRate),
      unanswered_zero_ok: round4(unansweredZeroRate),
      feedback_present: round4(feedbackRate),
      totals_consistent: totalsOk,
      grading_agreement: gradingAgreement != null ? round4(gradingAgreement) : null,
    },
    summary: `Grading accuracy — coverage=${(coverage * 100).toFixed(1)}%, bounds=${(boundsRate * 100).toFixed(1)}%, score=${summary.totalScore}/${summary.maxScore}`,
  }
}
