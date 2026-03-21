const API_BASE_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function normalizePath(path: string): string {
  return path.startsWith('/') ? path : `/${path}`
}

function buildApiUrl(path: string): string {
  return `${API_BASE_URL}${normalizePath(path)}`
}

export async function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(buildApiUrl(path), init)
}

export async function apiGetJson<T>(path: string): Promise<T> {
  const response = await apiFetch(path)
  if (!response.ok) {
    throw new Error(`GET ${path} failed (${response.status})`)
  }
  return response.json() as Promise<T>
}

export async function apiPostJson<TResponse, TBody = unknown>(
  path: string,
  body: TBody
): Promise<TResponse> {
  const response = await apiFetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`POST ${path} failed (${response.status}): ${detail || response.statusText}`)
  }

  return response.json() as Promise<TResponse>
}

export async function apiDelete(path: string): Promise<void> {
  const response = await apiFetch(path, { method: 'DELETE' })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(`DELETE ${path} failed (${response.status}): ${detail || response.statusText}`)
  }
}
