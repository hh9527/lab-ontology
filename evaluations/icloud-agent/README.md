# IC ontology agent evaluation

Use one numbered question at a time. An isolated candidate directory contains
only a compatible `icloud_model.wasm`, the current sections 1-3 of the root
`USAGE.md` (with domain inventory reduced to `ic`), and
one `QUESTION.md` copied from `questions/`. Do not include `RUBRIC.md`, Model
source, corpus files, or earlier agent transcripts in that directory.
For a standalone directory, make the guide's runner command executable in
that environment: put `telora-run` on `PATH` or replace that command with the
absolute path of a compatible binary. Do not point the agent at the source
tree to resolve a missing runner.

The questions test three different outcomes: successful Model-backed lowering,
refusal of a misleading or unsupported interpretation, and clarification of a
materially ambiguous business request. A successful SQL response is not a
universal passing condition. `RUBRIC.md` is for the evaluator, not the agent.

The initial runs in `RESULTS.md` used an older cropped `USAGE.md` that omitted
the now-documented graph edge-order rule. Keep that version distinction when
comparing runs.

The prompts draw on IC corpus families Q0014, Q0050, Q0075, Q0184, Q0328,
Q0354, Q0428, Q0442, and Q0444. Corpus SQL is an observation, not the business
definition. Record the snapshot hash and runner version for each run.
