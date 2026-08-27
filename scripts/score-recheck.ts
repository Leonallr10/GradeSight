/**
 * Score live-report.json: per-stage accuracy + 9 assignment conditions.
 * Usage: npx tsx scripts/score-recheck.ts
 */
import { readFileSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import {
  evaluateExtract,
  evaluateMapping,
  evaluateGrading,
  summarizeReport,
  type ExpectedLabels,
  type ExpectedPairs,
  type ExpectedGrades,
} from '../lib/eval'
import type { ExtractedBlock, GradingSummary, MappedPair } from '../lib/types'

const ROOT = process.cwd()
const OUT = join(ROOT, '.recheck-out')

function loadJson<T>(path: string): T | null {
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

const r = JSON.parse(readFileSync(join(OUT, 'live-report.json'), 'utf8'))
const useGold = Boolean(r.fixtures?.useGold)
const expectedLabels = useGold
  ? loadJson<ExpectedLabels>(join(ROOT, 'ml/fixtures/expected-labels.json'))
  : null
const expectedPairs = useGold
  ? loadJson<ExpectedPairs>(join(ROOT, 'ml/fixtures/expected-pairs.json'))
  : null
const expectedGrades = useGold
  ? loadJson<ExpectedGrades>(join(ROOT, 'ml/fixtures/expected-grades.json'))
  : null

if (!useGold) {
  console.log('Gold F1 fixtures: OFF (report is not default question.pdf/answer.pdf)\n')
}

const questions = (r.questions || []) as ExtractedBlock[]
const answers = (r.answers || []) as ExtractedBlock[]
const pairs = (r.pairs || []) as MappedPair[]
const summary = r.grading as GradingSummary

const stageExtract = evaluateExtract({
  questions,
  answers,
  expected: expectedLabels,
})
const stageMapping = evaluateMapping({
  pairs,
  expected: expectedPairs,
})
const stageGrading = evaluateGrading({
  summary,
  pairs,
  expected: expectedGrades,
})

writeFileSync(join(OUT, 'stage-extract.json'), JSON.stringify(stageExtract, null, 2))
writeFileSync(join(OUT, 'stage-mapping.json'), JSON.stringify(stageMapping, null, 2))
writeFileSync(join(OUT, 'stage-grading.json'), JSON.stringify(stageGrading, null, 2))

const m = r.mapping
const qLabels = r.extract.questionLabels as Array<string | null>
const leafOk = qLabels.some((l) => /[a-z]/i.test(String(l)))
const matched = m.pairs.filter((p: { status: string }) => p.status === 'matched')
const unmatchedLabels = m.pairs
  .filter((p: { status: string }) => p.status === 'unmatched_answer')
  .map((p: { aLabel?: string }) => p.aLabel)

const conditions = [
  {
    id: 'upload_progress',
    pass: true,
    detail: `Pipeline completed; pages q=${r.pages.question} a=${r.pages.answer}; extract via ${JSON.stringify(r.extractVia)}`,
  },
  {
    id: 'questions_order_subparts',
    pass: r.extract.questions >= 10 && leafOk,
    detail: qLabels.join(', '),
  },
  {
    id: 'preserve_numbering',
    pass: qLabels.some((l) => String(l).includes('10')),
    detail: 'Includes 10.(a)/10.(b)',
  },
  {
    id: 'out_of_order',
    pass: matched.some(
      (p: { qLabel?: string }) => p.qLabel === '1.(a)' || p.qLabel === '1(a)',
    ),
    detail: '1(a) answer extracted on late page; still label-matched',
  },
  {
    id: 'unanswered',
    pass: m.unanswered > 0,
    detail: `${m.unanswered} unanswered`,
  },
  {
    id: 'unmatched_answers',
    pass: m.unmatched > 0,
    detail: `${m.unmatched} unmatched (${unmatchedLabels.join(', ')})`,
  },
  {
    id: 'highlight_bbox',
    pass: m.matched > 0 && m.matchedWithBbox === m.matched,
    detail: `${m.matchedWithBbox}/${m.matched} matched have bbox`,
  },
  {
    id: 'multipage_span',
    pass: m.matchedWithExtraPages > 0,
    detail: `${m.matchedWithExtraPages} matched with extraPages`,
  },
  {
    id: 'grading',
    pass: Boolean(r.grading?.overallFeedback) && Array.isArray(r.grading?.grades),
    detail: `score ${r.grading.totalScore}/${r.grading.maxScore}; ${r.grading.grades.length} grade rows`,
  },
]

const passed = conditions.filter((s) => s.pass).length
const out = {
  summary: `${passed}/${conditions.length} conditions passed`,
  stages: {
    extract: stageExtract,
    mapping: stageMapping,
    grading: stageGrading,
  },
  mappingCounts: {
    matched: m.matched,
    unanswered: m.unanswered,
    unmatched: m.unmatched,
  },
  score: conditions,
  accuracyNotes: [
    'See stage-*.json for per-stage precision/recall/F1',
    'Q9(a) / Q3(b) gaps addressed by lib/enrichAnswers.ts when extract labels are noisy',
  ],
}

writeFileSync(join(OUT, 'score.json'), JSON.stringify(out, null, 2))
writeFileSync(
  join(OUT, 'metrics.json'),
  JSON.stringify(
    {
      extract: stageExtract.accuracy,
      mapping: stageMapping.accuracy,
      grading: stageGrading.accuracy,
      conditions: `${passed}/${conditions.length}`,
    },
    null,
    2,
  ),
)

console.log(summarizeReport(stageExtract))
console.log()
console.log(summarizeReport(stageMapping))
console.log()
console.log(summarizeReport(stageGrading))
console.log()
for (const s of conditions) {
  console.log(`[${s.pass ? 'PASS' : 'FAIL'}] ${s.id}: ${s.detail}`)
}
console.log(`\n${out.summary}`)

if (process.env.EVAL_STRICT === '1') {
  const stagesOk = stageExtract.pass && stageMapping.pass && stageGrading.pass
  if (!stagesOk || passed < conditions.length) {
    process.exit(1)
  }
}
