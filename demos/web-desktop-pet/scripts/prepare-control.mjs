import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile, writeFile, readdir, mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { validateClip } from '../src/expression.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const control = path.resolve(root, '../..')
const common = path.join(control, 'android-native/lam-expression-common/src/main/java/com/zhanlv/lam/expression')
const timeline = path.join(control, 'android-native/digitalhuman-core/src/main/java/com/zhanlv/digitalhuman/playback/AudioClockExpressionTimeline.java')
const library = path.join(control, 'android-native/digitalhuman-core/src/main/assets/AIBANLVKeyframeFace.json')
const output = path.join(process.env.PET_ARTIFACTS || path.join(root, 'artifacts'), 'control-java')
const rawFile = path.join(root, 'assets/speech.json')
const bankFile = path.join(root, 'assets/speech-control.json')
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex')

async function gsonJar() {
  if (process.env.GSON_JAR) return path.resolve(process.env.GSON_JAR)
  const cache = path.join(process.env.GRADLE_USER_HOME || path.join(os.homedir(), '.gradle'),
    'caches/modules-2/files-2.1/com.google.code.gson/gson/2.11.0')
  for (const entry of await readdir(cache)) {
    for (const file of await readdir(path.join(cache, entry))) {
      if (file === 'gson-2.11.0.jar') return path.join(cache, entry, file)
    }
  }
  throw new Error('Set GSON_JAR to the installed Control Gson jar; no dependencies are downloaded')
}

export async function controlToolchain() {
  const jar = await gsonJar()
  await mkdir(output, { recursive: true })
  const sources = (await readdir(common)).filter((file) => file.endsWith('.java')).sort().map((file) => path.join(common, file))
  sources.push(timeline, path.join(path.dirname(timeline), 'ExpressionBehavior.java'),
    path.join(root, 'scripts/ControlPostprocess.java'), path.join(root, 'scripts/ControlPreview.java'),
    path.join(root, 'tests/ControlPostprocessTest.java'), path.join(root, 'tests/ControlPreviewTest.java'))
  return { jar, sources, output, library, classpath: [output, jar].join(path.delimiter) }
}

async function main() {
  const { jar, sources, classpath } = await controlToolchain()
  execFileSync(process.env.JAVAC || 'javac', ['-encoding', 'UTF-8', '-cp', jar, '-d', output, ...sources], { stdio: 'inherit', windowsHide: true })
  execFileSync(process.env.JAVA || 'java', ['-cp', classpath, 'ControlPostprocessTest', library], { stdio: 'inherit', windowsHide: true })
  execFileSync(process.env.JAVA || 'java', ['-cp', classpath, 'ControlPreviewTest'], { stdio: 'inherit', windowsHide: true })
  if (!process.argv.includes('--test')) {
    const bytes = await readFile(rawFile)
    validateClip(JSON.parse(bytes.toString('utf8')))
    execFileSync(process.env.JAVA || 'java', ['-cp', classpath, 'ControlPostprocess', rawFile, library, bankFile], { stdio: 'inherit', windowsHide: true })
    const bank = JSON.parse(await readFile(bankFile, 'utf8'))
    bank.sourceSha256 = sha(bytes)
    bank.librarySha256 = sha(await readFile(library))
    bank.sourceFiles = Object.fromEntries(await Promise.all(sources.map(async (file) => [
      path.relative(control, file).replaceAll('\\', '/'), sha(await readFile(file)),
    ])))
    await writeFile(bankFile, JSON.stringify(bank))
    console.log(JSON.stringify({ pipeline: bank.pipeline, frames: bank.variants.natural.frames.length,
      variants: Object.keys(bank.variants), sourceSha256: bank.sourceSha256, output: bankFile }, null, 2))
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
