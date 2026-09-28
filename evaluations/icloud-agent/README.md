# IC ontology agent evaluation

Use one numbered question at a time. The trusted host builds the snapshot and
starts one persistent `telora-run` process. Give the candidate only an
Agent-facing guide, one `QUESTION.md`, and access to the three operations
`ic/index`, `ic/info`, and `ic/transform` through a host-controlled tool adapter
or authenticated gateway. The Agent's filesystem and shell must not be able
to read the snapshot, runner, source, tests, `RUBRIC.md`, or earlier transcripts.
The candidate guide should contain the generic Intent contract and Agent
workflow from section 3 of root `USAGE.md`, with the host's three tool names or
URLs; do not give the Agent build/start instructions or artifact paths.

The HTTP routes are POST `/ic/index`, `/ic/info`, and `/ic/transform`; the
body is the slot input directly. `telora-run` provides no authentication, so
its listener must stay host-private. Merely copying fewer files into an
otherwise unrestricted working directory does not meet this evaluation's
isolation requirement. Verify that the Agent process has no filesystem route
back to the artifact before claiming a hard-isolated run.

The questions test three different outcomes: successful Model-backed lowering,
refusal of a misleading or unsupported interpretation, and clarification of a
materially ambiguous business request. A successful SQL response is not a
universal passing condition. `RUBRIC.md` is for the evaluator, not the agent.

The initial runs in `RESULTS.md` used the older artifact-and-runner candidate
layout. Those observations remain a baseline, not a hard-isolation result;
they also predate graph edge normalization and the newer Model declarations.
Record snapshot, guide and service revisions for any new comparison.

The prompts draw on IC corpus families Q0014, Q0050, Q0075, Q0184, Q0328,
Q0354, Q0428, Q0442, and Q0444. Corpus SQL is an observation, not the business
definition. Record the snapshot hash and runner version for each run.
