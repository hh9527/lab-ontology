"""Count Q0428 server identities without multiplying them by matching fans."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class TenantFanServerCountTest(unittest.TestCase):
    def test_fan_qualification_preserves_server_identity_and_tenant(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE X_TENANT_VIEW (TENANT_ID TEXT, TENANT_NAME TEXT)")
        db.execute("CREATE TABLE PhysicalServer (id TEXT, tenantId TEXT, name TEXT, oriResId TEXT, classification TEXT)")
        db.execute("CREATE TABLE PhysicalServerFan (parentResId TEXT, tenantId TEXT, manufacturer TEXT)")
        db.executemany("INSERT INTO X_TENANT_VIEW VALUES (?, ?)", [
            ("red", "target"), ("blue", "target"),
        ])
        db.executemany("INSERT INTO PhysicalServer VALUES (?, ?, ?, ?, ?)", [
            ("a", "red", "same", "parent", "ne.category.server.rack"),
            ("b", "red", "same", "other", "ne.category.server.rack"),
            ("c", "red", "excluded", "no-match", "ne.category.server.rack"),
            ("a", "blue", "same", "parent", "ne.category.server.rack"),
            ("d", "red", "wrong-class", "other", "ne.category.server.subrack"),
        ])
        db.executemany("INSERT INTO PhysicalServerFan VALUES (?, ?, ?)", [
            ("parent", "red", "2011"), ("parent", "red", "Huawei"),
            ("other", "red", "huawei technologies co., ltd"),
            ("no-match", "red", "Other"),
            ("parent", "blue", "Other"),
        ])
        intent = {
            "op": "graph", "root": "tenant",
            "nodes": [{"id": "tenant", "entity": "tenant"}, {"id": "server", "entity": "server_device"}],
            "edges": [{"relation": "server_belongs_to_tenant", "from": "server", "to": "tenant"}],
            "select": [{"node": "tenant", "dimension": "tenant_name"}],
            "count": "server", "group_by_identity": ["tenant"],
            "filters": [{"node": "tenant", "dimension": "tenant_name", "op": "eq", "kind": "text", "value": "target"},
                        {"node": "server", "dimension": "server_class", "op": "eq", "kind": "text", "value": "rack"}],
            "exists": [{"anchor": "server", "nodes": [{"id": "fan", "entity": "server_fan"}],
                "edges": [{"relation": "fan_parent_server", "from": "fan", "to": "server"}],
                "filters": [{"node": "fan", "dimension": "server_fan_manufacturer", "op": "eq",
                             "kind": "text", "value": "Huawei"}]}],
        }
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "3000", "--initialization-fuel", "3000", "icloud_model"],
            input=json.dumps({"method": "ic/transform", "input": intent}),
            text=True, capture_output=True, cwd=MODEL, check=True,
        )
        query = json.loads(result.stdout)
        bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
        self.assertEqual(db.execute(query["sql"], bindings).fetchall(), [("target", 2)])


if __name__ == "__main__":
    unittest.main()
