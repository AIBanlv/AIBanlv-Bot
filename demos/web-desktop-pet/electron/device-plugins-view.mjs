const $ = id => document.getElementById(id)
const bridge = window.controlDevice
const builtinCount = document.querySelectorAll('.plugin-shortcut').length
let busy = false

function render(plugins) {
  $('online-plugins-list').replaceChildren(...plugins.map(plugin => {
    const article = document.createElement('article'), heading = document.createElement('h4')
    article.className = 'online-plugin-entry'; article.setAttribute('role', 'listitem')
    heading.textContent = plugin.name
    if (plugin.version) {
      const version = document.createElement('span'); version.className = 'plugin-badge'
      version.textContent = plugin.version; heading.append(version)
    }
    article.append(heading)
    if (plugin.description) {
      const description = document.createElement('p'); description.className = 'secondary'
      description.textContent = plugin.description; article.append(description)
    }
    return article
  }))
  $('plugins-count').textContent = String(builtinCount + plugins.length)
}

async function load() {
  if (busy) return
  busy = true; render([])
  $('online-plugins-refresh').disabled = true
  $('online-plugins-list').setAttribute('aria-busy', 'true')
  $('online-plugins-status').textContent = '正在查询线上插件…'
  try {
    const result = await bridge.queryPlugins()
    if (!result?.ok) {
      $('online-plugins-status').textContent = result?.code === 'NOT_PUBLISHED'
        ? '线上插件列表尚未发布' : '线上插件查询失败，请刷新重试'
      return
    }
    render(result.plugins)
    $('online-plugins-status').textContent = result.plugins.length ? '线上插件列表已更新' : '暂无线上插件'
  } catch { $('online-plugins-status').textContent = '线上插件查询失败，请刷新重试' }
  finally {
    busy = false; $('online-plugins-refresh').disabled = false
    $('online-plugins-list').setAttribute('aria-busy', 'false')
  }
}
$('online-plugins-refresh').addEventListener('click', () => { void load() })
window.addEventListener('settings-page', event => { if (event.detail === 'plugins-heading') void load() })
