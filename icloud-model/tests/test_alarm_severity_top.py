"""Per-device alarm Top-N follows declared business severity, not wire order."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class AlarmSeverityTopTest(unittest.TestCase):
    def test_unknown_wires_do_not_take_ranked_slots(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE I_EntNetworkElement (id TEXT, tenant_id TEXT)")
        db.execute("CREATE TABLE T_CURRENT_ALARM (CSN INTEGER, MEDN TEXT, TENANTID TEXT, SEVERITY TEXT)")
        db.executemany("INSERT INTO I_EntNetworkElement VALUES (?, ?)",
                       [("device", "red"), ("device", "blue")])
        db.executemany("INSERT INTO T_CURRENT_ALARM VALUES (?, ?, ?, ?)", [
            (1, "device", "red", "4"), (2, "device", "red", "2"),
            (3, "device", "red", "1"), (4, "device", "red", "unknown"),
            (5, "device", "blue", "3"), (6, "device", "blue", "1"),
        ])
        intent = {
            "op": "graph", "root": "device",
            "nodes": [{"id": "device", "entity": "device"},
                      {"id": "alarm", "entity": "current_alarm"}],
            "edges": [{"relation": "device_current_alarm", "from": "alarm", "to": "device"}],
            "select": [{"node": "alarm", "dimension": "alarm_csn"}],
            "top_per": {"owner": "device", "sample": "alarm", "rank": "alarm_severity", "take": 2},
        }
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "4000", "--initialization-fuel", "3000", "icloud-model"],
            input=json.dumps({"method": "transform", "input": intent}),
            text=True, capture_output=True, cwd=MODEL, check=True,
        )
        query = json.loads(result.stdout)
        bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
        self.assertEqual([row[0] for row in db.execute(query["sql"], bindings)], [6, 5, 3, 2])


if __name__ == "__main__":
    unittest.main()
