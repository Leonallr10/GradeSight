'use client'

import type { GradingSummary } from '@/lib/types'

export function GradingSummaryBar({ summary }: { summary: GradingSummary }) {
  return (
    <footer className="grading-summary">
      <div className="summary-score">
        <b>
          {summary.totalScore} / {summary.maxScore}
        </b>
        <span>Total score</span>
      </div>
      <div className="summary-counts">
        <span>
          <em>{summary.answered}</em> answered
        </span>
        <span>
          <em>{summary.unanswered}</em> unanswered
        </span>
        <span>
          <em>{summary.unmatched}</em> unmatched
        </span>
      </div>
      <p className="summary-feedback">{summary.overallFeedback}</p>
    </footer>
  )
}
