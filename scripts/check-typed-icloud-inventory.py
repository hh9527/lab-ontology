#!/usr/bin/env python3
"""逐项执行首批 IC 独立声明与基线 SQL，验证字段、过滤、值域和关系。"""
import json
from pathlib import Path
import re
import sqlite3
import subprocess

ROOT = Path(__file__).resolve().parents[1]

def evaluate(name):
    result = subprocess.run([
        str(ROOT / "bin/telora"), "-C", str(ROOT / "icloud_model"), "eval",
        f"@test/typed_inventory:{name}", "--initialization-fuel", "100000",
        "--request-fuel", "100000", "--with-memory-limit", "2048",
    ], capture_output=True, text=True, check=True, timeout=240)
    return json.loads(result.stdout)

cases = evaluate("runtime_cases") + evaluate("site_relation_cases")
schema = evaluate("physical_schema")
expected = {"known": [("d1",), ("d2",)], "unknown_collision": [("d3",)],
            "unknowns": [("d3",), ("d5",)], "offline": [("d2",), ("d3",)],
            "subnet": [("d1",), ("d2",)], "count": [(6,)], "tenant_count": [(2,)],
            "group_class": [("lb", "Known", 2), ("router", "Unknown", 1), ("router", "Known", 1),
                            ("newType", "Unknown", 1), ("others", "Known", 1)]}
expected_join = [("d1", "Tenant Alpha"), ("d2", "Tenant Alpha"), ("d3", "租户二"), ("d5", "租户二"), ("d6", "租户二")]
expected["device_belongs_to_tenant"] = expected_join
expected["source_EntNetworkElement_X_TENANT_VIEW"] = expected_join
assert len(cases) == len({case["id"] for case in cases})
with sqlite3.connect(":memory:") as db:
    db.create_function("regexp", 2, lambda pattern, value: None if value is None else bool(re.search(pattern, value)))
    for table, columns in schema:
        assert all(re.fullmatch(r"[A-Za-z_][A-Za-z_0-9]*", name) for name in [table, *columns])
        fields = ", ".join(f'"{name}" ' + ("INTEGER" if name in {"createTime", "TENANT_ACCESS_TIME", "CREATE_TIME"} else "TEXT") for name in columns)
        db.execute(f'CREATE TABLE "{table}" ({fields})')
    db.executemany("INSERT INTO X_TENANT_VIEW (TENANT_ID, TENANT_NAME, INDUSTRY, TENANT_ACCESS_TIME) VALUES (?, ?, ?, ?)", [("t1", "Tenant Alpha", "IT", -1), ("t2", "租户二", "Health", 1000)])
    columns = next(columns for table, columns in schema if table == "I_EntNetworkElement")
    fixtures = [
        ("d1", "t1", "ne.category.lb", "0", "192.0.2.1"),
        ("d2", "t1", "lb", "offline", "192.0.2.200"),
        ("d3", "t2", "router", "1", "2001:db8::1"),
        ("d4", "missing", "ne.category.router", "other", "198.51.100.1"),
        ("d5", "t2", "newType", "9", "192.0.2.1\n"),
        ("d6", "t2", "ne.category.unknown", "online", "256.0.0.1"),
    ]
    for index, (identity, tenant, classification, state, address) in enumerate(fixtures):
        values = {name: f"{identity}_{name}" for name in columns}
        values.update(id=identity, tenantId=tenant, classification=classification, commuState=state,
                      ipAddress=address, createTime=index * 1000 - 1, name=f"Device {identity}")
        db.execute('INSERT INTO I_EntNetworkElement VALUES (' + ','.join('?' for _ in columns) + ')', [values[column] for column in columns])
    db.executemany('INSERT INTO X_SITE_VIEW (SITE_ID, SITE_NAME, SITE_TYPE, TENANT_ID, PARENT_SITE_ID, SITE_ALIAS, CREATE_TIME) VALUES (?, ?, ?, ?, ?, ?, ?)', [
        ("s1", "Site One", "onlineSite", "t1", "", "alias1", -1),
        ("s2", "Site Two", "offlineSite", "t2", "s1", "alias2", 1000),
    ])
    # 覆盖仅 project 匹配、仅 subnet 匹配、两路同站点去重、两路不同站点、均不匹配
    db.executemany('UPDATE I_EntNetworkElement SET projectId=?, refParentSubnet=? WHERE id=?', [
        ("s1", "missing", "d1"), ("missing", "s2", "d2"), ("s1", "s1", "d3"),
        ("s1", "s2", "d4"), ("missing", "missing", "d5"),
    ])
    expected["site_belongs_to_tenant"] = [("s1", "Tenant Alpha"), ("s2", "租户二")]
    expected["source_X_TENANT_VIEW_X_SITE_VIEW"] = expected["site_belongs_to_tenant"]
    expected["site_online"] = [("s1",)]
    expected_sites = [("d1", "s1"), ("d2", "s2"), ("d3", "s1"), ("d4", "s1"), ("d4", "s2")]
    expected["device_located_at_site"] = expected_sites
    expected["source_EntNetworkElement_X_SITE_VIEW"] = expected_sites
    def execute(query):
        bindings = {str(i + 1): value for i, value in enumerate(query["bindings"])}
        return db.execute(query["sql"], bindings).fetchall()
    for case in cases:
        assert case["columns"] == case["baseline_columns"], case["id"]
        assert case["typed"]["bindings"] == case["postgres"]["bindings"], case["id"]
        actual = sorted(execute(case["typed"]), key=repr)
        baseline = sorted(execute(case["baseline"]), key=repr)
        assert actual == baseline, (case["id"], actual, baseline, case)
        if case["id"] in expected:
            assert actual == sorted(expected[case["id"]], key=repr), (case["id"], actual)
    for table, _ in schema:
        db.execute(f'DELETE FROM "{table}"')
    for case in cases:
        actual = execute(case["typed"])
        assert actual == execute(case["baseline"]), ("empty", case["id"])
        if case["id"] in {"count", "tenant_count"}:
            assert actual == [(0,)], ("empty count", case["id"], actual)
print(f"Passed {len(cases)} IC typed/baseline SQLite pairs and empty-table checks, including all migrated dimensions, counts, domain filters, IPv4 and all migrated relations")
