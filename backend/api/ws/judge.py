"""WebSocket route registration for primary courtroom flow."""

from fastapi import APIRouter

from domain.simulation.runtime import websocket_endpoint

router = APIRouter(tags=["ws-judge"])
router.add_api_websocket_route("/ws/{session_id}", websocket_endpoint)
