"""Count events by canonical severity rather than physical alarm codes."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class AlarmValueGroupTest(unittest.TestCase):
    def test_canonical_severity_group_count_threshold(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE T_CURRENT_ALARM (CSN INTEGER, SEVERITY TEXT)")
        db.executemany("INSERT INTO T_CURRENT_ALARM VALUES (?, ?)", [
            (1, "1"), (2, "1"), (3, "1"),
            (4, "2"), (5, "2"),
            (6, "unknown"), (7, "unknown"), (8, "unknown"),
        ])
        intent = {
            "op": "graph", "root": "alarm", "nodes": [{"id": "alarm", "entity": "current_alarm"}],
            "edges": [], "select": [{"node": "alarm", "dimension": "alarm_severity"}],
            "count": "alarm", "count_having": {"op": "gt", "value": 2},
        }
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "3000", "--initialization-fuel", "3000", "icloud-model"],
            input=json.dumps({"method": "transform", "input": intent}),
            text=True, capture_output=True, cwd=MODEL, check=True,
        )
        query = json.loads(result.stdout)
        bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
        self.assertEqual(db.execute(query["sql"], bindings).fetchall(), [("critical", 3)])


if __name__ == "__main__":
    unittest.main()
