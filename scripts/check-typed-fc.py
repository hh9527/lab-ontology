#!/usr/bin/env python3
"""执行FC 字段、容量比较、业务域及五种来源关系的新旧 SQL 对照。"""
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
        str(ROOT / "bin/telora"), "-C", str(ROOT / "icloud_model"), "eval", "@test/typed_fc_runtime:runtime_fixture",
        "--initialization-fuel", "400000", "--request-fuel", "100000", "--with-memory-limit", "2048",
    ], capture_output=True, text=True, timeout=360)
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
    domains = {'subClassName': {'wire_EnterpriseStorage_25ad4d1a': 'EnterpriseStorage', 'wire_FusionStorageDevice_1f9ba237': 'FusionStorageDevice', 'wire_SmisStorageDevice_2c86cdb3': 'SmisStorageDevice', 'wire_HuaweiSmisStorageDevice_5772d0e0': 'HuaweiSmisStorageDevice', 'wire_SYS_ProtectDevice_a998da2f': 'SYS_ProtectDevice', 'wire_DsmStorageDevice_7501c7fd': 'DsmStorageDevice', 'wire_HPEStorageDevice_a708d741': 'HPEStorageDevice', 'wire_VSPStorageDevice_20c021da': 'VSPStorageDevice', 'wire_FCSwitchDevice_50ec3634': 'FCSwitchDevice'}, 'powerStatus': {'wire_poweroff_2de10559': 'poweroff', 'wire_poweron_719ada0e': 'poweron'}, 'classification': {'wire_HuaweiStorage_314c393a': 'HuaweiStorage', 'wire_FcSwitch_16b229fd': 'FcSwitch', 'wire_ThirdPartyStorage_764555ef': 'ThirdPartyStorage'}, 'deviceType': {'wire_storage_11be0383': 'storage', 'wire_fcswitch_a16c3357': 'fcswitch'}, 'runningStatus': {'wire_1_44cd5f3d': '1', 'wire_3_5566f006': '3', 'wire_12_001f2bb6': '12', 'wire_47_61bb19fe': '47', 'wire_51_98f205c9': '51'}, 'healthStatus': {'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2'}, 'connectStatus': {'wire_0_92e42f8f': 0, 'wire_1_8d618873': 1, 'wire_9_cfd024ae': 9}}
    for tenant in ["t1", "t2"]:
        insert("tenant", {"TENANT_ID": tenant})
    for id in ["S1", "S2"]:
        insert("site", {"SITE_ID": id})
    rows = []
    numeric = ["usedCapacityRate", "totalStoragePoolCapacity", "unUsedCapacity", "usedCapacity", "totalCapacity", "portNum"]
    # 全部已知成员至少出现一次；末三行验证未知、NULL 与未过滤分类。
    for index in range(12):
        row = {"id": f"F{index:02}", "tenantId": ["t1", "t2", "orphan"][index % 3],
            "parentResId": ["S1", "S1", "missing", "missing", None][index % 5],
            "projectId": ["S1", "S2", "S2", "missing", None][index % 5],
            "ipAddress": ["192.0.2.1", "198.51.100.1", "2001:db8::1", "192.0.2.01", None][index % 5],
            "name": f"fc_%_{index}", "createTime": (index + 1) * 1000}
        for dimension, mapping in domains.items():
            values = list(mapping.values())
            row[dimension] = values[index % len(values)] if index < 9 else (None if index == 10 else (999 if dimension == "connectStatus" else "other"))
        for dimension in numeric:
            row[dimension] = index % 5 if dimension == "portNum" else [-1.25, 1.5, 125.25, 0.0, 2.75][index % 5]
        if index == 10:
            row.update({dimension: None for dimension in numeric})
            row["createTime"] = None
        rows.append(row)
        insert("source_FCSwitchDevice", row)
    links = [("L1", "F00", "F01", "t1"), ("L2", "F00", "F01", "t2"), ("L3", "F00", "F00", "t1"),
        ("L4", "missing", "F02", "t1"), ("L5", None, "missing", "t1")]
    for id, a, z, tenant in links:
        insert("physical_link", {"id": id, "aNeResId": a, "zNeResId": z, "tenantId": tenant})
    alarms = [(1, "F00", 0, "t1"), (2, "F00", 1, "t2"), (3, "F01", 1, "t1"), (4, "missing", 0, "t1")]
    for csn, resource, cleared, tenant in alarms:
        insert("current_alarm", {"CSN": csn, "MEDN": resource, "CLEARED": cleared, "SEVERITY": 1, "TENANTID": tenant})
    expected = {"count": [(len(rows),)], "window": [(3,)], "name_search": [(row["id"],) for row in rows],
        "InSubnet": [(row["id"],) for row in rows if row["ipAddress"] == "192.0.2.1"],
        "NotInSubnet": [(row["id"],) for row in rows if row["ipAddress"] == "198.51.100.1"],
        "project_source_FCSwitchDevice__ipAddress_ipv4": [(row["ipAddress"] if row["ipAddress"] in ["192.0.2.1", "198.51.100.1"] else None,) for row in rows],
        "alarm_rows": [("F00", 1), ("F00", 2), ("F01", 3)], "alarm_exists": [(2,)],
        "alarm_totals": [("F00", 2, 1), ("F01", 1, 0)],
    }
    for dimension, mapping in domains.items():
        expected["group_" + dimension] = [(member, sum(row[dimension] == wire for row in rows)) for member, wire in mapping.items()]
        for member, wire in mapping.items():
            for op in ["Eq", "Ne"]:
                expected[f"filter_source_FCSwitchDevice__{dimension}_{member}_{op}"] = [(row["id"],) for row in rows
                    if row[dimension] in mapping.values() and ((row[dimension] == wire) if op == "Eq" else (row[dimension] != wire))]
    expected["group_tenantId"] = [(id, sum(row["tenantId"] == id for row in rows)) for id in ["t1", "t2", "orphan"]]
    comparisons = {"Eq": lambda a, b: a == b, "Ne": lambda a, b: a != b, "Gt": lambda a, b: a > b,
        "Ge": lambda a, b: a >= b, "Lt": lambda a, b: a < b, "Le": lambda a, b: a <= b}
    for dimension in numeric:
        expected["project_source_FCSwitchDevice__" + dimension] = [(row[dimension],) for row in rows]
        for op, predicate in comparisons.items():
            expected[f"numeric_{dimension}_{op}"] = [(row["id"],) for row in rows if row[dimension] is not None and predicate(row[dimension], 1 if dimension == "portNum" else 1.5)]
    for side, key_index in [("a", 1), ("z", 2)]:
        expected[side + "_rows"] = [(row["id"], link[0]) for row in rows for link in links if row["id"] == link[key_index]]
        expected[side + "_exists"] = [(sum(any(row["id"] == link[key_index] for link in links) for row in rows),)]
    expected["tenant_rows"] = [(row["id"], row["tenantId"]) for row in rows if row["tenantId"] in ["t1", "t2"]]
    expected["tenant_exists"] = [(sum(row["tenantId"] in ["t1", "t2"] for row in rows),)]
    expected["site_rows"] = [(row["id"], id) for row in rows for id in ["S1", "S2"] if id in [row["parentResId"], row["projectId"]]]
    expected["site_exists"] = [(sum(any(id in [row["parentResId"], row["projectId"]] for id in ["S1", "S2"]) for row in rows),)]
    def run(query):
        return sorted(db.execute(query["sql"], {str(i + 1): value for i, value in enumerate(query["bindings"])}).fetchall(), key=repr)
    for case in cases:
        assert case["columns"] == case["baseline_columns"], case["id"]
        assert case["typed"]["bindings"] == case["baseline"]["bindings"] == case["postgres"]["bindings"], case["id"]
        actual = run(case["typed"])
        assert actual == run(case["baseline"]), (case["id"], actual, run(case["baseline"]))
        if case["id"] in expected:
            assert actual == sorted(expected[case["id"]], key=repr), (case["id"], actual, expected[case["id"]])
    assert set(expected).issubset({case["id"] for case in cases}), set(expected) - {case["id"] for case in cases}
    for table in schemas:
        db.execute(f'DELETE FROM "{table}"')
    for case in cases:
        actual = run(case["typed"])
        assert actual == run(case["baseline"]), ("empty", case["id"], actual)
        if case["id"] in ["count", "window"] or case["id"].endswith("_exists"):
            assert actual == [(0,)], (case["id"], actual)
print(f"Passed {len(cases)} FC SQLite typed/baseline pairs and empty-table checks; PostgreSQL bindings only")
