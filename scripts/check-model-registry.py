#!/usr/bin/env python3
"""Run model definition self-check without initializing the staged service entry."""
from pathlib import Path
import json
import os
import shutil
import subprocess
import tempfile
import argparse

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("model", nargs="?", default="icloud_model", choices=("icloud_model", "ns_model"))
parser.add_argument("--telora", type=Path)
parser.add_argument("--fuel", type=int, help="Isolated initialization/request fuel budget, in millions")
args = parser.parse_args()
if args.fuel is not None and args.fuel <= 0:
    parser.error("--fuel must be positive")
model = args.model
repo = Path(__file__).resolve().parents[1]
base = Path(os.environ.get("TMPDIR") or Path.home() / ".cache/tmp")
base.mkdir(parents=True, exist_ok=True)
with tempfile.TemporaryDirectory(prefix=model + "-registry-check-", dir=base) as directory:
    root = Path(directory)
    for name in ("ontology", model):
        crate = root / name
        shutil.copytree(repo / name / "src", crate / "src")
        shutil.copy2(repo / name / "telora-crate.json", crate / "telora-crate.json")
    # The test needs definitions, not MainService's closed build-time stage.
    (root / model / "src/lib.telora").write_text("pub mod typed;\n" if model == "icloud_model" else "pub mod model; pub mod units; pub mod identities; pub mod groups; pub mod domains; pub mod datasets; mod profile;\n")
    tests = root / model / "tests"
    tests.mkdir()
    shutil.copy2(repo / model / "tests/registry_model.telora", tests)
    config = json.loads((repo / "telora-config.json").read_text())
    config["members"] = ["ontology", model]
    fuel = args.fuel if args.fuel is not None else 4 * config["runtime"]["buildtimeFuel"]
    config["runtime"]["initializationFuel"] = fuel
    config["runtime"]["requestFuel"] = fuel
    config["runtime"]["memoryLimit"] = config["runtime"]["buildtimeMemoryLimit"]
    (root / "telora-config.json").write_text(json.dumps(config))
    lock = json.loads((repo / "telora-lock.json").read_text())
    lock["packages"] = {k: v for k, v in lock["packages"].items() if k in config["members"]}
    (root / "telora-lock.json").write_text(json.dumps(lock))
    completed = subprocess.run([str(args.telora or repo / "bin/telora"), "-C", str(root / model), "test", "registry_model"])
    raise SystemExit(completed.returncode)
