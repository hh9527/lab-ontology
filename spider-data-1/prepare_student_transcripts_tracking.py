#!/usr/bin/env python3
"""Build a deterministic, SQL-group-isolated modeling/evaluation split."""

import hashlib
import json
import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent
DB_ID = "student_transcripts_tracking"


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
    modeling_groups = ordered_groups[:24]
    evaluation_groups = ordered_groups[24:]

    def records(selected: list[list[tuple[int, dict]]], partition: str) -> list[dict]:
        result = []
        for index, row in sorted((item for group in selected for item in group)):
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

    assert len(groups) == 39
    assert sum(map(len, modeling_groups)) == 48
    assert sum(map(len, evaluation_groups)) == 30


if __name__ == "__main__":
    main()
