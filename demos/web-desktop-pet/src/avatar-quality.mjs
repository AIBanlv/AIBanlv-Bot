// Same 2x detail ceiling as iOS; no CSS blur/sharpen filter or asset mutation.
export function avatarPixelRatio(tier, nativeRatio = 1) {
  const dpr = Number.isFinite(nativeRatio) && nativeRatio > 0 ? nativeRatio : 1
  if (tier === 'high') return 2
  if (tier === 'low') return Math.min(1, 0.75 * dpr)
  return Math.min(1.5, dpr)
}
