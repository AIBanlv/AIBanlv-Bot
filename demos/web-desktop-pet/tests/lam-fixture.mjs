import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import path from 'node:path'

export function knownSpeech(root = process.cwd()) {
  const python = process.env.PET_PYTHON || path.resolve(root, '../../../.venv-lam-coreml/Scripts/python.exe')
  const result = spawnSync(python, ['-c',
    'import sys,wave,numpy as np,torch,torchaudio; w=wave.open(sys.argv[1]); assert w.getframerate()==16000 and w.getnchannels()==1; torch.set_num_threads(4); a=torch.from_numpy(np.frombuffer(w.readframes(64000),dtype="<i2").astype(np.float32)); b=torchaudio.transforms.Resample(16000,24000)(a); sys.stdout.buffer.write(b.clamp(-32768,32767).numpy().astype("<i2").tobytes())',
    path.join(root, 'assets/speech.wav')], { windowsHide: true, maxBuffer: 1024 * 1024 })
  assert.equal(result.status, 0, 'Known local speech fixture must be readable')
  assert.ok(result.stdout.length >= 144000)
  return result.stdout
}
