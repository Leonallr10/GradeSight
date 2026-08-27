/**
 * Live pipeline recheck: question.pdf + answer.pdf → extract → validate → map → grade
 * Falls back to Gemini vision extract if HF Inference credits are depleted.
 * Run while `npm run dev` is up: npx tsx scripts/live-recheck.ts
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { createCanvas } from '@napi-rs/canvas'
import { pathToFileURL } from 'url'
import { parseExtractedBlocks } from '../lib/parseExtract'
import type { ExtractedBlock, PageImage } from '../lib/types'

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

const EXTRACT_PROMPT = `You extract ONLY gradeable exam items from a page image.

Read ONLY what appears on this page. Do not invent content.

INCLUDE leaf questions/sub-parts and answer blocks with labels.
EXCLUDE titles, instructions, banners, page numbers.

For answers: one JSON object per question label covering the FULL answer.
Set labelWritten when a Q# is visible. bbox: [x,y,w,h] normalized 0-1.

Return ONLY a JSON array:
[{"text":"...","labelWritten":"Q1","labelNumber":"1","bbox":[x,y,w,h],"contentKind":"text","isStrikethrough":false}]
`

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

function stripDataUrl(imageBase64: string): { mime: string; data: string } {
  const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (match) return { mime: match[1], data: match[2] }
  return { mime: 'image/png', data: imageBase64.replace(/^data:[^;]+;base64,/, '') }
}

async function extractViaGemini(
  pages: PageImage[],
  role: 'question' | 'answer',
): Promise<ExtractedBlock[]> {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY not set for extract fallback')
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash-lite'
  const prefix = role === 'question' ? 'q' : 'a'
  const roleHint =
    role === 'question'
      ? 'Document role: QUESTION PAPER. Extract every answerable question / sub-part.'
      : 'Document role: ANSWER SHEET. Extract each labelled answer as one block; preserve labels; read handwriting carefully.'

  const all: ExtractedBlock[] = []
  for (const page of pages) {
    const { mime, data } = stripDataUrl(page.imageBase64)
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`
    console.log(`  Gemini extract ${role} page ${page.pageIndex + 1}/${pages.length}…`)
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: `${EXTRACT_PROMPT}\n\n${roleHint}\nPage index: ${page.pageIndex}` },
              { inline_data: { mime_type: mime, data } },
            ],
          },
        ],
        generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
      }),
    })
    const json = await res.json()
    if (!res.ok) {
      throw new Error(`Gemini ${res.status}: ${JSON.stringify(json).slice(0, 400)}`)
    }
    const text =
      json?.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text || '').join('') ||
      ''
    const blocks = parseExtractedBlocks(text, page.pageIndex, prefix)
    all.push(...blocks)
  }
  return all
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

  try {
    const res = await postJson<{ blocks: ExtractedBlock[] }>(`${BASE}/api/extract`, {
      role,
      pages,
    })
    writeFileSync(cachePath, JSON.stringify(res.blocks, null, 2))
    return { blocks: res.blocks, via: 'hf-api' }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.warn(`  HF extract failed (${msg.slice(0, 160)}). Falling back to Gemini…`)
    const blocks = await extractViaGemini(pages, role)
    writeFileSync(cachePath, JSON.stringify(blocks, null, 2))
    return { blocks, via: 'gemini-fallback' }
  }
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

  console.log('6) Mapping…')
  const mapRes = await postJson<{ pairs: Array<Record<string, unknown>> }>(
    `${BASE}/api/map-answers`,
    { questions: qVal.blocks, answers: aVal.blocks },
  )
  const pairs = mapRes.pairs
  const matched = pairs.filter((p) => p.status === 'matched')
  const unanswered = pairs.filter((p) => p.status === 'unanswered')
  const unmatched = pairs.filter((p) => p.status === 'unmatched_answer')
  console.log(
    `\n=== Pairs: ${pairs.length} (matched=${matched.length}, unanswered=${unanswered.length}, unmatched=${unmatched.length}) ===`,
  )
  for (const p of pairs) {
    const q = p.question as ExtractedBlock | null
    const a = p.answer as ExtractedBlock | null
    console.log(
      `  ${p.status} q=${q?.labelNumber ?? '-'} a=${a?.labelNumber ?? '-'} ${a?.bbox ? 'has-bbox' : 'no-bbox'}${a?.extraPages?.length ? ` extra=${a.extraPages.length}` : ''}`,
    )
  }

  console.log('7) Grading…')
  const gradeRes = await postJson<{ summary: Record<string, unknown> }>(`${BASE}/api/grade`, {
    pairs,
  })
  console.log('\n=== Grade summary ===')
  console.log(JSON.stringify(gradeRes.summary, null, 2).slice(0, 4000))

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
      matchedWithBbox: matched.filter((p) => (p.answer as ExtractedBlock | null)?.bbox).length,
      matchedWithExtraPages: matched.filter(
        (p) => ((p.answer as ExtractedBlock | null)?.extraPages?.length ?? 0) > 0,
      ).length,
      pairs: pairs.map((p) => ({
        status: p.status,
        qLabel: (p.question as ExtractedBlock | null)?.labelNumber,
        aLabel: (p.answer as ExtractedBlock | null)?.labelNumber,
        hasBbox: Boolean((p.answer as ExtractedBlock | null)?.bbox),
        extraPages: (p.answer as ExtractedBlock | null)?.extraPages?.length ?? 0,
        similarity: p.similarity,
      })),
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
