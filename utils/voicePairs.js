function nameOf(item) {
  return String(item.voiceName || item.name || '').normalize('NFKC').trim().replace(/\s*[·•]\s*(?:CosyVoice|Realtime)\s*$/i, '').trim()
}
function vendorID(item) { return String(item.voice || item.elevenId || item.voiceId || item.id || '') }
function providerOf(item) {
  const model = String(item.targetModel || item.target_model || item.azureLanguage || '')
  const id = vendorID(item)
  if (model === 'qwen-audio-3.0-realtime-flash' || id.startsWith('qwen-audio-3.0-realtime-flash-') || /^longan/.test(id)) return 'qwen-realtime'
  return model.startsWith('qwen-') || id.startsWith('qwen-') ? 'unsupported' : 'ali-multimodal'
}
export function groupedVoices(items) {
  const buckets = new Map()
  for (const item of Array.isArray(items) ? items : []) {
    const name = nameOf(item)
    // Dual-model clones share the training recording even after a rename.
    // Legacy rows without recording metadata still pair by normalized name.
    const tenant = String(item.tenantId || item.tenant_id || '')
    const owner = tenant ? 'tenant:' + tenant : item.isPublicVoice === true ? 'public' : 'unowned:' + buckets.size
    const recording = String(item.localUrl || '').trim()
    const identity = recording ? ['recording', recording] : ['name', name ? name.toLowerCase() : 'unnamed:' + buckets.size]
    const key = JSON.stringify([owner, ...identity])
      + (providerOf(item) === 'unsupported' ? ':unsupported:' + String(item.id) : '')
    if (!buckets.has(key)) buckets.set(key, [])
    buckets.get(key).push(item)
  }
  const result = []
  for (const rows of buckets.values()) {
    const ali = rows.filter(row => providerOf(row) === 'ali-multimodal')
    const qwen = rows.filter(row => providerOf(row) === 'qwen-realtime')
    const groups = ali.length === 1 && qwen.length === 1 ? [rows] : rows.map(row => [row])
    for (const group of groups) {
      const canonical = group.find(row => providerOf(row) === 'ali-multimodal') || group[0]
      result.push({...canonical, voiceName:nameOf(canonical), variantVoices:group,
        voiceAliases:group.flatMap(row => ['id','voice','elevenId','voiceId'].map(key => String(row[key] || ''))).filter(Boolean),
        voiceVariants:Object.fromEntries(group.map(row => [providerOf(row),row]))})
    }
  }
  return result
}
export function resolvePairedVoice(items, selected, provider) {
  const group = groupedVoices(items).find(item => item.voiceAliases.includes(String(selected)))
  if (!group) return null
  const variant = group.voiceVariants[provider]
  return variant ? String(variant.id || vendorID(variant)) : null
}
