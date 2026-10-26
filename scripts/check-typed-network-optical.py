#!/usr/bin/env python3
"""执行无主键网络光模块来源投影和文本过滤的新旧 SQL 对照。"""
import json
from pathlib import Path
import re
import sqlite3
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
if len(sys.argv) > 1:
    fixture = json.loads(Path(sys.argv[1]).read_text())
else:
    result = subprocess.run([
        str(ROOT / "bin/telora"), "-C", str(ROOT / "icloud_model"), "eval", "@test/typed_network_optical_runtime:runtime_fixture",
        "--initialization-fuel", "250000", "--request-fuel", "100000", "--with-memory-limit", "2048",
    ], capture_output=True, text=True, timeout=240)
    assert result.returncode == 0, (result.stdout, result.stderr)
    fixture = json.loads(result.stdout)
cases = fixture["cases"]
assert len(cases) == len({case["id"] for case in cases})
entities = {id: (table, columns) for id, table, columns in fixture["schema"]}
with sqlite3.connect(":memory:") as db:
    db.create_function("regexp", 2, lambda pattern, value: None if value is None else bool(re.search(pattern, value)))
    schemas = {}
    for _, table, columns in fixture["schema"]:
        merged = schemas.setdefault(table, {})
        for _, column, affinity in columns:
            assert re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", column)
            assert column not in merged or merged[column] == affinity
            merged[column] = affinity
    for table, columns in schemas.items():
        assert re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", table)
        db.execute(f'CREATE TABLE "{table}" (' + ','.join(f'"{name}" {affinity}' for name, affinity in columns.items()) + ')')
    def insert(entity, overrides):
        table, columns = entities[entity]
        values = {column: 0 if affinity != "TEXT" else f"raw_{column}_%" for _, column, affinity in columns}
        values.update(overrides)
        names = list(values)
        db.execute(f'INSERT INTO "{table}" (' + ','.join(f'"{name}"' for name in names) + ') VALUES (' + ','.join('?' for _ in names) + ')', [values[name] for name in names])
    fields = ["neResId", "version", "vendorPn", "vendorName", "vendorSn", "ifName", "projectId"]
    rows = [
        {field: "device-1" if field == "neResId" else "raw_%" for field in fields},
        {field: "device-1" if field == "neResId" else "raw_%" for field in fields},
        {field: "device-1" if field == "neResId" else "_%start" for field in fields},
        {field: "device-1" if field == "neResId" else "end_%" for field in fields},
        {field: "device-2" if field == "neResId" else "middle_%value" for field in fields},
        {field: "device-2" if field == "neResId" else "raw_AX" for field in fields},
        {field: None for field in fields},
    ]
    for row in rows:
        insert("source_EnterpriseOpticalModule", row)
    def run(query):
        return sorted(db.execute(query["sql"], {str(i + 1): value for i, value in enumerate(query["bindings"])}).fetchall(), key=repr)
    comparisons = {"Eq": lambda value, target: value == target, "Ne": lambda value, target: value != target,
        "Contains": lambda value, target: target in value, "NotContains": lambda value, target: target not in value, "StartsWith": lambda value, target: value.startswith(target),
        "EndsWith": lambda value, target: value.endswith(target)}
    for case in cases:
        assert case["columns"] == case["baseline_columns"], case["id"]
        assert case["typed"]["bindings"] == case["baseline"]["bindings"] == case["postgres"]["bindings"], case["id"]
        actual = run(case["typed"])
        assert actual == run(case["baseline"]), (case["id"], actual, run(case["baseline"]))
        if case["id"].startswith("project_"):
            expected = [(row[case["id"][len("project_"):]],) for row in rows]
        elif case["id"] == "all_fields":
            expected = [tuple(row[field] for field in fields) for row in rows]
        else:
            dimension, op = case["id"].rsplit("_", 1)
            target = ("device-1" if dimension == "neResId" else "raw_%") if op in ["Eq", "Ne"] else "_%"
            expected = [tuple(row[field] for field in fields) for row in rows if row[dimension] is not None and comparisons[op](row[dimension], target)]
        assert actual == sorted(expected, key=repr), (case["id"], actual, expected)
    for table in schemas:
        db.execute(f'DELETE FROM "{table}"')
    for case in cases:
        assert run(case["typed"]) == run(case["baseline"]) == [], ("empty", case["id"])
print(f"Passed {len(cases)} network optical SQLite typed/baseline pairs and empty-table checks; PostgreSQL bindings only")
