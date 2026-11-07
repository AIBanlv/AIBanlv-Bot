"""Prepare a local speech clip with the original LAM PyTorch checkpoint."""

import argparse
import ast
import hashlib
import json
import math
import os
from pathlib import Path
import sys
import time
import wave

RATE = 16000
FPS = 30
WINDOW = 34133


def read_pcm(path):
    with wave.open(str(path), "rb") as audio:
        if (audio.getnchannels(), audio.getsampwidth(), audio.getframerate()) != (1, 2, RATE):
            raise ValueError("Expected mono 16-bit 16 kHz PCM")
        if not 0 < audio.getnframes() <= RATE * 120:
            raise ValueError("Expected 0-120 seconds of audio")
        return audio.readframes(audio.getnframes())


def window_bounds(index):
    end = (index + 1) * RATE
    return end - WINDOW, end


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", type=Path, required=True)
    parser.add_argument("--assets", type=Path, required=True)
    parser.add_argument("--lines", type=Path)
    args = parser.parse_args()
    source, assets = args.source.resolve(), args.assets.resolve()
    checkpoint_path = source / "pretrained_models/LAM_audio2exp_streaming.tar"
    os.environ["HF_HUB_OFFLINE"] = "1"
    os.environ["TRANSFORMERS_OFFLINE"] = "1"
    import numpy as np
    import torch

    torch.set_num_threads(4)
    lines = json.loads((args.lines or Path(__file__).with_name("speech-lines.json")).read_text(encoding="utf-8"))
    pcm, captions = bytearray(), []
    for index, line in enumerate(lines):
        start = len(pcm) / (RATE * 2)
        pcm.extend(read_pcm(assets / f"phrase-{index}.wav"))
        end = len(pcm) / (RATE * 2)
        captions.append({"start": start, "end": end, "text": line["caption"]})
        pcm.extend(b"\0\0" * 4000)
    duration = len(pcm) / (RATE * 2)
    if duration > 120:
        raise ValueError("Demo clip exceeds 120 seconds")
    audio = torch.from_numpy(np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768)

    # Read the canonical order without importing unrelated SciPy postprocessors.
    tree = ast.parse((source / "models/utils.py").read_text(encoding="utf-8"))
    names = next(ast.literal_eval(node.value) for node in tree.body
                 if isinstance(node, ast.Assign) and any(
                     isinstance(target, ast.Name) and target.id == "ARKitBlendShape"
                     for target in node.targets))
    sys.path.insert(0, str(source))
    previous = Path.cwd()
    try:
        os.chdir(source)
        from utils.config import Config
        from models import build_model
        config = Config.fromfile("configs/lam_audio2exp_config_streaming.py")
        # The complete encoder is in the TAR. No second model download is needed.
        config.model["backbone"]["pretrained_encoder_path"] = ""
        model = build_model(config.model).eval()
    finally:
        os.chdir(previous)
    checkpoint = torch.load(checkpoint_path, map_location="cpu", weights_only=True)
    model.load_state_dict(checkpoint["state_dict"], strict=True)
    model.backbone.audio_encoder.config._attn_implementation = "eager"
    model.backbone.audio_encoder.config.output_attentions = False
    identity = torch.nn.functional.one_hot(torch.tensor([0]), 12)
    outputs = []
    started = time.perf_counter()
    with torch.inference_mode():
        for index in range(math.ceil(duration)):
            start, end = window_bounds(index)
            window = torch.zeros(WINDOW)
            first, last = max(0, start), min(len(audio), end)
            window[first - start:last - start] = audio[first:last]
            result = model({"input_audio_array": window.unsqueeze(0), "id_idx": identity})["pred_exp"]
            outputs.append(result[0, -FPS:].numpy())
    frames = np.concatenate(outputs)[:math.ceil(duration * FPS)]
    if frames.shape[1] != 52 or not np.isfinite(frames).all():
        raise ValueError("Invalid model output")
    audio_path = assets / "speech.wav"
    with wave.open(str(audio_path), "wb") as output:
        output.setparams((1, 2, RATE, 0, "NONE", "not compressed"))
        output.writeframes(pcm)
    provenance = {
        "engine": "pytorch-original-tar", "torch": torch.__version__,
        "checkpoint": checkpoint_path.name,
        "checkpointSha256": hashlib.sha256(checkpoint_path.read_bytes()).hexdigest(),
        "audioSha256": hashlib.sha256(audio_path.read_bytes()).hexdigest(),
        "voice": "eSpeak NG cmn (offline, silent retrieval)" if args.lines else "Microsoft David Desktop (offline)",
        "captionKind": "Original text, chunk-aligned" if args.lines else "Chinese translation, phrase-aligned",
        "inferenceSeconds": round(time.perf_counter() - started, 3),
        "windowSamples": WINDOW, "retainedFrames": FPS, "identity": 0,
    }
    clip = {"version": 1, "fps": FPS, "duration": duration, "names": names,
            "frames": np.round(frames, 6).tolist(), "captions": captions, "provenance": provenance}
    (assets / "speech.json").write_text(json.dumps(clip, ensure_ascii=False), encoding="utf-8")
    jaw = frames[:, names.index("jawOpen")]
    print(json.dumps({"duration": duration, "frames": len(frames),
                      "jawOpenRange": [float(jaw.min()), float(jaw.max())],
                      **provenance}, indent=2))


if __name__ == "__main__":
    main()
