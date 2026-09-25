"""Exercise server endpoint membership without multiplying physical links."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class ServerLinkSiteTest(unittest.TestCase):
    def test_rack_server_site_qualifies_each_manual_link_once(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE EnterprisePhysicalLink (id TEXT, aNeResId TEXT, zNeResId TEXT, tenantId TEXT, linkType INTEGER)")
        db.execute("CREATE TABLE PhysicalServer (id TEXT, tenantId TEXT, ipAddress TEXT, classification TEXT, refParentSubnet TEXT, projectId TEXT)")
        db.execute("CREATE TABLE X_SITE_VIEW (SITE_ID TEXT, SITE_NAME TEXT)")
        db.executemany("INSERT INTO X_SITE_VIEW VALUES (?, ?)", [
            ("site-a", "Q0350-site"), ("site-b", "Q0350-site"), ("site-c", "Other"),
        ])
        db.executemany("INSERT INTO PhysicalServer VALUES (?, ?, ?, ?, ?, ?)", [
            ("same", "red", "103.0.1.2", "ne.category.server.rack", "site-a", "site-b"),
            ("same", "blue", "103.0.1.2", "ne.category.server.rack", "site-a", "site-b"),
            ("other", "red", "103.0.1.2", "ne.category.server.subrack", "site-a", "site-a"),
        ])
        db.executemany("INSERT INTO EnterprisePhysicalLink VALUES (?, ?, ?, ?, ?)", [
            ("both", "same", "same", "red", 99),
            ("z-only", "unrelated", "same", "red", 99),
            ("wrong-tenant", "same", "unrelated", "green", 99),
            ("wrong-kind", "same", "unrelated", "red", 1),
            ("wrong-class", "other", "unrelated", "red", 99),
        ])
        intent = {
            "op": "graph", "root": "link",
            "nodes": [{"id": "link", "entity": "physical_link"}], "edges": [],
            "select": [], "count": "link",
            "filters": [{"node": "link", "dimension": "physical_link_type", "op": "eq", "kind": "text", "value": "manual"}],
            "exists": [{
                "anchor": "link",
                "nodes": [{"id": "server", "entity": "server_device"}, {"id": "site", "entity": "site"}],
                "edges": [
                    {"relation": "physical_link_attached_server", "from": "link", "to": "server"},
                    {"relation": "server_located_at_site", "from": "server", "to": "site"},
                ],
                "filters": [
                    {"node": "server", "dimension": "server_class", "op": "eq", "kind": "text", "value": "rack"},
                    {"node": "server", "dimension": "server_ip_address", "op": "eq", "kind": "text", "value": "103.0.1.2"},
                    {"node": "site", "dimension": "site_name", "op": "eq", "kind": "text", "value": "Q0350-site"},
                ],
            }],
        }
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "3000", "--initialization-fuel", "3000", "icloud_model"],
            input=json.dumps({"method": "ic/transform", "input": intent}),
            text=True, capture_output=True, cwd=MODEL, check=True,
        )
        query = json.loads(result.stdout)
        bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
        self.assertEqual(db.execute(query["sql"], bindings).fetchall(), [(2,)])


if __name__ == "__main__":
    unittest.main()
