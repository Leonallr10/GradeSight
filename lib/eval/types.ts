import type { ExtractedBlock, GradeResult, GradingSummary, MappedPair } from '../types'

export type EvalCheck = {
  id: string
  pass: boolean
  detail: string
}

export type StageEvalReport = {
  stage: 'extract' | 'mapping' | 'grading'
  pass: boolean
  checks: EvalCheck[]
  accuracy: Record<string, number | boolean | null>
  summary: string
}

export function pct(num: number, den: number): number {
  if (den <= 0) return den === 0 && num === 0 ? 1 : 0
  return num / den
}

export function round4(n: number): number {
  return Math.round(n * 10000) / 10000
}

/** Normalize labels the same way matching does (digits + letters only). */
export function normLabel(raw?: string | null): string | null {
  if (!raw) return null
  const cleaned = raw
    .toLowerCase()
    .replace(/^q(uestion)?\.?\s*/i, '')
    .replace(/[^a-z0-9]/g, '')
  return cleaned.length > 0 ? cleaned : null
}

export function labelSet(blocks: ExtractedBlock[]): Set<string> {
  const s = new Set<string>()
  for (const b of blocks) {
    const n = normLabel(b.labelNumber || b.labelWritten)
    if (n) s.add(n)
  }
  return s
}

export function prf(pred: Set<string>, gold: Set<string>) {
  if (pred.size === 0 && gold.size === 0) {
    return { precision: 1, recall: 1, f1: 1 }
  }
  let inter = 0
  for (const x of pred) if (gold.has(x)) inter += 1
  const precision = pred.size ? inter / pred.size : 0
  const recall = gold.size ? inter / gold.size : 0
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0
  return { precision, recall, f1 }
}

export function displayLabel(raw: string): string {
  // "1a" → keep normalized form for comparisons
  return normLabel(raw) || raw
}

export type ExpectedLabels = {
  questions: string[]
  answers: string[]
}

export type ExpectedPairs = {
  should_match: Array<{ q: string; a: string }>
  should_unanswered?: string[]
  out_of_order_q?: string
  expect_multipage?: boolean
}

export type ExpectedGrades = {
  grades: Array<{ q: string; score: number; maxScore: number }>
}

export function pairKey(q: string, a: string): string {
  return `${normLabel(q)}::${normLabel(a)}`
}

export function summarizeReport(report: StageEvalReport): string {
  const lines = [
    `=== Stage: ${report.stage.toUpperCase()} (${report.pass ? 'PASS' : 'FAIL'}) ===`,
    report.summary,
  ]
  for (const [k, v] of Object.entries(report.accuracy)) {
    if (typeof v === 'number') lines.push(`  ${k}: ${(v * 100).toFixed(1)}%`)
    else if (typeof v === 'boolean') lines.push(`  ${k}: ${v ? 'yes' : 'no'}`)
    else lines.push(`  ${k}: ${v}`)
  }
  for (const c of report.checks) {
    lines.push(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.id}: ${c.detail}`)
  }
  return lines.join('\n')
}

export type { ExtractedBlock, GradeResult, GradingSummary, MappedPair }
