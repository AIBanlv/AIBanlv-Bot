import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location(
    "silent_tts", Path(__file__).resolve().parents[1] / "scripts/silent_tts.py"
)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class SilentTtsTests(unittest.TestCase):
    def test_retrieves_nonzero_mandarin_pcm_without_playback(self):
        pcm = module.synthesize("\u4f60\u597d\uff0c\u5f88\u9ad8\u5174\u89c1\u5230\u4f60\u3002")
        self.assertGreater(len(pcm), 16000)
        self.assertLess(len(pcm), 16000 * 2 * 20)
        self.assertNotEqual(set(pcm), {0})
        self.assertEqual(len(pcm) % 2, 0)

    def test_rejects_empty_oversized_or_directive_text(self):
        for text in ["", " " * 10, "a" * 161, "[H:shake]", "hello\x00world", "<audio>"]:
            with self.assertRaises(ValueError):
                module.synthesize(text)


if __name__ == "__main__":
    unittest.main()
