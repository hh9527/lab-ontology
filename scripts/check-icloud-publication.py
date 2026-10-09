#!/usr/bin/env python3
"""Probe source-model discovery and SQL lowering through the published runner."""

import argparse
import json
import subprocess
from pathlib import Path

from icloud_capabilities import SEARCH_OPS


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="prepared source_audit report")
    parser.add_argument("artifact", type=Path)
    parser.add_argument("--discovery", type=Path, help="nodes from check-knowledge-discovery.mjs")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    report = json.loads(args.report.read_text())
    keys = ["index"]
    keys += [f"Dataset/{row['id']}" for row in report["datasets"]]
    keys += [f"Relation/{row['from_dataset']}/{row['id']}" for row in report["relations"]]
    keys += ["TimeRole/current_alarm/occur_utc", "Dimension/current_alarm/alarm_severity"]
    keys += ["Dimension/device/device_class"]
    keys += ["Field/device/name", "Field/device/id", "Field/device_kpi/cpu_usage"]
    keys += ["Field/frame/frame_dn", "Field/frame/name"]
    keys += [f"Dimension/{row['dataset']}/{row['id']}" for row in report["dimensions"] if row["authorized"]]
    keys += ["Schema/syntax/graph/filter/capabilities", "Schema/syntax/model/ipv4_subnets"]
    keys = list(dict.fromkeys(keys))
    requests = [{"method": "ic/info", "input": {"key": key}} for key in keys]
    graph = {
        "op": "Graph","limit":1000, "root": "alarm",
        "nodes": [{"id": "alarm", "entity": "current_alarm"}],
        "edges": [], "select": [], "count": "alarm",
        "time_windows": [{"node": "alarm", "dimension": "alarm_occur_utc_raw",
                          "start": 1709136000000, "end": 1709222400000}],
        "filters": [{"node": "alarm", "dimension": "alarm_severity",
                     "op": "Eq", "value": "critical"}],
    }
    requests.append({"method": "ic/transform", "input": {"intents": [graph]}})
    device = {
        "op": "Graph","limit":1000, "root": "device",
        "nodes": [{"id": "device", "entity": "device"}], "edges": [],
        "select": [{"node": "device", "dimension": "device_class"}], "count": "device",
    }
    exact_unknown = {**device, "select": [], "filters": [
        {"node": "device", "dimension": "device_class", "op": "Eq",
         "value": {"unknown": "FutureDevice"}},
    ]}
    requests.append({"method": "ic/transform", "input": {"intents": [device, exact_unknown]}})
    def search(dimension, op, value):
        return {"op": "Graph","limit":1000, "root": "device",
                "nodes": [{"id": "device", "entity": "device"}], "edges": [],
                "select": [{"node": "device", "dimension": dimension}],
                "filters": [{"node": "device", "dimension": dimension, "op": op, "value": value}]}
    searches = [search("device__version", "EndsWith", "C00"),
                search("device_ip_address", "Contains", "10.4"),
                search("device_ip_address_ipv4", "InSubnet", "10.4.16.0/20")]
    requests.append({"method": "ic/transform", "input": {"intents": searches}})
    process = subprocess.run(
        [str(root / "bin/telora-run"), str(args.artifact.resolve()),
         "--serve", "stdio+jsonl://", "--request-fuel", "100000",
         "--with-memory-limit", "1024"],
        input="".join(json.dumps(request) + "\n" for request in requests),
        capture_output=True, text=True, timeout=300, check=True,
    )
    responses = [json.loads(line) for line in process.stdout.splitlines() if line.strip()]
    assert len(responses) == len(requests), (len(responses), process.stderr)
    assert all(response.get("error") is False and "ok" in response for response in responses), "runner reported a service error"
    responses = [response["ok"] for response in responses]
    nodes = {}
    for key, response in zip(keys, responses):
        document = response.get("Document", {})
        assert isinstance(document, dict) and "Found" in document, f"missing document: {key}"
        nodes[key] = document["Found"]
        assert nodes[key]["key"] == key, (key, nodes[key])
    entries = nodes["index"]["detail"]["entries"]
    assert len(entries) == 5 and len({entry["key"] for entry in entries}) == 5
    assert nodes["index"]["links"] == []
    discovered = json.loads(args.discovery.read_text()) if args.discovery else None
    if discovered is not None:
        indexed = {node["key"] for node in discovered}
        assert len(indexed) == len(discovered), "duplicate discovered key"
        assert all(key in indexed for key in nodes), "publication probe read an undiscovered node"
        for node in nodes.values():
            assert all(link["key"] in indexed for link in node["links"]), node["key"]
        assert "Field/frame/id" not in indexed
        assert "Dimension/frame/frame_id" not in indexed
    for relation in report["relations"]:
        key = f"Relation/{relation['from_dataset']}/{relation['id']}"
        detail = nodes[key]["detail"]
        assert detail["cardinality"] == relation["cardinality"], (key, detail)
    assert nodes["TimeRole/current_alarm/occur_utc"]["detail"]["encoding"] == "EpochMillis"
    detail = nodes["Dimension/device/device_class"]["detail"]
    assert detail["half_open"] and "unknowns" in detail["value_contract"], detail
    device_detail = nodes["Dataset/device"]["detail"]
    assert device_detail["references"] == [{"id": "id", "fields": ["id"]}], device_detail
    assert nodes["Field/device/name"]["detail"]["roles"] == ["Appellation"]
    assert nodes["Field/device/id"]["detail"]["roles"] == ["Reference"]
    assert nodes["Field/device/id"]["detail"]["reference_ids"] == ["id"]
    assert nodes["Field/device_kpi/cpu_usage"]["detail"]["roles"] == ["Metric"]
    frame = nodes["Dataset/frame"]["detail"]
    assert frame["references"] == [{"id": "dn", "fields": ["frame_dn"]}], frame
    assert frame["grain"] == [], frame
    assert nodes["Field/frame/frame_dn"]["detail"]["nullable"] is True
    assert nodes["Field/frame/name"]["detail"]["nullable"] is False
    for dimension in report["dimensions"]:
        if not dimension["authorized"]:
            continue
        key = f"Dimension/{dimension['dataset']}/{dimension['id']}"
        node = nodes[key]
        assert node["detail"]["ops"] == dimension["ops"], key
        assert node["detail"]["input_kinds"] == dimension["input_kinds"], key
        assert "Schema/syntax/graph/filter/capabilities" in {link["key"] for link in node["links"]}, key
        if dimension["input_kinds"] == ["Ipv4"]:
            assert "Schema/syntax/model/ipv4_subnets" in {link["key"] for link in node["links"]}, key
            assert "NULL, IPv6" in node["description"]["summary"], key
    result = responses[-3]
    assert result["accepted"] and len(result["queries"]) == 1, result
    query = result["queries"][0]
    assert "alarm.OCCURUTC >=" in query["sql"] and "alarm.OCCURUTC <" in query["sql"], query
    assert "alarm.SEVERITY" in query["sql"], query
    bindings = query["bindings"]
    if bindings and isinstance(bindings[0], dict):
        assert all(set(value) == {"Int"} for value in bindings), bindings
        bindings = [value["Int"] for value in bindings]
    assert sorted(bindings) == [1, 1709136000000, 1709222400000], bindings
    result = responses[-2]
    assert result["accepted"] and len(result["queries"]) == 2, result
    grouped, unknown = result["queries"]
    assert "device_device_class__kind" in grouped["sql"] and "WHERE" not in grouped["sql"], grouped
    assert unknown["bindings"] == ["FutureDevice"], unknown
    result = responses[-1]
    assert result["accepted"] and len(result["queries"]) == 3, result
    version, address, subnet = result["queries"]
    assert "C00" in version["bindings"] and "C00" not in version["sql"], version
    assert address["bindings"] == ["10.4", 0] and " > " in address["sql"], address
    assert "CASE WHEN" in subnet["sql"] and "REGEXP" in subnet["sql"], subnet
    assert "10.4." in subnet["bindings"] and "10.4/" in subnet["bindings"], subnet
    assert nodes["Dimension/device/device__version"]["detail"]["ops"] == SEARCH_OPS
    print(json.dumps({"root_entries": len(entries), "discovered_nodes": len(discovered) if discovered is not None else None, "dataset_documents": 50,
                      "relation_documents": len(report["relations"]),
                      "clock_encoding": "EpochMillis", "query": "passed",
                      "dimension_documents": len(report["dimensions"]),
                      "search_and_ipv4_views": "passed",
                      "half_open": "passed", "field_roles": "passed"}, indent=2))


if __name__ == "__main__":
    main()
