import { coerceBbox, isValidBbox, partitionByBbox } from './bboxCheck'
import { normalizeLabel } from './normalizeLabel'
import { cosineSimilarity } from './cosine'
import { mapAnswersToQuestions } from './matching'
import { inferLabelFromText } from './parseExtract'
import type { ExtractedBlock } from './types'

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
}

async function main() {
  // normalizeLabel
  assert(normalizeLabel('11 (a)') === '11a', 'label 11 (a)')
  assert(normalizeLabel('Q.11-A') === '11a', 'label Q.11-A')
  assert(normalizeLabel('20(b)(i)') === '20bi', 'label 20(b)(i)')
  assert(normalizeLabel('  ') === null, 'empty label')
  assert(inferLabelFromText('19. (a) What are such sequences') === '19(a)', 'infer 19a')
  assert(inferLabelFromText('20 (b) (ii) Name the two types') === '20(b)(ii)', 'infer 20bii')


// bbox
assert(isValidBbox({ x: 0.1, y: 0.2, w: 0.5, h: 0.1 }), 'valid box')
assert(!isValidBbox({ x: 0.1, y: 0.2, w: -0.1, h: 0.1 }), 'negative w')
assert(!isValidBbox({ x: 0.1, y: 0.2, w: 1.5, h: 0.1 }), 'w>1')
assert(coerceBbox([0.1, 0.2, 0.6, 0.4])?.w.toFixed(2) === '0.50', 'xyxy coerce')

const { valid, invalid } = partitionByBbox([
  {
    id: '1',
    pageIndex: 0,
    text: 'ok',
    bbox: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 },
    bboxSource: 'qwen',
  },
  {
    id: '2',
    pageIndex: 0,
    text: 'bad',
    bbox: { x: -1, y: 0, w: 2, h: 2 },
    bboxSource: 'qwen',
  },
])
assert(valid.length === 1 && invalid.length === 1, 'partition')

// cosine
assert(Math.abs(cosineSimilarity([1, 0], [1, 0]) - 1) < 1e-9, 'cosine identical')
assert(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9, 'cosine orthogonal')

// matching pass 1
const questions: ExtractedBlock[] = [
  { id: 'q1', pageIndex: 0, text: 'What is photosynthesis?', labelNumber: '1', bboxSource: 'qwen' },
  { id: 'q2', pageIndex: 0, text: 'Name the organelle.', labelNumber: '2(a)', bboxSource: 'qwen' },
]
const answers: ExtractedBlock[] = [
  { id: 'a2', pageIndex: 0, text: 'Chloroplast', labelNumber: '2 (a)', bboxSource: 'qwen' },
  { id: 'a1', pageIndex: 0, text: 'Conversion of light to chemical energy', labelNumber: '1', bboxSource: 'qwen' },
]

const pairs = await mapAnswersToQuestions(questions, answers, async () => [])
assert(pairs.filter((p) => p.status === 'matched').length === 2, 'pass1 matched both')
assert(pairs.find((p) => p.question?.id === 'q1')?.answer?.id === 'a1', 'order-independent match')

console.log('lib self-checks passed')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
