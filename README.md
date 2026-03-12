# Court Simulator

## Prerequisites

- `bun`
- `uv`

## Environment Setup

1. Create a root `.env` file from the template:

```bash
cp example.env .env
```

2. Edit `.env` and replace placeholder keys (for example `OPENAI_API_KEY`, `GROQ_API_KEY`) with real values for the providers you use.

## Run

```bash
bun run start.sh
```

This installs/syncs dependencies, rebuilds frontend, and starts backend + frontend.

- Frontend: `http://localhost:5173`
- Backend: `http://localhost:8000`

## Stop

```bash
bun run stop.sh
```
