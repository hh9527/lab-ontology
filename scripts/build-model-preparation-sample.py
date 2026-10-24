#!/usr/bin/env python3
"""隔离构建未修改的模型；可显式对同一 root 执行 ontology 自检。"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser()
parser.add_argument("package")
parser.add_argument("--self-check", action="store_true")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
assert args.package in json.loads((root / "telora-config.json").read_text())["members"]
temporary = Path(os.environ.get("TMPDIR") or Path.home() / ".cache/tmp")
temporary.mkdir(parents=True, exist_ok=True)
workspace = Path(tempfile.mkdtemp(prefix="model-preparation-", dir=temporary))
packages = ["ontology", args.package]
for name in packages:
    (workspace / name).mkdir()
    shutil.copy2(root / name / "telora-crate.json", workspace / name / "telora-crate.json")
    shutil.copytree(root / name / "src", workspace / name / "src")
(workspace / "telora-config.json").write_text(json.dumps({"version": 1, "members": packages}))
lock = json.loads((root / "telora-lock.json").read_text())
lock["packages"] = {name: lock["packages"][name] for name in packages}
(workspace / "telora-lock.json").write_text(json.dumps(lock))

def source_hash(directory):
    files = [(str(path.relative_to(directory)), hashlib.sha256(path.read_bytes()).hexdigest())
             for path in sorted(directory.rglob("*")) if path.is_file()]
    return hashlib.sha256(json.dumps(files).encode()).hexdigest()

model_hash = source_hash(root / args.package / "src")
assert source_hash(workspace / args.package / "src") == model_hash
if args.self_check:
    # 通用测试驱动：只改变隔离库的 root 包装器，不修改模型声明或模型服务。
    path = workspace / "ontology/src/experimental/transform.telora"
    code = path.read_text()
    call = "build_impl(revision, declarations, relations, alternatives, links, profile, False)"
    assert call in code
    code = code.replace(call,
        "self_check(revision, declarations, relations, alternatives, links, profile);\n    " + call, 1)
    path.write_text(code)

artifact = workspace / f"{args.package}.wasm"
print(json.dumps({"workspace": str(workspace), "artifact": str(artifact),
                  "selfCheck": args.self_check, "modelSourceHash": model_hash}), flush=True)
started = time.monotonic()
with (workspace / "build.log").open("w") as log:
    result = subprocess.run([str(root / "bin/telora"), "-C", str(workspace / args.package),
        "build", args.package, "--snapshot", "-o", str(artifact), "--initialization-fuel", "400000",
        "--request-fuel", "100000", "--with-memory-limit", "2048", "--report-usage"],
        stdout=log, stderr=log, timeout=600)
assert result.returncode == 0, (workspace / "build.log").read_text()
assert source_hash(workspace / args.package / "src") == model_hash
phases = {}
for line in (workspace / "build.log").read_text().splitlines():
    if line.startswith("{"):
        record = json.loads(line)
        if record.get("code") == "build-phase-timing":
            phases[record["phase"]] = record["elapsed_seconds"]
report = {"artifact": str(artifact), "bytes": artifact.stat().st_size, "selfCheck": args.self_check,
          "modelSourceHash": model_hash, "wallSeconds": time.monotonic() - started, "phases": phases}
(workspace / "measurement.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
