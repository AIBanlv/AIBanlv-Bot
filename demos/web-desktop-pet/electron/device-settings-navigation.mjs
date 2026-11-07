// All forms stay mounted so navigation preserves drafts and existing IPC scope.
// Do not change location/hash: the trusted settings sender uses the exact URL.
export const settingsPages = [
  { id: 'characters', title: '角色列表', keywords: '角色 公共 私有 本地 离线 文字 对话' },
  { id: 'character-editor', title: '新增角色', parent: 'characters', keywords: '新增 编辑 本地 在线 LAM 提示词 声音 照片' },
  { id: 'binding', title: '设备绑定', keywords: '扫码 绑定 登录 注册 二维码 设备授权 连接' },
  { id: 'model-settings', title: '本地模式设置', container: 'binding', tab: 'keys', keywords: '模型 来源 DeepSeek Realtime API Key 密钥 业务空间 Workspace 地域 音色' },
  { id: 'ai-tools-settings', title: 'AI 工具状态', container: 'binding', tab: 'tools', keywords: 'Harness Codex WorkBuddy 在线 就绪 自动关联' },
  { id: 'role-controls', title: '形象设置', keywords: '角色 形象 音量 清晰度 缓存 窗口 悬浮 开机 自动启动 置顶 鼠标 穿透 粒子 尺寸' },
  { id: 'ai-moments', title: 'AI智囊团', keywords: '主动式 顾问 讨论 解决方案 动态 发表 图片 视频 点赞 评论 回复 角色' },
  { id: 'scheduled-tasks', title: '定时任务', keywords: '提醒 时间 重复 通知' },
  { id: 'invite-section', title: '邀请记录', keywords: '邀请 好友 账号 账户 成功 时间 记录 积分' },
  { id: 'plugins-heading', title: '插件中心', keywords: '插件 工具 扩展' },
  { id: 'points-details', title: '积分明细', keywords: '余额 积分 收支 消耗 流水 充值' },
  { id: 'assistant-heading', title: 'Harness', parent: 'plugins-heading', keywords: 'DeepSeek API Key 电脑助手 密钥 搜索' },
  { id: 'mail-heading', title: '只读邮箱', parent: 'plugins-heading', keywords: '邮箱 IMAP 授权码 来信 邮件' },
  { id: 'workbuddy-heading', title: 'WorkBuddy', parent: 'plugins-heading', keywords: '任务 监控 日志 播报' },
  { id: 'codex-heading', title: 'Codex', parent: 'plugins-heading', keywords: '任务 App Server 日志 连接 播报' },
]

export function searchSettings(query, labels = text => text) {
  const value = query.trim().toLocaleLowerCase()
  return value ? settingsPages.filter(page => `${page.title} ${labels(page.title)} ${page.keywords}`.toLocaleLowerCase().includes(value)) : []
}

export class SettingsNavigation {
  constructor({ document, translate = text => text, onNavigate = () => {} }) {
    Object.assign(this, { document, translate, onNavigate })
    this.current = 'binding'
    this.previous = 'binding'
    this.pages = [...document.querySelectorAll('[data-settings-page]')]
    this.buttons = [...document.querySelectorAll('.settings-nav, .characters-nav-label')]
    this.bindingTab = 'scan'
    this.tabs = [...document.querySelectorAll('[data-binding-tab]')]
    this.panels = [...document.querySelectorAll('[data-binding-panel]')]
    for (const tab of this.tabs) {
      tab.addEventListener('click', () => this.selectBindingTab(tab.dataset.bindingTab))
      tab.addEventListener('keydown', event => {
        const tabs = this.tabs.filter(item => !item.hidden), index = tabs.indexOf(tab)
        const next = { ArrowLeft: (index + tabs.length - 1) % tabs.length,
          ArrowRight: (index + 1) % tabs.length, Home: 0, End: tabs.length - 1 }[event.key]
        if (next === undefined) return
        event.preventDefault(); this.selectBindingTab(tabs[next].dataset.bindingTab)
        tabs[next].focus()
      })
    }
    for (const button of this.buttons) button.addEventListener('click', () => this.navigate(button.dataset.section))
    for (const button of document.querySelectorAll('.plugin-shortcut')) button.addEventListener('click', () => this.navigate(button.dataset.plugin))
    document.getElementById('settings-back').addEventListener('click', () => this.navigate(settingsPages.find(page => page.id === this.current)?.parent || 'plugins-heading'))
    const search = document.getElementById('settings-search')
    search.addEventListener('input', () => this.search(search.value))
    search.addEventListener('keydown', event => {
      if (event.key === 'Escape') this.navigate(this.previous)
      if (event.key === 'Enter') document.querySelector('#settings-search-results button')?.click()
    })
    this.navigate('binding', { focus: false })
  }

  navigate(id, { focus = true, clearSearch = true } = {}) {
    if (id === 'window-settings') id = 'role-controls'
    let page = settingsPages.find(page => page.id === id)
    if (!page && id !== 'search') return false
    if (page?.container) {
      this.selectBindingTab(page.tab, false)
      id = page.container; page = settingsPages.find(page => page.id === id)
    }
    const from = this.current
    this.current = id
    for (const element of this.pages) element.hidden = element.dataset.settingsPage !== id
    const active = id === 'character-editor' ? id : page?.parent || id
    for (const button of this.buttons) {
      const selected = button.dataset.section === active
      button.classList.toggle('active', selected)
      if (selected) button.setAttribute('aria-current', 'page')
      else button.removeAttribute('aria-current')
    }
    const title = this.document.getElementById('settings-page-title')
    title.textContent = this.translate(page?.title || '搜索结果')
    this.document.getElementById('settings-back').hidden = !page?.parent
    const backLabel = this.document.getElementById('settings-back').querySelector?.('span')
    if (backLabel) backLabel.textContent = this.translate(page?.parent === 'characters' ? '返回角色列表' : '返回插件中心')
    if (clearSearch) this.document.getElementById('settings-search').value = ''
    this.document.querySelector('.settings-workspace').scrollTop = 0
    if (focus) title.focus({ preventScroll: true })
    this.onNavigate({ from, to: id, tab: id === 'binding' ? this.bindingTab : undefined })
    return true
  }

  selectBindingTab(name, notify = true) {
    if (!this.tabs.some(tab => tab.dataset.bindingTab === name)) return false
    this.bindingTab = name
    for (const tab of this.tabs) {
      const selected = tab.dataset.bindingTab === name
      tab.setAttribute('aria-selected', String(selected)); tab.tabIndex = selected ? 0 : -1
    }
    for (const panel of this.panels) panel.hidden = panel.dataset.bindingPanel !== name
    if (notify) this.onNavigate({ from: this.current, to: 'binding', tab: name })
    return true
  }

  setBound(bound) {
    if (this.bound === bound) return
    const previous = this.bound
    this.bound = bound
    // Keep all tabs and the user's current selection. Only the scan panel's
    // content changes from QR to connected summary after a confirmed binding.
    // An explicit unbind returns to pairing; a transient unknown state never does.
    if (previous === true && !bound) this.selectBindingTab('scan', false)
  }

  search(query) {
    if (this.current !== 'search') this.previous = this.current
    if (!query.trim()) { this.navigate(this.previous, { focus: false }); return }
    const results = searchSettings(query, this.translate)
    const list = this.document.getElementById('settings-search-results')
    list.replaceChildren(...results.map(page => {
      const button = this.document.createElement('button')
      button.type = 'button'; button.className = 'settings-search-result'
      button.textContent = this.translate(page.title)
      button.addEventListener('click', () => this.navigate(page.id))
      return button
    }))
    this.document.getElementById('settings-search-empty').hidden = results.length > 0
    this.navigate('search', { focus: false, clearSearch: false })
  }
}
