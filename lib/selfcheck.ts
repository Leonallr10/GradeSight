/**
 * Assignment edge-case suite + unit accuracy gates.
 * Run: npm run selfcheck
 */
import { coerceBbox, isValidBbox, partitionByBbox } from './bboxCheck'
import { bboxesAreSpatiallySeparate, padBbox, sliceBboxByTextRange } from './bboxRepair'
import { needsChemVlmEnhancement } from './chem-vlm'
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

/** Representative question paper for question-driven label assignment tests. */
function vernaQuestionPaper(): ExtractedBlock[] {
  return [
    block({
      id: 'rq1',
      text: 'A shopkeeper buys a bicycle for profit 15%. Find the selling price.',
      labelNumber: '1',
    }),
    block({ id: 'rq2', text: 'Draw and label a diagram of a plant cell', labelNumber: '2' }),
    block({ id: 'rq1b', text: 'find g(f(3)) for f(x) and g(x)', labelNumber: '1(b)' }),
    block({ id: 'rq3b', text: 'A ladder slides down a wall find base', labelNumber: '3(b)' }),
    block({
      id: 'rq4',
      text: 'Which is the largest planet in our solar system?',
      labelNumber: '4',
    }),
    block({ id: 'rq5a', text: 'Draw methanal HCHO and name functional group', labelNumber: '5(a)' }),
    block({
      id: 'rq5b',
      text: 'Sodium Na group and period in periodic table',
      labelNumber: '5(b)',
    }),
    block({ id: 'rq7', text: "State Newton's laws of motion", labelNumber: '7' }),
    block({
      id: 'rq8',
      text: 'Find the area of a right-angled triangle with base 12 cm and height 9 cm',
      labelNumber: '8',
    }),
    block({
      id: 'rq9',
      text: 'Draw a labeled diagram showing photosynthesis inputs and outputs',
      labelNumber: '9',
    }),
    block({ id: 'rq9a', text: 'Marie Curie Nobel prize physics', labelNumber: '9(a)' }),
    block({ id: 'rq9b', text: 'Mars is the red planet', labelNumber: '9(b)' }),
    block({
      id: 'rq10',
      text: "Who is known as the 'Father of the Indian Constitution'?",
      labelNumber: '10',
    }),
  ]
}

const mockEmbed = async (texts: string[]) => texts.map(() => [0])

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
    'bbox_slice_proportional',
    (() => {
      const parent = { x: 0.1, y: 0.1, w: 0.8, h: 0.8 }
      const top = sliceBboxByTextRange(parent, 0, 40, 100)
      const bottom = sliceBboxByTextRange(parent, 40, 100, 100)
      return (
        top !== undefined &&
        bottom !== undefined &&
        top.y === 0.1 &&
        bottom.y > top.y &&
        bottom.y + bottom.h <= 0.91
      )
    })(),
    'proportional bbox slice',
  )
  check(
    'bbox_pad',
    (() => {
      const p = padBbox({ x: 0.1, y: 0.1, w: 0.2, h: 0.2 })
      return p.x < 0.1 && p.y < 0.1 && p.w > 0.2 && isValidBbox(p)
    })(),
    'pad bbox expands safely',
  )
  check(
    'bbox_spatial_separate',
    bboxesAreSpatiallySeparate(
      { x: 0.1, y: 0.1, w: 0.8, h: 0.35 },
      { x: 0.1, y: 0.55, w: 0.8, h: 0.35 },
    ),
    'stacked diagram regions are separate',
  )

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
/** Mock embed: one zero vector per text (for unit tests without API). */
  const subPairs = await mapAnswersToQuestions(subQs, subAs, mockEmbed)
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
  const ooPairs = await mapAnswersToQuestions(ooQs, ooAs, mockEmbed)
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
  const uaPairs = await mapAnswersToQuestions(uaQs, uaAs, mockEmbed)
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
  const umPairs = await mapAnswersToQuestions(umQs, umAs, mockEmbed)
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
  const mpPairs = await mapAnswersToQuestions(mpQs, mpAs, mockEmbed)
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
  const repairQs = vernaQuestionPaper()
  const enriched = enrichAnswerLabels(
    [
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
    ],
    repairQs,
  )
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
  const megaQs = [
    block({ id: 'mq4', text: 'Explain photosynthesis process', labelNumber: '4' }),
    block({ id: 'mq7', text: "State Newton's laws of motion", labelNumber: '7' }),
    block({ id: 'mq8', text: 'Draw a dry cell diagram with anode and cathode', labelNumber: '8' }),
  ]
  const mega = enrichAnswerLabels(
    [
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
    ],
    megaQs,
  )
  check(
    'mega_block_split',
    mega.some((b) => normalizeLabel(b.labelNumber) === '4') &&
      mega.some((b) => normalizeLabel(b.labelNumber) === '8') &&
      mega.some((b) => normalizeLabel(b.labelNumber) === '7'),
    'mega 7 → 4 + 8 + 7',
  )

  // --- Triangle + plant-cell mega split (Verna Q8/Q2) ---
  const triPlant = enrichAnswerLabels(
    [
      block({
        id: 'mega2',
        text:
          'Given base: 12cm height: 9cm Formula A = (1/2) * b * h A = (1/2) * 12 * 9 A = 54 cm^2\n' +
          'A plant cell contains a cell wall, cell membrane, cytoplasm, nucleus, chloroplasts and a large central vacuole.',
        labelNumber: '2',
        bbox: { x: 0.1, y: 0.2, w: 0.7, h: 0.4 },
      }),
    ],
    repairQs,
  )
  check(
    'triangle_plant_split',
    triPlant.some((b) => normalizeLabel(b.labelNumber) === '8') &&
      triPlant.some((b) => normalizeLabel(b.labelNumber) === '2') &&
      triPlant.length >= 2,
    'mega 2 → 8 (triangle) + 2 (plant)',
  )
  const triPlantProse = triPlant.find((b) => normalizeLabel(b.labelNumber) === '2')
  check(
    'triangle_plant_no_fake_diagram',
    Boolean(triPlantProse) && !triPlantProse?.diagramDescription,
    'prose plant slice has no fabricated diagramDescription',
  )

  // --- Profit + triangle mega (page-1 glue under label 1) ---
  const profitTri = enrichAnswerLabels(
    [
      block({
        id: 'mega1',
        text:
          'Given CP: 2400 Profit: 15% Profit = 360 SP = 2760\n' +
          'Area of right angled triangle given base = 12cm height = 9cm Formula A = (1/2) * b * h A = 54 cm^2',
        labelNumber: '1',
        bbox: { x: 0.1, y: 0.05, w: 0.7, h: 0.5 },
      }),
    ],
    repairQs,
  )
  check(
    'profit_triangle_split',
    profitTri.some((b) => normalizeLabel(b.labelNumber) === '1') &&
      profitTri.some((b) => normalizeLabel(b.labelNumber) === '8') &&
      profitTri.length >= 2,
    'mega 1 → 1 (profit) + 8 (triangle)',
  )
  const profitTriPairs = await mapAnswersToQuestions(
    [
      block({ id: 'pq1', text: 'shopkeeper bicycle profit', labelNumber: '1' }),
      block({ id: 'pq8', text: 'area of right-angled triangle base 12', labelNumber: '8' }),
    ],
    [
      block({
        id: 'pa-mega',
        text:
          'Given CP: 2400 Profit: 15% SP = 2760\n' +
          'Area of right angled triangle given base = 12cm height = 9cm A = (1/2) * 12 * 9 = 54 cm^2',
        labelNumber: '1',
      }),
    ],
    mockEmbed,
  )
  check(
    'profit_triangle_q8_matched',
    profitTriPairs.find((p) => p.question?.id === 'pq8')?.status === 'matched',
    'Q8 matched after profit+triangle split',
  )

  // --- Photo + plant: parent organelle diagram goes to Q2, not Q9 ---
  const photoPlant = enrichAnswerLabels(
    [
      block({
        id: 'mega9',
        text:
          'Photosynthesis is a process by which Green plants prepare Their food using CO2 and H2O.\n' +
          '6CO2 + 6H2O → C6H12O6 + 6O2\n' +
          'A diagram of a plant cell with various organelles labeled, including smooth ER, rough ER, nucleus, large control vacuole, amyloplast, cell wall, cell membrane, golgi apparatus, vesicles, vacuole, chloroplast, mitochondrian, cytoplasm.',
        labelNumber: '9',
        contentKind: 'diagram',
        diagramDescription:
          'A diagram of a plant cell with various organelles labeled, including smooth ER, rough ER, nucleus, large control vacuole, amyloplast, cell wall, cell membrane, golgi apparatus, vesicles, vacuole, chloroplast, mitochondrian, cytoplasm.',
        bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.7 },
      }),
    ],
    repairQs,
  )
  const pp2 = photoPlant.find((b) => normalizeLabel(b.labelNumber) === '2')
  const pp9 = photoPlant.find((b) => normalizeLabel(b.labelNumber) === '9')
  check(
    'photo_plant_diagram_to_q2',
    Boolean(pp2?.diagramDescription) &&
      /smooth\s*er|golgi|organelle/i.test(pp2?.diagramDescription || ''),
    'plant slice receives organelle diagramDescription',
  )
  check(
    'photo_plant_q9_cleared',
    Boolean(pp9) && !/smooth\s*er|golgi|amyloplast/i.test(pp9?.diagramDescription || ''),
    'photosynthesis slice does not keep plant-cell diagram',
  )

  // --- Map prefers real diagram over short prose twin for Q2 ---
  const diagQs = [
    block({ id: 'dq2', text: 'Draw and label a diagram of a plant cell', labelNumber: '2' }),
    block({ id: 'dq9', text: 'Draw a labeled diagram of photosynthesis', labelNumber: '9' }),
  ]
  const diagAs = [
    block({
      id: 'da-prose',
      text: 'A plant cell contains a cell wall, nucleus, chloroplasts and a large central vacuole.',
      labelNumber: '2',
      pageIndex: 0,
    }),
    block({
      id: 'da-photo',
      text:
        'Photosynthesis is a process by which Green plants prepare food.\n' +
        'A diagram of a plant cell with various organelles labeled.',
      labelNumber: '9',
      contentKind: 'diagram',
      diagramDescription:
        'Plant cell organelles: smooth ER, rough ER, nucleus, vacuole, amyloplast, cell wall, chloroplast, golgi apparatus.',
      pageIndex: 1,
    }),
  ]
  const diagPairs = await mapAnswersToQuestions(diagQs, diagAs, mockEmbed)
  const dq2 = diagPairs.find((p) => p.question?.id === 'dq2')
  check(
    'prefer_diagram_for_q2',
    dq2?.status === 'matched' &&
      Boolean(dq2.answer?.diagramDescription) &&
      /organelle|smooth\s*er|golgi/i.test(dq2.answer?.diagramDescription || ''),
    'Q2 maps to organelle diagram, not prose twin',
  )
  const dq9 = diagPairs.find((p) => p.question?.id === 'dq9')
  check(
    'q9_no_plant_diagram',
    dq9?.status === 'matched' &&
      !/smooth\s*er|amyloplast|golgi/i.test(dq9.answer?.diagramDescription || ''),
    'Q9 matched without plant-cell organelle diagram',
  )

  // --- Short GK content→label repair ---
  const gkRepair = enrichAnswerLabels(
    [
      block({
        id: 'gk4',
        text: 'Jaipur is the largest planet in solar system',
        labelNumber: undefined,
        bbox: { x: 0.1, y: 0.5, w: 0.5, h: 0.05 },
      }),
      block({
        id: 'gk10',
        text: 'DR. B. R. Ambedkar',
        labelNumber: undefined,
        bbox: { x: 0.1, y: 0.55, w: 0.4, h: 0.05 },
      }),
    ],
    repairQs,
  )
  check(
    'gk_label_repair',
    gkRepair.some((b) => normalizeLabel(b.labelNumber) === '4') &&
      gkRepair.some((b) => normalizeLabel(b.labelNumber) === '10'),
    'planet → 4, Ambedkar → 10',
  )

  const chemInline = enrichAnswerLabels(
    [
      block({
        id: 'chem-page',
        text:
          '4) Jaipur is the largest planet in solar system\n' +
          '10 DR. B.R. Ambedkar\n' +
          '5(a) methanol has the molecular formula HCHO\n' +
          '5(b) sodium - symbol - (Na) atomic number - 11 group = 1 Period = 3',
        labelNumber: '5(a)',
        bbox: { x: 0.1, y: 0.1, w: 0.8, h: 0.8 },
      }),
    ],
    repairQs,
  )
  check(
    'inline_chemistry_split',
    chemInline.some((b) => normalizeLabel(b.labelNumber) === '4') &&
      chemInline.some((b) => normalizeLabel(b.labelNumber) === '5b') &&
      chemInline.some((b) => normalizeLabel(b.labelNumber) === '10'),
    'glued chemistry page → 4 + 10 + 5(a) + 5(b)',
  )

  check(
    'chem_vlm_select_methanal_diagram',
    needsChemVlmEnhancement(
      block({
        id: 'cv1',
        text: 'methanal HCHO structure',
        contentKind: 'diagram',
        diagramDescription: 'hand-drawn aldehyde',
      }),
    ),
    'methanal diagram → ChemVLM candidate',
  )
  check(
    'chem_vlm_select_sodium_formula',
    needsChemVlmEnhancement(
      block({
        id: 'cv2',
        text: 'sodium Na group 1 period 3',
        contentKind: 'formula',
        mathLatex: 'Na',
      }),
    ),
    'sodium formula → ChemVLM candidate',
  )
  check(
    'chem_vlm_skip_plant_diagram',
    !needsChemVlmEnhancement(
      block({
        id: 'cv3',
        text: 'plant cell with chloroplast and vacuole',
        contentKind: 'diagram',
        diagramDescription: 'labeled plant cell',
      }),
    ),
    'biology diagram without chem topic → skip ChemVLM',
  )
  check(
    'chem_vlm_skip_chem_text_only',
    !needsChemVlmEnhancement(
      block({
        id: 'cv4',
        text: 'sodium atomic number 11',
        contentKind: 'text',
      }),
    ),
    'chemistry text without diagram/formula kind → skip ChemVLM',
  )

  const sodiumRepair = enrichAnswerLabels(
    [
      block({
        id: 'na5b',
        text: 'sodium - symbol - (Na) atomic number - 11 group = 1 Period = 3',
        labelNumber: undefined,
      }),
    ],
    repairQs,
  )
  check(
    'sodium_label_repair',
    sodiumRepair.some((b) => normalizeLabel(b.labelNumber) === '5b'),
    'sodium periodic table → 5(b)',
  )

  const plantTwins = enrichAnswerLabels([
    block({
      id: 'p-prose',
      text: 'A plant cell contains a cell wall, nucleus, chloroplasts and a large central vacuole.',
      labelNumber: '2',
      pageIndex: 0,
    }),
    block({
      id: 'p-diag',
      text: 'A diagram of a plant cell with various organelles labeled, including smooth ER, golgi apparatus, and chloroplast.',
      labelNumber: '2',
      pageIndex: 1,
      contentKind: 'diagram',
      diagramDescription:
        'Plant cell organelles: smooth ER, rough ER, nucleus, vacuole, chloroplast, golgi apparatus.',
    }),
  ])
  check(
    'dedupe_plant_cell_twins',
    plantTwins.filter((b) => normalizeLabel(b.labelNumber) === '2').length === 1 &&
      Boolean(plantTwins.find((b) => normalizeLabel(b.labelNumber) === '2')?.diagramDescription),
    'keep diagram Q2 twin, drop prose duplicate',
  )

  // --- Map: split mega-2 matches Q8 and Q2; topical rematch Q4/Q10 ---
  const vernaQs = [
    block({ id: 'vq2', text: 'Draw and label a diagram of a plant cell', labelNumber: '2' }),
    block({ id: 'vq4', text: 'Which is the largest planet in our solar system?', labelNumber: '4' }),
    block({ id: 'vq8', text: 'Find the area of a right-angled triangle with base 12 cm', labelNumber: '8' }),
    block({
      id: 'vq10',
      text: 'Who is known as the Father of the Indian Constitution?',
      labelNumber: '10',
    }),
  ]
  const vernaAs = [
    block({
      id: 'va-mega',
      text:
        'Given base: 12cm height: 9cm Formula A = (1/2) * b * h A = 54 cm^2\n' +
        'A plant cell contains a cell wall, nucleus, chloroplasts and a large central vacuole.',
      labelNumber: '2',
    }),
    block({
      id: 'va4',
      text: 'Jaipur is the largest planet in solar system',
      labelNumber: undefined,
    }),
    block({ id: 'va10', text: 'DR. B. R. Ambedkar', labelNumber: undefined }),
  ]
  const vernaPairs = await mapAnswersToQuestions(vernaQs, vernaAs, mockEmbed)
  check(
    'verna_q8_matched',
    vernaPairs.find((p) => p.question?.id === 'vq8')?.status === 'matched',
    'Q8 matched to triangle half',
  )
  check(
    'verna_q2_matched',
    vernaPairs.find((p) => p.question?.id === 'vq2')?.status === 'matched',
    'Q2 matched to plant-cell half',
  )
  check(
    'verna_q4_matched',
    vernaPairs.find((p) => p.question?.id === 'vq4')?.status === 'matched',
    'Q4 matched via planet repair/rematch',
  )
  check(
    'verna_q10_matched',
    vernaPairs.find((p) => p.question?.id === 'vq10')?.status === 'matched',
    'Q10 matched via Ambedkar repair/rematch',
  )

  const embeddedGk = enrichAnswerLabels(
    [
      block({
        id: 'meth-gk',
        text: 'Methanol has the molecular formula HCHO. Methanal contains the aldehyde group.\nDR. B. R. Ambedkar',
        labelNumber: '5(a)',
      }),
    ],
    repairQs,
  )
  check(
    'split_embedded_ambedkar',
    embeddedGk.some((b) => /ambedkar/i.test(b.text || '') && !normalizeLabel(b.labelNumber)?.startsWith('5')),
    'Ambedkar peeled out of glued chemistry block',
  )
  const embeddedPairs = await mapAnswersToQuestions(
    [
      block({ id: 'eq4', text: 'Which is the largest planet in our solar system?', labelNumber: '4' }),
      block({
        id: 'eq10',
        text: "Who is known as the 'Father of the Indian Constitution'?",
        labelNumber: '10',
      }),
      block({ id: 'eq5a', text: 'Draw the structure of methanal (HCHO)', labelNumber: '5(a)' }),
    ],
    [
      block({
        id: 'ea5a',
        text: 'Methanol has the molecular formula HCHO.\nDR. B. R. Ambedkar',
        labelNumber: '5(a)',
      }),
      block({ id: 'ea4', text: 'Jaipur is the largest planet in solar system', labelNumber: undefined }),
    ],
    mockEmbed,
  )
  check(
    'embedded_gk_q10_matched',
    embeddedPairs.find((p) => p.question?.id === 'eq10')?.status === 'matched',
    'Q10 matched after embedded Ambedkar split',
  )
  check(
    'embedded_gk_q4_matched',
    embeddedPairs.find((p) => p.question?.id === 'eq4')?.status === 'matched',
    'Q4 still matched with embedded split',
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
  const mapEnrichPairs = await mapAnswersToQuestions(mapEnrichQs, mapEnrichAs, mockEmbed)
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
  const pairs = await mapAnswersToQuestions(questions, answers, mockEmbed)
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
