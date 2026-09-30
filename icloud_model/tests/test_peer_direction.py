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
        self.db.execute("CREATE TABLE X_TENANT_VIEW (TENANT_ID TEXT)")
        self.db.execute("CREATE TABLE EnterprisePhysicalLink (id TEXT, aNeResId TEXT, zNeResId TEXT, tenantId TEXT, direction TEXT)")
        self.db.execute("INSERT INTO X_TENANT_VIEW VALUES ('red')")
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
            [str(TELORA), "run", "--with-memory-limit", "1024", "--request-fuel", "3000", "--initialization-fuel", "3000",
             "--with-memory-limit", "1024", "icloud_model"],
            input=json.dumps({"method": "ic/transform", "input": {"intents": [intent]}}),
            text=True, capture_output=True, cwd=MODEL,
        )
        if result.returncode:
            self.fail(f"peer intent lowering failed: {result.stdout} {result.stderr}")
        response = json.loads(result.stdout)
        self.assertTrue(response["accepted"], response["diagnostics"])
        query = response["queries"][0]
        bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
        return self.db.execute(query["sql"], bindings).fetchall()

    def test_peer_join_and_exists_exclude_one_way_rows(self):
        root = {"id": "owner", "entity": "device"}
        edge = {"relation": "physical_link_peer_device", "from": "owner", "to": "peer"}
        owner_filter = {"node": "owner", "dimension": "device_id", "op": "Eq", "kind": "text", "value": "a"}
        peers = self.lower({
            "op": "Graph", "root": "owner", "row_grain": "Association",
            "nodes": [root, {"id": "peer", "entity": "device"}], "edges": [edge],
            "select": [{"node": "peer", "dimension": "device_id"}], "filters": [owner_filter],
        })
        self.assertEqual(sorted(peers), [("b",), ("c",)])
        qualified = self.lower({
            "op": "Graph", "root": "owner", "nodes": [root], "edges": [],
            "select": [{"node": "owner", "dimension": "device_id"}],
            "filters": [owner_filter],
            "exists": [{"anchor": "owner", "nodes": [{"id": "peer", "entity": "device"}],
                "edges": [edge], "filters": [{"node": "peer", "dimension": "device_id",
                    "op": "Eq", "kind": "text", "value": "c"}]}],
        })
        self.assertEqual(qualified, [("a",)])

    def test_one_way_link_still_has_its_named_a_endpoint(self):
        rows = self.lower({
            "op": "Graph", "root": "link",
            "nodes": [{"id": "link", "entity": "physical_link"}, {"id": "device", "entity": "device"}],
            "edges": [{"relation": "physical_link_a_device", "from": "link", "to": "device"}],
            "select": [{"node": "link", "dimension": "physical_link_id"}],
            "filters": [{"node": "link", "dimension": "physical_link_direction",
                "op": "Eq", "kind": "text", "value": "unidirectional"},
                {"node": "device", "dimension": "device_id", "op": "Eq", "kind": "text", "value": "a"}],
        })
        self.assertEqual(rows, [("ac-oneway",)])

    def test_peer_as_second_existence_edge_keeps_hub_guard(self):
        def qualified(owner_id):
            return self.lower({
                "op": "Graph", "root": "owner",
                "nodes": [{"id": "owner", "entity": "device"}], "edges": [],
                "select": [{"node": "owner", "dimension": "device_id"}],
                "filters": [{"node": "owner", "dimension": "device_id", "op": "Eq",
                    "kind": "text", "value": owner_id}],
                "exists": [{"anchor": "owner", "nodes": [
                    {"id": "tenant", "entity": "tenant"}, {"id": "peer", "entity": "device"}],
                    "edges": [
                        {"relation": "device_belongs_to_tenant", "from": "owner", "to": "tenant"},
                        {"relation": "physical_link_peer_device", "from": "owner", "to": "peer"},
                    ],
                    "filters": [{"node": "peer", "dimension": "device_id", "op": "Eq",
                        "kind": "text", "value": "a"}],
                }],
            })

        self.assertEqual(qualified("d"), [])
        self.assertEqual(qualified("c"), [("c",)])

    def test_one_way_business_connection_only_traverses_a_to_z(self):
        def downstream(owner_id):
            return self.lower({
                "op": "Graph", "root": "owner", "row_grain": "Association",
                "nodes": [{"id": "owner", "entity": "device"}, {"id": "next", "entity": "device"}],
                "edges": [{"relation": "physical_link_downstream_device", "from": "owner", "to": "next"}],
                "select": [{"node": "next", "dimension": "device_id"}],
                "filters": [{"node": "owner", "dimension": "device_id", "op": "Eq",
                    "kind": "text", "value": owner_id}],
            })

        self.assertEqual(downstream("a"), [("c",)])
        self.assertEqual(downstream("d"), [("a",)])
        self.assertEqual(downstream("c"), [])

    def test_one_way_endpoint_inclusion_unions_unique_device_identities(self):
        self.db.execute("ALTER TABLE I_EntNetworkElement ADD COLUMN name TEXT")
        self.db.execute("UPDATE I_EntNetworkElement SET name = id")
        self.db.execute(
            "INSERT INTO EnterprisePhysicalLink VALUES (?, ?, ?, ?, ?)",
            ("ac-duplicate", "a", "c", "red", "unidirectional"),
        )

        def branch(result, selected):
            return {
                "result_node": result,
                "graph": {
                    "op": "Graph", "root": "link",
                    "nodes": [
                        {"id": "link", "entity": "physical_link"},
                        {"id": "a", "entity": "device"},
                        {"id": "z", "entity": "device"},
                    ],
                    "edges": [
                        {"relation": "physical_link_a_device", "from": "link", "to": "a"},
                        {"relation": "physical_link_z_device", "from": "link", "to": "z"},
                    ],
                    "select": [
                        {"node": result, "dimension": "device_id"},
                        {"node": result, "dimension": "device_tenant_id"},
                        {"node": result, "dimension": "device_name"},
                    ],
                    "filters": [
                        {"node": "link", "dimension": "physical_link_direction",
                         "op": "Eq", "value": "unidirectional"},
                        {"node": selected, "dimension": "device_id", "op": "Eq", "value": "a"},
                        {"node": selected, "dimension": "device_tenant_id",
                         "op": "Eq", "value": "red"},
                    ],
                },
            }

        rows = self.lower({
            "op": "GraphUnion",
            "branches": [branch("z", "a"), branch("a", "z")],
        })
        self.assertEqual(sorted(rows), [("c", "red", "c"), ("d", "red", "d")])


if __name__ == "__main__":
    unittest.main()
