/**
 * Offline extraction accuracy when HF answer re-extract is unavailable.
 * Uses cached question extract + last live-report answers, re-applies enrich fixes.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { evaluateExtract, summarizeReport } from '../lib/eval'
import { enrichAnswerLabels } from '../lib/enrichAnswers'
import { normalizeLabel } from '../lib/normalizeLabel'
import type { ExtractedBlock } from '../lib/types'

const OUT = join(process.cwd(), '.recheck-out')
const qPath = join(OUT, 'extract-QUESTION_PAPER.pdf__verna-ai-answer.pdf-question.json')
const livePath = join(OUT, 'live-report.json')

const questions = JSON.parse(readFileSync(qPath, 'utf8')) as ExtractedBlock[]
const live = JSON.parse(readFileSync(livePath, 'utf8'))
const rawAnswers = live.answers as ExtractedBlock[]

const fixedAnswers = enrichAnswerLabels(rawAnswers, questions)
const report = evaluateExtract({ questions, answers: fixedAnswers })

writeFileSync(join(OUT, 'stage-extract-offline.json'), JSON.stringify(report, null, 2))

const qLabels = questions.map((b) => b.labelNumber || b.labelWritten)
const aLabels = fixedAnswers.map((b) => b.labelNumber || b.labelWritten)
const expectedAnswerLabels = [
  '1', '8', '2', '9', '3(a)', '3(b)', '4', '10', '5(a)', '5(b)', '6', '7(a)', '7(b)',
]
const missing = expectedAnswerLabels.filter(
  (l) => !aLabels.some((a) => normalizeLabel(a) === normalizeLabel(l)),
)
const labelCounts = new Map<string, number>()
for (const l of aLabels) {
  const n = normalizeLabel(l) || '?'
  labelCounts.set(n, (labelCounts.get(n) || 0) + 1)
}
const dupes = [...labelCounts.entries()].filter(([, c]) => c > 1).map(([l]) => l)

console.log('=== EXTRACTION ACCURACY ===')
console.log('Fixtures: test/QUESTION_PAPER.pdf + test/verna-ai-answer.pdf')
console.log(
  'Mode: offline (HF answer re-extract blocked — 402 credits; using cached answers + latest enrich)',
)
console.log('')
console.log(summarizeReport(report))
console.log('')
console.log('--- Block counts ---')
console.log(`  Questions: ${questions.length}`)
console.log(`  Answers:   ${fixedAnswers.length} (expected 13)`)
console.log('')
console.log('--- Question labels ---')
console.log(`  ${qLabels.join(', ')}`)
console.log('')
console.log('--- Answer labels ---')
console.log(`  ${aLabels.join(', ')}`)
console.log('')
console.log('--- Label coverage vs question paper ---')
console.log(`  Missing: ${missing.length ? missing.join(', ') : 'none'}`)
console.log(`  Duplicates: ${dupes.length ? dupes.join(', ') : 'none'}`)
console.log('')
console.log('--- Metrics ---')
console.log(`  answer_bbox_coverage:  ${((report.accuracy.answer_bbox_coverage as number) * 100).toFixed(1)}%`)
console.log(`  question_bbox_coverage: ${((report.accuracy.question_bbox_coverage as number) * 100).toFixed(1)}%`)
console.log(`  structural PASS:       ${report.pass ? 'YES' : 'NO'}`)
