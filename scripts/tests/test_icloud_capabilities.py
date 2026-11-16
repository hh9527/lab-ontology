"""Source policy and time coverage checks; model contracts are audited from prepared declarations."""

import importlib.util
import json
import sys
import unittest
from pathlib import Path

SCRIPTS = Path(__file__).resolve().parents[1]
ROOT = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))
from icloud_capabilities import address_view, category

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

    def test_datetime_utc_audit_contract_and_legacy_rejection(self):
        raw = field("ts", "datetime")
        catalog = {"datasets": [{"table": "foo", "fields": [raw]}]}
        role = {"field": "ts", "encoding": "Rfc3339Text", "semantics": "Utc", "logical_type": "DateTimeUtc"}
        declaration = {"encoding": "Rfc3339Text", "semantics": "Utc"}
        report = {"revision": "foo-v1", "datasets": [{"id": "foo", "table": "foo", "time_roles": [role],
            "fields": [{"name": "ts", "column": "ts", "scalar": "String", "time": declaration}]}],
            "dimensions": [{"id": "ts", "dataset": "foo", "column": "ts", "authorized": True,
                "computed": False, "filterable": True, "ops": ["Ge", "Lt"],
                "input_kinds": ["DateTimeUtc"], "half_open": False}]}
        self.assertEqual(time_audit.audit(report, catalog)["errors"], [])
        self.assertFalse(time_audit.basis(raw, "Rfc3339Text")["requires_confirmation"])
        declaration["encoding"] = "CanonicalUtcSecondText"
        self.assertTrue(any("source datetime requires DateTimeUtc" in error
                            for error in time_audit.audit(report, catalog)["errors"]))

    def test_time_coverage_rejects_missing_roles_and_unreviewed_exclusions(self):
        catalog = {"datasets": [{"table": "foo", "fields": [field("ts", "datetime")]}]}
        report = {"revision": "foo-v1", "datasets": [{"id": "foo", "table": "foo", "time_roles": [],
            "fields": [{"name": "ts", "column": "ts", "scalar": "String", "time": None}]}], "dimensions": []}
        self.assertTrue(any("undeclared source time" in error for error in time_audit.audit(report, catalog)["errors"]))
        report["datasets"][0]["fields"][0]["time"] = {"encoding": "CanonicalUtcSecondText", "semantics": "Utc"}
        errors = time_audit.audit(report, catalog)["errors"]
        self.assertTrue(any("unreviewed window exclusion" in error for error in errors))
        self.assertTrue(any("source datetime requires DateTimeUtc" in error for error in errors))


if __name__ == "__main__":
    unittest.main()
