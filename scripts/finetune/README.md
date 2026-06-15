# Fine-tune harness — self-learning LoRA pipeline

Turns the thumbs-up feedback you give in the chat UI into a LoRA adapter that
Ollama can layer on top of any base model. The result: a personal version of
the model that biases toward your tone, vocabulary, and the answers you
already approved.

## End-to-end flow

```
   chat UI                  backend                    this directory
┌──────────────┐    POST   ┌────────────────────┐    JSONL     ┌──────────────┐
│ 👍 on a reply│──────────▶│ message_feedback   │──────────────▶│ train_lora.py │
└──────────────┘           │ rating=1 + edits   │              └──────┬────────┘
                           └────────────────────┘                     │ LoRA adapter
                                                                      ▼
                           ┌─────────────────────────────┐    GGUF  ┌──────────────┐
                           │ build-modelfile.js          │◀─────────│ convert step │
                           │ (FROM base + ADAPTER + SYS) │          └──────────────┘
                           └──────────────┬──────────────┘
                                          │
                                          ▼
                                  ┌────────────────┐
                                  │ ollama create  │
                                  │ vanaila-x:vN   │
                                  └────────────────┘
                                          │
                            shows up in VanailaChat model picker
```

## Prerequisites

- Linux or WSL2 (Unsloth-supported)
- NVIDIA GPU with ≥12 GB VRAM for 7-8B base models; ≥6 GB works for 3B
- Python 3.10+
- `ollama` CLI installed and accessible on PATH

Recommended Python deps:

```bash
pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
pip install --no-deps trl peft accelerate bitsandbytes
pip install datasets transformers
```

## Step 1 — Collect feedback

Use VanailaChat as normal. Click 👍 on assistant answers you like. Edit-and-thumbs-up
when you want the *corrected* version trained on instead of the original.

Rule of thumb: 200 positive pairs ≈ noticeable adaptation; 1000+ ≈ noticeable
domain specialization. Below 50 pairs is usually too little signal.

## Step 2 — Export the dataset

From inside the running app (Settings → Training tab → Export) or via curl:

```bash
curl -X POST http://localhost:<backend-port>/api/training/export \
     -H 'content-type: application/json' \
     -d '{"format":"sharegpt"}'
```

Writes to `data/training/train-sharegpt-<timestamp>.jsonl`.

## Step 3 — Train the LoRA

```bash
cd scripts/finetune
python train_lora.py \
    --base unsloth/Llama-3.2-3B-Instruct \
    --data ../../data/training/train-sharegpt-2026-06-15T10-00-00-000Z.jsonl \
    --out  ../../data/adapters/v1 \
    --epochs 3
```

3B model + 500 pairs + RTX 3090 ≈ 15-25 minutes. Bigger models scale linearly
with parameter count and dataset size.

## Step 4 — Convert adapter to GGUF

```bash
# Option A — unsloth's helper (preferred):
python - <<'PY'
from unsloth import FastLanguageModel
model, tok = FastLanguageModel.from_pretrained("../../data/adapters/v1")
model.save_pretrained_gguf("../../data/adapters/v1.gguf", tok, quantization_method="q4_k_m")
PY

# Option B — llama.cpp's converter (if you have it built):
python ~/llama.cpp/convert-lora-to-ggml.py ../../data/adapters/v1
```

## Step 5 — Generate a Modelfile

```bash
node build-modelfile.js \
    --base llama3.2:3b \
    --adapter ../../data/adapters/v1.gguf \
    --out  ../../data/adapters/v1.Modelfile \
    --tag  vanaila-llama:v1 \
    --system "You are a helpful local assistant. Match the user's tone."
```

## Step 6 — Register with Ollama

```bash
ollama create vanaila-llama:v1 -f ../../data/adapters/v1.Modelfile
ollama list   # confirm the tag appears
```

Restart VanailaChat (or refresh the model picker). `vanaila-llama:v1` is now
a selectable model and behaves like any other Ollama tag — same chat UI, same
tool use, same streaming.

## Iterating

Treat this as a weekly or per-feature cycle:

1. Use the app for a week, accumulating thumbs-ups.
2. Re-export, re-train as `v2`, register as `vanaila-llama:v2`.
3. A/B against `v1` for a few days.
4. If `v2` wins, keep it; otherwise revert.

Keep at least the last 3 adapter versions on disk so a regression can be
rolled back with a single `ollama run` swap.

## Tradeoffs / honest caveats

- **Catastrophic forgetting**: small datasets + many epochs erode the base
  model's general competence. Mix in ~10% public instruction data (e.g.
  ShareGPT subset) if you see this — pass it as a separate JSONL via
  `--data` concatenated upstream.
- **Prompt-injection poisoning**: if you ever thumbs-up an answer that was
  manipulated through prompt injection, that pattern enters training. The
  thumbs-up gate is your last line of defense — don't rate without reading.
- **Compute**: this needs a real GPU. CPU LoRA is technically possible
  through llama.cpp but takes 20-50× longer; impractical past 3B.
- **Quality eval**: there is no automatic A/B harness yet. Use the app
  side-by-side and trust your own judgment for now.

## Files in this directory

- `build-modelfile.js` — writes the Ollama Modelfile pointing at your GGUF
- `train_lora.py` — Unsloth-based LoRA trainer
- `README.md` — this file
