"""Source-policy and refresh regression checks; compiled coverage is audited separately."""

import importlib.util
import json
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
ROOT = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))
from icloud_capabilities import address_view, category

spec = importlib.util.spec_from_file_location("reconcile", SCRIPTS / "reconcile-icloud-capabilities.py")
reconcile = importlib.util.module_from_spec(spec)
spec.loader.exec_module(reconcile)
spec = importlib.util.spec_from_file_location("time_audit", SCRIPTS / "audit-icloud-time.py")
time_audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(time_audit)


def field(name, ty="string", **extra):
    return {"name": name, "type": {"type": ty}, "properties": {}, **extra}


class SourceCapabilities(unittest.TestCase):
    def test_encodings_override_names(self):
        self.assertEqual(category(field("version", "long")), "number")
        self.assertEqual(category(field("name", "uuid")), "identity")
        self.assertEqual(category(field("name", isPK="Y")), "identity")
        self.assertEqual(category(field("name", columnType="timestamp")), "clock")
        self.assertEqual(category(field("name", properties={"dte.enum.values": "[]"})), "declared-values")

    def test_open_names_are_not_blanket_string_permissions(self):
        self.assertEqual(category(field("nePatchVersion")), "version-text")
        self.assertEqual(category(field("tenantId")), "exact")
        self.assertEqual(category(field("temperature")), "exact")
        self.assertEqual(category(field("new_unknown_column")), "exact")

    def test_address_view_is_explicit_and_excludes_masks_and_ipv6(self):
        self.assertTrue(address_view(field("ipAddress", "ip")))
        self.assertTrue(address_view(field("mgmtIp")))
        self.assertFalse(address_view(field("ipv4Mask")))
        self.assertFalse(address_view(field("ipv6")))

    def test_refresh_generates_family_and_partial_view(self):
        version = reconcile.refresh.new_field("device", field("version"), "version")
        self.assertIn("search_text_ops, text_inputs", version)
        address = reconcile.refresh.new_field("device", field("ipAddress", "ip"), "address")
        self.assertIn('computed_dimension("device__ipAddress_ipv4"', address)
        self.assertIn("edsl::canonical_ipv4_view", address)
        self.assertNotIn("@edsl::logical_type", address)
        unknown = reconcile.refresh.new_field("device", field("unknown"), "unknown")
        self.assertIn("text_ops, text_inputs", unknown)

    def test_reconciliation_is_idempotent_on_complete_model(self):
        model = (ROOT / "icloud_model/src/model.telora").read_text()
        catalog = json.loads((ROOT / "icloud_model/data/source_catalog.json").read_text())
        self.assertEqual(reconcile.reconcile(model, catalog), model)

    def test_source_refresh_preserves_existing_capability_declarations(self):
        model = (ROOT / "icloud_model/src/model.telora").read_text()
        data = ROOT / "icloud_model/data"
        refreshed = reconcile.refresh.refresh(model, json.loads((data / "source_catalog.json").read_text()),
                                              json.loads((data / "source_exceptions.json").read_text()))
        # Source refresh may reorder type-level relation decorators; field bodies must not change.
        before = [(m["id"], m["body"]) for m in reconcile.refresh.ENTITY.finditer(model)]
        after = [(m["id"], m["body"]) for m in reconcile.refresh.ENTITY.finditer(refreshed)]
        self.assertEqual(after, before)

    def test_time_declarations_use_metadata_and_reviewed_conventions(self):
        sample = reconcile.refresh.new_field("foo", field("ts", "datetime"), "sample_time")
        self.assertIn("Rfc3339Text", sample)
        self.assertIn("FilterInputKind::DatetimeUtc", sample)
        date = reconcile.refresh.new_field("foo", field("date", properties={"dte.time.format.pattern": "YYYY-MM-DD"}), "date")
        self.assertIn("TimeEncoding::DateText", date)
        self.assertIn("FilterInputKind::DateUtc", date)
        clock = reconcile.refresh.new_field("foo", field("timestamp", "long", columnType="timestamp"), "timestamp")
        self.assertIn("TODO: Confirm source integer clock unit", clock)
        self.assertIn("FilterInputKind::EpochMillis", clock)
        ordinary = reconcile.refresh.new_field("foo", field("time_like_name"), "text")
        self.assertNotIn("time_field", ordinary)

    def test_integer_time_assumptions_have_source_todos(self):
        model = (ROOT / "icloud_model/src/model.telora").read_text()
        catalog = json.loads((ROOT / "icloud_model/data/source_catalog.json").read_text())
        sources = {dataset["table"]: {field["name"]: field for field in dataset["fields"]} for dataset in catalog["datasets"]}
        count = 0
        for entity in reconcile.refresh.ENTITY.finditer(model):
            for field in reconcile.FIELD.finditer(entity["body"]):
                if "TimeEncoding::EpochMillis" not in field["block"]:
                    continue
                raw = sources[entity["table"]][field["column"]]
                if time_audit.basis(raw, "EpochMillis")["requires_confirmation"]:
                    self.assertIn("TODO:", field["block"], f"{entity['id']}.{field['name']}")
                    count += 1
        self.assertGreater(count, 0)

    def test_datetime_utc_audit_contract_and_legacy_rejection(self):
        raw = field("ts", "datetime")
        catalog = {"datasets": [{"table": "foo", "fields": [raw]}]}
        role = {"field": "ts", "encoding": "Rfc3339Text", "semantics": "Utc", "logical_type": "DatetimeUtc"}
        declaration = {"encoding": "Rfc3339Text", "semantics": "Utc"}
        report = {"revision": "foo-v1", "datasets": [{"id": "foo", "table": "foo", "time_roles": [role],
            "fields": [{"name": "ts", "column": "ts", "scalar": "String", "time": declaration}]}],
            "dimensions": [{"id": "ts", "dataset": "foo", "column": "ts", "authorized": True,
                "computed": False, "filterable": True, "ops": ["Ge", "Lt"],
                "input_kinds": ["DatetimeUtc"], "half_open": False}]}
        self.assertEqual(time_audit.audit(report, catalog)["errors"], [])
        self.assertFalse(time_audit.basis(raw, "Rfc3339Text")["requires_confirmation"])
        declaration["encoding"] = "CanonicalUtcSecondText"
        self.assertTrue(any("source datetime requires DatetimeUtc" in error
                            for error in time_audit.audit(report, catalog)["errors"]))

    def test_time_coverage_rejects_missing_roles_and_unreviewed_exclusions(self):
        catalog = {"datasets": [{"table": "foo", "fields": [field("ts", "datetime")]}]}
        report = {"revision": "foo-v1", "datasets": [{"id": "foo", "table": "foo", "time_roles": [],
            "fields": [{"name": "ts", "column": "ts", "scalar": "String", "time": None}]}], "dimensions": []}
        self.assertTrue(any("undeclared source time" in error for error in time_audit.audit(report, catalog)["errors"]))
        report["datasets"][0]["fields"][0]["time"] = {"encoding": "CanonicalUtcSecondText", "semantics": "Utc"}
        errors = time_audit.audit(report, catalog)["errors"]
        self.assertTrue(any("unreviewed window exclusion" in error for error in errors))
        self.assertTrue(any("source datetime requires DatetimeUtc" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
