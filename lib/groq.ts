import { blockContentForModel } from './blockContent'
import { extractJsonPayload } from './parseExtract'
import { inferMaxScore } from './normalizeLabel'
import type { GradeResult, MappedPair } from './types'

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions'

/** Models available on current Groq free/org catalogs; override with GROQ_MODEL. */
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b'

function getGroqKey() {
  const key = process.env.GROQ_API_KEY
  if (!key) throw new Error('GROQ_API_KEY is not set')
  return key
}

function getGroqModel() {
  return process.env.GROQ_MODEL || DEFAULT_GROQ_MODEL
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function isRetryable(msg: string) {
  return /503|429|500|high demand|unavailable|timeout|rate|over capacity/i.test(msg)
}

async function withRetry<T>(
  fn: () => Promise<T>,
  opts: { attempts?: number; baseDelayMs?: number; label?: string } = {},
): Promise<T> {
  const attempts = opts.attempts ?? 3
  const baseDelayMs = opts.baseDelayMs ?? 1500
  let lastErr: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (err) {
      lastErr = err
      const msg = err instanceof Error ? err.message : String(err)
      console.error(`${opts.label ?? 'Groq'} attempt ${i + 1}/${attempts} failed:`, msg)
      if (!isRetryable(msg) || i === attempts - 1) break
      await sleep(baseDelayMs * 2 ** i)
    }
  }
  throw lastErr
}

async function groqChat(prompt: string, jsonMode = true): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${getGroqKey()}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: getGroqModel(),
      temperature: 0.2,
      max_tokens: 4096,
      ...(jsonMode ? { response_format: { type: 'json_object' } } : {}),
      messages: [
        {
          role: 'system',
          content:
            'You are a strict but fair board-exam grader. Reply with valid JSON only.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  })

  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const detail =
      typeof data?.error?.message === 'string'
        ? data.error.message
        : JSON.stringify(data)
    throw new Error(`Groq ${res.status}: ${detail}`)
  }

  const content = data?.choices?.[0]?.message?.content
  if (typeof content !== 'string' || !content.trim()) {
    throw new Error('Groq returned empty content')
  }
  return content
}

function unansweredGrade(pair: MappedPair): GradeResult {
  const maxScore = pair.question ? inferMaxScore(pair.question.text, 2) : 2
  return {
    pairId: pair.id,
    score: 0,
    maxScore,
    isCorrect: false,
    feedback: 'This question appears to be unanswered in the uploaded sheet.',
  }
}

function failedGrade(pair: MappedPair, reason: string): GradeResult {
  const maxScore = pair.question ? inferMaxScore(pair.question.text, 2) : 2
  return {
    pairId: pair.id,
    score: 0,
    maxScore,
    isCorrect: false,
    feedback: reason,
  }
}

type BatchGradeItem = {
  pairId?: string
  score?: number
  maxScore?: number
  isCorrect?: boolean
  feedback?: string
}

function normalizeBatchGrade(item: BatchGradeItem, pair: MappedPair): GradeResult {
  const maxHint = pair.question ? inferMaxScore(pair.question.text, 2) : 2
  const maxScore = Number(item.maxScore ?? maxHint)
  const score = Math.max(0, Math.min(maxScore, Number(item.score ?? 0)))
  return {
    pairId: pair.id,
    score,
    maxScore: Number.isFinite(maxScore) ? maxScore : maxHint,
    isCorrect: Boolean(item.isCorrect),
    feedback: String(item.feedback ?? 'Unable to grade.'),
  }
}

/** Grade all matched pairs in one Groq call (avoids per-question rate/model chatter). */
async function gradeMatchedBatch(matched: MappedPair[]): Promise<{
  grades: GradeResult[]
  overallFeedback?: string
}> {
  const payload = matched.map((pair) => ({
    pairId: pair.id,
    label: pair.question?.labelNumber ?? 'unlabeled',
    maxHint: pair.question ? inferMaxScore(pair.question.text, 2) : 2,
    contentKind: pair.answer?.contentKind ?? pair.question?.contentKind ?? 'text',
    question: blockContentForModel(pair.question),
    answer: blockContentForModel(pair.answer),
    questionMath: pair.question?.mathLatex ?? null,
    answerMath: pair.answer?.mathLatex ?? null,
    questionDiagram: pair.question?.diagramDescription ?? null,
    answerDiagram: pair.answer?.diagramDescription ?? null,
  }))

  const prompt = `Grade each student's answer against its paired question (school / board exam).
Use only the provided fields — do not invent missing content.
Special rules for STEM:
- Formulas / mathLatex: accept equivalent forms (algebraically or chemically equivalent), not only identical strings.
- Derivatives / integrals: check the final result and key intermediate steps when present.
- Diagrams / diagramDescription: score whether the described figure matches what the question asks (labels, relationships, shape). Do not require pixel-perfect drawing text.
Use maxHint as maxScore unless the question clearly states another mark value.
Be concise in feedback (2-3 sentences each). Mention formula/diagram issues explicitly when relevant.

Return JSON exactly shaped as:
{"grades":[{"pairId":"...","score":0,"maxScore":2,"isCorrect":false,"feedback":"..."}],"overallFeedback":"one short teacher summary paragraph"}

Pairs JSON:
${JSON.stringify(payload)}`

  const raw = await withRetry(() => groqChat(prompt, true), {
    attempts: 3,
    baseDelayMs: 2000,
    label: 'groq-grade-batch',
  })

  const parsed = extractJsonPayload(raw) as {
    grades?: BatchGradeItem[]
    overallFeedback?: string
  } | null

  const byId = new Map(
    (parsed?.grades ?? [])
      .filter((g) => typeof g?.pairId === 'string')
      .map((g) => [g.pairId as string, g]),
  )

  const grades = matched.map((pair) => {
    const item = byId.get(pair.id)
    if (!item) {
      return failedGrade(
        pair,
        'Grader did not return a result for this question. Try re-running grading.',
      )
    }
    return normalizeBatchGrade(item, pair)
  })

  return {
    grades,
    overallFeedback: parsed?.overallFeedback?.trim() || undefined,
  }
}

export async function gradeAllPairs(pairs: MappedPair[]): Promise<{
  grades: GradeResult[]
  overallFeedback: string
}> {
  const matched = pairs.filter((p) => p.status === 'matched')
  const unanswered = pairs.filter((p) => p.status === 'unanswered')
  const unmatched = pairs.filter((p) => p.status === 'unmatched_answer').length

  let grades: GradeResult[] = []
  let overallFromModel: string | undefined

  if (matched.length > 0) {
    try {
      const batch = await gradeMatchedBatch(matched)
      grades = batch.grades
      overallFromModel = batch.overallFeedback
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      console.error('Groq batch grade failed:', msg)
      const hint = /404|does not exist|do not have access/i.test(msg)
        ? `Grading failed: Groq model unavailable (${getGroqModel()}). Set GROQ_MODEL to a model your key can access (e.g. openai/gpt-oss-20b).`
        : /429|rate/i.test(msg)
          ? 'Grading temporarily unavailable (Groq rate limit). Re-run shortly.'
          : `Grading failed (${msg.slice(0, 160)}). Check GROQ_API_KEY / GROQ_MODEL and re-run.`
      grades = matched.map((pair) => failedGrade(pair, hint))
    }
  }

  for (const pair of unanswered) {
    grades.push(unansweredGrade(pair))
  }

  const answered = matched.length
  const unansweredCount = unanswered.length
  const totalScore = grades.reduce((s, g) => s + g.score, 0)
  const maxScore = grades.reduce((s, g) => s + g.maxScore, 0)

  let overallFeedback =
    overallFromModel ||
    `Scored ${totalScore} / ${maxScore}. ${answered} answered, ${unansweredCount} unanswered`
  if (!overallFromModel) {
    if (unmatched > 0) overallFeedback += `, ${unmatched} unmatched answer block(s)`
    overallFeedback += '.'
  }

  return { grades, overallFeedback }
}
