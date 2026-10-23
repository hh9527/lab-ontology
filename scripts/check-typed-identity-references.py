#!/usr/bin/env python3
"""实际执行显式原始引用映射，保留复合身份、可空性和物理编码。"""
import json
from pathlib import Path
import sqlite3
import subprocess

root = Path(__file__).resolve().parents[1]
result = subprocess.run([
    str(root / "bin/telora"), "-C", str(root / "relation_model"), "eval", "@test/typed_identity_references:runtime_cases",
    "--initialization-fuel", "100000", "--request-fuel", "100000", "--with-memory-limit", "1024",
], capture_output=True, text=True, timeout=180)
assert result.returncode == 0, (result.stdout, result.stderr)
cases = json.loads(result.stdout)
assert {case["id"] for case in cases} == {"all", "joined", "reverse_empty", "exists"}
with sqlite3.connect(":memory:") as db:
    db.execute("CREATE TABLE raw_references (MEDN TEXT, id TEXT, tenant_id TEXT, z_device_id TEXT)")
    db.execute("CREATE TABLE devices (id TEXT, site_id TEXT, tenant_id TEXT)")
    db.executemany("INSERT INTO devices VALUES (?, ?, ?)", [("A", "S", "T1"), ("3", "S", "T1"), ("A", "S", "T2"), ("B", "S", "T1")])
    db.executemany("INSERT INTO raw_references VALUES (?, ?, ?, ?)", [
        ("A", "c1", "T1", "B"), ("3", "c2", "T1", "B"), ("A", "c3", "T2", "B"),
        (None, "c4", "T1", "B"), ("missing", "c5", "T1", "B"), ("A", "c6", "T3", "B"),
    ])
    expected = {"all": [(6,)], "joined": [("A",), ("A",), ("3",)], "reverse_empty": [("A", 1), ("A", 1), ("3", 1), ("B", 0)], "exists": [(3,)]}
    def execute(case):
        assert case["sqlite"]["bindings"] == case["postgres"]["bindings"]
        query = case["sqlite"]
        return sorted(db.execute(query["sql"], {str(i + 1): value for i, value in enumerate(query["bindings"])}).fetchall(), key=repr)
    for case in cases:
        actual = execute(case)
        assert actual == sorted(expected[case["id"]], key=repr), (case, actual)
    db.execute("DELETE FROM raw_references")
    expected = {"all": [(0,)], "joined": [], "reverse_empty": [("A", 0), ("A", 0), ("3", 0), ("B", 0)], "exists": [(0,)]}
    for case in cases:
        actual = execute(case)
        assert actual == sorted(expected[case["id"]], key=repr), (case, actual)
print("Passed 8 SQLite raw identity reference cases: unchanged storage, physical mapping, tenant keys, NULL, orphan references, reverse empty groups and EXISTS")
