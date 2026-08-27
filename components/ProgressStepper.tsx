'use client'

import type { PipelineStage } from '@/lib/types'

const STEPS: Array<{ id: PipelineStage; label: string }> = [
  { id: 'uploading', label: 'Uploading' },
  { id: 'extracting', label: 'Extracting' },
  { id: 'validating', label: 'Validating' },
  { id: 'mapping', label: 'Mapping' },
  { id: 'grading', label: 'Grading' },
  { id: 'done', label: 'Done' },
]

const ORDER: PipelineStage[] = [
  'uploading',
  'extracting',
  'validating',
  'mapping',
  'grading',
  'done',
]

export function ProgressStepper({
  stage,
  message,
}: {
  stage: PipelineStage
  message?: string
}) {
  const currentIdx = ORDER.indexOf(stage === 'error' ? 'extracting' : stage)
  const title =
    stage === 'error'
      ? 'Something went wrong'
      : STEPS.find((s) => s.id === stage)?.label ?? 'Processing'

  return (
    <div className="loading-screen">
      <div className="sparkles" aria-hidden="true">
        <span>✦</span>
        <span>✦</span>
        <span>✦</span>
      </div>
      <h2>{title}...</h2>
      <p>{message || 'This may take a while'}</p>
      <ol className="progress-stepper">
        {STEPS.map((step, idx) => {
          const state =
            stage === 'error'
              ? 'idle'
              : idx < currentIdx
                ? 'done'
                : idx === currentIdx
                  ? 'active'
                  : 'idle'
          return (
            <li key={step.id} className={`step ${state}`}>
              <span className="dot" />
              <span className="label">{step.label}</span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
