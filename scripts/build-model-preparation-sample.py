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
parser.add_argument("--telora", type=Path, help="实验编译器路径；默认使用仓库 bin/telora")
parser.add_argument("--mode", "--snapshot", dest="mode", choices=["runtime", "full"], default="runtime", help="staged 运行制品或完整状态对照；--snapshot 是旧测量参数别名")
parser.add_argument("--without-knowledge", action="store_true", help="仅在隔离副本禁用知识发布，用于成本对照")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]
compiler = (args.telora or root / "bin/telora").resolve()
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
    path = workspace / "ontology/src/transform.telora"
    code = path.read_text()
    call = "build_impl(revision, declarations, relations, alternatives, links, profile, False)"
    assert call in code
    code = code.replace(call,
        "self_check(revision, declarations, relations, alternatives, links, profile);\n    " + call, 1)
    path.write_text(code)

if args.without_knowledge:
    path = workspace / args.package / "src/lib.telora"
    source = path.read_text()
    line = 'use ontology::world as build;\n'
    assert source.count(line) == 1
    expression = 'build::stage_prepared(build::define(prepared.payload.revision, prepared.declarations, prepared.relations, prepared.alternatives, [], prepared.payload.profile), fn() { prepared }, fn(payload) {\n    intent::query_request_method_factory(payload, sqlite::build_query)\n})'
    assert source.count(expression) == 1
    path.write_text(source.replace(line, '').replace(expression,
        'intent::query_request_method_factory(prepared.payload, sqlite::build_query)'))

expected_model_hash = source_hash(workspace / args.package / "src")

artifact = workspace / f"{args.package}.wasm"
print(json.dumps({"workspace": str(workspace), "artifact": str(artifact),
                  "selfCheck": args.self_check, "snapshotMode": args.mode, "knowledgeEnabled": not args.without_knowledge,
                  "compiler": str(compiler), "modelSourceHash": model_hash}), flush=True)
started = time.monotonic()
with (workspace / "build.log").open("w") as log:
    result = subprocess.run([str(compiler), "-C", str(workspace / args.package),
        "build", args.package, f"--staged={args.mode}",
        "-o", str(artifact), "--initialization-fuel", "400000",
        "--request-fuel", "100000", "--with-memory-limit", "2048", "--report-usage"],
        stdout=log, stderr=log, timeout=600)
assert result.returncode == 0, (workspace / "build.log").read_text()
assert source_hash(workspace / args.package / "src") == expected_model_hash
phases = {}
specialization = None
for line in (workspace / "build.log").read_text().splitlines():
    if line.startswith("{"):
        record = json.loads(line)
        if record.get("code") == "build-phase-timing":
            phases[record["phase"]] = record["elapsed_seconds"]
        if record.get("schema") == "telora.runtime-specialization/v1":
            specialization = record
report = {"artifact": str(artifact), "bytes": artifact.stat().st_size, "selfCheck": args.self_check,
          "modelSourceHash": model_hash, "snapshotMode": args.mode, "knowledgeEnabled": not args.without_knowledge, "wallSeconds": time.monotonic() - started, "phases": phases,
          "compiler": str(compiler), "specialization": specialization}
(workspace / "measurement.json").write_text(json.dumps(report, indent=2) + "\n")
print(json.dumps(report))
