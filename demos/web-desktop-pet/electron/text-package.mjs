import { packager } from '@electron/packager'
import { downloadArtifact } from '@electron/get'
import { copyFile, mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveTextFiles } from './text-server.mjs'
import { bundleEntry } from '../scripts/bundle-entry.mjs'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const workspace = path.resolve(root, '../../..')
const control = path.resolve(root, '../..')
const manifest = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'))
const builds = path.join(root, 'dist')
await mkdir(builds, { recursive: true })
const build = await mkdtemp(path.join(builds, 'text-'))
const stage = path.join(build, 'source')
const version = manifest.devDependencies.electron
const checksums = JSON.parse(await readFile(path.join(root, 'node_modules/electron/checksums.json'), 'utf8'))
const archive = await downloadArtifact({ version, artifactName: 'electron', platform: 'win32', arch: 'x64', checksums,
  mirrorOptions: { mirror: process.env.ELECTRON_MIRROR || 'https://npmmirror.com/mirrors/electron/' } })
const bundle = new Set(resolveTextFiles().values())
for (const file of ['main.mjs', 'policy.mjs', 'preload.cjs', 'text-server.mjs']) bundle.add(path.join(root, 'electron', file))
bundle.add(path.join(control, 'static/logo.png'))
for (const source of bundle) {
  const target = path.resolve(stage, path.relative(workspace, source))
  if (!target.startsWith(`${stage}${path.sep}`)) throw new Error('Asset outside workspace')
  await mkdir(path.dirname(target), { recursive: true })
  await copyFile(source, target)
}
await writeFile(path.join(stage, 'package.json'), JSON.stringify({
  name: 'control-text-pet', productName: 'Control Text Pet', version: manifest.version,
  private: true, type: 'module', petMode: 'text', main: bundleEntry(root, 'main.mjs'),
}, null, 2))
const png = await readFile(path.join(control, 'static/logo.png'))
const icon = Buffer.alloc(22)
icon.writeUInt16LE(1, 2); icon.writeUInt16LE(1, 4)
icon[6] = png.readUInt32BE(16) % 256; icon[7] = png.readUInt32BE(20) % 256
icon.writeUInt16LE(1, 10); icon.writeUInt16LE(32, 12)
icon.writeUInt32LE(png.length, 14); icon.writeUInt32LE(22, 18)
const iconPath = path.join(build, 'control.ico')
await writeFile(iconPath, Buffer.concat([icon, png]))
const outputs = await packager({ dir: stage, out: build, name: 'ControlTextPet', executableName: 'ControlTextPet',
  platform: 'win32', arch: 'x64', electronVersion: version, electronZipDir: path.dirname(archive),
  appVersion: manifest.version, icon: iconPath, asar: true, prune: false, overwrite: false,
  win32metadata: { CompanyName: 'Control', FileDescription: 'Control Text Action Pet', ProductName: 'Control Text Pet' },
})
await writeFile(path.join(outputs[0], '使用说明.txt'),
  'Control 文字动作数字人\r\n\r\n双击 ControlTextPet.exe。请保留整个文件夹，可整体复制到其他 Windows x64 电脑。\r\n' +
  'Electron、人物和动作资源均已内置，无需安装 Node、Python、Java 或模型环境。\r\n' +
  '输入：[点头][微笑]好的，我记住了。然后点击“显示文字并执行”。\r\n' +
  '支持暂停、继续、停止、拖动、置顶、尺寸、隐藏与鼠标穿透；关闭控制台后可从托盘恢复或退出。\r\n' +
  '标签作用于整段文字，同类限一个。无音频、无说话口型、无模型推理。\r\n' +
  '未标注的文字只采用有限本地规则：点头/摇头动作指令及高兴/感谢等表情；不进行大模型理解。\r\n' +
  '需要支持 WebGL2 的图形驱动。本版为便携程序，未制作安装器、不注册开机启动。\r\n', 'utf8')
const result = { directory: outputs[0], executable: path.join(outputs[0], 'ControlTextPet.exe') }
await writeFile(path.join(builds, 'text-latest.json'), JSON.stringify(result, null, 2))
console.log(JSON.stringify(result, null, 2))
