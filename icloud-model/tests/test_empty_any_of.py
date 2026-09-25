"""Execute the iCloud zero-preserving Graph query against a minimal SQLite fixture."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class EmptyAlarmAlternativesTest(unittest.TestCase):
    def test_counts_only_selected_alarms_without_losing_empty_devices(self):
        intent = {
            "op": "graph",
            "root": "device",
            "include_empty": True,
            "nodes": [
                {"id": "device", "entity": "device"},
                {"id": "alarm", "entity": "current_alarm"},
            ],
            "edges": [
                {"relation": "device_current_alarm", "from": "alarm", "to": "device"}
            ],
            "select": [{"node": "device", "dimension": "device_name"}],
            "count": "alarm",
            "group_by_identity": ["device"],
            "any_of": [
                {"node": "device", "dimension": "device_class", "kind": "text", "values": ["WAC"]},
                {
                    "node": "alarm",
                    "dimension": "alarm_severity",
                    "kind": "text",
                    "values": ["critical", "major"],
                },
            ],
        }
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "3000", "--initialization-fuel", "3000", "icloud-model"],
            input=json.dumps({"method": "transform", "input": intent}),
            text=True,
            capture_output=True,
            cwd=MODEL,
            check=True,
        )
        query = json.loads(result.stdout)

        with sqlite3.connect(":memory:") as db:
            db.execute("CREATE TABLE I_EntNetworkElement (id TEXT, tenant_id TEXT, name TEXT, classification TEXT)")
            db.execute("CREATE TABLE T_CURRENT_ALARM (CSN INTEGER, MEDN TEXT, TENANTID TEXT, SEVERITY TEXT)")
            db.executemany(
                "INSERT INTO I_EntNetworkElement VALUES (?, ?, ?, ?)",
                [
                    ("same", "red", "Empty", "WAC"),
                    ("same", "blue", "Blue", "ne.category.ac"),
                    ("other", "red", "Two", "AC"),
                    ("excluded", "red", "Excluded", "LSW"),
                ],
            )
            db.executemany(
                "INSERT INTO T_CURRENT_ALARM VALUES (?, ?, ?, ?)",
                [
                    (1, "same", "blue", "2"),
                    (2, "other", "red", "1"),
                    (3, "other", "red", "2"),
                    (4, "other", "red", "3"),
                    (5, "excluded", "red", "1"),
                ],
            )
            bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
            rows = db.execute(query["sql"], bindings).fetchall()

        self.assertEqual(sorted(rows), [("Blue", 1), ("Empty", 0), ("Two", 2)])


if __name__ == "__main__":
    unittest.main()
