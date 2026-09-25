"""An explicit canonical severity order governs raw alarm sorting."""

import json
from pathlib import Path
import sqlite3
import subprocess
import unittest


MODEL = Path(__file__).resolve().parents[1]
TELORA = MODEL.parent / "bin" / "telora"


class AlarmBusinessOrderTest(unittest.TestCase):
    def test_order_respects_model_rank_and_excludes_unknown_wires(self):
        db = sqlite3.connect(":memory:")
        self.addCleanup(db.close)
        db.execute("CREATE TABLE T_CURRENT_ALARM (CSN INTEGER, SEVERITY TEXT, ALARMNAME TEXT)")
        db.executemany("INSERT INTO T_CURRENT_ALARM VALUES (?, ?, ?)", [
            (1, "4", "Communication Alarm"), (2, "2", "Communication Alarm"),
            (3, "1", "Communication Alarm"), (4, "3", "Communication Alarm"),
            (5, "other", "Communication Alarm"), (6, "1", "Other Alarm"),
        ])
        for direction, expected in [
            ("asc", [(3, "critical"), (2, "major"), (4, "minor"), (1, "warning")]),
            ("desc", [(1, "warning"), (4, "minor"), (2, "major"), (3, "critical")]),
        ]:
            with self.subTest(direction=direction):
                intent = {
                    "op": "graph", "root": "alarm", "nodes": [{"id": "alarm", "entity": "current_alarm"}],
                    "edges": [], "select": [
                        {"node": "alarm", "dimension": "alarm_csn"},
                        {"node": "alarm", "dimension": "alarm_severity"},
                    ],
                    "filters": [{"node": "alarm", "dimension": "alarm_name", "op": "eq",
                                 "kind": "text", "value": "Communication Alarm"}],
                    "order_by": [{"node": "alarm", "dimension": "alarm_severity", "direction": direction}],
                }
                result = subprocess.run(
                    [str(TELORA), "run", "--request-fuel", "3000", "--initialization-fuel", "3000", "icloud-model"],
                    input=json.dumps({"method": "transform", "input": intent}),
                    text=True, capture_output=True, cwd=MODEL, check=True,
                )
                query = json.loads(result.stdout)
                bindings = {str(index): value for index, value in enumerate(query["bindings"], 1)}
                self.assertEqual(db.execute(query["sql"], bindings).fetchall(), expected)


if __name__ == "__main__":
    unittest.main()
