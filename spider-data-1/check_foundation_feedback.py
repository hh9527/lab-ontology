#!/usr/bin/env python3
"""Ensure the active foundation feedback has concrete code, docs, and tests."""

import argparse
from pathlib import Path
import re
import sys


def contains(path: str, pattern: str) -> bool:
    return re.search(pattern, Path(path).read_text(encoding="utf-8"), re.IGNORECASE) is not None


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("phase", choices=("query", "ontology"))
    args = parser.parse_args()

    if args.phase == "query":
        requirements = [
            ("ontology/src/query.telora", r"scalar.{0,40}subquery"),
            ("ontology/docs/QUERY.md", r"scalar.{0,40}subquery|标量.{0,20}子查询"),
            ("ontology/tests/query.telora", r"scalar.{0,40}subquery"),
        ]
    else:
        requirements = [
            ("ontology/src/ontology.telora", r"lower_hidden_having"),
            ("ontology/src/ontology.telora", r"scalar.{0,40}subquery"),
            ("ontology/docs/ONTOLOGY.md", r"scalar.{0,40}subquery|标量.{0,20}子查询"),
            ("ontology/tests/ontology.telora", r"scalar.{0,40}subquery"),
        ]

    missing = [path for path, pattern in requirements if not contains(path, pattern)]
    if missing:
        print(
            f"{args.phase} feedback contract is not implemented in: {', '.join(missing)}",
            file=sys.stderr,
        )
        return 1
    print(f"{args.phase} feedback contract present in code, docs, and tests")
    return 0


if __name__ == "__main__":
    sys.exit(main())
