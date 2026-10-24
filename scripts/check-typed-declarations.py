#!/usr/bin/env python3
"""在隔离工作区验证 Property 支撑的建模 trait 及缺失证据诊断。"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
TEMP_ROOT = Path(os.environ.get("TMPDIR") or Path.home() / ".cache/tmp")
COMPILER = os.environ.get("TELORA", str(ROOT / "bin/telora"))
OPTIONS = ["--initialization-fuel", "100000", "--request-fuel", "1000000", "--with-memory-limit", "1024"]
with tempfile.TemporaryDirectory(prefix="typed-declarations-", dir=TEMP_ROOT) as directory:
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
    shutil.copy2(ROOT / "relation_model/tests/typed_declarations.telora", tests / "typed_declarations.telora")
    result = subprocess.run([COMPILER, "-C", str(workspace / "relation_model"), "test", "typed_declarations", *OPTIONS],
                            capture_output=True, text=True, timeout=180)
    summaries = [r for line in result.stdout.splitlines() if (r := json.loads(line)).get("record") == "summary"]
    assert result.returncode == 0 and len(summaries) == 1, (result.stdout, result.stderr)
    assert summaries[0]["total"] == 4 and summaries[0]["failed"] == 0 and not summaries[0]["aborted"], summaries
    print("Passed 4 declaration evidence cases", flush=True)
    prelude = "use ontology::experimental::declarations as d;\nuse ontology::ontology as edsl;\n"
    cases = {
        "missing_entity": ('type Row = struct { id: String };\npub def bad = d::entity(Row.type);', "does not implement EntityModel"),
        "missing_source": ('@edsl::entity_id("row")\ntype Row = struct { id: String };\npub def bad = d::dataset(Row.type);', "does not implement DatasetModel"),
        "missing_id": ('@edsl::entity_source("rows", "r")\ntype Row = struct { id: String };\npub def bad = d::dataset(Row.type);', "does not implement DatasetModel"),
    }
    for name, (body, diagnostic) in cases.items():
        (tests / f"{name}.telora").write_text(prelude + body + "\n")
        result = subprocess.run([COMPILER, "-C", str(workspace / "relation_model"), "eval", f"@test/{name}:bad", *OPTIONS],
                                capture_output=True, text=True, timeout=120)
        assert result.returncode != 0 and diagnostic in result.stdout + result.stderr, (name, result.stdout, result.stderr)
        print(f"Rejected {name} with expected evidence diagnostic", flush=True)
