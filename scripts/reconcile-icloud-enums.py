#!/usr/bin/env python3
"""Emit a patch filling source enum wires reported by the prepared-model audit."""

import argparse
import difflib
import hashlib
import json
import re
from pathlib import Path


def closing_parenthesis(text, start):
    depth = 0
    for token in re.finditer(r'"(?:\\.|[^"\\])*"|[()]', text[start:]):
        if token[0] == "(":
            depth += 1
        elif token[0] == ")":
            depth -= 1
            if depth == 0:
                return start + token.end()
    raise ValueError("unclosed property call")


def spec(value):
    wire = value["wire"]
    tag, raw = next(iter(wire.items()))
    suffix = re.sub(r"[^A-Za-z0-9_]", "_", str(raw))
    # The digest avoids collisions between differently punctuated wire strings.
    digest = hashlib.sha256(json.dumps(wire, sort_keys=True).encode()).hexdigest()[:8]
    identifier = f"wire_{suffix}_{digest}"
    literal = json.dumps(raw, ensure_ascii=False) if tag != "Bool" else ("True" if raw else "False")
    return (f'{{id: {json.dumps(identifier)}, label: {json.dumps(value["label"], ensure_ascii=False)}, '
            f'wires: [edsl::FilterInput::{tag}({literal})]}}')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("audit", type=Path)
    args = parser.parse_args()
    path = Path("icloud_model/src/model.telora")
    old = path.read_text()
    new = old
    for gap in json.loads(args.audit.read_text())["enum_gaps"]:
        dimension = '@edsl::dimension(' + json.dumps(gap["dimension"]) + ','
        start = new.index(dimension)
        field = re.search(r"^    \w+: \w+,", new[start:], re.M)
        if field is None:
            raise ValueError(f"dimension has no regular field: {gap['dimension']}")
        end = start + field.start()
        block = new[start:end]
        seen = set()
        values = []
        for value in gap["missing"]:
            wire = json.dumps(value["wire"], sort_keys=True)
            if wire not in seen:
                seen.add(wire)
                values.append(spec(value))
        literal = "[\n        " + ",\n        ".join(values) + "\n    ]"
        marker = "@edsl::canonical_values("
        if marker in block:
            prop = block.index(marker)
            tail = closing_parenthesis(block, prop)
            previous = block[prop + len(marker):tail - 1]
            replacement = f"@edsl::canonical_values(array::concat([{previous}, {literal}]))"
            block = block[:prop] + replacement + block[tail:]
        else:
            block += "    " + marker + literal + ")\n"
        block = re.sub(
            r'(@edsl::dimension\([^\n]+, True, True, )\w+, \w+(\))',
            r'\1canonical_eq_ne_ops, text_inputs\2', block,
        )
        new = new[:start] + block + new[end:]
    if "array::concat" in new and "use std::array as array;" not in new:
        new = new.replace("use ontology::query as qb;", "use ontology::query as qb;\nuse std::array as array;", 1)
    if new != old:
        print("*** Begin Patch")
        print(f"*** Update File: {path.resolve()}")
        for line in list(difflib.unified_diff(old.splitlines(), new.splitlines(), n=3))[2:]:
            print("@@" if line.startswith("@@") else line)
        print("*** End Patch")


if __name__ == "__main__":
    main()
