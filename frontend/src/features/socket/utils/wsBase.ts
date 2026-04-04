const DEFAULT_WS_URL = 'ws://127.0.0.1:8000/ws'

export function getWsBase(): string {
  return (import.meta.env.VITE_WS_URL || DEFAULT_WS_URL).replace(/\/ws\/?$/, '')
}
