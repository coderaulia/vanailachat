"""
LoRA fine-tune runner for VanailaChat's exported sharegpt JSONL.

Pipeline:
  1. VanailaChat exports data/training/train-sharegpt-*.jsonl via the UI.
  2. Run this script (Python env with GPU + unsloth installed).
  3. Convert the resulting LoRA adapter to GGUF.
  4. node scripts/finetune/build-modelfile.js to wire it into Ollama.
  5. ollama create vanaila-<model>:v<N> -f <Modelfile>.

Requirements:
  pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
  pip install --no-deps trl peft accelerate bitsandbytes

This script is a starting point — tune lr/epochs/batch_size for your
dataset size and hardware. Default LoRA rank=16 is a sensible middle.

Usage:
  python train_lora.py \
      --base unsloth/Llama-3.2-3B-Instruct \
      --data ../../data/training/train-sharegpt-<stamp>.jsonl \
      --out  ../../data/adapters/v1 \
      [--epochs 3] [--rank 16] [--max-seq 4096]

After it finishes, convert the adapter to GGUF:
  python -m llama_cpp.convert_lora_to_gguf \
      --input  ../../data/adapters/v1 \
      --output ../../data/adapters/v1.gguf
(or use unsloth's built-in save_pretrained_gguf — see docs.)
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def load_dataset(path: Path):
    """Load a sharegpt JSONL file into a HuggingFace dataset.

    Falls back to alpaca format if the JSONL has 'instruction' keys.
    """
    rows = []
    with path.open("r", encoding="utf-8") as fh:
        for line_no, raw in enumerate(fh, start=1):
            raw = raw.strip()
            if not raw:
                continue
            try:
                obj = json.loads(raw)
            except json.JSONDecodeError as exc:
                print(f"warning: line {line_no}: {exc}", file=sys.stderr)
                continue
            if "messages" in obj:
                # sharegpt
                rows.append({"messages": obj["messages"]})
            elif "instruction" in obj:
                # alpaca -> wrap as messages
                rows.append({
                    "messages": [
                        {"role": "user", "content": obj["instruction"]},
                        {"role": "assistant", "content": obj["output"]},
                    ]
                })
    if not rows:
        raise SystemExit(f"no usable rows in {path}")
    return rows


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--base", required=True, help="HF model id or local path")
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--out", required=True, type=Path)
    parser.add_argument("--epochs", type=int, default=3)
    parser.add_argument("--rank", type=int, default=16)
    parser.add_argument("--max-seq", type=int, default=4096)
    parser.add_argument("--lr", type=float, default=2e-4)
    parser.add_argument("--batch", type=int, default=2)
    parser.add_argument(
        "--mix-file",
        type=Path,
        default=None,
        help="Secondary JSONL (e.g. public instruction data) blended in as a "
             "catastrophic-forgetting guard. Sampled at --mix-ratio of the combined output.",
    )
    parser.add_argument(
        "--mix-ratio",
        type=float,
        default=0.1,
        help="Fraction of the final dataset to fill from --mix-file (0–1, default 0.1 = 10%%). "
             "A 10%% blend of public data prevents the model from forgetting general skills.",
    )
    args = parser.parse_args()

    rows = load_dataset(args.data)
    print(f"loaded {len(rows)} training pairs from {args.data}")

    if args.mix_file is not None:
        import random
        if not args.mix_file.exists():
            raise SystemExit(f"--mix-file not found: {args.mix_file}")
        mix_ratio = max(0.0, min(0.9, args.mix_ratio))
        mix_all = load_dataset(args.mix_file)
        # Sample enough mix rows to make up mix_ratio of the combined dataset
        n_mix_target = int(round(len(rows) * mix_ratio / max(1.0 - mix_ratio, 1e-9)))
        mix_rows = random.sample(mix_all, min(n_mix_target, len(mix_all)))
        combined = rows + mix_rows
        random.shuffle(combined)
        rows = combined
        print(
            f"blended {len(mix_rows)} mix rows ({mix_ratio:.0%} target) from {args.mix_file}"
            f" → {len(rows)} total pairs"
        )

    # Imports here so --help works without unsloth installed.
    from unsloth import FastLanguageModel  # type: ignore
    from datasets import Dataset  # type: ignore
    from trl import SFTTrainer  # type: ignore
    from transformers import TrainingArguments  # type: ignore

    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=args.base,
        max_seq_length=args.max_seq,
        load_in_4bit=True,
    )

    model = FastLanguageModel.get_peft_model(
        model,
        r=args.rank,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        lora_alpha=args.rank * 2,
        lora_dropout=0.0,
        bias="none",
        use_gradient_checkpointing="unsloth",
    )

    def format_messages(example):
        rendered = tokenizer.apply_chat_template(
            example["messages"],
            tokenize=False,
            add_generation_prompt=False,
        )
        return {"text": rendered}

    dataset = Dataset.from_list(rows).map(format_messages)

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=args.max_seq,
        args=TrainingArguments(
            output_dir=str(args.out),
            num_train_epochs=args.epochs,
            per_device_train_batch_size=args.batch,
            gradient_accumulation_steps=4,
            learning_rate=args.lr,
            logging_steps=10,
            save_strategy="epoch",
            optim="adamw_8bit",
            warmup_ratio=0.03,
            lr_scheduler_type="linear",
            bf16=True,
            report_to="none",
        ),
    )

    trainer.train()

    args.out.mkdir(parents=True, exist_ok=True)
    model.save_pretrained(str(args.out))
    tokenizer.save_pretrained(str(args.out))

    print(f"\nadapter saved to {args.out}")
    print("next: convert to GGUF and feed to scripts/finetune/build-modelfile.js")


if __name__ == "__main__":
    main()
