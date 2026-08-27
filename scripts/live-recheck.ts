/**
 * Live pipeline recheck: question.pdf + answer.pdf → extract → eval → map → eval → grade → eval
 * Extract uses Next.js /api/extract (local Qwen if LOCAL_EXTRACT_URL set, else HF Scout).
 * Run while `npm run dev` is up: npx tsx scripts/live-recheck.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { createCanvas } from '@napi-rs/canvas'
import { pathToFileURL } from 'url'
import {
  evaluateExtract,
  evaluateMapping,
  evaluateGrading,
  summarizeReport,
  type ExpectedLabels,
  type ExpectedPairs,
  type ExpectedGrades,
} from '../lib/eval'
import type { ExtractedBlock, GradingSummary, MappedPair, PageImage } from '../lib/types'

const BASE = process.env.RECHECK_BASE || 'http://localhost:3000'
const ROOT = process.cwd()
const OUT_DIR = join(ROOT, '.recheck-out')
const MAX_PAGES = 20
const RENDER_SCALE = 1.5

function loadEnvFile(name: string) {
  const p = join(ROOT, name)
  if (!existsSync(p)) return
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i < 0) continue
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim()
    if (!process.env[k]) process.env[k] = v
  }
}

loadEnvFile('.env.local')
loadEnvFile('.env')

function loadJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

const expectedLabels = loadJson<ExpectedLabels>(join(ROOT, 'ml/fixtures/expected-labels.json'))
const expectedPairs = loadJson<ExpectedPairs>(join(ROOT, 'ml/fixtures/expected-pairs.json'))
const expectedGrades = loadJson<ExpectedGrades>(join(ROOT, 'ml/fixtures/expected-grades.json'))

async function getPdfjs() {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs')
  const workerPath = join(
    ROOT,
    'node_modules/pdfjs-dist/legacy/build/pdf.worker.min.mjs',
  )
  pdfjs.GlobalWorkerOptions.workerSrc = pathToFileURL(workerPath).href
  return pdfjs
}

async function rasterizePdf(filePath: string): Promise<PageImage[]> {
  const pdfjs = await getPdfjs()
  const data = new Uint8Array(readFileSync(filePath))
  const doc = await pdfjs.getDocument({ data }).promise
  const pageCount = Math.min(doc.numPages, MAX_PAGES)
  const pages: PageImage[] = []

  for (let i = 1; i <= pageCount; i++) {
    const page = await doc.getPage(i)
    const viewport = page.getViewport({ scale: RENDER_SCALE })
    const canvas = createCanvas(Math.ceil(viewport.width), Math.ceil(viewport.height))
    const ctx = canvas.getContext('2d')
    await page.render({
      canvasContext: ctx as unknown as CanvasRenderingContext2D,
      viewport,
      canvas: canvas as unknown as HTMLCanvasElement,
    }).promise
    const buf = canvas.toBuffer('image/png')
    pages.push({
      pageIndex: i - 1,
      imageBase64: `data:image/png;base64,${buf.toString('base64')}`,
      mimeType: 'image/png',
    })
    console.log(`  rasterized page ${i}/${pageCount} (${Math.round(buf.length / 1024)} KB)`)
  }
  return pages
}

async function postJson<T>(url: string, body: unknown, timeoutMs = 600_000): Promise<T> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    })
    const data = await res.json()
    if (!res.ok) {
      throw new Error(`${url} → ${res.status}: ${data?.error || JSON.stringify(data).slice(0, 500)}`)
    }
    return data as T
  } finally {
    clearTimeout(t)
  }
}

async function extractBlocks(
  role: 'question' | 'answer',
  pages: PageImage[],
): Promise<{ blocks: ExtractedBlock[]; via: string }> {
  const cachePath = join(OUT_DIR, `extract-${role}.json`)
  if (existsSync(cachePath) && process.env.RECHECK_USE_CACHE === '1') {
    console.log(`  using cache ${cachePath}`)
    return { blocks: JSON.parse(readFileSync(cachePath, 'utf8')), via: 'cache' }
  }

  const res = await postJson<{ blocks: ExtractedBlock[]; via?: string }>(`${BASE}/api/extract`, {
    role,
    pages,
  })
  writeFileSync(cachePath, JSON.stringify(res.blocks, null, 2))
  return { blocks: res.blocks, via: res.via || 'api' }
}

function summarizeBlocks(blocks: ExtractedBlock[], label: string) {
  console.log(`\n=== ${label}: ${blocks.length} blocks ===`)
  for (const b of blocks.slice(0, 50)) {
    const ln = b.labelNumber || b.labelWritten || '-'
    const text = String(b.text || '').replace(/\s+/g, ' ').slice(0, 80)
    const bbox = b.bbox ? 'bbox' : 'no-bbox'
    const extra = b.extraPages?.length ? ` extraPages=${b.extraPages.length}` : ''
    console.log(`  [${ln}] p${b.pageIndex} ${bbox}${extra} ${text}`)
  }
}

function maybeStrict(stagePass: boolean, name: string) {
  if (process.env.EVAL_STRICT === '1' && !stagePass) {
    throw new Error(`EVAL_STRICT: ${name} stage failed`)
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const qPath = join(ROOT, 'question.pdf')
  const aPath = join(ROOT, 'answer.pdf')

  console.log('1) Rasterizing question.pdf…')
  const qPages = await rasterizePdf(qPath)
  console.log('2) Rasterizing answer.pdf…')
  const aPages = await rasterizePdf(aPath)
  writeFileSync(
    join(OUT_DIR, 'pages-meta.json'),
    JSON.stringify({ questionPages: qPages.length, answerPages: aPages.length }, null, 2),
  )

  console.log('3) Extracting questions…')
  const qExt = await extractBlocks('question', qPages)
  summarizeBlocks(qExt.blocks, `Questions via ${qExt.via}`)

  console.log('4) Extracting answers…')
  const aExt = await extractBlocks('answer', aPages)
  summarizeBlocks(aExt.blocks, `Answers via ${aExt.via}`)

  console.log('5) Validating bboxes…')
  const qVal = await postJson<{ blocks: ExtractedBlock[] }>(`${BASE}/api/validate-bbox`, {
    blocks: qExt.blocks,
    pages: qPages,
  })
  const aVal = await postJson<{ blocks: ExtractedBlock[] }>(`${BASE}/api/validate-bbox`, {
    blocks: aExt.blocks,
    pages: aPages,
  })

  const stageExtract = evaluateExtract({
    questions: qVal.blocks,
    answers: aVal.blocks,
    expected: expectedLabels,
  })
  writeFileSync(join(OUT_DIR, 'stage-extract.json'), JSON.stringify(stageExtract, null, 2))
  console.log('\n' + summarizeReport(stageExtract))
  maybeStrict(stageExtract.pass, 'extract')

  console.log('6) Mapping…')
  const mapRes = await postJson<{ pairs: MappedPair[] }>(`${BASE}/api/map-answers`, {
    questions: qVal.blocks,
    answers: aVal.blocks,
  })
  const pairs = mapRes.pairs
  const matched = pairs.filter((p) => p.status === 'matched')
  const unanswered = pairs.filter((p) => p.status === 'unanswered')
  const unmatched = pairs.filter((p) => p.status === 'unmatched_answer')
  console.log(
    `\n=== Pairs: ${pairs.length} (matched=${matched.length}, unanswered=${unanswered.length}, unmatched=${unmatched.length}) ===`,
  )
  for (const p of pairs) {
    console.log(
      `  ${p.status} q=${p.question?.labelNumber ?? '-'} a=${p.answer?.labelNumber ?? '-'} ${p.answer?.bbox ? 'has-bbox' : 'no-bbox'}${p.answer?.extraPages?.length ? ` extra=${p.answer.extraPages.length}` : ''}`,
    )
  }

  const stageMapping = evaluateMapping({ pairs, expected: expectedPairs })
  writeFileSync(join(OUT_DIR, 'stage-mapping.json'), JSON.stringify(stageMapping, null, 2))
  console.log('\n' + summarizeReport(stageMapping))
  maybeStrict(stageMapping.pass, 'mapping')

  console.log('7) Grading…')
  const gradeRes = await postJson<{ summary: GradingSummary }>(`${BASE}/api/grade`, {
    pairs,
  })
  console.log('\n=== Grade summary ===')
  console.log(JSON.stringify(gradeRes.summary, null, 2).slice(0, 4000))

  const stageGrading = evaluateGrading({
    summary: gradeRes.summary,
    pairs,
    expected: expectedGrades,
  })
  writeFileSync(join(OUT_DIR, 'stage-grading.json'), JSON.stringify(stageGrading, null, 2))
  console.log('\n' + summarizeReport(stageGrading))
  maybeStrict(stageGrading.pass, 'grading')

  const report = {
    timestamp: new Date().toISOString(),
    extractVia: { questions: qExt.via, answers: aExt.via },
    pages: { question: qPages.length, answer: aPages.length },
    extract: {
      questions: qExt.blocks.length,
      answers: aExt.blocks.length,
      questionLabels: qExt.blocks.map((b) => b.labelNumber || b.labelWritten || null),
      answerLabels: aExt.blocks.map((b) => b.labelNumber || b.labelWritten || null),
    },
    validated: {
      questionBboxes: qVal.blocks.filter((b) => b.bbox).length,
      answerBboxes: aVal.blocks.filter((b) => b.bbox).length,
      questions: qVal.blocks.length,
      answers: aVal.blocks.length,
    },
    mapping: {
      total: pairs.length,
      matched: matched.length,
      unanswered: unanswered.length,
      unmatched: unmatched.length,
      matchedWithBbox: matched.filter((p) => p.answer?.bbox).length,
      matchedWithExtraPages: matched.filter(
        (p) => (p.answer?.extraPages?.length ?? 0) > 0,
      ).length,
      pairs: pairs.map((p) => ({
        status: p.status,
        qLabel: p.question?.labelNumber,
        aLabel: p.answer?.labelNumber,
        hasBbox: Boolean(p.answer?.bbox),
        extraPages: p.answer?.extraPages?.length ?? 0,
        similarity: p.similarity,
      })),
    },
    stages: {
      extract: stageExtract,
      mapping: stageMapping,
      grading: stageGrading,
    },
    grading: gradeRes.summary,
    questions: qVal.blocks,
    answers: aVal.blocks,
    pairs,
  }

  writeFileSync(join(OUT_DIR, 'live-report.json'), JSON.stringify(report, null, 2))
  console.log(`\nWrote ${join(OUT_DIR, 'live-report.json')}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
