# Frontend Structure

This document describes how the frontend is organized in `frontend/src` after the refactor.

## High-Level Shape

- App entry: `main.tsx`
- Route shell: `App.tsx`
- Page-level orchestration: `pages/*`
- Reusable domain modules: `features/*`
- Shared browser/runtime hooks: `hooks/*`
- Multi-agent UI module: `multi-agent/*` + `orchestrated-agents/*`
- Shared type contracts: `types/*`
- Overlay/HUD UI for courtroom runtime: `ui-overlays/*`
- 3D runtime + assets: `3d-rendering/*`

## Routing and Page Shells

`App.tsx` keeps route paths stable:

- `/` -> `Home`
- `/3d` -> `ThreeDPage`
- `/courtroom` -> `CourtroomPage`
- `/session-audit` -> `SessionAuditPage`
- `/orchestrated-agents` -> `OrchestratedAgents`

Pages remain route shells and orchestrators, while shared logic has been moved into `features/*` services/utilities and shared hooks.

## API Layer (Single Source for HTTP)

All HTTP requests now flow through:

- `api/client.ts`

Core helpers:

- `buildApiUrl(path)`
- `apiFetch(path, init)`
- `apiGetJson<T>(path)`
- `apiPostJson<TResponse, TBody>(path, body)`
- `apiDelete(path)`

This keeps endpoint strings and fetch behavior centralized.

## Feature Modules

Current extracted feature modules:

- `features/orchestrated/services/*`
  - `multiAgentService.ts`
  - `configService.ts`
  - `timelineService.ts`
- `features/courtroom/services/ttsService.ts`
- `features/pdf/utils/extractPdfText.ts`
- `features/media/utils/audioEncoding.ts`
- `features/socket/utils/wsBase.ts`

These modules are consumed by pages/components instead of inlining network/util logic.

## Realtime (WebSocket) Structure

Shared contracts:

- `types/socket.ts`

Primary hook:

- `hooks/useCourtroomSocket.ts`
  - Handles both `/ws/{session_id}` and `/ws/multi-agent/{session_id}` based on config.
  - Maintains reconnect and message parsing behavior.

Compatibility wrapper:

- `hooks/useSimulationSocket.ts`
  - Legacy API preserved.
  - Internally delegates to `useCourtroomSocket`.

Dedicated multi-agent playground socket:

- `multi-agent/hooks/useMultiAgentSocket.ts`

Shared WS base URL logic:

- `features/socket/utils/wsBase.ts`

## Media/PDF Utilities (De-duplicated)

- Shared PDF text extraction:
  - `features/pdf/utils/extractPdfText.ts`
- Shared audio primitives:
  - `features/media/utils/audioEncoding.ts`
    - `blobToBase64`
    - `pickSupportedAudioMimeType`

These are reused by:

- `hooks/useMediaRecording.ts`
- `multi-agent/hooks/useMediaRecording.ts`
- `pages/Home.tsx`
- `multi-agent/components/BriefUpload.tsx`

## Multi-Agent UI Module

Multi-agent UI components and styles are grouped under:

- `multi-agent/components/*`
- `multi-agent/styles/*`
- `multi-agent/types.ts`

Orchestrated hearing-specific panels are in:

- `orchestrated-agents/*`

## State Boundaries

- Route-level/session orchestration remains in page components.
- Domain API logic is in `features/*/services`.
- Shared WebSocket and media runtime logic is in `hooks/*` and `features/*/utils`.
- Type contracts shared across pages/hooks/components are in `types/*`.

