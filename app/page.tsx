'use client'

import { useCallback, useState } from 'react'
import { AnswerSheetViewer } from '@/components/AnswerSheetViewer'
import { GradingSummaryBar } from '@/components/GradingSummary'
import { ProgressStepper } from '@/components/ProgressStepper'
import { QuestionList } from '@/components/QuestionList'
import { Topbar, UploadScreen } from '@/components/UploadScreen'
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

import { KeyRound } from 'lucide-react'

type FileKind = 'question' | 'answer'

function getStoredHfToken(): string | null {
  if (typeof window === 'undefined') return null
  return (
    localStorage.getItem('gradesight_hf_token') ||
    localStorage.getItem('HF_TOKEN') ||
    null
  )
}

function isHfKeyError(msg: string): boolean {
  return /HF 429|HF 402|HF 401|HF 403|rate limit|credits depleted|credits exhausted|quota exceeded|quota or credits|invalid token|insufficient permissions|Inference Providers|HF_TOKEN is not set/i.test(
    msg,
  )
}

async function postJson<T>(url: string, body: unknown): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const hfToken = getStoredHfToken()
  if (hfToken) {
    headers['x-hf-token'] = hfToken
  }

  const res = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 413) {
      throw new Error(
        'Upload payload too large for the server (Vercel limit ~4.5MB per request). Use fewer pages, smaller PDFs, or re-deploy after the latest fix.',
      )
    }
    let msg = data?.error || `Request failed: ${url}`
    if (/429|rate.?limit|too many requests/i.test(String(msg))) {
      msg = `HF API Rate Limit Reached: Your Hugging Face token has hit its request limit. Please update your HF API Key in the top header to continue.`
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('gradesight:hf-key-error', {
            detail: { message: msg },
          }),
        )
      }
      throw new Error(msg)
    }
    if (/402|depleted|credits|quota|billing|RESOURCE_EXHAUSTED/i.test(String(msg))) {
      msg = `HF Credits Depleted: Hugging Face inference quota or credits are exhausted. Please update your API key in the top header or add credits at huggingface.co/settings/billing.`
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('gradesight:hf-key-error', {
            detail: { message: msg },
          }),
        )
      }
      throw new Error(msg)
    }
    if (/401|invalid token|token expired|unauthorized/i.test(String(msg))) {
      msg = `HF Token Expired/Invalid: Your Hugging Face API key is invalid or has expired. Please configure a valid key in the top header.`
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('gradesight:hf-key-error', {
            detail: { message: msg },
          }),
        )
      }
      throw new Error(msg)
    }
    if (/403|insufficient permissions|Inference Providers on behalf/i.test(String(msg))) {
      msg = `HF Token Permission Issue: Create a fine-grained token with "Make calls to Inference Providers" at huggingface.co/settings/tokens and update your HF Key in the top header.`
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('gradesight:hf-key-error', {
            detail: { message: msg },
          }),
        )
      }
      throw new Error(msg)
    }
    if (isHfKeyError(String(msg)) && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('gradesight:hf-key-error', {
          detail: { message: String(msg) },
        }),
      )
    }
    throw new Error(msg)
  }
  return data as T
}

async function extractDocument(
  role: 'question' | 'answer',
  pages: PageImage[],
  onProgress: (message: string) => void,
): Promise<{ blocks: ExtractedBlock[]; via?: string }> {
  const allBlocks: ExtractedBlock[] = []
  let via: string | undefined
  const label = role === 'question' ? 'questions' : 'answers'

  for (let i = 0; i < pages.length; i++) {
    onProgress(`Extracting ${label}… page ${i + 1} of ${pages.length}`)
    const res = await postJson<{ blocks: ExtractedBlock[]; via?: string }>('/api/extract', {
      role,
      pages: [pages[i]],
    })
    allBlocks.push(...res.blocks)
    via = res.via ?? via
  }

  return { blocks: allBlocks, via }
}

async function validateBlocks(
  blocks: ExtractedBlock[],
  pages: PageImage[],
  onProgress: (message: string) => void,
): Promise<ExtractedBlock[]> {
  const pageMap = new Map(pages.map((p) => [p.pageIndex, p]))
  const byPage = new Map<number, ExtractedBlock[]>()

  for (const block of blocks) {
    const list = byPage.get(block.pageIndex) ?? []
    list.push(block)
    byPage.set(block.pageIndex, list)
  }

  const validatedById = new Map<string, ExtractedBlock>()
  const entries = [...byPage.entries()]
  for (let i = 0; i < entries.length; i++) {
    const [pageIndex, pageBlocks] = entries[i]
    const page = pageMap.get(pageIndex)
    if (!page) continue
    onProgress(`Validating bounding boxes… page ${i + 1} of ${entries.length}`)
    const res = await postJson<{ blocks: ExtractedBlock[] }>('/api/validate-bbox', {
      blocks: pageBlocks,
      pages: [page],
    })
    for (const block of res.blocks) validatedById.set(block.id, block)
  }

  return blocks.map((block) => validatedById.get(block.id) ?? block)
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
            summary={summary}
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

    const userToken = getStoredHfToken()
    if (!userToken || !userToken.trim()) {
      const msg =
        'Please enter your Hugging Face API Key in the top header (HF Key) before starting.'
      setError(msg)
      if (typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('gradesight:hf-key-error', {
            detail: { message: msg },
          }),
        )
        window.dispatchEvent(new CustomEvent('gradesight:open-hf-settings'))
      }
      return
    }

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
      const qRes = await extractDocument('question', qPages, setStatusMessage)
      assertExtractBlocks(qRes.blocks, 'question')
      if (qRes.via) {
        setStatusMessage(`Extracting answers… (questions via ${qRes.via})`)
      }
      const aRes = await extractDocument('answer', aPages, setStatusMessage)
      assertExtractBlocks(aRes.blocks, 'answer')
      if (aRes.via && aRes.via !== 'hf') {
        console.info(`[extract] answers via ${aRes.via}`)
      }

      setStage('validating')
      const qValBlocks = await validateBlocks(qRes.blocks, qPages, setStatusMessage)
      const aValBlocks = await validateBlocks(aRes.blocks, aPages, setStatusMessage)

      setStage('mapping')
      setStatusMessage('Matching answers to questions…')
    const mapRes = await postJson<{ pairs: MappedPair[] }>('/api/map-answers', {
        questions: qValBlocks,
        answers: aValBlocks,
      })
      let pairs = mapRes.pairs

      const repairPages = [...new Set(
        pairs
          .filter((p) => p.status === 'matched' && p.answer)
          .map((p) => p.answer!.pageIndex),
      )].sort((a, b) => a - b)

      for (let i = 0; i < repairPages.length; i++) {
        const pageIndex = repairPages[i]
        const page = aPages.find((p) => p.pageIndex === pageIndex)
        if (!page) continue
        setStatusMessage(`Repairing answer highlights… page ${i + 1} of ${repairPages.length}`)
        const repairRes = await postJson<{ pairs: MappedPair[] }>('/api/repair-map-bboxes', {
          pairs,
          pages: [page],
        })
        pairs = repairRes.pairs
      }
      const hasQuestions = mapRes.pairs.some((p) => p.question)
      const unmatchedOnly =
        !hasQuestions && mapRes.pairs.some((p) => p.status === 'unmatched_answer')
      if (unmatchedOnly) {
        throw new Error(
          'Answers were extracted but no questions could be matched. Upload the printed question paper in the left slot and the handwritten answer sheet on the right.',
        )
      }
      setPairs(pairs)

      setStage('grading')
      setStatusMessage('Grading matched answers with Groq…')
      const gradeRes = await postJson<{ summary: GradingSummary }>('/api/grade', {
        pairs,
      })
      setSummary(gradeRes.summary)
      setGrades(gradeRes.summary.grades)

      setStage('done')
      setStatusMessage('')
    } catch (err) {
      console.error(err)
      const message = err instanceof Error ? err.message : 'Pipeline failed'
      setError(message)
      if (isHfKeyError(message) && typeof window !== 'undefined') {
        window.dispatchEvent(
          new CustomEvent('gradesight:hf-key-error', {
            detail: { message },
          }),
        )
      }
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
          <button
            type="button"
            className="secondary btn-update-hf-key"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.dispatchEvent(new CustomEvent('gradesight:open-hf-settings'))
              }
            }}
          >
            <KeyRound size={15} />
            <span>Configure / Update HF Key</span>
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

  return (
    <main className="app-shell full-width">
      <div className="workspace">
        <Topbar onBack={back} showBack={stage !== 'upload'} />
        <div className="workspace-content">
          {workspace}
        </div>
      </div>
    </main>
  )
}
