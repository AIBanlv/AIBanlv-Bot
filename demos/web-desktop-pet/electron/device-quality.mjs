// This is a starting resolution, not a claim about LAM acceleration. The renderer
// can reduce it further after measuring actual frames on this avatar.
export function renderingQuality({ memoryGB = 0, cores = 0, gpu = '' } = {}) {
  const software = /swiftshader|llvmpipe|software|microsoft basic/i.test(gpu)
  const discrete = /nvidia|geforce|radeon rx|radeon pro|apple m[1-9]/i.test(gpu)
  const tier = software || memoryGB < 8 || cores < 4 ? 'low'
    : discrete && memoryGB >= 16 && cores >= 8 ? 'high' : 'balanced'
  return { tier, pixelRatio: { low: 0.75, balanced: 1, high: 1.5 }[tier] }
}
