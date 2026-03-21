"""Composed API router grouped by domain routers."""

from fastapi import APIRouter

from .routes.config import router as rest_config_router
from .routes.multi_agent import router as rest_multi_agent_router
from .ws.multi_agent import router as ws_multi_agent_router

router = APIRouter()
router.include_router(rest_multi_agent_router)
router.include_router(rest_config_router)
router.include_router(ws_multi_agent_router)
