/**
 * SSE (Server-Sent Events) stream parser utilities.
 *
 * Provides helpers for consuming SSE streams from fetch responses.
 */

export interface SSEEvent<T = unknown> {
  type: string
  data?: T
  phase?: string
  detail?: string
}

/**
 * Parses raw SSE text into structured events.
 * SSE frames are delimited by "\n\n" and prefixed with "data: ".
 *
 * @param text - Raw SSE text (may contain multiple frames or partial data)
 * @returns Tuple of [parsed events, remaining buffer for next chunk]
 */
export function parseSSEChunk<T = unknown>(text: string): [SSEEvent<T>[], string] {
  const events: SSEEvent<T>[] = []
  const parts = text.split('\n\n')
  const buffer = parts.pop() ?? ''

  for (const part of parts) {
    const line = part.trim()
    if (!line.startsWith('data: ')) continue

    try {
      const event = JSON.parse(line.slice('data: '.length)) as SSEEvent<T>
      events.push(event)
    } catch {
      // Skip malformed JSON
    }
  }

  return [events, buffer]
}

/**
 * Async generator that yields parsed SSE events from a ReadableStream.
 * Handles buffering of partial messages across chunks automatically.
 *
 * @param stream - ReadableStream from a fetch Response
 * @yields SSE events as they arrive
 */
export async function* streamSSEEvents<T = unknown>(
  stream: ReadableStream<Uint8Array>
): AsyncGenerator<SSEEvent<T>, void, unknown> {
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const [events, remaining] = parseSSEChunk<T>(buffer)
      buffer = remaining

      for (const event of events) {
        yield event
      }
    }
  } finally {
    reader.releaseLock()
  }
}
