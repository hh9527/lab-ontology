"""Q0442: referenced tenant IDs differ from existing tenant entities."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class AlarmTenantValuesTest(unittest.TestCase):
    def test_grouped_non_null_ids_include_orphans_but_not_missing_owners(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE X_TENANT_VIEW (TENANT_ID TEXT, TENANT_NAME TEXT)")
        db.execute("CREATE TABLE T_CURRENT_ALARM (CSN INTEGER, TENANTID TEXT, CLEARED INTEGER)")
        db.execute("INSERT INTO X_TENANT_VIEW VALUES ('known', 'Known')")
        rows = [(index, tenant, 0) for index, tenant in enumerate(
            ["known"] * 6 + ["orphan"] * 6 + [None] * 6, 1)]
        rows.extend([(19, "orphan", 1), (20, "below", 0)])
        db.executemany("INSERT INTO T_CURRENT_ALARM VALUES (?, ?, ?)", rows)

        count_ids = {
            "op": "graph", "root": "alarm",
            "nodes": [{"id": "alarm", "entity": "current_alarm"}], "edges": [],
            "select": [{"node": "alarm", "dimension": "alarm_tenant_id"}],
            "filters": [{"node": "alarm", "dimension": "alarm_cleared", "op": "eq",
                         "kind": "text", "value": "uncleared"}],
            "count": "alarm", "count_having": {"op": "gt", "value": 5},
            "count_groups": True,
        }
        count_entities = {
            "op": "graph", "root": "tenant",
            "nodes": [{"id": "tenant", "entity": "tenant"},
                      {"id": "alarm", "entity": "current_alarm"}],
            "edges": [{"relation": "alarm_belongs_to_tenant", "from": "alarm", "to": "tenant"}],
            "select": [{"node": "tenant", "dimension": "tenant_name"}],
            "filters": count_ids["filters"], "count": "alarm",
            "group_by_identity": ["tenant"], "count_having": {"op": "gt", "value": 5},
            "count_groups": True,
        }
        for intent, expected in [(count_ids, 2), (count_entities, 1)]:
            with self.subTest(root=intent["root"]):
                result = subprocess.run(
                    [str(TELORA), "run", "--request-fuel", "4000", "--initialization-fuel", "3000", "icloud-model"],
                    input=json.dumps({"method": "transform", "input": intent}),
                    text=True, capture_output=True, cwd=MODEL, check=True,
                )
                query = json.loads(result.stdout)
                bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
                self.assertEqual(db.execute(query["sql"], bindings).fetchone(), (expected,))


if __name__ == "__main__":
    unittest.main()
