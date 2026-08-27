"""
LoRA fine-tune Qwen2.5-VL-3B-Instruct for exam extract JSON.

Designed for Colab / local GPU. Exports adapter to ml/artifacts/adapter.

Usage:
  python -m ml.train --dataset ml/artifacts/dataset --out ml/artifacts/adapter --epochs 1
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent
DEFAULT_MODEL = "Qwen/Qwen2.5-VL-3B-Instruct"


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--model", default=DEFAULT_MODEL)
    parser.add_argument("--dataset", type=Path, default=ROOT / "artifacts" / "dataset")
    parser.add_argument("--out", type=Path, default=ROOT / "artifacts" / "adapter")
    parser.add_argument("--epochs", type=float, default=1.0)
    parser.add_argument("--batch-size", type=int, default=1)
    parser.add_argument("--lr", type=float, default=1e-4)
    parser.add_argument("--max-steps", type=int, default=80)
    parser.add_argument("--lora-r", type=int, default=8)
    args = parser.parse_args()

    try:
        import torch
        from datasets import load_from_disk
        from peft import LoraConfig, get_peft_model
        from transformers import (
            AutoProcessor,
            Qwen2_5_VLForConditionalGeneration,
            Trainer,
            TrainingArguments,
        )
    except ImportError as e:  # pragma: no cover
        raise SystemExit(
            "Install ml deps: pip install -r ml/requirements.txt\n" + str(e)
        ) from e

    if not args.dataset.exists():
        raise SystemExit(f"Dataset missing at {args.dataset}. Run: python -m ml.preprocess")

    print(f"Loading base model {args.model}…")
    processor = AutoProcessor.from_pretrained(args.model, trust_remote_code=True)
    model = Qwen2_5_VLForConditionalGeneration.from_pretrained(
        args.model,
        torch_dtype=torch.bfloat16 if torch.cuda.is_available() else torch.float32,
        device_map="auto",
        trust_remote_code=True,
    )

    lora = LoraConfig(
        r=args.lora_r,
        lora_alpha=16,
        lora_dropout=0.05,
        bias="none",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"],
        task_type="CAUSAL_LM",
    )
    model = get_peft_model(model, lora)
    model.print_trainable_parameters()

    raw = load_from_disk(str(args.dataset))

    def collate(batch: list[dict]):
        # Minimal collator: text-only fallback if image encoding fails in CPU CI
        texts = []
        images = []
        for ex in batch:
            texts.append(
                [
                    {
                        "role": "user",
                        "content": [
                            {"type": "image"},
                            {"type": "text", "text": ex["user_text"]},
                        ],
                    },
                    {"role": "assistant", "content": [{"type": "text", "text": ex["assistant_text"]}]},
                ]
            )
            images.append(ex["image"])

        prompts = [
            processor.apply_chat_template(t, tokenize=False, add_generation_prompt=False)
            for t in texts
        ]
        inputs = processor(
            text=prompts,
            images=images,
            return_tensors="pt",
            padding=True,
        )
        inputs["labels"] = inputs["input_ids"].clone()
        return inputs

    args.out.mkdir(parents=True, exist_ok=True)
    training_args = TrainingArguments(
        output_dir=str(args.out / "checkpoints"),
        per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=4,
        learning_rate=args.lr,
        num_train_epochs=args.epochs,
        max_steps=args.max_steps,
        logging_steps=5,
        save_steps=50,
        bf16=torch.cuda.is_available(),
        remove_unused_columns=False,
        report_to=[],
    )

    trainer = Trainer(
        model=model,
        args=training_args,
        train_dataset=raw,
        data_collator=collate,
    )
    trainer.train()

    model.save_pretrained(str(args.out))
    processor.save_pretrained(str(args.out))
    meta = {
        "base_model": args.model,
        "lora_r": args.lora_r,
        "max_steps": args.max_steps,
        "dataset": str(args.dataset),
    }
    (args.out / "train_meta.json").write_text(json.dumps(meta, indent=2), encoding="utf-8")
    print(f"Saved adapter → {args.out}")


if __name__ == "__main__":
    main()
