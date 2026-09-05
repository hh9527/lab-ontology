#!/usr/bin/env python3
"""Summarize Spider SQL-AST shapes by database."""

import argparse
import json
import re
from collections import Counter, defaultdict
from pathlib import Path


ROOT = Path(__file__).resolve().parent
WHERE_OPS = ("not", "between", "eq", "gt", "lt", "ge", "le", "ne", "in", "like", "is", "exists")


def normalized_sql(query: str) -> str:
    return re.sub(r"\s+", " ", query.strip().lower())


def query_features(sql: dict) -> set[str]:
    features: set[str] = set()
    for operation in ("intersect", "except", "union"):
        if sql.get(operation):
            features.add(f"set_{operation}")
            features.update(query_features(sql[operation]))

    table_units = sql["from"]["table_units"]
    table_count = sum(unit[0] == "table_unit" for unit in table_units)
    if table_count >= 2:
        features.add("join")
    if table_count >= 3:
        features.add("join_3plus")
    for kind, value in table_units:
        if kind == "sql":
            features.add("from_subquery")
            features.update(query_features(value))

    if sql["select"][0]:
        features.add("select_distinct")
    if any(item[0] != 0 for item in sql["select"][1]):
        features.add("select_aggregate")
    if any(item[1][0] != 0 for item in sql["select"][1]):
        features.add("arithmetic")
    if sql.get("groupBy"):
        features.add("group_by")
    if sql.get("having"):
        features.add("having")
    if sql.get("orderBy"):
        features.add("order_by")
    if sql.get("limit") is not None:
        features.add("limit")

    for clause_name in ("where", "having"):
        clause = sql.get(clause_name, [])
        if "or" in clause:
            features.add("boolean_or")
        if "and" in clause:
            features.add("boolean_and")
        for condition in clause:
            if not isinstance(condition, list):
                continue
            negated, operator, value_unit, left_value, right_value = condition
            features.add(f"predicate_{WHERE_OPS[operator]}")
            if negated:
                features.add("predicate_negated")
            if value_unit[0] != 0:
                features.add("arithmetic")
            for value in (left_value, right_value):
                if isinstance(value, dict):
                    features.add("scalar_subquery")
                    features.update(query_features(value))
    return features


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--baseline", help="report features absent from this database")
    args = parser.parse_args()

    examples = json.loads((ROOT / "dev.json").read_text(encoding="utf-8"))
    schemas = {
        schema["db_id"]: schema
        for schema in json.loads((ROOT / "tables.json").read_text(encoding="utf-8"))
    }
    by_database: dict[str, list[dict]] = defaultdict(list)
    for example in examples:
        by_database[example["db_id"]].append(example)

    feature_sets = {
        database: set().union(*(query_features(example["sql"]) for example in rows))
        for database, rows in by_database.items()
    }
    baseline = feature_sets.get(args.baseline, set())
    output = []
    for database, rows in sorted(by_database.items()):
        schema = schemas[database]
        counts = Counter(feature for row in rows for feature in query_features(row["sql"]))
        output.append(
            {
                "database": database,
                "questions": len(rows),
                "sql_groups": len({normalized_sql(row["query"]) for row in rows}),
                "tables": len(schema["table_names_original"]),
                "columns": len(schema["column_names_original"]) - 1,
                "foreign_keys": len(schema["foreign_keys"]),
                "features": dict(sorted(counts.items())),
                "features_absent_from_baseline": sorted(feature_sets[database] - baseline),
            }
        )
    print(json.dumps(output, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
