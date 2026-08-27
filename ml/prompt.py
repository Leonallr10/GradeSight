"""Shared extract prompt — keep aligned with lib/hf-qwen.ts EXTRACT_PROMPT."""

EXTRACT_PROMPT = """You extract ONLY gradeable exam items from a page image (any board / school / subject).

Read ONLY what appears on this page. Do not invent content.

INCLUDE (each as its own JSON object — leaf sub-parts only):
- Numbered questions and lettered / roman sub-parts that a student must answer.
- If sub-parts exist, emit separate leaves; do NOT also emit a parent that duplicates those children.

EXCLUDE completely:
- Exam title, school/board name, subject line, date, class, duration, max marks banners
- Instructions / section headers alone / page numbers / student name fields

ANSWER SHEETS — grouping (critical):
- Group ALL lines that belong to the same question label into ONE block.
- Only start a NEW block when a NEW question label appears.
- Always set labelWritten when a Q# is visible.
- bbox: [x, y, w, h] normalized 0–1, top-left origin

Return ONLY a JSON array (no markdown). If this page has no gradeable items, return [].
[{"text":"...","labelWritten":"Q7","labelNumber":"7","bbox":[x,y,w,h],"contentKind":"text","mathLatex":"","diagramDescription":"","isStrikethrough":false}]
"""

ROLE_HINT = {
    "question": (
        "Document role: QUESTION PAPER. Extract ONLY answerable questions and sub-parts. "
        "Skip titles, section headers, duration/marks banners, and instructions."
    ),
    "answer": (
        "Document role: ANSWER SHEET. ONE JSON object per question label covering the FULL answer. "
        "Always set labelWritten when Q# / question number is visible. "
        "Never split one labelled answer into many fragments."
    ),
}
