"""Distinguish site-name cardinality from site-identity cardinality."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class SiteNameCountTest(unittest.TestCase):
    def test_count_of_distinct_names_does_not_count_sites_or_join_rows(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE PhysicalServer (id TEXT, name TEXT, refParentSubnet TEXT, projectId TEXT)")
        db.execute("CREATE TABLE X_SITE_VIEW (SITE_ID TEXT, SITE_NAME TEXT)")
        db.executemany("INSERT INTO X_SITE_VIEW VALUES (?, ?)", [
            ("s1", "Shared"), ("s2", "Shared"), ("s3", "Other"), ("s4", None),
        ])
        db.executemany("INSERT INTO PhysicalServer VALUES (?, ?, ?, ?)", [
            ("a", "Kunlun A", "s1", "s1"),
            ("b", "Kunlun A", "s2", "s3"),
            ("c", "Different", "s4", "s4"),
        ])
        intent = {
            "op": "graph", "root": "server",
            "nodes": [{"id": "server", "entity": "server_device"}, {"id": "site", "entity": "site"}],
            "edges": [{"relation": "server_located_at_site", "from": "server", "to": "site"}],
            "select": [], "count_value": {"node": "site", "dimension": "site_name"},
            "filters": [{"node": "server", "dimension": "server_name", "op": "eq", "kind": "text", "value": "Kunlun A"}],
        }
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "3000", "--initialization-fuel", "3000", "icloud-model"],
            input=json.dumps({"method": "transform", "input": intent}),
            text=True, capture_output=True, cwd=MODEL, check=True,
        )
        query = json.loads(result.stdout)
        bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
        self.assertEqual(db.execute(query["sql"], bindings).fetchall(), [(2,)])


if __name__ == "__main__":
    unittest.main()
