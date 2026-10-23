#!/usr/bin/env python3
"""验证业务条件计数保留多编码、NULL 和独立人口语义。"""
import json
from pathlib import Path
import sqlite3
import subprocess

root = Path(__file__).resolve().parents[1]
result = subprocess.run([
    str(root / "bin/telora"), "-C", str(root / "relation_model"), "eval", "@test/typed_filtered_counts:runtime_cases",
    "--initialization-fuel", "100000", "--request-fuel", "100000", "--with-memory-limit", "1024",
], capture_output=True, text=True, timeout=180)
assert result.returncode == 0, (result.stdout, result.stderr)
cases = json.loads(result.stdout)
assert {case["id"] for case in cases} == {"total", "narrowed"}
with sqlite3.connect(":memory:") as db:
    db.execute("CREATE TABLE filtered_rows (ROW_ID INTEGER, STATE_CODE TEXT, RAW_SCORE REAL)")
    def execute(case):
        assert case["sqlite"]["bindings"] == case["postgres"]["bindings"]
        query = case["sqlite"]
        return sorted(db.execute(query["sql"], {str(i + 1): value for i, value in enumerate(query["bindings"])}).fetchall(), key=repr)
    for rows, expected in [
        ([(1, "wire_yes", 1), (2, "Y", None), (3, "wire_no", 3), (4, "yes", 4), (5, None, 5), (6, "wire_yes", 6)],
         {"total": [(6, 3, 2)], "narrowed": [(1, 0, 0)]}),
        ([(1, "Y", None)], {"total": [(1, 1, 0)], "narrowed": [(0, 0, 0)]}),
        ([], {"total": [(0, 0, 0)], "narrowed": [(0, 0, 0)]}),
    ]:
        db.execute("DELETE FROM filtered_rows")
        db.executemany("INSERT INTO filtered_rows VALUES (?, ?, ?)", rows)
        for case in cases:
            assert execute(case) == sorted(expected[case["id"]], key=repr), (case, execute(case))
print("Passed 6 SQLite filtered-count cases: domain wire mappings, raw-name collisions, NULL, narrowed and empty populations")
