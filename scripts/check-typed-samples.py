#!/usr/bin/env python3
"""执行类型化样本统计模板，验证 Latest 的时钟、grain 并列和 NULL 语义。"""
import json
from pathlib import Path
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[1]
result = subprocess.run([
    str(ROOT / "bin/telora"), "-C", str(ROOT / "relation_model"), "eval",
    "@test/typed_samples:runtime_cases", "--initialization-fuel", "100000",
    "--request-fuel", "100000", "--with-memory-limit", "1024",
], capture_output=True, text=True, check=True, timeout=180)
cases = json.loads(result.stdout)
expected = {
    "counts": [(20, 10.0)],
    "text": [(42,)],
    "integer": [(9007199254740993,)],
    "mixed": [("a", 85.0, 85.0, 85.0, None, 95.0, 2), ("b", 50.0, 10.0, 90.0, 90.0, 20.0, 2),
              ("c", 84.5, 70.0, 99.0, 70.0, None, 2), ("d", 100.0, 100.0, 100.0, None, None, 1),
              ("e", 60.0, 20.0, 100.0, 20.0, 30.0, 2)],
    "window": [("a", None), ("b", 90.0), ("c", 70.0)],
    "total": [(71.75, None, 9)],
}
assert {case["id"] for case in cases} == expected.keys()
with sqlite3.connect(":memory:") as db:
    db.execute("CREATE TABLE count_samples (seq INTEGER, at INTEGER, value INTEGER)")
    db.executemany("INSERT INTO count_samples VALUES (?, ?, ?)", [(1, 1, 4), (2, 2, 16)])
    db.execute("CREATE TABLE text_samples (seq INTEGER, at TEXT, value INTEGER)")
    db.executemany("INSERT INTO text_samples VALUES (?, ?, ?)", [(1, "1969-12-31T23:59:59Z", 10), (2, "1970-01-01T00:00:00Z", 42), (3, "1970-01-01T00:00:00Z", 99)])
    db.execute("CREATE TABLE integer_samples (seq INTEGER, at INTEGER, value INTEGER)")
    db.executemany("INSERT INTO integer_samples VALUES (?, ?, ?)", [(1, 1, 10), (2, 2, 9007199254740993)])
    db.execute("CREATE TABLE sample_rows (seq INTEGER, owner TEXT, UTC_MS INTEGER, local INTEGER, RX_RATE REAL, TX_RATE REAL)")
    db.executemany("INSERT INTO sample_rows VALUES (?, ?, ?, 0, ?, ?)", [
        (1, "a", -1, 85, 10), (2, "a", 1, None, 95), (3, "b", -1, 10, 90), (4, "b", 1, 90, 20),
        (5, "c", 1, 70, None), (6, "c", 1, 99, 99), (7, "d", None, 100, 100),
        (8, "e", -1, 20, 30), (9, "e", None, 100, 100),
    ])
    def execute(case):
        query = case["sqlite"]
        assert query["bindings"] == case["postgres"]["bindings"], case["id"]
        bindings = {str(i + 1): value for i, value in enumerate(query["bindings"])}
        return db.execute(query["sql"], bindings).fetchall()
    for case in cases:
        rows = execute(case)
        assert sorted(rows) == expected[case["id"]], (case["id"], rows, case)
    db.execute("DELETE FROM sample_rows")
    db.execute("DELETE FROM integer_samples")
    db.execute("DELETE FROM text_samples")
    db.execute("DELETE FROM count_samples")
    for case in cases:
        rows = execute(case)
        assert rows == ([(None, None, 0)] if case["id"] == "total" else [(None, None)] if case["id"] == "counts" else [(None,)] if case["id"] in {"integer", "text"} else []), (case["id"], rows)
    db.executemany("INSERT INTO sample_rows VALUES (?, 'nulls', ?, 0, NULL, NULL)", [(1, -1), (2, 1)])
    rows = execute(next(case for case in cases if case["id"] == "mixed"))
    assert rows == [("nulls", None, None, None, None, None, 2)], rows
print("Passed typed sample SQLite queries for repeated rate groups, Avg/Min/Max/Latest, clock NULLs, grain ties, newest NULL, time window and empty/all-NULL input")
