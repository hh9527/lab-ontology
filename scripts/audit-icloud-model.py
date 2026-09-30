#!/usr/bin/env python3
"""Check the compiled/prepared model against the independent source catalog.

Export first with:
    bin/telora -C icloud_model eval @src/source_audit:report > prepared.json
Then run this script with prepared.json. --metadata also checks source hashes.
"""

import argparse
import hashlib
import json
import re
from pathlib import Path


SCALARS = {"string": "String", "uuid": "String", "ip": "String", "enum": "String",
           "integer": "Int", "long": "Int", "double": "Float", "float": "Float",
           "boolean": "Bool", "datetime": "String"}


def expected_key(relation, reverse=False):
    branches = []
    for branch in re.split(r"\s+or\s+", relation["condition"], flags=re.I):
        pairs = []
        for expression in re.split(r"\s+and\s+", branch, flags=re.I):
            match = re.fullmatch(r"\s*(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)\s*", expression)
            if match is None:
                raise ValueError(f"unsupported source grammar: {expression}")
            left, a, right, b = match.groups()
            if relation["source"] != relation["target"] and left == relation["target"]:
                a, b = b, a
            if reverse:
                a, b = b, a
            pairs.append({"Eq": {"from_column": a, "to_column": b}})
        branches.append(pairs[0] if len(pairs) == 1 else {"And": pairs})
    return branches[0] if len(branches) == 1 else {"Or": branches}


def enum_values(field, recovery=None):
    encoded = field.get("dte.enum.values") or field.get("properties", {}).get("dte.enum.values")
    if recovery:
        values = recovery["values"]
    elif encoded:
        # Upstream display strings contain literal newlines inside JSON strings.
        values = json.loads(encoded, strict=False) if isinstance(encoded, str) else encoded
    elif field["type"]["type"] == "enum":
        values = [{"value": symbol, "valueDesc": symbol} for symbol in field["type"]["symbols"]]
    else:
        return []
    scalar = SCALARS[field["type"]["type"]]
    coerce = {"String": str, "Int": int, "Float": float, "Bool": bool}[scalar]
    tag = {"String": "Text", "Int": "Int", "Float": "Number", "Bool": "Bool"}[scalar]
    return [{"wire": {tag: coerce(value["value"])}, "label": value.get("valueDesc") or str(value["value"])} for value in values]


def check(report, catalog, exceptions, aliases, metadata=None):
    errors = []
    enum_gaps = []
    by_name = {source["name"]: source for source in catalog["datasets"]}
    by_table = {source["table"]: source for source in catalog["datasets"]}
    rows = {entity["id"]: entity for entity in report["datasets"]}
    relations = {relation["id"]: relation for relation in report["relations"]}
    if len(rows) != len(report["datasets"]) or len(relations) != len(report["relations"]):
        errors.append("duplicate dataset or relation identifier")
    for source in catalog["datasets"]:
        matches = [entity for entity in rows.values() if entity["table"] == source["table"]]
        if not matches:
            errors.append(f"missing table {source['table']}")
        for entity in matches:
            fields = {field["column"]: field for field in entity["fields"]}
            for raw in source["fields"]:
                field = fields.get(raw["name"])
                if field is None:
                    errors.append(f"missing field {entity['id']}.{raw['name']}")
                elif field["scalar"] != SCALARS[raw["type"]["type"]]:
                    errors.append(f"wrong scalar {entity['id']}.{raw['name']}: {field['scalar']}")
                if field is not None:
                    supplemental_key = f"{entity['id']}.{raw['name']}" in exceptions.get("supplemental_keys", {})
                    expected_primary = raw.get("isPK") == "Y" or supplemental_key
                    if field["is_key"] != expected_primary:
                        errors.append(f"wrong primary-key marker {entity['id']}.{raw['name']}")
                    if raw.get("columnType") == "timestamp" and raw["type"]["type"] == "long":
                        role = field.get("time")
                        if not role or role["encoding"] != "EpochMillis":
                            errors.append(f"integer clock lacks provisional epoch encoding {entity['id']}.{raw['name']}")
            for column in fields.keys() - {raw["name"] for raw in source["fields"]}:
                supplemental = exceptions["supplemental_fields"].get("Frame.id")
                if not (entity["id"] == "frame" and supplemental and column == supplemental["column"]):
                    errors.append(f"unproved physical column {entity['id']}.{column}")
    for relation in catalog["relations"]:
        source = by_name[relation["source"]]
        target = by_name[relation["target"]]
        missing = [f"{name}.{column}" for name, column in re.findall(r"(\w+)\.(\w+)", relation["condition"])
                   if column not in {f["name"] for f in by_name[name]["fields"]}]
        excluded = relation["name"] in exceptions["excluded_relations"]
        if excluded != bool(missing):
            errors.append(f"exclusion does not match source evidence: {relation['name']}")
        if excluded:
            if "source_" + relation["name"] in relations:
                errors.append(f"invalid relation published: {relation['name']}")
            continue
        tests = [("source_" + relation["name"], False)]
        tests += [(name, reverse) for name, (origin, reverse) in aliases.items() if origin == relation["name"]]
        for name, reverse in tests:
            actual = relations.get(name)
            a, b = relation["cardinality"].split(":")
            if reverse:
                a, b = b, a
            expected_cardinality = {"from": "Optional" if a == "1" else "Many0", "to": "Optional" if b == "1" else "Many0"}
            tables = (target["table"], source["table"]) if reverse else (source["table"], target["table"])
            if actual is None or (actual["from_table"], actual["to_table"]) != tables:
                errors.append(f"relation endpoints differ: {name}")
            elif actual["key"] != expected_key(relation, reverse) or actual["cardinality"] != expected_cardinality:
                errors.append(f"relation condition/cardinality differs: {name}")
    for dimension in report["dimensions"]:
        if dimension["computed"] or dimension["dataset"] in {"pon_onu_role", "pon_olt_role"}:
            continue
        entity = rows[dimension["dataset"]]
        field = next((f for f in by_table[entity["table"]]["fields"] if f["name"] == dimension["column"]), None)
        if field is None:
            continue
        wires = [wire for value in dimension["values"] for wire in value["wires"]]
        recovery = exceptions.get("enum_recoveries", {}).get(by_table[entity["table"]]["name"] + "." + field["name"])
        absent = [value for value in enum_values(field, recovery) if value["wire"] not in wires]
        if absent:
            enum_gaps.append({"dataset": entity["id"], "dimension": dimension["id"], "column": field["name"], "missing": absent})
    if metadata:
        for source in catalog["datasets"] + catalog["relations"]:
            path = metadata / source["file"]
            if not path.exists() or hashlib.sha256(path.read_bytes()).hexdigest() != source["sha256"]:
                errors.append(f"source hash changed: {source['file']}")
    return {
        "model_revision": report["revision"],
        "source_tables": len(catalog["datasets"]),
        "source_fields": sum(len(source["fields"]) for source in catalog["datasets"]),
        "source_relations": len(catalog["relations"]),
        "published_source_relations": len(catalog["relations"]) - len(exceptions["excluded_relations"]),
        "business_aliases": len(aliases), "prepared_datasets": len(rows),
        "prepared_fields": sum(len(entity["fields"]) for entity in rows.values()),
        "prepared_relations": len(relations),
        "errors": errors, "enum_gaps": enum_gaps,
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--metadata", type=Path)
    args = parser.parse_args()
    data = Path("icloud_model/data")
    result = check(json.loads(args.report.read_text()), json.loads((data / "source_catalog.json").read_text()),
                   json.loads((data / "source_exceptions.json").read_text()),
                   json.loads((data / "business_relation_sources.json").read_text()), args.metadata)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(bool(result["errors"] or result["enum_gaps"]))


if __name__ == "__main__":
    main()
