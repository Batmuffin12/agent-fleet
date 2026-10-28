// Small text and path helpers every part of the mod shares.

/** A path as one comparable string: forward slashes, no trailing slash, lower case. */
export const norm = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

/** The last `parts` segments of a path: "C:/a/b/c" → "b/c". */
export const tail = (p: string, parts = 2) =>
  p.replace(/\\/g, '/').split('/').filter(Boolean).slice(-parts).join('/')

/** One line, at most `n` characters, an ellipsis where it was cut. */
export const clip = (s: string, n: number) => {
  const one = s.replace(/\s+/g, ' ').trim()
  return one.length > n ? one.slice(0, n - 1) + '…' : one
}

/** "45s", "12m", "3h". */
export const ago = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000))
  if (s < 60) return `${s}s`
  if (s < 3600) return `${Math.round(s / 60)}m`
  return `${Math.round(s / 3600)}h`
}

/** "1 branch", "2 branches". */
export const plural = (n: number, w: string) =>
  `${n} ${w}${n === 1 ? '' : w.endsWith('h') ? 'es' : 's'}`

/** What the person types after @ to talk to an agent: "auth worker" → "auth-worker". */
export const slug = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24) || 'agent'

/** `s` cut or padded to exactly `n` characters. */
export const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n))

/** "22:12", in local time. */
export const clock = (at: number) => {
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}
