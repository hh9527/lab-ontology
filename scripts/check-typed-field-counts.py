#!/usr/bin/env python3
"""实际验证 COUNT(field) 的 NULL、重复值、空总体与物理列映射语义。"""
import json
from pathlib import Path
import sqlite3
import subprocess

root = Path(__file__).resolve().parents[1]
result = subprocess.run([
    str(root / "bin/telora"), "-C", str(root / "relation_model"), "eval", "@test/typed_field_counts:runtime_cases",
    "--initialization-fuel", "100000", "--request-fuel", "100000", "--with-memory-limit", "1024",
], capture_output=True, text=True, timeout=180)
assert result.returncode == 0, (result.stdout, result.stderr)
cases = json.loads(result.stdout)
assert {case["id"] for case in cases} == {"total", "grouped"}
with sqlite3.connect(":memory:") as db:
    db.execute("CREATE TABLE count_rows (ROW_ID INTEGER, DISPLAY_NAME TEXT, RAW_SCORE REAL)")
    def execute(case):
        assert case["sqlite"]["bindings"] == case["postgres"]["bindings"]
        query = case["sqlite"]
        return sorted(db.execute(query["sql"], {str(i + 1): value for i, value in enumerate(query["bindings"])}).fetchall(), key=repr)
    for rows, expected in [
        ([(1, "a", 1), (2, "a", None), (3, None, 3), (4, "", 4), (5, None, None), (6, "b", 6)],
         {"total": [(6, 4, 4)], "grouped": [(None, 0, 2), ("", 1, 1), ("a", 2, 2), ("b", 1, 1)]}),
        ([(1, None, None), (2, None, None)], {"total": [(2, 0, 0)], "grouped": [(None, 0, 2)]}),
        ([], {"total": [(0, 0, 0)], "grouped": []}),
    ]:
        db.execute("DELETE FROM count_rows")
        db.executemany("INSERT INTO count_rows VALUES (?, ?, ?)", rows)
        for case in cases:
            assert execute(case) == sorted(expected[case["id"]], key=repr), (case, execute(case))
print("Passed 6 SQLite field-count cases: physical mappings, duplicates, NULL, all-NULL and empty populations")
