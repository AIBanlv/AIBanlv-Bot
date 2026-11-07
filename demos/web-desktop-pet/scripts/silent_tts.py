"""Retrieve offline Mandarin PCM. Never initialize a playback output."""

import argparse
import ctypes as c
import json
from pathlib import Path
import re
import wave


def synthesize(text):
    if (not isinstance(text, str) or not text.strip() or len(text) > 160
            or re.search(r"[\x00-\x08\x0b-\x1f\[\]<>]", text)):
        raise ValueError("Expected 1-160 characters of plain dialogue")
    import espeakng_loader
    import numpy as np
    from scipy.signal import resample_poly

    lib = c.CDLL(espeakng_loader.get_library_path())
    lib.espeak_Initialize.argtypes = [c.c_int, c.c_int, c.c_char_p, c.c_int]
    lib.espeak_SetVoiceByName.argtypes = [c.c_char_p]
    lib.espeak_SetParameter.argtypes = [c.c_int, c.c_int, c.c_int]
    callback_type = c.CFUNCTYPE(c.c_int, c.POINTER(c.c_short), c.c_int, c.c_void_p)
    lib.espeak_SetSynthCallback.argtypes = [callback_type]
    lib.espeak_SetSynthCallback.restype = None
    lib.espeak_Synth.argtypes = [c.c_char_p, c.c_size_t, c.c_uint, c.c_int,
                                c.c_uint, c.c_uint, c.c_void_p, c.c_void_p]
    # speak_lib.h: 2 = AUDIO_OUTPUT_SYNCHRONOUS (retrieval, not SYNCH_PLAYBACK).
    rate = lib.espeak_Initialize(
        2, 0, str(Path(espeakng_loader.get_data_path()).parent).encode("utf-8"), 0x8000
    )
    if rate <= 0:
        raise RuntimeError("eSpeak NG initialization failed")
    pcm = bytearray()
    overflow = False

    @callback_type
    def collect(samples, count, _events):
        nonlocal overflow
        if samples and count > 0:
            if len(pcm) + count * 2 > rate * 2 * 60:
                overflow = True
                return 1
            pcm.extend(c.string_at(samples, count * 2))
        return 0

    try:
        if lib.espeak_SetVoiceByName(b"cmn") != 0:
            raise RuntimeError("Offline Mandarin voice is unavailable")
        lib.espeak_SetParameter(1, 165, 0)
        lib.espeak_SetSynthCallback(collect)
        data = text.encode("utf-8") + b"\0"
        # UTF8 + end pause only. SSML, phoneme markup and URI playback are disabled.
        if lib.espeak_Synth(data, len(data), 0, 1, 0, 0x1001, None, None) != 0:
            raise RuntimeError("Offline Mandarin synthesis failed")
        if overflow or not pcm:
            raise ValueError("Dialogue must produce 0-60 seconds of audio")
    finally:
        lib.espeak_Terminate()
    values = np.frombuffer(pcm, dtype="<i2").astype(np.float32)
    values = resample_poly(values, 16000, rate)
    return np.clip(np.rint(values), -32768, 32767).astype("<i2").tobytes()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--assets", type=Path, required=True)
    args = parser.parse_args()
    behavior = json.loads((args.assets / "behavior.json").read_text(encoding="utf-8"))
    text = behavior["text"]
    # Each bounded caption is synthesized separately, preserving exact cue boundaries.
    phrases = [text[i:i + 32] for i in range(0, len(text), 32)]
    lines = []
    for index, phrase in enumerate(phrases):
        with wave.open(str(args.assets / f"phrase-{index}.wav"), "wb") as audio:
            audio.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
            audio.writeframes(synthesize(phrase))
        lines.append({"caption": phrase})
    (args.assets / "lines.json").write_text(json.dumps(lines, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    main()
