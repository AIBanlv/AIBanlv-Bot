// Both Chromium permission paths must agree; an enabled lease alone is insufficient.
export function microphonePermission({ contents, expected, petUrl, permission, details, enabled, check = false }) {
  if (!enabled || !contents || contents !== expected || contents.getURL() !== petUrl || permission !== 'media' ||
      details?.isMainFrame !== true || details.requestingUrl !== petUrl) return false
  return check ? details.mediaType === 'audio'
    : Array.isArray(details.mediaTypes) && details.mediaTypes.length === 1 && details.mediaTypes[0] === 'audio'
}
