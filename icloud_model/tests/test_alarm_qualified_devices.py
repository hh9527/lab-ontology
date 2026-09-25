"""Q0193: count devices with alarms, not joined device-alarm rows."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class AlarmQualifiedDevicesTest(unittest.TestCase):
    def test_distinct_devices_preserve_tenant_and_alarm_grains(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE X_TENANT_VIEW (TENANT_ID TEXT, TENANT_NAME TEXT)")
        db.execute("CREATE TABLE I_EntNetworkElement (id TEXT, tenant_id TEXT, classification TEXT)")
        db.execute("CREATE TABLE T_CURRENT_ALARM (CSN INTEGER, MEDN TEXT, TENANTID TEXT, CLEARED INTEGER)")
        db.executemany("INSERT INTO X_TENANT_VIEW VALUES (?, ?)",
                       [("red", "imastercloud24"), ("blue", "other")])
        db.executemany("INSERT INTO I_EntNetworkElement VALUES (?, ?, ?)", [
            ("d1", "red", "WAC"), ("d2", "red", "AC"),
            ("d3", "red", "ne.category.ac"), ("d4", "red", "LSW"),
            ("d2", "blue", "WAC"),
        ])
        db.executemany("INSERT INTO T_CURRENT_ALARM VALUES (?, ?, ?, ?)", [
            (1, "d1", "red", 0), (2, "d1", "red", 0),
            (3, "d2", "red", 1), (4, "d2", "blue", 0),
            (5, "d3", "red", 0), (6, "d4", "red", 0),
        ])
        intent = {
            "op": "graph", "root": "device",
            "nodes": [{"id": "device", "entity": "device"},
                      {"id": "tenant", "entity": "tenant"}],
            "edges": [{"relation": "device_belongs_to_tenant", "from": "device", "to": "tenant"}],
            "select": [], "count": "device",
            "filters": [
                {"node": "tenant", "dimension": "tenant_name", "op": "eq", "kind": "text", "value": "imastercloud24"},
                {"node": "device", "dimension": "device_class", "op": "eq", "kind": "text", "value": "WAC"},
            ],
            "exists": [{
                "anchor": "device", "nodes": [{"id": "alarm", "entity": "current_alarm"}],
                "edges": [{"relation": "device_current_alarm", "from": "alarm", "to": "device"}],
                "filters": [{"node": "alarm", "dimension": "alarm_cleared", "op": "eq",
                             "kind": "text", "value": "uncleared"}],
            }],
        }
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "4000", "--initialization-fuel", "3000", "icloud_model"],
            input=json.dumps({"method": "ic/transform", "input": intent}),
            text=True, capture_output=True, cwd=MODEL, check=True,
        )
        query = json.loads(result.stdout)
        self.assertIn("EXISTS", query["sql"])
        self.assertNotIn("JOIN T_CURRENT_ALARM", query["sql"])
        bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
        self.assertEqual(db.execute(query["sql"], bindings).fetchone(), (2,))


if __name__ == "__main__":
    unittest.main()
