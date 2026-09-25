"""PSU-qualified server alarms must respect component tenant ownership."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class PsuAlarmOwnershipTest(unittest.TestCase):
    def test_foreign_psu_cannot_qualify_alarm(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE T_CURRENT_ALARM (CSN INTEGER, MEDN TEXT, TENANTID TEXT)")
        db.execute("CREATE TABLE PhysicalServer (id TEXT, tenantId TEXT, oriResId TEXT)")
        db.execute("CREATE TABLE PhysicalServerPSU (parentResId TEXT, tenantId TEXT, healthStatus INTEGER)")
        db.executemany("INSERT INTO PhysicalServer VALUES (?, ?, ?)", [
            ("same", "red", "parent"), ("same", "blue", "parent"),
            ("good", "red", "second"),
        ])
        db.executemany("INSERT INTO T_CURRENT_ALARM VALUES (?, ?, ?)", [
            (1, "same", "red"), (2, "same", "blue"), (3, "good", "red"),
        ])
        db.executemany("INSERT INTO PhysicalServerPSU VALUES (?, ?, ?)", [
            ("parent", "red", 1), ("parent", "blue", -2),
            ("second", "red", -2), ("second", "red", -2),
        ])
        intent = {
            "op": "graph", "root": "alarm",
            "nodes": [{"id": "alarm", "entity": "current_alarm"},
                      {"id": "server", "entity": "server_device"}],
            "edges": [{"relation": "server_current_alarm", "from": "alarm", "to": "server"}],
            "select": [{"node": "alarm", "dimension": "alarm_csn"}],
            "exists": [{"anchor": "server", "nodes": [{"id": "psu", "entity": "server_psu"}],
                "edges": [{"relation": "psu_parent_server", "from": "psu", "to": "server"}],
                "filters": [{"node": "psu", "dimension": "server_psu_health", "op": "eq",
                             "kind": "text", "value": "unknown"}]}],
        }
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "3000", "--initialization-fuel", "3000", "icloud_model"],
            input=json.dumps({"method": "ic/transform", "input": intent}),
            text=True, capture_output=True, cwd=MODEL, check=True,
        )
        query = json.loads(result.stdout)
        bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
        self.assertEqual(sorted(db.execute(query["sql"], bindings).fetchall()), [(2,), (3,)])


if __name__ == "__main__":
    unittest.main()
