import { app, dialog } from 'electron'
import { createRequire, syncBuiltinESMExports } from 'node:module'
import childProcess from 'node:child_process'
globalThis.fixtureRequire = createRequire(import.meta.url)
// Bind the local stand-in before DeviceCodex captures spawn in its constructor.
if (process.env.PET_TEST_CODEX_FIXTURE && process.env.PET_TEST_NODE) {
  const original = childProcess.spawn
  childProcess.spawn = (command, args, options) => args?.includes('app-server')
    ? original(process.env.PET_TEST_NODE, [process.env.PET_TEST_CODEX_FIXTURE],
      { ...options, env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' } })
    : original(command, args, options)
  syncBuiltinESMExports()
}
// Keep test startup failures observable instead of opening a blocking native dialog.
dialog.showErrorBox = (title, message) => console.error('[fixture startup]', title, message)
app.on('browser-window-created', (_event, win) => {
  win.webContents.on('did-fail-load', (_event, code, description, url) => console.error('[fixture load]', code, description, url))
  win.webContents.on('render-process-gone', (_event, details) => console.error('[fixture renderer]', JSON.stringify(details)))
})
await import('../electron/device-main.mjs')
