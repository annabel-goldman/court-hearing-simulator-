"""Court Simulator backend entrypoint.

Phase 3 refactor note:
- Route registration now lives under backend/api/routes and backend/api/ws
- Simulation/session runtime logic lives under backend/domain/simulation
- This file only composes the FastAPI app (lifespan + middleware + routers)
"""

import os
import logging
from contextlib import asynccontextmanager

import anyio
from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from api.router import router as api_router
from domain.simulation.runtime import multi_agent_manager
from model_router import (
    log_config as log_model_config,
    probe_all_tiers,
    _background_reachability_refresh,
)
from projected_timeline import router as projected_timeline_router


# Load environment variables from the root .env file
load_dotenv(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", ".env"))


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s [%(levelname)s] %(name)s: %(message)s',
    datefmt='%H:%M:%S',
)
logger = logging.getLogger("court-simulator")


@asynccontextmanager
async def lifespan(_app: FastAPI):
    logger.info("Starting Court Simulator Backend...")
    llm_key_present = bool(os.getenv("OPENAI_API_KEY") or os.getenv("OPEN_ROUTER_API_KEY"))
    logger.info("LLM API Key configured: %s", "Yes" if llm_key_present else "No")
    logger.info("Model routing config:")
    log_model_config()
    await probe_all_tiers()

    async def _background_session_evict() -> None:
        """Periodically evict WS sessions dropped without clean disconnect."""
        while True:
            await anyio.sleep(300)
            multi_agent_manager.evict_stale()

    async with anyio.create_task_group() as lifespan_tg:
        lifespan_tg.start_soon(_background_reachability_refresh)
        lifespan_tg.start_soon(_background_session_evict)
        yield
        lifespan_tg.cancel_scope.cancel()


app = FastAPI(title="Court Simulator API", lifespan=lifespan)


@app.get("/healthz")
async def healthz():
    """Simple liveness endpoint for Render health checks."""
    return {
        "ok": True,
        "service": os.getenv("RENDER_SERVICE_NAME", "court-hearing-simulator"),
        "branch": os.getenv("RENDER_GIT_BRANCH", ""),
        "commit": os.getenv("RENDER_GIT_COMMIT", ""),
    }

_cors_origins = [
    "http://localhost:3000",
    "http://localhost:5173",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:5173",
]
if os.getenv("CORS_ORIGINS"):
    _cors_origins.extend(o.strip() for o in os.getenv("CORS_ORIGINS", "").split(",") if o.strip())

app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(projected_timeline_router)
app.include_router(api_router)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=8000)
