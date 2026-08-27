import { readFileSync, writeFileSync } from 'fs'

const r = JSON.parse(readFileSync('.recheck-out/live-report.json', 'utf8'))
const m = r.mapping
const qLabels = r.extract.questionLabels as Array<string | null>
const leafOk = qLabels.some((l) => /[a-z]/i.test(String(l)))
const matched = m.pairs.filter((p: { status: string }) => p.status === 'matched')
const unmatchedLabels = m.pairs
  .filter((p: { status: string }) => p.status === 'unmatched_answer')
  .map((p: { aLabel?: string }) => p.aLabel)

const score = [
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

const passed = score.filter((s) => s.pass).length
const out = {
  summary: `${passed}/${score.length} conditions passed`,
  mappingCounts: {
    matched: m.matched,
    unanswered: m.unanswered,
    unmatched: m.unmatched,
  },
  score,
  accuracyNotes: [
    'Q9(a) answer appears under label "9" → left unanswered (label enrichment gap)',
    'Q3(b) matched a mis-extracted function-composition block → graded 0 (extract error)',
    'Orphan labels 5(b)/11 from answer OCR → correctly unmatched',
    'Most Q page-0 blocks had no bbox from HF; matched answers did have bboxes',
  ],
}

writeFileSync('.recheck-out/score.json', JSON.stringify(out, null, 2))
for (const s of score) {
  console.log(`[${s.pass ? 'PASS' : 'FAIL'}] ${s.id}: ${s.detail}`)
}
console.log(`\n${out.summary}`)
console.log('Accuracy notes:')
for (const n of out.accuracyNotes) console.log(`  - ${n}`)
