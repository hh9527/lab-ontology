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
 ('B-frame-1','B','red','Duplicate',3),('B-frame-2','B','red','Duplicate',11),('A-frame','A','red','Other',2);"

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

printf 'metric count, qualified observation, and component filter/context execute correctly\n'
