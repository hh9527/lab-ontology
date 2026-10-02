#!/usr/bin/env python3
"""Emit a reviewable patch reconciling existing dimensions with source policy."""

import argparse
import difflib
import importlib.util
import json
import re
from pathlib import Path

from icloud_capabilities import address_view, category, ipv4_declaration, operations, search_note

spec = importlib.util.spec_from_file_location("refresh", Path(__file__).with_name("refresh-icloud-schema.py"))
refresh = importlib.util.module_from_spec(spec)
spec.loader.exec_module(refresh)

FIELD = re.compile(r'(?P<block>    @edsl::column\("(?P<column>[^"\n]+)"\)\n.*?^    (?P<name>\w+): [^\n]+,\n)', re.S | re.M)
DIMENSION = re.compile(r'@edsl::dimension\("(?P<id>[^"\n]+)", True, True,\s*(?P<ops>\[[^\]]*\]|\w+), (?P<input>\w+)\)')
DESCRIPTION = re.compile(r'    @edsl::dimension_description\("(?P<id>[^"\n]+)", (?P<label>"(?:[^"\\]|\\.)*"), (?P<summary>"(?:[^"\\]|\\.)*")\)\n')


def reconcile(model, catalog):
    sources = {dataset["table"]: dataset for dataset in catalog["datasets"]}
    def entity(match):
        source = sources[match["table"]]
        fields = {field["name"]: field for field in source["fields"]}
        def field(match):
            raw = fields[match["column"]]
            block = match["block"]
            dimension = DIMENSION.search(block)
            # Preserve visibility and domain-specific canonical/time declarations.
            if not dimension or '@edsl::canonical_values(' in block or '@edsl::time_field(' in block:
                return block
            group = category(raw)
            if group in {"declared-values", "clock", "identity", "exact"}:
                return block
            op = operations(raw)
            block = block[:dimension.start("ops")] + op + block[dimension.end("ops"):]
            raw_id = dimension["id"]
            if group.endswith("-text"):
                note = search_note(raw)
                found = next((d for d in DESCRIPTION.finditer(block) if d["id"] == raw_id), None)
                if found:
                    summary = json.loads(found["summary"])
                    if note not in summary:
                        block = block[:found.start("summary")] + json.dumps(summary + " " + note, ensure_ascii=False) + block[found.end("summary"):]
                else:
                    label = raw.get("businessName") or raw["name"]
                    summary = (raw.get("description") or "Source field.") + " " + note
                    declaration = f'    @edsl::dimension_description({json.dumps(raw_id)}, {json.dumps(label, ensure_ascii=False)}, {json.dumps(summary, ensure_ascii=False)})\n'
                    marker = f'    {match["name"]}:'
                    block = block.replace(marker, declaration + marker)
                if address_view(raw) and f'@edsl::computed_dimension("{raw_id}_ipv4"' not in block:
                    marker = f'    {match["name"]}:'
                    block = block.replace(marker, ipv4_declaration(raw_id, raw.get("businessName") or raw["name"]) + marker)
            return block
        body = FIELD.sub(field, match["body"])
        return match[0][:match.start("body") - match.start()] + body + "};"
    return refresh.ENTITY.sub(entity, model)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--model", type=Path, default=Path("icloud_model/src/model.telora"))
    parser.add_argument("--catalog", type=Path, default=Path("icloud_model/data/source_catalog.json"))
    parser.add_argument("--chunks", type=int, default=1)
    parser.add_argument("--chunk", type=int, default=0)
    args = parser.parse_args()
    old = args.model.read_text()
    new = reconcile(old, json.loads(args.catalog.read_text()))
    if old != new:
        print("*** Begin Patch")
        print(f"*** Update File: {args.model.resolve()}")
        hunks = []
        for line in list(difflib.unified_diff(old.splitlines(), new.splitlines(), n=3))[2:]:
            if line.startswith("@@"):
                hunks.append([])
            hunks[-1].append(line)
        chosen = hunks[len(hunks) * args.chunk // args.chunks:len(hunks) * (args.chunk + 1) // args.chunks]
        for hunk in chosen:
            for line in hunk:
                print("@@" if line.startswith("@@") else line)
        print("*** End Patch")


if __name__ == "__main__":
    main()
