// Follow the same visible navigation as a user; never force hidden controls.
export async function showSettings(page, id) {
  if (id === 'window-settings') id = 'role-controls'
  if (['assistant-heading', 'mail-heading', 'workbuddy-heading', 'codex-heading'].includes(id)) {
    await page.locator('[data-section="plugins-heading"]').click()
    await page.locator(`[data-plugin="${id}"]`).click()
  } else if (['model-settings','ai-tools-settings'].includes(id)) {
    await page.locator('[data-section="binding"]').click()
    await page.locator(id==='model-settings'?'#binding-tab-keys':'#binding-tab-tools').click()
  } else if (id === 'character-editor') {
    await page.locator('[data-section="characters"]').click()
    await page.locator('#sidebar-character-new').click()
  } else if (id === 'points-details') {
    await page.locator('#account-menu > summary').click()
    await page.locator('#account-details').click()
  } else {
    await page.locator(`[data-section="${id}"]`).click()
  }
}
