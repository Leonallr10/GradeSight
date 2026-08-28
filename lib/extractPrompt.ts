import type { DocumentRole } from './types'

/** Shared VL extract prompt — keep aligned with ml/prompt.py EXTRACT_PROMPT. */
export const EXTRACT_PROMPT = `You extract ONLY gradeable exam items from a page image (any board, school, subject, or language).

Read ONLY what is visible on this page. Do not invent content.

INCLUDE — emit one JSON object per leaf item:
- Numbered questions and their lettered / roman sub-parts that a student must answer.
- When sub-parts exist, emit each leaf separately; do NOT also emit a parent block that duplicates those children.
- Every visible answer on an answer sheet, regardless of length or format.

EXCLUDE — do NOT emit JSON for:
- Exam titles, school/board headers, subject lines, dates, class, duration, max-marks banners
- General instructions, section/part headers alone, page numbers, watermarks, decorative lines
- Student name, roll number, ID, or other admin fields on answer sheets

LABEL DETECTION:
- A question label may appear as "Q4", "4.", "4)", "(a)", "10(a)", a bare number on its own line, or any local convention used on the sheet.
- Set labelWritten to the label exactly as written when visible; set labelNumber to a normalized form when possible.
- Emit a block for EVERY visible label on the page before moving on — scan top to bottom.

ANSWER COMPLETENESS (critical):
- Short answers are full answers: a single word, proper name, date, symbol, numeric result, or one-line fact MUST be extracted with the same priority as long derivations or essays.
- Never skip a labelled item because it is shorter than neighbouring answers.
- Sub-parts under one number often differ greatly in length — extract each sub-part independently.

CONTENT TYPE — set contentKind correctly:
- "text"        — prose, definitions, explanations, proper names, historical figures, single-fact recall
- "numerical"   — numeric calculations, word-problem working, unit conversions, measured quantities with steps
- "formula"     — standalone equations, chemical formulae, mathematical expressions (also put LaTeX in mathLatex)
- "derivative"  — step-by-step algebraic or calculus derivations and proofs
- "diagram"     — any hand-drawn or printed figure: biological, chemical, physical apparatus, geometry, maps, cycles, circuits, graphs, labelled sketches
- "table"       — row/column layouts: periodic-table lookups, comparisons, property lists, data grids (also fill tableData)
- "mixed"       — block combines two or more of the above (e.g. prose + formula, diagram + caption)

SPECIAL ANSWER FORMS — all are valid and required when present:
- Proper names and person names (authors, scientists, historical figures, titles of office)
- Periodic-table / element facts: symbol, atomic number, group, period, physical/chemical properties
- Diagrams with part labels, arrows, annotations — capture every visible label in diagramDescription AND summarize in text
- Numerical working: preserve calculation steps in text; put key equations in mathLatex
- Formulae and equations: reproduce in mathLatex using ASCII-safe LaTeX

ANSWER SHEET GROUPING:
- Group ALL content under the same label into ONE block: working steps, formulae, diagram labels, and captions together.
- Start a NEW block only when a NEW question label appears, or there is a clear visual break to a different labelled answer.
- Do NOT emit one JSON object per individual formula line or diagram label — those belong inside the parent block.

DIAGRAM RULES:
- Each distinct drawn figure is its own block with contentKind="diagram".
- Never merge two separate figures into one block because they are adjacent or thematically related.
- Never emit a heading without the figure content — if labels are drawn, capture them.

TABLE RULES:
- When the student wrote rows and columns (ruled or freehand), set contentKind="table".
- Fill tableData as an array of rows; each row is an array of cell strings in reading order.
- Also provide a readable text summary; do not discard the tabular structure.

NUMERICAL / FORMULA RULES:
- Multi-step calculations for one label stay in ONE block (contentKind="numerical" or "formula" as appropriate).
- Put the main equations in mathLatex; keep intermediate arithmetic in text.

CROSS-QUESTION INTEGRITY:
- Do NOT merge unrelated labelled items into one block, even if physically adjacent on the page.

STRIKETHROUGH:
- Crossed-out draft text: set isStrikethrough=true or omit it; prefer the corrected final version for the same label.

MULTI-PAGE CONTINUATION:
- If an answer clearly continues from a previous page (mid-sentence, mid-derivation, or an explicit "continued" marker), emit a block for THIS page and set continuesFrom to the label being continued.
- Do NOT merge continuation pages yourself — only flag continuesFrom.

FIELDS (all blocks):
- text               — full readable content for the item
- labelWritten       — label as visible on the page (required when readable)
- labelNumber        — normalized label when possible
- bbox               — [x, y, w, h] normalized 0–1, top-left origin, union of the whole region
- contentKind        — one of: text | numerical | formula | derivative | diagram | table | mixed
- mathLatex          — LaTeX for equations/formulae (null if none)
- diagramDescription — structured description of figures and all visible labels (null if none)
- tableData          — array of row arrays for tabular content (null if not a table)
- isStrikethrough    — true only for crossed-out draft content
- continuesFrom      — label this block continues from another page (null otherwise)

Return ONLY a JSON array (no markdown, no commentary). If nothing gradeable appears on this page, return [].
`

export function extractRoleHint(role: DocumentRole): string {
  return role === 'question'
    ? 'Document role: QUESTION PAPER. Extract only answerable questions and leaf sub-parts. Skip titles, banners, section headers, and instructions. Preserve hierarchical numbering exactly as printed.'
    : 'Document role: ANSWER SHEET. One JSON object per question label with the FULL answer for that label. Extract every visible label including short names, single facts, periodic-table entries, and one-line results. Classify each block: diagram / numerical / formula / table / text / mixed. Never merge unrelated labels. Each figure is its own diagram block. Tabular answers use tableData. Flag cross-page continuations with continuesFrom. Tag strikethrough drafts with isStrikethrough=true.'
}

/** Supplement-pass hint when the first scan likely missed short labelled items. */
export const SUPPLEMENT_MISSED_ANSWERS_HINT = `SUPPLEMENT PASS — the first scan on this page may have skipped some labelled answers.

Re-read the page and emit JSON blocks ONLY for visible answers that were missed:
- Any short one-line or single-word answers with a visible question label
- Proper names, single facts, element/periodic-table lookups, or numeric results sitting between longer answers
- Any lettered sub-part whose sibling was captured but this one was not

Do NOT re-emit labels already fully captured on this page. Return [] if nothing was missed.
Return ONLY a JSON array.`

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
