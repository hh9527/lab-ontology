#!/usr/bin/env python3
"""Verify intentionally failing Telora cases via the public CLI JSONL contract."""
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
result = subprocess.run(
    [str(ROOT / "bin/telora"), "-C", str(ROOT / "ontology"), "test", "diagnostics/rejections"],
    capture_output=True, text=True, timeout=120,
)
records = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
summary = next(item for item in records if item["record"] == "summary")
assert result.returncode == 1 and not summary["aborted"], (result.stdout, result.stderr)
assert summary["total"] == summary["failed"] == 6 and summary["passed"] == 0, summary

expected = {
    ("partition", (0,)): ("partition take must be a positive integer within the upper bound", "ontology/tests/diagnostics/rejections"),
    ("partition", (1,)): ("partition must name at least one dimension", "ontology/tests/diagnostics/rejections"),
    ("limit", (0,)): ("plan limit must be non-negative", "ontology/query"),
    ("offset", (0,)): ("plan offset must be non-negative", "ontology/query"),
    ("missing_field", (0,)): ("intent field is missing", "ontology/intent"),
    ("duplicate_mapping", ()): ("union branch maps the same logical field more than once", "ontology/edsl"),
}
seen = set()


def source_text(label, case):
    source = label["source"]
    if source.startswith("@test-ctx/"):
        path = ROOT / "ontology/tests/diagnostics" / case["sources"][0]
    elif source.startswith("ontology/tests/"):
        path = ROOT / (source + ".telora")
    else:
        path = ROOT / "ontology/src" / (source.removeprefix("ontology/") + ".telora")
    lines = path.read_bytes().splitlines(keepends=True)
    location = label["location"]
    start = sum(map(len, lines[:location["line"] - 1])) + location["column"]
    end = sum(map(len, lines[:location["end_line"] - 1])) + location["end_column"]
    return b"".join(lines)[start:end].decode()


for item in records:
    if item["record"] != "diagnostic" or item["severity"] != "error":
        continue
    key = (item["test"], tuple(item["fixtures"]))
    message, rule = expected[key]
    assert item["phase"] == "execution" and item["message"] == message, item
    labels = item["labels"]
    assert any(label["primary"] and label["source"] == rule for label in labels), item
    subjects = [label for label in labels if not label["primary"]]
    if key[0] == "duplicate_mapping":
        authored = [label for label in subjects if label["source"] == "ontology/tests/diagnostics/rejections"]
        assert len(authored) == 2 and len({label["location"]["line"] for label in authored}) == 2, item
        assert [source_text(label, item) for label in authored] == ["0", "0"], item
    else:
        authored = [label for label in subjects if label["source"].startswith("@test-ctx/")]
        expected_text = {("partition", (0,)): "0", ("partition", (1,)): "[]",
                         ("limit", (0,)): "-1", ("offset", (0,)): "-1", ("missing_field", (0,)): "{}"}
        assert [source_text(label, item) for label in authored] == [expected_text[key]], item
    seen.add(key)
assert seen == expected.keys(), (seen, expected.keys())
print("6 diagnostic cases passed: messages, execution phase, rule modules and exact subject spans")
