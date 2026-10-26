#!/usr/bin/env python3
"""执行终端字段、业务域、IPv4 及四种来源关系的新旧 SQL 对照。"""
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
        str(ROOT / "bin/telora"), "-C", str(ROOT / "icloud_model"), "eval", "@test/typed_terminal_runtime:runtime_fixture",
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
    domains = {'status': {'wire__1_fe93bf05': -1, 'wire_0_92e42f8f': 0, 'wire_1_8d618873': 1}, 'type': {'wire_AccessPoint_e851dd56': 'AccessPoint', 'wire_AudioImagingOrVideoEquipment_1ba71d6a': 'AudioImagingOrVideoEquipment', 'wire_Desktop_06e81c9c': 'Desktop', 'wire_FirewallAndSecurityAppliance_10633f4a': 'FirewallAndSecurityAppliance', 'wire_HIT_a15448e9': 'HIT', 'wire_IPCamera_33b57cab': 'IPCamera', 'wire_InternetOfThings_a31d8005': 'InternetOfThings', 'wire_Laptop_31613326': 'Laptop', 'wire_MedicalDevice_0844f433': 'MedicalDevice', 'wire_MobilePhone_19e46cbf': 'MobilePhone', 'wire_OperatingSystem_7d1e5815': 'OperatingSystem', 'wire_Others_b687aa92': 'Others', 'wire_Bridge_09dfcab4': 'Bridge', 'wire_FinancialEquipment_dfbc2653': 'FinancialEquipment', 'wire_Gateway_00c7fb6e': 'Gateway', 'wire_HandheldComputers_179317e7': 'HandheldComputers', 'wire_LoadBalancer_6de8475e': 'LoadBalancer', 'wire_MonitoringAndTestingDevice_cbba4468': 'MonitoringAndTestingDevice', 'wire_NetworkAccessDevice_6f702050': 'NetworkAccessDevice', 'wire_PBX_775c5835': 'PBX', 'wire_PhysicalSecurity_c371310e': 'PhysicalSecurity', 'wire_ThinClient_d2483dc4': 'ThinClient', 'wire_WANAccelerator_d6bee6f5': 'WANAccelerator', 'wire_PersonalComputer_61c7207c': 'PersonalComputer', 'wire_PowerDevice_3b7d8008': 'PowerDevice', 'wire_Printer_91c3d73e': 'Printer', 'wire_Router_f5c6c17a': 'Router', 'wire_Server_6efa3140': 'Server', 'wire_SetTopBox_2bff4a9d': 'SetTopBox', 'wire_StorageDevice_721f75bb': 'StorageDevice', 'wire_Switch_885cfbcf': 'Switch', 'wire_Tablet_37f52ac0': 'Tablet', 'wire_VoIPDevice_9d94cca2': 'VoIPDevice', 'wire_Watch_76a718aa': 'Watch', 'wire_WirelessDevice_7de28926': 'WirelessDevice'}, 'priority': {'wire_10_63a7292b': 10, 'wire_20_acda2220': 20, 'wire_30_4e027505': 30}, 'source': {'wire_0_92e42f8f': 0, 'wire_1_8d618873': 1, 'wire_2_d0a68914': 2, 'wire_3_bab86ec8': 3, 'wire_4_5978b238': 4, 'wire_5_c6f5830f': 5, 'wire_6_02a10e4d': 6, 'wire_7_6c49b68a': 7, 'wire_8_4046effe': 8, 'wire_9_cfd024ae': 9, 'wire_10_63a7292b': 10}, 'blockStatus': {'wire_0_92e42f8f': 0, 'wire_1_8d618873': 1, 'wire_2_d0a68914': 2}}
    for tenant in ["t1", "t2"]:
        insert("tenant", {"TENANT_ID": tenant})
    for id in ["D1", "D2"]:
        insert("device", {"id": id})
    for id in ["D1", "D3"]:
        insert("pon_device", {"id": id})
    for id in ["S1", "S2"]:
        insert("site", {"SITE_ID": id})
    rows = []
    # 每个业务域所有成员至少出现一次；末三行检查未知编码、NULL 和孤立引用。
    for index in range(38):
        row = {"resId": f"T{index:02}", "tenantId": ["t1", "t2", "orphan"][index % 3],
            "accessDeviceId": ["D1", "D2", "D3", "missing", None][index % 5],
            "siteId": ["S1", "S1", "missing", "missing", None][index % 5],
            "projectId": ["S1", "S2", "S2", "missing", None][index % 5],
            "ip": ["192.0.2.1", "198.51.100.1", "2001:db8::1", "192.0.2.01", None][index % 5],
            "ipv6": "2001:db8::1" if index % 2 == 0 else "raw-v6", "name": f"terminal_%_{index}",
            "blockTime": (index + 1) * 1000, "vlanId": index % 4,
            "unauthorized": index % 3, "isBlocked": index % 2}
        for dimension, mapping in domains.items():
            values = list(mapping.values())
            row[dimension] = values[index % len(values)] if index < 35 else (None if index == 36 else (999 if dimension != "type" else "other"))
        if index == 36:
            row.update({"blockTime": None, "vlanId": None, "unauthorized": None, "isBlocked": None})
        rows.append(row)
        insert("source_EntTerminalElement", row)
    expected = {"count": [(len(rows),)], "window": [(3,)],
        "search_name": [(row["resId"],) for row in rows],
        "search_ipv6": [(row["resId"],) for row in rows if "db8" in row["ipv6"]],
        "InSubnet": [(row["resId"],) for row in rows if row["ip"] == "192.0.2.1"],
        "NotInSubnet": [(row["resId"],) for row in rows if row["ip"] == "198.51.100.1"],
        "project_source_EntTerminalElement__ip_ipv4": [(row["ip"] if row["ip"] in ["192.0.2.1", "198.51.100.1"] else None,) for row in rows],
    }
    for dimension, mapping in domains.items():
        expected["group_" + dimension] = [(member, sum(row[dimension] == wire for row in rows)) for member, wire in mapping.items()]
        for member, wire in mapping.items():
            for op in ["Eq", "Ne"]:
                expected[f"filter_source_EntTerminalElement__{dimension}_{member}_{op}"] = [(row["resId"],) for row in rows
                    if row[dimension] in mapping.values() and ((row[dimension] == wire) if op == "Eq" else (row[dimension] != wire))]
    expected["group_tenantId"] = [(id, sum(row["tenantId"] == id for row in rows)) for id in ["t1", "t2", "orphan"]]
    comparisons = {"Eq": lambda a: a == 1, "Ne": lambda a: a != 1, "Gt": lambda a: a > 1,
        "Ge": lambda a: a >= 1, "Lt": lambda a: a < 1, "Le": lambda a: a <= 1}
    for dimension in ["vlanId", "unauthorized", "isBlocked"]:
        for op, predicate in comparisons.items():
            expected[f"numeric_{dimension}_{op}"] = [(row["resId"],) for row in rows if row[dimension] is not None and predicate(row[dimension])]
    for relation, field, targets in [("device", "accessDeviceId", ["D1", "D2"]), ("pon", "accessDeviceId", ["D1", "D3"]), ("tenant", "tenantId", ["t1", "t2"])]:
        expected[relation + "_rows"] = [(row["resId"], row[field]) for row in rows if row[field] in targets]
        expected[relation + "_exists"] = [(sum(row[field] in targets for row in rows),)]
    # 两个 OR 键相同不重复连接；不同且各自命中时保留两个原始关联结果。
    expected["site_rows"] = [(row["resId"], id) for row in rows for id in ["S1", "S2"] if id in [row["siteId"], row["projectId"]]]
    expected["site_exists"] = [(sum(any(id in [row["siteId"], row["projectId"]] for id in ["S1", "S2"]) for row in rows),)]
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
print(f"Passed {len(cases)} terminal SQLite typed/baseline pairs and empty-table checks; PostgreSQL bindings only")
