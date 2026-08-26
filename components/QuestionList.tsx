'use client'

import { useState } from 'react'
import type { GradeResult, MappedPair } from '@/lib/types'

function scoreLabel(grade?: GradeResult): string {
  if (!grade) return '— / —'
  return `${grade.score} / ${grade.maxScore}`
}

export function QuestionList({
  pairs,
  grades,
  selectedId,
  onSelect,
}: {
  pairs: MappedPair[]
  grades: GradeResult[]
  selectedId: string | null
  onSelect: (pair: MappedPair) => void
}) {
  const gradeMap = new Map(grades.map((g) => [g.pairId, g]))
  const questionPairs = pairs.filter((p) => p.status !== 'unmatched_answer')
  const unmatched = pairs.filter((p) => p.status === 'unmatched_answer')

  const [expanded, setExpanded] = useState<string[]>(() =>
    selectedId ? [selectedId] : [],
  )

  const allExpanded =
    questionPairs.length > 0 && questionPairs.every((p) => expanded.includes(p.id))

  const toggleExpand = (id: string) => {
    setExpanded((items) =>
      items.includes(id) ? items.filter((item) => item !== id) : [...items, id],
    )
  }

  const expandAll = () => {
    setExpanded(allExpanded ? [] : questionPairs.map((p) => p.id))
  }

  return (
    <section className="question-panel">
      <div className="panel-title">
        <b>
          Extracted Questions <small>(from question paper)</small>
        </b>
        <button type="button" onClick={expandAll}>
          {allExpanded ? 'Collapse All' : 'Expand All'}
        </button>
      </div>
      {questionPairs.map((pair, idx) => {
        const grade = gradeMap.get(pair.id)
        const unanswered = pair.status === 'unanswered'
        const label = pair.question?.labelNumber?.trim() || String(idx + 1)
        const isExpanded = expanded.includes(pair.id)
        const selected = selectedId === pair.id
        return (
          <article
            key={pair.id}
            className={`question ${unanswered ? 'unanswered' : ''} ${selected ? 'selected' : ''}`}
          >
            <button
              className="q-row"
              onClick={() => {
                onSelect(pair)
                toggleExpand(pair.id)
              }}
              aria-expanded={isExpanded}
            >
              <strong>{label}</strong>
              <span>{pair.question?.text ?? '—'}</span>
              <b className="score">{scoreLabel(grade)}</b>
              <span>{isExpanded ? '⌃' : '⌄'}</span>
            </button>
            {isExpanded && (
              <div className="feedback">
                <b>{unanswered ? 'No answer mapped' : 'AI Feedback'}</b>
                <p>
                  {grade?.feedback ||
                    (unanswered
                      ? 'This question appears to be unanswered in the uploaded sheet.'
                      : 'Answer located and matched to this question.')}
                </p>
              </div>
            )}
          </article>
        )
      })}
      {unmatched.length > 0 && (
        <div className="unmatched-section">
          <div className="panel-title">
            <b>Unmatched answers</b>
          </div>
          {unmatched.map((pair) => (
            <article
              key={pair.id}
              className={`question unmatched ${selectedId === pair.id ? 'selected' : ''}`}
            >
              <button className="q-row" onClick={() => onSelect(pair)}>
                <strong>?</strong>
                <span>{pair.answer?.text ?? '—'}</span>
                <b className="score">Unmatched</b>
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
