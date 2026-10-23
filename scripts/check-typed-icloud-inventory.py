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
    ], capture_output=True, text=True, timeout=240)
    assert result.returncode == 0, (name, result.stdout, result.stderr)
    return json.loads(result.stdout)

fixture = evaluate("runtime_fixture")
cases = fixture["inventory"] + fixture["site"] + fixture["port"] + fixture["kpi"] + fixture["server"] + fixture["server_kpi"] + fixture["components"]
schema = fixture["schema"]
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
        fields = ", ".join(f'"{name}" ' + ("INTEGER" if name in {"createTime", "TENANT_ACCESS_TIME", "CREATE_TIME", "ifMtu", "ifType", "healthStatus", "connectStatus", "serviceDuration", "serviceStartTime", "slotId", "ratedPower", "bitWidth", "frequency", "capacity"} else "REAL" if name == "bandwidth" else "TEXT") for name in columns)
        if table in {"NetworkDeviceInterfaceKPI", "ServerDeviceKPI"}:
            fields = ", ".join(f'"{name}" ' + ("TEXT" if name in {"resId", "tenantId", "ts", "parentId", "projectId", "interfaceName"}
                              else "INTEGER" if "Errors" in name or "Effcnt" in name else "REAL") for name in columns)
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
    port_columns = next(columns for table, columns in schema if table == "I_EnterpriseNetworkLTP")
    for identity, tenant, parent, state, admin, kind, bandwidth, address in [
        ("p1", "t1", "d1", "active", "test", 65635, 1000.75, "192.0.2.1"),
        ("p2", "t2", "d1", "inactive", "active", 2, 1000.5, "192.0.2.255"),
        ("p3", "missing", "missing", "unknown", "inactive", 99999, 0, "2001:db8::1"),
    ]:
        values = {name: f"{identity}_{name}" for name in port_columns}
        values.update(id=identity, tenantId=tenant, refParentNE=parent, name=identity, operState=state,
                      adminState=admin, ifType=kind, bandwidth=bandwidth, ipAddress=address, ifMtu=1500)
        db.execute('INSERT INTO I_EnterpriseNetworkLTP VALUES (' + ','.join('?' for _ in port_columns) + ')', [values[column] for column in port_columns])
    expected.update(port_count=[(3,)], port_up=[("p1",)], port_admin=[("p1",)], port_type=[("p1",)],
                    port_bandwidth=[("p1",)], port_subnet=[("p1",), ("p2",)])
    expected["port_belongs_to_device"] = [("p1", "d1"), ("p2", "d1")]
    expected["source_EntNetworkElement_EnterpriseNetworkLTP"] = expected["port_belongs_to_device"]
    expected["source_EnterpriseNetworkLTP_X_TENANT_VIEW"] = [("p1", "Tenant Alpha"), ("p2", "租户二")]
    kpi_columns = next(columns for table, columns in schema if table == "NetworkDeviceInterfaceKPI")
    for identity, tenant, clock, value in [
        ("p1", "t1", "2024-02-29T23:00:00Z", 10),
        ("p1", "t1", "2024-03-01T00:00:00Z", 30),
        ("p2", "t2", "2024-03-01T01:00:00Z", 20),
        ("missing", "t1", "2024-03-02T00:00:00Z", 100),
    ]:
        values = {name: value for name in kpi_columns}
        values.update(resId=identity, tenantId=tenant, ts=clock, parentId="parent", projectId="s1", interfaceName=identity)
        db.execute('INSERT INTO NetworkDeviceInterfaceKPI VALUES (' + ','.join('?' for _ in kpi_columns) + ')', [values[column] for column in kpi_columns])
    for case in cases:
        if case["id"].startswith("measure_interface"):
            measure = case["id"].removeprefix("measure_")
            expected[case["id"]] = [(100 if measure.endswith("_max") else 10 if measure.endswith("_min") else 40.0,)]
    expected["kpi_window"] = [(25.0,)]
    expected["kpi_day"] = [("2024-02-29T00:00:00Z", 10.0), ("2024-03-01T00:00:00Z", 25.0), ("2024-03-02T00:00:00Z", 100.0)]
    expected["interface_kpi_of_port"] = [("p1", 20.0), ("p2", 20.0)]
    expected["source_EnterpriseNetworkLTP_NetworkDeviceInterfaceKPI"] = expected["interface_kpi_of_port"]
    server_columns = next(columns for table, columns in schema if table == "PhysicalServer")
    for index, (identity, tenant, subnet, project, classification, health, connection, address) in enumerate([
        ("sv1", "t1", "s1", "missing", "ne.category.server.rack", 0, 1, "192.0.2.1"),
        ("sv2", "t2", "missing", "s2", "ne.category.server.edge", -1, 5, "2001:db8::1"),
        ("sv3", "missing", "s1", "s1", "newClass", -2, 4, "192.0.2.255"),
        ("sv4", "t1", "s1", "s2", "ne.category.server.kunlun", 4, 3, "192.0.2.01"),
        ("sv5", "missing", "missing", "missing", "ne.category.server.subrack", 2, 99, "256.0.0.1"),
    ]):
        values = {name: f"{identity}_{name}" for name in server_columns}
        values.update(id=identity, oriResId=f"origin_{identity}", name=identity, tenantId=tenant, refParentSubnet=subnet,
                      projectId=project, classification=classification, healthStatus=health, connectStatus=connection,
                      ipAddress=address, createTime=[-1, 0, 1000, 2000, 3000][index], serviceDuration=100, serviceStartTime=123)
        db.execute('INSERT INTO PhysicalServer VALUES (' + ','.join('?' for _ in server_columns) + ')', [values[column] for column in server_columns])
    expected.update(server_class_filter=[("sv1",)], server_health_filter=[("sv2",)], server_connect_filter=[("sv2",)],
                    server_subnet=[("sv1",), ("sv3",)], server_window=[("sv2",), ("sv3",)])
    expected["server_belongs_to_tenant"] = [("sv1", "Tenant Alpha"), ("sv2", "租户二"), ("sv4", "Tenant Alpha")]
    expected["source_PhysicalServer_X_TENANT_VIEW"] = expected["server_belongs_to_tenant"]
    expected["server_located_at_site"] = [("sv1", "s1"), ("sv2", "s2"), ("sv3", "s1"), ("sv4", "s1"), ("sv4", "s2")]
    expected["source_PhysicalServer_X_SITE_VIEW"] = expected["server_located_at_site"]
    server_kpi_columns = next(columns for table, columns in schema if table == "ServerDeviceKPI")
    for identity, tenant, clock, cpu, memory in [
        ("sv1", "t1", "2024-02-29T23:00:00Z", 10, 20),
        ("sv1", "t1", "2024-03-01T00:00:00Z", 30, 40),
        ("sv1", "t2", "2024-03-01T00:00:00Z", 50, 60),
        ("sv1", "t1", "2024-03-02T00:00:00Z", None, 90),
        ("sv2", "t2", "2024-03-01T01:00:00Z", 70, 80),
        ("sv2", "t2", None, 999, 999),
        ("origin_sv1", "t1", "2024-03-03T00:00:00Z", 100, 110),
    ]:
        values = {name: 1 for name in server_kpi_columns}
        values.update(resId=identity, tenantId=tenant, ts=clock, cpuUsage=cpu, memUsage=memory, parentId=identity, projectId="s1")
        db.execute('INSERT INTO ServerDeviceKPI VALUES (' + ','.join('?' for _ in server_kpi_columns) + ')', [values[column] for column in server_kpi_columns])
    expected.update(measure_server_cpu_usage=[(1259 / 6,)], measure_server_memory_usage=[(1399 / 7,)],
                    measure_server_cpu_peak=[(999,)], measure_server_memory_sample_max=[(999,)],
                    measure_server_cpu_sample_min=[(10,)], measure_server_memory_sample_min=[(20,)],
                    measure_server_cpu_latest=[(100,)], measure_server_memory_latest=[(110,)],
                    server_latest_window=[(70, 80)], server_latest_tie=[(30, 40)])
    expected["server_kpi_of_server"] = [("sv1", 30.0, None, 90), ("sv2", 534.5, 70, 80)]
    expected["source_PhysicalServer_ServerDeviceKPI"] = expected["server_kpi_of_server"]
    for table, prefix in [("PhysicalServerFan", "fan"), ("PhysicalServerPSU", "psu"), ("PhysicalServerMemory", "memory")]:
        component_columns = next(columns for source, columns in schema if source == table)
        for identity, parent, tenant, health, name in [
            ("c1", "origin_sv1", "t1", 1, "repeat"), ("c2", "origin_sv1", "t1", -1, "repeat"),
            ("c3", "sv1", "t2", 0, "wrong_primary"), ("c4", "missing", "missing", -2, "missing"),
        ]:
            values = {column: f"{prefix}_{identity}_{column}" for column in component_columns}
            values.update(id=f"{prefix}_{identity}", parentResId=parent, tenantId=tenant, name=name, healthStatus=health,
                          slotId=1, ratedPower=500, bitWidth=64, frequency=3200, capacity=16384)
            db.execute(f'INSERT INTO "{table}" VALUES (' + ','.join('?' for _ in component_columns) + ')', [values[column] for column in component_columns])
        expected[f"{prefix}_parent_server"] = [("repeat", "sv1"), ("repeat", "sv1")]
        expected[f"source_PhysicalServer_{table}"] = expected[f"{prefix}_parent_server"]
        expected[f"source_{table}_X_TENANT_VIEW"] = [("repeat", "Tenant Alpha"), ("repeat", "Tenant Alpha"), ("wrong_primary", "租户二")]
        if prefix in {"fan", "psu"}:
            expected[f"{prefix}_belongs_to_tenant"] = expected[f"source_{table}_X_TENANT_VIEW"]
    expected.update(fan_health_filter=[("fan_c2",)], psu_health_filter=[("repeat",)], memory_health_filter=[("missing",)],
                    fan_count=[(4,)], fan_count_for_server=[(2,)])
    expected["memory_server_sample_rows"] = [("repeat", "sv1", value) for value in [10, 30, 50, None] for _ in range(2)]
    def execute(query):
        bindings = {str(i + 1): value for i, value in enumerate(query["bindings"])}
        return db.execute(query["sql"], bindings).fetchall()
    for case in cases:
        assert case["columns"] == case["baseline_columns"], case["id"]
        assert case["typed"]["bindings"] == case["postgres"]["bindings"], case["id"]
        try:
            actual = sorted(execute(case["typed"]), key=repr)
            baseline = sorted(execute(case["baseline"]), key=repr)
        except sqlite3.Error as error:
            raise AssertionError((case["id"], str(error))) from error
        assert actual == baseline, (case["id"], actual, baseline, case)
        if case["id"] in expected:
            assert actual == sorted(expected[case["id"]], key=repr), (case["id"], actual)
    for table, _ in schema:
        db.execute(f'DELETE FROM "{table}"')
    for case in cases:
        actual = execute(case["typed"])
        assert actual == execute(case["baseline"]), ("empty", case["id"])
        if case["id"] in {"count", "tenant_count", "port_count", "fan_count", "fan_count_for_server"}:
            assert actual == [(0,)], ("empty count", case["id"], actual)
print(f"Passed {len(cases)} IC typed/baseline SQLite pairs and empty-table checks, including all migrated dimensions, counts, domain filters, IPv4 and all migrated relations")
