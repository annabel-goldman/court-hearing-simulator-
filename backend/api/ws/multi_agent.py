"""WebSocket route registration for multi-agent orchestrated flow."""

from fastapi import APIRouter

from domain.simulation.runtime import multi_agent_websocket

router = APIRouter(tags=["ws-multi-agent"])
router.add_api_websocket_route("/ws/multi-agent/{session_id}", multi_agent_websocket)
