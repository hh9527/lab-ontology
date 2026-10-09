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
assert summary["total"] == summary["failed"] == 4 and summary["passed"] == 0, summary

expected = {
    ("limit", (0,)): ("pagination value must be non-negative", "ontology/query"),
    ("offset", (0,)): ("pagination value must be non-negative", "ontology/query"),
    ("missing_field", (0,)): ("intent field is missing: op", "ontology/intent"),
    ("duplicate_mapping", ()): ("union branch maps the same logical field more than once", "ontology/ontology"),
}
seen = set()


def source_text(loc, case):
    source = loc["source"]
    if source.startswith("@test-ctx/"):
        path = ROOT / "ontology/tests/diagnostics" / case["sources"][0]
    elif source.startswith("ontology/tests/"):
        path = ROOT / (source + ".telora")
    else:
        path = ROOT / "ontology/src" / (source.removeprefix("ontology/") + ".telora")
    lines = path.read_bytes().splitlines(keepends=True)
    location = loc["location"]
    start = sum(map(len, lines[:location["line"] - 1])) + location["column"]
    end = sum(map(len, lines[:location["end_line"] - 1])) + location["end_column"]
    return b"".join(lines)[start:end].decode()


for item in records:
    if item["record"] != "diagnostic" or item["severity"] != "error":
        continue
    key = (item["test"], tuple(item["fixtures"]))
    message, rule = expected[key]
    assert item["phase"] == "execution" and item["message"] == message, item
    locs = item["locs"]
    assert locs and locs[0]["source"] == rule, item
    subjects = locs[1:]
    if key[0] == "duplicate_mapping":
        authored = [loc for loc in subjects if loc["source"] == "ontology/tests/diagnostics/rejections"]
        assert len(authored) == 2 and len({loc["location"]["line"] for loc in authored}) == 2, item
        assert [source_text(loc, item) for loc in authored] == ["0", "0"], item
    else:
        authored = [loc for loc in subjects if loc["source"].startswith("@test-ctx/")]
        expected_text = {("limit", (0,)): "-1", ("offset", (0,)): "-1", ("missing_field", (0,)): '{"limit":1000}'}
        assert [source_text(loc, item) for loc in authored] == [expected_text[key]], item
    seen.add(key)
assert seen == expected.keys(), (seen, expected.keys())
print("4 diagnostic cases passed: messages, rule-first locations and ordered subject spans")
