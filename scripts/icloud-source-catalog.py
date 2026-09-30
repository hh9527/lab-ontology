#!/usr/bin/env python3
"""Normalize the authoritative iMaster Cloud metadata for model review.

Run with a YAML parser, for example:
    mise x -- uv run --with pyyaml python3 scripts/icloud-source-catalog.py \
        ../imaster-cloud/.compact/metadata
"""

import argparse
import hashlib
import json
from pathlib import Path

import yaml


def field_metadata(field):
    properties = field.get("properties") or {}
    selected = {key: field.get(key) for key in (
        "name", "type", "businessName", "businessName_cn", "description",
        "description_cn", "nullable", "isPK", "columnType", "aliasName",
    )}
    selected["properties"] = {
        key: value for key, value in properties.items()
        if key not in {"ui", "dte.llmFriendly", "dte.writable", "dte.unique"}
    }
    for key in ("dte.enum.values", "unit", "aggregation", "aggregate"):
        if key in field:
            selected[key] = field[key]
    return selected


def catalog(directory):
    datasets = []
    relations = []
    for path in sorted(directory.glob("*.yaml")):
        if not path.name.endswith((".logical.yaml", ".relation.yaml")):
            continue
        raw = path.read_bytes()
        data = yaml.safe_load(raw)
        provenance = {
            "file": path.name,
            "sha256": hashlib.sha256(raw).hexdigest(),
        }
        if path.name.endswith(".logical.yaml"):
            properties = data.get("properties") or {}
            datasets.append({
                **provenance,
                "name": data["name"],
                "table": properties.get("dte.twin.tableName", data["name"]),
                "label": data.get("businessName"),
                "label_zh": data.get("businessName_cn"),
                "description": data.get("description"),
                "description_zh": data.get("description_cn"),
                "properties": properties,
                "fields": [field_metadata(field) for field in data["schema"]["fields"]],
            })
        else:
            relations.append({
                **provenance,
                "name": data["name"],
                "source": data["sourceEntityName"],
                "target": data["targetEntityName"],
                "cardinality": data["cardinality"],
                "description": data.get("description"),
                "condition": (data.get("rule") or {}).get("condition"),
                "condition_type": (data.get("rule") or {}).get("conditionType"),
                "properties": data.get("properties") or {},
            })
    return {"format": "icloud-source-catalog/v1", "datasets": datasets, "relations": relations}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("metadata", type=Path)
    args = parser.parse_args()
    print(json.dumps(catalog(args.metadata), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
