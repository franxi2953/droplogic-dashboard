from __future__ import annotations

import sys
import types
import unittest


sys.modules.setdefault("httpx", types.SimpleNamespace(Response=object))

from backend.ai_provider import DASHBOARD_AGENT_INSTRUCTIONS


class AgentInstructionContractTests(unittest.TestCase):
    def test_agent_advances_one_confirmed_mcp_step_at_a_time(self) -> None:
        instructions = DASHBOARD_AGENT_INSTRUCTIONS

        self.assertIn("most recent MCP result first", instructions)
        self.assertIn("single immediate unmet requirement", instructions)
        self.assertIn("Reason as far ahead as necessary", instructions)
        self.assertIn("required_next_tool and recommended_status_call", instructions)
        self.assertIn("do not repeatedly enumerate or re-plan the entire protocol", instructions)

    def test_whole_chip_request_remains_active_for_the_protocol(self) -> None:
        instructions = DASHBOARD_AGENT_INSTRUCTIONS

        self.assertIn("preserve whole_chip_camera for every segment", instructions)
        self.assertIn("do not switch back to follow_droplets", instructions)


if __name__ == "__main__":
    unittest.main()
