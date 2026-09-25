"""Count declared business values, not identities or physical wire variants."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class SiteNameCountTest(unittest.TestCase):
    def lower(self, intent):
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "3000", "--initialization-fuel", "3000", "icloud-model"],
            input=json.dumps({"method": "transform", "input": intent}),
            text=True, capture_output=True, cwd=MODEL, check=True,
        )
        query = json.loads(result.stdout)
        return query["sql"], {str(index): value for index, value in enumerate(query["bindings"], 1)}

    def test_count_of_distinct_names_does_not_count_sites_or_join_rows(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE PhysicalServer (id TEXT, assetNumber TEXT, classification TEXT, refParentSubnet TEXT, projectId TEXT)")
        db.execute("CREATE TABLE X_SITE_VIEW (SITE_ID TEXT, SITE_NAME TEXT)")
        db.executemany("INSERT INTO X_SITE_VIEW VALUES (?, ?)", [
            ("s1", "Shared"), ("s2", "Shared"), ("s3", "Other"), ("s4", None),
        ])
        db.executemany("INSERT INTO PhysicalServer VALUES (?, ?, ?, ?, ?)", [
            ("a", "AN-000001", "ne.category.server.kunlun", "s1", "s1"),
            ("b", "AN-000001", "ne.category.server.kunlun", "s2", "s3"),
            ("c", "AN-000002", "ne.category.server.kunlun", "s4", "s4"),
            ("d", "AN-000001", "ne.category.server.subrack", "s4", "s4"),
        ])
        intent = {
            "op": "graph", "root": "server",
            "nodes": [{"id": "server", "entity": "server_device"}, {"id": "site", "entity": "site"}],
            "edges": [{"relation": "server_located_at_site", "from": "server", "to": "site"}],
            "select": [], "count_value": {"node": "site", "dimension": "site_name"},
            "filters": [
                {"node": "server", "dimension": "server_asset_number", "op": "eq", "kind": "text", "value": "AN-000001"},
                {"node": "server", "dimension": "server_class", "op": "eq", "kind": "text", "value": "kunlun"},
            ],
        }
        sql, bindings = self.lower(intent)
        self.assertEqual(db.execute(sql, bindings).fetchall(), [(2,)])

    def test_distinct_canonical_class_excludes_unmapped_wire_values(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE I_EntNetworkElement (classification TEXT)")
        db.executemany("INSERT INTO I_EntNetworkElement VALUES (?)", [
            ("ne.category.ac",), ("AC",), ("WAC",),
            ("ne.category.switch",), ("unknown-from-source",), (None,),
        ])
        sql, bindings = self.lower({
            "op": "graph", "root": "device",
            "nodes": [{"id": "device", "entity": "device"}], "edges": [], "select": [],
            "count_value": {"node": "device", "dimension": "device_class"},
        })
        self.assertEqual(db.execute(sql, bindings).fetchall(), [(2,)])


if __name__ == "__main__":
    unittest.main()
