# Local extract model (Qwen2.5-VL-3B + LoRA)

Train in Colab, serve locally, point the Next.js app at `LOCAL_EXTRACT_URL`.

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

# Serve
python serve_extract.py
# → http://127.0.0.1:8001/extract
```

Or open [`notebooks/finetune_extract.ipynb`](notebooks/finetune_extract.ipynb) in Colab.

## Next.js

```env
LOCAL_EXTRACT_URL=http://127.0.0.1:8001
```

Leave unset on Vercel (uses HF Scout for the live URL).
