"""
Build supervised (image → JSON blocks) samples for extract fine-tuning.

Sources:
  - JunaidMB/handwriting-ocr-images-dataset (handwriting crops → text JSON)
  - Optional fixture page images + gold labels under ml/fixtures/
  - Light augmentation (contrast / rotate / noise)

Usage:
  python -m ml.preprocess --out ml/artifacts/dataset
"""

from __future__ import annotations

import argparse
import json
import random
from pathlib import Path

try:
    from prompt import EXTRACT_PROMPT, ROLE_HINT
except ImportError:  # python -m ml.preprocess
    from ml.prompt import EXTRACT_PROMPT, ROLE_HINT

try:
    from datasets import Dataset, load_dataset
    from PIL import Image, ImageEnhance, ImageFilter
except ImportError as e:  # pragma: no cover
    raise SystemExit(
        "Install ml deps first: pip install -r ml/requirements.txt\n" + str(e)
    ) from e


ROOT = Path(__file__).resolve().parent
ARTIFACTS = ROOT / "artifacts"
FIXTURES = ROOT / "fixtures"


def _augment(img: Image.Image, rng: random.Random) -> Image.Image:
    out = img.convert("RGB")
    if rng.random() < 0.5:
        out = ImageEnhance.Contrast(out).enhance(rng.uniform(0.75, 1.35))
    if rng.random() < 0.4:
        out = ImageEnhance.Brightness(out).enhance(rng.uniform(0.85, 1.15))
    if rng.random() < 0.35:
        out = out.rotate(rng.uniform(-3.5, 3.5), expand=True, fillcolor=(255, 255, 255))
    if rng.random() < 0.25:
        out = out.filter(ImageFilter.GaussianBlur(radius=rng.uniform(0.2, 0.8)))
    return out


def _handwriting_row(image: Image.Image, text: str, idx: int, role: str = "answer") -> dict:
    label = f"Q{idx % 12 + 1}"
    blocks = [
        {
            "text": text.strip(),
            "labelWritten": label,
            "labelNumber": str(idx % 12 + 1),
            "bbox": [0.05, 0.05, 0.9, 0.9],
            "contentKind": "text",
            "mathLatex": "",
            "diagramDescription": "",
            "isStrikethrough": False,
        }
    ]
    assistant = json.dumps(blocks, ensure_ascii=False)
    user = f"{EXTRACT_PROMPT}\n\n{ROLE_HINT[role]}\nPage index: 0"
    return {
        "image": image.convert("RGB"),
        "role": role,
        "user_text": user,
        "assistant_text": assistant,
        "source": "handwriting-ocr",
    }


def load_handwriting(max_samples: int = 120, seed: int = 42) -> list[dict]:
    rng = random.Random(seed)
    try:
        ds = load_dataset("JunaidMB/handwriting-ocr-images-dataset", split="train")
    except Exception as err:  # pragma: no cover
        print(f"Warning: could not load handwriting dataset ({err}); using empty set")
        return []

    rows: list[dict] = []
    for i, ex in enumerate(ds):
        if len(rows) >= max_samples:
            break
        img = ex.get("image")
        text = (ex.get("text") or ex.get("label") or "").strip()
        if img is None or not text:
            continue
        if not isinstance(img, Image.Image):
            img = Image.open(img).convert("RGB")
        rows.append(_handwriting_row(img, text, i))
        if rng.random() < 0.6:
            rows.append(_handwriting_row(_augment(img, rng), text, i))
    return rows


def load_fixture_json_samples() -> list[dict]:
    """Synthetic text-only rows from expected-labels (no page images required)."""
    labels_path = FIXTURES / "expected-labels.json"
    if not labels_path.exists():
        return []
    gold = json.loads(labels_path.read_text(encoding="utf-8"))
    rows: list[dict] = []
    # Placeholder white images so the VL trainer always has an image tensor
    blank = Image.new("RGB", (512, 640), (255, 255, 255))
    for role, key in (("question", "questions"), ("answer", "answers")):
        blocks = []
        for i, lab in enumerate(gold.get(key, [])):
            blocks.append(
                {
                    "text": f"Sample content for {lab}",
                    "labelWritten": lab,
                    "labelNumber": lab,
                    "bbox": [0.08, 0.08 + i * 0.05, 0.84, 0.04],
                    "contentKind": "text",
                    "mathLatex": "",
                    "diagramDescription": "",
                    "isStrikethrough": False,
                }
            )
        user = f"{EXTRACT_PROMPT}\n\n{ROLE_HINT[role]}\nPage index: 0"
        rows.append(
            {
                "image": blank.copy(),
                "role": role,
                "user_text": user,
                "assistant_text": json.dumps(blocks, ensure_ascii=False),
                "source": "fixture-synthetic",
            }
        )
    return rows


def build_dataset(max_handwriting: int = 120, seed: int = 42) -> Dataset:
    rows = load_handwriting(max_handwriting, seed) + load_fixture_json_samples()
    if not rows:
        raise RuntimeError("No training rows built — check network / fixtures")
    return Dataset.from_list(rows)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "dataset")
    parser.add_argument("--max-handwriting", type=int, default=120)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    args.out.mkdir(parents=True, exist_ok=True)
    ds = build_dataset(args.max_handwriting, args.seed)
    # Save without PIL objects for portability: write parquet via datasets
    ds.save_to_disk(str(args.out))
    meta = {
        "n": len(ds),
        "sources": sorted({r["source"] for r in ds}),
        "roles": sorted({r["role"] for r in ds}),
    }
    (args.out / "meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"Wrote {len(ds)} samples → {args.out}")
    print(json.dumps(meta, indent=2))


if __name__ == "__main__":
    main()
