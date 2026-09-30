#!/usr/bin/env python3
"""Emit a reviewable patch completing the model's source fields and relations.

This recognizes the deliberately regular declaration layout of model.telora;
it is not a general Telora parser. Original declarations remain editable.
Every source condition is validated against a closed equality/AND/OR grammar.
"""

import argparse
import difflib
import json
import re
from pathlib import Path


SCALARS = {
    "string": "String", "uuid": "String", "ip": "String", "enum": "String",
    "integer": "Int", "long": "Int", "float": "Float", "double": "Float",
    "boolean": "Bool", "datetime": "String",
}
ENTITY = re.compile(
    r'(?P<header>@edsl::entity_id\("(?P<id>[^"]+)"\)\n'
    r'@edsl::entity_source\("(?P<table>[^"]+)",[^\n]+\n.*?)'
    r'type (?P<type>\w+) = struct \{\n(?P<body>.*?)^\};', re.S | re.M,
)
FIELD = re.compile(r'@edsl::column\("([^"]+)"\).*?^    (\w+): (\w+),', re.S | re.M)


def text(value):
    return json.dumps(value or "", ensure_ascii=False)


def identifier(value):
    return re.sub(r"[^A-Za-z0-9_]", "_", value)


def scalar(field):
    return SCALARS[field["type"]["type"]]


def new_field(entity, field, name):
    ty = scalar(field)
    ops, inputs = {
        "String": ("text_ops", "text_inputs"),
        "Int": ("int_ops", "int_inputs"),
        "Float": ("int_ops", "number_inputs"),
        "Bool": ("bool_ops", "bool_inputs"),
    }[ty]
    dimension = identifier(f"{entity}__{field['name']}")
    label = field.get("businessName") or field["name"]
    summary = field.get("description") or "Source field; no additional business interpretation."
    return (
        f'    @edsl::column({text(field["name"])})\n'
        f'    @edsl::dimension({text(dimension)}, True, True, {ops}, {inputs})\n'
        f'    @edsl::dimension_description({text(dimension)}, {text(label)}, {text(summary)})\n'
        f'    {name}: {ty},\n'
    )


def condition_key(condition, relation, names):
    branches = []
    for branch in re.split(r"\s+or\s+", condition, flags=re.I):
        pairs = []
        for equality in re.split(r"\s+and\s+", branch, flags=re.I):
            match = re.fullmatch(r"\s*(\w+)\.(\w+)\s*=\s*(\w+)\.(\w+)\s*", equality)
            if match is None:
                raise ValueError(f"unsupported source condition: {condition}")
            left, a, right, b = match.groups()
            if relation["source"] != relation["target"] and (left, right) == (relation["target"], relation["source"]):
                left, a, right, b = right, b, left, a
            if (left, right) != (relation["source"], relation["target"]):
                raise ValueError(f"condition endpoints disagree: {relation['name']}")
            if a not in names[left] or b not in names[right]:
                raise ValueError(f"missing source relationship column: {relation['name']}: {left}.{a} = {right}.{b}")
            pairs.append(f'edsl::DeclaredRelationKey::FieldEq({{from: {text(names[left][a])}, to: {text(names[right][b])}}})')
        branches.append(pairs[0] if len(pairs) == 1 else "edsl::DeclaredRelationKey::And([" + ", ".join(pairs) + "])")
    return branches[0] if len(branches) == 1 else "edsl::DeclaredRelationKey::Or([" + ", ".join(branches) + "])"


def refresh(model, catalog, exceptions):
    model = re.sub(r'# Original relation:[^\n]*\n@edsl::named_relation_key\("source_[^\n]*\n    [^\n]*\n', '', model)
    sources = {item["table"]: item for item in catalog["datasets"]}
    declarations = list(ENTITY.finditer(model))
    if not declarations:
        raise ValueError("model has no recognized declarations")
    preferred = {}
    names = {}
    patches = []
    duplicate_carriers = []
    for declaration in declarations:
        source = sources[declaration["table"]]
        if declaration["type"].startswith("Source") and source["name"] in preferred:
            patches.append((declaration.start(), declaration.end(), ""))
            duplicate_carriers.append(declaration["type"])
            continue
        fields = {column: name for column, name, _ in FIELD.findall(declaration["body"])}
        addition = ""
        for field in source["fields"]:
            if field["name"] not in fields:
                name = "source_" + identifier(field["name"])
                if name in fields.values():
                    raise ValueError(f"field name collision: {declaration['type']}.{name}")
                fields[field["name"]] = name
                addition += new_field(declaration["id"], field, name)
        if source["name"] not in preferred:
            preferred[source["name"]] = declaration["type"]
            names[source["name"]] = fields
        patches.append((declaration.start(), declaration.end(), declaration[0][:-2] + addition + "};"))

    extra = []
    for index, source in enumerate(catalog["datasets"]):
        if source["name"] in preferred:
            continue
        carrier = "Source" + identifier(source["name"])
        entity = "source_" + identifier(source["name"])
        preferred[source["name"]] = carrier
        names[source["name"]] = {field["name"]: "source_" + identifier(field["name"]) for field in source["fields"]}
        body = ""
        keys = [f["name"] for f in source["fields"] if f.get("isPK") == "Y"]
        for field in source["fields"]:
            rendered = new_field(entity, field, names[source["name"]][field["name"]])
            if len(keys) == 1 and field["name"] == keys[0]:
                rendered = rendered.replace("    @edsl::dimension(", "    @edsl::key()\n    @edsl::dimension(", 1)
            body += rendered
        extra.append(
            f'# Source schema: {source["file"]}. Business grain and clock assumptions are declared explicitly.\n'
            f'@edsl::entity_id({text(entity)})\n'
            f'@edsl::entity_source({text(source["table"])}, "source_{index}")\n'
            f'@edsl::dataset_description({text(source["label"] or source["name"])}, {text(source["description"])})\n'
            f'type {carrier} = struct {{\n{body}}};\n\n'
        )
    for start, end, replacement in reversed(patches):
        model = model[:start] + replacement + model[end:]
    for carrier in duplicate_carriers:
        model = model.replace(", " + carrier + ".type", "")
    if extra:
        model = model.replace("def profile: qb::PlanProfile", "".join(extra) + "def profile: qb::PlanProfile", 1)
        existing = re.search(r'(edsl::build_root\(\s*"[^"]+", \[)(.*?)(\],\s*profile)', model, re.S)
        if existing is None:
            raise ValueError("root type list not found")
        carriers = list(dict.fromkeys(preferred.values()))
        additions = [carrier + ".type" for carrier in carriers if carrier + ".type" not in existing[2].split(", ")]
        model = model[:existing.start(2)] + existing[2] + ", " + ", ".join(additions) + model[existing.end(2):]

    attributes = {carrier: [] for carrier in preferred.values()}
    for relation in catalog["relations"]:
        if relation["name"] in exceptions["excluded_relations"]:
            continue
        name = "source_" + identifier(relation["name"])
        if f'@edsl::named_relation_key("{name}"' in model:
            continue
        left, right = relation["cardinality"].split(":")
        cardinality = lambda bound: "Optional" if bound == "1" else "Many0"
        key = condition_key(relation["condition"], relation, names)
        source = preferred[relation["source"]]
        target = preferred[relation["target"]]
        attributes[source].append(
            f'# Original relation: {relation["file"]}; declared upper bounds {relation["cardinality"]}.\n'
            f'@edsl::named_relation_key({text(name)}, {target}.type, '
            f'{{from: edsl::Cardinality::{cardinality(left)}, to: edsl::Cardinality::{cardinality(right)}}},\n    {key})\n'
        )
    for carrier, entries in attributes.items():
        marker = f"type {carrier} = struct {{"
        if model.count(marker) != 1:
            raise ValueError(f"carrier not unique: {carrier}")
        model = model.replace(marker, "".join(entries) + marker)
    return model


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=Path("icloud_model/src/model.telora"))
    parser.add_argument("--catalog", type=Path, default=Path("icloud_model/data/source_catalog.json"))
    parser.add_argument("--exceptions", type=Path, default=Path("icloud_model/data/source_exceptions.json"))
    parser.add_argument("--chunk", type=int, default=0, help="Emit this diff-hunk group")
    parser.add_argument("--chunks", type=int, default=1, help="Partition diff hunks for review")
    args = parser.parse_args()
    old = args.model.read_text()
    new = refresh(old, json.loads(args.catalog.read_text()), json.loads(args.exceptions.read_text()))
    if new != old:
        print("*** Begin Patch")
        print(f"*** Update File: {args.model.resolve()}")
        hunks = []
        for line in list(difflib.unified_diff(old.splitlines(), new.splitlines(), n=3))[2:]:
            if line.startswith("@@"):
                hunks.append([])
            hunks[-1].append(line)
        chosen = hunks[len(hunks) * args.chunk // args.chunks:len(hunks) * (args.chunk + 1) // args.chunks]
        for line in (line for hunk in chosen for line in hunk):
            print("@@" if line.startswith("@@") else line)
        print("*** End Patch")


if __name__ == "__main__":
    main()
