# VedaAI Exam Mapping

Teacher-facing **Next.js** app: upload a question paper + handwritten answer sheet, extract questions/answers, map side-by-side, highlight answer regions, and optionally grade with Groq.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) |
| Extraction (deploy) | HF Inference VL — `meta-llama/Llama-4-Scout-17B-16E-Instruct` |
| Extraction (local / offline) | Fine-tuned **Qwen2.5-VL-3B** via `ml/serve_extract.py` (`LOCAL_EXTRACT_URL`) |
| Matching | Label normalize + cosine (lexical embeddings) |
| Bbox repair | Same HF vision model (when HF mode) |
| Grading | Groq (`openai/gpt-oss-20b`) |
| PDF → images | `pdfjs-dist` (client-side) |

## Setup

```bash
pnpm install   # or npm install
cp .env.example .env.local
# fill HF_TOKEN and GROQ_API_KEY (required for deploy mode)
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Local extract (optional — avoid HF quota)

```bash
cd ml && pip install -r requirements.txt
# train in Colab: ml/notebooks/finetune_extract.ipynb
# or: python train.py …
python serve_extract.py
```

In `.env.local`:

```env
LOCAL_EXTRACT_URL=http://127.0.0.1:8001
```

Leave unset on Vercel (live URL uses HF Scout + Groq). **No cascading Gemini fallback.**

## Pipeline

1. **Upload** — PDF/images rasterized to per-page PNGs  
2. **`POST /api/extract`** — local Qwen **or** HF Scout (text + bbox)  
3. **`POST /api/validate-bbox`** — validate boxes; optional HF localize  
4. **`POST /api/map-answers`** — exact label match, then lexical similarity  
5. **`POST /api/grade`** — Groq batch score/feedback + summary  
6. **UI** — click a question → highlight answer bbox  

Post-extract: [`lib/enrichAnswers.ts`](lib/enrichAnswers.ts) expands parent labels (`9` → `9(a)`/`9(b)`) and corrects common mislabels.

## Per-stage evaluation

```bash
pnpm recheck   # needs `pnpm dev`; writes .recheck-out/live-report.json + stage-*.json
pnpm score     # stage accuracies + 9 assignment conditions
pnpm eval      # score existing live-report
```

Each stage reports accuracy separately:

| Stage | Metrics |
|-------|---------|
| Extract | question/answer label P/R/F1, bbox coverage |
| Mapping | match P/R/F1, highlight bbox rate, edge cases |
| Grading | row coverage, score bounds, unanswered=0, feedback |

Gold fixtures: [`ml/fixtures/`](ml/fixtures/). Model CER/WER/IoU: `python ml/evaluate.py --demo`.

## Fine-tuning (Colab)

See [`ml/README.md`](ml/README.md). Pipeline: preprocess → load Qwen2.5-VL-3B → LoRA → evaluate → export adapter → local FastAPI.

Scout is used for the **live URL** because Vercel cannot load LoRA weights; local mode is for training demos and avoiding API exhaustion.

## Deploy (Vercel)

1. `pnpm build` locally to verify.  
2. Import the repo in the Vercel dashboard.  
3. Env: `HF_TOKEN`, `GROQ_API_KEY` (do not set `LOCAL_EXTRACT_URL` on Vercel).  
4. `vercel.json` sets API `maxDuration: 300`.

## Project layout

- `app/page.tsx` — UI orchestration  
- `app/api/*/route.ts` — pipeline endpoints  
- `lib/extract.ts`, `lib/hf-qwen.ts`, `lib/local-extract.ts`, `lib/groq.ts`, `lib/matching.ts`  
- `lib/eval/*` — per-stage evaluation  
- `ml/` — Colab train + local serve  
- `components/*` — Upload, ProgressStepper, QuestionList, AnswerSheetViewer, GradingSummary  
