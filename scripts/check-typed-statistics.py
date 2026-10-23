#!/usr/bin/env python3
"""验证无 Metric／clock／grain 来源的数值 Group SQL。"""
import json
from pathlib import Path
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[1]
result = subprocess.run([
    str(ROOT / "bin/telora"), "-C", str(ROOT / "relation_model"), "eval",
    "@test/typed_statistics:runtime_cases", "--initialization-fuel", "100000",
    "--request-fuel", "100000", "--with-memory-limit", "1024",
], capture_output=True, text=True, check=True, timeout=180)
cases = json.loads(result.stdout)
expected = {
    "grouped": [("a", 55.0, 20.0, 90.0, 10.0, 6, 3.0), ("b", 80.0, 80.0, 80.0, None, 4, 2.0), ("c", None, None, None, 40.0, 5, 5.0)],
    "total": [(190.0 / 3.0, 20.0, 90.0, 15)], "filtered": [("a", 55.0)],
}
assert {case["id"] for case in cases} == expected.keys()
with sqlite3.connect(":memory:") as db:
    db.execute("CREATE TABLE rate_rows (owner TEXT, RATE_VALUE REAL, other REAL, items INTEGER)")
    db.executemany("INSERT INTO rate_rows VALUES (?, ?, ?, ?)", [
        ("a", 20, 5, 2), ("a", 90, 15, 4), ("b", None, None, 1), ("b", 80, None, 3), ("c", None, 40, 5),
    ])
    def execute(case):
        query = case["sqlite"]
        assert query["bindings"] == case["postgres"]["bindings"], case["id"]
        bindings = {str(i + 1): value for i, value in enumerate(query["bindings"])}
        return db.execute(query["sql"], bindings).fetchall()
    for case in cases:
        rows = execute(case)
        assert sorted(rows) == expected[case["id"]], (case["id"], rows, case)
    db.execute("DELETE FROM rate_rows")
    for case in cases:
        rows = execute(case)
        assert rows == ([(None, None, None, None)] if case["id"] == "total" else []), (case["id"], rows)
print("Passed 3 ordinary numeric Group SQLite queries: repeated bindings, Avg/Min/Max, Count Sum, source filters, NULL and empty input without sampling metadata")
