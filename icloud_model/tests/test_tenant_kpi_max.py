"""Execute the Q0420-shaped tenant/device/sample aggregate."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class TenantDeviceKpiMaxTest(unittest.TestCase):
    def test_max_respects_tenant_identity_prefix_and_window(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE X_TENANT_VIEW (TENANT_ID TEXT, INDUSTRY TEXT)")
        db.execute("CREATE TABLE I_EntNetworkElement (id TEXT, tenant_id TEXT, name TEXT, ipAddress TEXT, classification TEXT)")
        db.execute("CREATE TABLE NetworkDeviceKPI (resId TEXT, tenantId TEXT, ts TEXT, portUsedCount INTEGER)")
        db.executemany("INSERT INTO X_TENANT_VIEW VALUES (?, ?)", [("red", "102"), ("blue", "103")])
        db.executemany("INSERT INTO I_EntNetworkElement VALUES (?, ?, ?, ?, ?)", [
            ("same", "red", "Switch", "10.3.0.0.1", "LSW"),
            ("same", "blue", "Switch", "10.3.0.0.2", "ne.category.switch"),
            ("middle", "red", "Excluded", "192.10.3.0.0", "LSW"),
            ("router", "red", "Excluded", "10.3.0.0.3", "AR"),
        ])
        db.executemany("INSERT INTO NetworkDeviceKPI VALUES (?, ?, ?, ?)", [
            ("same", "red", "2025-01-01 00:00:00", 4),
            ("same", "red", "2025-01-20 00:00:00", 9),
            ("same", "red", "2025-01-31 00:00:00", 100),
            ("same", "blue", "2025-01-20 00:00:00", 900),
            ("middle", "red", "2025-01-20 00:00:00", 200),
            ("router", "red", "2025-01-20 00:00:00", 300),
        ])
        intent = {
            "op": "graph", "root": "device",
            "nodes": [{"id": "device", "entity": "device"}, {"id": "tenant", "entity": "tenant"},
                      {"id": "sample", "entity": "device_kpi"}],
            "edges": [{"relation": "device_belongs_to_tenant", "from": "device", "to": "tenant"},
                      {"relation": "device_kpi_of_device", "from": "sample", "to": "device"}],
            "select": [{"node": "device", "dimension": "device_id"},
                       {"node": "device", "dimension": "device_name"}],
            "measures": [{"node": "sample", "measure": "used_port_sample_max"}],
            "group_by_identity": ["device"],
            "filters": [
                {"node": "tenant", "dimension": "tenant_industry", "op": "eq", "kind": "text", "value": "102"},
                {"node": "device", "dimension": "device_ip_address", "op": "starts_with", "kind": "text", "value": "10.3.0.0"},
                {"node": "device", "dimension": "device_class", "op": "eq", "kind": "text", "value": "LSW"},
                {"node": "sample", "dimension": "device_kpi_ts_raw", "op": "ge", "kind": "text", "value": "2025-01-01 00:00:00"},
                {"node": "sample", "dimension": "device_kpi_ts_raw", "op": "lt", "kind": "text", "value": "2025-01-31 00:00:00"},
            ],
        }
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "3000", "--initialization-fuel", "3000", "icloud_model"],
            input=json.dumps({"method": "ic/transform", "input": intent}),
            text=True, capture_output=True, cwd=MODEL, check=True,
        )
        query = json.loads(result.stdout)
        bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
        self.assertEqual(db.execute(query["sql"], bindings).fetchall(), [("same", "Switch", 9)])


if __name__ == "__main__":
    unittest.main()
