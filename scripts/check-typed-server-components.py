#!/usr/bin/env python3
"""执行 服务器组件字段、状态域与原始身份关系的新旧 SQL 对照。"""
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
        str(ROOT / "bin/telora"), "-C", str(ROOT / "icloud_model"), "eval", "@test/typed_server_components_runtime:runtime_fixture",
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
    specs = {'source_PhysicalServerDisk': {'source': 'PhysicalServerDisk', 'parent': 'parentResId', 'fields': {'name': 'String', 'tenantId': 'String', 'id': 'String', 'remainingLifespan': 'String', 'serialNumber': 'String', 'interfaceType': 'String', 'mediaType': 'String', 'capacity': 'Int', 'model': 'String', 'manufacturer': 'String', 'healthStatus': 'Int', 'diskName': 'String', 'projectId': 'String', 'parentResId': 'String'}, 'search': ['name', 'serialNumber', 'model', 'manufacturer', 'diskName'], 'domains': {'interfaceType': {'wire_SPI_56273fe0': 'SPI', 'wire_PCIe_8f3234e0': 'PCIe', 'wire_AHCI_a011b86d': 'AHCI', 'wire_UHCI_46b96d78': 'UHCI', 'wire_SAS_81d74a85': 'SAS', 'wire_SATA_53b6295c': 'SATA', 'wire_USB_c1123759': 'USB', 'wire_NVMe_df3994b6': 'NVMe', 'wire_FC_abe64c81': 'FC', 'wire_iSCSI_d9c0d556': 'iSCSI', 'wire_FCoE_0af2e0ea': 'FCoE', 'wire_NVMeOverFabrics_d316ea1e': 'NVMeOverFabrics', 'wire_SMB_6b0b7a08': 'SMB', 'wire_NFSv3_3dc469e2': 'NFSv3', 'wire_NFSv4_5dbfba49': 'NFSv4', 'wire_HTTP_a198c1ae': 'HTTP', 'wire_HTTPS_3aad0542': 'HTTPS', 'wire_FTP_36322edc': 'FTP', 'wire_SFTP_ea59c8d5': 'SFTP'}, 'mediaType': {'wire_HDD_2019ec66': 'HDD', 'wire_SSD_cf486063': 'SSD', 'wire_SMR_7c93b219': 'SMR'}, 'healthStatus': {'wire_0_92e42f8f': 0, 'wire_1_8d618873': 1, 'wire_2_d0a68914': 2, 'wire_3_bab86ec8': 3, 'wire_4_5978b238': 4, 'wire__1_fe93bf05': -1, 'wire__2_1027a474': -2}}}, 'source_PhysicalServerNetworkAdapter': {'source': 'PhysicalServerNetworkAdapter', 'parent': 'parentResId', 'fields': {'name': 'String', 'tenantId': 'String', 'id': 'String', 'parentResId': 'String', 'position': 'String', 'cardModel': 'String', 'cardManufacturer': 'String', 'cardName': 'String', 'healthState': 'String', 'driverVersion': 'String', 'driverName': 'String', 'createTime': 'Int', 'nativeId': 'String', 'projectId': 'String', 'model': 'String'}, 'search': ['name', 'position', 'cardManufacturer', 'cardName', 'driverVersion', 'driverName', 'model'], 'domains': {'healthState': {'wire_OK_99d53776': 'OK', 'wire_Warning_d7beb178': 'Warning', 'wire_Critical_9b31fa4b': 'Critical', 'wire_Unknown_56323c5e': 'Unknown'}}}, 'source_PhysicalServerOpticalModule': {'source': 'PhysicalServerOpticalModule', 'parent': 'neResId', 'fields': {'name': 'String', 'tenantId': 'String', 'id': 'String', 'partNumber': 'String', 'channelNum': 'Int', 'portResId': 'String', 'cardResId': 'String', 'serialNumber': 'String', 'operStatus': 'String', 'adminStatus': 'String', 'transType': 'String', 'vendorSn': 'String', 'vendorName': 'String', 'neResId': 'String', 'projectId': 'String', 'ifName': 'String'}, 'search': ['name', 'partNumber', 'serialNumber', 'vendorSn', 'vendorName', 'ifName'], 'domains': {'operStatus': {'wire_OK_99d53776': 'OK', 'wire_Warning_d7beb178': 'Warning', 'wire_Critical_9b31fa4b': 'Critical', 'wire_Unknown_56323c5e': 'Unknown'}}}, 'source_PhysicalServerPort': {'source': 'PhysicalServerPort', 'parent': 'parentResId', 'fields': {'name': 'String', 'tenantId': 'String', 'id': 'String', 'portType': 'String', 'linkStatus': 'String', 'cardResId': 'String', 'macAddress': 'String', 'projectId': 'String', 'parentResId': 'String'}, 'search': ['name', 'macAddress'], 'domains': {'portType': {'wire_OpticalPort_c215d09c': 'OpticalPort', 'wire_ElectricalPort_0ae2b003': 'ElectricalPort'}, 'linkStatus': {'wire_Up_7b5a6329': 'Up', 'wire_Down_b561793d': 'Down', 'wire_NoLink_5ba24694': 'NoLink', 'wire_Unknown_56323c5e': 'Unknown'}}}, 'source_PhysicalServerProcessor': {'source': 'PhysicalServerProcessor', 'parent': 'parentResId', 'fields': {'tenantId': 'String', 'id': 'String', 'slotId': 'Int', 'frequency': 'Int', 'model': 'String', 'manufacturer': 'String', 'processorType': 'String', 'processorId': 'String', 'parentResId': 'String', 'operStatus': 'String', 'adminStatus': 'String', 'name': 'String', 'projectId': 'String', 'serialNumber': 'String'}, 'search': ['model', 'manufacturer', 'name', 'serialNumber'], 'domains': {'frequency': {'wire__1_fe93bf05': -1}, 'operStatus': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire_3_5566f006': '3', 'wire_4_60aedc0f': '4', 'wire__1_e9ea423a': '-1', 'wire__2_25abac3c': '-2'}, 'adminStatus': {'wire_0_91adcf51': '0', 'wire_1_44cd5f3d': '1', 'wire_2_8807c846': '2', 'wire__1_e9ea423a': '-1'}}}}
    tenants = [{"id": "t1"}, {"id": "t2"}]
    servers = [{"id": "S1", "origin": "orig1", "tenant": "t1"}, {"id": "S2", "origin": "orig2", "tenant": "t2"},
        {"id": "orig1", "origin": "other", "tenant": "t1"}, {"id": "S3", "origin": "orig1", "tenant": "t2"}]
    for row in tenants:
        insert("tenant", {"TENANT_ID": row["id"]})
    for row in servers:
        insert("server_device", {"id": row["id"], "oriResId": row["origin"], "tenantId": row["tenant"], "name": row["id"]})
    populations = {}
    for entity, spec in specs.items():
        rows = []
        known_count = max(len(mapping) for mapping in spec["domains"].values())
        for index in range(known_count + 3):
            row = {"id": f"C{index:02}", "tenantId": ["t1", "t2", "orphan"][index % 3],
                spec["parent"]: ["orig1", "orig1", "S1", "orig2", "missing", None, "orig1"][index % 7]}
            for field, ty in spec["fields"].items():
                if field in row: continue
                if field in spec["domains"]:
                    values = list(spec["domains"][field].values())
                    row[field] = values[index % len(values)] if index < known_count else (None if index == known_count + 1 else 2600 if field == "frequency" else 999 if ty == "Int" else "other")
                elif field == "capacity":
                    row[field] = [1, 2147483649, 9007199254740993, 0, -1, 64, None][index % 7]
                elif field == "createTime":
                    row[field] = (index + 1) * 1000
                elif ty == "Int":
                    row[field] = [1, 0, 2, -1, 3, None, 4][index % 7]
                else:
                    row[field] = "0010%" if field == "remainingLifespan" and index % 2 == 0 else "custom_accelerator" if field == "processorType" else f"raw_%_{field}_{index}"
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
            return row["tenantId"] == target["id"] if kind == "tenant" else row[spec["parent"]] == target["origin"]
        if request.get("edges") or request.get("exists"):
            relation = (request["edges"] if request.get("edges") else request["exists"][0]["edges"])[0]["relation"]
            kind = "tenant" if relation.endswith("_X_TENANT_VIEW") else "server"
            targets = [] if empty else tenants if kind == "tenant" else servers
            if request.get("exists"):
                value = sum(any(matches(row, target, kind) for target in targets) for row in rows) if request["root"] == "c" else sum(any(matches(row, target, kind) for row in rows) for target in targets)
                return [{request["root"] + "_count": value}]
            column = "x_tenant_id" if kind == "tenant" else "x_server_name"
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
print(f"Passed {len(cases)} server-component SQLite typed/baseline pairs with independent expectations and empty-table checks; PostgreSQL bindings only")
