#!/usr/bin/env bash
set -euo pipefail

fixture_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
telora_bin="${fixture_dir}/../../telora/target/release/telora"
schema="CREATE TABLE I_EntNetworkElement (id TEXT, tenant_id TEXT, name TEXT);
CREATE TABLE NetworkDeviceKPI (resId TEXT, tenantId TEXT, ts TEXT, cpuUsage REAL, portCount INTEGER);
CREATE TABLE I_EnterpriseFrame (id TEXT, refParentNE TEXT, tenantId TEXT, name TEXT, operState INTEGER);
INSERT INTO I_EntNetworkElement VALUES ('A','red','A-red'),('A','blue','A-blue'),('B','red','B-red'),('C','red','B-red');
INSERT INTO NetworkDeviceKPI VALUES
 ('A','red','2024-02-05T00:00:00Z',50,0),('A','red','2024-02-06T00:00:00Z',50,0),
 ('A','blue','2024-02-15T00:00:00Z',10,3),('A','blue','2024-02-16T00:00:00Z',10,3),('A','blue','2024-02-17T00:00:00Z',10,3),
 ('B','red','2024-01-31T00:00:00Z',NULL,91),
 ('B','red','2024-02-05T00:00:00Z',50,92),('B','red','2024-02-06T00:00:00Z',50,93),
 ('B','red','2024-02-15T00:00:00Z',NULL,3),('B','red','2024-02-16T00:00:00Z',NULL,3),
 ('B','red','2024-02-20T00:00:00Z',NULL,50),
 ('C','red','2024-02-10T00:00:00Z',0,1);
INSERT INTO I_EnterpriseFrame VALUES
 ('B-frame-1','B','red','Duplicate',3),('B-frame-2','B','red','Duplicate',11),('A-frame','A','red','Other',2);
ALTER TABLE I_EntNetworkElement ADD COLUMN createTime INTEGER;
UPDATE I_EntNetworkElement SET createTime = 1718467200500 WHERE id = 'B' AND tenant_id = 'red';
UPDATE I_EntNetworkElement SET createTime = 1718467201000 WHERE id = 'A';
ALTER TABLE I_EntNetworkElement ADD COLUMN mac TEXT;
ALTER TABLE I_EntNetworkElement ADD COLUMN classification TEXT;
ALTER TABLE I_EntNetworkElement ADD COLUMN manufacturer TEXT;
ALTER TABLE I_EntNetworkElement ADD COLUMN projectId TEXT;
ALTER TABLE I_EntNetworkElement ADD COLUMN refParentSubnet TEXT;
UPDATE I_EntNetworkElement SET mac = '00:1A:2B:00:00:00', classification = 'LSW', manufacturer = '2011', projectId = 'S1', refParentSubnet = 'S2' WHERE id = 'B';
UPDATE I_EntNetworkElement SET mac = '00:1A:2B:00:00:00', classification = 'LSW', manufacturer = '2011', projectId = 'S3', refParentSubnet = 'S4' WHERE id = 'C';
CREATE TABLE I_EnterpriseNetworkLTP (id TEXT, tenantId TEXT, refParentNE TEXT, name TEXT);
CREATE TABLE NetworkDeviceInterfaceKPI (resId TEXT, tenantId TEXT, ts TEXT, ifOutPktSpeed REAL);
CREATE TABLE X_SITE_VIEW (SITE_ID TEXT, SITE_NAME TEXT, TENANT_ID TEXT);
CREATE TABLE X_TENANT_VIEW (TENANT_ID TEXT, TENANT_NAME TEXT);
INSERT INTO I_EnterpriseNetworkLTP VALUES ('P-B','red','B','SamePort'),('P-C','red','C','SamePort');
INSERT INTO NetworkDeviceInterfaceKPI VALUES
 ('P-B','red','2024-02-01T00:00:00Z',9),('P-B','red','2024-02-02T00:00:00Z',8),
 ('P-B','red','2024-02-03T00:00:00Z',7),('P-B','red','2024-02-04T00:00:00Z',6),
 ('P-C','red','2024-02-05T00:00:00Z',100);
INSERT INTO X_TENANT_VIEW VALUES ('TA','Tenant-A'),('TB','Tenant-B');
INSERT INTO X_SITE_VIEW VALUES
 ('S1','Site-A','TA'),('S2','Site-A','TA'),
 ('S3','Site-A','TB'),('S4','Site-Other','TA');"

created_plan="$("${telora_bin}" -C "${fixture_dir}" eval icloud-model/sample_execution:created_in_local_second)"
jq -e '.bindings == [1718467200000,1718467201000]' <<< "${created_plan}" >/dev/null
created_sql="$(jq -r '.sql' <<< "${created_plan}")"
created_result="$(sqlite3 -json :memory: -cmd "${schema}" -cmd '.parameter init' \
    -cmd '.parameter set ?1 1718467200000' -cmd '.parameter set ?2 1718467201000' "${created_sql}")"
jq -e 'length == 1 and .[0].name == "B-red"' <<< "${created_result}" >/dev/null

top_plan="$("${telora_bin}" -C "${fixture_dir}" eval icloud-model/sample_execution:device_sample_top)"
jq -e '.bindings == ["2024-02-01T00:00:00Z","2024-03-01T00:00:00Z",3]' <<< "${top_plan}" >/dev/null
top_sql="$(jq -r '.sql' <<< "${top_plan}")"
top_result="$(sqlite3 -json :memory: -cmd "${schema}" -cmd '.parameter init' \
    -cmd ".parameter set ?1 '2024-02-01T00:00:00Z'" \
    -cmd ".parameter set ?2 '2024-03-01T00:00:00Z'" \
    -cmd '.parameter set ?3 3' "${top_sql}")"
jq -e 'length == 9
    and ([.[] | select(."__q_0" == "B-red") | ."__q_1"] | sort == [1,50,92,93])
    and ([.[] | select(."__q_0" == "A-blue") | ."__q_2"] == ["2024-02-15T00:00:00Z","2024-02-16T00:00:00Z","2024-02-17T00:00:00Z"])' <<< "${top_result}" >/dev/null

interface_plan="$("${telora_bin}" -C "${fixture_dir}" eval icloud-model/sample_execution:interface_sample_top)"
jq -e '.bindings == ["2024-02-01T00:00:00Z","2024-03-01T00:00:00Z","00:1A:2B:00:00:00","ne.category.switch","LSW","2011","Huawei","huawei technologies co., ltd","Site-A","Tenant-A",3]' <<< "${interface_plan}" >/dev/null
interface_sql="$(jq -r '.sql' <<< "${interface_plan}")"
interface_result="$(sqlite3 -json :memory: -cmd "${schema}" -cmd '.parameter init' \
    -cmd ".parameter set ?1 '2024-02-01T00:00:00Z'" -cmd ".parameter set ?2 '2024-03-01T00:00:00Z'" \
    -cmd ".parameter set ?3 '00:1A:2B:00:00:00'" -cmd ".parameter set ?4 'ne.category.switch'" \
    -cmd ".parameter set ?5 'LSW'" -cmd ".parameter set ?6 '2011'" \
    -cmd ".parameter set ?7 'Huawei'" -cmd ".parameter set ?8 'huawei technologies co., ltd'" \
    -cmd ".parameter set ?9 'Site-A'" -cmd ".parameter set ?10 'Tenant-A'" \
    -cmd '.parameter set ?11 3' "${interface_sql}")"
jq -e 'length == 3 and (map(."__q_2") == [9,8,7])
    and all(.[]; ."__q_0" == "B-red" and ."__q_1" == "SamePort")' <<< "${interface_result}" >/dev/null

count_plan="$("${telora_bin}" -C "${fixture_dir}" eval icloud-model/sample_execution:qualified_count)"
jq -e '.bindings == ["2024-02-01T00:00:00Z","2024-03-01T00:00:00Z",40,"2024-02-10T00:00:00Z","2024-03-01T00:00:00Z",8]' <<< "${count_plan}" >/dev/null
count_sql="$(jq -r '.sql' <<< "${count_plan}")"
count_result="$(sqlite3 -json :memory: -cmd "${schema}" -cmd '.parameter init' \
    -cmd ".parameter set ?1 '2024-02-01T00:00:00Z'" \
    -cmd ".parameter set ?2 '2024-03-01T00:00:00Z'" \
    -cmd '.parameter set ?3 40' \
    -cmd ".parameter set ?4 '2024-02-10T00:00:00Z'" \
    -cmd ".parameter set ?5 '2024-03-01T00:00:00Z'" \
    -cmd '.parameter set ?6 8' "${count_sql}")"
jq -e 'length == 1 and .[0].device_count == 1' <<< "${count_result}" >/dev/null

observation_plan="$("${telora_bin}" -C "${fixture_dir}" eval icloud-model/sample_execution:qualified_observation)"
jq -e '.bindings == ["2024-02-01T00:00:00Z","2024-03-01T00:00:00Z","2024-01-31T00:00:00Z","2024-03-01T00:00:00Z",90,3,1000]' <<< "${observation_plan}" >/dev/null
observation_sql="$(jq -r '.sql' <<< "${observation_plan}")"
observation_result="$(sqlite3 -json :memory: -cmd "${schema}" -cmd '.parameter init' \
    -cmd ".parameter set ?1 '2024-02-01T00:00:00Z'" \
    -cmd ".parameter set ?2 '2024-03-01T00:00:00Z'" \
    -cmd ".parameter set ?3 '2024-01-31T00:00:00Z'" \
    -cmd ".parameter set ?4 '2024-03-01T00:00:00Z'" \
    -cmd '.parameter set ?5 90' \
    -cmd '.parameter set ?6 3' \
    -cmd '.parameter set ?7 1000' "${observation_sql}")"
jq -e 'length == 5 and all(.[]; .name == "B-red" and .ts >= "2024-02-01T00:00:00Z" and .ts < "2024-03-01T00:00:00Z") and (map(.portCount) == [92,93,3,3,50])' <<< "${observation_result}" >/dev/null

grouped_plan="$("${telora_bin}" -C "${fixture_dir}" eval icloud-model/sample_execution:grouped_observation)"
jq -e '.bindings == ["2024-02-01T00:00:00Z","2024-03-01T00:00:00Z","2024-02-01T00:00:00Z","2024-03-01T00:00:00Z",0,1]' <<< "${grouped_plan}" >/dev/null
grouped_sql="$(jq -r '.sql' <<< "${grouped_plan}")"
grouped_result="$(sqlite3 -json :memory: -cmd "${schema}" -cmd '.parameter init' \
    -cmd ".parameter set ?1 '2024-02-01T00:00:00Z'" \
    -cmd ".parameter set ?2 '2024-03-01T00:00:00Z'" \
    -cmd ".parameter set ?3 '2024-02-01T00:00:00Z'" \
    -cmd ".parameter set ?4 '2024-03-01T00:00:00Z'" \
    -cmd '.parameter set ?5 0' \
    -cmd '.parameter set ?6 1' "${grouped_sql}")"
jq -e 'length == 3 and ([.[] | select(.name == "B-red") | .port_count] | sort == [1,241]) and ([.[] | select(.name == "A-blue") | .port_count] == [9])' <<< "${grouped_result}" >/dev/null

peak_plan="$("${telora_bin}" -C "${fixture_dir}" eval icloud-model/sample_execution:sample_peak)"
jq -e '.bindings == ["2024-02-01T00:00:00Z","2024-03-01T00:00:00Z","2024-01-31T00:00:00Z","2024-03-01T00:00:00Z",90,3]' <<< "${peak_plan}" >/dev/null
peak_sql="$(jq -r '.sql' <<< "${peak_plan}")"
peak_result="$(sqlite3 -json :memory: -cmd "${schema}" -cmd '.parameter init' \
    -cmd ".parameter set ?1 '2024-02-01T00:00:00Z'" \
    -cmd ".parameter set ?2 '2024-03-01T00:00:00Z'" \
    -cmd ".parameter set ?3 '2024-01-31T00:00:00Z'" \
    -cmd ".parameter set ?4 '2024-03-01T00:00:00Z'" \
    -cmd '.parameter set ?5 90' -cmd '.parameter set ?6 3' "${peak_sql}")"
jq -e 'length == 1 and .[0].name == "B-red" and .[0].port_count == 241 and .[0].port_count_peak == 93' <<< "${peak_result}" >/dev/null

component_plan="$("${telora_bin}" -C "${fixture_dir}" eval icloud-model/sample_execution:component_observation)"
jq -e '.bindings == ["2024-02-01T00:00:00Z","2024-03-01T00:00:00Z",3,11,13,15,16,2]' <<< "${component_plan}" >/dev/null
component_sql="$(jq -r '.sql' <<< "${component_plan}")"
component_result="$(sqlite3 -json :memory: -cmd "${schema}" -cmd '.parameter init' \
    -cmd ".parameter set ?1 '2024-02-01T00:00:00Z'" \
    -cmd ".parameter set ?2 '2024-03-01T00:00:00Z'" \
    -cmd '.parameter set ?3 3' -cmd '.parameter set ?4 11' \
    -cmd '.parameter set ?5 13' -cmd '.parameter set ?6 15' \
    -cmd '.parameter set ?7 16' -cmd '.parameter set ?8 2' "${component_sql}")"
jq -e 'length == 2 and (map(.portCount) == [93,92]) and all(.[]; .name == "B-red")' <<< "${component_result}" >/dev/null

trend_plan="$("${telora_bin}" -C "${fixture_dir}" eval icloud-model/sample_execution:contextual_trend)"
jq -e '.bindings == ["2024-02-01T00:00:00Z","2024-03-01T00:00:00Z",3,11,13,15,16]' <<< "${trend_plan}" >/dev/null
trend_sql="$(jq -r '.sql' <<< "${trend_plan}")"
trend_result="$(sqlite3 -json :memory: -cmd "${schema}" -cmd '.parameter init' \
    -cmd ".parameter set ?1 '2024-02-01T00:00:00Z'" \
    -cmd ".parameter set ?2 '2024-03-01T00:00:00Z'" \
    -cmd '.parameter set ?3 3' -cmd '.parameter set ?4 11' \
    -cmd '.parameter set ?5 13' -cmd '.parameter set ?6 15' \
    -cmd '.parameter set ?7 16' "${trend_sql}")"
jq -e 'length == 10 and (map(.portCount) == [92,92,93,93,3,3,3,3,50,50]) and all(.[]; .name == "B-red" and .frame_name == "Duplicate") and ([.[] | select(.frame_id == "B-frame-1")] | length == 5) and ([.[] | select(.frame_id == "B-frame-2")] | length == 5)' <<< "${trend_result}" >/dev/null

context_plan="$("${telora_bin}" -C "${fixture_dir}" eval icloud-model/sample_execution:contextual_group)"
jq -e '.bindings == ["2024-02-01T00:00:00Z","2024-03-01T00:00:00Z",3,11,13,15,16]' <<< "${context_plan}" >/dev/null
context_sql="$(jq -r '.sql' <<< "${context_plan}")"
context_result="$(sqlite3 -json :memory: -cmd "${schema}" -cmd '.parameter init' \
    -cmd ".parameter set ?1 '2024-02-01T00:00:00Z'" \
    -cmd ".parameter set ?2 '2024-03-01T00:00:00Z'" \
    -cmd '.parameter set ?3 3' -cmd '.parameter set ?4 11' \
    -cmd '.parameter set ?5 13' -cmd '.parameter set ?6 15' \
    -cmd '.parameter set ?7 16' "${context_sql}")"
jq -e 'length == 2 and all(.[]; .name == "B-red" and .frame_name == "Duplicate" and .port_count == 241)' <<< "${context_result}" >/dev/null

printf 'local epoch-ms filter, owner-scoped sample tops, metric count, qualified observation, sample peak, and component filter/context execute correctly\n'
