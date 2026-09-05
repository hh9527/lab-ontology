#!/usr/bin/env python3
"""Build a deterministic, SQL-group-isolated dog_kennels experiment split."""

import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DB_ID = "dog_kennels"
MODELING_GROUPS = 26


def normalized_sql(query: str) -> str:
    return re.sub(r"\s+", " ", query.strip().lower())


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as output:
        for row in rows:
            output.write(json.dumps(row, ensure_ascii=True, separators=(",", ":")) + "\n")


def main() -> None:
    dev = json.loads((ROOT / "dev.json").read_text(encoding="utf-8"))
    tables = json.loads((ROOT / "tables.json").read_text(encoding="utf-8"))
    source = [row for row in dev if row["db_id"] == DB_ID]

    groups: dict[str, list[tuple[int, dict]]] = {}
    for index, row in enumerate(source):
        groups.setdefault(normalized_sql(row["query"]), []).append((index, row))

    ordered_groups = sorted(
        groups.values(),
        key=lambda group: hashlib.sha256(normalized_sql(group[0][1]["query"]).encode()).hexdigest(),
    )
    modeling_groups = ordered_groups[:MODELING_GROUPS]
    evaluation_groups = ordered_groups[MODELING_GROUPS:]

    def records(selected: list[list[tuple[int, dict]]], partition: str) -> list[dict]:
        result = []
        for index, row in sorted(item for group in selected for item in group):
            record = {
                "Q": row["question"],
                "R": row["query"],
                "id": f"{DB_ID}-dev-{index:03d}",
                "tags": [DB_ID, partition],
            }
            if partition == "evaluation":
                record["K"] = None
            result.append(record)
        return result

    schema = next(table for table in tables if table["db_id"] == DB_ID)
    (ROOT / "modeling" / f"{DB_ID}.schema.json").write_text(
        json.dumps(schema, indent=2, ensure_ascii=True) + "\n", encoding="utf-8"
    )
    write_jsonl(ROOT / "modeling" / f"{DB_ID}.examples.jsonl", records(modeling_groups, "modeling"))
    write_jsonl(ROOT / "eval" / f"{DB_ID}.suite-1.jsonl", records(evaluation_groups, "evaluation"))
    (ROOT / "eval" / f"{DB_ID}.selector.json").write_text("{}\n", encoding="utf-8")

    modeling_sql = {normalized_sql(item[1]["query"]) for group in modeling_groups for item in group}
    evaluation_sql = {normalized_sql(item[1]["query"]) for group in evaluation_groups for item in group}
    assert len(source) == 82
    assert len(groups) == 41
    assert len(modeling_sql) == 26
    assert len(evaluation_sql) == 15
    assert modeling_sql.isdisjoint(evaluation_sql)
    assert sum(map(len, modeling_groups)) == 52
    assert sum(map(len, evaluation_groups)) == 30


if __name__ == "__main__":
    main()
