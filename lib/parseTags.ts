const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'in', 'of', 'at', 'by', 'for', 'to', 'with', 'from', 'is', 'it',
])

export function parseTags(filename: string): { nameClean: string; tags: string[] } {
  const withoutExt = filename.replace(/\.[^.]+$/, '')
  const nameClean = withoutExt.replace(/[_\-.()\[\]]/g, ' ').replace(/\s+/g, ' ').trim()
  const tokens = nameClean.toLowerCase().split(' ')
  const tags = [...new Set(
    tokens.filter(t => {
      if (STOP_WORDS.has(t)) return false
      if (t.length < 2) return false
      if (/^\d+$/.test(t) && t.length < 3) return false
      return true
    })
  )]
  return { nameClean, tags }
}
