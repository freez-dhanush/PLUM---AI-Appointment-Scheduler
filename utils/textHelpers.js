export function cleanOCRText(s) {
  if (!s) return ""
  let t = s.normalize('NFKD')
  t = t.replace(/[^A-Za-z0-9@:\-\/\s,.]/g, ' ')
  t = t.replace(/[\u2018\u2019\u201C\u201D]/g, "'")
  t = t.replace(/[0O](?=[a-zA-Z])/g, 'o')  
  t = t.replace(/1(?=[a-zA-Z])/g, 'l')     
  t = t.replace(/rn/g, 'm')
  t = t.replace(/vv/g, 'w')
  t = t.replace(/\s+/g, ' ').trim()
  return t.toLowerCase()
}

export function levenshtein(a, b) {
  const m = a.length, n = b.length
  if (m === 0) return n
  if (n === 0) return m
  const v0 = new Array(n + 1).fill(0)
  const v1 = new Array(n + 1).fill(0)
  for (let j = 0; j <= n; j++) v0[j] = j
  for (let i = 0; i < m; i++) {
    v1[0] = i + 1
    const ai = a[i]
    for (let j = 0; j < n; j++) {
      const cost = ai === b[j] ? 0 : 1
      v1[j + 1] = Math.min(v1[j] + 1, v0[j + 1] + 1, v0[j] + cost)
    }
    for (let j = 0; j <= n; j++) v0[j] = v1[j]
  }
  return v1[n]
}

export function similarity(a, b) {
  if (!a || !b) return 0
  const dist = levenshtein(a, b)
  return 1 - dist / Math.max(a.length, b.length)
}
