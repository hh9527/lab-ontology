import hashlib
import json
import runpy
import tempfile
import unittest
from pathlib import Path


SCRIPTS = Path(__file__).resolve().parents[1]
catalog = runpy.run_path(str(SCRIPTS / "icloud-source-catalog.py"))["catalog"]


class SourceTableNames(unittest.TestCase):
    def test_import_resolves_only_the_configured_twin_aliases(self):
        renamed = (
            "EntCollaborationElement", "EntNetworkElement", "EntPonElement", "EnterpriseFrame",
            "EnterpriseNetworkLTP", "EnterpriseOpticalModule", "EnterpriseSlot",
        )
        cases = [(name, f"I_{name}", name) for name in renamed] + [
            ("EntPonElement", "EntPonElement", "EntPonElement"),
            ("EnterpriseSlot", "OtherSlot", "OtherSlot"),
            ("OtherResource", "I_OtherResource", "I_OtherResource"),
        ]
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture = root / "sample.logical.yaml"
            for name, table, expected in cases:
                with self.subTest(name=name, table=table):
                    source = {"name": name, "properties": {"dte.twin.tableName": table}, "schema": {"fields": []}}
                    raw = json.dumps(source).encode("utf-8")
                    fixture.write_bytes(raw)
                    entry, = catalog(root)["datasets"]
                    self.assertEqual(entry["table"], expected)
                    self.assertEqual(entry["properties"]["dte.twin.tableName"], expected)
                    self.assertEqual(entry["sha256"], hashlib.sha256(raw).hexdigest())


if __name__ == "__main__":
    unittest.main()
