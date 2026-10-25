export function parseSseData<T>(block: string): T | null {
  const payload = block
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trimStart())
    .join('\n')

  if (!payload) return null
  try {
    const value: unknown = JSON.parse(payload)
    return value && typeof value === 'object' ? value as T : null
  } catch {
    return null
  }
}

export function reconnectDelay(attempt: number) {
  return Math.min(1000 * 2 ** Math.max(0, attempt), 5000)
}
