#!/usr/bin/env python3
"""Author-facing time coverage from source metadata and the prepared Model."""

import argparse
import json
from collections import Counter
from pathlib import Path

# Reviewed auxiliary clocks remain metadata-only, not window capabilities.
WINDOW_EXCLUSIONS = {
    ("current_alarm", "ARRIVEUTC"): "Auxiliary reception clock has no authorized dimension; occurrence is the published event clock",
    ("current_alarm", "OCCURTIME"): "Auxiliary NE-local clock has no authorized dimension; occurrence UTC is the published event clock",
}


def is_source_time(field):
    return (field["type"]["type"] == "datetime" or field.get("columnType") == "timestamp"
            or field.get("properties", {}).get("dte.semantic.type") == "time"
            or field.get("properties", {}).get("dte.displayName") == "EMSBaseClass.createTime")


def basis(field, encoding):
    props = field.get("properties", {})
    pattern = props.get("dte.time.format.pattern")
    if encoding == "DateText" and pattern == "YYYY-MM-DD":
        return {"kind": "SourceDatePattern", "requires_confirmation": False,
                "evidence": "dte.time.format.pattern=YYYY-MM-DD"}
    if encoding == "Rfc3339Text" and field["type"]["type"] == "datetime":
        return {"kind": "DatetimeUtcContract", "requires_confirmation": False,
                "evidence": "Source datetime; confirmed UTC semantics; SQLite contract YYYY-MM-DDTHH:MM:SSZ (#44)"}
    if encoding == "EpochMillis":
        description = field.get("description", "").lower()
        if "in milliseconds" in description:
            return {"kind": "SourceMillisecondUnit", "requires_confirmation": False,
                    "evidence": field["description"]}
        return {"kind": "ModelEpochMillisAssumption", "requires_confirmation": True,
                "evidence": "TODO: confirm Unix epoch millisecond representation and unit"}
    return {"kind": "ModelDeclaration", "requires_confirmation": True,
            "evidence": "Review the declared physical encoding against source evidence"}


def audit(report, catalog):
    sources = {source["table"]: source for source in catalog["datasets"]}
    rows, errors = [], []
    for dataset in report["datasets"]:
        raw_fields = {field["name"]: field for field in sources[dataset["table"]]["fields"]}
        candidates = []
        roles = {role["field"]: role for role in dataset["time_roles"]}
        for field in dataset["fields"]:
            raw = raw_fields[field["column"]]
            if raw["type"]["type"] == "datetime" and (
                    not field["time"] or field["time"]["encoding"] != "Rfc3339Text"
                    or field["time"]["semantics"] != "Utc"):
                errors.append(f"source datetime requires DatetimeUtc/Rfc3339Text: {dataset['id']}.{field['name']}")
            if not field["time"] and not is_source_time(raw):
                continue
            dims = [dim for dim in report["dimensions"] if dim["dataset"] == dataset["id"]
                    and dim["column"] == field["column"] and dim["authorized"] and not dim["computed"]]
            role = roles.get(field["name"])
            usable = [dim for dim in dims if dim["filterable"] and "Ge" in dim["ops"] and "Lt" in dim["ops"]]
            if role and usable:
                disposition, reason = "PublishedWindow", "Declared time role and authorized Ge/Lt dimension"
            elif field["time"]:
                disposition, reason = "RoleOnly", WINDOW_EXCLUSIONS.get((dataset["id"], field["column"]))
                if not reason:
                    reason = "Missing reviewed disposition for a declared clock without window authorization"
                    errors.append(f"unreviewed window exclusion: {dataset['id']}.{field['name']}")
            else:
                disposition, reason = "Undeclared", "Time-related source field has no Model time declaration"
                errors.append(f"undeclared source time: {dataset['id']}.{field['name']}")
            if role:
                for dim in usable:
                    if dim["input_kinds"] != [role["logical_type"]]:
                        errors.append(f"time logical type mismatch: {dim['id']}")
            candidates.append({"field": field["name"], "column": field["column"],
                "physical_type": field["scalar"], "declaration": field["time"],
                "published_role": role, "disposition": disposition, "reason": reason,
                "basis": basis(raw, field["time"]["encoding"]) if field["time"] else None,
                "dimensions": [{key: dim[key] for key in ("id", "filterable", "ops", "input_kinds", "half_open")} for dim in dims]})
        rows.append({"dataset": dataset["id"], "table": dataset["table"],
                     "disposition": "TimeFields" if candidates else "NoTimeColumns",
                     "fields": candidates})
    return {"model_revision": report["revision"], "dataset_count": len(rows),
            "field_counts": dict(Counter(field["disposition"] for row in rows for field in row["fields"])),
            "datasets": rows, "errors": errors}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path)
    parser.add_argument("--catalog", type=Path, default=Path("icloud_model/data/source_catalog.json"))
    args = parser.parse_args()
    result = audit(json.loads(args.report.read_text()), json.loads(args.catalog.read_text()))
    print(json.dumps(result, ensure_ascii=False, indent=2))
    raise SystemExit(bool(result["errors"]))


if __name__ == "__main__":
    main()
