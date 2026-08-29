import { groupAnswersByLabel } from './groupAnswers'
import { inferLabelFromText } from './parseExtract'
import { normalizeLabel, parseNormalizedLabel } from './normalizeLabel'
import type { DocumentRole, ExtractedBlock } from './types'

const BOILERPLATE_RE =
  /^(?:mid[-\s]?term|final|end[-\s]?term|examination|exam\s+paper|question\s+paper|general\s+instructions?|instructions?\s*:|duration\s*:|max\.?\s*marks?\s*:|total\s+marks?\s*:|time\s+allowed|name\s*:|class\s*:|roll\s*(?:no|number)?\s*:|admission|candidate|subject\s*:|date\s*:|school\s*:|board\s*:)/i

const SECTION_ONLY_RE =
  /^(?:section|part|unit|paper)\s*[a-z0-9ivx]+(?:\s*[:.\-–—]\s*.*)?$/i

const INSTRUCTION_RE =
  /^(?:write\s+all\s+answers|attempt\s+all|answer\s+all|use\s+the\s+provided|read\s+the\s+(?:following|questions)|tick\s+the\s+correct|fill\s+in\s+the\s+blanks|do\s+not\s+write|rough\s+work)/i

const QUESTION_CUE_RE =
  /\b(?:solve|find|calculate|compute|evaluate|simplify|prove|show\s+that|define|explain|describe|list|state|draw|sketch|identify|distinguish|differentiate|compare|write|derive|determine|how\s+(?:high|much|many|long)|what\s+(?:is|are|happens)|who\s+(?:was|is|were)|which\s+(?:planet|of)|name\s+the|give\s+(?:an?\s+)?example)\b/i

const MARKS_RE = /[\[(]?\s*\d+\s*marks?\s*[\])]?|\b\d+\s*marks?\b/i

function cleanText(text: string): string {
  return text.replace(/\s+/g, ' ').trim()
}

function hasQuestionLabel(block: ExtractedBlock): boolean {
  const raw = block.labelNumber || inferLabelFromText(block.text)
  const n = normalizeLabel(raw)
  if (!n) return false
  const parts = parseNormalizedLabel(n)
  if (!parts.num) return false
  const num = Number(parts.num)
  return num >= 1 && num <= 80
}

/** True for headers, section titles, duration lines, general instructions — not gradeable items. */
export function isNonQuestionBoilerplate(block: ExtractedBlock): boolean {
  const text = cleanText(block.text)
  if (!text) return true
  if (text.length < 8) return true
  if (BOILERPLATE_RE.test(text)) return true
  if (SECTION_ONLY_RE.test(text)) return true
  if (INSTRUCTION_RE.test(text)) return true
  if (/^instructions?\b/i.test(text) && !QUESTION_CUE_RE.test(text) && !MARKS_RE.test(text)) {
    return true
  }
  if (/^section\s+[a-z0-9]+/i.test(text) && !QUESTION_CUE_RE.test(text) && !MARKS_RE.test(text)) {
    return true
  }
  if (
    text.length < 120 &&
    /examination|mid[-\s]?term|max\s*marks|duration/i.test(text) &&
    !QUESTION_CUE_RE.test(text)
  ) {
    return true
  }
  return false
}

export function isLikelyExamQuestion(block: ExtractedBlock): boolean {
  if (isNonQuestionBoilerplate(block)) return false

  const text = cleanText(block.text)
  if (INSTRUCTION_RE.test(text) || /answer booklet|provided sheet|blue\/black pen/i.test(text)) {
    return false
  }

  const labeled = hasQuestionLabel(block)
  const hasCue = QUESTION_CUE_RE.test(text)
  const hasMarks = MARKS_RE.test(text)

  if (labeled && (hasMarks || hasCue)) return true
  if (hasCue && (hasMarks || labeled || text.length >= 25)) return true
  if (labeled && text.length >= 40) {
    return hasCue || hasMarks || /\?/.test(text)
  }

  return false
}

/** Drop student header / admin lines from answer sheets. */
export function isAnswerSheetNoise(block: ExtractedBlock): boolean {
  const text = cleanText(block.text)
  if (!text) return true
  if (block.isStrikethrough) return true
  if (/^(?:name|id|io|roll|class|date|school|candidate)\s*[:=|]/i.test(text)) return true
  if (/name\s*:.+\|.+(?:id|io|roll)/i.test(text)) return true
  if (/^ans\s*:\s*\d+\s*(\(|$)/i.test(text) && /extra|unasked/i.test(text)) return true
  if (text.length < 3) return true
  return false
}

export function filterExtractedBlocks(
  blocks: ExtractedBlock[],
  role: DocumentRole,
): ExtractedBlock[] {
  if (role === 'question') {
    return blocks.filter(isLikelyExamQuestion)
  }
  const cleaned = blocks.filter((b) => !isAnswerSheetNoise(b))
  return groupAnswersByLabel(cleaned)
}
