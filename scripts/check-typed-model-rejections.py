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
    "numeric_group_value_type": 'pub def bad: g::Binding(gf::MillisRow) = g::numeric_binding(gf::millis, g::numeric_group("rates", q::BytesPerSecond.type, [g::Statistic::Mean]), gf::ms_amount, [{member: g::Statistic::Mean, publish: "rate"}]);',
    "sample_quantity_type": 'pub def bad: ontology::experimental::samples::Binding(gf::MillisRow) = ontology::experimental::samples::bind(gf::millis, ontology::experimental::samples::group("rate", q::BytesPerSecond.type, ontology::experimental::samples::Statistic::Mean, [], None), model::optional_field(gf::MillisRow.type, q::Bytes.type, "rx"), []);',
    "utc_local_clock_type": 'pub def bad: ontology::experimental::scalars::EpochMillis = ontology::experimental::scalars::DateTime("2024-02-29 12:00:00");',
    "ipv4_requires_text": 'pub def bad: g::Expr(gf::MillisRow, ontology::experimental::scalars::Ipv4) = g::ipv4(gf::ms_amount);',
    "column_row_owner": 'pub def bad: transform::ColumnMapping(gf::SecondsRow) = transform::column(model::field(gf::MillisRow.type, q::Bytes.type, "tx"), "BYTES");',
    "nominal_value": 'pub def bad: f::DeviceId = f::TenantId("T1");',
    "identity_member": """pub def bad: model::IdentityPart(f::Inventory, f::DeviceIdentity) = model::identity_part(
        model::field(f::Inventory.type, f::TenantId.type, "tenant"),
        model::field(f::DeviceIdentity.type, f::DeviceId.type, "local"));""",
    "dataset_owner": """pub def bad: model::Role(f::Sample) = model::role(f::samples, f::device, "device", False,
        f::inventory_parts);""",
    "entity_identity": """pub def bad: model::Role(f::Inventory) = model::role(f::inventory, f::site, "site", False,
        f::inventory_parts);""",
    "duration_unit": "pub def bad: Option(q::BytesPerSecond) = q::rate(q::Bytes(1.0), q::Milliseconds(1000.0));",
    "amount_unit": "pub def bad: q::Bytes = q::add_bytes(q::Bytes(1.0), q::Seconds(1.0));",
    "rate_result": "pub def bad: Option(q::Bytes) = q::rate(q::Bytes(1.0), q::Seconds(1.0));",
    "group_duration_unit": """pub def bad: g::Binding(gf::MillisRow) = g::transfer_binding(gf::millis, g::transfer,
        gf::ms_amount, g::input(model::optional_field(gf::MillisRow.type, q::Milliseconds.type, "elapsed_ms")), gf::names("rx"));""",
    "group_row_owner": """pub def bad: g::Binding(gf::SecondsRow) = g::transfer_binding(gf::secs, g::transfer,
        gf::ms_amount, gf::ms_duration, gf::names("rx"));""",
    "group_category_type": """pub def bad: g::Binding(gf::MillisRow) = g::dimension(gf::millis, gf::category,
        g::input(model::optional_field(gf::MillisRow.type, String.type, "name")), "category", True, []);""",
    "relation_role_owner": """pub def bad: r::Relation = r::relation("wrong", f::samples, f::device_role,
        f::inventory, f::device_role, {from: edsl::Cardinality::Many0, to: edsl::Cardinality::Optional});""",
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
    prelude = "mod fixture;\nmod group_fixture;\nuse self::fixture as f;\nuse self::group_fixture as gf;\nuse ontology::experimental::model as model;\nuse ontology::experimental::quantity as q;\nuse ontology::experimental::groups as g;\n"
    prelude += "use ontology::experimental::relations as r;\nuse ontology::experimental::transform as transform;\nuse ontology::ontology as edsl;\n"
    # 先用同一映射的合法版本确认测试工作区可解析和类型闭包成立。
    control = prelude + "pub def good: model::Role(f::Inventory) = model::role(f::inventory, f::device, \"device\", False, f::inventory_parts);\n"
    control += 'pub def group_good: g::Binding(gf::MillisRow) = g::transfer_binding(gf::millis, g::transfer, gf::ms_amount, gf::ms_duration, gf::names("rx"));\n'
    control += 'pub def column_good: transform::ColumnMapping(gf::MillisRow) = transform::column(model::field(gf::MillisRow.type, q::Bytes.type, "tx"), "BYTES");\n'
    for name, body in [("control", control), *[(name, prelude + body) for name, body in cases.items()]]:
        (tests / name).mkdir()
        shutil.copy2(ROOT / "relation_model/tests/typed_model/fixture.telora", tests / name / "fixture.telora")
        shutil.copy2(ROOT / "relation_model/tests/typed_groups/fixture.telora", tests / name / "group_fixture.telora")
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
print(f"Passed: valid control and {len(cases)} nominal/owner/identity/unit type rejections")
