import type { DocumentRole } from './types'

/** Shared VL extract prompt — keep aligned across HF / local. */
export const EXTRACT_PROMPT = `You extract ONLY gradeable exam items from a page image (any board / school / subject).

Read ONLY what appears on this page. Do not invent content.

INCLUDE (each as its own JSON object — leaf sub-parts only):
- Numbered questions and lettered / roman sub-parts that a student must answer.
- If sub-parts exist, emit separate leaves; do NOT also emit a parent that duplicates those children.
- OR choices: emit each leaf under each branch that appears on the page.

EXCLUDE completely (do NOT emit JSON for these):
- Exam title, school/board name, subject line, date, class, duration, max marks banners
- "Instructions" / general instructions / "write answers in the booklet" admin lines
- Section / Part headers alone (e.g. "SECTION A: MATHEMATICS")
- Page numbers, watermarks, decorative lines
- Student name / roll / ID fields on answer sheets (those are not answers)

ANSWER SHEETS — grouping (critical):
- Group ALL lines that belong to the same question label into ONE block, even if they span multiple sentences, formula lines, calculation steps, or diagram labels.
- Only start a NEW block when a NEW question label appears (e.g. "Q4", "Q3(b)", "1(a)", "Q7:") or there is a clear large visual gap to a different answer.
- Do NOT emit one JSON object per formula line or per diagram label.
- SHORT / one-line GK answers are REQUIRED: emit a block for EVERY visible question number, including brief answers like a planet name, a person's name (e.g. Ambedkar), or a single formula line. Never skip short answers between longer ones (e.g. do not jump from 3(b) to 5(a) if 4 and 10 appear in between).
- Do NOT merge unrelated questions into one block (e.g. triangle-area calc + plant-cell description must be TWO blocks with their own labels).
- Strikethrough / crossed-out draft text: set isStrikethrough=true on that content (or omit it). Prefer the corrected final writing for the same label.
- Diagrams: each drawn figure is its OWN block with contentKind="diagram". Put every visible label (Cap, Anode, Cathode, electrolyte, cell wall, nucleus, etc.) inside diagramDescription AND summarize them in text. Never emit only the heading "Q8: …" without the diagram content.
- Do NOT attach a plant-cell figure to a photosynthesis answer (or vice versa) — separate blocks with their own labels.
- Do NOT omit large page-filling diagrams even when nearby text belongs to another question number.

Fields:
- labelWritten: REQUIRED whenever a question number/label is visible anywhere above, beside, or inside the block (e.g. "Q4", "Q7: Newton's Laws", "1(a)"). Never omit it when readable.
- labelNumber: same marker normalized if possible
- bbox: [x, y, w, h] normalized 0–1, top-left origin (union of the whole answer region)
- text: full answer/question wording for that leaf
- contentKind: "text" | "formula" | "derivative" | "diagram" | "mixed"
- mathLatex: LaTeX for equations / derivatives / chemical formulae when present
- diagramDescription: full structured description of drawn/printed figures including all labels
- isStrikethrough: true only for crossed-out draft text

Return ONLY a JSON array (no markdown). If this page has no gradeable items, return [].
[{"text":"...","labelWritten":"Q7","labelNumber":"7","bbox":[x,y,w,h],"contentKind":"diagram","mathLatex":"...","diagramDescription":"...","isStrikethrough":false}]
`

export function extractRoleHint(role: DocumentRole): string {
  return role === 'question'
    ? 'Document role: QUESTION PAPER. Extract ONLY answerable questions and sub-parts. Skip titles, section headers, duration/marks banners, and instructions.'
    : 'Document role: ANSWER SHEET. ONE JSON object per question label covering the FULL answer. Always set labelWritten when Q# / question number is visible anywhere near the block. Emit EVERY visible Q# including short one-line GK answers (planet names, Ambedkar, etc.) — do not skip lines between physics and chemistry. Never merge unrelated questions. Each drawn figure → its own diagram block with full diagramDescription (all labels); never glue a plant-cell figure onto photosynthesis. Never split one labelled answer into many fragments. Tag crossed-out drafts with isStrikethrough=true.'
}

export function isProviderCreditError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /402|depleted|credits|quota|billing|RESOURCE_EXHAUSTED|insufficient.?fund/i.test(
    msg,
  )
}

export function isProviderPermissionError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /403|insufficient permissions|Inference Providers on behalf/i.test(msg)
}
