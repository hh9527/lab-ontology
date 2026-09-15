# Review Ontology for Spider world_1

Use `goals/telora-context.md` as the language and tooling reference; read the relevant materials as needed during this task.

Use only the provided `world_1` schema, SQLite database, and modeling examples to review the
Query/Ontology foundation delivered by `ontology.foundation-next`.

Check the domain-independent ability to represent the observed query shapes, including entity
relationships, projection, filtering, aggregation, grouping, ordering, Top N, nested queries,
derived relations, and set operations. Generated SQL must remain parameterized and deterministic;
unsupported shapes must produce attributable diagnostics rather than raw SQL or approximate output.

Write the review to `world-model/my-feedbacks/ontology.md`. Report only domain-independent
foundation gaps here. Leave world-specific vocabulary and mapping choices to the later modeling
stage.

Do not read `spider-data-1/eval/` or any other held-out data. Do not include modeling questions,
literal values, or reference SQL in the review.
