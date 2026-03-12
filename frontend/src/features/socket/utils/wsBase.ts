const DEFAULT_WS_URL = 'ws://localhost:8000/ws'

export function getWsBase(): string {
  return (import.meta.env.VITE_WS_URL || DEFAULT_WS_URL).replace(/\/ws\/?$/, '')
}
