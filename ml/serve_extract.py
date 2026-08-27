"""
Local FastAPI extract server — loads Qwen2.5-VL-3B (+ optional LoRA adapter).

POST /extract  body: { "role": "question"|"answer", "pages": [{pageIndex, imageBase64, mimeType?}] }
Response: { "blocks": ExtractedBlock-like[] }

Run:
  uvicorn ml.serve_extract:app --host 127.0.0.1 --port 8001
  # or: python -m ml.serve_extract
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import uuid
from typing import Any, Literal, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

try:
    from prompt import EXTRACT_PROMPT, ROLE_HINT
except ImportError:
    from ml.prompt import EXTRACT_PROMPT, ROLE_HINT

ROOT = os.path.dirname(os.path.abspath(__file__))
DEFAULT_MODEL = os.environ.get("EXTRACT_BASE_MODEL", "Qwen/Qwen2.5-VL-3B-Instruct")
ADAPTER_PATH = os.environ.get("EXTRACT_ADAPTER_PATH", os.path.join(ROOT, "artifacts", "adapter"))

app = FastAPI(title="GradeSight local extract", version="0.1.0")

_model = None
_processor = None


class PageIn(BaseModel):
    pageIndex: int = Field(ge=0)
    imageBase64: str
    mimeType: Optional[str] = None


class ExtractIn(BaseModel):
    role: Literal["question", "answer"]
    pages: list[PageIn]


def _strip_data_url(s: str) -> tuple[str, bytes]:
    m = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", s)
    if m:
        return m.group(1), base64.b64decode(m.group(2))
    raw = re.sub(r"^data:[^;]+;base64,", "", s)
    return "image/png", base64.b64decode(raw)


def _load_model():
    global _model, _processor
    if _model is not None:
        return
    try:
        import torch
        from peft import PeftModel
        from transformers import AutoProcessor, Qwen2_5_VLForConditionalGeneration
    except ImportError as e:
        raise RuntimeError(
            "Missing deps. pip install -r ml/requirements.txt"
        ) from e

    print(f"Loading base model {DEFAULT_MODEL}…")
    _processor = AutoProcessor.from_pretrained(DEFAULT_MODEL, trust_remote_code=True)
    dtype = torch.bfloat16 if torch.cuda.is_available() else torch.float32
    base = Qwen2_5_VLForConditionalGeneration.from_pretrained(
        DEFAULT_MODEL,
        torch_dtype=dtype,
        device_map="auto",
        trust_remote_code=True,
    )
    if os.path.isdir(ADAPTER_PATH) and os.path.exists(
        os.path.join(ADAPTER_PATH, "adapter_config.json")
    ):
        print(f"Loading LoRA adapter from {ADAPTER_PATH}…")
        _model = PeftModel.from_pretrained(base, ADAPTER_PATH)
    else:
        print("No adapter found — using base weights")
        _model = base
    _model.eval()


def _extract_json_array(raw: str) -> list[dict]:
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    start = text.find("[")
    end = text.rfind("]")
    if start < 0 or end < 0:
        return []
    try:
        data = json.loads(text[start : end + 1])
        return data if isinstance(data, list) else []
    except json.JSONDecodeError:
        return []


def _coerce_bbox(raw: Any) -> Optional[dict]:
    if raw is None:
        return None
    if isinstance(raw, dict) and all(k in raw for k in ("x", "y", "w", "h")):
        return {
            "x": float(raw["x"]),
            "y": float(raw["y"]),
            "w": float(raw["w"]),
            "h": float(raw["h"]),
        }
    if isinstance(raw, (list, tuple)) and len(raw) >= 4:
        return {"x": float(raw[0]), "y": float(raw[1]), "w": float(raw[2]), "h": float(raw[3])}
    return None


def _to_blocks(items: list[dict], page_index: int, prefix: str) -> list[dict]:
    out = []
    for i, item in enumerate(items):
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text:
            continue
        bbox = _coerce_bbox(item.get("bbox"))
        out.append(
            {
                "id": f"{prefix}-p{page_index}-{i}-{uuid.uuid4().hex[:8]}",
                "pageIndex": page_index,
                "text": text,
                "labelNumber": item.get("labelNumber") or item.get("labelWritten"),
                "labelWritten": item.get("labelWritten") or item.get("labelNumber"),
                "bbox": bbox,
                "bboxSource": "qwen" if bbox else "none",
                "contentKind": item.get("contentKind") or "text",
                "mathLatex": item.get("mathLatex") or None,
                "diagramDescription": item.get("diagramDescription") or None,
                "isStrikethrough": bool(item.get("isStrikethrough")),
            }
        )
    return out


def _run_page(page: PageIn, role: str) -> list[dict]:
    from PIL import Image
    import torch

    _load_model()
    assert _model is not None and _processor is not None

    mime, data = _strip_data_url(page.imageBase64)
    img = Image.open(io.BytesIO(data)).convert("RGB")
    user_text = f"{EXTRACT_PROMPT}\n\n{ROLE_HINT[role]}\nPage index: {page.pageIndex}"
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image"},
                {"type": "text", "text": user_text},
            ],
        }
    ]
    prompt = _processor.apply_chat_template(
        messages, tokenize=False, add_generation_prompt=True
    )
    inputs = _processor(text=[prompt], images=[img], return_tensors="pt")
    inputs = {k: v.to(_model.device) if hasattr(v, "to") else v for k, v in inputs.items()}
    with torch.no_grad():
        out_ids = _model.generate(**inputs, max_new_tokens=2048, temperature=0.1, do_sample=False)
    trimmed = out_ids[:, inputs["input_ids"].shape[1] :]
    raw = _processor.batch_decode(trimmed, skip_special_tokens=True)[0]
    items = _extract_json_array(raw)
    prefix = "q" if role == "question" else "a"
    return _to_blocks(items, page.pageIndex, prefix)


@app.get("/health")
def health():
    return {
        "ok": True,
        "model": DEFAULT_MODEL,
        "adapter": ADAPTER_PATH if os.path.isdir(ADAPTER_PATH) else None,
    }


@app.post("/extract")
def extract(body: ExtractIn):
    if not body.pages:
        raise HTTPException(400, "pages required")
    try:
        blocks: list[dict] = []
        for page in body.pages:
            blocks.extend(_run_page(page, body.role))
        return {"blocks": blocks, "via": "local-qwen"}
    except Exception as e:
        raise HTTPException(500, str(e)) from e


def main():
    import uvicorn

    host = os.environ.get("EXTRACT_HOST", "127.0.0.1")
    port = int(os.environ.get("EXTRACT_PORT", "8001"))
    uvicorn.run("ml.serve_extract:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
