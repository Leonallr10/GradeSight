'use client'

import { useCallback, useState } from 'react'
import { AnswerSheetViewer } from '@/components/AnswerSheetViewer'
import { GradingSummaryBar } from '@/components/GradingSummary'
import { ProgressStepper } from '@/components/ProgressStepper'
import { QuestionList } from '@/components/QuestionList'
import { Sidebar, Topbar, UploadScreen } from '@/components/UploadScreen'
import { rasterizeFile } from '@/lib/pdf-rasterize'
import { dedupeNearDuplicatePages } from '@/lib/dedupePages'
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
    const msg = data?.error || `Request failed: ${url}`
    if (/403|insufficient permissions|Inference Providers on behalf/i.test(String(msg))) {
      throw new Error(
        `${msg} Create a fine-grained HF token with "Make calls to Inference Providers" at huggingface.co/settings/tokens and update HF_TOKEN in .env.local.`,
      )
    }
    if (/402|depleted|credits|quota|billing/i.test(String(msg))) {
      throw new Error(
        `${msg} Add HF Inference credits at huggingface.co/settings/billing, or enable legacy local extract (USE_LEGACY_LOCAL_EXTRACT=1 + LOCAL_EXTRACT_URL).`,
      )
    }
    throw new Error(msg)
  }
  return data as T
}

function assertExtractBlocks(
  blocks: ExtractedBlock[],
  role: 'question' | 'answer',
): void {
  if (blocks.length > 0) return
  if (role === 'question') {
    throw new Error(
      'No questions were extracted from the question paper. Upload QUESTION_PAPER.pdf in the left slot (not the handwritten answer sheet). If the file is correct, HF may have returned an empty response — retry or check HF credits.',
    )
  }
  throw new Error(
    'No answers were extracted from the answer sheet. Check the upload and retry.',
  )
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
  const [dedupeWarning, setDedupeWarning] = useState<string | null>(null)

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
    setDedupeWarning(null)

    try {
      setStage('uploading')
      setStatusMessage('Rasterizing PDF/image pages…')
      const [qRaw, aRaw] = await Promise.all([
        rasterizeFile(files.question),
        rasterizeFile(files.answer),
      ])
      const [qDeduped, aDeduped] = await Promise.all([
        dedupeNearDuplicatePages(qRaw),
        dedupeNearDuplicatePages(aRaw),
      ])
      const qPages = qDeduped.pages
      const aPages = aDeduped.pages
      setQuestionPages(qPages)
      setAnswerPages(aPages)
      const dedupeNotes = [qDeduped.warning, aDeduped.warning].filter(Boolean)
      if (dedupeNotes.length) {
        setDedupeWarning(dedupeNotes.join(' '))
        console.warn(dedupeNotes.join(' | '))
      }

      setStage('extracting')
      setStatusMessage('Extracting questions…')
      const qRes = await postJson<{ blocks: ExtractedBlock[]; via?: string }>('/api/extract', {
        role: 'question',
        pages: qPages,
      })
      assertExtractBlocks(qRes.blocks, 'question')
      setStatusMessage(
        `Extracting answers…${qRes.via ? ` (questions via ${qRes.via})` : ''}`,
      )
      const aRes = await postJson<{ blocks: ExtractedBlock[]; via?: string }>('/api/extract', {
        role: 'answer',
        pages: aPages,
      })
      assertExtractBlocks(aRes.blocks, 'answer')
      if (aRes.via && aRes.via !== 'hf') {
        console.info(`[extract] answers via ${aRes.via}`)
      }

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
      const hasQuestions = mapRes.pairs.some((p) => p.question)
      const unmatchedOnly =
        !hasQuestions && mapRes.pairs.some((p) => p.status === 'unmatched_answer')
      if (unmatchedOnly) {
        throw new Error(
          'Answers were extracted but no questions could be matched. Upload the printed question paper in the left slot and the handwritten answer sheet on the right.',
        )
      }
      setPairs(mapRes.pairs)

      setStage('grading')
      setStatusMessage('Grading matched answers with Groq…')
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
    setDedupeWarning(null)
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
      {dedupeWarning && (showMapping || showProcessing) && (
        <div className="dedupe-warning" role="status">
          {dedupeWarning}
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
