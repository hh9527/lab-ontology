#!/usr/bin/env python3
"""Check eDSL physical table and column mappings against Spider metadata."""

import argparse
import json
from pathlib import Path
import re
import sys


ENTITY = re.compile(
    r'@edsl\.entity_source\("(?P<table>[^"]+)",\s*"[^"]+"\)\s*'
    r'(?:@[^\n]+\n\s*)*'
    r'type\s+(?P<type>\w+)\s*=\s*struct\s*\{(?P<body>.*?)\n\};',
    re.DOTALL,
)
COLUMN = re.compile(r'@edsl\.column\("([^"]+)"\)')


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("model", type=Path)
    parser.add_argument("schema", type=Path)
    args = parser.parse_args()

    schema = json.loads(args.schema.read_text(encoding="utf-8"))
    original_tables = schema["table_names_original"]
    columns_by_table = {table: set() for table in original_tables}
    for (table_index, column), (_, original) in zip(
        schema["column_names"], schema["column_names_original"], strict=True
    ):
        if table_index >= 0:
            columns_by_table[original_tables[table_index]].add(original)

    text = args.model.read_text(encoding="utf-8")
    errors = []
    entities = list(ENTITY.finditer(text))
    declared_entities = text.count("@edsl.entity_source(")
    if not entities:
        errors.append("no @edsl.entity_source struct definitions found")
    elif len(entities) != declared_entities:
        errors.append(
            f"parsed {len(entities)} of {declared_entities} @edsl.entity_source definitions"
        )
    checked_columns = 0
    for entity in entities:
        table = entity.group("table")
        entity_type = entity.group("type")
        if table not in columns_by_table:
            errors.append(f"{entity_type}: unknown physical table {table!r}")
            continue
        for column in COLUMN.findall(entity.group("body")):
            checked_columns += 1
            if column not in columns_by_table[table]:
                expected = ", ".join(sorted(columns_by_table[table]))
                errors.append(
                    f"{entity_type}: physical column {column!r} is absent from {table!r}; "
                    f"expected one of: {expected}"
                )

    if errors:
        for error in errors:
            print(error, file=sys.stderr)
        return 1
    print(f"schema mappings ok: {len(entities)} entities, {checked_columns} columns")
    return 0


if __name__ == "__main__":
    sys.exit(main())
