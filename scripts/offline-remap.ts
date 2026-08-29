/**
 * Offline rematch: enrich answers from live-report → map → stage eval.
 * No HF/Groq calls. Proves accuracy lift from label repair.
 *
 * Usage: npx tsx scripts/offline-remap.ts
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { enrichAnswerLabels } from '../lib/enrichAnswers'
import {
  evaluateExtract,
  evaluateMapping,
  summarizeReport,
  type ExpectedLabels,
  type ExpectedPairs,
} from '../lib/eval'
import { lexicalEmbedTexts } from '../lib/lexicalEmbed'
import { mapAnswersToQuestions } from '../lib/matching'
import type { ExtractedBlock, MappedPair } from '../lib/types'

const ROOT = process.cwd()
const OUT = join(ROOT, '.recheck-out')

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T
}

async function main() {
  const reportPath = join(OUT, 'live-report.json')
  if (!existsSync(reportPath)) {
    console.error('Missing live-report.json — run a recheck first')
    process.exit(1)
  }

  const report = loadJson<{
    questions: ExtractedBlock[]
    answers: ExtractedBlock[]
    pages?: { question: number; answer: number }
    extractVia?: unknown
    grading?: unknown
  }>(reportPath)

  const expectedLabels = loadJson<ExpectedLabels>(
    join(ROOT, 'ml/fixtures/expected-labels.json'),
  )
  const expectedPairs = loadJson<ExpectedPairs>(
    join(ROOT, 'ml/fixtures/expected-pairs.json'),
  )

  const questions = report.questions
  const rawAnswers = report.answers
  const answers = enrichAnswerLabels(rawAnswers, questions)

  console.log(`Raw answers: ${rawAnswers.length} → enriched: ${answers.length}`)
  console.log(
    'Enriched labels:',
    answers.map((a) => a.labelNumber || a.labelWritten || '-').join(', '),
  )

  const pairs: MappedPair[] = await mapAnswersToQuestions(
    questions,
    answers,
    lexicalEmbedTexts,
  )

  const matched = pairs.filter((p) => p.status === 'matched')
  const unanswered = pairs.filter((p) => p.status === 'unanswered')
  const unmatched = pairs.filter((p) => p.status === 'unmatched_answer')

  console.log(
    `\nPairs: matched=${matched.length} unanswered=${unanswered.length} unmatched=${unmatched.length}`,
  )
  for (const p of matched) {
    console.log(
      `  matched q=${p.question?.labelNumber} a=${p.answer?.labelNumber} bbox=${Boolean(p.answer?.bbox)}`,
    )
  }

  const stageExtract = evaluateExtract({
    questions,
    answers,
    expected: expectedLabels,
  })
  const stageMapping = evaluateMapping({
    pairs,
    expected: expectedPairs,
  })

  mkdirSync(OUT, { recursive: true })
  writeFileSync(join(OUT, 'stage-extract.json'), JSON.stringify(stageExtract, null, 2))
  writeFileSync(join(OUT, 'stage-mapping.json'), JSON.stringify(stageMapping, null, 2))

  const metrics = {
    extract: stageExtract.accuracy,
    mapping: stageMapping.accuracy,
    offline: true,
    enrichedAnswerLabels: answers.map((a) => a.labelNumber || a.labelWritten || null),
    mappingCounts: {
      matched: matched.length,
      unanswered: unanswered.length,
      unmatched: unmatched.length,
    },
  }
  writeFileSync(join(OUT, 'metrics-offline.json'), JSON.stringify(metrics, null, 2))

  // Also refresh main metrics extract/mapping for scorecard (keep grading from last live run)
  const prevMetricsPath = join(OUT, 'metrics.json')
  const prev = existsSync(prevMetricsPath)
    ? loadJson<Record<string, unknown>>(prevMetricsPath)
    : {}
  writeFileSync(
    join(OUT, 'metrics.json'),
    JSON.stringify(
      {
        ...prev,
        extract: stageExtract.accuracy,
        mapping: stageMapping.accuracy,
        offlineRemap: true,
      },
      null,
      2,
    ),
  )

  // Synthetic structural grades (no Groq) aligned to remapped pairs
  const structuralGrades = pairs
    .filter((p) => p.status === 'matched' || p.status === 'unanswered')
    .map((p) => ({
      pairId: p.id,
      score: p.status === 'matched' ? 2 : 0,
      maxScore: 2,
      isCorrect: p.status === 'matched',
      feedback:
        p.status === 'matched'
          ? 'Offline remap placeholder grade.'
          : 'This question appears to be unanswered in the uploaded sheet.',
    }))
  const totalScore = structuralGrades.reduce((s, g) => s + g.score, 0)
  const maxScore = structuralGrades.reduce((s, g) => s + g.maxScore, 0)

  // Update live-report pairs/answers so score-recheck reflects remap
  const updated = {
    ...report,
    answers,
    pairs,
    mapping: {
      total: pairs.length,
      matched: matched.length,
      unanswered: unanswered.length,
      unmatched: unmatched.length,
      matchedWithBbox: matched.filter((p) => p.answer?.bbox).length,
      matchedWithExtraPages: matched.filter(
        (p) => (p.answer?.extraPages?.length ?? 0) > 0,
      ).length,
      pairs: pairs.map((p) => ({
        status: p.status,
        qLabel: p.question?.labelNumber,
        aLabel: p.answer?.labelNumber,
        hasBbox: Boolean(p.answer?.bbox),
        extraPages: p.answer?.extraPages?.length ?? 0,
        similarity: p.similarity,
      })),
    },
    grading: {
      totalScore,
      maxScore,
      answered: matched.length,
      unanswered: unanswered.length,
      unmatched: unmatched.length,
      overallFeedback: 'Offline remap — structural grades only (Groq not re-run).',
      grades: structuralGrades,
    },
    stages: {
      extract: stageExtract,
      mapping: stageMapping,
    },
  }
  writeFileSync(join(OUT, 'live-report.json'), JSON.stringify(updated, null, 2))
  writeFileSync(join(OUT, 'remapped-report.json'), JSON.stringify(updated, null, 2))

  console.log('\n' + summarizeReport(stageExtract))
  console.log('\n' + summarizeReport(stageMapping))

  const aF1 = stageExtract.accuracy.answer_label_f1 as number | null
  const mF1 = stageMapping.accuracy.match_f1 as number | null
  console.log(
    `\nTargets: A F1≥90% → ${aF1 != null ? (aF1 * 100).toFixed(1) + '%' : 'n/a'}; match F1≥90% → ${mF1 != null ? (mF1 * 100).toFixed(1) + '%' : 'n/a'}`,
  )

  if (aF1 != null && aF1 < 0.9) {
    console.warn('Answer label F1 below 90% target')
  }
  if (mF1 != null && mF1 < 0.9) {
    console.warn('Match F1 below 90% target')
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
