#!/usr/bin/env python3
"""执行带 hub 条件的双向/单向业务连接，不限制原始端点关系。"""
import json
from pathlib import Path
import sqlite3
import subprocess

root = Path(__file__).resolve().parents[1]
result = subprocess.run([
    str(root / "bin/telora"), "-C", str(root / "relation_model"), "eval", "@test/typed_link_guards:runtime_cases",
    "--initialization-fuel", "100000", "--request-fuel", "100000", "--with-memory-limit", "1024",
], capture_output=True, text=True, timeout=180)
assert result.returncode == 0, (result.stdout, result.stderr)
cases = json.loads(result.stdout)
assert {case["id"] for case in cases} == {"all", "endpoints", "peer", "directed"}
with sqlite3.connect(":memory:") as db:
    db.execute("CREATE TABLE connections (a_device_id TEXT, id TEXT, tenant_id TEXT, z_device_id TEXT)")
    db.execute("CREATE TABLE devices (id TEXT, site_id TEXT, tenant_id TEXT)")
    db.executemany("INSERT INTO devices VALUES (?, ?, ?)", [(id, "S", tenant) for id, tenant in [("A", "T1"), ("B", "T1"), ("3", "T1"), ("A", "T2"), ("B", "T2")]])
    db.executemany("INSERT INTO connections VALUES (?, ?, ?, ?)", [
        ("A", "c1", "T1", "B"), ("3", "c2", "T1", "A"), ("B", "c3", "T1", "3"),
        ("A", "c4", "T1", "A"), ("A", "c5", "T2", "B"), ("A", "c6", "T3", "B"),
        (None, "c7", "T1", "B"), ("A", "c8", "T1", "missing"),
    ])
    expected = {"all": [(8,)], "endpoints": [("A",)] * 4 + [("3",), ("B",)],
        "peer": [("A", "B"), ("B", "A"), ("B", "3"), ("3", "B"), ("A", "A")],
        "directed": [("A", "B"), ("B", "3"), ("A", "A")]}
    def execute(case):
        assert case["sqlite"]["bindings"] == case["postgres"]["bindings"]
        query = case["sqlite"]
        return sorted(db.execute(query["sql"], {str(i + 1): value for i, value in enumerate(query["bindings"])}).fetchall(), key=repr)
    for case in cases:
        actual = execute(case)
        assert actual == sorted(expected[case["id"]], key=repr), (case, actual)
    db.execute("DELETE FROM connections")
    for case in cases:
        actual = execute(case)
        assert actual == ([(0,)] if case["id"] == "all" else []), (case, actual)
print("Passed 8 SQLite guarded business-link cases: independent endpoints, direction, hub guard in both orientations, tenant identity, self-loop, NULL, orphan and empty source")
