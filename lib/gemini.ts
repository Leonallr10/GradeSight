import {
  GoogleGenerativeAI,
  SchemaType,
  type ResponseSchema,
} from '@google/generative-ai'
import { coerceBbox } from './bboxCheck'
import { inferMaxScore } from './normalizeLabel'
import { extractJsonPayload } from './parseExtract'
import type {
  BBox,
  ExtractedBlock,
  GradeResult,
  MappedPair,
  PageImage,
} from './types'

const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash'

function getGenAI() {
  const key = process.env.GEMINI_API_KEY
  if (!key) throw new Error('GEMINI_API_KEY is not set')
  return new GoogleGenerativeAI(key)
}

function stripDataUrl(imageBase64: string): { mime: string; data: string } {
  const match = imageBase64.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,(.+)$/)
  if (match) return { mime: match[1], data: match[2] }
  return { mime: 'image/png', data: imageBase64.replace(/^data:[^;]+;base64,/, '') }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 1200
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      const retryable = /503|429|500|high demand|unavailable|timeout|fetch/i.test(msg)
      console.error(`${opts.label ?? 'Gemini'} attempt ${i + 1}/${attempts} failed:`, msg)
      if (!retryable || i === attempts - 1) break
      await sleep(baseDelayMs * 2 ** i)
    }
  }
  throw lastErr
}

const gradeSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    score: { type: SchemaType.NUMBER },
    maxScore: { type: SchemaType.NUMBER },
    isCorrect: { type: SchemaType.BOOLEAN },
    feedback: { type: SchemaType.STRING },
  },
  required: ['score', 'maxScore', 'isCorrect', 'feedback'],
}

const bboxSchema: ResponseSchema = {
  type: SchemaType.OBJECT,
  properties: {
    x: { type: SchemaType.NUMBER },
    y: { type: SchemaType.NUMBER },
    w: { type: SchemaType.NUMBER },
    h: { type: SchemaType.NUMBER },
  },
  required: ['x', 'y', 'w', 'h'],
}

const EXTRACT_PROMPT = `You are extracting exam content from a page image (CBSE / board-style papers).

Rules:
1. Extract EVERY distinct question or answer as its own block.
2. Sub-parts are SEPARATE blocks: 19(a), 19(b), 20(b)(i), 20(b)(ii), 21(a)(i) each get their own entry.
3. labelNumber must preserve the FULL number: use "19(a)" not "9(a)", "20(b)(i)" not "b(i)".
4. Keep printed reading order (top→bottom, left→right).
5. bbox is [x, y, w, h] normalized 0–1, top-left origin, covering that block only.
6. Include mark allotment in the text when printed (e.g. [2], (3 marks)).

Return ONLY a JSON array (no markdown):
[{"text":"...","labelNumber":"19(a)","bbox":[0.08,0.22,0.84,0.12]}]`

/** Localize a single text span on a page — cheap bbox-only call. */
export async function localizeBboxWithGemini(
  page: PageImage,
  text: string,
): Promise<BBox | null> {
  const genAI = getGenAI()
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: bboxSchema,
      temperature: 0,
    },
  })

  const { mime, data } = stripDataUrl(page.imageBase64)
  const result = await withRetry(
    () =>
      model.generateContent([
        { inlineData: { mimeType: mime, data } },
        {
          text: `Find the region on this page that contains this exact text (or the closest handwritten/printed match). Return ONLY a bounding box {x,y,w,h} normalized 0–1 with top-left origin. Do not re-extract text.\n\nText:\n${text.slice(0, 800)}`,
        },
      ]),
    { label: 'bbox' },
  )

  const raw = result.response.text()
  const parsed = extractJsonPayload(raw)
  return coerceBbox(parsed)
}

export async function repairBlocksWithGemini(
  blocks: ExtractedBlock[],
  pages: PageImage[],
): Promise<ExtractedBlock[]> {
  const pageMap = new Map(pages.map((p) => [p.pageIndex, p]))
  const repaired: ExtractedBlock[] = []

  for (const block of blocks) {
    const page = pageMap.get(block.pageIndex)
    if (!page) {
      repaired.push(block)
      continue
    }
    try {
      const bbox = await localizeBboxWithGemini(page, block.text)
      if (bbox) {
        repaired.push({ ...block, bbox, bboxSource: 'gemini' })
      } else {
        repaired.push(block)
      }
      await sleep(200)
    } catch (err) {
      console.error('Gemini bbox repair failed:', err)
      repaired.push(block)
    }
  }

  return repaired
}

export async function embedTexts(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return []
  const genAI = getGenAI()
  const model = genAI.getGenerativeModel({ model: 'gemini-embedding-001' })

  const vectors: number[][] = []
  const BATCH = 16
  for (let i = 0; i < texts.length; i += BATCH) {
    const slice = texts.slice(i, i + BATCH)
    const results = await Promise.all(
      slice.map(async (text) => {
        const res = await withRetry(
          () => model.embedContent(text.slice(0, 2000)),
          { label: 'embed', attempts: 3 },
        )
        return res.embedding.values
      }),
    )
    vectors.push(...results)
  }
  return vectors
}

async function gradePairOnce(pair: MappedPair): Promise<GradeResult> {
  if (!pair.question || !pair.answer) {
    return {
      pairId: pair.id,
      score: 0,
      maxScore: 2,
      isCorrect: false,
      feedback: 'No answer mapped for this question.',
    }
  }

  const maxHint = inferMaxScore(pair.question.text, 2)
  const genAI = getGenAI()
  const prompt = `You are a strict but fair board-exam grader (CBSE-style).
Grade the student's answer against the question.
Suggested maxScore: ${maxHint} (use this unless the question clearly states otherwise).
Be concise in feedback (2-3 sentences).
Return JSON only with keys: score, maxScore, isCorrect, feedback.

Question [${pair.question.labelNumber ?? 'unlabeled'}]:
${pair.question.text}

Student answer [${pair.answer.labelNumber ?? 'unlabeled'}]:
${pair.answer.text}`

  // Prefer structured JSON; fall back to free JSON if schema/thinking fails
  let raw = ''
  try {
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: gradeSchema,
        temperature: 0.2,
      },
    })
    const result = await model.generateContent(prompt)
    raw = result.response.text()
  } catch {
    const model = genAI.getGenerativeModel({
      model: GEMINI_MODEL,
      generationConfig: {
        responseMimeType: 'application/json',
        temperature: 0.2,
      },
    })
    const result = await model.generateContent(prompt)
    raw = result.response.text()
  }

  const parsed = extractJsonPayload(raw) as {
    score?: number
    maxScore?: number
    isCorrect?: boolean
    feedback?: string
  } | null

  const maxScore = Number(parsed?.maxScore ?? maxHint)
  const score = Math.max(0, Math.min(maxScore, Number(parsed?.score ?? 0)))

  return {
    pairId: pair.id,
    score,
    maxScore,
    isCorrect: Boolean(parsed?.isCorrect),
    feedback: String(parsed?.feedback ?? 'Unable to grade.'),
  }
}

export async function gradePair(pair: MappedPair): Promise<GradeResult> {
  return withRetry(() => gradePairOnce(pair), {
    attempts: 4,
    baseDelayMs: 1500,
    label: `grade:${pair.id}`,
  })
}

export async function gradeAllPairs(pairs: MappedPair[]): Promise<{
  grades: GradeResult[]
  overallFeedback: string
}> {
  const matched = pairs.filter((p) => p.status === 'matched')
  const grades: GradeResult[] = []

  for (const pair of matched) {
    try {
      grades.push(await gradePair(pair))
    } catch (err) {
      console.error('Grade failed:', err)
      const maxScore = pair.question ? inferMaxScore(pair.question.text, 2) : 2
      grades.push({
        pairId: pair.id,
        score: 0,
        maxScore,
        isCorrect: false,
        feedback:
          'Grading temporarily unavailable (API rate limit). Re-run grading shortly.',
      })
    }
    // Pace requests to reduce 503 spikes
    await sleep(400)
  }

  for (const pair of pairs.filter((p) => p.status === 'unanswered')) {
    const maxScore = pair.question ? inferMaxScore(pair.question.text, 2) : 2
    grades.push({
      pairId: pair.id,
      score: 0,
      maxScore,
      isCorrect: false,
      feedback: 'This question appears to be unanswered in the uploaded sheet.',
    })
  }

  const answered = pairs.filter((p) => p.status === 'matched').length
  const unanswered = pairs.filter((p) => p.status === 'unanswered').length
  const unmatched = pairs.filter((p) => p.status === 'unmatched_answer').length
  const totalScore = grades.reduce((s, g) => s + g.score, 0)
  const maxScore = grades.reduce((s, g) => s + g.maxScore, 0)

  let overallFeedback = `Scored ${totalScore} / ${maxScore}. ${answered} answered, ${unanswered} unanswered`
  if (unmatched > 0) overallFeedback += `, ${unmatched} unmatched answer block(s)`
  overallFeedback += '.'

  try {
    const genAI = getGenAI()
    const model = genAI.getGenerativeModel({ model: GEMINI_MODEL })
    const summary = await withRetry(
      () =>
        model.generateContent(
          `Write one short paragraph (max 3 sentences) summarizing this exam performance for a teacher.\nTotal: ${totalScore}/${maxScore}. Answered: ${answered}. Unanswered: ${unanswered}. Unmatched answers: ${unmatched}.`,
        ),
      { label: 'summary', attempts: 2 },
    )
    const text = summary.response.text()?.trim()
    if (text) overallFeedback = text
  } catch {
    /* keep heuristic summary */
  }

  return { grades, overallFeedback }
}

/** Full document extract via Gemini (preferred for printed question papers). */
export async function extractPageWithGemini(
  page: PageImage,
  role: 'question' | 'answer',
  idPrefix: string,
): Promise<ExtractedBlock[]> {
  const genAI = getGenAI()
  const model = genAI.getGenerativeModel({
    model: GEMINI_MODEL,
    generationConfig: { temperature: 0.1 },
  })
  const { mime, data } = stripDataUrl(page.imageBase64)
  const roleHint =
    role === 'question'
      ? 'This is a printed QUESTION PAPER. Extract every question/sub-part. Never drop leading digits from numbers (19 not 9).'
      : 'This is a STUDENT ANSWER SHEET (often handwritten). Extract each answer block with its label if visible.'

  const result = await withRetry(
    () =>
      model.generateContent([
        { inlineData: { mimeType: mime, data } },
        { text: `${EXTRACT_PROMPT}\n\n${roleHint}\nPage index: ${page.pageIndex}` },
      ]),
    { label: `extract-${role}-p${page.pageIndex}`, attempts: 3 },
  )

  const { parseExtractedBlocks } = await import('./parseExtract')
  const blocks = parseExtractedBlocks(result.response.text(), page.pageIndex, idPrefix)
  return blocks.map((b) => ({
    ...b,
    bboxSource: b.bbox ? ('gemini' as const) : ('none' as const),
  }))
}
