#!/usr/bin/env python3
"""执行 AP／射频样本原始统计与 UTC 窗口的新旧 SQL 对照。"""
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
        str(ROOT / "bin/telora"), "-C", str(ROOT / "icloud_model"), "eval", "@test/typed_ap_runtime:runtime_fixture",
        "--initialization-fuel", "450000", "--request-fuel", "100000", "--with-memory-limit", "2048",
    ], capture_output=True, text=True, timeout=420)
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
    specs = {'source_NetworkAPKPI': {'fields': {'ts': 'String', 'resId': 'String', 'tenantId': 'String', 'parentId': 'String', 'projectId': 'String', 'hwCurrAssStationCount': 'Int', 'hwApEthportUpRate': 'Float', 'hwApEthportDownRate': 'Float', 'hwAPUpPortPER': 'Float', 'hwCurrAssStationCountEffcnt': 'Int', 'hwApEthportUpRateEffcnt': 'Int', 'hwApEthportDownRateEffcnt': 'Int', 'hwAPUpPortPEREffcnt': 'Int'}, 'measures': {'ap_associated_terminals': ('hwCurrAssStationCount', 'Avg'), 'ap_associated_terminals_max': ('hwCurrAssStationCount', 'Max'), 'ap_associated_terminals_min': ('hwCurrAssStationCount', 'Min'), 'ap_uplink_tx_rate': ('hwApEthportUpRate', 'Avg'), 'ap_uplink_tx_rate_max': ('hwApEthportUpRate', 'Max'), 'ap_uplink_tx_rate_min': ('hwApEthportUpRate', 'Min'), 'ap_uplink_rx_rate': ('hwApEthportDownRate', 'Avg'), 'ap_uplink_rx_rate_max': ('hwApEthportDownRate', 'Max'), 'ap_uplink_rx_rate_min': ('hwApEthportDownRate', 'Min'), 'ap_uplink_packet_error_rate': ('hwAPUpPortPER', 'Avg'), 'ap_uplink_packet_error_rate_max': ('hwAPUpPortPER', 'Max'), 'ap_uplink_packet_error_rate_min': ('hwAPUpPortPER', 'Min')}}, 'source_NetworkApRadioKPI': {'fields': {'ts': 'String', 'resId': 'String', 'tenantId': 'String', 'parentId': 'String', 'projectId': 'String', 'frequency': 'String', 'channel': 'String', 'radioName': 'String', 'hwRadioChUtilizationRate': 'Float', 'hwRadioNoise': 'Float', 'hwWlanRadioRetryFramesRate': 'Float', 'upwardSpeed': 'Int', 'downwardSpeed': 'Int', 'packetLossRate': 'Float', 'connectedTerminals': 'Int', 'rssi': 'Int', 'hwRadioChUtilizationRateEffcnt': 'Int', 'hwRadioNoiseEffcnt': 'Int', 'hwWlanRadioRetryFramesRateEffcnt': 'Int', 'upwardSpeedEffcnt': 'Int', 'downwardSpeedEffcnt': 'Int', 'packetLossRateEffcnt': 'Int', 'connectedTerminalsEffcnt': 'Int', 'rssiEffcnt': 'Int'}, 'measures': {'ap_radio_channel_usage': ('hwRadioChUtilizationRate', 'Avg'), 'ap_radio_channel_usage_max': ('hwRadioChUtilizationRate', 'Max'), 'ap_radio_channel_usage_min': ('hwRadioChUtilizationRate', 'Min'), 'ap_radio_noise': ('hwRadioNoise', 'Avg'), 'ap_radio_noise_max': ('hwRadioNoise', 'Max'), 'ap_radio_noise_min': ('hwRadioNoise', 'Min'), 'ap_radio_retry_rate': ('hwWlanRadioRetryFramesRate', 'Avg'), 'ap_radio_retry_rate_max': ('hwWlanRadioRetryFramesRate', 'Max'), 'ap_radio_retry_rate_min': ('hwWlanRadioRetryFramesRate', 'Min'), 'ap_radio_uplink_rate': ('upwardSpeed', 'Avg'), 'ap_radio_uplink_rate_max': ('upwardSpeed', 'Max'), 'ap_radio_uplink_rate_min': ('upwardSpeed', 'Min'), 'ap_radio_downlink_rate': ('downwardSpeed', 'Avg'), 'ap_radio_downlink_rate_max': ('downwardSpeed', 'Max'), 'ap_radio_downlink_rate_min': ('downwardSpeed', 'Min'), 'ap_radio_packet_loss_rate': ('packetLossRate', 'Avg'), 'ap_radio_packet_loss_rate_max': ('packetLossRate', 'Max'), 'ap_radio_packet_loss_rate_min': ('packetLossRate', 'Min'), 'ap_radio_connected_terminals': ('connectedTerminals', 'Avg'), 'ap_radio_connected_terminals_max': ('connectedTerminals', 'Max'), 'ap_radio_connected_terminals_min': ('connectedTerminals', 'Min'), 'ap_radio_rssi': ('rssi', 'Avg'), 'ap_radio_rssi_max': ('rssi', 'Max'), 'ap_radio_rssi_min': ('rssi', 'Min')}}}
    stamps = ["2024-03-31T23:00:00Z", "2024-03-31T23:59:00Z", "2024-04-01T00:00:00Z", "2024-03-31T23:00:00Z",
        "2024-03-31T23:30:00Z", "2024-04-01T12:00:00Z", "2024-04-02T00:00:00Z"]
    resources = ["A", "A", "A", "A", "B", "B", "C"]
    tenants = ["t1", "t1", "t1", "t2", "t1", "t1", "t1"]
    bases = [10, 30, None, 100, -5, 50, None]
    effective = [1, 0, 1, 100, 0, 2, 0]
    frequency = ["1", "2", "3", "9", None, "1", "2"]
    frequency_members = {"wire_1_44cd5f3d": "1", "wire_2_8807c846": "2", "wire_3_5566f006": "3"}
    populations = {}
    for entity, spec in specs.items():
        rows = []
        for index, base in enumerate(bases):
            row = {"ts": stamps[index], "resId": resources[index], "tenantId": tenants[index], "parentId": "raw-parent", "projectId": "raw-project"}
            for field, ty in spec["fields"].items():
                if field in row:
                    continue
                if field.endswith("Effcnt"):
                    row[field] = effective[index]
                elif ty == "Int":
                    row[field] = None if base is None else (base - 100 if field == "rssi" else base)
                elif ty == "Float":
                    row[field] = None if base is None else (base - 90.25 if field == "hwRadioNoise" else base + 0.25)
                else:
                    row[field] = frequency[index] if field == "frequency" else f"raw_%_{field}"
            rows.append(row)
            insert(entity, row)
        populations[entity] = rows
    def bucket(stamp, unit):
        if unit == "hour": return stamp[:13] + ":00:00Z"
        if unit == "day": return stamp[:10] + "T00:00:00Z"
        return stamp[:7] + "-01T00:00:00Z"
    def aggregate(entity, rows):
        values = {"r_count": len(rows)}
        for id, (field, op) in specs[entity]["measures"].items():
            population = [row[field] for row in rows if row[field] is not None]
            values["r_" + id] = None if not population else (sum(population) / len(population) if op == "Avg" else max(population) if op == "Max" else min(population))
        return values
    comparisons = {"Eq": lambda a: a == 1, "Ne": lambda a: a != 1, "Gt": lambda a: a > 1,
        "Ge": lambda a: a >= 1, "Lt": lambda a: a < 1, "Le": lambda a: a <= 1}
    def expected(case, empty=False):
        id = case["id"]
        if id.startswith("project_"):
            dimension = id[len("project_"):]
            entity = next(entity for entity in specs if dimension.startswith(entity + "_"))
            rows = [] if empty else populations[entity]
            if dimension.startswith(entity + "__"):
                field = dimension[len(entity) + 2:]
                if field == "frequency":
                    reverse = {wire: member for member, wire in frequency_members.items()}
                    rows = [row for row in rows if row[field] in reverse]
                    return [{"r_" + dimension: reverse[row[field]]} for row in rows]
                return [{"r_" + dimension: row[field]} for row in rows]
            unit = dimension.rsplit("_", 1)[1]
            return [{"r_" + dimension: bucket(row["ts"], unit)} for row in rows]
        if id.startswith("measure_"):
            measure = id[len("measure_"):]
            entity = next(entity for entity in specs if measure in specs[entity]["measures"])
            return [aggregate(entity, [] if empty else populations[entity])]
        entity = next(entity for entity in specs if id.startswith(entity + "_"))
        suffix = id[len(entity) + 1:].removesuffix("_sample_count")
        rows = [] if empty else populations[entity]
        dim = lambda field: "r_" + entity + "__" + field
        identity = lambda row: {dim(field): row[field] for field in ["resId", "tenantId", "ts"]}
        if suffix.startswith("filter_"):
            field, op = suffix[len("filter_"):].rsplit("_", 1)
            return [identity(row) for row in rows if row[field] is not None and comparisons[op](row[field])]
        if suffix.startswith("frequency_wire_"):
            member, op = suffix[len("frequency_"):].rsplit("_", 1)
            wire = frequency_members[member]
            return [identity(row) for row in rows if row["frequency"] in frequency_members.values() and ((row["frequency"] == wire) if op == "Eq" else (row["frequency"] != wire))]
        if suffix == "name_search":
            return [{dim("resId"): row["resId"]} for row in rows]
        if suffix in ["window", "null_window", "empty_window"]:
            start, end = {"window": ("2024-03-31T00:00:00Z", "2024-04-02T00:00:00Z"),
                "null_window": ("2024-04-02T00:00:00Z", "2024-04-03T00:00:00Z"),
                "empty_window": ("2024-05-01T00:00:00Z", "2024-06-01T00:00:00Z")}[suffix]
            rows = [row for row in rows if start <= row["ts"] < end]
        elif suffix == "explicit_effcnt":
            field = "hwAPUpPortPEREffcnt" if entity.endswith("NetworkAPKPI") else "rssiEffcnt"
            rows = [row for row in rows if row[field] > 0]
        elif suffix == "tenant_filter":
            rows = [row for row in rows if row["tenantId"] == "t1"]
        group_field = {"resource_groups": "resId", "tenant_groups": "tenantId", "frequency_groups": "frequency"}.get(suffix)
        if group_field is not None or suffix in ["hour", "day", "month"]:
            groups = {}
            for row in rows:
                key = row[group_field] if group_field else bucket(row["ts"], suffix)
                if group_field == "frequency":
                    reverse = {wire: member for member, wire in frequency_members.items()}
                    if key not in reverse: continue
                    key = reverse[key]
                groups.setdefault(key, []).append(row)
            column = dim(group_field) if group_field else "r_" + entity + "_utc_" + suffix
            return [{column: key, **aggregate(entity, members)} for key, members in groups.items()]
        assert suffix in ["count", "window", "null_window", "empty_window", "explicit_effcnt", "tenant_filter"], suffix
        return [aggregate(entity, rows)]
    def run(query):
        return sorted(db.execute(query["sql"], {str(i + 1): value for i, value in enumerate(query["bindings"])}).fetchall(), key=repr)
    def verify(case, empty=False):
        actual = run(case["typed"])
        assert actual == run(case["baseline"]), ("empty" if empty else "rows", case["id"], actual, run(case["baseline"]))
        columns = [column["name"] for column in case["columns"]]
        expected_rows = sorted([tuple(row[column] for column in columns) for row in expected(case, empty)], key=repr)
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
print(f"Passed {len(cases)} AP/radio SQLite typed/baseline pairs with independent expectations and empty-table checks; PostgreSQL bindings only")
