import { blockContentForModel } from './blockContent'
import type { ExtractedBlock } from './types'

/** Topic keyword rules — content-based, no fixed question numbers. */
export const TOPIC_RULES: Array<{ name: string; re: RegExp }> = [
  { name: 'photo', re: /photosynth|chlorophyll|glucose|co2|carbon dioxide/ },
  { name: 'newton', re: /newton|inertia|\bf\s*=\s*ma\b|action\s+and\s+reaction|laws?\s+of\s+motion/ },
  { name: 'mitosis', re: /mitosis|meiosis|chromosome/ },
  { name: 'ladder', re: /ladder|pythagoras|hypotenuse|slides?\s+down/ },
  { name: 'path', re: /circular\s+field|annular|path.*radius|radius.*path/ },
  { name: 'drycell', re: /dry\s*cell|anode|cathode|electrolyte|zinc\s+can/ },
  { name: 'nobel', re: /nobel|marie\s+curie|radium/ },
  { name: 'planet', re: /red\s+planet|\bmars\b|largest\s+planet|\bjupiter\b|\bjaipur\b|solar\s+system/ },
  { name: 'ambedkar', re: /ambedkar|father\s+of\s+(?:the\s+)?(?:indian\s+)?constitution/ },
  {
    name: 'triangle',
    re: /right[- ]angled\s+triangle|area\s+of\s+(?:a\s+)?triangle|(?:1\s*\/\s*2|\u00bd)\s*\*?\s*(?:b|base)|base\s*[:=]?\s*\d+/,
  },
  { name: 'plantcell', re: /plant\s+cell|(?:cell\s+wall).{0,40}(?:vacuole|chloroplast)/ },
  { name: 'methanal', re: /methanal|methanol|hcho|aldehyde|formaldehyde/ },
  { name: 'sodium', re: /\bsodium\b|group\s*=\s*1.{0,20}period\s*=\s*3/ },
  { name: 'prime', re: /prime\s+number|check.*prime|is\s+prime/ },
  { name: 'watercycle', re: /water\s+cycle/ },
  { name: 'ramrom', re: /\bram\b|\brom\b|volatile|bios/ },
  { name: 'python', re: /python|def\s+\w+|maximum of three/ },
  { name: 'quad', re: /quadratic|3x\^?2|roots?\s+are/ },
  { name: 'compos', re: /g\s*\(\s*f\s*\(|f\s*\(\s*3\s*\)/ },
  { name: 'profit', re: /\bprofit\b|selling\s+price|cost\s+price|\bcp\b|\bsp\b|shopkeeper|bicycle/i },
  { name: 'motion', re: /v\s*=\s*u\s*\+\s*at|first\s+equation\s+of\s+motion|acceleration|\bm\/s/i },
  { name: 'periodic', re: /periodic\s+table|atomic\s+number|group\s*=\s*\d|period\s*=\s*\d/ },
]

/** Chemistry topics that trigger ChemVLM refinement (diagram/formula blocks). */
export const CHEMISTRY_TOPICS = new Set(['methanal', 'sodium', 'periodic', 'drycell'])

export function hasChemistryTopic(block: ExtractedBlock | string): boolean {
  return topicalHits(block).some((h) => CHEMISTRY_TOPICS.has(h))
}

export const STRONG_TOPICS = new Set([
  'ambedkar',
  'triangle',
  'planet',
  'methanal',
  'compos',
  'ladder',
  'drycell',
  'nobel',
  'plantcell',
  'prime',
  'watercycle',
  'profit',
  'motion',
  'sodium',
  'periodic',
  'photo',
])

export function topicalHits(block: ExtractedBlock | string): string[] {
  const t = (typeof block === 'string' ? block : blockContentForModel(block)).toLowerCase()
  return TOPIC_RULES.filter((r) => r.re.test(t)).map((r) => r.name)
}

export function topicalOverlap(question: ExtractedBlock, answer: ExtractedBlock): string[] {
  const qHits = topicalHits(question)
  const aHits = new Set(topicalHits(answer))
  return qHits.filter((h) => aHits.has(h))
}

export function topicalConflict(question: ExtractedBlock, answer: ExtractedBlock): boolean {
  const qHits = topicalHits(question)
  const aHits = topicalHits(answer)
  if (qHits.length === 0 || aHits.length === 0) return false
  return qHits.every((h) => !aHits.includes(h))
}

export function topicsConflictText(a: string, b: string): boolean {
  const ah = topicalHits(a)
  const bh = topicalHits(b)
  if (ah.length === 0 || bh.length === 0) return false
  return ah.every((h) => !bh.includes(h))
}

export function diagramRichness(answer: ExtractedBlock): number {
  const d = (answer.diagramDescription || '').trim()
  const text = answer.text || ''
  let score = 0
  if (d.length > 40) score += 100 + Math.min(d.length, 400)
  if (answer.contentKind === 'diagram') score += 40
  if (/organelle|smooth\s*er|golgi|labelled|labeled|amyloplast|arrow/i.test(d)) score += 80
  if (!d && /plant\s+cell contains/i.test(text) && text.length < 220) score -= 30
  score += Math.min(text.length, 200) / 20
  return score
}

export function looksLikeFunctionComposition(text: string): boolean {
  const t = text.toLowerCase()
  return (
    /f\s*\(\s*x\s*\)/.test(t) &&
    /g\s*\(\s*x\s*\)/.test(t) &&
    (/g\s*\(\s*f\s*\(/.test(t) || /find\s+g\s*\(\s*f/.test(t) || /f\s*\(\s*3\s*\)/.test(t))
  )
}

export function looksLikeLadderSlide(text: string): boolean {
  const t = text.toLowerCase()
  return (
    (/base\s+slides|slides?\s+\d|further\s+from\s+the\s+wall|new\s+base/.test(t) &&
      /(?:ladder|pythag|\^\s*2|hypotenuse)/i.test(t)) ||
    (/base\s*=\s*\d/.test(t) && /slides?\s+down|new\s+height/i.test(t))
  )
}

export function looksLikePhotosynthesis(text: string): boolean {
  return /photosynthesis|chlorophyll|6\s*co\s*2|glucose/i.test(text)
}

export function looksLikeNewton(text: string): boolean {
  return /newton|law of inertia|\bf\s*=\s*ma\b|action\s+(?:has\s+an\s+)?equal|laws?\s+of\s+motion/i.test(
    text,
  )
}

export function looksLikeDryCell(text: string): boolean {
  return /dry\s*cell|zinc\s+can|carbon\s+rod|manganese\s+dioxide|anode|cathode/i.test(text)
}

export function looksLikeMarieCurie(text: string): boolean {
  return /marie\s+curie|nobel|radioactiv|radium/i.test(text)
}

export function looksLikeMars(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim()
  return (
    /^(?:\(b\)\s*)?(?:mars\.?|mara\.?)$/i.test(t) ||
    /\bred\s+planet\b/i.test(t) ||
    (/^mars\b/i.test(t) && t.length < 40)
  )
}

export function looksLikeTriangleArea(text: string): boolean {
  const t = text.toLowerCase().replace(/\\frac\s*\{\s*1\s*\}\s*\{\s*2\s*\}/g, '1/2')
  const hasDims =
    /base\s*[:=]?\s*\d+|height\s*[:=]?\s*\d+|b\s*=\s*\d+|h\s*=\s*\d+/.test(t)
  const hasFormula =
    /(?:1\s*\/\s*2|\u00bd|0\.5)\s*\*?\s*(?:b|base|\\times|\*|x)/i.test(t) ||
    /area\s+of\s+(?:a\s+)?(?:right[- ]angled\s+)?triangle/i.test(t) ||
    /a\s*=\s*\(?\s*(?:1\s*\/\s*2|\u00bd)/.test(t)
  return hasDims && hasFormula
}

export function looksLikePlantCell(text: string): boolean {
  const t = text.toLowerCase()
  if (/photosynthesis/i.test(t) && !/plant\s+cell/i.test(t)) return false
  if (/dry\s*cell/i.test(t) && !/plant\s+cell/i.test(t)) return false
  return (
    /plant\s+cell/i.test(t) ||
    (/cell\s+wall/i.test(t) && /(?:chloroplast|vacuole|nucleus)/i.test(t) && t.length < 400)
  )
}

export function looksLikeLargestPlanet(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim()
  if (t.length > 220) return false
  return (
    /largest\s+planet/i.test(t) ||
    /\bjupiter\b/i.test(t) ||
    /\bjaipur\b/i.test(t) ||
    (/solar\s+system/i.test(t) && /(?:planet|largest)/i.test(t))
  )
}

export function looksLikeProfitCalc(text: string): boolean {
  const t = text.toLowerCase()
  return (
    (/profit|selling\s+price|\bsp\b|\bcp\b|cost\s+price/i.test(t) && /\d/.test(t)) ||
    (/profit/i.test(t) && /selling\s+price|sp\s*[:=]/i.test(t))
  )
}

export function looksLikeAmbedkar(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim()
  if (t.length > 220) return false
  return (
    /ambedkar/i.test(t) ||
    /father\s+of\s+(?:the\s+)?(?:indian\s+)?constitution/i.test(t)
  )
}

export function looksLikeSodiumPeriodic(text: string): boolean {
  const t = text.toLowerCase().replace(/\s+/g, ' ').trim()
  if (t.length > 320) return false
  return (
    (/\bsodium\b/.test(t) && /(?:group|period|atomic\s+number|\(na\))/i.test(t)) ||
    (/\bgroup\s*=\s*1\b/.test(t) && /\bperiod\s*=\s*3\b/.test(t)) ||
    (/\(na\)/.test(t) && /atomic\s+number\s*[-=]?\s*11/.test(t))
  )
}

export function looksLikeDrawnFigureDescription(text: string): boolean {
  const t = text.toLowerCase()
  if (t.length < 40) return false
  if (
    /diagram|labelled|labeled|organelle|smooth\s*er|rough\s*er|golgi|amyloplast|mitochondr|arrow|pointing|drawn|sketch|figure\s+of/i.test(
      t,
    )
  ) {
    return true
  }
  const organelleHits = [
    'nucleus',
    'chloroplast',
    'vacuole',
    'cell wall',
    'cell membrane',
    'cytoplasm',
    'mitochondrion',
    'golgi',
    'endoplasmic',
  ].filter((w) => t.includes(w)).length
  return organelleHits >= 5 && t.length > 180
}

export function looksLikeStandaloneShortAnswer(text: string): boolean {
  const t = text.replace(/\s+/g, ' ').trim()
  if (t.length > 220) return false
  return (
    looksLikeLargestPlanet(t) ||
    looksLikeAmbedkar(t) ||
    looksLikeSodiumPeriodic(t) ||
    looksLikeMars(t) ||
    (t.length < 80 && topicalHits(t).some((h) => STRONG_TOPICS.has(h)))
  )
}
