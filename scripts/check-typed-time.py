#!/usr/bin/env python3
"""执行具名时间类型的实际 SQL，保留 UTC、本地时钟和日期边界。"""
import json
from pathlib import Path
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[1]
result = subprocess.run([
    str(ROOT / "bin/telora"), "-C", str(ROOT / "relation_model"), "eval",
    "@test/typed_time:runtime_cases", "--initialization-fuel", "100000",
    "--request-fuel", "100000", "--with-memory-limit", "1024",
], capture_output=True, text=True, check=True, timeout=180)
cases = json.loads(result.stdout)
expected = {"window": [2], "utc_ge": [2, 3], "utc_lt": [1, 2], "epoch_ge": [2, 3],
            "wall_time_lt": [1, 2, 4], "local_ge": [2, 3], "date_eq": [1, 2]}
assert {case["id"] for case in cases} == expected.keys()
with sqlite3.connect(":memory:") as db:
    db.execute("CREATE TABLE clock_rows (seq INTEGER, UTC_TEXT TEXT, epoch INTEGER, wall_time TEXT, local TEXT, date TEXT)")
    db.executemany("INSERT INTO clock_rows VALUES (?, ?, ?, ?, ?, ?)", [
        (1, "2024-02-29T11:59:59Z", 999, "2024-02-29 11:59:59", "2024-02-29 11:59:59", "2024-02-29"),
        (2, "2024-02-29T12:00:00Z", 1000, "2024-02-29 12:00:00", "2024-02-29 12:00:00", "2024-02-29"),
        (3, "2024-03-01T00:00:00Z", 1001, "2024-03-01 00:00:00", "2024-03-01 00:00:00", "2024-03-01"),
        (4, None, -1, "2024-02-28 00:00:00", "2024-02-28 00:00:00", "2024-02-28"),
    ])
    for case in cases:
        query = case["sqlite"]
        assert query["bindings"] == case["postgres"]["bindings"], case["id"]
        bindings = {str(i + 1): value for i, value in enumerate(query["bindings"])}
        rows = db.execute(query["sql"], bindings).fetchall()
        assert sorted(row[0] for row in rows) == expected[case["id"]], (case["id"], rows, query)
    db.execute("DELETE FROM clock_rows")
    for case in cases:
        query = case["sqlite"]
        bindings = {str(i + 1): value for i, value in enumerate(query["bindings"])}
        assert db.execute(query["sql"], bindings).fetchall() == [], case["id"]
print(f"Passed {len(cases)} typed time SQLite queries: UTC/local/date formats, half-open comparison boundaries and empty input")
