# Spider world_1 domain model

开始任务时，参考 `goals/telora-context.md`，按当前需要阅读语言与工具资料；准备工作属于本次任务。

Use the explicitly provided `world_1` schema, SQLite database, and modeling examples to build an
EnterpriseKnowledge model in `world_model/` on top of the `ontology` eDSL. Implement a deterministic
closed intent-to-parameterized-SQL entry point.

When a feedback artifact is present, read its current file at the start of every turn. The current
feedback revision defines this iteration's required delta and acceptance scope; an older session
summary or prior feedback revision is not authoritative. Complete and publish the current incremental
delta even when later capabilities remain for future feedback revisions. Do not conflate the final
multi-round experiment objective with one artifact revision's completion condition.

## Data boundary

- Modeling examples may be used to understand domain language and to construct tests.
- `spider-data-1/eval/` is strictly held out and must not be read, searched, inferred, or copied.
- Physical tables, columns, aliases, and Join paths are private implementation details and must not
  appear in resolver-facing documentation.
- `world_model/docs/DOMAIN.md` and `world_model/docs/INTENT.md` are the resolver's only knowledge.
  They must be self-contained without reproducing dataset questions, SQL, answers, or data values.
- Do not rely on memorized Spider questions or SQL. Derive the model only from the provided assets.

## Adapter protocol

The Host provides `bin/world-make-query check`. The resolver writes the JSON intent documented in
`INTENT.md` to `world-eval/input.json`. On success the adapter writes only a JSON object containing
`sql` and `bindings` to `world-eval/ok.json`; diagnostics go to
`world-eval/diagnostic.jsonl`. Inputs must never accept SQL vocabulary, raw expressions, aliases,
tables, columns, or Join fragments.

## Delivery

Deliver `docs/DOMAIN.md`, `docs/INTENT.md`, `src/model.telora`,
`src/bin/make-query.telora`, `tests/query.telora`, and `telora-crate.json`. Do not retain a
domain `src/query.telora`: bind `ontology/intent::query_intent_lower_factory` directly to the
prepared payload. Express genuine business differences in the model; report a Foundation gap when
the public closed Intent protocol lacks a domain-independent shape. Cover supported modeling
shapes, invalid vocabulary/types/combinations, binding order, stable rejection, and repeated lowering
determinism. Run every command listed in the plan and begin the final answer with `完成任务。`.
