#!/usr/bin/env python3
"""执行 存储磁盘和端口的原始粒度、编码域、IPv4 与关系的新旧 SQL 对照。"""
import ipaddress
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
        str(ROOT / "bin/telora"), "-C", str(ROOT / "icloud_model"), "eval", "@test/typed_storage_io_runtime:runtime_fixture",
        "--initialization-fuel", "650000", "--request-fuel", "100000", "--with-memory-limit", "2048",
    ], capture_output=True, text=True, timeout=540)
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
    specs = {'source_SYS_StorageDisk': {'source': 'SYS_StorageDisk', 'key': 'diskId', 'parent': 'parentResId', 'fields': {'displayHealthStatus': 'String', 'vendor': 'String', 'tenantId': 'String', 'name': 'String', 'description': 'String', 'virtualDisk': 'Bool', 'parentResId': 'String', 'devRole': 'String', 'bomId': 'String', 'barCode': 'String', 'role': 'String', 'totalCapacity': 'String', 'remainLife': 'String', 'wearRate': 'String', 'diskId': 'String', 'speed': 'String', 'sn': 'String', 'firmware': 'String', 'slotNumber': 'String', 'projectId': 'String', 'logicalType': 'String', 'diskType': 'String'}, 'domains': {'displayHealthStatus': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire_3_5566f006': '3', 'wire_4_60aedc0f': '4', 'wire_5_4435574b': '5', 'wire_6_7d87898d': '6', 'wire_7_74df68b1': '7'}, 'devRole': {'wire_zk_disk_bc1a0100': 'zk_disk', 'wire_main_storage_c3ffbe9b': 'main_storage', 'wire_osd_cache_ce4f2f46': 'osd_cache', 'wire_system_disk_a2360be8': 'system_disk', 'wire_no_use_92c2c676': 'no_use'}, 'role': {'wire_zk_disk_bc1a0100': 'zk_disk', 'wire_main_storage_c3ffbe9b': 'main_storage', 'wire_osd_cache_ce4f2f46': 'osd_cache'}, 'logicalType': {'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire_3_5566f006': '3', 'wire_4_60aedc0f': '4'}, 'diskType': {'wire_sas_disk_40ba221c': 'sas_disk', 'wire_sata_disk_acda8585': 'sata_disk', 'wire_ssd_card_ecc23a33': 'ssd_card', 'wire_ssd_disk_efa090d3': 'ssd_disk', 'wire_SSD_cf486063': 'SSD', 'wire_SAS_81d74a85': 'SAS', 'wire_NL_SAS_c58c6c02': 'NL_SAS', 'wire_m2_disk_167f645f': 'm2_disk'}}, 'ipv4': []}, 'source_SYS_StoragePort': {'source': 'SYS_StoragePort', 'key': 'id', 'parent': 'parentResId', 'fields': {'id': 'String', 'tenantId': 'String', 'name': 'String', 'remotePortWwn': 'String', 'remoteNodeWwn': 'String', 'lostSync': 'String', 'ipv6Mask': 'String', 'ipv4Mask': 'String', 'firmwareVersion': 'String', 'parentResId': 'String', 'ipv6Gateway': 'String', 'ipv4Gateway': 'String', 'logicType': 'String', 'maxSpeed': 'String', 'phySlotNum': 'String', 'location': 'String', 'speed': 'Int', 'bondName': 'String', 'mgmtIpv6': 'String', 'mgmtIp': 'String', 'mac': 'String', 'wwn': 'String', 'portType': 'String', 'healthStatus': 'String', 'runningStatus': 'String', 'connectStatus': 'String', 'portId': 'String'}, 'domains': {'logicType': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire_3_5566f006': '3', 'wire_4_60aedc0f': '4', 'wire_5_4435574b': '5', 'wire_6_7d87898d': '6', 'wire_13_3cd4003c': '13', 'wire_14_674a4041': '14'}, 'portType': {'wire_FCoE_0af2e0ea': 'FCoE', 'wire_ETH_7337ee59': 'ETH', 'wire_RoCE_786156a3': 'RoCE', 'wire_SAS_81d74a85': 'SAS', 'wire_FC_abe64c81': 'FC'}, 'healthStatus': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire_3_5566f006': '3', 'wire_7_74df68b1': '7', 'wire_10_5f704d0f': '10', 'wire_11_90e5da09': '11', 'wire_9_f6ca7439': '9', 'wire_up_97380fdb': 'up', 'wire_down_cef3c0cf': 'down'}, 'runningStatus': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire_3_5566f006': '3', 'wire_4_60aedc0f': '4', 'wire_5_4435574b': '5', 'wire_10_5f704d0f': '10', 'wire_11_90e5da09': '11', 'wire_33_85b0e9f3': '33', 'wire_up_97380fdb': 'up', 'wire_down_cef3c0cf': 'down'}, 'connectStatus': {'wire_up_97380fdb': 'up', 'wire_down_cef3c0cf': 'down'}}, 'ipv4': ['ipv4Gateway', 'mgmtIp']}}
    tenants = [{"id": "t1"}, {"id": "t2"}]
    storages = [{"id": "S1", "tenant": "t1"}, {"id": "S2", "tenant": "t2"}, {"id": "C00", "tenant": "t1"}]
    for row in tenants:
        insert("tenant", {"TENANT_ID": row["id"]})
    for row in storages:
        insert("storage_device", {"id": row["id"], "tenantId": row["tenant"]})
    switches = [{"id": "S1"}, {"id": "F1"}, {"id": "orphan"}]
    for row in switches:
        insert("source_FCSwitchDevice", {"id": row["id"]})
    populations = {}
    for entity, spec in specs.items():
        rows = []
        known_count = max(len(mapping) for mapping in spec["domains"].values())
        for index in range(known_count + 3):
            row = {spec["key"]: f"C{index:02}" if spec["key"] == "id" else f"C{index % 2:02}", "tenantId": ["t1", "t2", "orphan"][index % 3],
                spec["parent"]: ["S1", "S1", "C00", "S2", "F1", None, "missing"][index % 7]}
            for field, ty in spec["fields"].items():
                if field in row: continue
                if field in spec["domains"]:
                    values = list(spec["domains"][field].values())
                    row[field] = values[index % len(values)] if index < known_count else (None if index == known_count + 1 else 999 if ty == "Int" else "other")
                elif field in ["ipv4Gateway", "mgmtIp"]:
                    samples = ["10.0.0.1", "10.0.0.128", "10.0.0.255", "10.0.1.1", "010.0.0.1", "::1", "256.0.0.1", "10.0.0.1\n", None]
                    row[field] = samples[(index + (1 if field == "mgmtIp" else 0)) % len(samples)]
                elif ty == "Bool":
                    # SQLite 将 Bool 存为 1/0；独立预期使用同一物理表示。
                    row[field] = [1, 0, None][index % 3]
                elif ty == "Int":
                    row[field] = [1, 0, 2, -1, 3, None, 4][index % 7]
                else:
                    row[field] = "0010%" if field in ["totalCapacity", "remainLife", "wearRate", "maxSpeed", "lostSync"] and index % 2 == 0 else f"raw_%_{field}_{index}"
            rows.append(row)
            insert(entity, row)
        populations[entity] = rows
    comparisons = {"Eq": lambda a, b: a == b, "Ne": lambda a, b: a != b, "Gt": lambda a, b: a > b,
        "Ge": lambda a, b: a >= b, "Lt": lambda a, b: a < b, "Le": lambda a, b: a <= b,
        "Contains": lambda a, b: b in a, "InSubnet": lambda a, b: ipaddress.IPv4Address(a) in ipaddress.IPv4Network(b), "NotInSubnet": lambda a, b: ipaddress.IPv4Address(a) not in ipaddress.IPv4Network(b)}
    def expected(request, empty=False):
        component = next(node for node in request["nodes"] if node["id"] == "c") if request["root"] == "c" or len(request["nodes"]) > 1 else request["exists"][0]["nodes"][0]
        entity = component["entity"]
        spec = specs[entity]
        rows = [] if empty else populations[entity]
        def dimension(row, id):
            assert id.startswith(entity + "__"), id
            field = id[len(entity) + 2:]
            if field in spec["domains"]:
                return {wire: member for member, wire in spec["domains"][field].items()}.get(row[field])
            if field.endswith("_ipv4"):
                raw = row[field[:-5]]
                try:
                    value = str(ipaddress.IPv4Address(raw))
                    return value if raw == value else None
                except (ValueError, TypeError):
                    return None
            return row[field]
        def matches(row, target, kind):
            return row["tenantId"] == target["id"] if kind == "tenant" else row[spec["parent"]] == target["id"]
        if request.get("edges") or request.get("exists"):
            relation = (request["edges"] if request.get("edges") else request["exists"][0]["edges"])[0]["relation"]
            kind = "tenant" if relation.endswith("AssociationX_TENANT_VIEW") else "fc" if relation == "source_FCSwitchDevice_SYS_StoragePort" else "storage"
            targets = [] if empty else tenants if kind == "tenant" else switches if kind == "fc" else storages
            if request.get("exists"):
                value = sum(any(matches(row, target, kind) for target in targets) for row in rows) if request["root"] == "c" else sum(any(matches(row, target, kind) for row in rows) for target in targets)
                return [{request["root"] + "_count": value}]
            column = "x_tenant_id" if kind == "tenant" else "x_source_FCSwitchDevice__id" if kind == "fc" else "x_storage_device_id"
            return [{"c_" + entity + "__" + spec["key"]: row[spec["key"]], column: target["id"]} for row in rows for target in targets if matches(row, target, kind)]
        for filter in request.get("filters", []):
            rows = [row for row in rows if dimension(row, filter["dimension"]) is not None and comparisons[filter["op"]](dimension(row, filter["dimension"]), filter["value"])]
        for window in request.get("time_windows", []):
            field = window["dimension"][len(entity) + 2:]
            rows = [row for row in rows if row[field] is not None and window["start"] <= row[field] < window["end"]]
        for selection in request["select"]:
            field = selection["dimension"][len(entity) + 2:]
            if field in spec["domains"]:
                rows = [row for row in rows if dimension(row, selection["dimension"]) is not None]
        if request.get("count"):
            groups = {}
            for row in rows:
                key = tuple(dimension(row, selection["dimension"]) for selection in request["select"])
                groups[key] = groups.get(key, 0) + 1
            if not request["select"] and not rows: groups[()] = 0
            return [{**{"c_" + selection["dimension"]: item for selection, item in zip(request["select"], key)}, "c_count": count} for key, count in groups.items()]
        return [{"c_" + selection["dimension"]: dimension(row, selection["dimension"]) for selection in request["select"]} for row in rows]
    def run(query):
        return sorted(db.execute(query["sql"], {str(i + 1): value for i, value in enumerate(query["bindings"])}).fetchall(), key=repr)
    def verify(case, empty=False):
        actual = run(case["typed"])
        assert actual == run(case["baseline"]), ("empty" if empty else "rows", case["id"], actual, run(case["baseline"]))
        columns = [column["name"] for column in case["columns"]]
        rows = expected(case["request"], empty)
        assert all(set(row) == set(columns) for row in rows), (case["id"], columns, rows)
        expected_rows = sorted([tuple(row[column] for column in columns) for row in rows], key=repr)
        assert actual == expected_rows, (case["id"], actual, expected_rows)
    for case in cases:
        assert case["columns"] == case["baseline_columns"], case["id"]
        assert case["typed"]["bindings"] == case["baseline"]["bindings"] == case["postgres"]["bindings"], case["id"]
        verify(case)
    for table in schemas:
        db.execute(f'DELETE FROM "{table}"')
    for case in cases:
        verify(case, empty=True)
print(f"Passed {len(cases)} storage-IO SQLite typed/baseline pairs with independent expectations and empty-table checks; PostgreSQL bindings only")
