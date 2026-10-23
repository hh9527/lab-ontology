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
        f"@test/typed_inventory:{name}", "--initialization-fuel", "200000",
        "--request-fuel", "100000", "--with-memory-limit", "2048",
    ], capture_output=True, text=True, timeout=240)
    assert result.returncode == 0, (name, result.stdout, result.stderr)
    return json.loads(result.stdout)

fixture = evaluate("runtime_fixture")
cases = fixture["inventory"] + fixture["site"] + fixture["port"] + fixture["kpi"] + fixture["server"] + fixture["server_kpi"] + fixture["components"] + fixture["storage"] + fixture["hardware"] + fixture["pon"]
# 多个角色可共享一张表，按物理列并集合并，不能重复建表或重复装载。
schema_by_table = {}
for table, columns in fixture["schema"]:
    merged = schema_by_table.setdefault(table, [])
    merged.extend(column for column in columns if column not in merged)
schema = list(schema_by_table.items())
affinities = {}
for table, columns in fixture["affinities"]:
    merged = affinities.setdefault(table, {})
    for column, affinity in columns:
        assert column not in merged or merged[column] == affinity, (table, column, "conflicting role storage")
        merged[column] = affinity
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
        fields = ", ".join(f'"{name}" {affinities[table][name]}' for name in columns)
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
    storage_columns = next(columns for table, columns in schema if table == "HuaweiStorageDevice")
    for identity, tenant, parent, project, name, running, subclass, power, category, kind, health, connection, fraction, total, free, address, clock in [
        ("st1", "t1", "s1", "missing", "same", "1", "EnterpriseStorage", "poweron", "HuaweiStorage", "storage", "1", 1, 0.2, 100.5, 80.4, "192.0.2.1", -1),
        ("st2", "t2", "missing", "s2", "same", "3", "FCSwitchDevice", "poweroff", "FcSwitch", "fcswitch", "2", 9, 0.5, 200.25, 100.125, "2001:db8::1", 0),
        ("st3", "t1", "s1", "s1", None, "12", "SmisStorageDevice", "poweron", "ThirdPartyStorage", "storage", "1", 0, 1.1, 300, 0, "192.0.2.255", 1000),
        ("st4", "missing", "s1", "s2", "", "99", "unknown", "unknown", "unknown", "unknown", "unknown", 99, 0, 0, 0, "192.0.2.01", 2000),
    ]:
        values = {column: f"{identity}_{column}" for column in storage_columns}
        values.update(id=identity, tenantId=tenant, parentResId=parent, projectId=project, name=name, runningStatus=running,
                      subClassName=subclass, powerStatus=power, classification=category, deviceType=kind, healthStatus=health,
                      connectStatus=connection, usedCapacityRate=fraction, totalStoragePoolCapacity=total, unUsedCapacity=free,
                      usedCapacity=20, totalCapacity=100, ipAddress=address, createTime=clock)
        db.execute('INSERT INTO HuaweiStorageDevice VALUES (' + ','.join('?' for _ in storage_columns) + ')', [values[column] for column in storage_columns])
    expected.update(storage_counts=[(4, 3)], storage_distinct_names=[(2,)], storage_fraction=[("st2",), ("st3",)],
                    storage_capacity=[("st2",), ("st3",)], storage_subnet=[("st1",), ("st3",)], storage_window=[("st2",), ("st3",)])
    for dimension, identities in {
        "storage_running_status": ["st1"], "storage_device_subclass": ["st2"], "storage_device__powerStatus": ["st1", "st3"],
        "storage_device__classification": ["st1"], "storage_device__deviceType": ["st2"], "storage_device__healthStatus": ["st2"],
        "storage_device__connectStatus": ["st2"],
    }.items():
        expected[f"filter_{dimension}"] = [(identity,) for identity in identities]
    expected["storage_device_belongs_to_tenant"] = [("st1", "Tenant Alpha"), ("st2", "租户二"), ("st3", "Tenant Alpha")]
    expected["source_HuaweiStorageDeviceAssociationX_TENANT_VIEW"] = expected["storage_device_belongs_to_tenant"]
    expected["storage_device_site"] = [("st1", "s1"), ("st2", "s2"), ("st3", "s1"), ("st4", "s1"), ("st4", "s2")]
    expected["source_HuaweiStorageDeviceAssociationX_SITE_VIEW"] = expected["storage_device_site"]
    frame_columns = next(columns for table, columns in schema if table == "I_EnterpriseFrame")
    for name, dn, device, tenant, state in [
        ("f1", "dn1", "d1", "t1", 3), ("f2", "dn2", "d2", "t2", 16),
        ("f3", None, None, None, None), ("f4", "dn4", "missing", "missing", 12),
        ("f5", "dn5", "d1", "t1", 4),
    ]:
        values = {column: None for column in frame_columns}
        values.update(name=name, frameDn=dn, refParentNE=device, tenantId=tenant, operState=state, adminState=1)
        db.execute('INSERT INTO I_EnterpriseFrame VALUES (' + ','.join('?' for _ in frame_columns) + ')', [values[column] for column in frame_columns])
    slot_columns = next(columns for table, columns in schema if table == "I_EnterpriseSlot")
    for identity, dn, tenant, daughter in [("sl1", "dn1", "t1", True), ("sl2", "dn1", "t2", False), ("sl3", "missing", "missing", False)]:
        values = {column: identity for column in slot_columns}
        values.update(id=identity, name=identity, frameNativeId=dn, tenantId=tenant, isDaughterCard=daughter, operstatus=3, adminstatus=1)
        db.execute('INSERT INTO I_EnterpriseSlot VALUES (' + ','.join('?' for _ in slot_columns) + ')', [values[column] for column in slot_columns])
    expected.update(frame_normal_Eq=[("f1",), ("f2",)], frame_normal_Ne=[("f4",), ("f5",)], frame_error_Eq=[("f4",)],
                    slot_daughter=[("sl1",)], slot_main=[("sl2",), ("sl3",)], slot_count=[(3,)])
    expected["frame_belongs_to_device"] = [("f1", "d1"), ("f2", "d2"), ("f5", "d1")]
    expected["source_EntNetworkElement_EnterpriseFrame"] = expected["frame_belongs_to_device"]
    expected["source_EnterpriseFrame_X_TENANT_VIEW"] = [("f1", "Tenant Alpha"), ("f2", "租户二"), ("f5", "Tenant Alpha")]
    expected["source_EnterpriseFrame_EnterpriseSlot"] = [("sl1", "f1"), ("sl2", "f1")]
    expected["source_EnterpriseSlot_X_TENANT_VIEW"] = [("sl1", "Tenant Alpha"), ("sl2", "租户二")]
    pon_columns = next(columns for table, columns in schema if table == "I_EntPonElement")
    pon_rows = [
        ("o1", "ne.category.olt", "", "t1", "s1", "missing", "1", "192.0.2.1", "2024-02-29"),
        ("o2", "ne.category.olt", "", "t2", "missing", "s2", "0", "192.0.2.2", "2024-03-01"),
        ("n1", "ne.category.pon.onu", "o1", "t1", "s1", "s1", "2", "192.0.2.3", "2024-03-02"),
        ("n2", "ne.category.pon.onu", "n1", "t2", "s1", "s2", "3", "2001:db8::1", "2024-02-28"),
        ("n3", "ne.category.pon.spl", "o1", "missing", "missing", "missing", "4", "192.0.2.5", "2024-02-29"),
        ("n4", "onu", "o1", "missing", "missing", "missing", "14", "192.0.2.6", "2024-02-29"),
        ("n5", "ne.category.pon.onu", "missing", "t1", "missing", "missing", "15", "192.0.2.7", "2024-02-29"),
        ("n6", "ne.category.pon.onu", "o2", "t2", "missing", "missing", "1", "192.0.2.8", "2024-02-29"),
    ]
    for index, (identity, classification, parent, tenant, subnet, project, state, address, date) in enumerate(pon_rows):
        values = {column: identity for column in pon_columns}
        values.update(id=identity, name=identity, classification=classification, parentOltResId=parent, tenantId=tenant,
                      refParentSubnet=subnet, projectId=project, commuState=state, ipAddress=address,
                      manufactureDate=date, createTime=index * 1000 - 1, adminState="Enabled" if index == 0 else "Disabled")
        db.execute('INSERT INTO I_EntPonElement VALUES (' + ','.join('?' for _ in pon_columns) + ')', [values[column] for column in pon_columns])
    expected.update(count_pon_device=[(8,)], count_pon_onu_role=[(4,)], count_pon_olt_role=[(2,)],
                    pon_onu_filter=[("n1",), ("n2",), ("n5",), ("n6",)],
                    pon_offline=[("o2",), ("n1",), ("n2",), ("n3",), ("n4",), ("n5",)],
                    pon_admin=[("o1",)], pon_manufactured=[("o2",), ("n1",)],
                    onu_scope_contradiction=[], olt_scope_wrong_id=[], onu_subnet=[("n1",), ("n5",), ("n6",)])
    expected["pon_onu_parent_olt"] = [("n1", "o1"), ("n6", "o2")]
    expected["source_EntPonElementAssociationEntPonElement"] = [("n1", "o1"), ("n2", "n1"), ("n3", "o1"), ("n4", "o1"), ("n6", "o2")]
    expected["source_EntPonElementAssociationX_TENANT_VIEW"] = [(identity, "Tenant Alpha" if tenant == "t1" else "租户二") for identity, _, _, tenant, *_ in pon_rows if tenant != "missing"]
    expected["source_EntPonElementAssociationX_SITE_VIEW"] = [("o1", "s1"), ("o2", "s2"), ("n1", "s1"), ("n2", "s1"), ("n2", "s2")]
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
        if case["id"] == "storage_counts":
            assert actual == [(0, 0)], ("empty storage counts", actual)
        if case["id"] == "storage_distinct_names":
            assert actual == [(0,)], ("empty distinct names", actual)
        if case["id"] in {"count", "tenant_count", "port_count", "fan_count", "fan_count_for_server", "slot_count", "count_pon_device", "count_pon_onu_role", "count_pon_olt_role"}:
            assert actual == [(0,)], ("empty count", case["id"], actual)
print(f"Passed {len(cases)} IC typed/baseline SQLite pairs and empty-table checks, including all public migrated dimension projections, counts, domain filters, IPv4 and all migrated relations")
