'use client'

import { useState } from 'react'
import { Download, CheckCircle2 } from 'lucide-react'
import { contentKindLabel } from '@/lib/blockContent'
import { generateEvaluationReportPdf } from '@/lib/generatePdf'
import type { ExtractedBlock, GradeResult, GradingSummary, MappedPair } from '@/lib/types'

function scoreLabel(grade?: GradeResult): string {
  if (!grade) return '— / —'
  return `${grade.score} / ${grade.maxScore}`
}

function BlockBody({ block }: { block: ExtractedBlock | null | undefined }) {
  if (!block) return <span>—</span>
  const kind = contentKindLabel(block.contentKind)
  return (
    <div className="block-body">
      {kind && <span className={`content-kind kind-${block.contentKind}`}>{kind}</span>}
      <span className="block-text">{block.text}</span>
      {block.mathLatex ? (
        <code className="math-latex" title="Extracted formula (LaTeX)">
          {block.mathLatex}
        </code>
      ) : null}
      {block.diagramDescription ? (
        <p className="diagram-desc">
          <b>Diagram:</b> {block.diagramDescription}
        </p>
      ) : null}
    </div>
  )
}

export function QuestionList({
  pairs,
  grades,
  summary,
  selectedId,
  onSelect,
}: {
  pairs: MappedPair[]
  grades: GradeResult[]
  summary?: GradingSummary | null
  selectedId: string | null
  onSelect: (pair: MappedPair) => void
}) {
  const gradeMap = new Map(grades.map((g) => [g.pairId, g]))
  const questionPairs = pairs.filter((p) => p.status !== 'unmatched_answer')
  const unmatched = pairs.filter((p) => p.status === 'unmatched_answer')

  const [expanded, setExpanded] = useState<string[]>(() =>
    selectedId ? [selectedId] : [],
  )
  const [downloading, setDownloading] = useState(false)
  const [downloaded, setDownloaded] = useState(false)

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

  const handleDownloadPdf = () => {
    try {
      setDownloading(true)
      generateEvaluationReportPdf({
        pairs,
        grades,
        summary: summary || null,
        documentTitle: 'GradeSight Assessment & Feedback Report',
      })
      setDownloaded(true)
      setTimeout(() => setDownloaded(false), 2500)
    } catch (err) {
      console.error('Failed to generate PDF:', err)
      alert('Failed to generate PDF. Please try again.')
    } finally {
      setDownloading(false)
    }
  }

  return (
    <section className="question-panel">
      <div className="panel-title">
        <b>
          Extracted Questions <small>(from question paper)</small>
        </b>
        <div className="panel-actions">
          <button type="button" onClick={expandAll}>
            {allExpanded ? 'Collapse All' : 'Expand All'}
          </button>
          <button
            type="button"
            className="download-pdf-btn"
            onClick={handleDownloadPdf}
            disabled={downloading || questionPairs.length === 0}
            title="Download Evaluated Questions and AI Feedback as PDF"
          >
            {downloaded ? (
              <>
                <CheckCircle2 size={12} />
                <span>Downloaded</span>
              </>
            ) : (
              <>
                <Download size={12} />
                <span>{downloading ? 'Exporting…' : 'Download PDF'}</span>
              </>
            )}
          </button>
        </div>
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
              <BlockBody block={pair.question} />
              <b className="score">{scoreLabel(grade)}</b>
              <span>{isExpanded ? '⌃' : '⌄'}</span>
            </button>
            {isExpanded && (
              <div className="feedback">
                <b>{unanswered ? 'No answer mapped' : 'AI Feedback'}</b>
                {pair.answer && !unanswered ? (
                  <div className="answer-preview">
                    <b>Mapped answer</b>
                    <BlockBody block={pair.answer} />
                  </div>
                ) : null}
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
                <BlockBody block={pair.answer} />
                <b className="score">Unmatched</b>
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  )
}
