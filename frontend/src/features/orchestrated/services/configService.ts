import { apiGetJson, apiPostJson } from '../../../api/client'

export interface OpponentConfig {
  system_prompt: string
  aggressiveness: number
  enabled_types: string[]
  voice_id: string
}

export interface RewardDimension {
  name: string
  weight: number
  description: string
}

export interface ExternalLLMConfig {
  enabled: boolean
  base_url: string
  model: string
  tier_override: 'LARGE' | 'SMALL' | 'BOTH'
}

export interface JudgeConfig {
  judge_prompt: string
  scoring_prompt_template: string
  reward_dimensions: RewardDimension[]
  external_llm: ExternalLLMConfig
}

export interface TierConfig {
  enabled: boolean
  base_url: string
  model: string
}

export interface ModelRuntimeConfig {
  large: TierConfig
  small: TierConfig
  tiny: TierConfig
}

export interface TTSConfig {
  enabled: boolean
  base_url: string
  voice: string
  model: string
}

export interface STTConfig {
  provider: string
  base_url: string
  model: string
  whisper_model: string
  device: string
  compute_type: string
}

export async function getOpponentConfig(): Promise<OpponentConfig> {
  return apiGetJson<OpponentConfig>('/api/opponent-config')
}

export async function getDefaultOpponentConfig(): Promise<OpponentConfig> {
  return apiGetJson<OpponentConfig>('/api/opponent-config/default')
}

export async function saveOpponentConfig(config: OpponentConfig): Promise<OpponentConfig> {
  return apiPostJson<OpponentConfig, OpponentConfig>('/api/opponent-config', config)
}

export async function getJudgeConfig(): Promise<JudgeConfig> {
  return apiGetJson<JudgeConfig>('/api/judge-config')
}

export async function getDefaultJudgeConfig(): Promise<JudgeConfig> {
  return apiGetJson<JudgeConfig>('/api/judge-config/default')
}

export async function saveJudgeConfig(config: JudgeConfig): Promise<JudgeConfig> {
  return apiPostJson<JudgeConfig, JudgeConfig>('/api/judge-config', config)
}

export async function getModelConfig(): Promise<ModelRuntimeConfig> {
  return apiGetJson<ModelRuntimeConfig>('/api/model-config')
}

export async function getDefaultModelConfig(): Promise<ModelRuntimeConfig> {
  return apiGetJson<ModelRuntimeConfig>('/api/model-config/default')
}

export async function saveModelConfig(config: ModelRuntimeConfig): Promise<ModelRuntimeConfig> {
  return apiPostJson<ModelRuntimeConfig, ModelRuntimeConfig>('/api/model-config', config)
}

export async function getTtsConfig(): Promise<TTSConfig> {
  return apiGetJson<TTSConfig>('/api/tts-config')
}

export async function getDefaultTtsConfig(): Promise<TTSConfig> {
  return apiGetJson<TTSConfig>('/api/tts-config/default')
}

export async function saveTtsConfig(config: TTSConfig): Promise<TTSConfig> {
  return apiPostJson<TTSConfig, TTSConfig>('/api/tts-config', config)
}

export async function getSttConfig(): Promise<STTConfig> {
  return apiGetJson<STTConfig>('/api/stt-config')
}

export async function getDefaultSttConfig(): Promise<STTConfig> {
  return apiGetJson<STTConfig>('/api/stt-config/default')
}

export async function saveSttConfig(config: STTConfig): Promise<STTConfig> {
  return apiPostJson<STTConfig, STTConfig>('/api/stt-config', config)
}
