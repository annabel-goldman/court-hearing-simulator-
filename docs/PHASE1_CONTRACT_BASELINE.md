# Phase 1 Contract Baseline

Date: 2026-03-12

Purpose: freeze the current external surface so refactors can proceed without breaking behavior.

## HTTP Contract (Current Paths)

These paths are treated as stable in the refactor:

- `POST /api/tts`
- `GET /api/tts/voices`
- `GET /api/multi-agent/agents`
- `POST /api/multi-agent/agents`
- `POST /api/multi-agent/agents/new`
- `GET /api/multi-agent/agents/{agent_id}/reset`
- `DELETE /api/multi-agent/agents/{agent_id}`
- `POST /api/multi-agent/judge-intro`
- `GET /api/judge-config`
- `GET /api/judge-config/default`
- `POST /api/judge-config`
- `GET /api/opponent-config`
- `GET /api/opponent-config/default`
- `POST /api/opponent-config`
- `GET /api/tts-config`
- `GET /api/tts-config/default`
- `POST /api/tts-config`
- `GET /api/stt-config`
- `GET /api/stt-config/default`
- `POST /api/stt-config`
- `GET /api/model-config`
- `GET /api/model-config/default`
- `POST /api/model-config`
- `POST /api/projected-timeline/generate-stream`

## WebSocket Contract (Current Paths)

- `WS /ws/{session_id}`
- `WS /ws/multi-agent/{session_id}`

## WebSocket Message Shapes

### `/ws/{session_id}`

Inbound message envelope:

```json
{ "type": "<string>", "data": { } }
```

Observed inbound `type` values:

- `config`
- `audio`
- `phase_change`

Observed outbound `type` values:

- `phase_update`
- `transcript_update`
- `judge_interrupt`
- `argument_score`
- `error`

### `/ws/multi-agent/{session_id}`

Inbound message envelope:

```json
{ "type": "<string>", "data": { } }
```

Observed inbound `type` values:

- `config`
- `audio`
- `phase_change`
- `set_agenda`
- `update_agents`

Observed outbound `type` values:

- `config_ack`
- `phase_update`
- `agenda_set_ack`
- `agents_updated`
- `transcript_update`
- `agent_question`
- `agenda_update`
- `argument_score`
- `opponent_response`
- `missed_question`
- `agent_scores`
- `stt_error`
- `error`

## Refactor Guardrail

During Phases 2+:

- do not rename paths
- do not change envelope keys (`type`, `data`)
- do not remove message types without an explicit migration plan
- keep config redaction behavior (`api_key` fields are blank in responses)
