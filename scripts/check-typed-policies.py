#!/usr/bin/env python3
"""执行带名义类型和物理映射的维度策略 SQL，核对文本和数值边界。"""
import json
from pathlib import Path
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[1]
result = subprocess.run([
    str(ROOT / "bin/telora"), "-C", str(ROOT / "relation_model"), "eval",
    "@test/typed_policies:runtime_cases", "--initialization-fuel", "100000",
    "--request-fuel", "100000", "--with-memory-limit", "1024",
], capture_output=True, text=True, check=True, timeout=180)
cases = json.loads(result.stdout)
expected = {
    "eq": [1], "ne": [2, 3, 4, 6, 7],
    "contains": [1, 2, 6, 7], "not_contains": [3, 4],
    "starts": [1, 2, 6], "ends": [1, 6, 7],
    "literal_pattern": [4], "literal_prefix": [], "suffix": [4],
    "numeric_gt": [7], "numeric_ge": [2, 6, 7], "numeric_lt": [5],
    "numeric_le": [4, 5], "numeric_eq": [2, 6], "numeric_ne": [1, 4, 5, 7],
    "int_gt": [4, 5, 6, 7], "bool_ne": [1, 3, 5, 7], "restricted_eq": [1],
}
assert {case["id"] for case in cases} == expected.keys()
with sqlite3.connect(":memory:") as db:
    db.execute("CREATE TABLE policy_rows (seq INTEGER, LABEL_TEXT TEXT, BYTE_VALUE REAL, COUNT_VALUE INTEGER, active INTEGER)")
    db.executemany("INSERT INTO policy_rows VALUES (?, ?, ?, ?, ?)", [
        (1, "alpha", 1.5, 1, True), (2, "alphabet", 3.0, 2, False),
        (3, "beta", None, 3, True), (4, "a%_literal", 0, 4, False),
        (5, None, -1.0, 5, True), (6, "ALPHA", 3.0, 6, False),
        (7, "tailalpha", 10.0, 7, True),
    ])
    for case in cases:
        query = case["sqlite"]
        assert query["bindings"] == case["postgres"]["bindings"], case["id"]
        bindings = {str(index + 1): value for index, value in enumerate(query["bindings"])}
        rows = db.execute(query["sql"], bindings).fetchall()
        assert sorted(row[0] for row in rows) == expected[case["id"]], (case["id"], rows, query)
        assert "alpha" not in query["sql"] and "%_" not in query["sql"], query
    db.execute("DELETE FROM policy_rows")
    for case in cases:
        query = case["sqlite"]
        bindings = {str(index + 1): value for index, value in enumerate(query["bindings"])}
        assert db.execute(query["sql"], bindings).fetchall() == [], case["id"]
print(f"Passed {len(cases)} typed policy queries: text literals/case/NULL, numeric ordering, boolean inputs and filter-only binding")
