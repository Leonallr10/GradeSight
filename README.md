# VedaAI Exam Mapping

Teacher-facing Next.js app: upload a question paper + handwritten answer sheet, extract Q&A with **Qwen2.5-VL**, repair bboxes with **Gemini**, match answers (label + embeddings), grade with Gemini, and highlight answer regions in a Figma-matched UI.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) |
| Extraction | `Qwen/Qwen2.5-VL-7B-Instruct` via Hugging Face Inference |
| Bbox fallback | Gemini 2.0 Flash |
| Matching | Label normalize + cosine on `gemini-embedding-001` |
| Grading | Gemini 2.0 Flash (`responseSchema`) |
| PDF → images | `pdfjs-dist` (client-side) |

## Setup

```bash
pnpm install
cp .env.example .env.local
# fill HF_TOKEN and GEMINI_API_KEY
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

## Pipeline

1. **Upload** — PDF/images rasterized to per-page PNGs  
2. **`POST /api/extract`** — Qwen2.5-VL text + bbox  
3. **`POST /api/validate-bbox`** — validate boxes; Gemini localizes failures  
4. **`POST /api/map-answers`** — exact label match, then cosine ≥ 0.72  
5. **`POST /api/grade`** — per-pair score/feedback + summary  
6. **UI** — click a question → highlight answer bbox (multi-page aware)

## Deploy (manual — Vercel)

1. `pnpm build` locally to verify.
2. Import the repo in the Vercel dashboard (or `vercel --prod` from your machine).
3. Add env vars: `HF_TOKEN`, `GEMINI_API_KEY`, optional `HF_QWEN_MODEL`, optional `EXTRACT_FALLBACK=gemini`.
4. `vercel.json` already sets API `maxDuration: 300` for long extract/grade runs.

If HF rate-limits during a demo, set `EXTRACT_FALLBACK=gemini` (or leave unset — extract auto-falls back to Gemini on HF errors).

## Project layout

- `app/page.tsx` — UI orchestration  
- `app/api/*/route.ts` — pipeline endpoints  
- `lib/bboxCheck.ts`, `matching.ts`, `hf-qwen.ts`, `gemini.ts`, `pdf-rasterize.ts`  
- `components/*` — Upload, ProgressStepper, QuestionList, AnswerSheetViewer, GradingSummary  
