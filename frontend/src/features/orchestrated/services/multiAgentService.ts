import { apiDelete, apiFetch, apiGetJson, apiPostJson } from '../../../api/client'
import type { Agent } from '../../../multi-agent/types'

interface AgentListResponse {
  agents?: Agent[]
}

interface AgentResponse {
  agent: Agent
}

interface JudgeIntroResponse {
  text?: string
  audio?: string
  format?: string
}

interface NewAgentPayload {
  name: string
  color: string
  description: string
  triggers: string[]
  example_questions: string[]
  extra_prompt: string
}

export async function loadMultiAgentProfiles(): Promise<Agent[]> {
  const data = await apiGetJson<AgentListResponse>('/api/multi-agent/agents')
  return data.agents ?? []
}

export async function resetAgentToDefault(agentId: string): Promise<Agent> {
  const data = await apiGetJson<AgentResponse>(`/api/multi-agent/agents/${agentId}/reset`)
  return data.agent
}

export async function writeAgent(agent: Agent): Promise<Agent> {
  const data = await apiPostJson<AgentResponse, Agent>('/api/multi-agent/agents', agent)
  return data.agent
}

export async function createAgent(payload: NewAgentPayload): Promise<Agent> {
  const data = await apiPostJson<AgentResponse, NewAgentPayload>('/api/multi-agent/agents/new', payload)
  return data.agent
}

export async function deleteAgent(agentId: string): Promise<void> {
  return apiDelete(`/api/multi-agent/agents/${agentId}`)
}

export async function fetchTtsVoices(): Promise<Array<{ id: string; name: string }>> {
  const response = await apiFetch('/api/tts/voices')
  if (!response.ok) {
    return []
  }
  return response.json() as Promise<Array<{ id: string; name: string }>>
}

export async function requestJudgeIntroduction(
  caseSummary: string,
  agendaTopics: string[]
): Promise<JudgeIntroResponse> {
  return apiPostJson<JudgeIntroResponse, { case_summary: string; agenda_topics: string[] }>(
    '/api/multi-agent/judge-intro',
    { case_summary: caseSummary, agenda_topics: agendaTopics }
  )
}
