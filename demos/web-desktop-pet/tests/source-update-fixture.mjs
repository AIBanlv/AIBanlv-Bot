import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execute = promisify(execFile)
export async function sourceFixture(t) {
  const directory = await mkdtemp(path.join(tmpdir(), 'source-git-'))
  t.after(() => rm(directory, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }))
  const remote = path.join(directory, 'remote.git'), upstream = path.join(directory, 'upstream'), root = path.join(directory, '用户 checkout')
  const git = (cwd, ...args) => execute('git', ['-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid',
    '-c', 'commit.gpgsign=false', ...args], { cwd, windowsHide: true })
  await git(directory, 'init', '--bare', '-q', '-b', 'master', remote)
  await git(directory, 'clone', '-q', remote, upstream)
  await writeFile(path.join(upstream, 'app.txt'), 'old')
  await writeFile(path.join(upstream, '.gitignore'), 'runtime.local.json\n')
  await git(upstream, 'add', '.'); await git(upstream, 'commit', '-qm', '初始化夹具'); await git(upstream, 'push', '-q', 'origin', 'master')
  await git(directory, 'clone', '-q', remote, root)
  const publish = async (file = 'app.txt', value = 'new') => {
    await mkdir(path.dirname(path.join(upstream, file)), { recursive: true })
    await writeFile(path.join(upstream, file), value)
    await git(upstream, 'add', '-f', file); await git(upstream, 'commit', '-qm', '更新夹具'); await git(upstream, 'push', '-q', 'origin', 'master')
  }
  return { directory, root, upstream, git, publish }
}
