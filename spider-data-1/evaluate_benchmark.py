#!/usr/bin/env python3
"""Compare completed Labflow benchmark queries by SQLite result bag equality."""

import argparse
from collections import Counter
import json
from pathlib import Path
import sqlite3
import sys


def arguments() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("benchmark", type=Path, help="Labflow benchmark SQLite database")
    parser.add_argument("opencode", type=Path, help="OpenCode SQLite database")
    parser.add_argument("database", type=Path, help="Spider domain SQLite database")
    parser.add_argument("--round", type=int, default=1, dest="round_id")
    parser.add_argument("--ok-path", required=True, help="Workspace-relative ok.json path")
    parser.add_argument("--selector", type=Path, help="Write failing IDs as a Labflow selector")
    parser.add_argument("--output", type=Path, help="Persist the live fidelity report")
    return parser.parse_args()


def candidate_for_turn(
    opencode: sqlite3.Connection,
    session_id: str,
    started_at: int,
    finished_at: int,
    ok_path: str,
) -> dict:
    candidates = []
    for (raw,) in opencode.execute(
        """
        SELECT data FROM part
        WHERE session_id = ? AND time_created BETWEEN ? AND ?
        ORDER BY time_created
        """,
        (session_id, started_at, finished_at + 2_000),
    ):
        part = json.loads(raw)
        state = part.get("state", {})
        path = state.get("input", {}).get("filePath", "")
        if (
            part.get("type") == "tool"
            and part.get("tool") == "read"
            and state.get("status") == "completed"
            and path.replace("\\", "/").endswith("/" + ok_path)
        ):
            preview = state.get("metadata", {}).get("preview")
            if preview:
                candidates.append(json.loads(preview))
    if not candidates:
        raise ValueError(f"no successful read of {ok_path} in turn")
    candidate = candidates[-1]
    if set(candidate) != {"sql", "bindings"}:
        raise ValueError("ok.json must contain exactly sql and bindings")
    return candidate


def result_bag(database: sqlite3.Connection, sql: str, bindings: list) -> Counter:
    return Counter(database.execute(sql, bindings).fetchall())


def merge_live_report(output: Path, report: dict) -> dict:
    if not output.exists():
        return report
    previous = json.loads(output.read_text(encoding="utf-8"))
    if previous.get("round") != report["round"]:
        return report

    prior_by_id = {item["id"]: item for item in previous.get("results", [])}
    merged = []
    for item in report["results"]:
        error = item.get("error", "")
        if error.startswith("no successful read of ") and item["id"] in prior_by_id:
            merged.append(prior_by_id[item["id"]])
        else:
            merged.append(item)

    failures = [item["id"] for item in merged if not item["passed"]]
    report.update(
        evaluated=len(merged),
        passed=len(merged) - len(failures),
        failed=len(failures),
        failures=failures,
        results=merged,
    )
    return report


def main() -> int:
    args = arguments()
    benchmark = sqlite3.connect(args.benchmark)
    opencode = sqlite3.connect(args.opencode)
    database = sqlite3.connect(args.database)

    round_row = benchmark.execute(
        "SELECT session_id, status FROM bench_round WHERE id = ?", (args.round_id,)
    ).fetchone()
    if round_row is None:
        raise SystemExit(f"benchmark round {args.round_id} does not exist")
    session_id, round_status = round_row
    if not session_id:
        raise SystemExit(
            "benchmark session has been removed; evaluate with --output while the round is live"
        )

    rows = benchmark.execute(
        """
        SELECT q.question_id, q.reference_answer, t.started_at, t.finished_at
        FROM question q
        JOIN turn t
          ON t.bench_round_id = q.bench_round_id
         AND t.question_id = q.question_id
        WHERE q.bench_round_id = ? AND q.status = 'archived'
          AND t.status = 'completed'
          AND t.turn_index = (
            SELECT max(t2.turn_index) FROM turn t2
            WHERE t2.bench_round_id = t.bench_round_id
              AND t2.question_id = t.question_id
              AND t2.status = 'completed'
          )
        ORDER BY q.ordinal
        """,
        (args.round_id,),
    ).fetchall()

    results = []
    for question_id, reference, started_at, finished_at in rows:
        item = {"id": question_id}
        try:
            candidate = candidate_for_turn(
                opencode, session_id, started_at, finished_at, args.ok_path
            )
            expected = result_bag(database, reference, [])
            actual = result_bag(database, candidate["sql"], candidate["bindings"])
            item.update(
                passed=actual == expected,
                sql=candidate["sql"],
                bindings=candidate["bindings"],
                expected_rows=sum(expected.values()),
                actual_rows=sum(actual.values()),
            )
        except (json.JSONDecodeError, sqlite3.Error, TypeError, ValueError) as error:
            item.update(passed=False, error=str(error))
        results.append(item)

    failures = [item["id"] for item in results if not item["passed"]]
    report = {
        "round": args.round_id,
        "round_status": round_status,
        "evaluated": len(results),
        "passed": len(results) - len(failures),
        "failed": len(failures),
        "failures": failures,
        "results": results,
    }
    if args.output:
        report = merge_live_report(args.output, report)
    rendered = json.dumps(report, indent=2, ensure_ascii=True) + "\n"
    print(rendered, end="")
    if args.output:
        args.output.write_text(rendered, encoding="utf-8")
    if args.selector:
        args.selector.write_text(
            json.dumps({"only": failures}, indent=2, ensure_ascii=True) + "\n",
            encoding="utf-8",
        )
    return bool(failures)


if __name__ == "__main__":
    sys.exit(main())
