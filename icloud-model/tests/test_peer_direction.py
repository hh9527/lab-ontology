"""An undirected business peer link includes only bidirectional hub rows."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class PeerDirectionTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.execute("CREATE TABLE I_EntNetworkElement (id TEXT, tenant_id TEXT)")
        self.db.execute("CREATE TABLE EnterprisePhysicalLink (id TEXT, aNeResId TEXT, zNeResId TEXT, tenantId TEXT, direction TEXT)")
        self.db.executemany("INSERT INTO I_EntNetworkElement VALUES (?, ?)", [
            ("a", "red"), ("b", "red"), ("c", "red"), ("d", "red"), ("b", "blue"),
        ])
        self.db.executemany("INSERT INTO EnterprisePhysicalLink VALUES (?, ?, ?, ?, ?)", [
            ("ab", "a", "b", "red", "bidirectional"),
            ("ac-oneway", "a", "c", "red", "unidirectional"),
            ("ca", "c", "a", "red", "bidirectional"),
            ("da-oneway", "d", "a", "red", "unidirectional"),
            ("foreign", "a", "b", "blue", "bidirectional"),
        ])

    def lower(self, intent):
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "3000", "--initialization-fuel", "3000", "icloud-model"],
            input=json.dumps({"method": "transform", "input": intent}),
            text=True, capture_output=True, cwd=MODEL, check=True,
        )
        query = json.loads(result.stdout)
        bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
        return self.db.execute(query["sql"], bindings).fetchall()

    def test_peer_join_and_exists_exclude_one_way_rows(self):
        root = {"id": "owner", "entity": "device"}
        edge = {"relation": "physical_link_peer_device", "from": "owner", "to": "peer"}
        owner_filter = {"node": "owner", "dimension": "device_id", "op": "eq", "kind": "text", "value": "a"}
        peers = self.lower({
            "op": "graph", "root": "owner",
            "nodes": [root, {"id": "peer", "entity": "device"}], "edges": [edge],
            "select": [{"node": "peer", "dimension": "device_id"}], "filters": [owner_filter],
        })
        self.assertEqual(sorted(peers), [("b",), ("c",)])
        qualified = self.lower({
            "op": "graph", "root": "owner", "nodes": [root], "edges": [],
            "select": [{"node": "owner", "dimension": "device_id"}],
            "filters": [owner_filter],
            "exists": [{"anchor": "owner", "nodes": [{"id": "peer", "entity": "device"}],
                "edges": [edge], "filters": [{"node": "peer", "dimension": "device_id",
                    "op": "eq", "kind": "text", "value": "c"}]}],
        })
        self.assertEqual(qualified, [("a",)])

    def test_one_way_link_still_has_its_named_a_endpoint(self):
        rows = self.lower({
            "op": "graph", "root": "link",
            "nodes": [{"id": "link", "entity": "physical_link"}, {"id": "device", "entity": "device"}],
            "edges": [{"relation": "physical_link_a_device", "from": "link", "to": "device"}],
            "select": [{"node": "link", "dimension": "physical_link_id"}],
            "filters": [{"node": "link", "dimension": "physical_link_direction",
                "op": "eq", "kind": "text", "value": "unidirectional"},
                {"node": "device", "dimension": "device_id", "op": "eq", "kind": "text", "value": "a"}],
        })
        self.assertEqual(rows, [("ac-oneway",)])


if __name__ == "__main__":
    unittest.main()
