# Ontology feedback: bounded multi-hop related aggregate

The current `lower_internal_related` requires the subject and aggregate-measure entity to share one
direct relation. That constraint is too strong. A subject may be related to the aggregate population
through a short declared chain while the aggregate still has a provable subject grain.

Extend the closed related-aggregate abstraction to one unique prepared route of at most two declared
relations:

- Every hop must come from prepared relation metadata; callers still provide only the authorized
  measure id, subject and order/HAVING fields. Do not expose tables, columns, aliases or join arrays.
- Materialize route joins in deterministic dependency order. A fan-out direction is allowed inside
  this route because all reached rows are consumed by the aggregate; grouping remains exactly on the
  subject dimensions and the aggregate remains hidden.
- Reuse the same route for hidden ORDER BY/Top-N and hidden HAVING. Preserve exact projection,
  filters, binding order and repeated-lowering determinism.
- Require exactly one eligible route. Reject missing, ambiguous, cyclic, over-depth or unauthorized
  routes atomically with attributable diagnostics; never choose by declaration order.
- Keep the existing direct-relation behavior unchanged as the one-hop case.

Add domain-neutral synthetic tests for a subject -> intermediate -> event population using hidden
count ordering with Top-N and hidden aggregate HAVING. Assert exact SQL, joins, grouping, projection
and bindings, plus missing/ambiguous/over-depth rejection probes. Update `ONTOLOGY.md` and run the
three authorized checks.
