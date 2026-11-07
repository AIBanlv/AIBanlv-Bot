import test from 'node:test'
import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'

test('four READMEs use the matching introduction image and a concise local rendering highlight',async()=>{
  const root=new URL('../../../',import.meta.url)
  for(const [file,image] of [['README.md','aibanlvbot.png'],['README.zh-Hant.md','aibanlvbot.png'],['README.en.md','lingxi.png'],['README.ja.md','lingxi.png']]) {
    const text=(await readFile(new URL(file,root),'utf8')).replaceAll('\r\n','\n'),intro=text.split('\n## ')[0]
    assert.ok(intro.includes(`(docs/image/${image})`),`${file} must show its introduction image`)
    assert.equal((text.match(new RegExp(`docs/image/${image.replace('.', '\\.')}`,'g'))||[]).length,1)
    assert.doesNotMatch(intro,/尚待实现|尚待實作|not yet implemented|未実装/)
    assert.ok(text.startsWith('[简体中文](README.md) · [繁體中文](README.zh-Hant.md) · [English](README.en.md) · [日本語](README.ja.md)\n'),`${file} must start with language selection`)
    const intel=text.split('\n').find(line=>line.startsWith('| Mac · Intel |'))
    assert.match(intel,/暂未适配|暫未適配|Not yet adapted|未対応/)
    assert.doesNotMatch(intel,/https?:|源码支持|source builds are supported|ソースビルドに対応/)
    const highlight=text.split('\n').find(line=>line.startsWith('> '))
    assert.match(highlight,/无需独立显卡|無需獨立顯示卡|no dedicated GPU required|専用 GPU 不要/)
    assert.match(highlight,/3D/)
    assert.doesNotMatch(highlight,/Apache-2\.0|发行说明|發行說明|release notes|リリースノート/)
    assert.match(text,/Apache-2\.0/,'License information must remain in its own section')
    const mobileStart=text.indexOf('src="docs/image/apple.png"')
    const mobileTable=text.slice(text.lastIndexOf('<table>',mobileStart),text.indexOf('</table>',mobileStart))
    assert.equal((mobileTable.match(/暂未开源|暫未開源|not open source yet|ソースコード未公開/g)||[]).length,2,'Both mobile platforms must be marked as not open source yet')
    for(const qr of ['apple.png','android.png']) {
      assert.ok(text.includes(`src="docs/image/${qr}"`))
      assert.ok(text.indexOf(`src="docs/image/${qr}"`)>text.indexOf(intel),'Mobile downloads follow the desktop table')
      const bytes=await readFile(new URL(`docs/image/${qr}`,root))
      assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10])
    }
    const bytes=await readFile(new URL(`docs/image/${image}`,root))
    assert.deepEqual([...bytes.subarray(0,8)],[137,80,78,71,13,10,26,10])
  }
})

test('four READMEs delegate Mac bundle details and omit the expanded advisory section',async()=>{
  const root=new URL('../../../',import.meta.url)
  for(const file of ['README.md','README.zh-Hant.md','README.en.md','README.ja.md']) {
    const text=await readFile(new URL(file,root),'utf8')
    assert.doesNotMatch(text,/^### (?:AI智囊团：|AI智囊團：|AI Advisory Council:|AIアドバイザーチーム：)/m)
    assert.doesNotMatch(text,/^### (?:Apple Silicon|Complete source runtime ZIP)/m)
    assert.doesNotMatch(text,/1\.0\.0-candidate\.20261105\.1|5492459e74a9afdbbfc950a61a16b09a91cad02719e714cb7389cc2fabfdee36/)
    assert.ok(text.includes('(docs/MAC_SOURCE_BUNDLE.md)'),`${file} keeps the detailed Mac installation entry`)
    assert.ok(text.includes('(docs/INSTALL_FOR_AGENTS.md)'),`${file} keeps the common installation entry`)
  }
  const guide=await readFile(new URL('docs/MAC_SOURCE_BUNDLE.md',root),'utf8')
  assert.ok(guide.includes('SHA-256'))
  assert.ok(guide.includes('Install AIBanlv.command'))
})

test('four READMEs lead with desktop Bot capabilities and a concrete task workflow',async()=>{
  const root=new URL('../../../',import.meta.url)
  for(const [file,capabilities,workflow,downloads] of [
    ['README.md','Bot 能力','从一句话到执行结果','下载与安装'],
    ['README.zh-Hant.md','Bot 能力','從一句話到執行結果','下載與安裝'],
    ['README.en.md','Bot capabilities','From a request to a result','Download'],
    ['README.ja.md','Bot の機能','ひと言の依頼から実行結果へ','ダウンロード'],
  ]) {
    const text=(await readFile(new URL(file,root),'utf8')).replaceAll('\r\n','\n')
    assert.match(text,/^# AIBanlv Bot$/m,`${file} uses the requested short project title`)
    const start=text.indexOf(`\n## ${capabilities}\n`),end=text.indexOf(`\n## ${workflow}\n`)
    assert.ok(start>0&&end>start,`${file} introduces capabilities before its task workflow`)
    assert.ok(end<text.indexOf(`\n## ${downloads}\n`),`${file} shows the workflow before installation`)
    for(const name of ['Harness','Codex','WorkBuddy'])assert.ok(text.slice(start,end).includes(name))
    const examples=text.slice(end,text.indexOf('\n## ',end+1))
    assert.match(examples,/```text\n[\s\S]*Codex[\s\S]*\n```/)
    assert.ok(text.includes('(docs/CLIENT_SECURITY.md)'),`${file} keeps task permissions and data boundaries accessible`)
  }
})

test('four READMEs credit Harness and link project-owned collaboration and security policies',async()=>{
  const root=new URL('../../../',import.meta.url)
  for(const file of ['README.md','README.zh-Hant.md','README.en.md','README.ja.md']) {
    const text=await readFile(new URL(file,root),'utf8')
    assert.ok(text.includes('https://github.com/deepseek-ai/deepseek-harness'))
    for(const policy of ['CODE_OF_CONDUCT.md','CONTRIBUTING.md','SECURITY.md'])assert.ok(text.includes(`(${policy})`))
    assert.ok(text.includes('mailto:frank750166@gmail.com'))
  }
  for(const policy of ['CODE_OF_CONDUCT.md','CONTRIBUTING.md','SECURITY.md']) {
    const text=await readFile(new URL(policy,root),'utf8')
    assert.match(text,/AIBanlv/)
    assert.ok(text.includes('mailto:frank750166@gmail.com'))
    assert.doesNotMatch(text,/@openmaus|soniworks/)
  }
})

test('README navigation, media and local guide links remain valid after the layout change',async()=>{
  const root=new URL('../../../',import.meta.url)
  for(const file of ['README.md','README.zh-Hant.md','README.en.md','README.ja.md']) {
    const text=(await readFile(new URL(file,root),'utf8')).replaceAll('\r\n','\n')
    const anchors=new Set([...text.matchAll(/^#{1,6} (.+)$/gm)].map(([,heading])=>heading.toLowerCase()
      .replace(/[^\p{L}\p{N}\p{M}_\-\s]/gu,'').replace(/ /g,'-')))
    for(const [,target] of text.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)) {
      if(target.startsWith('#'))assert.ok(anchors.has(decodeURIComponent(target.slice(1))),`${file}: missing ${target}`)
      else if(!/^[a-z][a-z\d+.-]*:/i.test(target))await access(new URL(target.split('#')[0],root))
    }
    for(const [,target] of text.matchAll(/(?:src|href)="(docs\/[^"#]+)"/g))await access(new URL(target,root))
    assert.equal((text.match(/^```/gm)||[]).length%2,0,`${file}: unclosed code fence`)
  }
})
