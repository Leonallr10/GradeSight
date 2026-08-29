# VedaAI Exam Mapping

Teacher-facing **Next.js** app: upload a question paper + handwritten answer sheet, extract questions/answers, map side-by-side, highlight answer regions, and optionally grade with Groq.

**Full pipeline documentation:** [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — methods, flow, models, and implementation details.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) |
| Extraction (default / deploy) | HF Inference VL — `meta-llama/Llama-4-Scout-17B-16E-Instruct:novita` |
| Chemistry specialist (optional local) | **`AI4Chem/ChemVLM-8B`** via `ml/serve_chem.py` — refines chem diagram/formula blocks; `USE_CHEM_VLM=1` |
| Extraction (legacy offline dev) | **Qwen2.5-VL-3B** via `ml/serve_extract.py` — requires `USE_LEGACY_LOCAL_EXTRACT=1` |
| Matching | Label normalize + cosine (lexical embeddings) |
| Bbox repair | Same HF vision model (when HF mode) |
| Grading | Groq (`openai/gpt-oss-20b`) |
| PDF → images | `pdfjs-dist` (client-side) |

## Setup

```bash
pnpm install   # or npm install
cp .env.example .env.local
# HF_TOKEN: fine-grained token with "Make calls to Inference Providers"
# HF_QWEN_MODEL defaults to meta-llama/Llama-4-Scout-17B-16E-Instruct:novita
# fill GROQ_API_KEY (required for grading)
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

### Legacy local extract (optional — offline dev when HF quota exhausted)

```bash
cd ml && pip install -r requirements.txt
npm run extract:local   # from repo root
```

In `.env.local`:

```env
USE_LEGACY_LOCAL_EXTRACT=1
LOCAL_EXTRACT_URL=http://127.0.0.1:8001
```

Do **not** set these on Vercel. Production and normal dev use HF Scout + Groq.

## Pipeline

1. **Upload** — PDF/images rasterized to per-page PNGs  
2. **`POST /api/extract`** — HF Scout (default) or legacy local Qwen when opted in  
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

Scout is used for the **live URL** and default dev. Legacy local Qwen is opt-in for offline training demos when HF credits are exhausted.

## Deploy (Vercel)

1. `pnpm build` locally to verify.  
2. Import the repo in the Vercel dashboard.  
3. Env: `HF_TOKEN`, `GROQ_API_KEY` only (do not set `USE_LEGACY_LOCAL_EXTRACT` or `LOCAL_EXTRACT_URL`).  
4. `vercel.json` sets API `maxDuration: 300`.

## Project layout

- `app/page.tsx` — UI orchestration  
- `app/api/*/route.ts` — pipeline endpoints  
- `lib/extract.ts`, `lib/hf-qwen.ts`, `lib/local-extract.ts`, `lib/groq.ts`, `lib/matching.ts`  
- `lib/eval/*` — per-stage evaluation  
- `ml/` — Colab train + local serve  
- `components/*` — Upload, ProgressStepper, QuestionList, AnswerSheetViewer, GradingSummary  
