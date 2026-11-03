#!/usr/bin/env python3
"""只验证 property 新路径：局部边界诊断及实际 SQLite 查询。"""
import json
import os
from pathlib import Path
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
COMPILER = os.environ.get("TELORA", str(ROOT / "bin/telora"))
OPTIONS = ["--initialization-fuel", "100000", "--request-fuel", "1000000", "--with-memory-limit", "1024"]
for name in ["trusted_boundary", "local_preparation"]:
    result = subprocess.run([COMPILER, "-C", str(ROOT / "ontology"), "test", name, *OPTIONS],
                            capture_output=True, text=True, timeout=180)
    records = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    summaries = [record for record in records if record.get("record") == "summary"]
    assert result.returncode == 0 and len(summaries) == 1, (result.stdout, result.stderr)
    assert summaries[0]["failed"] == 0 and not summaries[0]["aborted"], summaries
    print(f"Passed {summaries[0]['passed']} {name} cases", flush=True)
with tempfile.TemporaryDirectory(prefix="relation-property-") as directory:
    artifact = Path(directory) / "relation.wasm"
    subprocess.run([COMPILER, "-C", str(ROOT / "relation_model"), "build", "relation_model", "--staged", "-o", str(artifact)], check=True)
    cases = json.loads((ROOT / "relation_model/tests/property-runtime.json").read_text())
    requests = [{"method": "relation/transform", "input": {"intents": [case["intent"]]}} for case in cases]
    result = subprocess.run([str(ROOT / "bin/telora-run"), str(artifact), "--serve", "stdio+jsonl://"],
                            input="".join(json.dumps(request) + "\n" for request in requests),
                            capture_output=True, text=True, timeout=120, check=True)
    responses = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    assert len(responses) == len(cases), (result.stdout, result.stderr)
    queries = []
    for case, response in zip(cases, responses):
        assert response.get("error") is False and response["ok"]["accepted"], response
        queries.append({"id": case["id"], "typed": response["ok"]["queries"][0]})
    path = Path(directory) / "queries.json"
    path.write_text(json.dumps(queries))
    subprocess.run(["node", str(ROOT / "relation_model/tests/typed-relations-runtime.mjs"), str(path)], check=True)
