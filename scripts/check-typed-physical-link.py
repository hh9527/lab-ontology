#!/usr/bin/env python3
"""执行 PhysicalLink 字段、业务域、端点与方向连接的新旧 SQL 对照。"""
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
        str(ROOT / "bin/telora"), "-C", str(ROOT / "icloud_model"), "eval", "@test/typed_physical_link_runtime:runtime_fixture",
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
    for id in ["A", "B", "C"]:
        insert("device", {"id": id, "tenantId": "t1"})
    insert("server_device", {"id": "SV1", "name": "Server One"})
    insert("tenant", {"TENANT_ID": "t1"})
    # A/Z 原始名称与引用实体名称刻意不同，不从实体回填配对字段。
    rows = [
        ("l1", "A", "B", "bidirectional", 2, 99, "t1"),
        ("l2", "B", "C", "unidirectional", 3, 1, "t1"),
        ("l3", "C", "A", "other", 0, 7, "t1"),
        ("l4", "A", "A", "bidirectional", 1, 8, "t1"),
        ("l5", "A", "B", "bidirectional", 4, 9, "t1"),
        ("l6", "A", "SV1", "bidirectional", 5, 100, "t1"),
        ("l7", "missing", "B", "unidirectional", 9, 99, "t1"),
        ("l8", "A", "B", "unidirectional", 2, 1, "orphan"),
        ("l9", "C", "A", None, None, None, "t1"),
    ]
    addresses = ["192.0.2.1", "2001:db8::1", "192.0.2.01", None, "198.51.100.1", "192.0.2.255", "192.0.2.1\n", "256.0.0.1", "0.0.0.0"]
    ip_fields = {"physical_link_a_port_ip_ipv4": "aPortIp", "physical_link_a_ne_ip_ipv4": "aNeIp", "physical_link__zPortIp_ipv4": "zPortIp", "physical_link__zNeIp_ipv4": "zNeIp"}
    for index, (id, a, z, direction, status, kind, tenant) in enumerate(rows):
        overrides = {"id": id, "aNeResId": a, "zNeResId": z, "direction": direction, "linkStatus": status,
            "linkType": kind, "tenantId": tenant, "aNeName": f"source_A_{id}", "zNeName": f"source_Z_{id}",
            "createTime": (index + 1) * 1000, "speed": "10G" if index % 2 else "1000"}
        for offset, column in enumerate(ip_fields.values()):
            overrides[column] = addresses[(index + offset) % len(addresses)]
        insert("physical_link", overrides)
    expected = {
        "count": [(9,)], "window": [(3,)], "name_pairs": [(f"source_A_{row[0]}", f"source_Z_{row[0]}") for row in rows],
        "status_groups": [("fault", 3), ("wire_0_92e42f8f", 1), ("wire_1_8d618873", 1), ("wire_4_5978b238", 1), ("wire_5_c6f5830f", 1)],
        "physical_link_a_device": [(row[0], row[1]) for row in rows if row[1] in {"A", "B", "C"}],
        "physical_link_z_device": [(row[0], row[2]) for row in rows if row[2] in {"A", "B", "C"}],
        "physical_link_attached_device": [(row[0], id) for row in rows for id in sorted({row[1], row[2]} & {"A", "B", "C"})],
        "physical_link_attached_server": [("l6", "Server One")],
        "physical_link_belongs_to_tenant": [(row[0], "t1") for row in rows if row[6] == "t1"],
        "peer": [("A", "B"), ("B", "A"), ("A", "A")],
        "downstream": [("B", "C"), ("A", "B")],
    }
    expected["reverse_peer"] = expected["peer"]
    import ipaddress
    def valid_ipv4(value):
        if not isinstance(value, str):
            return None
        try:
            return ipaddress.IPv4Address(value)
        except ipaddress.AddressValueError:
            return None
    for offset, dimension in enumerate(ip_fields):
        expected[f"project_{dimension}"] = [(str(address) if address is not None else None,) for index in range(len(rows))
            for address in [valid_ipv4(addresses[(index + offset) % len(addresses)])]]
        for operation in ["InSubnet", "NotInSubnet"]:
            expected[f"{dimension}_{operation}"] = [(rows[index][0],) for index in range(len(rows))
                for address in [valid_ipv4(addresses[(index + offset) % len(addresses)])]
                if address is not None and ((address in ipaddress.IPv4Network("192.0.2.0/24")) == (operation == "InSubnet"))]
    mappings = {
        "physical_link_type": ([row[5] for row in rows], {"manual": [99], "lldp": [1], "csp": [7], "server_internal": [8], "fiber_search": [9]}),
        "physical_link_direction": ([row[3] for row in rows], {"bidirectional": ["bidirectional"], "unidirectional": ["unidirectional"]}),
        "physical_link_status": ([row[4] for row in rows], {"fault": [2, 3]}),
    }
    for case in cases:
        for dimension, (inputs, named) in mappings.items():
            prefix = f"filter_{dimension}_"
            if not case["id"].startswith(prefix):
                continue
            member, op = case["id"][len(prefix):].rsplit("_", 1)
            codes = named[member] if member in named else [int(member.split("_")[1])]
            known = ({99, *range(1, 14), 100} if dimension.endswith("type") else {"bidirectional", "unidirectional"} if dimension.endswith("direction") else {0, 1, 2, 3, 4, 5})
            expected[case["id"]] = [(row[0],) for row, value in zip(rows, inputs)
                if value is not None and ((value in codes) if op == "Eq" else (value in known and value not in codes))]
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
        if case["id"] in ["count", "window"]:
            assert actual == [(0,)], (case["id"], actual)
print(f"Passed {len(cases)} PhysicalLink SQLite typed/baseline pairs and empty-table checks; PostgreSQL bindings only")
