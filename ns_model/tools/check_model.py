#!/usr/bin/env python3
"""Run the complete NS definition self-check in an isolated workspace."""
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[2]
raise SystemExit(subprocess.call([
    sys.executable, str(root / "scripts/check-model-registry.py"), "ns_model", *sys.argv[1:]
]))
