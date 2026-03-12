export function pickSupportedAudioMimeType(
  candidates: readonly string[],
  fallback: string
): string {
  for (const candidate of candidates) {
    if (MediaRecorder.isTypeSupported(candidate)) {
      return candidate
    }
  }
  return fallback
}

export function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onloadend = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('Failed to read blob as base64'))
        return
      }

      const base64 = result.split(',')[1]
      if (!base64) {
        reject(new Error('Blob conversion produced empty payload'))
        return
      }

      resolve(base64)
    }
    reader.onerror = () => reject(new Error('Failed to read blob as base64'))
    reader.readAsDataURL(blob)
  })
}
