/**
 * Full eval scorecard:
 *   1) unit edge cases (selfcheck)
 *   2) fixture stage accuracy + 9 assignment conditions (score-recheck)
 *
 * npm run eval
 */
import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { spawnSync } from 'child_process'

const ROOT = process.cwd()
const OUT = join(ROOT, '.recheck-out')
const report = join(OUT, 'live-report.json')

function run(cmd: string, args: string[]): number {
  const r = spawnSync(cmd, args, {
    stdio: 'inherit',
    shell: true,
    env: process.env,
    cwd: ROOT,
  })
  return r.status ?? 1
}

console.log('--- 1) Unit edge cases ---')
const unitStatus = run('npx', ['tsx', 'lib/selfcheck.ts'])
if (unitStatus !== 0) {
  process.exit(unitStatus)
}

if (!existsSync(report)) {
  console.error(
    '\nNo .recheck-out/live-report.json — run: npm run recheck (with npm run dev)',
  )
  process.exit(1)
}

console.log('\n--- 2) Fixture stage accuracy + conditions ---')
const scoreStatus = run('npx', ['tsx', 'scripts/score-recheck.ts'])
if (scoreStatus !== 0) {
  process.exit(scoreStatus)
}

const metricsPath = join(OUT, 'metrics.json')
const scorePath = join(OUT, 'score.json')
if (existsSync(metricsPath)) {
  const m = JSON.parse(readFileSync(metricsPath, 'utf8')) as {
    extract: Record<string, number | boolean | null>
    mapping: Record<string, number | boolean | null>
    grading: Record<string, number | boolean | null>
    conditions: string
  }

  const pct = (v: number | boolean | null | undefined) => {
    if (typeof v === 'boolean') return v ? 'yes' : 'no'
    if (v == null) return 'n/a'
    return `${(v * 100).toFixed(1)}%`
  }

  console.log('\n=== FIXTURE STAGE ACCURACY ===')
  console.log('  EXTRACT')
  console.log(`    question_label_f1:     ${pct(m.extract.question_label_f1 as number)}`)
  console.log(`    answer_label_f1:       ${pct(m.extract.answer_label_f1 as number)}`)
  console.log(`    answer_bbox_coverage:  ${pct(m.extract.answer_bbox_coverage as number)}`)
  console.log(`    question_bbox_coverage:${pct(m.extract.question_bbox_coverage as number)}`)
  console.log('  MAPPING')
  console.log(`    match_precision:       ${pct(m.mapping.match_precision as number)}`)
  console.log(`    match_recall:          ${pct(m.mapping.match_recall as number)}`)
  console.log(`    match_f1:              ${pct(m.mapping.match_f1 as number)}`)
  console.log(`    highlight_bbox_rate:   ${pct(m.mapping.highlight_bbox_rate as number)}`)
  console.log(`    out_of_order_ok:       ${pct(m.mapping.out_of_order_ok as boolean)}`)
  console.log(`    multipage_ok:          ${pct(m.mapping.multipage_ok as boolean)}`)
  console.log('  GRADING')
  console.log(`    grade_row_coverage:    ${pct(m.grading.grade_row_coverage as number)}`)
  console.log(`    score_bounds_ok:       ${pct(m.grading.score_bounds_ok as number)}`)
  console.log(`    unanswered_zero_ok:    ${pct(m.grading.unanswered_zero_ok as number)}`)
  console.log(`    feedback_present:      ${pct(m.grading.feedback_present as number)}`)
  console.log(`    grading_agreement:     ${pct(m.grading.grading_agreement as number)}`)
  console.log('\n=== ASSIGNMENT CONDITIONS ===')
  console.log(`  ${m.conditions}`)
}

if (existsSync(scorePath)) {
  const s = JSON.parse(readFileSync(scorePath, 'utf8')) as { summary: string }
  console.log(`\nDone. ${s.summary}`)
}

process.exit(0)
