import uuid
import unittest

from fastapi.testclient import TestClient

from main import app


EXPECTED_HTTP_PATHS = {
    "/api/tts",
    "/api/tts/voices",
    "/api/multi-agent/agents",
    "/api/multi-agent/agents/new",
    "/api/multi-agent/agents/{agent_id}/reset",
    "/api/multi-agent/agents/{agent_id}",
    "/api/multi-agent/judge-intro",
    "/api/judge-config",
    "/api/judge-config/default",
    "/api/opponent-config",
    "/api/opponent-config/default",
    "/api/tts-config",
    "/api/tts-config/default",
    "/api/stt-config",
    "/api/stt-config/default",
    "/api/model-config",
    "/api/model-config/default",
    "/api/projected-timeline/generate-stream",
}

EXPECTED_WS_PATHS = {
    "/ws/{session_id}",
    "/ws/multi-agent/{session_id}",
}


class Phase1ContractSmokeTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.client = TestClient(app)

    @classmethod
    def tearDownClass(cls):
        cls.client.close()

    def test_route_surface_includes_expected_paths(self):
        registered_paths = {route.path for route in app.routes}
        for path in EXPECTED_HTTP_PATHS | EXPECTED_WS_PATHS:
            self.assertIn(path, registered_paths, f"Missing route: {path}")

    def test_tts_voices_contract_shape(self):
        response = self.client.get("/api/tts/voices")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIsInstance(payload, list)
        self.assertGreater(len(payload), 0)

        first = payload[0]
        self.assertIn("id", first)
        self.assertIn("name", first)
        self.assertIsInstance(first["id"], str)
        self.assertIsInstance(first["name"], str)

    def test_multi_agent_agents_contract_shape(self):
        response = self.client.get("/api/multi-agent/agents")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("agents", payload)
        self.assertIsInstance(payload["agents"], list)

    def test_judge_config_redacts_api_key(self):
        response = self.client.get("/api/judge-config")
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertIn("external_llm", payload)
        self.assertEqual(payload["external_llm"].get("api_key"), "")

    def test_projected_timeline_validation(self):
        response = self.client.post(
            "/api/projected-timeline/generate-stream",
            json={
                "appellant_brief": "",
                "appellee_brief": "non-empty",
                "num_predictions": 5,
                "proceeding_type": "appellate argument",
            },
        )
        self.assertEqual(response.status_code, 422)
        payload = response.json()
        self.assertEqual(payload.get("detail"), "appellant_brief must not be empty.")

    def test_ws_phase_change_contract(self):
        session_id = f"smoke-{uuid.uuid4()}"
        with self.client.websocket_connect(f"/ws/{session_id}") as ws:
            ws.send_json({"type": "phase_change", "data": {"phase": "PROCEEDING"}})
            message = ws.receive_json()

        self.assertEqual(message["type"], "phase_update")
        self.assertEqual(message["data"]["phase"], "PROCEEDING")

    def test_multi_agent_ws_config_and_phase_contract(self):
        session_id = f"smoke-ma-{uuid.uuid4()}"
        with self.client.websocket_connect(f"/ws/multi-agent/{session_id}") as ws:
            ws.send_json(
                {
                    "type": "config",
                    "data": {
                        "agents": [],
                        "brief_summary": "",
                        "opposing_brief": "",
                        "mode": "playground",
                    },
                }
            )
            config_ack = ws.receive_json()

            ws.send_json({"type": "phase_change", "data": {"phase": "READY"}})
            phase_update = ws.receive_json()

        self.assertEqual(config_ack["type"], "config_ack")
        self.assertEqual(config_ack["data"]["status"], "ready")
        self.assertEqual(config_ack["data"]["agent_count"], 0)

        self.assertEqual(phase_update["type"], "phase_update")
        self.assertEqual(phase_update["data"]["phase"], "READY")


if __name__ == "__main__":
    unittest.main()
