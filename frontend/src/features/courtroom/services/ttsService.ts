import { apiPostJson } from '../../../api/client'

interface TtsResponse {
  audio?: string
  format?: 'opus' | 'mp3' | 'wav' | string
}

export async function synthesizeSpeech(text: string, voice = 'onyx'): Promise<TtsResponse> {
  return apiPostJson<TtsResponse, { text: string; voice: string }>('/api/tts', { text, voice })
}
