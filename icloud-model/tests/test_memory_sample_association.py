"""Explicit memory/sample associations are pairs, not memory-owned metrics."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class MemorySampleAssociationTest(unittest.TestCase):
    def test_explicit_association_rows_keep_both_identities(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE PhysicalServer (id TEXT, tenantId TEXT, oriResId TEXT, classification TEXT)")
        db.execute("CREATE TABLE ServerDeviceKPI (resId TEXT, tenantId TEXT, ts TEXT, cpuUsage REAL)")
        db.execute("CREATE TABLE PhysicalServerMemory (id TEXT, tenantId TEXT, parentResId TEXT, name TEXT)")
        db.executemany("INSERT INTO PhysicalServer VALUES (?, ?, ?, ?)", [
            ("server", "red", "parent", "ne.category.server.taishan"),
            ("server", "blue", "parent", "ne.category.server.rack"),
        ])
        db.executemany("INSERT INTO ServerDeviceKPI VALUES (?, ?, ?, ?)", [
            ("server", "red", "2025-01-01 00:00:00", 10.0),
            ("server", "red", "2025-01-02 00:00:00", 20.0),
            ("server", "blue", "2025-01-01 00:00:00", 90.0),
        ])
        db.executemany("INSERT INTO PhysicalServerMemory VALUES (?, ?, ?, ?)", [
            ("m1", "red", "parent", "DIMM1"),
            ("m2", "red", "parent", "DIMM2"),
            ("m3", "blue", "parent", "OTHER"),
        ])
        intent = {
            "op": "graph", "root": "sample", "row_grain": "association",
            "nodes": [{"id": "sample", "entity": "server_kpi"},
                      {"id": "server", "entity": "server_device"},
                      {"id": "memory", "entity": "server_memory"}],
            "edges": [{"relation": "server_kpi_of_server", "from": "sample", "to": "server"},
                      {"relation": "memory_parent_server", "from": "memory", "to": "server"}],
            "select": [{"node": "memory", "dimension": "server_memory_name"},
                       {"node": "sample", "dimension": "server_cpu_sample"},
                       {"node": "sample", "dimension": "server_kpi_ts_raw"}],
            "filters": [{"node": "server", "dimension": "server_class", "op": "eq",
                         "kind": "text", "value": "taishan"}],
            "order_by": [{"node": "sample", "dimension": "server_kpi_ts_raw", "direction": "asc"},
                         {"node": "memory", "dimension": "server_memory_name", "direction": "asc"}],
        }
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "4000", "--initialization-fuel", "3000", "icloud-model"],
            input=json.dumps({"method": "transform", "input": intent}),
            text=True, capture_output=True, cwd=MODEL, check=True,
        )
        query = json.loads(result.stdout)
        bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
        self.assertEqual(db.execute(query["sql"], bindings).fetchall(), [
            ("DIMM1", 10.0, "2025-01-01 00:00:00"),
            ("DIMM2", 10.0, "2025-01-01 00:00:00"),
            ("DIMM1", 20.0, "2025-01-02 00:00:00"),
            ("DIMM2", 20.0, "2025-01-02 00:00:00"),
        ])


if __name__ == "__main__":
    unittest.main()
