#!/usr/bin/env python3
"""执行协作设备字段、状态域、IPv4、租户和告警总体的新旧 SQL 对照。"""
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
        str(ROOT / "bin/telora"), "-C", str(ROOT / "icloud_model"), "eval", "@test/typed_collaboration_runtime:runtime_fixture",
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
    for tenant in ["t1", "t2"]:
        insert("tenant", {"TENANT_ID": tenant})
    rows = [
        ("C1", "t1", "0", "Collaboration", "192.0.2.1"),
        ("C2", "t2", "3", "Collaboration", "2001:db8::1"),
        ("C3", "orphan", "9", "other", "192.0.2.01"),
        ("C4", "t1", None, "Collaboration", "198.51.100.1"),
        ("C5", "t1", "0", None, None),
    ]
    for index, (id, tenant, state, classification, address) in enumerate(rows):
        insert("source_EntCollaborationElement", {"id": id, "tenantId": tenant, "operState": state,
            "classification": classification, "ipAddress": address, "createTime": (index + 1) * 1000, "name": f"source_%_{id}"})
    for csn, resource, cleared, tenant in [(1, "C1", 0, "t1"), (2, "C1", 1, "t2"), (3, "C2", 1, "t2"), (4, "missing", 0, "t1")]:
        insert("current_alarm", {"CSN": csn, "MEDN": resource, "CLEARED": cleared, "SEVERITY": 1, "TENANTID": tenant})
    expected = {
        "count": [(5,)], "window": [(3,)], "status_groups": [("wire_0_91adcf51", 2), ("wire_3_5566f006", 1)],
        "class_groups": [("wire_Collaboration_3ea905f6", 3)], "tenant_groups": [("t1", 3), ("t2", 1), ("orphan", 1)],
        "name_search": [(row[0],) for row in rows], "subnet": [("C1",)], "not_subnet": [("C4",)],
        "tenant_relation": [(row[0], row[1]) for row in rows if row[1] != "orphan"],
        "alarm_rows": [("C1", 1), ("C1", 2), ("C2", 3)], "alarm_exists": [(2,)], "alarm_totals": [("C1", 2, 1), ("C2", 1, 0)],
        "project_source_EntCollaborationElement__ipAddress_ipv4": [("192.0.2.1",), (None,), (None,), ("198.51.100.1",), (None,)],
    }
    domains = {
        "source_EntCollaborationElement__operState": ([row[2] for row in rows], {"wire_0_91adcf51": "0", "wire_3_5566f006": "3"}),
        "source_EntCollaborationElement__classification": ([row[3] for row in rows], {"wire_Collaboration_3ea905f6": "Collaboration"}),
    }
    for case in cases:
        for dimension, (inputs, mapping) in domains.items():
            prefix = f"filter_{dimension}_"
            if not case["id"].startswith(prefix):
                continue
            member, op = case["id"][len(prefix):].rsplit("_", 1)
            expected[case["id"]] = [(row[0],) for row, value in zip(rows, inputs)
                if value is not None and ((value == mapping[member]) if op == "Eq" else (value in mapping.values() and value != mapping[member]))]
    def run(query):
        return sorted(db.execute(query["sql"], {str(i + 1): value for i, value in enumerate(query["bindings"])}).fetchall(), key=repr)
    for case in cases:
        assert case["columns"] == case["baseline_columns"], case["id"]
        assert case["typed"]["bindings"] == case["baseline"]["bindings"] == case["postgres"]["bindings"], case["id"]
        actual = run(case["typed"])
        assert actual == run(case["baseline"]), (case["id"], actual, run(case["baseline"]))
        if case["id"] in expected:
            assert actual == sorted(expected[case["id"]], key=repr), (case["id"], actual, expected[case["id"]])
    for table in schemas:
        db.execute(f'DELETE FROM "{table}"')
    for case in cases:
        actual = run(case["typed"])
        assert actual == run(case["baseline"]), ("empty", case["id"], actual)
        if case["id"] in ["count", "window", "alarm_exists"]:
            assert actual == [(0,)], (case["id"], actual)
print(f"Passed {len(cases)} collaboration SQLite typed/baseline pairs and empty-table checks; PostgreSQL bindings only")
