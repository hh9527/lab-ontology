# Spider `dog_kennels` domain model

Use the explicitly provided `dog_kennels` schema, SQLite database, and modeling examples to build
an EnterpriseKnowledge model in `dog-model/` on top of the `ontology` eDSL. Implement a
deterministic closed intent-to-parameterized-SQL entry point.

When a feedback artifact is present, read its current file at the start of every turn. The current
feedback revision defines this iteration's required delta; do not let an older session summary
override it.

## Data boundary

- Modeling examples may be used to understand domain language and construct tests.
- `spider-data-1/eval/` is strictly held out and must not be read, searched, inferred, or copied.
- Physical tables, columns, aliases, and join paths are private implementation details and must not
  appear in resolver-facing documentation.
- `dog-model/docs/DOMAIN.md` and `dog-model/docs/INTENT.md` are the resolver's only knowledge. They
  must be self-contained without reproducing dataset questions, SQL, answers, or data values.
- Do not rely on memorized Spider questions or SQL. Derive the model only from provided assets.

## Adapter protocol

The Host provides `bin/dog-make-query check`. The resolver writes the JSON intent documented in
`INTENT.md` to `dog-eval/input.json`. Success writes only `sql` and `bindings` to
`dog-eval/ok.json`; diagnostics go to `dog-eval/diagnostic.jsonl`. Inputs must never accept SQL
vocabulary, raw expressions, aliases, tables, columns, or join fragments.

## Delivery

Deliver `docs/DOMAIN.md`, `docs/INTENT.md`, `src/model.telora`, `src/query.telora`,
`src/bin/make-query.telora`, `tests/query.telora`, and `telora-crate.json`. Cover supported modeling
shapes, invalid vocabulary/types/combinations, binding order, stable rejection, and repeated
lowering determinism. Run every command listed in the plan and begin the final answer with
`完成任务。`.
