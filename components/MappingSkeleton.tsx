'use client'

import { ProgressStepper } from '@/components/ProgressStepper'
import type { PipelineStage } from '@/lib/types'

function SkeletonBar({ width = '100%', height = 14 }: { width?: string; height?: number }) {
  return (
    <div
      className="skeleton-bar"
      style={{ width, height }}
      aria-hidden="true"
    />
  )
}

export function MappingSkeleton({
  stage,
  message,
}: {
  stage: PipelineStage
  message?: string
}) {
  return (
    <>
      <div className="skeleton-status">
        <ProgressStepper stage={stage} message={message} />
      </div>
      <div className="mobile-tabs skeleton-tabs" aria-hidden="true">
        <div className="skeleton-bar skeleton-tab" />
        <div className="skeleton-bar skeleton-tab" />
      </div>
      <div className="mapping skeleton-mapping">
        <section className="question-panel">
          <div className="panel-title">
            <SkeletonBar width="55%" height={18} />
            <SkeletonBar width={72} height={28} />
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton-question">
              <SkeletonBar width={28} height={16} />
              <SkeletonBar width={`${88 - i * 8}%`} />
              <SkeletonBar width={`${72 - i * 6}%`} />
              <SkeletonBar width={48} height={16} />
            </div>
          ))}
        </section>
        <section className="answer-panel">
          <div className="answer-head">
            <SkeletonBar width={100} height={18} />
            <SkeletonBar width={120} height={28} />
          </div>
          <div className="skeleton-paper">
            <SkeletonBar width="90%" height={20} />
            <SkeletonBar width="75%" />
            <SkeletonBar width="82%" />
            <SkeletonBar width="68%" />
            <SkeletonBar width="78%" />
          </div>
        </section>
      </div>
      <div className="skeleton-summary" aria-hidden="true">
        <SkeletonBar width={140} height={16} />
        <SkeletonBar width={100} height={16} />
      </div>
    </>
  )
}
