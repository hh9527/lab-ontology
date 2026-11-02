#!/usr/bin/env python3
"""Run the IC definition self-check in an isolated workspace."""
from pathlib import Path
import runpy
runpy.run_path(str(Path(__file__).with_name("check-model-registry.py")), run_name="__main__")
