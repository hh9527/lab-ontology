#!/usr/bin/env python3
"""执行 CurrentAlarm 全字段、业务域、六个度量和十条关系的新旧 SQL 对照。"""
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
        str(ROOT / "bin/telora"), "-C", str(ROOT / "icloud_model"), "eval", "@test/typed_current_alarm_runtime:runtime_fixture",
        "--initialization-fuel", "200000", "--request-fuel", "100000", "--with-memory-limit", "2048",
    ], capture_output=True, text=True, timeout=240)
    assert result.returncode == 0, (result.stdout, result.stderr)
    fixture = json.loads(result.stdout)
cases = fixture["cases"]
assert len(cases) == len({case["id"] for case in cases})
entities = {id: (table, columns) for id, table, columns in fixture["schema"]}
with sqlite3.connect(":memory:") as db:
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
    insert("device", {"id": "D1", "tenantId": "t1"})
    insert("server_device", {"id": "SV1", "name": "Server One"})
    insert("storage_device", {"id": "ST1"})
    insert("pon_device", {"id": "P1"})
    for site in ["s1", "s2", "3", "empty"]:
        insert("site", {"SITE_ID": site, "SITE_TYPE": "onlineSite"})
    for tenant in ["t1", "t2"]:
        insert("tenant", {"TENANT_ID": tenant})
    rows = [
        (1, 1, 0, "D1", "s1", "t1"), (2, 2, 1, "SV1", "s1", "t1"),
        (3, 3, 0, "ST1", "3", "t2"), (4, 4, 1, "P1", "s2", "orphan"),
        (5, 9, 9, "missing", "missing", "t1"), (6, None, 0, "D1", "s1", "t1"),
        (7, 2, 0, "D1", "s2", "t2"), (8, 1, 1, "D1", "3", "t1"),
    ]
    for csn, severity, cleared, resource, site, tenant in rows:
        insert("current_alarm", {"CSN": csn, "OCCURUTC": csn * 1000, "SEVERITY": severity, "CLEARED": cleared,
            "MEDN": resource, "STREXT13": site, "TENANTID": tenant, "ALARMNAME": f"alarm_%_{csn}",
            "CHANGEFLAG": (csn - 1) % 3 + 1, "CLEARCATEGORY": (csn - 1) % 2 + 1, "ACKED": csn % 2, "EVENTTYPE": csn})
    expected = {
        "totals": [(8, 4, 2, 2, 4, 6)], "uncleared": [(4, 4, 1, 1, 2, 3)], "window": [(5, 2, 0, 1, 1, 1)],
        "tenant_groups": [("t1", 5), ("t2", 2), ("orphan", 1)],
        "name_search": [(i,) for i in range(1, 9)], "project_alarm_csn": [(i,) for i in range(1, 9)],
        "project_alarm_name": [(f"alarm_%_{i}",) for i in range(1, 9)],
        "alarm_site_reference": [(1, "s1"), (2, "s1"), (4, "s2"), (6, "s1"), (7, "s2")],
        "source_X_SITE_VIEW_T_CURRENT_ALARM": [(1, "s1"), (2, "s1"), (3, "3"), (4, "s2"), (6, "s1"), (7, "s2"), (8, "3")],
        "alarm_belongs_to_tenant": [(r[0], r[5]) for r in rows if r[5] != "orphan"],
        "server_current_alarm": [(2, "Server One")], "device_current_alarm": [(r[0], "D1") for r in rows if r[3] == "D1"],
        "source_HuaweiStorageDeviceAggregationT_CURRENT_ALARM": [(3, "ST1")], "source_EntPonElementAssociationT_CURRENT_ALARM": [(4, "P1")],
        "semantic_site_exists": [(1,), (2,), (4,), (6,), (7,)], "source_site_exists": [(1,), (2,), (3,), (4,), (6,), (7,), (8,)],
        "severity_groups": [("critical", 2, 4), ("major", 2, 2), ("minor", 1, 0), ("warning", 1, 0)],
    }
    expected["source_EntNetworkElement_T_CURRENT_ALARM"] = expected["device_current_alarm"]
    expected["source_PhysicalServer_T_CURRENT_ALARM"] = expected["server_current_alarm"]
    expected["source_X_TENANT_VIEW_T_CURRENT_ALARM"] = expected["alarm_belongs_to_tenant"]
    domain_inputs = {
        "alarm_severity": ([row[1] for row in rows], {"critical": 1, "major": 2, "minor": 3, "warning": 4}),
        "alarm_cleared": ([row[2] for row in rows], {"uncleared": 0, "cleared": 1}),
        "alarm_change_flag": ([(row[0] - 1) % 3 + 1 for row in rows], {"add": 1, "update": 2, "delete": 3}),
        "current_alarm__CLEARCATEGORY": ([(row[0] - 1) % 2 + 1 for row in rows], {}),
        "current_alarm__ACKED": ([row[0] % 2 for row in rows], {}),
        "current_alarm__EVENTTYPE": ([row[0] for row in rows], {}),
    }
    for case in cases:
        for dimension, (inputs, named) in domain_inputs.items():
            prefix = f"filter_{dimension}_"
            if case["id"].startswith(prefix):
                member, op = case["id"][len(prefix):].rsplit("_", 1)
                code = named[member] if member in named else int(member.split("_")[1])
                known_codes = set(named.values()) if named else ({0, 1} if dimension.endswith("ACKED") else {1, 2} if dimension.endswith("CLEARCATEGORY") else set(range(1, 22)))
                expected[case["id"]] = [(row[0],) for row, value in zip(rows, inputs)
                    if value is not None and ((value == code) if op == "Eq" else (value in known_codes and value != code))]
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
        if case["id"] in ["totals", "uncleared", "window"]:
            assert actual == [(0, 0, 0, 0, 0, 0)], (case["id"], actual)
print(f"Passed {len(cases)} CurrentAlarm SQLite typed/baseline pairs and empty-table checks; PostgreSQL bindings only")
