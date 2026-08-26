'use client'

import { useCallback, useState } from 'react'
import { AnswerSheetViewer } from '@/components/AnswerSheetViewer'
import { GradingSummaryBar } from '@/components/GradingSummary'
import { ProgressStepper } from '@/components/ProgressStepper'
import { QuestionList } from '@/components/QuestionList'
import { Sidebar, Topbar, UploadScreen } from '@/components/UploadScreen'
import { rasterizeFile } from '@/lib/pdf-rasterize'
import type {
  ExtractedBlock,
  GradeResult,
  GradingSummary,
  MappedPair,
  PageImage,
  PipelineStage,
} from '@/lib/types'

type FileKind = 'question' | 'answer'

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const data = await res.json()
  if (!res.ok) {
    throw new Error(data?.error || `Request failed: ${url}`)
  }
  return data as T
}

function MappingScreen({
  pairs,
  grades,
  summary,
  answerPages,
}: {
  pairs: MappedPair[]
  grades: GradeResult[]
  summary: GradingSummary | null
  answerPages: PageImage[]
}) {
  const [selectedId, setSelectedId] = useState<string | null>(
    pairs.find((p) => p.status === 'matched')?.id ?? pairs[0]?.id ?? null,
  )
  const [tab, setTab] = useState<'questions' | 'answer'>('questions')

  const selected = pairs.find((p) => p.id === selectedId) ?? null
  const answerBlock = selected?.answer ?? null

  return (
    <>
      <div className="mobile-tabs">
        <button
          className={tab === 'questions' ? 'selected' : ''}
          onClick={() => setTab('questions')}
        >
          Questions
        </button>
        <button
          className={tab === 'answer' ? 'selected' : ''}
          onClick={() => setTab('answer')}
        >
          Answer Sheet
        </button>
      </div>
      <div className="mapping">
        <div className={tab === 'answer' ? 'mobile-hidden' : ''}>
          <QuestionList
            pairs={pairs}
            grades={grades}
            selectedId={selectedId}
            onSelect={(pair) => {
              setSelectedId(pair.id)
              if (pair.answer) setTab('answer')
            }}
          />
        </div>
        <div className={tab === 'questions' ? 'mobile-hidden' : ''}>
          <AnswerSheetViewer
            pages={answerPages}
            highlight={answerBlock?.bbox ?? null}
            highlightPageIndex={answerBlock?.pageIndex ?? null}
            extraHighlights={answerBlock?.extraPages}
          />
        </div>
      </div>
      {summary && <GradingSummaryBar summary={summary} />}
    </>
  )
}

export default function Page() {
  const [stage, setStage] = useState<PipelineStage>('upload')
  const [files, setFiles] = useState<Record<FileKind, File | null>>({
    question: null,
    answer: null,
  })
  const [statusMessage, setStatusMessage] = useState<string>('')
  const [error, setError] = useState<string | null>(null)

  const [questionPages, setQuestionPages] = useState<PageImage[]>([])
  const [answerPages, setAnswerPages] = useState<PageImage[]>([])
  const [pairs, setPairs] = useState<MappedPair[]>([])
  const [grades, setGrades] = useState<GradeResult[]>([])
  const [summary, setSummary] = useState<GradingSummary | null>(null)

  const setFile = (kind: FileKind, file: File | null) => {
    if (file && file.size > 10 * 1024 * 1024) {
      setError('Each file must be under 10MB')
      return
    }
    setError(null)
    setFiles((prev) => ({ ...prev, [kind]: file }))
  }

  const runPipeline = useCallback(async () => {
    if (!files.question || !files.answer) return
    setError(null)

    try {
      setStage('uploading')
      setStatusMessage('Rasterizing PDF/image pages…')
      const [qPages, aPages] = await Promise.all([
        rasterizeFile(files.question),
        rasterizeFile(files.answer),
      ])
      setQuestionPages(qPages)
      setAnswerPages(aPages)

      setStage('extracting')
      setStatusMessage('Extracting questions with Qwen2.5-VL…')
      const qRes = await postJson<{ blocks: ExtractedBlock[] }>('/api/extract', {
        role: 'question',
        pages: qPages,
      })
      setStatusMessage('Extracting answers with Qwen2.5-VL…')
      const aRes = await postJson<{ blocks: ExtractedBlock[] }>('/api/extract', {
        role: 'answer',
        pages: aPages,
      })

      setStage('validating')
      setStatusMessage('Validating bounding boxes…')
      const qVal = await postJson<{ blocks: ExtractedBlock[] }>('/api/validate-bbox', {
        blocks: qRes.blocks,
        pages: qPages,
      })
      const aVal = await postJson<{ blocks: ExtractedBlock[] }>('/api/validate-bbox', {
        blocks: aRes.blocks,
        pages: aPages,
      })

      setStage('mapping')
      setStatusMessage('Matching answers to questions…')
      const mapRes = await postJson<{ pairs: MappedPair[] }>('/api/map-answers', {
        questions: qVal.blocks,
        answers: aVal.blocks,
      })
      setPairs(mapRes.pairs)

      setStage('grading')
      setStatusMessage('Grading matched answers…')
      const gradeRes = await postJson<{ summary: GradingSummary }>('/api/grade', {
        pairs: mapRes.pairs,
      })
      setSummary(gradeRes.summary)
      setGrades(gradeRes.summary.grades)

      setStage('done')
      setStatusMessage('')
    } catch (err) {
      console.error(err)
      setError(err instanceof Error ? err.message : 'Pipeline failed')
      setStage('error')
    }
  }, [files.question, files.answer])

  const back = () => {
    setStage('upload')
    setError(null)
    setStatusMessage('')
    setPairs([])
    setGrades([])
    setSummary(null)
  }

  const showProcessing =
    stage === 'uploading' ||
    stage === 'extracting' ||
    stage === 'validating' ||
    stage === 'mapping' ||
    stage === 'grading' ||
    stage === 'error'

  const showMapping = stage === 'done'

  const workspace = (
    <>
      {stage === 'upload' && (
        <UploadScreen files={files} onStart={runPipeline} setFile={setFile} error={error} />
      )}
      {showProcessing && (
        <ProgressStepper
          stage={stage}
          message={
            stage === 'error'
              ? error || 'Something went wrong. Go back and try again.'
              : statusMessage
          }
        />
      )}
      {stage === 'error' && (
        <div className="error-actions">
          <button className="primary" onClick={back}>
            Back to upload
          </button>
        </div>
      )}
      {showMapping && (
        <MappingScreen
          pairs={pairs}
          grades={grades}
          summary={summary}
          answerPages={answerPages}
        />
      )}
    </>
  )

  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  return (
    <main className={`app-shell ${sidebarCollapsed ? 'sidebar-collapsed' : ''}`}>
      <div className={`desktop-side ${sidebarCollapsed ? 'narrow' : ''}`}>
        <Sidebar
          collapsed={sidebarCollapsed}
          onToggle={() => setSidebarCollapsed((v) => !v)}
        />
      </div>
      <div className="workspace">
        <Topbar onBack={back} />
        <div className="workspace-content">
          {workspace}
        </div>
      </div>
      <div className="mobile-workspace">
        <Topbar mobile onBack={back} />
        {workspace}
      </div>
    </main>
  )
}
