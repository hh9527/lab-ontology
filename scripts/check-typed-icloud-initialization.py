#!/usr/bin/env python3
"""在不含旧 IC 模型的临时工作区验证 typed 入口独立初始化。"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
TEMP_ROOT = Path(os.environ.get("TMPDIR") or Path.home() / ".cache/tmp")
with tempfile.TemporaryDirectory(prefix="typed-icloud-init-", dir=TEMP_ROOT) as directory:
    workspace = Path(directory)
    packages = ["ontology", "icloud_model"]
    (workspace / "telora-config.json").write_text(json.dumps({"version": 1, "members": packages}))
    lock = json.loads((ROOT / "telora-lock.json").read_text())
    lock["packages"] = {name: lock["packages"][name] for name in packages}
    (workspace / "telora-lock.json").write_text(json.dumps(lock))
    for package in packages:
        target = workspace / package
        target.mkdir()
        shutil.copy2(ROOT / package / "telora-crate.json", target / "telora-crate.json")
    shutil.copytree(ROOT / "ontology/src", workspace / "ontology/src")
    source = workspace / "icloud_model/src"
    source.mkdir()
    (source / "lib.telora").write_text("pub mod typed;\n")
    shutil.copy2(ROOT / "icloud_model/src/typed.telora", source / "typed.telora")
    shutil.copytree(ROOT / "icloud_model/src/typed", source / "typed")
    result = subprocess.run([
        str(ROOT / "bin/telora"), "-C", str(workspace / "icloud_model"), "check", "@src/typed",
        "--initialization-fuel", "350000", "--with-memory-limit", "2048",
    ], capture_output=True, text=True, timeout=180)
    records = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
    summaries = [record for record in records if record.get("record") == "summary"]
    assert result.returncode == 0 and len(summaries) == 1, (result.stdout, result.stderr)
    assert summaries[0]["status"] == "ok" and not summaries[0]["types_only"], summaries
    assert not any(record.get("severity") == "error" for record in records), records
    print("Passed independent typed IC initialization with the legacy model and service absent")
