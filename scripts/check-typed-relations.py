#!/usr/bin/env python3
"""在隔离工作区对新关系声明运行现有 graph 验收及 SQLite 等价查询。"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
TEMP_ROOT = Path(os.environ.get("TMPDIR") or Path.home() / ".cache/tmp")
with tempfile.TemporaryDirectory(prefix="typed-relations-", dir=TEMP_ROOT) as directory:
    workspace = Path(directory)
    packages = ["ontology", "relation_model"]
    (workspace / "telora-config.json").write_text(json.dumps({"version": 1, "members": packages}))
    lock = json.loads((ROOT / "telora-lock.json").read_text())
    lock["packages"] = {name: lock["packages"][name] for name in packages}
    (workspace / "telora-lock.json").write_text(json.dumps(lock))
    for package in packages:
        target = workspace / package
        target.mkdir()
        shutil.copy2(ROOT / package / "telora-crate.json", target / "telora-crate.json")
        shutil.copytree(ROOT / package / "src", target / "src")
    tests = workspace / "relation_model/tests"
    tests.mkdir()
    graph = (ROOT / "relation_model/tests/graph.telora").read_text()
    original = "use crate::model::{ payload, Tenant, Site, Device, Connection, Route };"
    assert graph.count(original) == 1, "graph fixture import changed; update the explicit payload substitution"
    graph = graph.replace(original, "use crate::model::{ Tenant, Site, Device, Connection, Route };\nuse crate::typed_relations::{ payload };")
    (tests / "typed_graph_regression.telora").write_text(graph)
    shutil.copy2(ROOT / "relation_model/tests/typed_relations.telora", tests / "typed_relations.telora")
    compiler = os.environ.get("TELORA", str(ROOT / "bin/telora"))
    options = ["--initialization-fuel", "100000", "--request-fuel", "1000000", "--with-memory-limit", "1024"]
    result = subprocess.run([compiler, "-C", str(workspace / "relation_model"), "test", "typed_graph_regression", *options],
                            capture_output=True, text=True, timeout=180)
    records = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    summaries = [record for record in records if record.get("record") == "summary"]
    assert result.returncode == 0 and len(summaries) == 1 and summaries[0]["total"] > 0, (result.stdout, result.stderr)
    assert summaries[0]["failed"] == 0 and not summaries[0]["aborted"], summaries
    print(f"Passed {summaries[0]['passed']} existing graph cases with the typed relation payload", flush=True)
    exported = subprocess.run([compiler, "-C", str(workspace / "relation_model"), "eval", "@test/typed_relations:runtime_cases", *options],
                              capture_output=True, text=True, timeout=120, check=True)
    queries = workspace / "queries.json"
    queries.write_text(exported.stdout)
    subprocess.run(["node", str(ROOT / "relation_model/tests/typed-relations-runtime.mjs"), str(queries)], check=True)
