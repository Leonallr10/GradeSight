/**
 * Assignment edge-case suite + unit accuracy gates.
 * Run: npm run selfcheck
 */
import { coerceBbox, isValidBbox, partitionByBbox } from './bboxCheck'
import { enrichAnswerLabels } from './enrichAnswers'
import { evaluateExtract, evaluateGrading, evaluateMapping } from './eval'
import { normalizeLabel } from './normalizeLabel'
import { cosineSimilarity } from './cosine'
import { dedupeAnswerBlocks } from './groupAnswers'
import { mapAnswersToQuestions } from './matching'
import { inferLabelFromText } from './parseExtract'
import type { ExtractedBlock, GradingSummary, MappedPair } from './types'

let passed = 0
let failed = 0
const results: Array<{ id: string; ok: boolean; detail: string }> = []

function check(id: string, cond: unknown, detail: string) {
  if (cond) {
    passed += 1
    results.push({ id, ok: true, detail })
    console.log(`[PASS] ${id}: ${detail}`)
  } else {
    failed += 1
    results.push({ id, ok: false, detail })
    console.error(`[FAIL] ${id}: ${detail}`)
  }
}

function block(
  partial: Partial<ExtractedBlock> & Pick<ExtractedBlock, 'id' | 'text'>,
): ExtractedBlock {
  return {
    pageIndex: 0,
    bboxSource: 'qwen',
    ...partial,
  }
}

async function main() {
  // --- basics ---
  check('label_11a', normalizeLabel('11 (a)') === '11a', '11 (a) → 11a')
  check('label_Q11A', normalizeLabel('Q.11-A') === '11a', 'Q.11-A → 11a')
  check('label_20bi', normalizeLabel('20(b)(i)') === '20bi', '20(b)(i) → 20bi')
  check('label_empty', normalizeLabel('  ') === null, 'blank → null')
  check(
    'infer_19a',
    inferLabelFromText('19. (a) What are such sequences') === '19(a)',
    'infer 19(a)',
  )
  check(
    'infer_20bii',
    inferLabelFromText('20 (b) (ii) Name the two types') === '20(b)(ii)',
    'infer 20(b)(ii)',
  )

  check('bbox_valid', isValidBbox({ x: 0.1, y: 0.2, w: 0.5, h: 0.1 }), 'valid box')
  check('bbox_neg_w', !isValidBbox({ x: 0.1, y: 0.2, w: -0.1, h: 0.1 }), 'reject negative w')
  check('bbox_gt1', !isValidBbox({ x: 0.1, y: 0.2, w: 1.5, h: 0.1 }), 'reject w>1')
  check(
    'bbox_xyxy',
    coerceBbox([0.1, 0.2, 0.6, 0.4])?.w.toFixed(2) === '0.50',
    'xyxy coerce',
  )

  const { valid, invalid } = partitionByBbox([
    block({ id: '1', text: 'ok', bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }),
    block({ id: '2', text: 'bad', bbox: { x: -1, y: 0, w: 2, h: 2 } }),
  ])
  check('bbox_partition', valid.length === 1 && invalid.length === 1, 'partition valid/invalid')

  check(
    'cosine_identical',
    Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9,
    'identical vectors',
  )
  check(
    'cosine_orthogonal',
    Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9,
    'orthogonal vectors',
  )

  // --- Edge: sub-parts as separate questions ---
  check('subpart_norm_a', normalizeLabel('11 (a)') === '11a', '11(a) separate leaf')
  check('subpart_norm_b', normalizeLabel('11 (b)') === '11b', '11(b) separate leaf')
  check(
    'subpart_distinct',
    normalizeLabel('11(a)') !== normalizeLabel('11(b)'),
    '11(a) ≠ 11(b)',
  )

  const subQs: ExtractedBlock[] = [
    block({ id: 'q11a', text: 'Part a?', labelNumber: '11(a)' }),
    block({ id: 'q11b', text: 'Part b?', labelNumber: '11(b)' }),
  ]
  const subAs: ExtractedBlock[] = [
    block({
      id: 'a11b',
      text: 'Chloroplast is the organelle for photosynthesis',
      labelNumber: '11 (b)',
      bbox: { x: 0.1, y: 0.5, w: 0.4, h: 0.2 },
    }),
    block({
      id: 'a11a',
      text: 'Mitochondria produce ATP via respiration',
      labelNumber: '11(a)',
      bbox: { x: 0.1, y: 0.2, w: 0.4, h: 0.2 },
    }),
  ]
  const subPairs = await mapAnswersToQuestions(subQs, subAs, async () => [])
  check(
    'subpart_match_independent',
    subPairs.filter((p) => p.status === 'matched').length === 2 &&
      subPairs.find((p) => p.question?.id === 'q11a')?.answer?.id === 'a11a' &&
      subPairs.find((p) => p.question?.id === 'q11b')?.answer?.id === 'a11b',
    '11(a)/11(b) match independently',
  )

  // --- Edge: preserve numbering 10(a)/10(b) ---
  check('preserve_10a', normalizeLabel('10.(a)') === '10a', '10.(a) preserved')
  check('preserve_10b', normalizeLabel('10 (b)') === '10b', '10(b) preserved')

  // --- Edge: out-of-order (answer on late page) ---
  const ooQs = [
    block({ id: 'q1a', text: 'Quadratic', labelNumber: '1(a)', pageIndex: 0 }),
    block({ id: 'q2', text: 'Other', labelNumber: '2', pageIndex: 0 }),
  ]
  const ooAs = [
    block({ id: 'a2', text: 'Ans 2', labelNumber: '2', pageIndex: 1 }),
    block({
      id: 'a1a',
      text: 'Roots via quadratic formula',
      labelNumber: '1(a)',
      pageIndex: 4,
      bbox: { x: 0.2, y: 0.6, w: 0.5, h: 0.2 },
    }),
  ]
  const ooPairs = await mapAnswersToQuestions(ooQs, ooAs, async () => [])
  check(
    'out_of_order',
    ooPairs.find((p) => p.question?.id === 'q1a')?.answer?.id === 'a1a' &&
      ooPairs.find((p) => p.question?.id === 'q1a')?.answer?.pageIndex === 4,
    '1(a) on page 4 still matched',
  )

  // --- Edge: unanswered ---
  const uaQs = [
    block({ id: 'q1', text: 'Answered?', labelNumber: '1' }),
    block({ id: 'q2', text: 'Missing?', labelNumber: '2' }),
  ]
  const uaAs = [
    block({
      id: 'a1',
      text: 'Yes',
      labelNumber: '1',
      bbox: { x: 0.1, y: 0.1, w: 0.3, h: 0.1 },
    }),
  ]
  const uaPairs = await mapAnswersToQuestions(uaQs, uaAs, async () => [])
  check(
    'unanswered',
    uaPairs.find((p) => p.question?.id === 'q2')?.status === 'unanswered' &&
      uaPairs.find((p) => p.question?.id === 'q2')?.answer === null,
    'Q2 unanswered',
  )

  // --- Edge: unmatched orphan answer ---
  const umQs = [block({ id: 'q1', text: 'Only one', labelNumber: '1' })]
  const umAs = [
    block({
      id: 'a1',
      text: 'Ok',
      labelNumber: '1',
      bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
    }),
    block({
      id: 'a11',
      text: 'Solar System has 8 planets',
      labelNumber: '11',
      bbox: { x: 0.1, y: 0.5, w: 0.4, h: 0.2 },
    }),
  ]
  const umPairs = await mapAnswersToQuestions(umQs, umAs, async () => [])
  check(
    'unmatched_answer',
    umPairs.some((p) => p.status === 'unmatched_answer' && p.answer?.id === 'a11'),
    'orphan 11 → unmatched_answer',
  )

  // --- Edge: highlight bbox on matched ---
  const hlPair = subPairs.find((p) => p.status === 'matched' && p.answer?.bbox)
  check('highlight_bbox_present', Boolean(hlPair?.answer?.bbox), 'matched answer has bbox')
  const hlEval = evaluateMapping({
    pairs: subPairs,
    expected: {
      should_match: [
        { q: '11(a)', a: '11(a)' },
        { q: '11(b)', a: '11(b)' },
      ],
      expect_multipage: false,
    },
  })
  check(
    'highlight_bbox_rate',
    hlEval.accuracy.highlight_bbox_rate === 1,
    'highlight_bbox_rate=100%',
  )

  // --- Edge: multipage span ---
  const mpQs = [block({ id: 'q7', text: "Newton's laws", labelNumber: '7' })]
  const mpAs = [
    block({
      id: 'a7',
      text: '1st inertia 2nd F=ma 3rd action-reaction',
      labelNumber: '7',
      pageIndex: 1,
      bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.4 },
      extraPages: [{ pageIndex: 2, bbox: { x: 0.1, y: 0.05, w: 0.8, h: 0.3 } }],
    }),
  ]
  const mpPairs = await mapAnswersToQuestions(mpQs, mpAs, async () => [])
  const mpMatched = mpPairs.find((p) => p.status === 'matched')
  check(
    'multipage_span',
    (mpMatched?.answer?.extraPages?.length ?? 0) > 0,
    'matched answer keeps extraPages',
  )
  const mpEval = evaluateMapping({
    pairs: mpPairs,
    expected: {
      should_match: [{ q: '7', a: '7' }],
      expect_multipage: true,
    },
  })
  check('multipage_ok', mpEval.accuracy.multipage_ok === true, 'mapping eval multipage_ok')

  // --- Edge: parent label enrich 9 → 9(a)/9(b) ---
  const enriched = enrichAnswerLabels([
    block({
      id: 'parent9',
      text: '(a) Marie Curie, in Physics\n(b) Mars is the Red Planet',
      labelNumber: '9',
      bbox: { x: 0.1, y: 0.4, w: 0.5, h: 0.3 },
    }),
    block({
      id: 'bad3b',
      text: 'f(x) = 2x - 5, g(x) = x^2 + 1, find g(f(3)) f(3)=1',
      labelNumber: '3(b)',
      bbox: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 },
    }),
  ])
  check(
    'parent_label_enrich',
    enriched.some((b) => normalizeLabel(b.labelNumber) === '9a') &&
      enriched.some((b) => normalizeLabel(b.labelNumber) === '9b'),
    '9 → 9(a)+9(b)',
  )

  // --- Edge: mislabel repair ---
  check(
    'mislabel_repair_1b',
    enriched.some((b) => normalizeLabel(b.labelNumber) === '1b'),
    'function composition 3(b) → 1(b)',
  )

  // --- Mega-block topic split (photo + dry cell + Newton) ---
  const mega = enrichAnswerLabels([
    block({
      id: 'mega7',
      text:
        'Photosynthesis is when plants make food using sunlight.\n' +
        '6CO2 + 6H2O → C6H12O6 + 6O2\n' +
        'A dry cell diagram with Carbon Rod (Anode) and Zinc Can (Cathode).\n' +
        "Newton's Laws 1st: Law of Inertia. 2nd: F=ma. 3rd: equal and opposite reaction.",
      labelNumber: '7',
      bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      contentKind: 'diagram',
    }),
  ])
  check(
    'mega_block_split',
    mega.some((b) => normalizeLabel(b.labelNumber) === '4') &&
      mega.some((b) => normalizeLabel(b.labelNumber) === '8') &&
      mega.some((b) => normalizeLabel(b.labelNumber) === '7'),
    'mega 7 → 4 + 8 + 7',
  )

  // --- Map-time enrich: mislabeled 3(b) composition matches Q1(b) ---
  const mapEnrichQs = [
    block({ id: 'mq1b', text: 'find g(f(3))', labelNumber: '1(b)' }),
    block({ id: 'mq3b', text: 'ladder slides', labelNumber: '3(b)' }),
  ]
  const mapEnrichAs = [
    block({
      id: 'ma-wrong',
      text: 'f(x) = 2x - 5, g(x) = x^2 + 1, find g(f(3)) f(3)=1 g(1)=2',
      labelNumber: '3(b)',
      bbox: { x: 0.1, y: 0.1, w: 0.4, h: 0.2 },
    }),
  ]
  const mapEnrichPairs = await mapAnswersToQuestions(mapEnrichQs, mapEnrichAs, async () => [])
  check(
    'map_time_enrich_1b',
    mapEnrichPairs.find((p) => p.question?.id === 'mq1b')?.status === 'matched' &&
      normalizeLabel(mapEnrichPairs.find((p) => p.question?.id === 'mq1b')?.answer?.labelNumber) ===
        '1b',
    'map enrich matches composition to 1(b)',
  )

  // --- Dedupe must not merge different labels ---
  const deduped = dedupeAnswerBlocks([
    block({
      id: 'd1',
      text: 'Mitochondria produce ATP via respiration pathway',
      labelNumber: '11(a)',
    }),
    block({
      id: 'd2',
      text: 'Chloroplast is the organelle for photosynthesis pathway',
      labelNumber: '11(b)',
    }),
  ])
  check(
    'dedupe_keeps_different_labels',
    deduped.length === 2,
    '11(a) and 11(b) not merged by dedupe',
  )

  // --- Exact match order-independent ---
  const questions: ExtractedBlock[] = [
    block({ id: 'q1', text: 'What is photosynthesis?', labelNumber: '1' }),
    block({ id: 'q2', text: 'Name the organelle.', labelNumber: '2(a)' }),
  ]
  const answers: ExtractedBlock[] = [
    block({ id: 'a2', text: 'Chloroplast', labelNumber: '2 (a)' }),
    block({ id: 'a1', text: 'Conversion of light to chemical energy', labelNumber: '1' }),
  ]
  const pairs = await mapAnswersToQuestions(questions, answers, async () => [])
  check(
    'exact_match_both',
    pairs.filter((p) => p.status === 'matched').length === 2,
    'both questions matched',
  )
  check(
    'exact_match_order_independent',
    pairs.find((p) => p.question?.id === 'q1')?.answer?.id === 'a1',
    'order-independent match',
  )

  // --- Extract eval gates (≥10 Qs, leaf sub-parts, numbering 10) ---
  const manyQs: ExtractedBlock[] = Array.from({ length: 12 }, (_, i) => {
    const n = i + 1
    if (n === 1) return block({ id: `q${n}a`, text: `Q${n}a`, labelNumber: '1(a)' })
    if (n === 10) return block({ id: `q${n}a`, text: `Q${n}a`, labelNumber: '10(a)' })
    return block({ id: `q${n}`, text: `Question ${n}`, labelNumber: String(n) })
  })
  const extractEval = evaluateExtract({
    questions: manyQs,
    answers: enriched,
    expected: {
      questions: manyQs.map((q) => q.labelNumber!),
      answers: ['1(b)', '9(a)', '9(b)'],
    },
  })
  check(
    'extract_eval_gates',
    extractEval.checks.find((c) => c.id === 'question_count')?.pass === true &&
      extractEval.checks.find((c) => c.id === 'subpart_leaf_ok')?.pass === true &&
      extractEval.checks.find((c) => c.id === 'preserve_numbering')?.pass === true,
    '≥10 Qs + leaf sub-parts + numbering 10',
  )
  check(
    'extract_eval_f1',
    typeof extractEval.accuracy.question_label_f1 === 'number' &&
      (extractEval.accuracy.question_label_f1 as number) > 0.9,
    `Q F1=${extractEval.accuracy.question_label_f1}`,
  )

  // --- Grading eval ---
  const gradePairs: MappedPair[] = [
    {
      id: 'pair-1',
      status: 'matched',
      question: block({ id: 'gq1', text: 'Q1', labelNumber: '1' }),
      answer: block({
        id: 'ga1',
        text: 'A1',
        labelNumber: '1',
        bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.1 },
      }),
      similarity: 1,
    },
    {
      id: 'unanswered-gq2',
      status: 'unanswered',
      question: block({ id: 'gq2', text: 'Q2', labelNumber: '2' }),
      answer: null,
    },
  ]
  const summary: GradingSummary = {
    totalScore: 2,
    maxScore: 4,
    answered: 1,
    unanswered: 1,
    unmatched: 0,
    overallFeedback: 'Solid effort on answered questions.',
    grades: [
      {
        pairId: 'pair-1',
        score: 2,
        maxScore: 2,
        isCorrect: true,
        feedback: 'Correct.',
      },
      {
        pairId: 'unanswered-gq2',
        score: 0,
        maxScore: 2,
        isCorrect: false,
        feedback: 'Unanswered.',
      },
    ],
  }
  const gradeEval = evaluateGrading({
    summary,
    pairs: gradePairs,
    expected: { grades: [{ q: '1', score: 2, maxScore: 2 }] },
  })
  check('grading_row_coverage', gradeEval.accuracy.grade_row_coverage === 1, 'row coverage 100%')
  check('grading_bounds', gradeEval.accuracy.score_bounds_ok === 1, 'score bounds ok')
  check('grading_unanswered_zero', gradeEval.accuracy.unanswered_zero_ok === 1, 'unanswered=0')
  check(
    'grading_totals',
    gradeEval.accuracy.totals_consistent === true,
    'totals consistent',
  )
  check('grading_feedback', (gradeEval.accuracy.feedback_present as number) >= 1, 'feedback present')
  check('grading_pass', gradeEval.pass === true, 'grading stage PASS')

  // --- Mapping F1 on toy gold ---
  const mapEval = evaluateMapping({
    pairs,
    expected: {
      should_match: [
        { q: '1', a: '1' },
        { q: '2(a)', a: '2(a)' },
      ],
      expect_multipage: false,
    },
  })
  check('mapping_f1_perfect', mapEval.accuracy.match_f1 === 1, 'toy mapping F1=100%')

  // --- Scorecard ---
  const total = passed + failed
  console.log('\n=== UNIT EDGE CASES ===')
  console.log(`  ${passed}/${total} passed`)
  if (failed > 0) {
    console.log('  Failed:')
    for (const r of results.filter((x) => !x.ok)) {
      console.log(`    - ${r.id}: ${r.detail}`)
    }
    process.exit(1)
  }
  console.log('lib self-checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
