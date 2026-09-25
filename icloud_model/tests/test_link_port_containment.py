"""Q0275's link port-name containment and its logical complement."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class LinkPortContainmentTest(unittest.TestCase):
    def test_complement_uses_the_same_case_insensitive_match(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE EnterprisePhysicalLink (id TEXT, zPortName TEXT)")
        db.executemany("INSERT INTO EnterprisePhysicalLink VALUES (?, ?)", [
            ("upper", "ON0/1"), ("lower", "on0/2"),
            ("middle", "other-ON0/3-port"), ("other", "Port"),
            ("missing", None), ("empty", ""),
        ])
        for op, expected in [("contains", {"upper", "lower", "middle"}),
                             ("not_contains", {"other", "empty"})]:
            with self.subTest(op=op):
                intent = {
                    "op": "graph", "root": "link",
                    "nodes": [{"id": "link", "entity": "physical_link"}],
                    "edges": [], "select": [{"node": "link", "dimension": "physical_link_id"}],
                    "filters": [{"node": "link", "dimension": "physical_link_z_port_name",
                                 "op": op, "kind": "text", "value": "on0/"}],
                }
                result = subprocess.run(
                    [str(TELORA), "run", "--request-fuel", "4000", "--initialization-fuel", "3000", "icloud_model"],
                    input=json.dumps({"method": "ic/transform", "input": intent}),
                    text=True, capture_output=True, cwd=MODEL, check=True,
                )
                query = json.loads(result.stdout)
                self.assertNotIn("on0/", query["sql"])
                bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
                self.assertEqual({row[0] for row in db.execute(query["sql"], bindings)}, expected)


if __name__ == "__main__":
    unittest.main()
