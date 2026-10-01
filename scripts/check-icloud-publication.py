#!/usr/bin/env python3
"""Probe source-model discovery and SQL lowering through the published runner."""

import argparse
import json
import subprocess
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="prepared source_audit report")
    parser.add_argument("artifact", type=Path)
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
    requests = [{"method": "ic/info", "input": {"key": key}} for key in keys]
    graph = {
        "op": "Graph", "root": "alarm",
        "nodes": [{"id": "alarm", "entity": "current_alarm"}],
        "edges": [], "select": [], "count": "alarm",
        "time_windows": [{"node": "alarm", "dimension": "alarm_occur_utc_raw",
                          "start": 1709136000000, "end": 1709222400000}],
        "filters": [{"node": "alarm", "dimension": "alarm_severity",
                     "op": "Eq", "value": "critical"}],
    }
    requests.append({"method": "ic/transform", "input": {"intents": [graph]}})
    device = {
        "op": "Graph", "root": "device",
        "nodes": [{"id": "device", "entity": "device"}], "edges": [],
        "select": [{"node": "device", "dimension": "device_class"}], "count": "device",
    }
    exact_unknown = {**device, "select": [], "filters": [
        {"node": "device", "dimension": "device_class", "op": "Eq",
         "value": {"unknown": "FutureDevice"}},
    ]}
    requests.append({"method": "ic/transform", "input": {"intents": [device, exact_unknown]}})
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
    indexed = {entry["key"] for entry in entries}
    assert len(indexed) == len(entries), "duplicate published index key"
    assert len([entry for entry in entries if entry["type"] == "Dataset"]) == 50
    for node in nodes.values():
        assert all(link["key"] in indexed for link in node["links"]), node["key"]
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
    assert "Field/frame/id" not in indexed
    assert "Dimension/frame/frame_id" not in indexed
    result = responses[-2]
    assert result["accepted"] and len(result["queries"]) == 1, result
    query = result["queries"][0]
    assert "alarm.OCCURUTC >=" in query["sql"] and "alarm.OCCURUTC <" in query["sql"], query
    assert "alarm.SEVERITY" in query["sql"], query
    bindings = query["bindings"]
    if bindings and isinstance(bindings[0], dict):
        assert all(set(value) == {"Int"} for value in bindings), bindings
        bindings = [value["Int"] for value in bindings]
    assert sorted(bindings) == [1, 1709136000000, 1709222400000], bindings
    result = responses[-1]
    assert result["accepted"] and len(result["queries"]) == 2, result
    grouped, unknown = result["queries"]
    assert "device_device_class__kind" in grouped["sql"] and "WHERE" not in grouped["sql"], grouped
    assert unknown["bindings"] == ["FutureDevice"], unknown
    print(json.dumps({"index_entries": len(entries), "dataset_documents": 50,
                      "relation_documents": len(report["relations"]),
                      "clock_encoding": "EpochMillis", "query": "passed",
                      "half_open": "passed", "field_roles": "passed"}, indent=2))


if __name__ == "__main__":
    main()
