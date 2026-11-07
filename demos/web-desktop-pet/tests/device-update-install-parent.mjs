import { app } from 'electron'
import { mkdirSync, appendFileSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import path from 'node:path'
import { prepareUpdateInstall } from '../electron/device-update-install.mjs'

const directory = process.env.UPDATE_INSTALL_FIXTURE_ROOT
const trace = value => appendFileSync(path.join(directory, 'parent-trace.txt'), value + '\n')
trace('start ' + process.pid)
mkdirSync(path.join(directory, 'profile'), { recursive: true })
app.setPath('userData', path.join(directory, 'profile'))
async function main() {
  await app.whenReady()
  trace('ready')
  const file = path.join(directory, 'Setup.exe'), bytes = await readFile(file)
  await prepareUpdateInstall({ file, directory, installDirectory: directory,
    manifest: { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') },
    timeoutMs: 10000,
    spawnImpl: (...args) => {
      const child = spawn(...args)
      trace('launcher ' + child.pid)
      child.on('exit', code => trace('launcher exit ' + code))
      return child
    } })
  trace('prepared')
  app.quit()
}
main().catch(error => { trace(error.message); app.exit(1) })
