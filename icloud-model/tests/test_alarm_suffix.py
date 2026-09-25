"""Q0252: count current alarms whose name ends with the requested text."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class AlarmSuffixTest(unittest.TestCase):
    def test_suffix_is_bound_and_matches_only_the_end(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE T_CURRENT_ALARM (CSN INTEGER, ALARMNAME TEXT)")
        db.executemany("INSERT INTO T_CURRENT_ALARM VALUES (?, ?)", [
            (1, "Equipment Alarm"), (2, "equipment ALARM"),
            (3, "Alarm prefix"), (4, "Equipment Alarms"),
            (5, None), (6, "Equipment Other"),
        ])
        intent = {
            "op": "graph", "root": "alarm",
            "nodes": [{"id": "alarm", "entity": "current_alarm"}],
            "edges": [], "select": [], "count": "alarm",
            "filters": [{"node": "alarm", "dimension": "alarm_name", "op": "ends_with",
                         "kind": "text", "value": "Alarm"}],
        }
        result = subprocess.run(
            [str(TELORA), "run", "--request-fuel", "4000", "--initialization-fuel", "3000", "icloud-model"],
            input=json.dumps({"method": "transform", "input": intent}),
            text=True, capture_output=True, cwd=MODEL, check=True,
        )
        query = json.loads(result.stdout)
        self.assertNotIn("Alarm", query["sql"])
        bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
        self.assertEqual(db.execute(query["sql"], bindings).fetchone(), (2,))


if __name__ == "__main__":
    unittest.main()
