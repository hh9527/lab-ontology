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


if __name__ == "__main__":
    unittest.main()
