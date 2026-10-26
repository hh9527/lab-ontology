#!/usr/bin/env python3
"""执行类型化 IPv4 部分转换与子网筛选 SQL。"""
import json
from pathlib import Path
import re
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[1]
result = subprocess.run([
    str(ROOT / "bin/telora"), "-C", str(ROOT / "relation_model"), "eval",
    "@test/typed_scalars:runtime_cases", "--initialization-fuel", "100000",
    "--request-fuel", "100000", "--with-memory-limit", "1024",
], capture_output=True, text=True, check=True, timeout=180)
cases = json.loads(result.stdout)
raws = ["192.0.2.1", "192.0.2.200", "198.51.100.1", "192.000.2.1", "256.0.0.1",
        "2001:db8::1", "192.0.2.1\n", "", None, "0.0.0.0", "255.255.255.255"]
valid = {1, 2, 3, 10, 11}
expected = {
    "project": [(i, raw if i in valid else None) for i, raw in enumerate(raws, 1)],
    "eq": [(1,)], "ne": [(2,), (3,), (10,), (11,)],
    "subnet": [(1,), (2,)], "outside": [(3,), (10,), (11,)],
    "all": [(i,) for i in sorted(valid)], "exact": [(1,)], "non_octet": [(1,)], "raw": [(6,)],
}
assert {case["id"] for case in cases} == expected.keys()
with sqlite3.connect(":memory:") as db:
    db.create_function("regexp", 2, lambda pattern, value: None if value is None else bool(re.search(pattern, value)))
    db.execute("CREATE TABLE address_rows (seq INTEGER, ADDRESS_TEXT TEXT)")
    db.executemany("INSERT INTO address_rows VALUES (?, ?)", enumerate(raws, 1))
    for case in cases:
        query = case["sqlite"]
        assert query["bindings"] == case["postgres"]["bindings"], case["id"]
        bindings = {str(i + 1): value for i, value in enumerate(query["bindings"])}
        rows = db.execute(query["sql"], bindings).fetchall()
        assert sorted(rows) == expected[case["id"]], (case["id"], rows, query)
    db.execute("DELETE FROM address_rows")
    for case in cases:
        query = case["sqlite"]
        bindings = {str(i + 1): value for i, value in enumerate(query["bindings"])}
        assert db.execute(query["sql"], bindings).fetchall() == [], case["id"]
print(f"Passed {len(cases)} typed scalar SQLite queries: IPv4 validation, subnet complements, NULL and raw text independence")
