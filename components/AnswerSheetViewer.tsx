'use client'

import { useEffect, useMemo, useState } from 'react'
import { padBbox } from '@/lib/bboxRepair'
import type { BBox, PageImage } from '@/lib/types'

export function AnswerSheetViewer({
  pages,
  highlight,
  highlightPageIndex,
  extraHighlights,
}: {
  pages: PageImage[]
  highlight?: BBox | null
  /** Page index where the primary highlight lives */
  highlightPageIndex?: number | null
  extraHighlights?: Array<{ pageIndex: number; bbox: BBox }>
}) {
  const [page, setPage] = useState(0)
  const [zoom, setZoom] = useState(100)

  useEffect(() => {
    if (
      typeof highlightPageIndex === 'number' &&
      highlightPageIndex >= 0 &&
      highlightPageIndex < pages.length
    ) {
      setPage(highlightPageIndex)
    }
  }, [highlightPageIndex, pages.length])

  const current = pages[page]

  const overlays = useMemo(() => {
    const result: BBox[] = []
    if (highlight && highlightPageIndex === page) result.push(padBbox(highlight))
    for (const extra of extraHighlights ?? []) {
      if (extra.pageIndex === page) result.push(padBbox(extra.bbox))
    }
    return result
  }, [highlight, highlightPageIndex, extraHighlights, page])

  if (!pages.length) {
    return (
      <section className="answer-panel">
        <div className="answer-head">
          <b>Answer Sheet</b>
        </div>
        <div className="paper sample-paper">
          <p>No answer sheet pages available.</p>
        </div>
      </section>
    )
  }

  return (
    <section className="answer-panel">
      <div className="answer-head">
        <b>Answer Sheet</b>
        <span className="viewer-controls">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(50, z - 10))}
            aria-label="Zoom out"
          >
            −
          </button>
          <em>{zoom}%</em>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(200, z + 10))}
            aria-label="Zoom in"
          >
            +
          </button>
          <button
            type="button"
            disabled={page <= 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            aria-label="Previous page"
          >
            ‹
          </button>
          Page {page + 1} of {pages.length}
          <button
            type="button"
            disabled={page >= pages.length - 1}
            onClick={() => setPage((p) => Math.min(pages.length - 1, p + 1))}
            aria-label="Next page"
          >
            ›
          </button>
        </span>
      </div>
      <div className="answer-viewport">
        <div className="page-stage" style={{ width: `${zoom}%` }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            className="page-image"
            src={current.imageBase64}
            alt={`Answer sheet page ${page + 1}`}
          />
          {overlays.map((box, i) => (
            <div
              key={i}
              className="bbox-highlight"
              style={{
                left: `${box.x * 100}%`,
                top: `${box.y * 100}%`,
                width: `${box.w * 100}%`,
                height: `${box.h * 100}%`,
              }}
            >
              <b>Answer</b>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
