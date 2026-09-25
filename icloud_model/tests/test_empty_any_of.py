"""Execute the iCloud zero-preserving Graph query against a minimal SQLite fixture."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class EmptyAlarmAlternativesTest(unittest.TestCase):
    def setUp(self):
        self.db = sqlite3.connect(":memory:")
        self.addCleanup(self.db.close)
        self.db.execute("CREATE TABLE I_EntNetworkElement (id TEXT, tenant_id TEXT, name TEXT, classification TEXT)")
        self.db.execute("CREATE TABLE T_CURRENT_ALARM (CSN INTEGER, MEDN TEXT, TENANTID TEXT, SEVERITY TEXT, STREXT13 TEXT)")
        self.db.executemany(
            "INSERT INTO I_EntNetworkElement VALUES (?, ?, ?, ?)",
            [
                ("same", "red", "Empty", "WAC"),
                ("same", "blue", "Blue", "ne.category.ac"),
                ("other", "red", "Two", "AC"),
                ("excluded", "red", "Excluded", "LSW"),
            ],
        )
        self.db.executemany(
            "INSERT INTO T_CURRENT_ALARM VALUES (?, ?, ?, ?, ?)",
            [
                (1, "same", "blue", "2", None),
                (2, "other", "red", "1", None),
                (3, "other", "red", "2", None),
                (4, "other", "red", "3", None),
                (5, "excluded", "red", "1", None),
            ],
        )

    def lower(self, intent):
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "3000", "--initialization-fuel", "3000", "icloud_model"],
            input=json.dumps({"method": "ic/transform", "input": intent}),
            text=True,
            capture_output=True,
            cwd=MODEL,
            check=True,
        )
        query = json.loads(result.stdout)
        bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
        return self.db.execute(query["sql"], bindings).fetchall()

    def test_counts_only_selected_alarms_without_losing_empty_devices(self):
        intent = {
            "op": "graph",
            "root": "device",
            "include_empty": True,
            "nodes": [
                {"id": "device", "entity": "device"},
                {"id": "alarm", "entity": "current_alarm"},
            ],
            "edges": [
                {"relation": "device_current_alarm", "from": "alarm", "to": "device"}
            ],
            "select": [{"node": "device", "dimension": "device_name"}],
            "count": "alarm",
            "group_by_identity": ["device"],
            "any_of": [
                {"node": "device", "dimension": "device_class", "kind": "text", "values": ["WAC"]},
                {
                    "node": "alarm",
                    "dimension": "alarm_severity",
                    "kind": "text",
                    "values": ["critical", "major"],
                },
            ],
        }
        rows = self.lower(intent)

        self.assertEqual(sorted(rows), [("Blue", 1), ("Empty", 0), ("Two", 2)])

    def test_filtered_and_computed_counts_keep_zero_groups(self):
        intent = {
            "op": "graph",
            "root": "device",
            "include_empty": True,
            "nodes": [
                {"id": "device", "entity": "device"},
                {"id": "alarm", "entity": "current_alarm"},
            ],
            "edges": [
                {"relation": "device_current_alarm", "from": "alarm", "to": "device"}
            ],
            "select": [{"node": "device", "dimension": "device_name"}],
            "measures": [
                {"node": "alarm", "measure": "critical_alarm_count"},
                {"node": "alarm", "measure": "major_alarm_count"},
                {"node": "alarm", "measure": "critical_or_major_alarm_count"},
            ],
            "group_by_identity": ["device"],
        }
        self.assertEqual(
            sorted(self.lower(intent)),
            [("Blue", 0, 1, 1), ("Empty", 0, 0, 0), ("Excluded", 1, 0, 1), ("Two", 1, 1, 2)],
        )

    def test_system_alarm_is_not_a_site_relation_but_remains_an_event(self):
        self.db.execute("CREATE TABLE X_SITE_VIEW (SITE_ID TEXT)")
        self.db.executemany("INSERT INTO X_SITE_VIEW VALUES (?)", [("3",), ("site-a",)])
        self.db.executemany(
            "INSERT INTO T_CURRENT_ALARM VALUES (?, ?, ?, ?, ?)",
            [(6, "other", "red", "1", "3"), (7, "other", "red", "2", "site-a")],
        )
        site_counts = self.lower({
            "op": "graph", "root": "site", "include_empty": True,
            "nodes": [{"id": "site", "entity": "site"}, {"id": "alarm", "entity": "current_alarm"}],
            "edges": [{"relation": "alarm_site_reference", "from": "alarm", "to": "site"}],
            "select": [{"node": "site", "dimension": "site_id"}],
            "count": "alarm", "group_by_identity": ["site"],
        })
        all_alarms = self.lower({
            "op": "graph", "root": "alarm", "nodes": [{"id": "alarm", "entity": "current_alarm"}],
            "edges": [], "select": [], "count": "alarm",
        })
        no_site_alarms = self.lower({
            "op": "graph", "root": "site", "nodes": [{"id": "site", "entity": "site"}],
            "edges": [], "select": [{"node": "site", "dimension": "site_id"}],
            "exists": [{"anchor": "site", "negated": True,
                "nodes": [{"id": "alarm", "entity": "current_alarm"}],
                "edges": [{"relation": "alarm_site_reference", "from": "alarm", "to": "site"}]}],
        })
        self.assertEqual(sorted(site_counts), [("3", 0), ("site-a", 1)])
        self.assertEqual(all_alarms, [(7,)])
        self.assertEqual(no_site_alarms, [("3",)])

    def test_noncritical_includes_minor_and_warning_but_not_unknown_wires(self):
        self.db.executemany(
            "INSERT INTO T_CURRENT_ALARM VALUES (?, ?, ?, ?, ?)",
            [(6, "other", "red", "4", None), (7, "other", "red", "9", None)],
        )
        noncritical = self.lower({
            "op": "graph", "root": "alarm",
            "nodes": [{"id": "alarm", "entity": "current_alarm"}],
            "edges": [], "select": [], "count": "alarm",
            "filters": [{"node": "alarm", "dimension": "alarm_severity",
                "op": "ne", "kind": "text", "value": "critical"}],
        })
        self.assertEqual(noncritical, [(4,)])


if __name__ == "__main__":
    unittest.main()
