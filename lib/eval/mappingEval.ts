import {
  normLabel,
  pairKey,
  pct,
  round4,
  type ExpectedPairs,
  type MappedPair,
  type StageEvalReport,
} from './types'

export function evaluateMapping(args: {
  pairs: MappedPair[]
  expected?: ExpectedPairs | null
}): StageEvalReport {
  const { pairs, expected } = args
  const matched = pairs.filter((p) => p.status === 'matched')
  const unanswered = pairs.filter((p) => p.status === 'unanswered')
  const unmatched = pairs.filter((p) => p.status === 'unmatched_answer')

  const matchedWithBbox = matched.filter((p) => p.answer?.bbox)
  const matchedWithExtra = matched.filter((p) => (p.answer?.extraPages?.length ?? 0) > 0)
  const highlightRate = pct(matchedWithBbox.length, matched.length)

  let matchPrecision: number | null = null
  let matchRecall: number | null = null
  let matchF1: number | null = null

  if (expected?.should_match?.length) {
    const gold = new Set(
      expected.should_match.map((p) => pairKey(p.q, p.a)),
    )
    const pred = new Set(
      matched
        .map((p) => {
          const q = p.question?.labelNumber || p.question?.labelWritten
          const a = p.answer?.labelNumber || p.answer?.labelWritten
          if (!q || !a) return null
          return pairKey(q, a)
        })
        .filter((x): x is string => Boolean(x)),
    )
    let inter = 0
    for (const k of pred) if (gold.has(k)) inter += 1
    matchPrecision = pred.size ? inter / pred.size : 0
    matchRecall = gold.size ? inter / gold.size : 0
    matchF1 =
      matchPrecision + matchRecall > 0
        ? (2 * matchPrecision * matchRecall) / (matchPrecision + matchRecall)
        : 0
  }

  const outOfOrderLabel = expected?.out_of_order_q || '1(a)'
  const outNorm = normLabel(outOfOrderLabel)
  const outOfOrderOk = matched.some((p) => {
    const q = normLabel(p.question?.labelNumber || p.question?.labelWritten)
    return q === outNorm
  })

  const multipageOk = expected?.expect_multipage === false
    ? true
    : matchedWithExtra.length > 0

  const checks = [
    {
      id: 'status_coverage',
      pass: pairs.every((p) =>
        p.status === 'matched' || p.status === 'unanswered' || p.status === 'unmatched_answer',
      ),
      detail: `matched=${matched.length} unanswered=${unanswered.length} unmatched=${unmatched.length}`,
    },
    {
      id: 'highlight_bbox',
      pass: matched.length === 0 || highlightRate >= 1,
      detail: `${matchedWithBbox.length}/${matched.length} matched have bbox`,
    },
    {
      id: 'unanswered_detected',
      pass: unanswered.length > 0,
      detail: `${unanswered.length} unanswered`,
    },
    {
      id: 'unmatched_detected',
      pass: unmatched.length > 0,
      detail: `${unmatched.length} unmatched`,
    },
    {
      id: 'out_of_order',
      pass: outOfOrderOk,
      detail: outOfOrderOk
        ? `${outOfOrderLabel} matched (out-of-order ok)`
        : `${outOfOrderLabel} not matched`,
    },
    {
      id: 'multipage_span',
      pass: multipageOk,
      detail: `${matchedWithExtra.length} matched with extraPages`,
    },
  ]

  const pass = checks.every((c) => c.pass)

  return {
    stage: 'mapping',
    pass,
    checks,
    accuracy: {
      match_precision: matchPrecision != null ? round4(matchPrecision) : null,
      match_recall: matchRecall != null ? round4(matchRecall) : null,
      match_f1: matchF1 != null ? round4(matchF1) : null,
      highlight_bbox_rate: round4(highlightRate),
      unanswered_detected: unanswered.length > 0,
      unmatched_detected: unmatched.length > 0,
      out_of_order_ok: outOfOrderOk,
      multipage_ok: multipageOk,
    },
    summary: `Mapping accuracy — F1=${matchF1 != null ? (matchF1 * 100).toFixed(1) + '%' : 'n/a'}, highlight=${(highlightRate * 100).toFixed(1)}%, matched=${matched.length}`,
  }
}
