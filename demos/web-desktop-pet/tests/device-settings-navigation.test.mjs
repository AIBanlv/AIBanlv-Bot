import assert from 'node:assert/strict'
import test from 'node:test'
import { settingsPages, searchSettings, SettingsNavigation } from '../electron/device-settings-navigation.mjs'

class Element extends EventTarget {
  constructor(dataset = {}) {
    super(); this.dataset = dataset; this.attributes = new Map(); this.classes = new Set()
    this.classList = { toggle: (name, enabled) => enabled ? this.classes.add(name) : this.classes.delete(name) }
    this.hidden = false; this.value = ''; this.children = []; this.textContent = ''; this.scrollTop = 200
  }
  setAttribute(name, value) { this.attributes.set(name, value) }
  removeAttribute(name) { this.attributes.delete(name) }
  replaceChildren(...children) { this.children = children }
  focus() { this.focused = true }
  click() { this.dispatchEvent(new Event('click')) }
}
function fixture() {
  const pages = [...settingsPages.filter(page => !page.container).map(page => new Element({ settingsPage: page.id })), new Element({ settingsPage: 'search' })]
  const buttons = settingsPages.filter(page => !page.parent && !page.container).map(page => new Element({ section: page.id }))
  const tabs = ['scan', 'keys', 'tools'].map(bindingTab => new Element({ bindingTab }))
  const panels = ['scan', 'keys', 'tools'].map(bindingPanel => new Element({ bindingPanel }))
  const shortcuts = settingsPages.filter(page => page.parent === 'plugins-heading').map(page => new Element({ plugin: page.id }))
  const ids = new Map(['settings-back', 'settings-search', 'settings-page-title', 'settings-search-results', 'settings-search-empty',
    'settings-help', 'settings-help-title', 'settings-help-text', 'settings-help-dialog', 'settings-help-close'].map(id => [id, new Element()]))
  const workspace = new Element(), changes = []
  const document = {
    getElementById: id => ids.get(id), createElement: () => new Element(),
    querySelectorAll: selector => ({ '[data-settings-page]': pages, '.settings-nav, .characters-nav-label': buttons, '.plugin-shortcut': shortcuts,
      '[data-binding-tab]': tabs, '[data-binding-panel]': panels })[selector],
    querySelector: selector => selector === '.settings-workspace' ? workspace : ids.get('settings-search-results').children[0],
  }
  const navigation = new SettingsNavigation({ document, onNavigate: event => changes.push(event) })
  return { navigation, pages, buttons, shortcuts, tabs, panels, ids, workspace, changes }
}

test('each menu and plugin displays one independent view without changing the trusted document URL', () => {
  const { navigation, pages, ids, workspace } = fixture()
  assert.equal(new Set(settingsPages.map(page => page.id)).size, 15)
  for (const page of settingsPages) {
    assert.equal(navigation.navigate(page.id), true)
    assert.deepEqual(pages.filter(page => !page.hidden).map(page => page.dataset.settingsPage), [page.container || page.id])
    assert.equal(ids.get('settings-page-title').textContent, page.container ? '设备绑定' : page.title)
    assert.equal(workspace.scrollTop, 0)
  }
  assert.equal(navigation.navigate('file:///private/settings'), false)
  assert.equal(navigation.current, 'codex-heading')
})

test('Key search opens binding Key tab and keyboard tabs preserve mounted drafts', () => {
  const { navigation, tabs, panels, changes } = fixture()
  navigation.navigate('model-settings')
  assert.equal(navigation.current, 'binding')
  assert.equal(panels[1].hidden, false)
  assert.equal(tabs[1].attributes.get('aria-selected'), 'true')
  panels[1].value = 'unsaved-key'
  const key = new Event('keydown'); key.key = 'ArrowLeft'; tabs[1].dispatchEvent(key)
  assert.equal(panels[0].hidden, false)
  assert.equal(tabs[0].tabIndex, 0)
  assert.equal(changes.at(-1).tab, 'scan')
  tabs[1].click(); navigation.navigate('plugins-heading'); navigation.navigate('binding')
  assert.equal(panels[1].hidden, false)
  assert.equal(panels[1].value, 'unsaved-key')
})

test('paired settings retain all three tabs and their selection; arrow keys reach the connected summary', () => {
  const {navigation,tabs,panels}=fixture()
  navigation.setBound(true)
  assert.equal(tabs[0].hidden,false);assert.equal(panels[0].hidden,false)
  navigation.selectBindingTab('keys')
  const key=new Event('keydown');key.key='ArrowLeft';tabs[1].dispatchEvent(key)
  assert.equal(navigation.bindingTab,'scan');assert.equal(tabs[0].tabIndex,0)
  navigation.selectBindingTab('keys')
  navigation.setBound(false)
  assert.equal(tabs[0].hidden,false);assert.equal(panels[0].hidden,false)
})

test('AI tools have an independent searchable tab and keyboard navigation preserves local drafts', () => {
  const {navigation,tabs,panels}=fixture()
  panels[1].value='unsaved-private-key'
  navigation.navigate('ai-tools-settings')
  assert.equal(navigation.current,'binding');assert.equal(navigation.bindingTab,'tools')
  assert.equal(panels[1].hidden,true);assert.equal(panels[2].hidden,false)
  assert.equal(tabs[2].attributes.get('aria-selected'),'true')
  navigation.setBound(true);assert.equal(navigation.bindingTab,'tools')
  const press=(index,key)=>{const event=new Event('keydown');event.key=key;tabs[index].dispatchEvent(event)}
  press(2,'ArrowRight');assert.equal(navigation.bindingTab,'scan')
  press(0,'End');assert.equal(navigation.bindingTab,'tools')
  press(2,'Home');assert.equal(navigation.bindingTab,'scan')
  press(0,'ArrowLeft');assert.equal(navigation.bindingTab,'tools')
  press(2,'ArrowLeft');assert.equal(navigation.bindingTab,'keys')
  assert.equal(panels[1].value,'unsaved-private-key')
  assert.equal(navigation.selectBindingTab('invalid'),false);assert.equal(navigation.bindingTab,'keys')
  assert.ok(searchSettings('AI 工具状态').some(page=>page.id==='ai-tools-settings'))
})

test('plugin cards use a shared back action, retain drafts and highlight their parent menu', () => {
  const { navigation, buttons, shortcuts, ids, pages } = fixture()
  navigation.navigate('plugins-heading')
  const assistant = pages.find(page => page.dataset.settingsPage === 'assistant-heading')
  assistant.value = 'unsaved-key'
  shortcuts[0].click()
  assert.equal(navigation.current, 'assistant-heading')
  assert.equal(ids.get('settings-back').hidden, false)
  assert.equal(buttons.find(button => button.dataset.section === 'plugins-heading').attributes.get('aria-current'), 'page')
  ids.get('settings-back').click()
  assert.equal(navigation.current, 'plugins-heading')
  assert.equal(ids.get('settings-back').hidden, true)
  shortcuts[0].click()
  assert.equal(assistant.value, 'unsaved-key')
})

test('search displays destination buttons rather than mixing editor forms, and clears back to the prior page', () => {
  const { navigation, ids, pages } = fixture()
  navigation.navigate('window-settings')
  navigation.search('邮箱')
  assert.deepEqual(pages.filter(page => !page.hidden).map(page => page.dataset.settingsPage), ['search'])
  assert.equal(ids.get('settings-search-results').children.length, 1)
  ids.get('settings-search-results').children[0].click()
  assert.equal(navigation.current, 'mail-heading')
  navigation.search('unmatched-setting')
  assert.equal(ids.get('settings-search-empty').hidden, false)
  navigation.search('')
  assert.equal(navigation.current, 'mail-heading')
})

test('search supports plugin names, translated titles and local settings keywords', () => {
  assert.deepEqual(searchSettings('API KEY').map(page => page.id), ['model-settings', 'assistant-heading'])
  assert.deepEqual(searchSettings('业务空间').map(page => page.id), ['model-settings'])
  assert.deepEqual(searchSettings('开机').map(page => page.id), ['role-controls'])
  assert.equal(settingsPages.find(page => page.id === 'role-controls').title, '形象设置')
  assert.deepEqual(searchSettings('悬浮').map(page => page.id), ['role-controls'])
  assert.deepEqual(searchSettings('email', title => title === '只读邮箱' ? 'Read-only email' : title).map(page => page.id), ['mail-heading'])
})

test('legacy window settings links open role settings and binding stays searchable', () => {
  const { navigation, pages, ids } = fixture()
  assert.equal(navigation.navigate('window-settings'), true)
  assert.equal(navigation.current, 'role-controls')
  assert.deepEqual(pages.filter(page => !page.hidden).map(page => page.dataset.settingsPage), ['role-controls'])
  navigation.navigate('binding')
  assert.equal(ids.get('settings-page-title').textContent, '设备绑定')
  assert.deepEqual(searchSettings('连接').map(page => page.id), ['binding','codex-heading'])
})
