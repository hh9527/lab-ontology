"""Q0447: alarm-count qualification must not multiply server power samples."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class ServerAlarmPowerTest(unittest.TestCase):
    def test_independent_alarm_count_and_power_samples(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE PhysicalServer (id TEXT, tenantId TEXT, name TEXT, classification TEXT)")
        db.execute("CREATE TABLE ServerDeviceKPI (resId TEXT, tenantId TEXT, ts TEXT, averagePower REAL)")
        db.execute("CREATE TABLE T_CURRENT_ALARM (CSN INTEGER, MEDN TEXT, TENANTID TEXT, SEVERITY TEXT)")
        db.executemany("INSERT INTO PhysicalServer VALUES (?, ?, ?, ?)", [
            ("s", "red", "Taishan", "ne.category.server.taishan"),
            ("s", "blue", "Blue", "ne.category.server.taishan"),
            ("other", "red", "Other", "ne.category.server.rack"),
        ])
        db.executemany("INSERT INTO ServerDeviceKPI VALUES (?, ?, ?, ?)", [
            ("s", "red", "2025-01-01 00:00:00", 100.0),
            ("s", "red", "2025-01-20 00:00:00", 200.0),
            ("s", "red", "2025-02-01 00:00:00", 300.0),
            ("s", "blue", "2025-01-20 00:00:00", 900.0),
            ("other", "red", "2025-01-20 00:00:00", 800.0),
        ])
        db.executemany("INSERT INTO T_CURRENT_ALARM VALUES (?, ?, ?, ?)", [
            (1, "s", "red", "2"), (2, "s", "red", "2"),
            (3, "s", "red", "2"), (4, "s", "red", "1"),
            (5, "s", "blue", "2"), (6, "s", "blue", "2"),
            (7, "other", "red", "2"), (8, "other", "red", "2"),
            (9, "other", "red", "2"),
        ])
        intent = {
            "op": "graph", "root": "sample",
            "nodes": [{"id": "sample", "entity": "server_kpi"},
                      {"id": "server", "entity": "server_device"}],
            "edges": [{"relation": "server_kpi_of_server", "from": "sample", "to": "server"}],
            "select": [{"node": "server", "dimension": "server_name"},
                       {"node": "sample", "dimension": "server_average_power_sample"},
                       {"node": "sample", "dimension": "server_kpi_ts_raw"}],
            "filters": [
                {"node": "server", "dimension": "server_class", "op": "eq", "kind": "text", "value": "taishan"},
                {"node": "sample", "dimension": "server_kpi_ts_raw", "op": "ge", "kind": "text", "value": "2025-01-01 00:00:00"},
                {"node": "sample", "dimension": "server_kpi_ts_raw", "op": "lt", "kind": "text", "value": "2025-02-01 00:00:00"},
            ],
            "exists": [{"anchor": "server", "nodes": [{"id": "alarm", "entity": "current_alarm"}],
                "edges": [{"relation": "server_current_alarm", "from": "alarm", "to": "server"}],
                "having": [{"node": "alarm", "measure": "major_alarm_count", "op": "gt", "kind": "int", "value": 2}]}],
            "order_by": [{"node": "sample", "dimension": "server_kpi_ts_raw", "direction": "asc"}],
            "take": 10,
        }
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "4000", "--initialization-fuel", "3000", "icloud_model"],
            input=json.dumps({"method": "ic/transform", "input": intent}),
            text=True, capture_output=True, cwd=MODEL, check=True,
        )
        query = json.loads(result.stdout)
        bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
        self.assertEqual(db.execute(query["sql"], bindings).fetchall(), [
            ("Taishan", 100.0, "2025-01-01 00:00:00"),
            ("Taishan", 200.0, "2025-01-20 00:00:00"),
        ])


if __name__ == "__main__":
    unittest.main()
