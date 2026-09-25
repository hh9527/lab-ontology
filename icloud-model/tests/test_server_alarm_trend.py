"""Execute the Q0439-shaped server trend with independent alarm qualification."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class ServerAlarmTrendTest(unittest.TestCase):
    def test_duplicate_alarms_do_not_duplicate_server_samples(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE PhysicalServer (id TEXT, tenantId TEXT, name TEXT, classification TEXT)")
        db.execute("CREATE TABLE ServerDeviceKPI (resId TEXT, tenantId TEXT, ts TEXT, memUsage REAL)")
        db.execute("CREATE TABLE T_CURRENT_ALARM (MEDN TEXT, TENANTID TEXT, ALARMNAME TEXT)")
        db.executemany("INSERT INTO PhysicalServer VALUES (?, ?, ?, ?)", [
            ("same", "red", "Server", "ne.category.server.subrack"),
            ("same", "blue", "Server", "ne.category.server.subrack"),
            ("other", "red", "Other", "ne.category.server.rack"),
        ])
        db.executemany("INSERT INTO ServerDeviceKPI VALUES (?, ?, ?, ?)", [
            ("same", "red", "2025-01-01 00:00:00", 10.0),
            ("same", "red", "2025-01-20 00:00:00", 20.0),
            ("same", "red", "2025-01-31 00:00:00", 30.0),
            ("same", "blue", "2025-01-20 00:00:00", 90.0),
            ("other", "red", "2025-01-20 00:00:00", 80.0),
        ])
        db.executemany("INSERT INTO T_CURRENT_ALARM VALUES (?, ?, ?)", [
            ("same", "red", "linkDown"), ("same", "red", "linkDown"),
            ("same", "blue", "deviceOffline"), ("other", "red", "linkDown"),
        ])
        intent = {
            "op": "graph", "root": "sample",
            "nodes": [{"id": "sample", "entity": "server_kpi"},
                      {"id": "server", "entity": "server_device"}],
            "edges": [{"relation": "server_kpi_of_server", "from": "sample", "to": "server"}],
            "select": [{"node": "server", "dimension": "server_name"},
                       {"node": "sample", "dimension": "server_memory_sample"},
                       {"node": "sample", "dimension": "server_kpi_ts_raw"}],
            "filters": [
                {"node": "server", "dimension": "server_class", "op": "eq", "kind": "text", "value": "subrack"},
                {"node": "sample", "dimension": "server_kpi_ts_raw", "op": "ge", "kind": "text", "value": "2025-01-01 00:00:00"},
                {"node": "sample", "dimension": "server_kpi_ts_raw", "op": "lt", "kind": "text", "value": "2025-01-31 00:00:00"},
            ],
            "exists": [{"anchor": "server", "nodes": [{"id": "alarm", "entity": "current_alarm"}],
                "edges": [{"relation": "server_current_alarm", "from": "alarm", "to": "server"}],
                "filters": [{"node": "alarm", "dimension": "alarm_name", "op": "eq", "kind": "text", "value": "linkDown"}]}],
            "order_by": [{"node": "sample", "dimension": "server_kpi_ts_raw", "direction": "asc"}],
        }
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "3000", "--initialization-fuel", "3000", "icloud-model"],
            input=json.dumps({"method": "transform", "input": intent}),
            text=True, capture_output=True, cwd=MODEL, check=True,
        )
        query = json.loads(result.stdout)
        bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
        self.assertEqual(db.execute(query["sql"], bindings).fetchall(), [
            ("Server", 10.0, "2025-01-01 00:00:00"),
            ("Server", 20.0, "2025-01-20 00:00:00"),
        ])


if __name__ == "__main__":
    unittest.main()
