import path from 'node:path'

// Keep the branded identity stable across releases, but separate it from the
// old Control/Electron taskbar group and from development instances.
export const aibanlvAppId = packaged => 'com.zhanlv.aibanlv.desktop' + (packaged ? '' : '.source')

export function repairOwnedShortcuts({ shell, executable, desktop, appData }) {
  const links = [path.win32.join(desktop, 'AIBanlv.lnk'),
    path.win32.join(appData, 'Microsoft/Windows/Start Menu/Programs/AIBanlv/AIBanlv.lnk')]
  for (const file of links) {
    try {
      const existing = shell.readShortcutLink(file)
      if (path.win32.normalize(existing.target).toLowerCase() !== path.win32.normalize(executable).toLowerCase() || existing.args) continue
      shell.writeShortcutLink(file, 'update', { target: executable, icon: executable, iconIndex: 0,
        appUserModelId: aibanlvAppId(true) })
    } catch { /* Missing/custom shortcuts do not prevent application startup. */ }
  }
}
