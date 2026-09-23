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
 ('S3','Site-A','TB'),('S4','Site-Other','TA');
CREATE TABLE T_CURRENT_ALARM (CSN INTEGER, MEDN TEXT, TENANT_ID TEXT, SEVERITY TEXT);
INSERT INTO T_CURRENT_ALARM VALUES
 (1,'B','red','1'),(2,'B','red','1'),(3,'B','red','1'),
 (4,'A','red','1'),(5,'A','red','1'),(6,'A','blue','1'),
 (7,'C','red','2'),(8,'C','red','2'),(9,'C','red','2');"

interface_qualification_schema="${schema}
ALTER TABLE NetworkDeviceInterfaceKPI ADD COLUMN ifOutErrors INTEGER;
UPDATE NetworkDeviceInterfaceKPI SET ifOutErrors = 40 WHERE resId = 'P-B' AND ts = '2024-02-01T00:00:00Z';
UPDATE NetworkDeviceInterfaceKPI SET ifOutErrors = 100 WHERE resId = 'P-B' AND ts = '2024-02-02T00:00:00Z';
UPDATE NetworkDeviceInterfaceKPI SET ifOutErrors = 60 WHERE resId = 'P-B' AND ts >= '2024-02-03T00:00:00Z';
UPDATE NetworkDeviceInterfaceKPI SET ifOutErrors = 10 WHERE resId = 'P-C';
INSERT INTO I_EnterpriseNetworkLTP VALUES ('P-E','red','B','ExtraPort'),('P-EMPTY','red','B','EmptyPort');
INSERT INTO NetworkDeviceInterfaceKPI (resId,tenantId,ts,ifOutErrors) VALUES
 ('P-E','red','2024-02-07T00:00:00Z',140),('P-E','red','2024-02-08T00:00:00Z',20);"

site_alarm_schema="${schema}
ALTER TABLE T_CURRENT_ALARM ADD COLUMN ALARMNAME TEXT;
UPDATE T_CURRENT_ALARM SET ALARMNAME = 'linkDown' WHERE CSN IN (1,2,7);
UPDATE T_CURRENT_ALARM SET ALARMNAME = 'deviceOffline' WHERE CSN = 3;
UPDATE T_CURRENT_ALARM SET ALARMNAME = 'highCpuUsage' WHERE CSN = 6;
UPDATE T_CURRENT_ALARM SET ALARMNAME = 'other' WHERE ALARMNAME IS NULL;
INSERT INTO I_EntNetworkElement (id,tenant_id,name,classification,projectId,refParentSubnet)
 VALUES ('D','red','NoOwnAlarm','LSW','S1','S2');
INSERT INTO T_CURRENT_ALARM (CSN,MEDN,TENANT_ID,SEVERITY,ALARMNAME)
 VALUES (10,'D','blue','1','linkDown');"
site_alarm_plan="$("${telora_bin}" -C "${fixture_dir}" eval icloud-model/sample_execution:site_alarm_count)"
jq -e '.bindings == ["ne.category.switch","LSW","linkDown","deviceOffline","highCpuUsage","Site-A","Tenant-A"]' <<< "${site_alarm_plan}" >/dev/null
site_alarm_sql="$(jq -r '.sql' <<< "${site_alarm_plan}")"
site_alarm_result="$(sqlite3 -json :memory: -cmd "${site_alarm_schema}" -cmd '.parameter init' \
    -cmd ".parameter set ?1 'ne.category.switch'" -cmd ".parameter set ?2 'LSW'" \
    -cmd ".parameter set ?3 'linkDown'" -cmd ".parameter set ?4 'deviceOffline'" \
    -cmd ".parameter set ?5 'highCpuUsage'" -cmd ".parameter set ?6 'Site-A'" \
    -cmd ".parameter set ?7 'Tenant-A'" "${site_alarm_sql}")"
jq -e 'length == 1 and .[0].device_count == 1' <<< "${site_alarm_result}" >/dev/null

qualified_interface_plan="$("${telora_bin}" -C "${fixture_dir}" eval icloud-model/sample_execution:qualified_interface_count)"
qualified_interface_sql="$(jq -r '.sql' <<< "${qualified_interface_plan}")"
qualified_interface_result="$(sqlite3 -json :memory: -cmd "${interface_qualification_schema}" -cmd '.parameter init' \
    -cmd ".parameter set ?1 'LSW'" -cmd ".parameter set ?2 'ne.category.switch'" \
    -cmd ".parameter set ?3 'Site-A'" -cmd ".parameter set ?4 'Tenant-A'" \
    -cmd ".parameter set ?5 '2024-02-01T00:00:00Z'" -cmd ".parameter set ?6 '2024-03-01T00:00:00Z'" \
    -cmd '.parameter set ?7 72' "${qualified_interface_sql}")"
jq -e 'length == 1 and .[0].interface_count == 1' <<< "${qualified_interface_result}" >/dev/null

qualified_raw_plan="$("${telora_bin}" -C "${fixture_dir}" eval icloud-model/sample_execution:qualified_interface_raw_avg)"
qualified_raw_sql="$(jq -r '.sql' <<< "${qualified_raw_plan}")"
qualified_raw_result="$(sqlite3 -json :memory: -cmd "${interface_qualification_schema}" -cmd '.parameter init' \
    -cmd ".parameter set ?1 'Site-A'" -cmd ".parameter set ?2 'Tenant-A'" \
    -cmd ".parameter set ?3 '2024-02-01T00:00:00Z'" -cmd ".parameter set ?4 '2024-03-01T00:00:00Z'" \
    -cmd '.parameter set ?5 58' -cmd '.parameter set ?6 58' "${qualified_raw_sql}")"
jq -e 'map(.name) | sort == ["ExtraPort","SamePort"]' <<< "${qualified_raw_result}" >/dev/null

average_schema="CREATE TABLE I_EntNetworkElement (id TEXT, tenant_id TEXT, classification TEXT);
CREATE TABLE NetworkDeviceKPI (resId TEXT, tenantId TEXT, ts TEXT, memUsage REAL, portCount INTEGER, portUsedCount INTEGER, operStatusCount INTEGER);
INSERT INTO I_EntNetworkElement VALUES
 ('R1','red','AR'),('R1','blue','ne.category.router'),('R2','red','AR'),('R3','red','AR'),
 ('F1','red','FW'),('F2','red','FW'),('F3','red','FW');
INSERT INTO NetworkDeviceKPI VALUES
 ('R1','red','2024-02-26T00:00:00Z',50,50,NULL,NULL),
 ('R1','red','2024-02-27T00:00:00Z',50,50,NULL,NULL),
 ('R1','blue','2024-02-26T00:00:00Z',80,1,NULL,NULL),
 ('R2','red','2024-02-26T00:00:00Z',50,1,NULL,NULL),
 ('R3','red','2024-02-26T00:00:00Z',NULL,60,NULL,NULL),
 ('F1','red','2024-02-26T00:00:00Z',NULL,NULL,25,2),
 ('F1','red','2024-02-27T00:00:00Z',NULL,NULL,25,2),
 ('F2','red','2024-02-26T00:00:00Z',NULL,NULL,25,0),
 ('F3','red','2024-02-26T00:00:00Z',NULL,NULL,NULL,2);"
for average_case in qualified_router_average_count qualified_firewall_average_count; do
    average_plan="$("${telora_bin}" -C "${fixture_dir}" eval "icloud-model/sample_execution:${average_case}")"
    average_sql="$(jq -r '.sql' <<< "${average_plan}")"
    if [[ "${average_case}" == qualified_router_average_count ]]; then
        jq -e '.bindings == ["ne.category.router","AR","2024-02-26T00:00:00Z","2024-02-29T00:00:00Z",47.5,"2024-02-26T00:00:00Z","2024-02-29T00:00:00Z",48]' <<< "${average_plan}" >/dev/null
        class_1='ne.category.router'; class_2='AR'; first_threshold=47.5; second_threshold=48
    else
        jq -e '.bindings == ["ne.category.firewall","FW","2024-02-26T00:00:00Z","2024-02-29T00:00:00Z",24,"2024-02-26T00:00:00Z","2024-02-29T00:00:00Z",1]' <<< "${average_plan}" >/dev/null
        class_1='ne.category.firewall'; class_2='FW'; first_threshold=24; second_threshold=1
    fi
    average_result="$(sqlite3 -json :memory: -cmd "${average_schema}" -cmd '.parameter init' \
        -cmd ".parameter set ?1 '${class_1}'" -cmd ".parameter set ?2 '${class_2}'" \
        -cmd ".parameter set ?3 '2024-02-26T00:00:00Z'" -cmd ".parameter set ?4 '2024-02-29T00:00:00Z'" \
        -cmd ".parameter set ?5 ${first_threshold}" \
        -cmd ".parameter set ?6 '2024-02-26T00:00:00Z'" -cmd ".parameter set ?7 '2024-02-29T00:00:00Z'" \
        -cmd ".parameter set ?8 ${second_threshold}" "${average_sql}")"
    jq -e 'length == 1 and .[0].device_count == 1' <<< "${average_result}" >/dev/null
done

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

alarm_plan="$("${telora_bin}" -C "${fixture_dir}" eval icloud-model/sample_execution:alarm_qualified_peak)"
jq -e '.bindings == ["2024-02-01T00:00:00Z","2024-03-01T00:00:00Z","1",3]' <<< "${alarm_plan}" >/dev/null
alarm_sql="$(jq -r '.sql' <<< "${alarm_plan}")"
alarm_result="$(sqlite3 -json :memory: -cmd "${schema}" -cmd '.parameter init' \
    -cmd ".parameter set ?1 '2024-02-01T00:00:00Z'" \
    -cmd ".parameter set ?2 '2024-03-01T00:00:00Z'" \
    -cmd ".parameter set ?3 '1'" -cmd '.parameter set ?4 3' "${alarm_sql}")"
jq -e 'length == 1 and .[0].name == "B-red" and .[0].cpu_peak == 50' <<< "${alarm_result}" >/dev/null

range_schema="CREATE TABLE I_EntNetworkElement (id TEXT, tenant_id TEXT, name TEXT);
CREATE TABLE NetworkDeviceKPI (resId TEXT, tenantId TEXT, ts TEXT, portCount INTEGER);
INSERT INTO I_EntNetworkElement VALUES ('D0','red','Zero'),('D1','red','One'),('D1','blue','Four'),('D5','red','Five');
INSERT INTO NetworkDeviceKPI VALUES
 ('D1','red','2024-02-01T00:00:00Z',91),
 ('D1','blue','2024-02-01T00:00:00Z',91),('D1','blue','2024-02-02T00:00:00Z',92),
 ('D1','blue','2024-02-03T00:00:00Z',93),('D1','blue','2024-02-04T00:00:00Z',94),
 ('D5','red','2024-02-01T00:00:00Z',91),('D5','red','2024-02-02T00:00:00Z',92),
 ('D5','red','2024-02-03T00:00:00Z',93),('D5','red','2024-02-04T00:00:00Z',94),
 ('D5','red','2024-02-05T00:00:00Z',95);"
zero_plan="$("${telora_bin}" -C "${fixture_dir}" eval icloud-model/sample_execution:zero_to_four_samples)"
jq -e '.bindings == ["2024-02-01T00:00:00Z","2024-03-01T00:00:00Z",90,4]' <<< "${zero_plan}" >/dev/null
zero_sql="$(jq -r '.sql' <<< "${zero_plan}")"
zero_result="$(sqlite3 -json :memory: -cmd "${range_schema}" -cmd '.parameter init' \
    -cmd ".parameter set ?1 '2024-02-01T00:00:00Z'" -cmd ".parameter set ?2 '2024-03-01T00:00:00Z'" \
    -cmd '.parameter set ?3 90' -cmd '.parameter set ?4 4' "${zero_sql}")"
jq -e 'map(.name) | sort == ["Four","One","Zero"]' <<< "${zero_result}" >/dev/null

positive_plan="$("${telora_bin}" -C "${fixture_dir}" eval icloud-model/sample_execution:one_to_four_samples)"
jq -e '.bindings == ["2024-02-01T00:00:00Z","2024-03-01T00:00:00Z",90,1,"2024-02-01T00:00:00Z","2024-03-01T00:00:00Z",90,4]' <<< "${positive_plan}" >/dev/null
positive_sql="$(jq -r '.sql' <<< "${positive_plan}")"
positive_result="$(sqlite3 -json :memory: -cmd "${range_schema}" -cmd '.parameter init' \
    -cmd ".parameter set ?1 '2024-02-01T00:00:00Z'" -cmd ".parameter set ?2 '2024-03-01T00:00:00Z'" \
    -cmd '.parameter set ?3 90' -cmd '.parameter set ?4 1' \
    -cmd ".parameter set ?5 '2024-02-01T00:00:00Z'" -cmd ".parameter set ?6 '2024-03-01T00:00:00Z'" \
    -cmd '.parameter set ?7 90' -cmd '.parameter set ?8 4' "${positive_sql}")"
jq -e 'map(.name) | sort == ["Four","One"]' <<< "${positive_result}" >/dev/null

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

printf 'bounded sample counts, local epoch-ms filter, owner-scoped sample tops, interface KPI qualifications, independent sample averages, site-scoped event alternatives, event-qualified peak, metric count, qualified observation, sample peak, and component filter/context execute correctly\n'
