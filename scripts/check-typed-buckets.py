#!/usr/bin/env python3
"""执行类型化 UTC 分桶 SQL，验证负 epoch、月界、闰日和时间窗。"""
import json
from pathlib import Path
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[1]
result = subprocess.run([
    str(ROOT / "bin/telora"), "-C", str(ROOT / "relation_model"), "eval",
    "@test/typed_buckets:runtime_cases", "--initialization-fuel", "100000",
    "--request-fuel", "100000", "--with-memory-limit", "1024",
], capture_output=True, text=True, check=True, timeout=180)
cases = json.loads(result.stdout)
expected = {
    "project": [
        (1, -86400000, -2678400000, "1969-12-31T23:00:00Z", "1969-12-31T00:00:00Z", "1969-12-01"),
        (2, 0, 0, "1970-01-01T00:00:00Z", "1970-01-01T00:00:00Z", "1970-01-01"),
        (3, 0, 0, "1970-01-01T23:00:00Z", "1970-01-01T00:00:00Z", "1970-01-01"),
        (4, 86400000, 0, "1970-01-02T00:00:00Z", "1970-01-02T00:00:00Z", "1970-02-01"),
        (5, 1709164800000, 1706745600000, "2024-02-29T23:00:00Z", "2024-02-29T00:00:00Z", "2024-02-01"),
        (6, None, None, None, None, None),
    ],
    "grouped": [(None, 1), (-86400000, 1), (0, 2), (86400000, 1), (1709164800000, 1)],
    "window": [(1,), (2,), (3,)],
}
assert {case["id"] for case in cases} == expected.keys()
with sqlite3.connect(":memory:") as db:
    db.execute("CREATE TABLE bucket_rows (seq INTEGER, EPOCH_MS INTEGER, UTC_TEXT TEXT, date TEXT, local INTEGER)")
    db.executemany("INSERT INTO bucket_rows VALUES (?, ?, ?, ?, 0)", [
        (1, -1, "1969-12-31T23:59:59Z", "1969-12-31"),
        (2, 0, "1970-01-01T00:00:00Z", "1970-01-01"),
        (3, 86399999, "1970-01-01T23:59:59Z", "1970-01-31"),
        (4, 86400000, "1970-01-02T00:00:00Z", "1970-02-28"),
        (5, 1709251199999, "2024-02-29T23:59:59Z", "2024-02-29"),
        (6, None, None, None),
    ])
    for case in cases:
        query = case["sqlite"]
        assert query["bindings"] == case["postgres"]["bindings"], case["id"]
        bindings = {str(i + 1): value for i, value in enumerate(query["bindings"])}
        rows = db.execute(query["sql"], bindings).fetchall()
        assert sorted(rows, key=repr) == sorted(expected[case["id"]], key=repr), (case["id"], rows, query)
    db.execute("DELETE FROM bucket_rows")
    for case in cases:
        query = case["sqlite"]
        bindings = {str(i + 1): value for i, value in enumerate(query["bindings"])}
        assert db.execute(query["sql"], bindings).fetchall() == [], case["id"]
print("Passed 3 typed UTC bucket SQLite queries: negative epoch, UTC hour/day/month, leap day, NULL, grouping, time window and empty input")
