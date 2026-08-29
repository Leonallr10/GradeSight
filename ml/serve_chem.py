"""
Local FastAPI ChemVLM specialist — refines mathLatex + diagramDescription on cropped blocks.

POST /enrich  body: {
  "blocks": [{ id, pageIndex, bbox?, contentKind?, mathLatex?, diagramDescription?, text? }],
  "pages": [{ pageIndex, imageBase64, mimeType? }]
}
Response: { "blocks": [{ id, mathLatex?, diagramDescription?, contentKind? }], "via": "chem-vlm" }

Run:
  uvicorn ml.serve_chem:app --host 127.0.0.1 --port 8002
  # or: python -m ml.serve_chem
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
from typing import Any, Literal, Optional

from fastapi import FastAPI, HTTPException
from pydantic import BaseModel, Field

DEFAULT_MODEL = os.environ.get("CHEM_VLM_MODEL", "AI4Chem/ChemVLM-8B")
CROP_PAD = float(os.environ.get("CHEM_VLM_CROP_PAD", "0.03"))

CHEM_ENRICH_PROMPT = """You are a chemistry vision expert analyzing a cropped region from a student exam sheet.

The crop may contain a hand-drawn chemical structure, equation, reaction scheme, periodic-table entry, or electrochemical cell diagram.

Return ONLY valid JSON (no markdown fences):
{
  "mathLatex": "ASCII-safe LaTeX for chemical formulae and balanced equations, or null",
  "diagramDescription": "Detailed description of structures, apparatus, labels, arrows, and annotations, or null",
  "contentKind": "formula" | "diagram" | "mixed" | "text"
}

Rules:
- Preserve IUPAC names, element symbols, subscripts, and state symbols when visible.
- For molecular structures describe bonds, functional groups, and atom labels.
- For apparatus (dry cell, electrolysis) name every labeled part.
- Use null for fields with no relevant content in the crop.
"""

app = FastAPI(title="GradeSight ChemVLM enrich", version="0.1.0")

_pipe = None


class BBoxIn(BaseModel):
    x: float = Field(ge=0, le=1)
    y: float = Field(ge=0, le=1)
    w: float = Field(gt=0, le=1)
    h: float = Field(gt=0, le=1)


class BlockIn(BaseModel):
    id: str
    pageIndex: int = Field(ge=0)
    bbox: Optional[BBoxIn] = None
    contentKind: Optional[str] = None
    mathLatex: Optional[str] = None
    diagramDescription: Optional[str] = None
    text: Optional[str] = None


class PageIn(BaseModel):
    pageIndex: int = Field(ge=0)
    imageBase64: str
    mimeType: Optional[str] = None


class EnrichIn(BaseModel):
    blocks: list[BlockIn]
    pages: list[PageIn]


def _strip_data_url(s: str) -> tuple[str, bytes]:
    m = re.match(r"^data:(image/[a-zA-Z0-9.+-]+);base64,(.+)$", s)
    if m:
        return m.group(1), base64.b64decode(m.group(2))
    raw = re.sub(r"^data:[^;]+;base64,", "", s)
    return "image/png", base64.b64decode(raw)


def _load_pipe():
    global _pipe
    if _pipe is not None:
        return _pipe
    try:
        from transformers import pipeline
    except ImportError as e:
        raise RuntimeError("Missing deps. pip install -r ml/requirements.txt") from e

    print(f"Loading ChemVLM model {DEFAULT_MODEL}…")
    _pipe = pipeline(
        "image-text-to-text",
        model=DEFAULT_MODEL,
        trust_remote_code=True,
    )
    return _pipe


def _extract_json_object(raw: str) -> dict:
    text = raw.strip()
    fence = re.search(r"```(?:json)?\s*([\s\S]*?)```", text)
    if fence:
        text = fence.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start < 0 or end < 0:
        return {}
    try:
        data = json.loads(text[start : end + 1])
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        return {}


def _coerce_content_kind(raw: Any) -> Optional[str]:
    if not isinstance(raw, str):
        return None
    k = raw.strip().lower()
    if k in ("formula", "diagram", "mixed", "text"):
        return k
    return None


def _crop_region(img, bbox: Optional[BBoxIn]):
    from PIL import Image

    if bbox is None:
        return img

    w, h = img.size
    x0 = max(0, int((bbox.x - CROP_PAD) * w))
    y0 = max(0, int((bbox.y - CROP_PAD) * h))
    x1 = min(w, int((bbox.x + bbox.w + CROP_PAD) * w))
    y1 = min(h, int((bbox.y + bbox.h + CROP_PAD) * h))
    if x1 <= x0 or y1 <= y0:
        return img
    return img.crop((x0, y0, x1, y1))


def _image_to_data_url(img) -> str:
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def _build_user_prompt(block: BlockIn) -> str:
    parts = [CHEM_ENRICH_PROMPT]
    if block.text:
        parts.append(f"\nExisting OCR text for context:\n{block.text[:400]}")
    if block.mathLatex:
        parts.append(f"\nExisting mathLatex (may be wrong):\n{block.mathLatex[:300]}")
    if block.diagramDescription:
        parts.append(
            f"\nExisting diagramDescription (may be incomplete):\n{block.diagramDescription[:500]}"
        )
    if block.contentKind:
        parts.append(f"\nPrior contentKind: {block.contentKind}")
    return "\n".join(parts)


def _run_chem_vlm(crop_img, block: BlockIn) -> dict:
    pipe = _load_pipe()
    data_url = _image_to_data_url(crop_img)
    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image", "url": data_url},
                {"type": "text", "text": _build_user_prompt(block)},
            ],
        }
    ]
    out = pipe(text=messages)
    raw = ""
    if isinstance(out, list) and out:
        item = out[0]
        if isinstance(item, dict):
            raw = str(item.get("generated_text") or item.get("text") or "")
        else:
            raw = str(item)
    elif isinstance(out, dict):
        raw = str(out.get("generated_text") or out.get("text") or out)
    else:
        raw = str(out)

    parsed = _extract_json_object(raw)
    result: dict[str, Any] = {"id": block.id}
    if isinstance(parsed.get("mathLatex"), str) and parsed["mathLatex"].strip():
        result["mathLatex"] = parsed["mathLatex"].strip()
    if isinstance(parsed.get("diagramDescription"), str) and parsed["diagramDescription"].strip():
        result["diagramDescription"] = parsed["diagramDescription"].strip()
    kind = _coerce_content_kind(parsed.get("contentKind"))
    if kind:
        result["contentKind"] = kind
    return result


@app.get("/")
def root():
    return {
        "ok": True,
        "service": "chem-vlm",
        "health": "/health",
        "enrich": "POST /enrich",
    }


@app.get("/health")
def health():
    return {"ok": True, "model": DEFAULT_MODEL}


@app.post("/enrich")
def enrich(body: EnrichIn):
    if not body.blocks:
        return {"blocks": [], "via": "chem-vlm"}
    if not body.pages:
        raise HTTPException(400, "pages required")

    try:
        from PIL import Image
    except ImportError as e:
        raise HTTPException(500, "Pillow not installed") from e

    page_images: dict[int, Any] = {}
    for page in body.pages:
        _, data = _strip_data_url(page.imageBase64)
        page_images[page.pageIndex] = Image.open(io.BytesIO(data)).convert("RGB")

    enriched: list[dict] = []
    try:
        for block in body.blocks:
            page_img = page_images.get(block.pageIndex)
            if page_img is None:
                continue
            crop = _crop_region(page_img, block.bbox)
            patch = _run_chem_vlm(crop, block)
            if len(patch) > 1:
                enriched.append(patch)
        return {"blocks": enriched, "via": "chem-vlm"}
    except Exception as e:
        raise HTTPException(500, str(e)) from e


def main():
    import uvicorn

    host = os.environ.get("CHEM_VLM_HOST", "127.0.0.1")
    port = int(os.environ.get("CHEM_VLM_PORT", "8002"))
    uvicorn.run("ml.serve_chem:app", host=host, port=port, reload=False)


if __name__ == "__main__":
    main()
