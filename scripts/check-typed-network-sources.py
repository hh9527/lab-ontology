#!/usr/bin/env python3
"""执行 蜂窝链路、单板和在线率来源的原始过滤与统计的新旧 SQL 对照。"""
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
        str(ROOT / "bin/telora"), "-C", str(ROOT / "icloud_model"), "eval", "@test/typed_network_sources_runtime:runtime_fixture",
        "--initialization-fuel", "600000", "--request-fuel", "100000", "--with-memory-limit", "2048",
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
    specs = {'source_NetworkCellLinkQualityKPI': {'fields': {'ts': 'String', 'resId': 'String', 'tenantId': 'String', 'projectId': 'String', 'srcSiteId': 'String', 'destSiteId': 'String', 'sourceWanlinkId': 'String', 'destWanlinkId': 'String', 'packetLoss': 'Float', 'jitter': 'Float', 'delay': 'Float', 'lqm': 'Float', 'packetLossEffcnt': 'Int', 'jitterEffcnt': 'Int', 'delayEffcnt': 'Int', 'lqmEffcnt': 'Int'}, 'measures': {}}, 'source_NetworkCellLinkTrafficKPI': {'fields': {'ts': 'String', 'resId': 'String', 'tenantId': 'String', 'projectId': 'String', 'srcSiteId': 'String', 'destSiteId': 'String', 'sourceWanlinkId': 'String', 'destWanlinkId': 'String', 'upwardTraffic': 'Float', 'downwardTraffic': 'Float', 'utilization': 'Float', 'upwardTrafficEffcnt': 'Int', 'downwardTrafficEffcnt': 'Int', 'utilizationEffcnt': 'Int'}, 'measures': {}}, 'source_NetworkDeviceBoardKPI': {'fields': {'ts': 'String', 'resId': 'String', 'tenantId': 'String', 'parentId': 'String', 'projectId': 'String', 'cpuUsage': 'Float', 'memUsage': 'Float', 'hwEntityTemperature': 'Float', 'cpuUsageEffcnt': 'Int', 'memUsageEffcnt': 'Int', 'hwEntityTemperatureEffcnt': 'Int'}, 'measures': {'board_cpu_usage': ['cpuUsage', 'Avg'], 'board_cpu_usage_max': ['cpuUsage', 'Max'], 'board_cpu_usage_min': ['cpuUsage', 'Min'], 'board_memory_usage': ['memUsage', 'Avg'], 'board_memory_usage_max': ['memUsage', 'Max'], 'board_memory_usage_min': ['memUsage', 'Min'], 'board_temperature': ['hwEntityTemperature', 'Avg'], 'board_temperature_max': ['hwEntityTemperature', 'Max'], 'board_temperature_min': ['hwEntityTemperature', 'Min']}}, 'source_NetworkDeviceOnlineKPI': {'fields': {'ts': 'String', 'resId': 'String', 'tenantId': 'String', 'parentId': 'String', 'projectId': 'String', 'deviceName': 'String', 'classification': 'String', 'onlineRate': 'Float', 'onlineRateEffcnt': 'Int'}, 'measures': {'network_online_rate_avg': ['onlineRate', 'Avg'], 'network_online_rate_min': ['onlineRate', 'Min'], 'network_online_rate_max': ['onlineRate', 'Max']}}}
    stamps = ["2024-03-31T23:00:00Z", "2024-03-31T23:59:00Z", "2024-04-01T00:00:00Z", "2024-03-31T23:00:00Z",
        "2024-03-31T23:30:00Z", "2024-04-01T12:00:00Z", "2024-04-02T00:00:00Z"]
    resources = ["A", "A", "A", "A", "B", "B", "C"]
    tenants = ["t1", "t1", "t1", "t2", "t1", "t1", "t1"]
    # 第一个浮点样本为 1.0，明确覆盖比较阈值的等值边界。
    bases = [0.75, 30, None, 125, -5, 50, None]
    effective = [1, 0, 1, 100, 0, 2, 0]
    populations = {}
    for entity, spec in specs.items():
        rows = []
        for index, base in enumerate(bases):
            row = {"ts": stamps[index], "resId": resources[index], "tenantId": tenants[index]}
            for field, ty in spec["fields"].items():
                if field in row:
                    continue
                if field.endswith("Effcnt"):
                    row[field] = effective[index]
                elif ty == "Float":
                    row[field] = None if base is None else base + 0.25
                else:
                    row[field] = f"raw_%_{field}"
            rows.append(row)
            insert(entity, row)
        populations[entity] = rows
    # 在线率专表不得回退到旧 NetworkDeviceKPI 总体。
    insert("device_kpi", {"resId": "A", "tenantId": "t1", "ts": stamps[0], "onlineRate": 9999.0})
    def bucket(stamp, unit):
        if unit == "hour": return stamp[:13] + ":00:00Z"
        if unit == "day": return stamp[:10] + "T00:00:00Z"
        return stamp[:7] + "-01T00:00:00Z"
    comparisons = {"Eq": lambda a, b: a == b, "Ne": lambda a, b: a != b, "Gt": lambda a, b: a > b,
        "Ge": lambda a, b: a >= b, "Lt": lambda a, b: a < b, "Le": lambda a, b: a <= b,
        "Contains": lambda a, b: b in a}
    def expected(request, empty=False):
        entity = request["nodes"][0]["entity"]
        assert len(request["nodes"]) == 1 and request["edges"] == [], request
        spec = specs[entity]
        rows = [] if empty else populations[entity]
        def dimension(row, id):
            if id.startswith(entity + "__"):
                return row[id[len(entity) + 2:]]
            assert id.startswith(entity + "_utc_"), id
            return bucket(row["ts"], id.rsplit("_", 1)[1])
        for filter in request.get("filters", []):
            rows = [row for row in rows if dimension(row, filter["dimension"]) is not None
                and comparisons[filter["op"]](dimension(row, filter["dimension"]), filter["value"])]
        for window in request.get("time_windows", []):
            rows = [row for row in rows if window["start"] <= row["ts"] < window["end"]]
        selections = request["select"]
        measures = request.get("measures", [])
        count = request.get("count")
        def project(row):
            return {"r_" + selection["dimension"]: dimension(row, selection["dimension"]) for selection in selections}
        if not measures and count is None:
            return [project(row) for row in rows]
        groups = {}
        for row in rows:
            key = tuple(dimension(row, selection["dimension"]) for selection in selections)
            groups.setdefault(key, []).append(row)
        if not selections and not rows:
            groups[()] = []
        result = []
        for key, members in groups.items():
            value = {"r_" + selection["dimension"]: item for selection, item in zip(selections, key)}
            if count is not None:
                value["r_count"] = len(members)
            for measure in measures:
                field, op = spec["measures"][measure["measure"]]
                population = [row[field] for row in members if row[field] is not None]
                value["r_" + measure["measure"]] = None if not population else (sum(population) / len(population) if op == "Avg" else max(population) if op == "Max" else min(population))
            result.append(value)
        return result
    def run(query):
        return sorted(db.execute(query["sql"], {str(i + 1): value for i, value in enumerate(query["bindings"])}).fetchall(), key=repr)
    def verify(case, empty=False):
        actual = run(case["typed"])
        assert actual == run(case["baseline"]), ("empty" if empty else "rows", case["id"], actual, run(case["baseline"]))
        columns = [column["name"] for column in case["columns"]]
        rows = expected(case["request"], empty)
        assert all(set(row) == set(columns) for row in rows), (case["id"], columns, rows)
        expected_rows = sorted([tuple(row[column] for column in columns) for row in rows], key=repr)
        assert len(actual) == len(expected_rows), (case["id"], actual, expected_rows)
        for actual_row, expected_row in zip(actual, expected_rows):
            for a, b in zip(actual_row, expected_row):
                assert math.isclose(a, b, rel_tol=1e-12, abs_tol=1e-12) if isinstance(a, float) and isinstance(b, float) else a == b, (case["id"], actual_row, expected_row)
    for case in cases:
        assert case["columns"] == case["baseline_columns"], case["id"]
        assert case["typed"]["bindings"] == case["baseline"]["bindings"] == case["postgres"]["bindings"], case["id"]
        verify(case)
    for table in schemas:
        db.execute(f'DELETE FROM "{table}"')
    for case in cases:
        verify(case, empty=True)
print(f"Passed {len(cases)} network-source SQLite typed/baseline pairs with independent expectations and empty-table checks; PostgreSQL bindings only")
