#!/usr/bin/env python3
"""执行 Graph 计算维度的 SQLite 查询，核对单位换算、NULL 和筛选语义。"""
import json
from pathlib import Path
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[1]
result = subprocess.run([
    str(ROOT / "bin/telora"), "-C", str(ROOT / "relation_model"), "eval",
    "@test/typed_dimensions:runtime_cases", "--initialization-fuel", "100000",
    "--request-fuel", "100000", "--with-memory-limit", "1024",
], capture_output=True, text=True, check=True, timeout=180)
cases = json.loads(result.stdout)
assert [case["id"] for case in cases] == ["projection", "filter"]
with sqlite3.connect(":memory:") as db:
    db.execute("CREATE TABLE samples (seq INTEGER, tenant TEXT, device TEXT, amount REAL, ms REAL)")
    db.executemany("INSERT INTO samples VALUES (?, ?, ?, ?, ?)", [
        (1, "T1", "A", 100, 2000),
        (2, "T2", "A", 90, 3000),
        (3, "T1", None, 50, 1000),
        (4, "T1", "B", 0, 1000),
        (5, "T1", "B", 100, 0),
        (6, "T1", "B", 100, -1000),
        (7, "T1", "B", None, 1000),
        (8, "T1", "B", 100, None),
    ])
    expected = {
        "projection": [
            (2.0, 50.0, "T1", "A"), (3.0, 30.0, "T2", "A"),
            (1.0, 50.0, None, None), (1.0, 0.0, "T1", "B"),
            (0.0, None, "T1", "B"), (-1.0, None, "T1", "B"),
            (1.0, None, "T1", "B"), (None, None, "T1", "B"),
        ],
        "filter": [(2.0, 50.0), (1.0, 50.0)],
    }
    for case in cases:
        query = case["query"]
        bindings = {str(index + 1): value for index, value in enumerate(query["bindings"])}
        rows = db.execute(query["sql"], bindings).fetchall()
        assert sorted(rows, key=repr) == sorted(expected[case["id"]], key=repr), (case["id"], rows, query)
    db.execute("DELETE FROM samples")
    for case in cases:
        query = case["query"]
        bindings = {str(index + 1): value for index, value in enumerate(query["bindings"])}
        assert db.execute(query["sql"], bindings).fetchall() == []
print("Passed Graph computed dimensions: conversions, rates, complete nullable identity, filters, aliases and empty input")
