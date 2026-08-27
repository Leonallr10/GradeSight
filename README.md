# VedaAI Exam Mapping

Teacher-facing Next.js app: upload a question paper + handwritten answer sheet, extract with an **HF vision model**, match answers, grade with **Groq**, and highlight answer regions.

## Stack

| Layer | Choice |
|-------|--------|
| Framework | Next.js 16 (App Router) |
| Extraction | HF Inference VL (default `meta-llama/Llama-4-Scout-17B-16E-Instruct`; override via `HF_QWEN_MODEL`) |
| Matching | Label normalize + cosine (lexical embeddings) |
| Bbox repair (optional) | Same HF vision model as extract |
| Grading | Groq (`openai/gpt-oss-20b` by default; override via `GROQ_MODEL`) |
| PDF → images | `pdfjs-dist` (client-side) |

## Setup

```bash
pnpm install
cp .env.example .env.local
# fill HF_TOKEN and GROQ_API_KEY (required)
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000).

Get a Groq key at [console.groq.com](https://console.groq.com).

## Pipeline

1. **Upload** — PDF/images rasterized to per-page PNGs  
2. **`POST /api/extract`** — HF vision model text + bbox (questions and answers)  
3. **`POST /api/validate-bbox`** — validate boxes; optional HF localize  
4. **`POST /api/map-answers`** — exact label match, then lexical similarity  
5. **`POST /api/grade`** — Groq batch score/feedback + summary  
6. **UI** — click a question → highlight answer bbox  

### HF extract note

`Qwen/Qwen2.5-VL-7B-Instruct` often returns *“not supported by any provider you have enabled”* unless you enable a matching Inference Provider (e.g. Hyperbolic) in [HF settings](https://huggingface.co/settings/inference-providers). The default model is Llama 4 Scout, which works on typical HF free/pro provider sets. Point `HF_QWEN_MODEL` at Qwen once that provider is enabled.

## Why we did not fine-tune on the handwriting dataset

The [JunaidMB/handwriting-ocr-images-dataset](https://huggingface.co/datasets/JunaidMB/handwriting-ocr-images-dataset) is useful research data (~78 GCSE answer crops), but **fine-tuning a 7B VL model is out of scope** for this app:

- Only **62 train samples** — too small to fine-tune reliably  
- Needs **GPU training** (LoRA/PEFT), hours of compute, and a **hosted endpoint** afterward  
- Vercel serverless cannot load fine-tuned 7B weights  
- Dataset is **cropped answer regions + plain text**, not full exam pages with labels/bboxes  

**What we do instead:** call a public HF vision checkpoint with stronger prompts. You can later fine-tune offline and point `HF_QWEN_MODEL` at your adapter/endpoint if you host one.

## Deploy (manual — Vercel)

1. `pnpm build` locally to verify.  
2. Import the repo in the Vercel dashboard.  
3. Add env vars: `HF_TOKEN`, `GROQ_API_KEY`, optional `GROQ_MODEL` / `HF_QWEN_MODEL`.  
4. `vercel.json` sets API `maxDuration: 300`.

## Project layout

- `app/page.tsx` — UI orchestration  
- `app/api/*/route.ts` — pipeline endpoints  
- `lib/hf-qwen.ts`, `lib/groq.ts`, `lib/matching.ts`, `lib/pdf-rasterize.ts`  
- `components/*` — Upload, ProgressStepper, QuestionList, AnswerSheetViewer, GradingSummary  
