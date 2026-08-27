"""
Model-level extract metrics: CER/WER, label F1, bbox IoU, JSON parse rate.

Usage:
  python -m ml.evaluate --predictions ml/artifacts/preds.json --gold ml/fixtures/expected-labels.json
  python -m ml.evaluate --demo   # writes placeholder metrics.json for CI without GPU
"""

from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent
ARTIFACTS = ROOT / "artifacts"
FIXTURES = ROOT / "fixtures"


def normalize_label(raw: str | None) -> str | None:
    if not raw:
        return None
    cleaned = re.sub(r"^q(uestion)?\.?\s*", "", str(raw), flags=re.I)
    cleaned = re.sub(r"[^a-z0-9]", "", cleaned.lower())
    return cleaned or None


def cer(ref: str, hyp: str) -> float:
    try:
        from jiwer import cer as _cer

        return float(_cer(ref, hyp))
    except Exception:
        # simple Levenshtein ratio fallback
        if not ref and not hyp:
            return 0.0
        if not ref:
            return 1.0
        import difflib

        return 1.0 - difflib.SequenceMatcher(None, ref, hyp).ratio()


def wer(ref: str, hyp: str) -> float:
    try:
        from jiwer import wer as _wer

        return float(_wer(ref, hyp))
    except Exception:
        rw, hw = ref.split(), hyp.split()
        if not rw and not hw:
            return 0.0
        if not rw:
            return 1.0
        import difflib

        return 1.0 - difflib.SequenceMatcher(None, rw, hw).ratio()


def label_f1(pred: list[str], gold: list[str]) -> dict[str, float]:
    ps = {normalize_label(x) for x in pred if normalize_label(x)}
    gs = {normalize_label(x) for x in gold if normalize_label(x)}
    if not ps and not gs:
        return {"precision": 1.0, "recall": 1.0, "f1": 1.0}
    inter = len(ps & gs)
    precision = inter / len(ps) if ps else 0.0
    recall = inter / len(gs) if gs else 0.0
    f1 = (2 * precision * recall / (precision + recall)) if (precision + recall) else 0.0
    return {"precision": precision, "recall": recall, "f1": f1}


def bbox_iou(a: list[float], b: list[float]) -> float:
    """a,b = [x,y,w,h] normalized."""
    if len(a) < 4 or len(b) < 4:
        return 0.0
    ax1, ay1, ax2, ay2 = a[0], a[1], a[0] + a[2], a[1] + a[3]
    bx1, by1, bx2, by2 = b[0], b[1], b[0] + b[2], b[1] + b[3]
    ix1, iy1 = max(ax1, bx1), max(ay1, by1)
    ix2, iy2 = min(ax2, bx2), min(ay2, by2)
    iw, ih = max(0.0, ix2 - ix1), max(0.0, iy2 - iy1)
    inter = iw * ih
    union = max(0.0, ax2 - ax1) * max(0.0, ay2 - ay1) + max(0.0, bx2 - bx1) * max(
        0.0, by2 - by1
    ) - inter
    return inter / union if union > 0 else 0.0


def evaluate_predictions(preds: list[dict[str, Any]], gold_labels: dict[str, Any]) -> dict:
    q_pred = [b.get("labelWritten") or b.get("labelNumber") or "" for b in preds if b.get("role") == "question"]
    a_pred = [b.get("labelWritten") or b.get("labelNumber") or "" for b in preds if b.get("role") != "question"]
    # If role missing, treat all as answers for model OCR eval
    if not q_pred and not a_pred:
        a_pred = [b.get("labelWritten") or b.get("labelNumber") or "" for b in preds]

    q_f1 = label_f1(q_pred, gold_labels.get("questions", []))
    a_f1 = label_f1(a_pred, gold_labels.get("answers", []))

    texts_ref = [str(b.get("gold_text") or "") for b in preds if b.get("gold_text")]
    texts_hyp = [str(b.get("text") or "") for b in preds if b.get("gold_text")]
    cers = [cer(r, h) for r, h in zip(texts_ref, texts_hyp)] if texts_ref else []
    wers = [wer(r, h) for r, h in zip(texts_ref, texts_hyp)] if texts_ref else []

    ious = []
    for b in preds:
        if b.get("bbox") and b.get("gold_bbox"):
            ious.append(bbox_iou(b["bbox"], b["gold_bbox"]))

    parse_ok = sum(1 for b in preds if isinstance(b.get("text"), str))
    parse_rate = parse_ok / len(preds) if preds else 0.0

    return {
        "n_pred_blocks": len(preds),
        "json_parse_rate": round(parse_rate, 4),
        "question_label": {k: round(v, 4) for k, v in q_f1.items()},
        "answer_label": {k: round(v, 4) for k, v in a_f1.items()},
        "cer_mean": round(sum(cers) / len(cers), 4) if cers else None,
        "wer_mean": round(sum(wers) / len(wers), 4) if wers else None,
        "bbox_iou_mean": round(sum(ious) / len(ious), 4) if ious else None,
    }


def demo_metrics() -> dict:
    gold = json.loads((FIXTURES / "expected-labels.json").read_text(encoding="utf-8"))
    # Simulate a partial extract like the live baseline
    fake_preds = [
        {"role": "question", "labelWritten": lab, "text": f"Q {lab}"}
        for lab in gold["questions"]
    ] + [
        {"role": "answer", "labelWritten": lab, "text": f"Ans {lab}", "gold_text": f"Ans {lab}"}
        for lab in ["1(a)", "3(a)", "3(b)", "7", "9", "9(b)", "10(a)", "10(b)", "11"]
    ]
    return evaluate_predictions(fake_preds, gold)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--predictions", type=Path, default=None)
    parser.add_argument("--gold", type=Path, default=FIXTURES / "expected-labels.json")
    parser.add_argument("--out", type=Path, default=ARTIFACTS / "metrics.json")
    parser.add_argument("--demo", action="store_true")
    args = parser.parse_args()

    ARTIFACTS.mkdir(parents=True, exist_ok=True)
    gold = json.loads(args.gold.read_text(encoding="utf-8"))

    if args.demo or not args.predictions:
        metrics = demo_metrics()
        metrics["mode"] = "demo"
    else:
        preds = json.loads(args.predictions.read_text(encoding="utf-8"))
        if isinstance(preds, dict):
            preds = preds.get("blocks") or preds.get("predictions") or []
        metrics = evaluate_predictions(preds, gold)
        metrics["mode"] = "predictions"

    args.out.write_text(json.dumps(metrics, indent=2), encoding="utf-8")
    print(json.dumps(metrics, indent=2))
    print(f"Wrote {args.out}")


if __name__ == "__main__":
    main()
