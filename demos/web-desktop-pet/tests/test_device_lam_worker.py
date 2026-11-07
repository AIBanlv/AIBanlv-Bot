import base64
import importlib.util
import io
import json
import hashlib
import os
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import numpy as np


spec = importlib.util.spec_from_file_location(
    "device_lam_worker",
    Path(__file__).resolve().parents[1] / "scripts/device_lam_worker.py",
)
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)


def request(pcm=None, **fields):
    if pcm is None:
        pcm = bytes(51200 * 2)
    return {"id": 1, "pcm": base64.b64encode(pcm).decode("ascii"), **fields}


class InputTests(unittest.TestCase):
    def test_pcm_is_exactly_51200_signed_little_endian_samples_at_24khz(self):
        samples = np.resize(np.array([-32768, -1, 0, 32767], dtype="<i2"), 51200)
        result = worker.decode_request(request(samples.tobytes()))
        self.assertEqual(result.shape, (51200,))
        self.assertEqual(result.dtype, np.float32)
        np.testing.assert_array_equal(result[:4], [-1, -1 / 32768, 0, 32767 / 32768])

    def test_only_positive_javascript_safe_integer_ids_are_accepted(self):
        for value in [None, True, False, 0, -1, 1.0, "1", 2**53, float("nan"), float("inf")]:
            with self.subTest(id=value), self.assertRaises(ValueError):
                worker.decode_request(request(id=value))
        self.assertEqual(worker.decode_request(request(id=2**53 - 1)).size, 51200)

    def test_bad_base64_and_wrong_pcm_lengths_are_rejected(self):
        for value in ["", None, 3, "!", "data:audio/raw;base64,AAAA", "AA A=", "AAAA==="]:
            with self.subTest(pcm=value), self.assertRaises(ValueError):
                worker.decode_request({**request(), "pcm": value})
        for length in [1, 32000, 102399, 102401, 102402]:
            with self.subTest(length=length), self.assertRaises(ValueError):
                worker.decode_request(request(bytes(length)))

    def test_rate_channels_and_other_request_overrides_are_not_supported(self):
        for field in ["rate", "sampleRate", "channels", "identity", "source"]:
            with self.subTest(field=field), self.assertRaises(ValueError):
                worker.decode_request(request(**{field: 16000}))
        for value in [None, [], {}, {"id": 1}, {"pcm": request()["pcm"]}]:
            with self.subTest(value=type(value).__name__), self.assertRaises(ValueError):
                worker.decode_request(value)

    def test_line_reader_is_bounded_and_resynchronizes_after_an_oversized_line(self):
        class BoundedStream(io.BytesIO):
            def readline(self, size=-1):
                if not 0 < size <= 160001:
                    raise AssertionError("Unbounded input read")
                return super().readline(size)

        stream = BoundedStream(b"x" * 500000 + b"\n{}\n{}\r\n{}")
        self.assertEqual(list(worker.request_lines(stream)), [None, b"{}\n", b"{}\r\n", b"{}"])
        self.assertEqual(list(worker.request_lines(io.BytesIO(b"x" * 160000))), [b"x" * 160000])
        self.assertEqual(list(worker.request_lines(io.BytesIO(b"x" * 160001))), [None])


class OutputTests(unittest.TestCase):
    def test_only_the_last_30_frames_are_returned_in_canonical_channel_order(self):
        frames = np.arange(64 * 52, dtype=np.float32).reshape(64, 52) / (64 * 52)
        result = np.array(worker.validate_frames(frames))
        self.assertEqual(result.shape, (30, 52))
        np.testing.assert_allclose(result, frames[-30:], atol=0.000001)
        json.dumps(result.tolist(), allow_nan=False)

    def test_rounding_noise_is_clamped_but_invalid_model_values_are_rejected(self):
        frames = np.full((64, 52), 0.5, dtype=np.float32)
        frames[-1, :2] = [-0.000001, 1.000001]
        self.assertEqual(worker.validate_frames(frames)[-1][:2], [0, 1])
        for value in [-0.01, 1.01, float("nan"), float("inf"), -float("inf")]:
            invalid = frames.copy()
            invalid[-1, 0] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                worker.validate_frames(invalid)

    def test_wrong_shapes_and_non_numeric_frames_are_rejected(self):
        for value in [np.zeros((29, 52)), np.zeros((64, 51)), np.zeros((1, 64, 52)),
                      np.full((64, 52), "0.5"), np.zeros((64, 52), dtype=bool)]:
            with self.subTest(shape=value.shape), self.assertRaises(ValueError):
                worker.validate_frames(value)


class FakeModel:
    names = [f"channel{index}" for index in range(52)]
    checkpoint_sha256 = "a" * 64

    def __init__(self):
        self.calls = []

    def infer(self, audio):
        print("model diagnostic")
        self.calls.append(audio.copy())
        return np.full((64, 52), 0.25, dtype=np.float32)


class ProtocolTests(unittest.TestCase):
    def run_worker(self, data, model=None):
        model = model or FakeModel()
        factory = Mock(return_value=model)
        output, errors = io.StringIO(), io.StringIO()
        status = worker.run(Path("fixture"), io.BytesIO(data), output, errors, factory)
        return status, [json.loads(line) for line in output.getvalue().splitlines()], errors, factory

    def test_one_load_and_one_warmup_precede_ready_and_two_independent_windows(self):
        model = FakeModel()
        second = np.full(51200, 16384, dtype="<i2").tobytes()
        data = (json.dumps(request(id=7)) + "\n"
                + json.dumps(request(second, id=8))).encode()
        status, lines, errors, factory = self.run_worker(data, model)
        self.assertEqual(status, 0)
        factory.assert_called_once_with(Path("fixture"))
        self.assertEqual(len(model.calls), 3)
        np.testing.assert_array_equal(model.calls[0], np.zeros(51200))
        np.testing.assert_array_equal(model.calls[1], np.zeros(51200))
        np.testing.assert_array_equal(model.calls[2], np.full(51200, 0.5))
        self.assertEqual(lines[0], {"type": "ready", "engine": "pytorch-original-tar",
                                   "backend": "cpu", "benchmark": {},
                                   "fps": 30, "names": model.names, "checkpointSha256": "a" * 64})
        self.assertEqual([line["id"] for line in lines[1:]], [7, 8])
        for line in lines[1:]:
            self.assertEqual(set(line), {"id", "frames", "inferenceMs"})
            self.assertEqual(np.asarray(line["frames"]).shape, (30, 52))
            self.assertTrue(np.isfinite(line["inferenceMs"]))
            self.assertGreaterEqual(line["inferenceMs"], 0)
        self.assertEqual(errors.getvalue().count("model diagnostic"), 3)

    def test_bad_lines_are_sanitized_and_do_not_prevent_the_next_request(self):
        invalid = [
            (b"not-json", None), (b'{"id":NaN}', None), (b'{"id":Infinity}', None),
            (b'{"id":2,"id":3}', None), (b"\xff", None),
            (b'{"id":9007199254740992}', None), (b'{"id":true}', None),
            (b'{"id":3,"pcm":"private-audio"}', 3),
            (b'{"id":4,"pcm":[]}', 4), (b'{"id":5,"rate":16000}', 5),
            (b"[" * 10000 + b"]" * 10000, None),
            (b"x" * 400000, None),
        ]
        data = b"\n".join([line for line, _ in invalid] + [json.dumps(request(id=9)).encode()])
        _, lines, errors, factory = self.run_worker(data)
        self.assertEqual(lines[1:-1], [{"id": id_, "error": "INVALID_INPUT"} for _, id_ in invalid])
        self.assertEqual(lines[-1]["id"], 9)
        self.assertEqual(len(factory.return_value.calls), 2)
        self.assertNotIn("private-audio", errors.getvalue())

    def test_loading_failure_or_invalid_warmup_never_publishes_ready(self):
        for factory in [
            Mock(side_effect=RuntimeError("private-source-path")),
            Mock(return_value=Mock(infer=Mock(return_value=np.full((64, 52), np.nan)))),
        ]:
            output, errors = io.StringIO(), io.StringIO()
            status = worker.run(Path("fixture"), io.BytesIO(), output, errors, factory)
            self.assertEqual(status, 1)
            self.assertEqual(output.getvalue(), "")
            self.assertNotIn("private-source-path", errors.getvalue())
            self.assertIn("STARTUP_FAILED", errors.getvalue())

    def test_inference_failure_is_not_reported_as_invalid_audio_or_leaked(self):
        model = FakeModel()
        model.infer = Mock(side_effect=[
            np.zeros((64, 52)), RuntimeError("private-audio"), np.full((64, 52), np.inf),
            np.zeros((64, 52)),
        ])
        data = b"\n".join(json.dumps(request(id=id_)).encode() for id_ in [1, 2, 3])
        _, lines, errors, _ = self.run_worker(data, model)
        self.assertEqual(lines[1:3], [{"id": 1, "error": "INFERENCE_FAILED"},
                                     {"id": 2, "error": "INFERENCE_FAILED"}])
        self.assertEqual(lines[-1]["id"], 3)
        self.assertNotIn("private-audio", errors.getvalue())


class ModelTests(unittest.TestCase):
    def test_resampling_reuses_torchaudio_24k_to_16k_then_discards_only_the_last_sample(self):
        import torch
        from torchaudio.transforms import Resample

        audio = np.sin(np.arange(51200, dtype=np.float32) * 0.08)
        resampler = Resample(24000, 16000)
        expected = resampler(torch.from_numpy(audio)).numpy()
        self.assertEqual(expected.size, 34134)
        actual = worker.resample_window(audio, resampler)
        self.assertEqual(actual.shape, (34133,))
        self.assertEqual(actual.dtype, np.float32)
        np.testing.assert_array_equal(actual, expected[:34133])
        np.testing.assert_array_equal(worker.resample_window(audio, resampler), actual)
        for bad in [np.zeros(51201), np.zeros((1, 51200)), np.full(51200, np.nan),
                    np.full(51200, np.inf)]:
            with self.subTest(shape=bad.shape), self.assertRaises(ValueError):
                worker.resample_window(bad, resampler)

    def test_original_checkpoint_load_is_offline_weights_only_strict_and_identity_zero(self):
        import torch
        import torchaudio

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            (source / "models").mkdir()
            names = [f"channel{index}" for index in range(52)]
            (source / "models/utils.py").write_text("ARKitBlendShape = " + repr(names))
            (source / "pretrained_models").mkdir()
            checkpoint = source / "pretrained_models/LAM_audio2exp_streaming.tar"
            checkpoint.write_bytes(b"fixture-checkpoint")
            config = SimpleNamespace(model={"backbone": {"pretrained_encoder_path": "must-not-download"}})
            config_class = Mock()
            config_class.fromfile.return_value = config
            original = Mock()
            original.eval.return_value = original
            original.return_value = {"pred_exp": torch.full((1, 64, 52), 0.3)}
            build_model = Mock(return_value=original)
            modules = {"utils.config": SimpleNamespace(Config=config_class),
                       "models": SimpleNamespace(build_model=build_model)}
            cwd, search_path = Path.cwd(), list(sys.path)
            with patch.dict(sys.modules, modules), patch.dict(os.environ, {}, clear=False), \
                    patch.object(torch, "load", return_value={"state_dict": {"fixture": 1}}) as load, \
                    patch.object(torchaudio.transforms, "Resample",
                                 wraps=torchaudio.transforms.Resample) as resamplers, \
                    patch.object(torch, "set_num_threads", wraps=torch.set_num_threads) as threads:
                model = worker.LamModel(source)
                self.assertEqual(os.environ["HF_HUB_OFFLINE"], "1")
                self.assertEqual(os.environ["TRANSFORMERS_OFFLINE"], "1")
                threads.assert_called_once_with(4)
                self.assertEqual(load.call_count, 1)
                self.assertEqual(load.call_args.kwargs, {"map_location": "cpu", "weights_only": True})
                original.load_state_dict.assert_called_once_with({"fixture": 1}, strict=True)
                self.assertEqual(config.model["backbone"]["pretrained_encoder_path"], "")
                self.assertEqual(model.checkpoint_sha256, hashlib.sha256(b"fixture-checkpoint").hexdigest())
                self.assertEqual(model.names, names)
                with patch.object(worker, "resample_window", return_value=np.zeros(34133, dtype=np.float32)):
                    self.assertEqual(model.infer(np.zeros(51200)).shape, (64, 52))
                    model.infer(np.ones(51200))
                self.assertEqual(load.call_count, 1)
                self.assertEqual(build_model.call_count, 1)
                resamplers.assert_called_once_with(24000, 16000)
                data = original.call_args.args[0]
                self.assertEqual(tuple(data["input_audio_array"].shape), (1, 34133))
                self.assertEqual(data["id_idx"].tolist(), [[1] + [0] * 11])
                self.assertEqual(original.backbone.audio_encoder.config._attn_implementation, "eager")
                self.assertIs(original.backbone.audio_encoder.config.output_attentions, False)
            self.assertEqual(Path.cwd(), cwd)
            self.assertEqual(sys.path, search_path)

    def test_names_are_read_as_literal_data_not_executed_code(self):
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory)
            (source / "models").mkdir()
            path = source / "models/utils.py"
            for expression in ["['jawOpen']", "['same'] * 52", "__import__('os').getcwd()"]:
                path.write_text("ARKitBlendShape = " + expression)
                with self.subTest(expression=expression), self.assertRaises((ValueError, TypeError)):
                    worker.load_names(source)


class ProcessTests(unittest.TestCase):
    def test_native_and_python_diagnostics_never_pollute_the_protocol_pipe(self):
        bootstrap = f"""
import importlib.util, os, sys
from types import SimpleNamespace
spec = importlib.util.spec_from_file_location('worker', {str(Path(worker.__file__))!r})
worker = importlib.util.module_from_spec(spec)
spec.loader.exec_module(worker)
def infer(audio):
    print('python diagnostic')
    os.write(1, b'native diagnostic\\n')
    return worker.np.zeros((64, 52))
def factory(source):
    print('loader diagnostic')
    return SimpleNamespace(infer=infer, names=['channel' + str(i) for i in range(52)],
                           checkpoint_sha256='b' * 64)
sys.exit(worker.main(['--source', 'fixture'], model_factory=factory))
"""
        result = subprocess.run([sys.executable, "-B", "-u", "-c", bootstrap],
                                input=json.dumps(request()).encode(), capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 0, result.stderr.decode())
        lines = [json.loads(line) for line in result.stdout.splitlines()]
        self.assertEqual(len(lines), 2)
        self.assertEqual(lines[0]["type"], "ready")
        self.assertEqual(lines[1]["id"], 1)
        self.assertIn(b"loader diagnostic", result.stderr)
        self.assertEqual(result.stderr.count(b"native diagnostic"), 2)
        self.assertEqual(result.stderr.count(b"python diagnostic"), 2)

    def test_missing_checkpoint_exits_without_ready_or_input_echo(self):
        with tempfile.TemporaryDirectory() as source:
            result = subprocess.run(
                [sys.executable, "-B", "-u", worker.__file__, "--source", source],
                input=b'{"id":1,"pcm":"private-audio"}\n', capture_output=True, timeout=15)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout, b"")
        self.assertIn(b"STARTUP_FAILED", result.stderr)
        self.assertNotIn(b"private-audio", result.stderr)


class CudaSelectionTests(unittest.TestCase):
    def model(self, slow=False, corrupt=False):
        model=worker.LamModel.__new__(worker.LamModel)
        model.device='cpu';model.model=Mock()
        model.identity=Mock();model.identity.to.return_value=model.identity;model.identity.cpu.return_value=model.identity
        model.torch=SimpleNamespace(cuda=Mock())
        model.torch.cuda.is_available.return_value=True
        def infer(audio):
            value=.1 if not np.any(audio) else .3
            if corrupt and model.device=='cuda':value+=.1
            return np.full((30,52),value,dtype=np.float32)
        model.infer=infer
        gpu=.02 if slow else .003
        clock=[0,.01,.1,.11,.2,.21,1,1+gpu,2,2+gpu,3,3+gpu]
        return model,clock

    def test_fast_matching_cuda_is_selected(self):
        model,clock=self.model()
        with patch.dict(os.environ,{'PET_TORCH_DEVICE':'auto'}),patch.object(worker.time,'perf_counter',side_effect=clock):
            model.select_backend()
        self.assertEqual(model.device,'cuda')

    def test_slow_or_incorrect_cuda_falls_back_to_cpu(self):
        for options in [{'slow':True},{'corrupt':True}]:
            model,clock=self.model(**options)
            with patch.dict(os.environ,{'PET_TORCH_DEVICE':'auto'}),patch.object(worker.time,'perf_counter',side_effect=clock):
                model.select_backend()
            self.assertEqual(model.device,'cpu')
            model.torch.cuda.empty_cache.assert_called_once()

if __name__ == "__main__":
    unittest.main()
