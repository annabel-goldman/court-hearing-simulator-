# Backend Structure

This document describes how the backend is organized in `backend/` after the refactor.

## High-Level Shape

- App composition entrypoint: `main.py`
- Composed API router: `api/router.py`
- REST routes by domain: `api/routes/*`
- WebSocket route registration: `api/ws/*`
- Simulation/session domain runtime: `domain/simulation/runtime.py`
- Shared request DTOs: `schemas/requests.py`
- Supporting domain services:
  - `services/*`
  - `multi_agent/*`
  - `projected_timeline/*`

## App Composition (`main.py`)

`main.py` is composition-focused:

- creates FastAPI app
- sets CORS
- wires lifespan/startup tasks
- includes:
  - projected timeline router
  - composed API router from `api/router.py`

## Router Composition

`api/router.py` aggregates:

- `api/routes/multi_agent.py`
- `api/routes/config.py`
- `api/ws/judge.py`
- `api/ws/multi_agent.py`

This keeps path surface stable while separating responsibilities.

## REST Route Modules

### `api/routes/multi_agent.py`

Includes:

- `POST /api/tts`
- multi-agent agent CRUD endpoints:
  - `GET /api/multi-agent/agents`
  - `POST /api/multi-agent/agents`
  - `POST /api/multi-agent/agents/new`
  - `GET /api/multi-agent/agents/{agent_id}/reset`
  - `DELETE /api/multi-agent/agents/{agent_id}`
- `POST /api/multi-agent/judge-intro`

### `api/routes/config.py`

Includes runtime config endpoints:

- judge config
- opponent config
- TTS config + `GET /api/tts/voices`
- STT config
- model tier config

## WebSocket Route Modules

### `api/ws/judge.py`

- Registers `/ws/{session_id}` and delegates handling to domain runtime.

### `api/ws/multi_agent.py`

- Registers `/ws/multi-agent/{session_id}` and delegates handling to domain runtime.

## Domain Simulation Runtime

`domain/simulation/runtime.py` contains core live-session logic:

- connection/session managers
- WebSocket receive/send loops
- phase transitions
- transcript updates
- judge interrupts
- agent scoring and missed-question signals
- multi-agent orchestration (agenda setup, agent questions, opponent responses)
- tracker + MCTS projection coordination

This is the primary real-time domain boundary.

## Shared DTO Layer

`schemas/requests.py` contains shared request contracts for:

- TTS
- judge intro
- agent config
- judge/opponent/system config payloads

## Compatibility Shim

`api/core_router.py` exists as a compatibility re-export shim for legacy imports while routing now lives in the new module layout.

## Contract Safety

Contract smoke tests are in:

- `backend/tests/test_phase1_contract_smoke.py`

They verify core HTTP/WS route surface and baseline response/message shapes.

