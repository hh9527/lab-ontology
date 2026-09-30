#!/usr/bin/env python3
"""Emit a patch aligning business relation aliases with original declarations."""

import argparse
import difflib
import json
import re
from pathlib import Path

import importlib.util

schema_spec = importlib.util.spec_from_file_location(
    "icloud_schema", Path(__file__).with_name("refresh-icloud-schema.py")
)
schema = importlib.util.module_from_spec(schema_spec)
schema_spec.loader.exec_module(schema)


def attribute_end(model, start):
    depth = 0
    for token in re.finditer(r'"(?:\\.|[^"\\])*"|[()]', model[start:]):
        if token[0] == "(":
            depth += 1
        elif token[0] == ")":
            depth -= 1
            if depth == 0:
                return start + token.end()
    raise ValueError("unclosed relation attribute")


def original_pairs(relation):
    branches = []
    for branch in re.split(r"\s+or\s+", relation["condition"], flags=re.I):
        pairs = []
        for part in re.split(r"\s+and\s+", branch, flags=re.I):
            match = re.fullmatch(r"\s*(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)\s*", part)
            if not match:
                raise ValueError(f"unsupported source condition: {part}")
            left, a, right, b = match.groups()
            if relation["source"] != relation["target"] and left == relation["target"]:
                a, b = b, a
            pairs.append((a, b))
        branches.append(pairs)
    return branches


def key(branches, left, right, reverse):
    rendered = []
    for branch in branches:
        parts = []
        for a, b in branch:
            if reverse:
                a, b = b, a
            parts.append(f'edsl::DeclaredRelationKey::FieldEq({{from: {schema.text(left[a])}, to: {schema.text(right[b])}}})')
        rendered.append(parts[0] if len(parts) == 1 else "edsl::DeclaredRelationKey::And([" + ", ".join(parts) + "])")
    return rendered[0] if len(rendered) == 1 else "edsl::DeclaredRelationKey::Or([" + ", ".join(rendered) + "])"


def reconcile(model, catalog, aliases, report):
    sources = {r["name"]: r for r in catalog["relations"]}
    relations = {r["id"]: r for r in report["relations"]}
    entities = {e["id"]: e for e in report["datasets"]}
    carriers = {match["id"]: match["type"] for match in schema.ENTITY.finditer(model)}
    replacements = []
    for name, (source_name, reverse) in aliases.items():
        original = sources[source_name]
        current = relations[name]
        left = entities[current["from_dataset"]]
        right = entities[current["to_dataset"]]
        left_names = {f["column"]: f["name"] for f in left["fields"]}
        right_names = {f["column"]: f["name"] for f in right["fields"]}
        a, b = original["cardinality"].split(":")
        if reverse:
            a, b = b, a
        cardinality = lambda bound: "Optional" if bound == "1" else "Many0"
        expression = key(original_pairs(original), left_names, right_names, reverse)
        new = (
            f'@edsl::named_relation_key({schema.text(name)}, {carriers[right["id"]]}.type, '
            f'{{from: edsl::Cardinality::{cardinality(a)}, to: edsl::Cardinality::{cardinality(b)}}},\n'
            f'    {expression})'
        )
        match = re.search(r'@edsl::named_(?:typed_relation_or_key|typed_relation_key|relation_key)\("' + re.escape(name) + '"', model)
        if not match:
            raise ValueError(f"business relation attribute missing: {name}")
        replacements.append((match.start(), attribute_end(model, match.start()), new))
    for start, end, replacement in sorted(replacements, reverse=True):
        model = model[:start] + replacement + model[end:]
    return model


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("report", type=Path, help="Prepared-model JSON from source_audit:report")
    args = parser.parse_args()
    path = Path("icloud_model/src/model.telora")
    old = path.read_text()
    catalog = json.loads(Path("icloud_model/data/source_catalog.json").read_text())
    aliases = json.loads(Path("icloud_model/data/business_relation_sources.json").read_text())
    new = reconcile(old, catalog, aliases, json.loads(args.report.read_text()))
    if new != old:
        print("*** Begin Patch")
        print(f"*** Update File: {path.resolve()}")
        for line in list(difflib.unified_diff(old.splitlines(), new.splitlines(), n=3))[2:]:
            print("@@" if line.startswith("@@") else line)
        print("*** End Patch")


if __name__ == "__main__":
    main()
