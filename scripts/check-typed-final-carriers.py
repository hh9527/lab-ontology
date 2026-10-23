#!/usr/bin/env python3
"""执行 存储 KPI 与设备检索表的字段、统计、IPv4 与关联的新旧 SQL 对照。"""
import ipaddress
import json
import math
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
        str(ROOT / "bin/telora"), "-C", str(ROOT / "icloud_model"), "eval", "@test/typed_final_carriers_runtime:runtime_fixture",
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
    specs = {'source_StorageDeviceKPI': {'fields': {'ts': 'String', 'resId': 'String', 'cpuusage': 'Float', 'memoryusage': 'Float', 'cpuusageEffcnt': 'Int', 'memoryusageEffcnt': 'Int'}, 'measures': {'storage_cpu_usage': ['cpuusage', 'Avg'], 'storage_cpu_sample_max': ['cpuusage', 'Max'], 'storage_cpu_sample_min': ['cpuusage', 'Min'], 'storage_memory_usage': ['memoryusage', 'Avg'], 'storage_memory_usage_max': ['memoryusage', 'Max'], 'storage_memory_usage_min': ['memoryusage', 'Min']}, 'domains': {}}, 'source_StorageHardDriveKPI': {'fields': {'ts': 'String', 'resId': 'String', 'utility': 'Float', 'avgreadiosize': 'Float', 'avgwriteiosize': 'Float', 'utilityEffcnt': 'Int', 'avgreadiosizeEffcnt': 'Int', 'avgwriteiosizeEffcnt': 'Int'}, 'measures': {'storage_disk_usage': ['utility', 'Avg'], 'storage_disk_usage_max': ['utility', 'Max'], 'storage_disk_usage_min': ['utility', 'Min'], 'storage_disk_read_io_size': ['avgreadiosize', 'Avg'], 'storage_disk_read_io_size_max': ['avgreadiosize', 'Max'], 'storage_disk_read_io_size_min': ['avgreadiosize', 'Min'], 'storage_disk_write_io_size': ['avgwriteiosize', 'Avg'], 'storage_disk_write_io_size_max': ['avgwriteiosize', 'Max'], 'storage_disk_write_io_size_min': ['avgwriteiosize', 'Min']}, 'domains': {}}, 'source_T_DEVICE_ALL': {'fields': {'ID': 'String', 'NAME': 'String', 'CATEGORY': 'String', 'IP': 'String', 'MAC': 'String', 'CLASS_NAME': 'String'}, 'measures': {}, 'domains': {'CATEGORY': {'wire_STORAGE_141ae45b': 'STORAGE', 'wire_FW_0aa27341': 'FW', 'wire_AR_e0a8656f': 'AR', 'wire_LSW_2a4d3432': 'LSW', 'wire_TianGuan_22eb4636': 'TianGuan', 'wire_AC_b0da51ed': 'AC', 'wire_AP_bc7a4ff3': 'AP', 'wire_Collaboration_3ea905f6': 'Collaboration', 'wire_ONU_d0365b90': 'ONU', 'wire_OLT_02da0d65': 'OLT', 'wire_SPL_866a7941': 'SPL', 'wire_SERVER_7eb2b745': 'SERVER'}}}}
    stamps = ["2024-03-31T23:00:00Z", "2024-03-31T23:59:00Z", "2024-04-01T00:00:00Z", "2024-03-31T23:00:00Z", "2024-03-31T23:30:00Z", "2024-04-01T12:00:00Z", "2024-04-02T00:00:00Z"]
    resources = ["A", "A", "A", "D", "B", "B", "C"]
    bases = [1, 31, None, 125, -5, 50, None]
    effective = [1, 0, 1, 100, 0, 2, 0]
    owners = {"storage_device": ["A", "B", "orphan"], "source_FCSwitchDevice": ["A", "D", "orphan"]}
    for entity, ids in owners.items():
        for id in ids:
            insert(entity, {"id": id})
    populations = {}
    for entity, spec in specs.items():
        rows = []
        if spec["measures"]:
            float_fields = [field for field, ty in spec["fields"].items() if ty == "Float"]
            for index, base in enumerate(bases):
                row = {"ts": stamps[index], "resId": resources[index]}
                for field in float_fields:
                    row[field] = None if base is None else base + float_fields.index(field) * 0.25
                for field in spec["fields"]:
                    if field.endswith("Effcnt"):
                        row[field] = effective[index]
                rows.append(row)
        else:
            mapping = spec["domains"]["CATEGORY"]
            addresses = ["10.0.0.1", "10.0.0.128", "10.0.0.255", "10.0.1.1", "010.0.0.1", "::1", "256.0.0.1", "10.0.0.1\n", None]
            values = list(mapping.values()) + ["other", None, ""]
            for index, category in enumerate(values):
                rows.append({"ID": f"D{index}", "NAME": f"raw_%_name_{index}", "CATEGORY": category, "IP": addresses[index % len(addresses)], "MAC": f"raw_mac_{index}", "CLASS_NAME": "custom_class"})
        for row in rows:
            insert(entity, row)
        populations[entity] = rows
    def ipv4(raw):
        try:
            value = str(ipaddress.IPv4Address(raw))
            return value if value == raw else None
        except (ValueError, TypeError):
            return None
    def bucket(stamp, unit):
        if unit == "hour": return stamp[:13] + ":00:00Z"
        if unit == "day": return stamp[:10] + "T00:00:00Z"
        return stamp[:7] + "-01T00:00:00Z"
    comparisons = {"Eq": lambda a, b: a == b, "Ne": lambda a, b: a != b, "Gt": lambda a, b: a > b,
        "Ge": lambda a, b: a >= b, "Lt": lambda a, b: a < b, "Le": lambda a, b: a <= b, "Contains": lambda a, b: b in a,
        "InSubnet": lambda a, b: ipaddress.IPv4Address(a) in ipaddress.IPv4Network(b),
        "NotInSubnet": lambda a, b: ipaddress.IPv4Address(a) not in ipaddress.IPv4Network(b)}
    def expected(request, empty=False):
        all_nodes = request["nodes"] + [node for clause in request.get("exists", []) for node in clause["nodes"]]
        entity = next(node["entity"] for node in all_nodes if node["id"] == "r")
        spec = specs[entity]
        rows = [] if empty else populations[entity]
        def dimension(row, id):
            if id.startswith(entity + "_utc_"):
                return bucket(row["ts"], id.rsplit("_", 1)[1])
            field = id[len(entity) + 2:]
            if field == "IP_ipv4": return ipv4(row["IP"])
            if field in spec["domains"]:
                return {wire: member for member, wire in spec["domains"][field].items()}.get(row[field])
            return row[field]
        def statistic(members, name):
            field, op = spec["measures"][name]
            values = [row[field] for row in members if row[field] is not None]
            return None if not values else sum(values) / len(values) if op == "Avg" else max(values) if op == "Max" else min(values)
        if request.get("edges") or request.get("exists"):
            owner_entity = next(node["entity"] for node in all_nodes if node["id"] == "p")
            targets = [] if empty else owners[owner_entity]
            dim = "storage_device_id" if owner_entity == "storage_device" else "source_FCSwitchDevice__id"
            if request.get("exists"):
                count = sum(any(row["resId"] == id for row in rows) for id in targets) if request["root"] == "p" else sum(row["resId"] in targets for row in rows)
                return [{request["root"] + "_count": count}]
            if request.get("measures"):
                return [{"p_" + dim: id, **{"r_" + m["measure"]: statistic([row for row in rows if row["resId"] == id], m["measure"]) for m in request["measures"]}} for id in targets if any(row["resId"] == id for row in rows)]
            return [{"p_" + dim: id, "r_" + entity + "__resId": row["resId"], "r_" + entity + "__ts": row["ts"]} for id in targets for row in rows if row["resId"] == id]
        for f in request.get("filters", []):
            rows = [row for row in rows if dimension(row, f["dimension"]) is not None and comparisons[f["op"]](dimension(row, f["dimension"]), f["value"])]
        for window in request.get("time_windows", []):
            rows = [row for row in rows if window["start"] <= row["ts"] < window["end"]]
        selections = request["select"]
        for selection in selections:
            field = selection["dimension"][len(entity) + 2:]
            if field in spec["domains"]:
                rows = [row for row in rows if dimension(row, selection["dimension"]) is not None]
        if not request.get("measures") and request.get("count") is None:
            return [{"r_" + s["dimension"]: dimension(row, s["dimension"]) for s in selections} for row in rows]
        groups = {}
        for row in rows:
            key = tuple(dimension(row, s["dimension"]) for s in selections)
            groups.setdefault(key, []).append(row)
        if not selections and not rows: groups[()] = []
        return [{**{"r_" + s["dimension"]: value for s, value in zip(selections, key)},
            **({"r_count": len(members)} if request.get("count") else {}),
            **{"r_" + m["measure"]: statistic(members, m["measure"]) for m in request.get("measures", [])}} for key, members in groups.items()]
    def run(query):
        return sorted(db.execute(query["sql"], {str(i + 1): value for i, value in enumerate(query["bindings"])}).fetchall(), key=repr)
    def verify(case, empty=False):
        actual = run(case["typed"])
        assert actual == run(case["baseline"]), (case["id"], actual, run(case["baseline"]))
        columns = [column["name"] for column in case["columns"]]
        rows = expected(case["request"], empty)
        assert all(set(row) == set(columns) for row in rows), (case["id"], columns, rows)
        wanted = sorted([tuple(row[column] for column in columns) for row in rows], key=repr)
        assert len(actual) == len(wanted), (case["id"], actual, wanted)
        for arow, brow in zip(actual, wanted):
            for a, b in zip(arow, brow):
                assert math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-12) if isinstance(a, float) and isinstance(b, float) else a == b, (case["id"], arow, brow)
    for case in cases:
        assert case["columns"] == case["baseline_columns"], case["id"]
        assert case["typed"]["bindings"] == case["baseline"]["bindings"] == case["postgres"]["bindings"], case["id"]
        verify(case)
    for table in schemas:
        db.execute(f'DELETE FROM "{table}"')
    for case in cases:
        verify(case, empty=True)
print(f"Passed {len(cases)} final-carrier SQLite typed/baseline pairs with independent expectations and empty-table checks; PostgreSQL bindings only")
