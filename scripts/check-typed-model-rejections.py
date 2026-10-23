#!/usr/bin/env python3
"""在临时工作区核验 RFC 0002 原型的编译期类型拒绝，不污染正常测试发现。"""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[1]
temp_root = Path(os.environ.get("TMPDIR") or Path.home() / ".cache/tmp")
cases = {
    "nominal_value": 'pub def bad: f::DeviceId = f::TenantId("T1");',
    "identity_member": """pub def bad: model::IdentityPart(f::Inventory, f::DeviceIdentity) = model::identity_part(
        model::field(f::Inventory.type, f::TenantId.type, "tenant"),
        model::field(f::DeviceIdentity.type, f::DeviceId.type, "local"));""",
    "dataset_owner": """pub def bad: model::Role(f::Sample) = model::role(f::samples, f::device, "device", False,
        f::inventory_parts);""",
    "entity_identity": """pub def bad: model::Role(f::Inventory) = model::role(f::inventory, f::site, "site", False,
        f::inventory_parts);""",
}
with tempfile.TemporaryDirectory(prefix="typed-model-rejections-", dir=temp_root) as directory:
    workspace = Path(directory)
    (workspace / "telora-config.json").write_text(json.dumps({
        "version": 1, "members": ["ontology", "relation_model"],
    }))
    lock = json.loads((ROOT / "telora-lock.json").read_text())
    lock["packages"] = {name: lock["packages"][name] for name in ["ontology", "relation_model"]}
    (workspace / "telora-lock.json").write_text(json.dumps(lock))
    for crate in ["ontology", "relation_model"]:
        target = workspace / crate
        target.mkdir()
        shutil.copy2(ROOT / crate / "telora-crate.json", target / "telora-crate.json")
        shutil.copytree(ROOT / crate / "src", target / "src")
    tests = workspace / "relation_model/tests"
    tests.mkdir()
    prelude = "mod fixture;\nuse self::fixture as f;\nuse ontology::experimental::model as model;\n"
    # 先用同一映射的合法版本确认测试工作区可解析和类型闭包成立。
    control = prelude + "pub def good: model::Role(f::Inventory) = model::role(f::inventory, f::device, \"device\", False, f::inventory_parts);\n"
    for name, body in [("control", control), *[(name, prelude + body) for name, body in cases.items()]]:
        (tests / name).mkdir()
        shutil.copy2(ROOT / "relation_model/tests/typed_model/fixture.telora", tests / name / "fixture.telora")
        (tests / f"{name}.telora").write_text(body)
        result = subprocess.run([
            str(ROOT / "bin/telora"), "-C", str(workspace / "relation_model"),
            "check", f"@test/{name}", "--only-types",
        ], capture_output=True, text=True, timeout=120)
        records = [json.loads(line) for line in result.stdout.splitlines() if line.strip()]
        errors = [item for item in records if item.get("severity") == "error"]
        if name == "control":
            assert result.returncode == 0 and not errors, (result.stdout, result.stderr)
        else:
            assert result.returncode != 0 and errors, (name, result.stdout, result.stderr)
            assert any(item.get("locs") and item["locs"][0]["source"].endswith(name)
                       for item in errors), (name, errors)
            print(f"Passed static rejection: {name}")
print("Passed: valid control and four nominal/owner/identity type rejections")
