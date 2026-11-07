import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { t } from '../electron/device-i18n.mjs'
import { settingsPages } from '../electron/device-settings-navigation.mjs'

const description = '主动式 AI 顾问系统，根据日常互动内容，AI主动讨论并找到解决方案'
const fileText = name => readFile(new URL(name, import.meta.url), 'utf8')

test('advisory council uses the requested name and description in four languages', () => {
  for (const [locale, name, summary] of [
      ['zh-Hans', 'AI智囊团', description],
      ['zh-Hant', 'AI智囊團', '主動式 AI 顧問系統，根據日常互動內容，AI主動討論並找到解決方案'],
      ['en', 'AI Advisory Council', 'A proactive AI advisory system: based on everyday interactions, AI initiates discussions and finds solutions.'],
      ['ja', 'AIアドバイザーチーム', '日々のやり取りをもとに、AI が自ら議論し解決策を見つける、能動型 AI アドバイザーシステム。'],
  ]) {
    assert.equal(t('AI智囊团', locale), name)
    assert.equal(t(description, locale), summary)
    assert.ok(!/朋友圈|Moments|モーメント/.test(t('AI智囊团服务繁忙，请稍后重试', locale)))
  }
})

test('navigation, page and local settings are renamed without changing protocol identities', async () => {
  assert.equal(settingsPages.find(page => page.id === 'ai-moments').title, 'AI智囊团')
  const html = await fileText('../electron/device.html')
  assert.ok(html.includes('id="ai-moments"'))
  assert.ok(html.includes('id="moments-description" class="secondary">' + description))
  assert.ok(html.includes('aria-label="关于AI智囊团"'))
  assert.ok(html.includes('自动生成本地智囊团'))
  for (const name of ['device.html', 'device-i18n.mjs', 'device-moments-view.mjs', 'device-local-workspace.mjs']) {
    assert.doesNotMatch(await fileText('../electron/' + name), /朋友圈|AI Moments|AI ?モーメント/)
  }
})

test('four README feature introductions document the advisory council', async () => {
  for (const [file, name] of [['README.md', 'AI智囊团'], ['README.zh-Hant.md', 'AI智囊團'], ['README.en.md', 'AI Advisory Council'], ['README.ja.md', 'AIアドバイザーチーム']]) {
    const text = await fileText('../../../' + file)
    assert.ok(text.includes(name))
    assert.doesNotMatch(text, /朋友圈|AI Moments|AI ?モーメント/)
  }
})
