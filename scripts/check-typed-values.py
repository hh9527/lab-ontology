#!/usr/bin/env python3
"""执行类型化业务值域 SQL，核对源编码归一与半开放未知值边界。"""
import json
from pathlib import Path
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[1]
result = subprocess.run([
    str(ROOT / "bin/telora"), "-C", str(ROOT / "relation_model"), "eval",
    "@test/typed_values:runtime_cases", "--initialization-fuel", "100000",
    "--request-fuel", "100000", "--with-memory-limit", "1024",
], capture_output=True, text=True, check=True, timeout=180)
cases = json.loads(result.stdout)
expected = {
    "project": [(1, "Online", "LoadBalancer", "Known"), (2, "Online", "LoadBalancer", "Known"),
                (3, "Offline", "Other", "Known"), (6, "Online", "", "Unknown")],
    "open_project": [(1, "LoadBalancer", "Known"), (2, "LoadBalancer", "Known"),
                     (3, "Other", "Known"), (4, "LoadBalancer", "Unknown"),
                     (5, "new", "Unknown"), (6, "", "Unknown"), (7, None, None)],
    "online": [(1,), (2,), (6,)], "not_online": [(3,)],
    "known_class": [(1,), (2,)], "not_class": [(3,), (4,), (5,), (6,)],
    "collision": [(4,)], "unknowns": [(4,), (5,), (6,)], "knowns": [(1,), (2,), (3,)],
}
assert {case["id"] for case in cases} == expected.keys()
with sqlite3.connect(":memory:") as db:
    db.execute("CREATE TABLE value_rows (seq INTEGER, STATE_CODE INTEGER, CLASS_CODE TEXT)")
    db.executemany("INSERT INTO value_rows VALUES (?, ?, ?)", [
        (1, 0, "lb"), (2, 2, "ne.category.lb"), (3, 1, "other"),
        (4, 9, "LoadBalancer"), (5, None, "new"), (6, 0, ""), (7, None, None),
    ])
    for case in cases:
        query = case["sqlite"]
        assert query["bindings"] == case["postgres"]["bindings"], case["id"]
        rows = db.execute(query["sql"], {str(i + 1): value for i, value in enumerate(query["bindings"])}).fetchall()
        assert sorted(rows) == expected[case["id"]], (case["id"], rows, query)
    db.execute("DELETE FROM value_rows")
    for case in cases:
        query = case["sqlite"]
        assert db.execute(query["sql"], {str(i + 1): value for i, value in enumerate(query["bindings"])}).fetchall() == [], case["id"]
print(f"Passed {len(cases)} typed domain SQLite queries including canonical collisions, unknowns, NULL and empty input")
