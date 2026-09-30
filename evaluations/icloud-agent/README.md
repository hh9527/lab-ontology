# IC ontology agent evaluation

Use one numbered question at a time. The trusted host builds the snapshot;
the MCP adapter starts one persistent `telora-run --serve stdio+jsonl://` child.
Give the candidate only an Agent-facing guide, one `QUESTION.md`, and access
to the two MCP tools `info` and `transform` through the restricted
host endpoint. The Agent's filesystem and shell must not be able
to read the snapshot, runner, source, tests, `RUBRIC.md`, or earlier transcripts.
The adapter accepts one to five independent Intents in a single
`ontology_transform` call; relative time must be resolved by the Agent from
application or environment context before this call. No request clock is
injected into the service. It forwards the entire batch to the underlying
transform service in one call. If all lower successfully, it writes one mode-0600 JSON record
containing the ordered Intents and generated Queries to the existing
host-only directory named by `ONTOLOGY_EVAL_OUTPUT_DIR`. The tool returns only
an acceptance receipt; the Agent cannot retrieve SQL or bindings through the
two exposed tools. A failed plan returns indexed diagnostics for all plans
and writes no partial record. Results are not merged or deduplicated across
plans.
For OpenCode reruns, use the exact model ID `deepseek/deepseek-flash`.
Supply the guide and question as host-selected attachments; disable the
Agent's general file-reading tool entirely.
Use `AGENT_USAGE.md` as the candidate guide. It carries the generic Intent
syntax from root `USAGE.md` but replaces the direct service's Query response
with this adapter's receipt-only workflow. Do not give the Agent build/start
instructions or artifact paths.

Set `ONTOLOGY_EVAL_RUNNER`, `ONTOLOGY_EVAL_ARTIFACT`, and
`ONTOLOGY_EVAL_OUTPUT_DIR` to absolute host paths before starting the adapter.
Create the output directory outside the Agent sandbox, with access limited to
the trusted host and evaluator. It owns the child process and forwards only
`ic/info` and `ic/transform` JSONL requests. Do not mount the
runner or artifact into the Agent sandbox. No separate Telora TCP or Unix
listener is needed, so the Agent cannot bypass the restricted tools by calling
one directly. Merely copying fewer files into an
otherwise unrestricted working directory does not meet this evaluation's
isolation requirement. Verify that the Agent process has no filesystem route
back to the artifact before claiming a hard-isolated run.
The adapter supports MCP over stdio, but this evaluation explicitly permits
the loopback HTTP MCP endpoint for OpenCode 1.18.32. The host still runs
`telora-run` over stdio and does not expose a second Telora listener. A local
MCP bridge can forward stdio across two
host-owned mode-0600 FIFOs without mounting the runner or artifact. Direct MCP
initialization, tool listing, and knowledge lookup worked through that bridge
inside a filesystem/PID-isolated sandbox. OpenCode's `local` MCP process,
however, closed its stdin before sending any request and reported `Connection
closed`; stdio-only OpenCode access is not a gate for this evaluation.
The bridge is an experimental transport component, not a completed replacement
for the current loopback endpoint. The current `opencode.json` remote MCP entry
has connected from a filesystem/PID-isolated OpenCode process; this verifies
tool transport, not any business-question result. Keep the source, runner,
artifact, rubric,
and host process table outside the Agent sandbox; disabling Agent shell/file
tools is additional defense, not a substitute for this isolation boundary.

The questions test Model-backed lowering, rejection of unsupported meanings,
and business interpretation under ambiguity. A successful receipt alone is not
a universal passing condition: compare the stored Intent and Query with the
Agent's business-language explanation and the user's actual request.
`RUBRIC.md` is for the evaluator, not the agent.
Question files contain only the simulated business request; process instructions
belong in the generic guide, not in the question. Evaluate the stated business
purpose before applying a rubric: a corpus SQL shape or an awkward noun in the
request must not force clarification when the intended population is explicit.
SQL and bindings are host-only intermediate artifacts in this evaluation;
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
