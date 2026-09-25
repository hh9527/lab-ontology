"""Q0360: site-qualified interface statuses preserve interface row grain."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class SitePortStatusTest(unittest.TestCase):
    def test_site_and_device_qualify_ports_without_merging_or_repeating_them(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE X_SITE_VIEW (SITE_ID TEXT, SITE_TYPE TEXT)")
        db.execute("CREATE TABLE I_EntNetworkElement (id TEXT, tenant_id TEXT, projectId TEXT, refParentSubnet TEXT, classification TEXT)")
        db.execute("CREATE TABLE I_EnterpriseNetworkLTP (id TEXT, tenantId TEXT, refParentNE TEXT, name TEXT, operState TEXT)")
        db.executemany("INSERT INTO X_SITE_VIEW VALUES (?, ?)", [
            ("a", "onlineSite"), ("b", "onlineSite"), ("c", "offlineSite"),
        ])
        db.executemany("INSERT INTO I_EntNetworkElement VALUES (?, ?, ?, ?, ?)", [
            ("device", "red", "a", "b", "AP"),
            ("device", "blue", "c", "c", "AP"),
            ("router", "red", "a", "b", "AR"),
        ])
        db.executemany("INSERT INTO I_EnterpriseNetworkLTP VALUES (?, ?, ?, ?, ?)", [
            ("p1", "red", "device", "eth", "active"),
            ("p2", "red", "device", "eth", "active"),
            ("p3", "red", "device", "eth", "inactive"),
            ("p4", "red", "device", "eth", "mystery"),
            ("p5", "blue", "device", "eth", "active"),
            ("p6", "red", "router", "eth", "active"),
        ])
        intent = {
            "op": "graph", "root": "port",
            "nodes": [{"id": "port", "entity": "port"}], "edges": [],
            "select": [{"node": "port", "dimension": "port_name"},
                       {"node": "port", "dimension": "port_oper_status"}],
            "exists": [{
                "anchor": "port",
                "nodes": [{"id": "device", "entity": "device"}, {"id": "site", "entity": "site"}],
                "edges": [{"relation": "port_belongs_to_device", "from": "port", "to": "device"},
                          {"relation": "device_located_at_site", "from": "device", "to": "site"}],
                "filters": [{"node": "device", "dimension": "device_class", "op": "eq",
                             "kind": "text", "value": "AP"},
                            {"node": "site", "dimension": "site_type", "op": "eq",
                             "kind": "text", "value": "online"}],
            }],
        }
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "4000", "--initialization-fuel", "3000", "icloud-model"],
            input=json.dumps({"method": "transform", "input": intent}),
            text=True, capture_output=True, cwd=MODEL, check=True,
        )
        query = json.loads(result.stdout)
        self.assertIn("EXISTS", query["sql"])
        self.assertNotIn("JOIN X_SITE_VIEW", query["sql"].split("EXISTS", 1)[0])
        bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
        self.assertEqual(sorted(db.execute(query["sql"], bindings)),
                         [("eth", "down"), ("eth", "up"), ("eth", "up")])


if __name__ == "__main__":
    unittest.main()
