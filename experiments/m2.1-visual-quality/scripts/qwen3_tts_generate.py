import argparse
import json
import os
from pathlib import Path

os.environ.setdefault("HF_HUB_OFFLINE", "1")
os.environ.setdefault("TRANSFORMERS_OFFLINE", "1")

import soundfile as sf
import torch
from qwen_tts import Qwen3TTSModel


def install_xpu_memory_query_compatibility(device_index: int = 0) -> None:
    """Work around Intel XPU runtimes that expose total_memory but not mem_get_info."""
    if not torch.xpu.is_available():
        return
    try:
        torch.xpu.mem_get_info(device_index)
        return
    except RuntimeError as error:
        if "doesn't support querying the available free memory" not in str(error):
            raise
    total = int(torch.xpu.get_device_properties(device_index).total_memory)

    def compatible_mem_get_info(index: int = device_index):
        allocated = int(torch.xpu.memory_allocated(index))
        return max(0, total - allocated), total

    torch.xpu.mem_get_info = compatible_mem_get_info


def main() -> None:
    parser = argparse.ArgumentParser(description="Offline batch Qwen3-TTS CustomVoice generation")
    parser.add_argument("--model", required=True)
    parser.add_argument("--manifest", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--device", default="xpu:0")
    parser.add_argument("--instruct", default="温暖自然的儿童寓言旁白，吐字清晰，节奏舒缓但不拖沓。")
    parser.add_argument("--attention", default="sdpa")
    parser.add_argument("--seed", type=int, default=20260813)
    args = parser.parse_args()

    model_path = Path(args.model).resolve()
    if not (model_path / "config.json").is_file() or not (model_path / "model.safetensors").is_file():
        raise FileNotFoundError(f"Incomplete local Qwen3-TTS model snapshot: {model_path}")
    manifest = json.loads(Path(args.manifest).read_text(encoding="utf-8"))
    requests = manifest.get("requests") if isinstance(manifest, dict) else None
    if not isinstance(requests, list) or not requests:
        raise ValueError("Qwen3-TTS request manifest must contain a non-empty requests array")
    if args.device.startswith("xpu") and not torch.xpu.is_available():
        raise RuntimeError("Qwen3-TTS requested Intel XPU but torch.xpu is unavailable")
    if args.device.startswith("xpu"):
        install_xpu_memory_query_compatibility(int(args.device.split(":", 1)[1] if ":" in args.device else 0))

    torch.manual_seed(args.seed)
    if torch.xpu.is_available():
        torch.xpu.manual_seed_all(args.seed)
    dtype = torch.bfloat16 if args.device != "cpu" else torch.float32
    model = Qwen3TTSModel.from_pretrained(
        str(model_path),
        device_map=args.device,
        dtype=dtype,
        attn_implementation=args.attention,
        local_files_only=True,
    )
    texts = [item["text"] for item in requests]
    wavs, sample_rate = model.generate_custom_voice(
        text=texts,
        language=[item.get("language", "Chinese") for item in requests],
        speaker=[item["speaker"] for item in requests],
        instruct=[args.instruct] * len(requests),
        do_sample=True,
        top_k=50,
        top_p=0.8,
        temperature=0.9,
    )
    output_dir = Path(args.output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    outputs = []
    for item, wav in zip(requests, wavs, strict=True):
        filename = item["filename"]
        path = output_dir / filename
        sf.write(path, wav, sample_rate, subtype="PCM_16")
        outputs.append({"id": item["id"], "path": str(path), "sampleRate": sample_rate})
    print(json.dumps({"provider": "qwen3-tts-local", "speakers": sorted({item["speaker"] for item in requests}), "device": args.device, "outputs": outputs}, ensure_ascii=False))


if __name__ == "__main__":
    main()
