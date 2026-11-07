import importlib.util
from pathlib import Path
import tempfile
import unittest
import wave

spec = importlib.util.spec_from_file_location(
    "infer_speech", Path(__file__).resolve().parents[1] / "scripts/infer_speech.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class AudioTests(unittest.TestCase):
    def test_pcm_format_is_validated_before_inference(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "audio.wav"
            for rate in [16000, 24000]:
                with wave.open(str(path), "wb") as audio:
                    audio.setparams((1, 2, rate, 0, "NONE", "not compressed"))
                    audio.writeframes(b"\0\0" * 1600)
                if rate == 16000:
                    self.assertEqual(len(module.read_pcm(path)), 3200)
                else:
                    with self.assertRaises(ValueError):
                        module.read_pcm(path)

    def test_streaming_windows_keep_one_second_output_aligned(self):
        self.assertEqual(module.window_bounds(0), (-18133, 16000))
        self.assertEqual(module.window_bounds(1), (-2133, 32000))
        self.assertEqual(module.window_bounds(2), (13867, 48000))


if __name__ == "__main__":
    unittest.main()
