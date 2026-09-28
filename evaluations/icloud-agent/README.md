# IC ontology agent evaluation

Use one numbered question at a time. The trusted host builds the snapshot;
the MCP adapter starts one persistent `telora-run --serve stdio+jsonl://` child.
Give the candidate only an Agent-facing guide, one `QUESTION.md`, and access
to the three MCP tools `index`, `info`, and `transform` through the restricted
host endpoint. The Agent's filesystem and shell must not be able
to read the snapshot, runner, source, tests, `RUBRIC.md`, or earlier transcripts.
The adapter accepts only an Intent from the Agent on `ontology_transform`;
an optional request clock is provisioned by the host through
`ONTOLOGY_EVAL_CTX_JSON` and never accepted from Agent tool arguments.
For OpenCode reruns, use the exact model ID `deepseek/deepseek-flash`.
Supply the guide and question as host-selected attachments; disable the
Agent's general file-reading tool entirely.
The candidate guide should contain the generic Intent contract and Agent
workflow from section 3 of root `USAGE.md`, with the host's three tool names;
do not give the Agent build/start instructions or artifact paths.

Set `ONTOLOGY_EVAL_RUNNER` and `ONTOLOGY_EVAL_ARTIFACT` to absolute host paths
before starting the adapter. It owns the child process and forwards only
`ic/index`, `ic/info`, and `ic/transform` JSONL requests. Do not mount the
runner or artifact into the Agent sandbox. No separate Telora TCP or Unix
listener is needed, so the Agent cannot bypass the adapter's host-owned context
rule by calling one directly. Merely copying fewer files into an
otherwise unrestricted working directory does not meet this evaluation's
isolation requirement. Verify that the Agent process has no filesystem route
back to the artifact before claiming a hard-isolated run.
The adapter supports MCP over stdio, but this OpenCode 1.18.32 evaluation still
uses its loopback HTTP mode. A local MCP bridge can forward stdio across two
host-owned mode-0600 FIFOs without mounting the runner or artifact. Direct MCP
initialization, tool listing, and knowledge lookup worked through that bridge
inside a filesystem/PID-isolated sandbox. OpenCode's `local` MCP process,
however, closed its stdin before sending any request and reported `Connection
closed`; do not switch `opencode.json` to that route until its handshake works.
The bridge is an experimental transport component, not a completed replacement
for the current loopback endpoint. Keep the source, runner, artifact, rubric,
and host process table outside the Agent sandbox; disabling Agent shell/file
tools is additional defense, not a substitute for this isolation boundary.

The questions test three different outcomes: successful Model-backed lowering,
refusal of a misleading or unsupported interpretation, and clarification of a
materially ambiguous business request. A successful SQL response is not a
universal passing condition. `RUBRIC.md` is for the evaluator, not the agent.
Question files contain only the simulated business request; process instructions
belong in the generic guide, not in the question. Evaluate the stated business
purpose before applying a rubric: a corpus SQL shape or an awkward noun in the
request must not force clarification when the intended population is explicit.
SQL and bindings are observable intermediate artifacts in this evaluation;
production answers should execute the Query and present the returned data.
Clarification questions should explain the business choice, not ask the user
to select an Intent field, SQL shape, or join path.

The initial runs in `RESULTS.md` used the older artifact-and-runner candidate
layout. Those observations remain a baseline, not a hard-isolation result;
they also predate graph edge normalization and the newer Model declarations.
Record snapshot, guide and service revisions for any new comparison.

The prompts draw on IC corpus families Q0014, Q0050, Q0075, Q0184, Q0328,
Q0354, Q0428, Q0442, and Q0444. Corpus SQL is an observation, not the business
definition. Record the snapshot hash and runner version for each run.
