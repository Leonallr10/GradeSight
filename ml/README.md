# Legacy local extract (Qwen2.5-VL-3B + LoRA)

**Legacy / offline dev only.** Production and normal dev use HF Scout (`HF_TOKEN`).

Train in Colab, serve locally, and opt in from Next.js with `USE_LEGACY_LOCAL_EXTRACT=1`.

## Quick start

```bash
cd ml
pip install -r requirements.txt

# Build dataset
python preprocess.py --out artifacts/dataset

# Train (needs GPU)
python train.py --dataset artifacts/dataset --out artifacts/adapter --max-steps 80

# Model metrics
python evaluate.py --demo --out artifacts/metrics.json

# Serve (from repo root: npm run extract:local)
python serve_extract.py
# → http://127.0.0.1:8001/extract
```

Or open [`notebooks/finetune_extract.ipynb`](notebooks/finetune_extract.ipynb) in Colab.

## Next.js (legacy opt-in)

```env
USE_LEGACY_LOCAL_EXTRACT=1
LOCAL_EXTRACT_URL=http://127.0.0.1:8001
```

Leave both unset on Vercel and for normal HF-based dev.

## ChemVLM specialist (chemistry diagram/formula refinement)

After general VL extract, eligible chemistry blocks can be sent to ChemVLM for better `mathLatex` and `diagramDescription`.

**One terminal (recommended):**

```env
# .env.local
USE_CHEM_VLM=1
```

```bash
npm run dev
# Starts Next.js + ChemVLM together (GPU machine only)
```

**Separate ChemVLM only** (optional): `npm run chem:local`

**Vercel / production:** leave `USE_CHEM_VLM` unset. Deploy is unchanged (`next build` + `next start`); HF Scout handles extract.

```env
USE_CHEM_VLM=1
# CHEM_VLM_URL=http://127.0.0.1:8002
# CHEM_VLM_MODEL=AI4Chem/ChemVLM-8B
```

Flow: Scout/Qwen full-page extract → filter → ChemVLM bbox crop refine (local dev only).
