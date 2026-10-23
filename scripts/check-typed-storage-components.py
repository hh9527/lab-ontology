#!/usr/bin/env python3
"""执行 存储组件字段、日期、状态域与来源关系的新旧 SQL 对照。"""
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
        str(ROOT / "bin/telora"), "-C", str(ROOT / "icloud_model"), "eval", "@test/typed_storage_components_runtime:runtime_fixture",
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
    specs = {'source_SYS_BackupPower': {'source': 'SYS_BackupPower', 'parent': 'parentResId', 'fields': {'name': 'String', 'id': 'String', 'tenantId': 'String', 'elecLabel': 'String', 'sn': 'String', 'backupPowerType': 'String', 'parentResId': 'String', 'projectId': 'String', 'location': 'String', 'chargeTimes': 'String', 'parentId': 'String', 'controllerId': 'String', 'firmwareVer': 'String', 'runningStatus': 'String', 'healthStatus': 'String', 'manufacturedDate': 'String', 'backupPowerId': 'String', 'remainLifeDays': 'String'}, 'search': ['name', 'elecLabel', 'sn', 'location', 'firmwareVer'], 'domains': {'backupPowerType': {'wire_0_91adcf51': '0'}, 'runningStatus': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire_27_c2fd18a7': '27', 'wire_28_3740e5a2': '28', 'wire_48_b10fc6b2': '48', 'wire_49_6635a37c': '49', 'wire_50_de4087f4': '50'}, 'healthStatus': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire_3_5566f006': '3', 'wire_12_001f2bb6': '12'}, 'remainLifeDays': {'wire__1_e9ea423a': '-1'}}}, 'source_SYS_Chassis': {'source': 'SYS_Chassis', 'parent': 'parentResId', 'fields': {'tenantId': 'String', 'id': 'String', 'projectId': 'String', 'name': 'String', 'oriResId': 'String', 'parentResId': 'String', 'curSupplyMode': 'String', 'systemSupplyMode': 'String', 'macAddress': 'String', 'logicType': 'String', 'height': 'String', 'model': 'String', 'wwn': 'String', 'temperature': 'String', 'boardType': 'String', 'slot': 'String', 'chassisId': 'String', 'sn': 'String', 'healthStatus': 'String', 'runningStatus': 'String'}, 'search': ['name', 'macAddress', 'model', 'wwn', 'sn'], 'domains': {'logicType': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire_3_5566f006': '3', 'wire_4_60aedc0f': '4'}, 'healthStatus': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2'}, 'runningStatus': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire_5_4435574b': '5', 'wire_27_c2fd18a7': '27', 'wire_28_3740e5a2': '28'}}}, 'source_SYS_Controller': {'source': 'SYS_Controller', 'parent': 'parentResId', 'fields': {'tenantId': 'String', 'id': 'String', 'createTime': 'Int', 'name': 'String', 'parentId': 'String', 'model': 'String', 'temperature': 'String', 'cpuCount': 'Int', 'oriResId': 'String', 'bomId': 'String', 'barCode': 'String', 'parentResId': 'String', 'memorySize': 'String', 'softVer': 'String', 'location': 'String', 'healthStatus': 'String', 'runningStatus': 'String', 'role': 'String'}, 'search': ['name', 'model', 'bomId', 'barCode', 'softVer', 'location'], 'domains': {'healthStatus': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire_9_f6ca7439': '9'}, 'runningStatus': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire_27_c2fd18a7': '27', 'wire_28_3740e5a2': '28'}, 'role': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2'}}}, 'source_SYS_Fan': {'source': 'SYS_Fan', 'parent': 'parentResId', 'fields': {'id': 'String', 'tenantId': 'String', 'projectId': 'String', 'name': 'String', 'elecLabel': 'String', 'parentResId': 'String', 'type': 'String', 'slot': 'String', 'location': 'String', 'description': 'String', 'boardType': 'String', 'bomId': 'String', 'barCode': 'String', 'runningStatus': 'String', 'healthStatus': 'String', 'runLevel': 'String'}, 'search': ['name', 'elecLabel', 'location', 'description', 'bomId', 'barCode'], 'domains': {'runningStatus': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire_3_5566f006': '3', 'wire_8_9a7dee24': '8', 'wire_27_c2fd18a7': '27', 'wire_28_3740e5a2': '28'}, 'healthStatus': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2'}, 'runLevel': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2'}}}, 'source_SYS_PowerSupply': {'source': 'SYS_PowerSupply', 'parent': 'parentResId', 'fields': {'id': 'String', 'tenantId': 'String', 'name': 'String', 'slot': 'String', 'elecLabel': 'String', 'parentResId': 'String', 'bomCode': 'String', 'powerMode': 'Int', 'sn': 'String', 'description': 'String', 'boardType': 'String', 'barCode': 'String', 'location': 'String', 'temperature': 'String', 'productModel': 'String', 'powerVersion': 'String', 'produceDate': 'String', 'powerType': 'String', 'runningStatus': 'String', 'healthStatus': 'String', 'manufacturer': 'String', 'projectId': 'String'}, 'search': ['name', 'elecLabel', 'bomCode', 'sn', 'description', 'barCode', 'location', 'productModel', 'powerVersion', 'manufacturer'], 'domains': {'powerMode': {'wire_0_92e42f8f': 0, 'wire_1_8d618873': 1, 'wire_2_d0a68914': 2}, 'powerType': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire_255_4df4b446': '255'}, 'runningStatus': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire_27_c2fd18a7': '27', 'wire_28_3740e5a2': '28'}, 'healthStatus': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire_9_f6ca7439': '9', 'wire_11_90e5da09': '11', 'wire_19_fb5455b7': '19'}}}}
    tenants = [{"id": "t1"}, {"id": "t2"}]
    storages = [{"id": "S1", "tenant": "t1"}, {"id": "S2", "tenant": "t2"}, {"id": "C00", "tenant": "t1"}]
    for row in tenants:
        insert("tenant", {"TENANT_ID": row["id"]})
    for row in storages:
        insert("storage_device", {"id": row["id"], "tenantId": row["tenant"]})
    populations = {}
    for entity, spec in specs.items():
        rows = []
        known_count = max(len(mapping) for mapping in spec["domains"].values())
        for index in range(known_count + 3):
            row = {"id": f"C{index:02}", "tenantId": ["t1", "t2", "orphan"][index % 3],
                spec["parent"]: ["S1", "S1", "C00", "S2", "missing", None, "S1"][index % 7]}
            for field, ty in spec["fields"].items():
                if field in row: continue
                if field in spec["domains"]:
                    values = list(spec["domains"][field].values())
                    row[field] = values[index % len(values)] if index < known_count else (None if index == known_count + 1 else 999 if ty == "Int" else "other")
                elif field in ["manufacturedDate", "produceDate"]:
                    row[field] = ["2024-03-31", "2024-04-01", "2024-04-02", None][index % 4]
                elif field == "createTime":
                    row[field] = (index + 1) * 1000
                elif ty == "Int":
                    row[field] = [1, 0, 2, -1, 3, None, 4][index % 7]
                else:
                    row[field] = "0010%" if field in ["temperature", "memorySize", "chargeTimes"] and index % 2 == 0 else f"raw_%_{field}_{index}"
            rows.append(row)
            insert(entity, row)
        populations[entity] = rows
    comparisons = {"Eq": lambda a, b: a == b, "Ne": lambda a, b: a != b, "Gt": lambda a, b: a > b,
        "Ge": lambda a, b: a >= b, "Lt": lambda a, b: a < b, "Le": lambda a, b: a <= b,
        "Contains": lambda a, b: b in a}
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
            return row[field]
        def matches(row, target, kind):
            return row["tenantId"] == target["id"] if kind == "tenant" else row[spec["parent"]] == target["id"]
        if request.get("edges") or request.get("exists"):
            relation = (request["edges"] if request.get("edges") else request["exists"][0]["edges"])[0]["relation"]
            kind = "tenant" if relation.endswith("AssociationX_TENANT_VIEW") else "storage"
            targets = [] if empty else tenants if kind == "tenant" else storages
            if request.get("exists"):
                value = sum(any(matches(row, target, kind) for target in targets) for row in rows) if request["root"] == "c" else sum(any(matches(row, target, kind) for row in rows) for target in targets)
                return [{request["root"] + "_count": value}]
            column = "x_tenant_id" if kind == "tenant" else "x_storage_device_id"
            return [{"c_" + entity + "__id": row["id"], column: target["id"]} for row in rows for target in targets if matches(row, target, kind)]
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
print(f"Passed {len(cases)} storage-component SQLite typed/baseline pairs with independent expectations and empty-table checks; PostgreSQL bindings only")
