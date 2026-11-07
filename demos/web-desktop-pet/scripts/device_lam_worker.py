"""Persistent, offline LAM inference for fixed 24 kHz PCM windows."""

import argparse
import ast
import base64
from contextlib import redirect_stdout
import hashlib
import json
import os
from pathlib import Path
import sys
import time

import numpy as np


INPUT_SAMPLES = 51200
MODEL_SAMPLES = 34133
FPS = 30
MAX_LINE_BYTES = 160000
MAX_ID = 2**53 - 1


def valid_id(value):
    return type(value) is int and 0 < value <= MAX_ID


def decode_request(value):
    if (not isinstance(value, dict) or set(value) != {"id", "pcm"}
            or not valid_id(value["id"]) or not isinstance(value["pcm"], str)
            or len(value["pcm"]) != ((INPUT_SAMPLES * 2 + 2) // 3) * 4):
        raise ValueError("INVALID_INPUT")
    pcm = base64.b64decode(value["pcm"], validate=True)
    if len(pcm) != INPUT_SAMPLES * 2:
        raise ValueError("INVALID_INPUT")
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768


def request_lines(stream):
    while True:
        line = stream.readline(MAX_LINE_BYTES + 1)
        if not line:
            return
        if len(line) > MAX_LINE_BYTES:
            # Discard the entire record, never interpret its tail as a request.
            while line and not line.endswith(b"\n"):
                line = stream.readline(MAX_LINE_BYTES + 1)
            yield None
        else:
            yield line


def validate_frames(values):
    frames = np.asarray(values)
    if (frames.ndim != 2 or frames.shape[0] < FPS or frames.shape[1] != 52
            or frames.dtype.kind not in "fiu" or not np.isfinite(frames).all()
            or np.any(frames < -0.0001) or np.any(frames > 1.0001)):
        raise ValueError("Invalid model output")
    return np.round(np.clip(frames[-FPS:].astype(np.float64), 0, 1), 6).tolist()


def resample_window(audio, resampler):
    import torch

    if audio.shape != (INPUT_SAMPLES,) or not np.isfinite(audio).all():
        raise ValueError("Invalid audio window")
    with torch.inference_mode():
        result = resampler(torch.from_numpy(audio.astype(np.float32, copy=False)))
    if result.shape != (34134,) or not torch.isfinite(result).all():
        raise ValueError("Invalid resampled window")
    return result[:MODEL_SAMPLES].numpy().copy()


def load_names(source):
    tree = ast.parse((source / "models/utils.py").read_text(encoding="utf-8"))
    assignments = [node for node in tree.body if isinstance(node, ast.Assign) and any(
        isinstance(target, ast.Name) and target.id == "ARKitBlendShape" for target in node.targets)]
    if len(assignments) != 1:
        raise ValueError("Missing canonical blendshapes")
    names = ast.literal_eval(assignments[0].value)
    if (not isinstance(names, list) or len(names) != 52
            or not all(isinstance(name, str) and name.isascii() and name.isalnum() for name in names)
            or len(set(names)) != 52):
        raise ValueError("Invalid canonical blendshapes")
    return names


class LamModel:
    def __init__(self, source):
        source = Path(source).resolve()
        checkpoint_path = source / "pretrained_models/LAM_audio2exp_streaming.tar"
        if not checkpoint_path.is_file():
            raise ValueError("Missing local checkpoint")
        self.names = load_names(source)
        os.environ["HF_HUB_OFFLINE"] = "1"
        os.environ["TRANSFORMERS_OFFLINE"] = "1"
        os.environ["HF_HUB_DISABLE_TELEMETRY"] = "1"
        import torch
        from torchaudio.transforms import Resample

        self.torch = torch
        torch.set_num_threads(4)
        self.resampler = Resample(24000, 16000)
        previous, search_path = Path.cwd(), list(sys.path)
        try:
            sys.path.insert(0, str(source))
            os.chdir(source)
            from utils.config import Config
            from models import build_model

            config = Config.fromfile("configs/lam_audio2exp_config_streaming.py")
            config.model["backbone"]["pretrained_encoder_path"] = ""
            self.model = build_model(config.model).eval()
        finally:
            os.chdir(previous)
            sys.path[:] = search_path
        with checkpoint_path.open("rb") as checkpoint_file:
            self.checkpoint_sha256 = hashlib.file_digest(checkpoint_file, "sha256").hexdigest()
            checkpoint_file.seek(0)
            checkpoint = torch.load(checkpoint_file, map_location="cpu", weights_only=True)
        self.model.load_state_dict(checkpoint["state_dict"], strict=True)
        self.model.backbone.audio_encoder.config._attn_implementation = "eager"
        self.model.backbone.audio_encoder.config.output_attentions = False
        self.identity = torch.nn.functional.one_hot(torch.tensor([0]), 12)
        self.device = 'cpu'
        self.select_backend()

    def select_backend(self):
        # CUDA must be healthy and faster than CPU, including transfer cost.
        requested = os.environ.get('PET_TORCH_DEVICE', 'auto')
        if requested not in ('auto', 'cpu', 'cuda'):
            raise ValueError('Invalid backend')
        if requested == 'cpu' or not self.torch.cuda.is_available():
            return
        audio = [np.zeros(INPUT_SAMPLES, dtype=np.float32),
                 (np.sin(np.arange(INPUT_SAMPLES) * 2 * np.pi * 220 / 24000) * .2).astype(np.float32),
                 (np.sin(np.arange(INPUT_SAMPLES) * 2 * np.pi * 440 / 24000) * .1).astype(np.float32)]
        try:
            baseline, cpu_ms = [], []
            for window in audio:
                start = time.perf_counter(); baseline.append(np.asarray(validate_frames(self.infer(window))))
                cpu_ms.append((time.perf_counter() - start) * 1000)
            self.model.to('cuda'); self.identity = self.identity.to('cuda'); self.device = 'cuda'
            times = []
            for index, window in enumerate(audio):
                self.torch.cuda.synchronize()
                start = time.perf_counter(); result = np.asarray(validate_frames(self.infer(window)))
                self.torch.cuda.synchronize(); times.append((time.perf_counter() - start) * 1000)
                delta = result - baseline[index]
                if np.max(np.abs(delta)) > .03 or np.sqrt(np.mean(delta * delta)) > .005:
                    raise ValueError('Backend output mismatch')
            if np.max(np.abs(baseline[0] - baseline[1])) < 1e-5:
                raise ValueError('Frozen model output')
            self.benchmark = {'cpuMs': round(float(np.median(cpu_ms)), 3), 'cudaMs': round(float(np.median(times)), 3)}
            if requested == 'auto' and np.median(times) >= np.median(cpu_ms) * .95:
                self.to_cpu()
        except Exception:
            self.to_cpu()

    def to_cpu(self):
        self.device = 'cpu'; self.model.to('cpu'); self.identity = self.identity.cpu()
        self.torch.cuda.empty_cache()

    def infer(self, audio):
        window = self.torch.from_numpy(resample_window(audio, self.resampler)).unsqueeze(0).to(self.device)
        with self.torch.inference_mode():
            result = self.model({"input_audio_array": window, "id_idx": self.identity})["pred_exp"]
        if result.ndim != 3 or result.shape[0] != 1:
            raise ValueError("Invalid model output")
        return result[0].cpu().numpy()


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        if key in result:
            raise ValueError("Duplicate JSON key")
        result[key] = value
    return result


def reject_constant(_value):
    raise ValueError("Non-finite JSON number")


def run(source, input_stream, output_stream, errors, model_factory=None):
    def emit(value):
        output_stream.write(json.dumps(value, separators=(",", ":"), allow_nan=False) + "\n")
        output_stream.flush()

    with redirect_stdout(errors):
        try:
            model = (model_factory or LamModel)(source)
            validate_frames(model.infer(np.zeros(INPUT_SAMPLES, dtype=np.float32)))
            emit({"type": "ready", "engine": "pytorch-original-tar", "fps": FPS,
                  "backend": getattr(model, 'device', 'cpu'), "benchmark": getattr(model, 'benchmark', {}),
                  "names": model.names, "checkpointSha256": model.checkpoint_sha256})
        except Exception:
            print("LAM STARTUP_FAILED", file=errors, flush=True)
            return 1

        for line in request_lines(input_stream):
            request_id = None
            try:
                if line is None:
                    raise ValueError("Oversized input")
                value = json.loads(line.decode("utf-8"), object_pairs_hook=unique_object,
                                   parse_constant=reject_constant)
                if isinstance(value, dict) and valid_id(value.get("id")):
                    request_id = value["id"]
                audio = decode_request(value)
            except (ValueError, TypeError, RecursionError):
                emit({"id": request_id, "error": "INVALID_INPUT"})
                continue
            started = time.perf_counter()
            try:
                frames = validate_frames(model.infer(audio))
                elapsed = round((time.perf_counter() - started) * 1000, 3)
            except Exception:
                emit({"id": request_id, "error": "INFERENCE_FAILED"})
                continue
            emit({"id": request_id, "frames": frames, "inferenceMs": elapsed})
    return 0


def main(argv=None, model_factory=None):
    sys.dont_write_bytecode = True
    sys.stdout.flush()
    with os.fdopen(os.dup(sys.stdout.fileno()), "w", encoding="utf-8",
                   buffering=1, newline="\n") as protocol:
        # Redirect fd 1 as well as Python stdout: native libraries can print too.
        os.dup2(sys.stderr.fileno(), sys.stdout.fileno())
        with redirect_stdout(sys.stderr):
            parser = argparse.ArgumentParser(description=__doc__)
            parser.add_argument("--source", type=Path, required=True)
            parser.add_argument("--backend", choices=['auto', 'cpu', 'cuda'])
            args = parser.parse_args(argv)
            if args.backend:
                os.environ['PET_TORCH_DEVICE'] = args.backend
            try:
                return run(args.source.resolve(), sys.stdin.buffer, protocol, sys.stderr, model_factory)
            except BrokenPipeError:
                return 0


if __name__ == "__main__":
    raise SystemExit(main())
