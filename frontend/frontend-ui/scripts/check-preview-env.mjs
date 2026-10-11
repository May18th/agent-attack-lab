const raw = process.env.VITE_AGENT_API?.trim()

if (!raw) {
  throw new Error('Preview build requires VITE_AGENT_API pointing to an isolated HTTPS API.')
}

let url
try {
  url = new URL(raw)
} catch {
  throw new Error('VITE_AGENT_API must be a valid absolute URL.')
}

if (url.protocol !== 'https:') {
  throw new Error('Preview VITE_AGENT_API must use HTTPS.')
}

const blockedHosts = new Set([
  'api.yuanyiagentzhandui.cn',
  'localhost',
  '127.0.0.1',
  '::1',
])
if (blockedHosts.has(url.hostname.toLowerCase())) {
  throw new Error('Preview VITE_AGENT_API must not target production or a local host.')
}

console.log(`Preview API accepted: ${url.origin}`)
