# Frontend + Backend Integration

This document explains how the frontend and backend communicate and where contracts are enforced.

## Integration Model

The system uses:

- HTTP (configuration, setup, CRUD, TTS, timeline generation)
- WebSockets (live courtroom/session runtime)
- SSE (streamed projected timeline generation)

The frontend is a Vite React app; the backend is FastAPI with Hypercorn runtime.

## Transport and Base URLs

- Frontend HTTP base: `VITE_API_URL` (default `http://localhost:8000`)
- Frontend WS base: `VITE_WS_URL` (default `ws://localhost:8000/ws`)
- HTTP calls go through `frontend/src/api/client.ts`
- WS base normalization is in `frontend/src/features/socket/utils/wsBase.ts`

## Main User Flows

## 1) Courtroom Session Flow (`/courtroom`)

1. User uploads briefs on `Home` page.
2. Frontend extracts PDF text with shared util.
3. Frontend may call projected timeline SSE endpoint for agenda/summaries.
4. Frontend stores session payload in `sessionStorage`.
5. `CourtroomPage` reads session config and opens WS connection via `useCourtroomSocket`.
6. Frontend sends:
   - `config`
   - `audio`
   - `phase_change`
   - `silence_timeout` / `question_cutoff` when appropriate
7. Backend sends:
   - `phase_update`
   - `judge_interrupt`
   - `transcript_update`
   - `agent_scores`
   - `missed_question`
   - `error`

## 2) Orchestrated Agents Flow (`/orchestrated-agents`)

1. Frontend generates agenda via SSE:
   - `POST /api/projected-timeline/generate-stream`
2. Frontend opens `/ws/multi-agent/{session_id}`.
3. Frontend sends:
   - `config`
   - `set_agenda`
   - `audio`
   - `phase_change`
   - `update_agents`
4. Backend sends:
   - `config_ack`
   - `agenda_set_ack`
   - `transcript_update`
   - `agent_question`
   - `opponent_response`
   - `agenda_update`
   - `argument_score`
   - `phase_update`

## 3) Config/Admin Flow

Frontend config panels read/write backend runtime config via HTTP endpoints:

- judge/opponent config
- TTS/STT config
- model tier config

These endpoints are grouped in backend `api/routes/config.py`.

## API Contract Surface

Canonical contract list is asserted by backend smoke tests:

- `backend/tests/test_phase1_contract_smoke.py`

Includes expected HTTP routes, WS routes, and key shape checks.

## SSE Contract (`projected-timeline`)

Endpoint:

- `POST /api/projected-timeline/generate-stream`

Event stream emits:

- `status`
- `agenda`
- `node`
- `done`
- `error` (on failure)

Frontend parses these events to build progress UI and agenda state.

## Type Contract Alignment

Frontend shared socket message-related types live in:

- `frontend/src/types/socket.ts`

Hooks and overlays consume these shared types, and legacy wrappers are preserved for compatibility.

Backend request DTOs live in:

- `backend/schemas/requests.py`

## Compatibility and Stability Notes

- Route paths are intentionally unchanged.
- WS paths are intentionally unchanged:
  - `/ws/{session_id}`
  - `/ws/multi-agent/{session_id}`
- Compatibility shim remains in backend:
  - `backend/api/core_router.py`
- Frontend compatibility wrapper remains:
  - `frontend/src/hooks/useSimulationSocket.ts`

These shims allow incremental refactors without breaking callers.

## Operational Entry Points

Standard local workflow:

- Start: `bun run start.sh`
- Stop: `bun run stop.sh`

`start.sh` handles rebuild + startup for frontend/backend.

